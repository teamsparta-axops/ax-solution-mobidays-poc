import { AlertTriangle, CheckCircle2, ShieldCheck } from "lucide-react";

import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/db";
import { fmtDate, fmtPct, safeParseJson } from "@/lib/utils";

export const dynamic = "force-dynamic";

const AI_READY_SOURCES = [
  {
    name: "Salesforce (CRM)",
    desc: "고객 정보 약 12,400건",
    score: 92,
    metrics: { 신뢰성: "●", 완결성: "●", 중복성: "●", 신선도: "●" },
    issues: [],
  },
  {
    name: "Google Spreadsheet",
    desc: "실행/수주 실패 이력 등",
    score: 65,
    metrics: { 신뢰성: "●", 완결성: "◐", 중복성: "✗", 신선도: "◐" },
    issues: ["광고주명 중복 표기 38건", "도메인 누락 12%"],
  },
  {
    name: "미팅록 & 이메일",
    desc: "비정형 데이터 80%",
    score: 78,
    metrics: { 신뢰성: "●", 완결성: "◐", 중복성: "●", 신선도: "◐" },
    issues: ["구조화 추출 필요", "PII 마스킹 미처리 건 존재"],
  },
  {
    name: "행사 이력 (History)",
    desc: "컨퍼런스 참석 로그 등",
    score: 85,
    metrics: { 신뢰성: "●", 완결성: "◐", 중복성: "●", 신선도: "●" },
    issues: ["2024년 이전 데이터 누락"],
  },
  {
    name: "상품/세션 자료",
    desc: "카탈로그, 아젠다 PDF",
    score: 60,
    metrics: { 신뢰성: "●", 완결성: "✗", 중복성: "◐", 신선도: "◐" },
    issues: ["비정형 PDF 전용", "버전 관리 부재", "최신화 지연"],
  },
];

function DotIndicator({ value }: { value: string }) {
  if (value === "●")
    return <span className="inline-block size-2.5 rounded-full bg-[color:var(--color-success)]" />;
  if (value === "◐")
    return <span className="inline-block size-2.5 rounded-full bg-[color:var(--color-warning)]" />;
  return <span className="inline-block size-2.5 rounded-full bg-[color:var(--color-danger)]" />;
}

function ScoreGauge({ score }: { score: number }) {
  const color =
    score >= 90 ? "var(--color-success)" : score >= 70 ? "#3b82f6" : "var(--color-warning)";
  const pct = Math.round((score / 100) * 360);
  return (
    <div className="relative flex items-center justify-center" style={{ width: 64, height: 64 }}>
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: "50%",
          background: `conic-gradient(${color} ${pct}deg, var(--color-border) ${pct}deg)`,
        }}
      />
      <div
        className="absolute flex items-center justify-center rounded-full bg-[color:var(--color-card)]"
        style={{ width: 46, height: 46 }}
      >
        <span className="text-sm font-bold tabular-nums" style={{ color }}>
          {score}
        </span>
      </div>
    </div>
  );
}

