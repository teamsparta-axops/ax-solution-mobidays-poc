// Unified ID matching pipeline (RFP Task 1).
//   Tier 1: deterministic strong key (business_no / dart_corp_code / corporate_no)
//   Tier 2: deterministic weak (normalized name + domain root)
//   Tier 3: probabilistic — feature-weighted sum + threshold

import { prisma } from "@/lib/db";
import {
  emailDomain,
  extractDomain,
  normalizeName,
} from "@/lib/mdm/normalize";
import { koSoundex, nameSimilarity, tokenSortRatio } from "@/lib/mdm/similarity";

export interface SourceRecord {
  name: string;
  businessNo?: string | null;
  dartCorpCode?: string | null;
  corporateNo?: string | null;
  website?: string | null;
  email?: string | null;
  industry?: string | null;
  address?: string | null;
  phone?: string | null;
}

export interface FeatureContribution {
  feature: string;
  raw: number;
  weight: number;
  contribution: number;
  evidence: string;
}

export interface MatchCandidate {
  cmid: string;
  canonicalName: string;
  industryLabel: string | null;
  domainRoot: string | null;
  score: number;
  features: FeatureContribution[];
}

export interface MatchDecision {
  tier: 1 | 2 | 3 | "new" | "review";
  cmid: string | null;
  confidence: number;
  signals: { type: string; value: string; evidence: string }[];
  auto: boolean;
  candidates: MatchCandidate[];
  // Trace of each tier attempt (for visualization)
  trace: {
    tier: 1 | 2 | 3;
    status: "matched" | "skipped" | "no-match";
    detail: string;
  }[];
}

// Feature weights — tuned to match the spec table.
export const FEATURE_WEIGHTS = {
  nameToken: 0.25,
  nameSim: 0.2,
  domain: 0.15,
  address: 0.1,
  industry: 0.1,
  brandOverlap: 0.1,
  contactSignal: 0.1,
};

const AUTO_MERGE_THRESHOLD = 0.92;
const REVIEW_THRESHOLD = 0.75;

