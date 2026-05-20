"use client";

import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  Database,
  FileText,
  Loader2,
  PlayCircle,
  Shield,
  Sparkles,
  TrendingUp,
  Type,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// ─── Pipeline step definitions ─────────────────────────────────────────────

const PIPELINE_STEPS = [
  { id: "parse",       label: "텍스트 정제",          desc: "마크다운 정리 · 헤더/푸터 제거" },
  { id: "pii",         label: "PII 마스킹",           desc: "Regex + LLM fallback · 원본 별도 보관" },
  { id: "extract",     label: "구조 추출 (GPT-4o)",   desc: "JSON 스키마 강제 · Structured Output" },
  { id: "entity_link", label: "엔티티 링킹",          desc: "참석자/회사 → PMID·CMID" },
  { id: "chunk",       label: "Semantic chunking",   desc: "800±200 토큰 · overlap 80" },
  { id: "embed",       label: "임베딩",               desc: "text-embedding-3-small · 1536d" },
  { id: "sales_intel", label: "Sales 인텔리전스",     desc: "구매 준비도 · 감성 · 예산 시그널" },
];

// ─── Types ──────────────────────────────────────────────────────────────────

interface PiiHit { type: string; raw: string; masked: string; start: number; end: number }

interface ExtractResult {
  timings:  Record<string, number>;
  cleaned:  string;
  piiHits:  PiiHit[];
  redacted: string;
  fields: {
    occurredAt:           string | null;
    location?:            string;
    channel?:             string;
    attendees:            { name: string; party: string; companyName?: string; title?: string }[];
    topics:               { label: string; summary: string; evidenceSpan: string; sentiment: string }[];
    actionItems:          { ownerParty: string; description: string }[];
    budgetSignals:        { amountKrw: number; scope: string; horizon: string }[];
    productsMentioned:    string[];
    competitorsMentioned: string[];
    nextMeeting:          { at: string } | null;
    riskFlags:            string[];
  };
  linkedEntities: { name: string; party: string; cmid?: string; companyName?: string; matched: boolean }[];
  chunks:         { ordinal: number; text: string; charCount: number; topics: string[]; sectionPath: string }[];
  embedding:      { model: string; dim: number; chunkCount: number; batches: number };
  salesIntel:     SalesIntel;
}

interface SalesIntel {
  buyingReadiness: number;
  sentiment:       "positive" | "neutral" | "negative";
  signals:         string[];
  budgetTotal:     number;
}

interface StepState {
  status: "idle" | "running" | "done" | "error";
  metric?: string;
}

interface Account { cmid: string; canonicalName: string }

// ─── Main component ─────────────────────────────────────────────────────────

