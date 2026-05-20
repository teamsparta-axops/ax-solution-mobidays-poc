// Meeting record extractor — real GPT-4o call with heuristic fallback.

import { getOpenAI, MODELS } from "@/lib/openai";

export interface MeetingAttendee {
  name: string;
  party: "us" | "client" | "partner";
  companyName?: string;
  title?: string;
  emailMasked?: string;
}

export interface MeetingTopic {
  label: string;
  summary: string;
  evidenceSpan: string;
  sentiment: "positive" | "neutral" | "negative" | "mixed";
}

export interface ActionItem {
  ownerParty: "us" | "client" | "both";
  ownerName?: string;
  description: string;
  dueBy?: string | null;
}

export interface BudgetSignal {
  amountKrw: number;
  scope: string;
  horizon: string;
}

export interface MeetingExtraction {
  occurredAt: string | null;
  durationMinutes?: number;
  location?: string;
  channel?: "in_person" | "video" | "phone" | "other";
  attendees: MeetingAttendee[];
  topics: MeetingTopic[];
  actionItems: ActionItem[];
  nextMeeting?: { at: string; channel?: string } | null;
  budgetSignals: BudgetSignal[];
  productsMentioned: string[];
  competitorsMentioned: string[];
  riskFlags: string[];
}

const KOREAN_DATE = /(\d{4})[.\-/년 ]+\s*(\d{1,2})[.\-/월 ]+\s*(\d{1,2})/;
const TIME_HH = /(\d{1,2})[:시](\d{2})?/;

