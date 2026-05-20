"use client";

import Link from "next/link";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  Clock,
  GitMerge,
  Loader2,
  MessagesSquare,
  PlayCircle,
  Sparkles,
  Star,
  Target,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, fmtKrw, relTime, safeParseJson } from "@/lib/utils";

interface Session {
  id: string;
  title: string;
  track: string | null;
  targetTopicsJson: string;
}
interface Product {
  id: string;
  name: string;
  category: string;
}

type StepState = {
  id: string;
  label: string;
  agent: string;
  model: string;
  status: "pending" | "running" | "done";
  durationMs?: number;
};

interface RecResult {
  request: unknown;
  recommendations: RecommendedAccount[];
  stats: { candidateCount: number; avgScore: number };
}

interface RecommendedAccount {
  cmid: string;
  canonicalName: string;
  industryLabel: string | null;
  customerTier: string | null;
  annualRevenueKrw: number | null;
  marketingBudgetKrw: number | null;
  relationshipScore: number | null;
  lastTouchedAt: string | null;
  leadStage: string | null;
  rank: number;
  score: number;
  ruleScore: number;
  llmScore: number;
  reasons: { type: string; evidence: string; weight: number }[];
  matchedProducts: { id: string; name: string; rationale: string }[];
  matchedSessions: { id: string; title: string; rationale: string }[];
  strategy: string;
  evidenceChunkIds: string[];
}