export function ExtractDemo({
  sampleText,
  accounts,
}: {
  sampleText: string;
  accounts: Account[];
}) {
  const [text,       setText]       = useState(sampleText);
  const [loading,    setLoading]    = useState(false);
  const [stepStates, setStepStates] = useState<Record<string, StepState>>({});
  const [result,     setResult]     = useState<ExtractResult | null>(null);
  const [error,      setError]      = useState<string | null>(null);

  const setStep = (id: string, patch: Partial<StepState>) =>
    setStepStates((prev) => ({ ...prev, [id]: { ...prev[id], status: "idle", ...patch } }));

  const run = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    setStepStates({});

    try {
      const res = await fetch("/api/extract", {
        method:  "POST",
        headers: { "content-type": "application/json" },
        body:    JSON.stringify({ text }),
      });

      if (!res.body) throw new Error("스트림 응답 없음");

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let   buf     = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        const messages = buf.split("\n\n");
        buf = messages.pop() ?? "";

        for (const msg of messages) {
          const lines     = msg.trim().split("\n");
          const eventLine = lines.find((l) => l.startsWith("event:"));
          const dataLine  = lines.find((l) => l.startsWith("data:"));
          if (!eventLine || !dataLine) continue;

          const event = eventLine.slice("event:".length).trim();
          let   data: Record<string, unknown>;
          try { data = JSON.parse(dataLine.slice("data:".length).trim()); }
          catch { continue; }

          if (event === "step") {
            const stepId = data.step as string;
            const status = data.status as "running" | "done";
            let metric: string | undefined;
            if (status === "done") {
              if (stepId === "parse")       metric = `${data.charCount as number}자`;
              if (stepId === "pii")         metric = `${data.hitsCount as number}건 감지`;
              if (stepId === "extract")     metric = `참석자 ${data.attendeeCount as number}명 · 토픽 ${data.topicCount as number}개`;
              if (stepId === "entity_link") metric = `${data.matchedCount as number}명 매칭`;
              if (stepId === "chunk")       metric = `청크 ${data.chunkCount as number}개`;
              if (stepId === "embed")       metric = `${data.dim as number}d · ${data.batches as number} 배치`;
              if (stepId === "sales_intel") metric = `준비도 ${data.buyingReadiness as number}%`;
            }
            setStep(stepId, { status, metric });
          } else if (event === "complete") {
            setResult(data as unknown as ExtractResult);
          } else if (event === "error") {
            setError(data.message as string);
          }
        }
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "오류");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* INPUT */}
      <div className="lg:col-span-5 space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>입력 미팅록 (편집 가능)</CardTitle>
          </CardHeader>
          <CardBody>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={20}
              className="w-full font-mono text-[12px] leading-relaxed bg-[color:var(--color-muted)] rounded-md p-3 border border-[color:var(--color-border)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-brand-ink)]/15 scrollbar-thin"
            />
            <div className="mt-3 flex items-center justify-between">
              <div className="text-xs text-[color:var(--color-muted-foreground)]">
                {text.length.toLocaleString()}자 · {text.split(/\s+/).length}단어
              </div>
              <Button onClick={run} disabled={loading}>
                {loading
                  ? <Loader2 className="size-4 animate-spin" />
                  : <PlayCircle className="size-4" />}
                {loading ? "추출 중…" : "파이프라인 실행"}
              </Button>
            </div>
            {error && (
              <div className="mt-3 text-xs text-[color:var(--color-danger)] bg-[color:var(--color-danger-bg)] px-3 py-2 rounded-md">
                {error}
              </div>
            )}
          </CardBody>
        </Card>

        {/* Pipeline steps */}
        <Card>
          <CardHeader>
            <CardTitle>파이프라인 단계</CardTitle>
          </CardHeader>
          <CardBody>
            <ol className="space-y-2.5">
              {PIPELINE_STEPS.map((s, i) => {
                const ss    = stepStates[s.id];
                const state = ss?.status ?? "idle";
                return (
                  <li
                    key={s.id}
                    className={cn(
                      "flex items-start gap-3 rounded-md p-2.5 transition border",
                      state === "running" && "bg-[color:var(--color-brand-lime-bg)]/40 border-[color:var(--color-brand-lime)]",
                      state === "done"    && "bg-[color:var(--color-success-bg)]/40 border-[color:var(--color-success)]/30",
                      state === "idle"    && "border-transparent",
                    )}
                  >
                    <div className="mt-0.5">
                      {state === "done"    && <CheckCircle2 className="size-4 text-[color:var(--color-success)]" />}
                      {state === "running" && <Loader2      className="size-4 animate-spin text-[color:var(--color-brand-ink)]" />}
                      {state === "idle"    && <Circle       className="size-4 text-[color:var(--color-muted-foreground)]" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{i + 1}. {s.label}</span>
                        {ss?.metric && state === "done" && (
                          <span className="text-[10px] tabular-nums text-[color:var(--color-success)] font-mono">
                            {ss.metric}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-[color:var(--color-muted-foreground)]">
                        {state === "running" ? <span className="animate-pulse">{s.desc}</span> : s.desc}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </CardBody>
        </Card>
      </div>

      {/* OUTPUT */}
      <div className="lg:col-span-7 space-y-4">
        {!result && !loading && (
          <Card className="bg-[color:var(--color-brand-ink)] text-white">
            <CardBody className="flex items-center gap-4">
              <div className="size-10 rounded-md bg-[color:var(--color-brand-lime)] text-[color:var(--color-brand-ink)] flex items-center justify-center">
                <Sparkles className="size-5" />
              </div>
              <div>
                <div className="font-semibold tracking-tight">파이프라인 실행 전</div>
                <div className="text-xs text-white/70 mt-0.5">
                  미팅록 원문을 편집하고 [파이프라인 실행]을 누르세요.
                </div>
              </div>
            </CardBody>
          </Card>
        )}
        {loading && !result && (
          <Card>
            <CardBody>
              <div className="flex items-center gap-3">
                <Loader2 className="size-5 animate-spin text-[color:var(--color-brand-ink)]" />
                <div>
                  <div className="font-medium text-sm">파이프라인 스트리밍 중…</div>
                  <div className="text-xs text-[color:var(--color-muted-foreground)]">
                    좌측 단계에 실시간 결과가 표시됩니다.
                  </div>
                </div>
              </div>
            </CardBody>
          </Card>
        )}

        {result && <SalesIntelPanel salesIntel={result.salesIntel} fields={result.fields} />}
        {result && <SaveToKBButton result={result} accounts={accounts} />}
        {result && <ExtractedFields result={result} />}
        {result && <EntityLinks result={result} />}
        {result && <PiiPanel result={result} />}
        {result && <ChunksPanel result={result} />}
      </div>
    </div>
  );
}

// ─── Sales Intelligence Panel ────────────────────────────────────────────────

function SalesIntelPanel({
  salesIntel,
  fields,
}: {
  salesIntel: SalesIntel;
  fields: ExtractResult["fields"];
}) {
  const { buyingReadiness, sentiment, signals, budgetTotal } = salesIntel;

  const gaugeColor =
    buyingReadiness >= 60
      ? "var(--color-success)"
      : buyingReadiness >= 30
        ? "#f59e0b"
        : "var(--color-danger)";

  const sentimentLabel =
    sentiment === "positive" ? "긍정적" : sentiment === "negative" ? "부정적" : "중립";
  const sentimentTone =
    sentiment === "positive" ? "success" : sentiment === "negative" ? "danger" : "neutral";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="size-4 text-[color:var(--color-brand-lime)]" />
          Sales 인텔리전스
          <span className="text-[10px] font-normal bg-[color:var(--color-brand-ink)] text-[color:var(--color-brand-lime)] px-1.5 py-0.5 rounded ml-1">
            실시간 분석
          </span>
        </CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        {/* Buying Readiness Gauge */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold">구매 준비도</span>
            <span className="font-mono font-bold tabular-nums" style={{ color: gaugeColor }}>
              {buyingReadiness}%
            </span>
          </div>
          <div className="h-3 w-full rounded-full bg-[color:var(--color-muted)] overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{ width: `${buyingReadiness}%`, background: gaugeColor }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-[color:var(--color-muted-foreground)]">
            <span>낮음 (0)</span>
            <span>중간 (50)</span>
            <span>높음 (100)</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {/* Sentiment */}
          <div className="rounded-md border border-[color:var(--color-border)] p-3 space-y-1">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-[color:var(--color-muted-foreground)]">
              감성 분석
            </div>
            <div className="flex items-center gap-1.5">
              <Badge tone={sentimentTone}>{sentimentLabel}</Badge>
            </div>
          </div>

          {/* Budget */}
          <div
            className={cn(
              "rounded-md border p-3 space-y-1",
              budgetTotal > 0
                ? "border-[color:var(--color-success)]/40 bg-[color:var(--color-success-bg)]/20"
                : "border-[color:var(--color-border)]",
            )}
          >
            <div className="text-[10px] uppercase tracking-wider font-semibold text-[color:var(--color-muted-foreground)]">
              예산 시그널
            </div>
            <div className="text-sm font-bold tabular-nums">
              {budgetTotal > 0 ? `${(budgetTotal / 1e8).toFixed(1)}억원` : "미탐지"}
            </div>
          </div>
        </div>

        {/* Competitor Warning */}
        {fields.competitorsMentioned.length > 0 && (
          <div className="flex items-start gap-2 rounded-md border border-[color:var(--color-danger)]/40 bg-[color:var(--color-danger-bg)]/20 px-3 py-2">
            <AlertTriangle className="size-3.5 mt-0.5 text-[color:var(--color-danger)] shrink-0" />
            <div className="text-xs">
              <span className="font-semibold text-[color:var(--color-danger)]">경쟁사 언급 </span>
              <span className="text-[color:var(--color-foreground)]/80">
                {fields.competitorsMentioned.join(", ")}
              </span>
            </div>
          </div>
        )}

        {/* Key Signals */}
        {signals.length > 0 && (
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-[color:var(--color-muted-foreground)]">
              핵심 시그널
            </div>
            <div className="flex flex-wrap gap-1.5">
              {signals.map((sig, i) => (
                <Badge key={i} tone="lime">{sig}</Badge>
              ))}
            </div>
          </div>
        )}

        {/* Action Items */}
        {fields.actionItems.length > 0 && (
          <div className="rounded-md border border-[color:var(--color-border)] p-3 space-y-2">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-[color:var(--color-muted-foreground)]">
              다음 액션
            </div>
            <ul className="space-y-1.5 text-xs">
              {fields.actionItems.map((a, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-[color:var(--color-brand-ink)] mt-0.5">·</span>
                  <Badge tone={a.ownerParty === "us" ? "ink" : "info"} className="shrink-0">
                    {a.ownerParty === "us" ? "당사" : a.ownerParty === "client" ? "광고주" : "양측"}
                  </Badge>
                  <span className="text-[color:var(--color-foreground)]/85">{a.description}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Risk Flags */}
        {fields.riskFlags.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-[color:var(--color-muted-foreground)]">
              리스크 플래그
            </div>
            {fields.riskFlags.map((r, i) => (
              <div
                key={i}
                className="flex items-center gap-2 rounded-md border border-[color:var(--color-warning)]/40 bg-[color:var(--color-warning-bg)]/20 px-3 py-2 text-xs"
              >
                <AlertTriangle className="size-3.5 text-[color:var(--color-warning)] shrink-0" />
                <span>{r}</span>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

// ─── Save to KB Button ───────────────────────────────────────────────────────

function SaveToKBButton({ result, accounts }: { result: ExtractResult; accounts: Account[] }) {
  const [selectedCmid, setSelectedCmid] = useState(accounts[0]?.cmid ?? "");
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState<{ docId: string; chunkCount: number; activityId: string } | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  const save = async () => {
    if (!selectedCmid) return;
    setSaving(true);
    setSaveErr(null);
    try {
      const res = await fetch("/api/extract/save", {
        method:  "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cmid:       selectedCmid,
          title:      `미팅록 ${result.fields.occurredAt?.slice(0, 10) ?? new Date().toISOString().slice(0, 10)}`,
          redacted:   result.redacted,
          occurredAt: result.fields.occurredAt,
          topics:     result.fields.topics.map((t) => t.label),
          chunks:     result.chunks,
        }),
      });
      const json = await res.json() as { docId?: string; chunkCount?: number; activityId?: string; error?: string };
      if (!res.ok) throw new Error(json.error ?? "저장 실패");
      setSaved({ docId: json.docId!, chunkCount: json.chunkCount!, activityId: json.activityId! });
    } catch (e: unknown) {
      setSaveErr(e instanceof Error ? e.message : "저장 오류");
    } finally {
      setSaving(false);
    }
  };

  if (saved) {
    return (
      <Card>
        <CardBody>
          <div className="flex items-center gap-2 text-[color:var(--color-success)] text-sm font-medium">
            <CheckCircle2 className="size-4" />
            DocChunk {saved.chunkCount}개 + Activity 1건 저장됨
          </div>
          <div className="mt-1 text-[11px] text-[color:var(--color-muted-foreground)] font-mono">
            {saved.docId} · {saved.activityId}
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="size-4" /> KB에 저장
        </CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">
        <div className="flex items-center gap-2">
          <select
            value={selectedCmid}
            onChange={(e) => setSelectedCmid(e.target.value)}
            className="flex-1 text-sm rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-muted)] px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-[color:var(--color-brand-ink)]/15"
          >
            {accounts.length === 0 && <option value="">계정 없음</option>}
            {accounts.map((a) => (
              <option key={a.cmid} value={a.cmid}>
                {a.canonicalName} ({a.cmid})
              </option>
            ))}
          </select>
          <Button onClick={save} disabled={saving || !selectedCmid || accounts.length === 0}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Database className="size-4" />}
            {saving ? "저장 중…" : "KB 저장"}
          </Button>
        </div>
        <div className="text-[11px] text-[color:var(--color-muted-foreground)]">
          DocChunk {result.chunks.length}개 + Activity 1건이 선택한 광고주 계정에 저장됩니다.
        </div>
        {saveErr && (
          <div className="text-xs text-[color:var(--color-danger)] bg-[color:var(--color-danger-bg)] px-3 py-2 rounded-md">
            {saveErr}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

// ─── Extracted Fields ────────────────────────────────────────────────────────

function ExtractedFields({ result }: { result: ExtractResult }) {
  const f = result.fields;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-4" /> 구조화 JSON (Tool Use 결과)
        </CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Kv label="일시"        value={f.occurredAt ?? "—"} />
          <Kv label="채널 / 장소" value={`${f.channel ?? "—"} · ${f.location ?? "—"}`} />
        </div>

        <div>
          <div className="text-xs font-semibold mb-1.5">참석자</div>
          <div className="flex flex-wrap gap-1.5">
            {f.attendees.map((a, i) => (
              <Badge key={i} tone={a.party === "us" ? "ink" : "info"}>
                {a.name}
                {a.companyName ? ` (${a.companyName})` : ""}
                {a.title ? ` · ${a.title}` : ""}
              </Badge>
            ))}
            {f.attendees.length === 0 && (
              <span className="text-xs text-[color:var(--color-muted-foreground)]">탐지 없음</span>
            )}
          </div>
        </div>

        <div>
          <div className="text-xs font-semibold mb-1.5">탐지 토픽</div>
          <div className="space-y-2">
            {f.topics.map((t, i) => (
              <div key={i} className="rounded-md border border-[color:var(--color-border)] p-2.5">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-sm font-medium">{t.label}</span>
                  <Badge
                    tone={
                      t.sentiment === "positive"
                        ? "success"
                        : t.sentiment === "negative"
                          ? "danger"
                          : "neutral"
                    }
                  >
                    {t.sentiment}
                  </Badge>
                </div>
                <div className="text-xs text-[color:var(--color-foreground)]/80">{t.summary}</div>
                <div className="mt-1.5 text-[11px] text-[color:var(--color-muted-foreground)] italic">
                  ↳ &ldquo;{t.evidenceSpan.slice(0, 150)}{t.evidenceSpan.length > 150 ? "…" : ""}&rdquo;
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <div className="text-xs font-semibold mb-1.5">액션 아이템</div>
            <ul className="space-y-1 text-xs">
              {f.actionItems.map((a, i) => (
                <li key={i} className="flex gap-2">
                  <Badge tone={a.ownerParty === "us" ? "ink" : "info"}>
                    {a.ownerParty === "us" ? "당사" : a.ownerParty === "client" ? "광고주" : "양측"}
                  </Badge>
                  <span>{a.description}</span>
                </li>
              ))}
              {f.actionItems.length === 0 && (
                <span className="text-[color:var(--color-muted-foreground)]">탐지 없음</span>
              )}
            </ul>
          </div>
          <div>
            <div className="text-xs font-semibold mb-1.5">예산 시그널</div>
            <ul className="space-y-1 text-xs">
              {f.budgetSignals.map((b, i) => (
                <li key={i}>
                  <Badge tone="lime">{(b.amountKrw / 1_0000_0000).toFixed(1)}억</Badge>
                  <span className="ml-1 text-[color:var(--color-muted-foreground)]">
                    {b.scope} · {b.horizon}
                  </span>
                </li>
              ))}
              {f.budgetSignals.length === 0 && (
                <span className="text-[color:var(--color-muted-foreground)]">탐지 없음</span>
              )}
            </ul>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <Kv label="언급 제품"    value={f.productsMentioned.join(", ") || "—"} />
          <Kv label="언급 경쟁사"  value={f.competitorsMentioned.join(", ") || "—"} />
          <Kv label="다음 미팅"    value={f.nextMeeting ? f.nextMeeting.at : "—"} />
          <Kv label="리스크 플래그" value={f.riskFlags.join(", ") || "—"} />
        </div>
      </CardBody>
    </Card>
  );
}

// ─── Entity Links ────────────────────────────────────────────────────────────

function EntityLinks({ result }: { result: ExtractResult }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>엔티티 링킹 (참석자 → CMID)</CardTitle>
      </CardHeader>
      <CardBody>
        <div className="space-y-1.5">
          {result.linkedEntities.map((l, i) => (
            <div
              key={i}
              className={cn(
                "flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm",
                l.matched
                  ? "border-[color:var(--color-success)]/40 bg-[color:var(--color-success-bg)]/30"
                  : "border-[color:var(--color-border)]",
              )}
            >
              <div className="flex items-center gap-2">
                <Badge tone={l.party === "us" ? "ink" : "info"}>
                  {l.party === "us" ? "당사" : "광고주"}
                </Badge>
                <span className="font-medium">{l.name}</span>
                {l.companyName && (
                  <span className="text-[color:var(--color-muted-foreground)] text-xs">
                    · {l.companyName}
                  </span>
                )}
              </div>
              <div>
                {l.matched ? (
                  <span className="text-xs tabular-nums text-[color:var(--color-success)]">
                    → {l.cmid}
                  </span>
                ) : (
                  <span className="text-xs text-[color:var(--color-warning)]">review_queue로</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

// ─── PII Panel ───────────────────────────────────────────────────────────────

function PiiPanel({ result }: { result: ExtractResult }) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <CardHeader className="cursor-pointer" onClick={() => setOpen((v) => !v)}>
        <CardTitle className="flex items-center gap-2">
          <Shield className="size-4 text-[color:var(--color-warning)]" />
          PII 마스킹 — 검출 {result.piiHits.length}건
          {open ? <ChevronUp className="size-4 ml-auto" /> : <ChevronDown className="size-4 ml-auto" />}
        </CardTitle>
      </CardHeader>
      {open && (
        <CardBody>
          {result.piiHits.length === 0 ? (
            <div className="text-xs text-[color:var(--color-muted-foreground)]">
              민감 정보가 탐지되지 않았습니다.
            </div>
          ) : (
            <div className="space-y-1.5">
              {result.piiHits.map((h, i) => (
                <div
                  key={i}
                  className="grid grid-cols-12 gap-2 text-xs items-center border-b border-[color:var(--color-border)] pb-1.5 last:border-0"
                >
                  <Badge tone="warning" className="col-span-2 justify-center">{h.type}</Badge>
                  <div className="col-span-5 font-mono text-[11px] text-[color:var(--color-danger)] line-through">
                    {h.raw}
                  </div>
                  <div className="col-span-5 font-mono text-[11px] text-[color:var(--color-success)]">
                    {h.masked}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 text-[11px] text-[color:var(--color-muted-foreground)] leading-relaxed">
            원본은 보호 버킷에 별도 저장되고 인덱스/임베딩은 마스킹 본문을 사용합니다.
          </div>
        </CardBody>
      )}
    </Card>
  );
}

// ─── Chunks Panel ────────────────────────────────────────────────────────────

function ChunksPanel({ result }: { result: ExtractResult }) {
  const [open, setOpen] = useState(true);
  return (
    <Card>
      <CardHeader className="cursor-pointer" onClick={() => setOpen((v) => !v)}>
        <CardTitle className="flex items-center gap-2">
          <FileText className="size-4 text-[color:var(--color-brand-ink)]" />
          청크 &amp; 임베딩 — {result.chunks.length} chunks · {result.embedding.dim}d ·{" "}
          <code className="bg-[color:var(--color-muted)] px-1 rounded text-[11px]">
            {result.embedding.model}
          </code>
          {open ? <ChevronUp className="size-4 ml-auto" /> : <ChevronDown className="size-4 ml-auto" />}
        </CardTitle>
      </CardHeader>
      {open && (
        <CardBody>
          <div className="space-y-2">
            {result.chunks.map((c) => (
              <div key={c.ordinal} className="border border-[color:var(--color-border)] rounded-md p-3">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <Badge tone="ink">#{c.ordinal}</Badge>
                    <span className="text-xs text-[color:var(--color-muted-foreground)]">
                      {c.sectionPath}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs">
                    <Type className="size-3" />
                    <span className="tabular-nums">{c.charCount}자</span>
                  </div>
                </div>
                <div className="text-[12px] leading-relaxed text-[color:var(--color-foreground)]/85 font-mono whitespace-pre-wrap">
                  {c.text}
                </div>
                {c.topics.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {c.topics.map((t) => (
                      <Badge key={t} tone="lime">{t}</Badge>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardBody>
      )}
    </Card>
  );
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function Kv({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wider text-[color:var(--color-muted-foreground)] font-medium">
        {label}
      </span>
      <span className="text-xs text-[color:var(--color-foreground)] mt-0.5">{value}</span>
    </div>
  );
}