export async function matchRecord(rec: SourceRecord): Promise<MatchDecision> {
  const trace: MatchDecision["trace"] = [];

  // ──────── Tier 1: deterministic strong keys ────────
  if (rec.businessNo) {
    const hit = await prisma.account.findUnique({
      where: { businessNo: rec.businessNo },
    });
    if (hit) {
      trace.push({
        tier: 1,
        status: "matched",
        detail: `business_no 일치 (${rec.businessNo})`,
      });
      return {
        tier: 1,
        cmid: hit.cmid,
        confidence: 0.99,
        auto: true,
        signals: [
          {
            type: "business_no",
            value: rec.businessNo,
            evidence: `사업자등록번호 ${rec.businessNo} 동일 → 동일 법인 확정`,
          },
        ],
        candidates: [
          {
            cmid: hit.cmid,
            canonicalName: hit.canonicalName,
            industryLabel: hit.industryLabel,
            domainRoot: hit.domainRoot,
            score: 0.99,
            features: [
              {
                feature: "business_no_exact",
                raw: 1,
                weight: 1,
                contribution: 1,
                evidence: `business_no 일치`,
              },
            ],
          },
        ],
        trace,
      };
    }
    trace.push({
      tier: 1,
      status: "no-match",
      detail: `business_no=${rec.businessNo} 미발견`,
    });
  } else if (rec.dartCorpCode) {
    const hit = await prisma.account.findFirst({
      where: { dartCorpCode: rec.dartCorpCode },
    });
    if (hit) {
      trace.push({
        tier: 1,
        status: "matched",
        detail: `DART 고유번호 일치 (${rec.dartCorpCode})`,
      });
      return {
        tier: 1,
        cmid: hit.cmid,
        confidence: 0.99,
        auto: true,
        signals: [
          {
            type: "dart_corp_code",
            value: rec.dartCorpCode,
            evidence: `DART 고유번호 ${rec.dartCorpCode}`,
          },
        ],
        candidates: [
          {
            cmid: hit.cmid,
            canonicalName: hit.canonicalName,
            industryLabel: hit.industryLabel,
            domainRoot: hit.domainRoot,
            score: 0.99,
            features: [
              {
                feature: "dart_exact",
                raw: 1,
                weight: 1,
                contribution: 1,
                evidence: `dart_corp_code 일치`,
              },
            ],
          },
        ],
        trace,
      };
    }
  } else {
    trace.push({
      tier: 1,
      status: "skipped",
      detail: "사업자번호/DART 코드 없음",
    });
  }

  // ──────── Tier 2: normalized name + domain root, OR alias + domain ────────
  const norm = normalizeName(rec.name);
  const domain = extractDomain(rec.website) ?? emailDomain(rec.email);
  if (norm && domain) {
    // Direct canonical match
    let hit = await prisma.account.findFirst({
      where: { canonicalNameNorm: norm, domainRoot: domain },
    });
    let viaAlias = false;
    if (!hit) {
      // Alias match — record's normalized name matches (exact OR substring) a stored alias
      // for an account on this domain. Substring is enabled because companies often add
      // generic suffixes (e.g. "Studios", "Korea", "Holdings") to brand names.
      const aliasesOnDomain = await prisma.accountAlias.findMany({
        where: { account: { domainRoot: domain } },
        include: { account: true },
      });
      const aliasHit = aliasesOnDomain.find((a) => {
        const an = a.aliasNormalized;
        return (
          an === norm ||
          (an.length >= 4 && (norm.includes(an) || an.includes(norm)))
        );
      });
      if (aliasHit) {
        hit = aliasHit.account;
        viaAlias = true;
      }
    }
    if (hit) {
      trace.push({
        tier: 2,
        status: "matched",
        detail: viaAlias
          ? `별칭 정규화 일치 + 도메인 동시 일치`
          : `정규화 이름 + 도메인 동시 일치`,
      });
      return {
        tier: 2,
        cmid: hit.cmid,
        confidence: viaAlias ? 0.93 : 0.95,
        auto: true,
        signals: [
          {
            type: viaAlias ? "alias+domain" : "name+domain",
            value: `${norm} / ${domain}`,
            evidence: viaAlias
              ? `별칭 사전(${rec.name})과 도메인(${domain}) 동시 일치`
              : `정규화된 이름과 도메인(${domain}) 동시 일치`,
          },
        ],
        candidates: [
          {
            cmid: hit.cmid,
            canonicalName: hit.canonicalName,
            industryLabel: hit.industryLabel,
            domainRoot: hit.domainRoot,
            score: viaAlias ? 0.93 : 0.95,
            features: [
              {
                feature: viaAlias ? "alias+domain" : "name+domain",
                raw: 1,
                weight: 1,
                contribution: viaAlias ? 0.93 : 0.95,
                evidence: viaAlias
                  ? "Tier 2 (별칭 사전 경로)"
                  : "Tier 2 결정론적 일치",
              },
            ],
          },
        ],
        trace,
      };
    }
    trace.push({
      tier: 2,
      status: "no-match",
      detail: `${norm} / ${domain} 조합 미발견`,
    });
  } else if (norm && !domain) {
    // Tier 2b: name-only match. Only fires when the normalized name maps uniquely
    // to one canonical account — protects against ambiguous "한국전자" type lookups.
    const matches = await prisma.account.findMany({
      where: { canonicalNameNorm: norm },
      take: 2,
    });
    if (matches.length === 1) {
      trace.push({
        tier: 2,
        status: "matched",
        detail: `정규화 이름 유일 일치 (도메인 없음)`,
      });
      const hit = matches[0];
      return {
        tier: 2,
        cmid: hit.cmid,
        confidence: 0.9,
        auto: true,
        signals: [
          {
            type: "name_only",
            value: norm,
            evidence: `법인 접미사 제거 후 정규화 이름 '${norm}'이 단일 광고주에만 매칭`,
          },
        ],
        candidates: [
          {
            cmid: hit.cmid,
            canonicalName: hit.canonicalName,
            industryLabel: hit.industryLabel,
            domainRoot: hit.domainRoot,
            score: 0.9,
            features: [
              {
                feature: "name_only_unique",
                raw: 1,
                weight: 1,
                contribution: 0.9,
                evidence: "정규화 이름 단일 매칭",
              },
            ],
          },
        ],
        trace,
      };
    }
    trace.push({
      tier: 2,
      status: matches.length === 0 ? "no-match" : "skipped",
      detail:
        matches.length === 0
          ? `정규화 이름 '${norm}'에 매칭되는 광고주 없음`
          : `정규화 이름 '${norm}'이 ${matches.length}개 광고주에 매칭 — Tier 3로 위임`,
    });
  } else {
    trace.push({
      tier: 2,
      status: "skipped",
      detail: "이름 또는 도메인 누락",
    });
  }

  // ──────── Tier 3: probabilistic ────────
  const blocked = await blockingCandidates(rec);
  const scored: MatchCandidate[] = [];
  for (const cand of blocked) {
    const features = computeFeatures(rec, cand, domain);
    const score = features.reduce((sum, f) => sum + f.contribution, 0);
    scored.push({
      cmid: cand.cmid,
      canonicalName: cand.canonicalName,
      industryLabel: cand.industryLabel,
      domainRoot: cand.domainRoot,
      score: Math.min(1, score),
      features,
    });
  }
  scored.sort((a, b) => b.score - a.score);

  const top = scored[0];
  if (!top || top.score < REVIEW_THRESHOLD) {
    trace.push({
      tier: 3,
      status: "no-match",
      detail: top
        ? `최고 점수 ${top.score.toFixed(3)} < ${REVIEW_THRESHOLD}`
        : "차단(blocking) 후보 없음",
    });
    return {
      tier: "new",
      cmid: null,
      confidence: top?.score ?? 0,
      auto: false,
      signals: [],
      candidates: scored.slice(0, 3),
      trace,
    };
  }

  if (top.score >= AUTO_MERGE_THRESHOLD) {
    trace.push({
      tier: 3,
      status: "matched",
      detail: `점수 ${top.score.toFixed(3)} ≥ ${AUTO_MERGE_THRESHOLD} → 자동 병합`,
    });
    return {
      tier: 3,
      cmid: top.cmid,
      confidence: top.score,
      auto: true,
      signals: top.features
        .filter((f) => f.contribution > 0.05)
        .map((f) => ({
          type: f.feature,
          value: f.raw.toFixed(2),
          evidence: f.evidence,
        })),
      candidates: scored.slice(0, 3),
      trace,
    };
  }

  trace.push({
    tier: 3,
    status: "matched",
    detail: `점수 ${top.score.toFixed(3)} (검토 필요)`,
  });
  return {
    tier: "review",
    cmid: null,
    confidence: top.score,
    auto: false,
    signals: top.features
      .filter((f) => f.contribution > 0.05)
      .map((f) => ({
        type: f.feature,
        value: f.raw.toFixed(2),
        evidence: f.evidence,
      })),
    candidates: scored.slice(0, 3),
    trace,
  };
}