export function RecommendWizard({
  industries,
  sessions,
  products,
  totalAccounts,
}: {
  industries: string[];
  sessions: Session[];
  products: Product[];
  totalAccounts: number;
}) {
  const [purpose, setPurpose] = useState<"invite" | "session_match" | "followup" | "next_action" | "post_event">("invite");
  const [selIndustries, setSelIndustries] = useState<string[]>([]);
  const [budgetMin, setBudgetMin] = useState<number>(0);
  const [topics, setTopics] = useState<string[]>([]);
  const [excludeInvited, setExcludeInvited] = useState(true);
  const [nResults, setNResults] = useState(8);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RecResult | null>(null);
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [steps, setSteps] = useState<StepState[]>([]);
  const [streamInfo, setStreamInfo] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const topicOptions = useMemo(
    () => Array.from(new Set([
      "CTV",
      "리테일미디어",
      "Attribution",
      "UA",
      "글로벌",
      "AI 자동화",
      "퍼포먼스 캠페인",
      "브랜드 안전성",
    ])),
    [],
  );

  // Cleanup: abort any in-flight request when component unmounts
  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  const toggle = useCallback(<T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]), []);

  const toggleOpenCard = useCallback((cmid: string) => {
    setOpenCardId((cur) => (cur === cmid ? null : cmid));
  }, []);

  const onRun = async () => {
    // Abort any in-progress request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setResult(null);
    setOpenCardId(null);
    setSteps([]);
    setStreamInfo([]);

    try {
      const res = await fetch("/api/recommend-stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          purpose,
          filters: {
            industries: selIndustries.length > 0 ? selIndustries : undefined,
            budgetMinKrw: budgetMin > 0 ? budgetMin : undefined,
            excludeLeadStages: excludeInvited ? ["Invited", "Confirmed", "Met", "Won"] : undefined,
          },
          topics,
          outputTypes: ["list", "reason", "strategy", "message"],
          nResults,
        }),
      });

      if (!res.ok || !res.body) throw new Error("스트림 시작 실패");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";

        for (const chunk of lines.filter((l) => l.trim() !== "")) {
          const dataLine = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (!dataLine) continue;
          try {
            const event = JSON.parse(dataLine.slice(6));

            if (event.type === "step_start") {
              setSteps((prev) => [
                ...prev,
                { id: event.step, label: event.label, agent: event.agent, model: event.model, status: "running" },
              ]);
            } else if (event.type === "step_done") {
              setSteps((prev) =>
                prev.map((s) =>
                  s.id === event.step ? { ...s, status: "done", durationMs: event.durationMs } : s,
                ),
              );
            } else if (event.type === "info") {
              setStreamInfo((prev) => [...prev, event.message]);
            } else if (event.type === "complete") {
              setResult({ request: {}, recommendations: event.recommendations, stats: event.stats });
              if (event.recommendations[0]) setOpenCardId(event.recommendations[0].cmid);
            }
          } catch {
            /* skip malformed */
          }
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* WIZARD */}
      <div className="lg:col-span-4 space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>① 니즈 정의</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            <Field label="세일즈 목적">
              <select
                value={purpose}
                onChange={(e) => setPurpose(e.target.value as "invite")}
                className="w-full h-9 px-3 border rounded-md border-[color:var(--color-border)] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--color-brand-ink)]/15"
              >
                <option value="invite">초청 대상 발굴 (Max Summit)</option>
                <option value="session_match">특정 세션 관심 광고주 추천</option>
                <option value="followup">후속 미팅 대상 추천</option>
                <option value="next_action">다음 액션 필요 광고주</option>
                <option value="post_event">행사 후 팔로업 대상</option>
              </select>
            </Field>

            <Field label="산업군 (복수 선택)">
              <div className="flex flex-wrap gap-1.5">
                {industries.map((i) => (
                  <button
                    key={i}
                    onClick={() => setSelIndustries(toggle(selIndustries, i))}
                    className={cn(
                      "px-2 py-1 rounded text-xs border border-[color:var(--color-border)] hover:border-[color:var(--color-brand-ink)] transition",
                      selIndustries.includes(i) && "bg-[color:var(--color-brand-ink)] text-white border-[color:var(--color-brand-ink)]",
                    )}
                  >
                    {i}
                  </button>
                ))}
              </div>
            </Field>

            <Field label={`마케팅 예산 최소 (${fmtKrw(budgetMin)} 이상)`}>
              <input
                type="range"
                min={0}
                max={100_0000_0000}
                step={10_0000_0000}
                value={budgetMin}
                onChange={(e) => setBudgetMin(Number(e.target.value))}
                className="w-full"
              />
            </Field>

            <Field label="관심 주제 (복수)">
              <div className="flex flex-wrap gap-1.5">
                {topicOptions.map((t) => (
                  <button
                    key={t}
                    onClick={() => setTopics(toggle(topics, t))}
                    className={cn(
                      "px-2 py-1 rounded text-xs border border-[color:var(--color-border)] hover:border-[color:var(--color-brand-ink)]",
                      topics.includes(t) && "bg-[color:var(--color-brand-lime)] text-[color:var(--color-brand-ink)] border-[color:var(--color-brand-lime)]",
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="제외 조건">
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={excludeInvited}
                  onChange={(e) => setExcludeInvited(e.target.checked)}
                />
                이미 초청/Met/Won 상태인 광고주 제외
              </label>
            </Field>

            <Field label={`결과 개수: ${nResults}`}>
              <input
                type="range"
                min={3}
                max={20}
                value={nResults}
                onChange={(e) => setNResults(Number(e.target.value))}
                className="w-full"
              />
            </Field>

            <Button onClick={onRun} disabled={loading} className="w-full">
              {loading ? <Loader2 className="size-4 animate-spin" /> : <PlayCircle className="size-4" />}
              {loading ? "Agent 추론 중…" : "추천 실행"}
            </Button>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>② Agent 파이프라인</CardTitle>
          </CardHeader>
          <CardBody>
            <ol className="space-y-1.5 text-xs">
              {[
                "parse_request",
                "retrieve_candidates",
                "score_accounts (rule 60% + LLM 40%)",
                "explain_reasons",
                "match_products_sessions",
                "draft_message",
                "compute_next_actions",
                "persist + notify",
              ].map((s, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="size-5 rounded-full bg-[color:var(--color-brand-ink)] text-white text-[10px] flex items-center justify-center">
                    {i + 1}
                  </span>
                  <span className="font-mono">{s}</span>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>

        <div className="rounded-md bg-[color:var(--color-muted)] p-3 text-xs text-[color:var(--color-muted-foreground)]">
          <Sparkles className="inline size-3 mr-1" />
          현재 총 <b className="text-[color:var(--color-foreground)]">{totalAccounts}</b>개 광고주가 KB에 통합되어 있습니다.
        </div>
      </div>

      {/* RESULTS */}
      <div className="lg:col-span-8 space-y-4">
        {!result && !loading && (
          <Card className="bg-[color:var(--color-brand-ink)] text-white">
            <CardBody className="flex items-center gap-4">
              <div className="size-10 rounded-md bg-[color:var(--color-brand-lime)] text-[color:var(--color-brand-ink)] flex items-center justify-center">
                <Target className="size-5" />
              </div>
              <div>
                <div className="font-semibold tracking-tight">왼쪽 패널에서 니즈를 정의하고 [추천 실행]</div>
                <div className="text-xs text-white/70 mt-0.5">
                  Agent가 점수 + 사유 + 매칭 자료 + 메시지 초안까지 생성합니다.
                </div>
              </div>
            </CardBody>
          </Card>
        )}
        {loading && steps.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Loader2 className="size-4 animate-spin text-[color:var(--color-brand-ink)]" />
                A2A 파이프라인 실행 중
                <span className="ml-auto text-xs font-normal text-[color:var(--color-muted-foreground)]">
                  Vercel Edge · 실시간 스트리밍
                </span>
              </CardTitle>
            </CardHeader>
            <CardBody className="space-y-1.5">
              {steps.map((s) => (
                <div key={s.id} className="flex items-center gap-3 py-1">
                  <div className="w-5 flex-shrink-0">
                    {s.status === "done" && <CheckCircle2 className="size-4 text-[color:var(--color-success)]" />}
                    {s.status === "running" && <Loader2 className="size-4 animate-spin text-[color:var(--color-brand-ink)]" />}
                    {s.status === "pending" && <Circle className="size-4 text-[color:var(--color-muted-foreground)]/40" />}
                  </div>
                  <div className="flex-1 text-sm">{s.label}</div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] bg-[color:var(--color-muted)] px-1.5 py-0.5 rounded font-mono">{s.agent}</span>
                    <span className="text-[10px] text-[color:var(--color-muted-foreground)] font-mono">{s.model}</span>
                  </div>
                  {s.durationMs !== undefined && (
                    <span className="text-[10px] tabular-nums text-[color:var(--color-success)]">{s.durationMs}ms</span>
                  )}
                </div>
              ))}
              {streamInfo.length > 0 && (
                <div className="mt-2 pt-2 border-t border-[color:var(--color-border)] space-y-1">
                  {streamInfo.map((m, i) => (
                    <div key={i} className="text-[11px] text-[color:var(--color-muted-foreground)] flex items-center gap-1">
                      <span className="text-[color:var(--color-brand-ink)]">›</span> {m}
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        )}
        {loading && steps.length === 0 && (
          <Card>
            <CardBody className="flex items-center gap-3">
              <Loader2 className="size-5 animate-spin text-[color:var(--color-brand-ink)]" />
              <div className="font-medium text-sm">Agent 파이프라인 초기화 중…</div>
            </CardBody>
          </Card>
        )}
        {result && (
          <Card>
            <CardBody className="flex items-center justify-between gap-4">
              <div>
                <div className="font-semibold tracking-tight">
                  {result.recommendations.length}개 광고주 추천
                </div>
                <div className="text-xs text-[color:var(--color-muted-foreground)]">
                  평균 스코어 {(result.stats.avgScore).toFixed(1)} / 100 · 임계값 60+ 권장
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone="lime">목적: {purposeLabel(purpose)}</Badge>
                {selIndustries.length > 0 && (
                  <Badge tone="neutral">{selIndustries.join(", ")}</Badge>
                )}
              </div>
            </CardBody>
          </Card>
        )}

        {result?.recommendations.map((r) => (
          <RecCard
            key={r.cmid}
            rec={r}
            open={openCardId === r.cmid}
            onToggle={toggleOpenCard}
          />
        ))}
      </div>
    </div>
  );
}

const RecCard = memo(function RecCard({
  rec,
  open,
  onToggle,
}: {
  rec: RecommendedAccount;
  open: boolean;
  onToggle: (cmid: string) => void;
}) {
  const handleToggle = useCallback(() => onToggle(rec.cmid), [onToggle, rec.cmid]);
  return (
    <Card className={cn("transition", open && "ring-2 ring-[color:var(--color-brand-lime)]")}>
      <CardBody className="space-y-3">
        <div className="flex items-start gap-3 cursor-pointer" onClick={handleToggle}>
          <div className="size-12 rounded-md bg-[color:var(--color-brand-ink)] text-[color:var(--color-brand-lime)] flex items-center justify-center font-bold text-lg">
            #{rec.rank}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Link
                href={`/accounts/${rec.cmid}`}
                className="font-semibold text-base hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {rec.canonicalName}
              </Link>
              {rec.customerTier && (
                <Badge tone={rec.customerTier === "A" ? "lime" : "info"}>Tier {rec.customerTier}</Badge>
              )}
              {rec.industryLabel && <Badge tone="neutral">{rec.industryLabel}</Badge>}
              {rec.leadStage && (
                <Badge tone="neutral">{rec.leadStage}</Badge>
              )}
            </div>
            <div className="mt-1.5 flex items-center gap-3 text-[11px] text-[color:var(--color-muted-foreground)]">
              <span>마케팅 {fmtKrw(rec.marketingBudgetKrw)}</span>
              <span>·</span>
              <span>관계 <Star className="inline size-3" /> {rec.relationshipScore?.toFixed(0)}</span>
              <span>·</span>
              <span>최근 접점 {relTime(rec.lastTouchedAt)}</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold tabular-nums">{rec.score}</div>
            <div className="text-[10px] text-[color:var(--color-muted-foreground)]">
              rule {rec.ruleScore} · llm {rec.llmScore}
            </div>
          </div>
          <button
            aria-label={open ? "접기" : "펼치기"}
            onClick={(e) => { e.stopPropagation(); handleToggle(); }}
            className="text-[color:var(--color-muted-foreground)] mt-1"
          >
            {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </button>
        </div>

        {open && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-3 border-t border-[color:var(--color-border)]">
            <div>
              <div className="text-xs font-semibold mb-1.5">추천 사유</div>
              <ul className="space-y-1.5">
                {rec.reasons.map((r, i) => (
                  <li key={i} className="text-xs flex gap-2">
                    <Badge tone="neutral">{r.weight.toFixed(1)}</Badge>
                    <span className="text-[color:var(--color-foreground)]/85">{r.evidence}</span>
                  </li>
                ))}
              </ul>
              {rec.matchedSessions.length > 0 && (
                <div className="mt-3">
                  <div className="text-xs font-semibold mb-1.5 flex items-center gap-1">
                    <Users className="size-3" /> 매칭 세션
                  </div>
                  <ul className="space-y-1 text-xs">
                    {rec.matchedSessions.map((s) => (
                      <li key={s.id} className="border-l-2 border-[color:var(--color-brand-lime)] pl-2">
                        <span className="font-medium">{s.title}</span>
                        <div className="text-[color:var(--color-muted-foreground)]">{s.rationale}</div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {rec.matchedProducts.length > 0 && (
                <div className="mt-3">
                  <div className="text-xs font-semibold mb-1.5">매칭 상품/서비스</div>
                  <ul className="space-y-1 text-xs">
                    {rec.matchedProducts.map((p) => (
                      <li key={p.id} className="border-l-2 border-[color:var(--color-info)] pl-2">
                        <span className="font-medium">{p.name}</span>
                        <div className="text-[color:var(--color-muted-foreground)]">{p.rationale}</div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <div>
              <div className="text-xs font-semibold mb-1.5">접근 전략</div>
              <p className="text-xs text-[color:var(--color-foreground)]/85 leading-relaxed bg-[color:var(--color-muted)] rounded-md p-3">
                {rec.strategy}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link
                  href={`/agent/messages/new?cmid=${rec.cmid}&purpose=Invitation${
                    rec.matchedSessions[0] ? `&sessionId=${rec.matchedSessions[0].id}` : ""
                  }`}
                  className="inline-flex items-center gap-1 text-xs bg-[color:var(--color-brand-ink)] text-white px-3 h-8 rounded-md hover:bg-[color:var(--color-brand-ink-2)]"
                >
                  <MessagesSquare className="size-3" /> 초청 메일 초안
                </Link>
                <Link
                  href={`/accounts/${rec.cmid}`}
                  className="inline-flex items-center gap-1 text-xs border border-[color:var(--color-border)] px-3 h-8 rounded-md hover:bg-[color:var(--color-muted)]"
                >
                  <GitMerge className="size-3" /> 360 뷰
                </Link>
              </div>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
});

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="text-xs font-medium text-[color:var(--color-foreground)]/80 mb-1.5">
        {label}
      </div>
      {children}
    </label>
  );
}

function purposeLabel(p: string) {
  return (
    {
      invite: "초청 대상 발굴",
      session_match: "세션 관심 광고주",
      followup: "후속 미팅 대상",
      next_action: "다음 액션 필요",
      post_event: "행사 후 팔로업",
    }[p] ?? p
  );
}
