import { ClipboardList } from "lucide-react";

import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { prisma } from "@/lib/db";
import { fmtDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const logs = await prisma.auditLog.findMany({
    orderBy: { at: "desc" },
    take: 100,
  });

  return (
    <AppShell>
      <PageHeader
        eyebrow="Governance · Audit"
        title="감사 로그"
        description="HITL 승인/거절 및 주요 운영 이벤트가 자동으로 기록됩니다."
        breadcrumbs={[
          { href: "/", label: "홈" },
          { href: "/admin", label: "Admin" },
          { label: "감사 로그" },
        ]}
      />

      <div className="flex items-center gap-2 mb-4">
        <Badge tone="ink">총 {logs.length}건</Badge>
      </div>

      {logs.length === 0 ? (
        <Card>
          <CardBody>
            <div className="flex flex-col items-center justify-center py-10 gap-3 text-center">
              <ClipboardList className="size-10 text-[color:var(--color-muted-foreground)]" />
              <div className="text-sm font-medium">아직 감사 로그가 없습니다.</div>
              <div className="text-xs text-[color:var(--color-muted-foreground)]">
                HITL 승인/거절 시 자동 기록됩니다.
              </div>
            </div>
          </CardBody>
        </Card>
      ) : (
        <div className="rounded-lg border border-[color:var(--color-border)] overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-[color:var(--color-muted)] text-[color:var(--color-muted-foreground)]">
              <tr>
                <th className="px-3 py-2 text-left font-medium">일시</th>
                <th className="px-3 py-2 text-left font-medium">Actor</th>
                <th className="px-3 py-2 text-left font-medium">Action</th>
                <th className="px-3 py-2 text-left font-medium">Resource Type</th>
                <th className="px-3 py-2 text-left font-medium">Resource ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:var(--color-border)]">
              {logs.map((log) => (
                <tr key={log.id} className="bg-[color:var(--color-card)] hover:bg-[color:var(--color-muted)]/40 transition-colors">
                  <td className="px-3 py-2 font-mono whitespace-nowrap">{fmtDate(log.at, true)}</td>
                  <td className="px-3 py-2">{log.actor ?? "—"}</td>
                  <td className="px-3 py-2">
                    <Badge tone="neutral">{log.action}</Badge>
                  </td>
                  <td className="px-3 py-2 text-[color:var(--color-muted-foreground)]">{log.resourceType ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-[color:var(--color-muted-foreground)]">{log.resourceId ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