export default async function DqPage() {
  let runs: Awaited<ReturnType<typeof prisma.dqRun.findMany>> = [];
  let latestRun: Awaited<ReturnType<typeof prisma.dqRun.findFirst>> = null;
  let sfCount = 0, sheetCount = 0, accountCount = 0, chunkCount = 0, activityCount = 0;
  try {
    [runs, latestRun, sfCount, sheetCount, accountCount, chunkCount, activityCount] =
      await Promise.all([
        prisma.dqRun.findMany({ orderBy: { runAt: "desc" } }),
        prisma.dqRun.findFirst({ orderBy: { runAt: "desc" } }),
        prisma.sfAccount.count(),
        prisma.sheetProspect.count(),
        prisma.account.count(),
        prisma.docChunk.count(),
        prisma.activity.count(),
      ]);
  } catch (err) {
    console.error("DqPage DB error:", err);
  }

  const totalSuites = runs.length;
  const passing = runs.filter((r) => r.status === "passed").length;

  const SOURCE_COUNTS: Record<string, number> = {
    "Salesforce (CRM)": sfCount,
    "Google Spreadsheet": sheetCount,
    "미팅록 & 이메일": activityCount,
    "행사 이력 (History)": accountCount,
    "상품/세션 자료": chunkCount,
  };

  return (
    <AppShell>
      <PageHeader
        eyebrow="Governance · Data Quality"
        title="데이터 품질 모니터"
        description="Great Expectations 스타일 expectation suite를 source/silver/gold 각 계층에 배치하고 결과를 추적합니다."
        breadcrumbs={[
          { href: "/", label: "홈" },
          { href: "/admin", label: "Admin" },
          { label: "데이터 품질" },
        ]}
      />

      {/* AI-Ready 데이터 소스 점수 */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold tracking-tight">AI-Ready 데이터 소스 점수</h2>
          <Badge tone="ink">소스별 AI 활용 준비도</Badge>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-5">
          {AI_READY_SOURCES.map((src) => (
            <div
              key={src.name}
              className="rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4 flex flex-col gap-3"
            >
              <div className="flex items-center gap-3">
                <ScoreGauge score={src.score} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold leading-tight truncate">{src.name}</div>
                  <div className="text-[11px] text-[color:var(--color-muted-foreground)] mt-0.5 leading-tight">
                    {src.desc}
                    {SOURCE_COUNTS[src.name] !== undefined && (
                      <span className="ml-1 font-semibold text-[color:var(--color-foreground)]">
                        ({SOURCE_COUNTS[src.name].toLocaleString()}건)
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                {Object.entries(src.metrics).map(([key, val]) => (
                  <div key={key} className="flex items-center gap-1.5">
                    <DotIndicator value={val} />
                    <span className="text-[color:var(--color-muted-foreground)]">{key}</span>
                  </div>
                ))}
              </div>
              {src.issues.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {src.issues.map((issue) => (
                    <span
                      key={issue}
                      className="inline-block rounded px-1.5 py-0.5 text-[10px] font-medium bg-[color:var(--color-danger-bg)] text-[color:var(--color-danger)] border border-[color:var(--color-danger)]/20"
                    >
                      {issue}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Pipeline bar */}
        <div className="rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-card)] px-5 py-3 overflow-x-auto">
          <div className="flex items-center gap-2 min-w-max text-xs font-medium">
            {[
              "Raw Data Diagnostics",
              "Quality Refinement (ETL)",
              "Vector Indexing",
              "AI Knowledge Base",
            ].map((step, i, arr) => (
              <div key={step} className="flex items-center gap-2">
                <div className="rounded-md px-3 py-1.5 bg-[color:var(--color-brand-ink)] text-[color:var(--color-brand-lime)] text-[11px] font-semibold whitespace-nowrap">
                  {step}
                </div>
                {i < arr.length - 1 && (
                  <span className="text-[color:var(--color-muted-foreground)] text-base">→</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {latestRun && (
        <section className="mb-6">
          <div className="rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-card)] px-5 py-4">
            <div className="flex items-center justify-between mb-1">
              <div className="text-sm font-semibold flex items-center gap-2">
                {latestRun.status === "passed" ? (
                  <ShieldCheck className="size-4 text-[color:var(--color-success)]" />
                ) : (
                  <AlertTriangle className="size-4 text-[color:var(--color-warning)]" />
                )}
                최근 DQ 실행
                <Badge tone={latestRun.status === "passed" ? "success" : "warning"}>
                  {latestRun.status}
                </Badge>
              </div>
              <span className="text-xs text-[color:var(--color-muted-foreground)]">
                {fmtDate(latestRun.runAt, true)}
              </span>
            </div>
            <div className="text-xs text-[color:var(--color-muted-foreground)]">
              Suite: <span className="font-mono">{latestRun.suite}</span>
            </div>
          </div>
        </section>
      )}

      <div className="grid grid-cols-3 gap-3 mb-6">
        <Stat label="실행된 Suite" value={totalSuites} />
        <Stat
          label="완전 통과"
          value={passing}
          tone={passing === totalSuites ? "success" : "warning"}
        />
        <Stat
          label="경고 / 실패"
          value={totalSuites - passing}
          tone={totalSuites - passing > 0 ? "warning" : "success"}
        />
      </div>

      <div className="space-y-4">
        {runs.map((r) => {
          const metrics = safeParseJson<Record<string, unknown>>(r.metricsJson, {});
          const breaches = safeParseJson<{ field: string; issue: string }[]>(
            r.breachesJson ?? "[]",
            [],
          );
          return (
            <Card key={r.id}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {r.status === "passed" ? (
                    <CheckCircle2 className="size-4 text-[color:var(--color-success)]" />
                  ) : (
                    <AlertTriangle className="size-4 text-[color:var(--color-warning)]" />
                  )}
                  <span className="font-mono">{r.suite}</span>
                  <span className="ml-auto text-xs font-normal text-[color:var(--color-muted-foreground)]">
                    {fmtDate(r.runAt, true)}
                  </span>
                  <Badge tone={r.status === "passed" ? "success" : "warning"}>
                    {r.status}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardBody>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <div className="text-xs font-semibold mb-1.5">메트릭</div>
                    <div className="space-y-1 text-xs">
                      {Object.entries(metrics).map(([k, v]) => (
                        <KV key={k} k={k} v={v} />
                      ))}
                    </div>
                  </div>
                  <div className="md:col-span-2">
                    <div className="text-xs font-semibold mb-1.5">위반 / 경고</div>
                    {breaches.length === 0 ? (
                      <div className="text-xs text-[color:var(--color-muted-foreground)]">
                        위반 없음
                      </div>
                    ) : (
                      <ul className="space-y-1.5 text-xs">
                        {breaches.map((b, i) => (
                          <li
                            key={i}
                            className="rounded border border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning-bg)]/40 px-3 py-2"
                          >
                            <span className="font-mono text-[color:var(--color-warning)] mr-2">
                              {b.field}
                            </span>
                            {b.issue}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </CardBody>
            </Card>
          );
        })}
      </div>
    </AppShell>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "success" | "warning";
}) {
  return (
    <div className="rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4">
      <div className="text-[10px] uppercase tracking-wider text-[color:var(--color-muted-foreground)] font-medium">
        {label}
      </div>
      <div
        className={
          tone === "success"
            ? "text-2xl font-semibold mt-1 text-[color:var(--color-success)]"
            : tone === "warning"
              ? "text-2xl font-semibold mt-1 text-[color:var(--color-warning)]"
              : "text-2xl font-semibold mt-1"
        }
      >
        {value}
      </div>
    </div>
  );
}

function safeDisplayNumber(sv: unknown): string {
  if (typeof sv === "number") {
    if (!isFinite(sv) || isNaN(sv)) return "—";
    return sv < 1 ? fmtPct(sv) : String(sv);
  }
  return String(sv);
}

function KV({ k, v }: { k: string; v: unknown }) {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return (
      <div>
        <div className="text-[color:var(--color-muted-foreground)] font-mono">{k}</div>
        <div className="pl-3 space-y-0.5 mt-0.5">
          {Object.entries(v as Record<string, unknown>).map(([sk, sv]) => (
            <div key={sk} className="flex justify-between gap-3">
              <span className="text-[color:var(--color-muted-foreground)] font-mono">{sk}</span>
              <span className="tabular-nums">{safeDisplayNumber(sv)}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  const displayVal = typeof v === "number" && (!isFinite(v) || isNaN(v)) ? "—" : String(v);
  return (
    <div className="flex justify-between gap-3">
      <span className="text-[color:var(--color-muted-foreground)] font-mono">{k}</span>
      <span className="tabular-nums">{displayVal}</span>
    </div>
  );
}