function extractDateTime(text: string): string | null {
  const m = text.match(KOREAN_DATE);
  if (!m) return null;
  const [, y, mo, d] = m;
  const tm = text.match(TIME_HH);
  const hh = tm ? tm[1].padStart(2, "0") : "10";
  const mm = tm && tm[2] ? tm[2] : "00";
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}T${hh}:${mm}:00+09:00`;
}

const KNOWN_COMPANIES = [
  { name: "삼성전자", brand: "samsung", domain: "samsung.com" },
  { name: "현대자동차", brand: "hyundai", domain: "hyundai.com" },
  { name: "LG화학", brand: "lgchem", domain: "lgchem.com" },
  { name: "네이버", brand: "naver", domain: "naver.com" },
  { name: "카카오", brand: "kakao", domain: "kakao.com" },
  { name: "쿠팡", brand: "coupang", domain: "coupang.com" },
  { name: "넥슨", brand: "nexon", domain: "nexon.com" },
  { name: "엔씨소프트", brand: "ncsoft", domain: "ncsoft.com" },
  { name: "넷마블", brand: "netmarble", domain: "netmarble.com" },
  { name: "토스", brand: "toss", domain: "toss.im" },
  { name: "당근", brand: "daangn", domain: "daangn.com" },
  { name: "야놀자", brand: "yanolja", domain: "yanolja.com" },
  { name: "무신사", brand: "musinsa", domain: "musinsa.com" },
];

const TOPIC_KEYWORDS: Array<{
  topic: string;
  keywords: string[];
  sentiment: MeetingTopic["sentiment"];
}> = [
  { topic: "CTV/리테일미디어", keywords: ["CTV", "스마트TV", "리테일미디어", "리테일 미디어"], sentiment: "positive" },
  { topic: "Attribution 정확도", keywords: ["attribution", "어트리뷰션", "정확도"], sentiment: "neutral" },
  { topic: "UA 비용 효율", keywords: ["UA", "user acquisition", "비용 효율", "CPI"], sentiment: "neutral" },
  { topic: "글로벌 진출", keywords: ["글로벌", "해외", "동남아", "북미", "일본"], sentiment: "positive" },
  { topic: "브랜드 안전성", keywords: ["brand safety", "브랜드 안전", "인벤토리"], sentiment: "neutral" },
  { topic: "퍼포먼스 캠페인", keywords: ["퍼포먼스", "ROAS", "전환"], sentiment: "positive" },
  { topic: "AI 자동화", keywords: ["AI", "자동화", "Agent"], sentiment: "positive" },
];

function findSentences(text: string, keyword: string): string[] {
  const sentences = text.split(/(?<=[.!?。\n])/);
  return sentences.filter((s) => s.includes(keyword)).map((s) => s.trim()).filter(Boolean);
}

function detectTopics(text: string): MeetingTopic[] {
  const out: MeetingTopic[] = [];
  for (const t of TOPIC_KEYWORDS) {
    for (const kw of t.keywords) {
      if (text.includes(kw)) {
        const sentences = findSentences(text, kw);
        if (sentences.length === 0) continue;
        const evidence = sentences[0].slice(0, 180);
        out.push({
          label: t.topic,
          summary: `${t.topic} 관련 논의. ${evidence.slice(0, 80)}…`,
          evidenceSpan: evidence,
          sentiment: t.sentiment,
        });
        break;
      }
    }
  }
  return out;
}

function detectCompanyAndAttendees(text: string): {
  attendees: MeetingAttendee[];
  detectedCompany: string | null;
} {
  let detectedCompany: string | null = null;
  for (const c of KNOWN_COMPANIES) {
    if (text.includes(c.name)) {
      detectedCompany = c.name;
      break;
    }
  }
  const attendees: MeetingAttendee[] = [];

  // Match "참석: ..." or "참여: ..." lines.
  const lines = text.split(/\n/);
  for (const ln of lines) {
    const matchUs = ln.match(/참석[^:：]*\(?(?:당사|모비데이즈|us)\)?[:：](.+)/i);
    if (matchUs) {
      const list = matchUs[1].split(/[,，]/);
      for (const item of list) {
        const m = item.trim().match(/([가-힣]{2,4}|[A-Za-z]+(?:\s+[A-Za-z]+)?)(?:\(([^)]+)\))?/);
        if (m) attendees.push({ name: m[1].trim(), party: "us", title: m[2] });
      }
    }
    const matchClient = ln.match(/참석[^:：]*\(?(?:광고주|클라이언트|client)\)?[:：](.+)/i);
    if (matchClient) {
      const list = matchClient[1].split(/[,，]/);
      for (const item of list) {
        const m = item.trim().match(/([가-힣]{2,4}|[A-Za-z]+(?:\s+[A-Za-z]+)?)(?:\(([^)]+)\))?/);
        if (m)
          attendees.push({
            name: m[1].trim(),
            party: "client",
            title: m[2],
            companyName: detectedCompany ?? undefined,
          });
      }
    }
  }
  if (attendees.length === 0) {
    // Look for "이정훈" / "박민준" — common Korean names — heuristic
    const nameRe = /([가-힣]{2,3})\s*\((당사|광고주|client|us)\)/g;
    let m;
    let safetyLimit = 0;
    while ((m = nameRe.exec(text)) !== null && safetyLimit++ < 50) {
      attendees.push({
        name: m[1],
        party: m[2] === "당사" || m[2] === "us" ? "us" : "client",
        companyName:
          m[2] === "광고주" || m[2] === "client" ? detectedCompany ?? undefined : undefined,
      });
    }
  }
  return { attendees, detectedCompany };
}

function detectBudget(text: string): BudgetSignal[] {
  const out: BudgetSignal[] = [];
  const eokRe = /(?:캠페인|연간|월간|분기)?\s*(?:1건당)?\s*(\d{1,4})\s*억(?:원)?/g;
  let m;
  let safetyLimit = 0;
  while ((m = eokRe.exec(text)) !== null && safetyLimit++ < 50) {
    const amount = Number(m[1]) * 1_0000_0000;
    out.push({
      amountKrw: amount,
      scope: text.slice(Math.max(0, m.index - 12), m.index).trim(),
      horizon: /연간/.test(text.slice(Math.max(0, m.index - 12), m.index))
        ? "annual"
        : /분기/.test(text.slice(Math.max(0, m.index - 12), m.index))
          ? "quarter"
          : "campaign",
    });
  }
  return out;
}

function detectActions(text: string): ActionItem[] {
  const out: ActionItem[] = [];
  const re = /[-•·]\s*\((당사|광고주|client|us|both|both)\)\s*([^\n]+)/g;
  let m;
  let safetyLimit = 0;
  while ((m = re.exec(text)) !== null && safetyLimit++ < 50) {
    const partyRaw = m[1];
    const desc = m[2].trim().slice(0, 200);
    out.push({
      ownerParty:
        partyRaw === "당사" || partyRaw === "us"
          ? "us"
          : partyRaw === "광고주" || partyRaw === "client"
            ? "client"
            : "both",
      description: desc,
    });
  }
  return out;
}

function detectNextMeeting(text: string): MeetingExtraction["nextMeeting"] {
  const m = text.match(/다음\s*(?:미팅|미팅:|미팅 일정)[^\n]*?(\d{4})[.\-/년 ]+\s*(\d{1,2})[.\-/월 ]+\s*(\d{1,2})/);
  if (!m) return null;
  return {
    at: `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}T10:00:00+09:00`,
  };
}

function detectProducts(text: string): string[] {
  const out: string[] = [];
  for (const p of ["MoView", "Programmatic Display", "CTV", "Attribution", "Retail Media", "MoSocial"]) {
    if (text.includes(p)) out.push(p);
  }
  return Array.from(new Set(out));
}

function detectCompetitors(text: string): string[] {
  const out: string[] = [];
  for (const c of ["AppsFlyer", "Adjust", "Branch", "Singular", "Amplitude"]) {
    if (text.includes(c)) out.push(c);
  }
  return out;
}

async function extractMeetingHeuristic(text: string): Promise<MeetingExtraction> {
  const { attendees, detectedCompany } = detectCompanyAndAttendees(text);
  const topics = detectTopics(text);
  if (detectedCompany && topics.length === 0) {
    topics.push({
      label: "신규 광고주 디스커버리",
      summary: `${detectedCompany} 관련 신규 미팅 — 추가 키워드 부족`,
      evidenceSpan: text.slice(0, 160),
      sentiment: "neutral",
    });
  }
  return {
    occurredAt: extractDateTime(text),
    location:
      /강남|판교|광화문|을지로/.test(text)
        ? (text.match(/(강남|판교|광화문|을지로)[^,\s]*/)?.[0] ?? undefined)
        : undefined,
    channel: /video|zoom|google meet|화상/i.test(text) ? "video" : "in_person",
    attendees,
    topics,
    actionItems: detectActions(text),
    nextMeeting: detectNextMeeting(text),
    budgetSignals: detectBudget(text),
    productsMentioned: detectProducts(text),
    competitorsMentioned: detectCompetitors(text),
    riskFlags: /가격 민감|경쟁/i.test(text) ? ["가격 민감도 ↑"] : [],
  };
}

export async function extractMeetingMock(text: string): Promise<MeetingExtraction> {
  try {
    const systemPrompt = `당신은 회의록 구조화 전문가입니다. 한국어 비즈니스 미팅 노트를 분석하여 JSON으로 추출합니다.`;

    const userPrompt = `다음 미팅 노트를 분석하여 아래 JSON 스키마로 추출하세요:
{
  "occurredAt": "ISO8601 or null",
  "channel": "in_person|video|phone|other",
  "attendees": [{"name":"","party":"us|client|partner","title":"","companyName":""}],
  "topics": [{"label":"","summary":"","sentiment":"positive|neutral|negative|mixed","evidenceSpan":""}],
  "actionItems": [{"ownerParty":"us|client|both","ownerName":"","description":"","dueBy":""}],
  "budgetSignals": [{"amountKrw":0,"scope":"","horizon":"annual|quarter|campaign"}],
  "productsMentioned": [],
  "competitorsMentioned": [],
  "riskFlags": [],
  "nextMeeting": {"at":"","channel":""}
}