// Block by phonetic / name-prefix / domain-prefix to bound candidate set.
async function blockingCandidates(rec: SourceRecord) {
  const norm = normalizeName(rec.name);
  const soundex = koSoundex(rec.name);
  const domain = extractDomain(rec.website) ?? emailDomain(rec.email);
  const prefix = norm.slice(0, 2);

  const orClauses: Array<Record<string, unknown>> = [];
  if (domain) orClauses.push({ domainRoot: domain });
  if (prefix) orClauses.push({ canonicalNameNorm: { startsWith: prefix } });
  if (rec.industry) orClauses.push({ industryLabel: rec.industry });
  // Also fan out via koSoundex on existing accounts (cheap because aliases are pre-joined).
  // For simplicity we skip and rely on the three clauses above.

  if (orClauses.length === 0) return [];

  const candidates = await prisma.account.findMany({
    where: { OR: orClauses },
    take: 30,
    select: {
      cmid: true,
      canonicalName: true,
      canonicalNameNorm: true,
      domainRoot: true,
      industryLabel: true,
      industryCode: true,
      aliases: {
        select: {
          alias: true,
          aliasNormalized: true,
        },
      },
    },
  });

  return candidates;
}

interface CandidateFeatures {
  cmid: string;
  canonicalName: string;
  canonicalNameNorm: string;
  domainRoot: string | null;
  industryLabel: string | null;
  aliases: { alias: string; aliasNormalized: string }[];
}

