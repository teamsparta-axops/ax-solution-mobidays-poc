import Link from "next/link";
import { AlertTriangle, ShieldCheck } from "lucide-react";

import { MdmActions } from "./mdm-actions";

import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/db";
import { fmtDate, safeParseJson } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function MdmReviewPage() {
  const candidates = await prisma.mdmCandidate.findMany({
    where: { status: "pending" },
    orderBy: { score: "desc" },
  });

  // Look up the left-side canonical for context
  const lefts = await prisma.account.findMany({
    where: {
      cmid: { in: candidates.map((c) => c.leftCmid).filter((x): x is string => !!x) },
    },
    select: { cmid: true, canonicalName: true, industryLabel: true, domainRoot: true },
  });
  const leftMap = new Map(lefts.map((l) => [l.cmid, l]));

  return (
    <AppShell>
      <PageHeader
        eyebrow="Master Data Management · Review Queue"
        title="병합 검토 후보"
        description="확률적 매칭이 자동 병합 임계(0.92) 아래로 떨어진 후보. 운영자가 병합/분리/신규 결정."
        breadcrumbs={[
          { href: "/", label: "홈" },
          { href: "/admin", label: "Admin" },
          { label: "MDM" },
        ]}
      />

      <div className="flex items-center gap-2 mb-4">
        <Badge tone={candidates.length > 0 ? "warning" : "success"}>
          대기 중 {candidates.length}건
        </Badge>
      </div>

      {candidates.length === 0 && (
        <Card>
          <CardBody>
            <div className="flex items-center gap-3">
              <ShieldCheck className="size-5 text-[color:var(--color-success)]" />
              <div>
                <div className="font-medium text-sm">대기 중인 리뷰 후보가 없습니다.</div>
                <div className="text-xs text-[color:var(--color-muted-foreground)]">
                  매칭 시뮬레이터에서 새로운 케이스를 만들어보세요.
                </div>
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      <div className="space-y-4">
        {candidates.map((c) => {
          const right = safeParseJson<{ system: string; recordId: string; name: string }>(
            c.rightRefJson,
            { system: "?", recordId: "?", name: "?" },
          );
          const features = safeParseJson<Record<string, number>>(c.featuresJson, {});
          const left = c.leftCmid ? leftMap.get(c.leftCmid) : null;

          return (
            <Card key={c.id}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="size-4 text-[color:var(--color-warning)]" />
                  검토 후보
                  <Badge tone={c.score >= 0.85 ? "warning" : "danger"}>
                    score {c.score.toFixed(3)}
                  </Badge>
                  <span className="ml-auto text-xs text-[color:var(--color-muted-foreground)] font-normal">
                    생성 {fmtDate(c.createdAt, true)}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardBody>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="rounded-md border border-[color:var(--color-border)] p-3">
                    <div className="text-[10px] uppercase tracking-wider text-[color:var(--color-muted-foreground)] font-medium mb-1">
                      기존 광고주
                    </div>
                    {left ? (
                      <>
                        <Link
                          href={`/accounts/${left.cmid}`}
                          className="font-medium text-base hover:underline"
                        >
                          {left.canonicalName}
                        </Link>
                        <div className="text-[11px] text-[color:var(--color-muted-foreground)] mt-0.5">
                          {left.cmid} · {left.industryLabel ?? "—"} · {left.domainRoot ?? "—"}
                        </div>
                      </>
                    ) : (
                      <div className="text-sm text-[color:var(--color-muted-foreground)] italic">
                        — 신규 후보 (기존 광고주 없음)
                      </div>
                    )}
                  </div>
                  <div className="rounded-md border border-[color:var(--color-border)] p-3">
                    <div className="text-[10px] uppercase tracking-wider text-[color:var(--color-muted-foreground)] font-medium mb-1">
                      새 소스 레코드
                    </div>
                    <div className="font-medium text-base">{right.name}</div>
                    <div className="text-[11px] text-[color:var(--color-muted-foreground)] mt-0.5">
                      {right.system} · {right.recordId}
                    </div>
                  </div>
                </div>

                <div className="mt-3">
                  <div className="text-xs font-semibold mb-1.5">신뢰도 (Confidence)</div>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-2 rounded-full bg-[color:var(--color-border)] overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.round(c.score * 100)}%`,
                          background: c.score >= 0.85 ? "var(--color-warning)" : "var(--color-danger)",
                        }}
                      />
                    </div>
                    <span className="text-xs tabular-nums font-semibold w-10 text-right">
                      {Math.round(c.score * 100)}%
                    </span>
                  </div>
                </div>

                <div className="mt-3">
                  <div className="text-xs font-semibold mb-1.5">피처 점수</div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {Object.entries(features).map(([k, v]) => (
                      <div
                        key={k}
                        className="rounded border border-[color:var(--color-border)] px-2 py-1.5"
                      >
                        <div className="text-[10px] uppercase tracking-wider text-[color:var(--color-muted-foreground)]">
                          {k}
                        </div>
                        <div className="font-bold tabular-nums">{(v as number).toFixed(2)}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-3 flex gap-2 items-center flex-wrap">
                  <MdmActions candidateId={c.id} />
                </div>
              </CardBody>
            </Card>
          );
        })}
      </div>
    </AppShell>
  );
}
