import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/db";
import { fmtKrw, relTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

const SOURCE_STATUS: Record<string, { connected: boolean; label: string }> = {
  "Salesforce": { connected: false, label: "미연동 · 시드 데이터" },
  "Sheet:prospects": { connected: false, label: "미연동 · 시드 데이터" },
  "Drive Doc": { connected: false, label: "미연동 · 시드 데이터" },
  "DART": { connected: false, label: "미연동 · 공개 API 미연결" },
};

const ACTIVITY_ICON: Record<string, string> = {
  Meeting: "👥",
  Email: "📧",
  Call: "📞",
  Note: "📝",
};

export default async function AccountDetailPage({
  params,
}: {
  params: Promise<{ cmid: string }>;
}) {
  const { cmid } = await params;

  type AccountWithRelations = Awaited<ReturnType<typeof prisma.account.findUnique<{
    where: { cmid: string };
    include: {
      activities: { orderBy: { occurredAt: "desc" }; take: 10 };
      contacts: true;
      externalIds: true;
      documents: { take: 5; orderBy: { createdAt: "desc" } };
    };
  }>>>;
  let account: AccountWithRelations | null = null;
  let dbError: string | null = null;
  try {
    account = await prisma.account.findUnique({
      where: { cmid },
      include: {
        activities: { orderBy: { occurredAt: "desc" }, take: 10 },
        contacts: true,
        externalIds: true,
        documents: { take: 5, orderBy: { createdAt: "desc" } },
      },
    });
  } catch (e) {
    dbError = e instanceof Error ? e.message : "데이터베이스 오류";
  }

  if (dbError) {
    return (
      <AppShell>
        <div className="flex flex-col items-center justify-center py-32 text-center gap-3">
          <div className="text-4xl">⚠</div>
          <div className="text-lg font-semibold">데이터를 불러오는 중 오류가 발생했습니다</div>
          <div className="text-sm text-[color:var(--color-muted-foreground)]">
            {dbError}
          </div>
        </div>
      </AppShell>
    );
  }

  if (!account) {
    return (
      <AppShell>
        <div className="flex flex-col items-center justify-center py-32 text-center gap-3">
          <div className="text-4xl">404</div>
          <div className="text-lg font-semibold">광고주를 찾을 수 없습니다</div>
          <div className="text-sm text-[color:var(--color-muted-foreground)]">
            CMID <code className="font-mono">{cmid}</code> 에 해당하는 광고주가 없습니다.
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader
        eyebrow="Gold / Canonical"
        title={account.canonicalName}
        breadcrumbs={[
          { href: "/", label: "홈" },
          { href: "/accounts", label: "광고주 360" },
          { label: account.canonicalName },
        ]}
      />

      {/* Top stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardBody>
            <div className="text-[11px] uppercase tracking-wider text-[color:var(--color-muted-foreground)] font-medium mb-1">
              마케팅 예산
            </div>
            <div className="text-2xl font-semibold tabular-nums">
              {fmtKrw(account.marketingBudgetKrw)}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <div className="text-[11px] uppercase tracking-wider text-[color:var(--color-muted-foreground)] font-medium mb-1">
              관계점수
            </div>
            <div className="text-2xl font-semibold tabular-nums">
              {account.relationshipScore != null
                ? `${account.relationshipScore.toFixed(0)} / 100`
                : "—"}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <div className="text-[11px] uppercase tracking-wider text-[color:var(--color-muted-foreground)] font-medium mb-1">
              Lead Stage
            </div>
            <div className="text-2xl font-semibold">{account.leadStage ?? "—"}</div>
          </CardBody>
        </Card>
      </div>

      {/* Data freshness banner */}
      {account.externalIds.length > 0 &&
        account.externalIds.every(
          (ext) => !(SOURCE_STATUS[ext.sourceSystem]?.connected ?? true)
        ) && (
          <div
            className="mb-4 flex items-start gap-2 rounded border px-4 py-3 text-sm"
            style={{
              background: "#fffbeb",
              borderColor: "#fde68a",
              color: "#92400e",
            }}
          >
            <span className="mt-0.5 shrink-0">⚠</span>
            <span>
              <strong>Salesforce·Sheet 미연동</strong> — 아래 데이터는 초기 시드 기준입니다.
              실 운영 시 Salesforce OAuth 연동 후 자동 동기화됩니다.
            </span>
          </div>
        )}

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Sales timeline (2/3) */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Sales 타임라인</CardTitle>
            </CardHeader>
            <CardBody>
              {account.activities.length === 0 ? (
                <div className="text-sm text-[color:var(--color-muted-foreground)]">
                  활동 이력이 없습니다.
                </div>
              ) : (
                <ol className="space-y-4">
                  {account.activities.map((act) => {
                    const icon = ACTIVITY_ICON[act.type] ?? "📌";
                    return (
                      <li key={act.id} className="flex gap-3">
                        <span className="text-xl leading-none mt-0.5">{icon}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge tone="neutral">{act.type}</Badge>
                            <span className="text-sm font-medium truncate">
                              {act.subject ?? "—"}
                            </span>
                            <span className="text-[11px] text-[color:var(--color-muted-foreground)] ml-auto whitespace-nowrap">
                              {relTime(act.occurredAt)}
                            </span>
                          </div>
                          {act.bodySummary && (
                            <p className="mt-1 text-xs text-[color:var(--color-muted-foreground)] line-clamp-2">
                              {act.bodySummary}
                            </p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </CardBody>
          </Card>
        </div>

        {/* Right: 통합 출처 + 담당자 (1/3) */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>통합 출처</CardTitle>
            </CardHeader>
            <CardBody>
              {account.externalIds.length === 0 ? (
                <div className="text-sm text-[color:var(--color-muted-foreground)]">
                  연결된 출처가 없습니다.
                </div>
              ) : (
                <div className="space-y-3">
                  {account.externalIds.map((ext) => {
                    const conf = ext.confidence ?? 1;
                    const status = SOURCE_STATUS[ext.sourceSystem];
                    const isConnected = status?.connected ?? true;
                    return (
                      <div key={ext.id} className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge tone="info">{ext.sourceSystem}</Badge>
                          {ext.sourceName && (
                            <span className="text-xs text-[color:var(--color-muted-foreground)] truncate">
                              {ext.sourceName}
                            </span>
                          )}
                          {/* Connection status chip */}
                          {isConnected ? (
                            <span
                              className="ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium"
                              style={{
                                background: "#dcfce7",
                                color: "#166534",
                              }}
                            >
                              ● 연동됨
                            </span>
                          ) : (
                            <span
                              className="ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium"
                              style={{
                                background: "#fef3c7",
                                color: "#92400e",
                              }}
                            >
                              ⚠ 미연동
                            </span>
                          )}
                        </div>
                        {/* Confidence bar */}
                        <div className="h-1.5 rounded-full bg-[color:var(--color-muted)] overflow-hidden">
                          <div
                            className="h-full bg-[color:var(--color-brand-lime)] rounded-full"
                            style={{ width: `${(conf * 100).toFixed(0)}%` }}
                          />
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-[color:var(--color-muted-foreground)] tabular-nums">
                          {ext.linkedAt ? (
                            <span>수집: {relTime(ext.linkedAt)}</span>
                          ) : (
                            <span />
                          )}
                          <span>{(conf * 100).toFixed(0)}%</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>담당자</CardTitle>
            </CardHeader>
            <CardBody>
              {account.contacts.length === 0 ? (
                <div className="text-sm text-[color:var(--color-muted-foreground)]">
                  담당자 정보가 없습니다.
                </div>
              ) : (
                <div className="space-y-2">
                  {account.contacts.map((c) => (
                    <div
                      key={c.pmid}
                      className="flex items-start gap-2 rounded border border-[color:var(--color-border)] px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-sm font-medium">{c.fullName}</span>
                          {c.isPrimary && <Badge tone="lime">primary</Badge>}
                        </div>
                        {c.title && (
                          <div className="text-[11px] text-[color:var(--color-muted-foreground)] mt-0.5">
                            {c.title}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  {!(SOURCE_STATUS["Salesforce"]?.connected ?? true) && (
                    <p className="mt-1 text-[11px] text-[color:var(--color-muted-foreground)]">
                      * Salesforce 미연동으로 담당자 정보가 최신이 아닐 수 있습니다.
                    </p>
                  )}
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