function computeFeatures(
  rec: SourceRecord,
  cand: CandidateFeatures,
  recDomain: string | null,
): FeatureContribution[] {
  const features: FeatureContribution[] = [];

  // Name token sort — applied against normalized strings so legal suffixes don't penalize
  const recNorm = normalizeName(rec.name);
  const nameTokenSim = Math.max(
    tokenSortRatio(rec.name, cand.canonicalName),
    tokenSortRatio(recNorm, cand.canonicalNameNorm),
  );
  features.push({
    feature: "name_token",
    raw: nameTokenSim,
    weight: FEATURE_WEIGHTS.nameToken,
    contribution: nameTokenSim * FEATURE_WEIGHTS.nameToken,
    evidence: `이름 토큰 유사도 ${nameTokenSim.toFixed(2)}`,
  });

  // Name similarity (hangul-aware best-of)
  const nameSim = nameSimilarity(rec.name, cand.canonicalName);
  features.push({
    feature: "name_sim",
    raw: nameSim,
    weight: FEATURE_WEIGHTS.nameSim,
    contribution: nameSim * FEATURE_WEIGHTS.nameSim,
    evidence: `이름 임베딩 유사도 ${nameSim.toFixed(2)} (한글/영문 best-of)`,
  });

  // Domain root
  const domainMatch =
    recDomain && cand.domainRoot && recDomain === cand.domainRoot ? 1 : 0;
  features.push({
    feature: "domain",
    raw: domainMatch,
    weight: FEATURE_WEIGHTS.domain,
    contribution: domainMatch * FEATURE_WEIGHTS.domain,
    evidence: domainMatch
      ? `도메인 eTLD+1 일치 (${recDomain ?? ""})`
      : recDomain
        ? `도메인 불일치 (${recDomain ?? ""} ≠ ${cand.domainRoot ?? "—"})`
        : `소스 도메인 없음`,
  });

  // Address — placeholder (no address in canonical yet); skip but stay in features list
  features.push({
    feature: "address",
    raw: 0,
    weight: FEATURE_WEIGHTS.address,
    contribution: 0,
    evidence: rec.address ? `주소 정규화 미지원 (PoC)` : `소스 주소 없음`,
  });

  // Industry
  const indMatch =
    rec.industry && cand.industryLabel && rec.industry === cand.industryLabel
      ? 1
      : 0;
  features.push({
    feature: "industry",
    raw: indMatch,
    weight: FEATURE_WEIGHTS.industry,
    contribution: indMatch * FEATURE_WEIGHTS.industry,
    evidence: indMatch
      ? `산업 분류 일치 (${rec.industry})`
      : `산업 분류 불일치 또는 누락`,
  });

  // Brand alias overlap
  let aliasMax = 0;
  for (const alias of cand.aliases) {
    aliasMax = Math.max(aliasMax, tokenSortRatio(rec.name, alias.alias));
  }
  features.push({
    feature: "brand_alias",
    raw: aliasMax,
    weight: FEATURE_WEIGHTS.brandOverlap,
    contribution: aliasMax * FEATURE_WEIGHTS.brandOverlap,
    evidence:
      aliasMax > 0
        ? `별칭 사전 매칭 최고 ${aliasMax.toFixed(2)}`
        : `별칭 매칭 없음`,
  });

  // Contact signal (email domain ≅ company domain etc.)
  const contactDomain = emailDomain(rec.email);
  const contactMatch =
    contactDomain && cand.domainRoot && contactDomain === cand.domainRoot
      ? 1
      : 0;
  features.push({
    feature: "contact_signal",
    raw: contactMatch,
    weight: FEATURE_WEIGHTS.contactSignal,
    contribution: contactMatch * FEATURE_WEIGHTS.contactSignal,
    evidence: contactMatch
      ? `이메일 도메인 일치 (${contactDomain ?? ""})`
      : `이메일 도메인 정보 없음 또는 불일치`,
  });

  return features;
}