미팅 노트:
${text}`;

    const completion = await getOpenAI().chat.completions.create({
      model: MODELS.strong,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 1500,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as Partial<{
      occurredAt: string | null;
      channel: string;
      attendees: Array<{ name: string; party: string; title?: string; companyName?: string }>;
      topics: Array<{ label: string; summary: string; sentiment: string; evidenceSpan: string }>;
      actionItems: Array<{ ownerParty: string; ownerName?: string; description: string; dueBy?: string }>;
      budgetSignals: Array<{ amountKrw: number; scope: string; horizon: string }>;
      productsMentioned: string[];
      competitorsMentioned: string[];
      riskFlags: string[];
      nextMeeting: { at: string; channel?: string } | null;
    }>;

    return {
      occurredAt: parsed.occurredAt ?? null,
      channel: (parsed.channel as MeetingExtraction["channel"]) ?? "in_person",
      attendees: (parsed.attendees ?? []).map((a) => ({
        name: a.name,
        party: (a.party as MeetingAttendee["party"]) ?? "client",
        title: a.title,
        companyName: a.companyName,
      })),
      topics: (parsed.topics ?? []).map((t) => ({
        label: t.label,
        summary: t.summary,
        evidenceSpan: t.evidenceSpan,
        sentiment: (t.sentiment as MeetingTopic["sentiment"]) ?? "neutral",
      })),
      actionItems: (parsed.actionItems ?? []).map((ai) => ({
        ownerParty: (ai.ownerParty as ActionItem["ownerParty"]) ?? "both",
        ownerName: ai.ownerName,
        description: ai.description,
        dueBy: ai.dueBy ?? null,
      })),
      budgetSignals: parsed.budgetSignals ?? [],
      productsMentioned: parsed.productsMentioned ?? [],
      competitorsMentioned: parsed.competitorsMentioned ?? [],
      riskFlags: parsed.riskFlags ?? [],
      nextMeeting: parsed.nextMeeting?.at ? parsed.nextMeeting : null,
    };
  } catch {
    return extractMeetingHeuristic(text);
  }
}
