"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, XCircle, ChevronRight, Activity, Clock, ShieldCheck, UserCheck, Mail } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────────

type ItemStatus = "pending" | "approved" | "rejected";

interface MdmItem {
  id: string;
  type: "mdm";
  confidence: number;
  accountName: string;
  description: string;
  features: Record<string, unknown>;
  createdAt: string;
  status: ItemStatus;
}

interface MessageItem {
  id: string;
  type: "message";
  cmid: string;
  accountName: string | null;
  purpose: string;
  subject: string;
  body: string;
  createdAt: string;
  status: ItemStatus;
}

type QueueItem = MdmItem | MessageItem;

interface Stats {
  autoApproved: number;
  pendingCount: number;
  rejectedCount: number;
}

// ── Fallback mock data ────────────────────────────────────────────────────────

const MOCK_MDM: MdmItem[] = [
  {
    id: "mock_mdm_001",
    type: "mdm",
    confidence: 0.88,
    accountName: "삼성전자 (Salesforce)",
    description: "엔티티 병합 후보: mb_acc_018f ↔ 삼성전자 (Salesforce)",
    features: { nameSimilarity: 0.97, domainMatch: true },
    createdAt: new Date().toISOString(),
    status: "pending",
  },
  {
    id: "mock_mdm_002",
    type: "mdm",
    confidence: 0.79,
    accountName: "넥슨코리아",
    description: "엔티티 병합 후보: mb_acc_007c ↔ 넥슨코리아",
    features: { nameSimilarity: 0.91, domainMatch: false },
    createdAt: new Date().toISOString(),
    status: "pending",
  },
  {
    id: "mock_mdm_003",
    type: "mdm",
    confidence: 0.74,
    accountName: "카카오게임즈",
    description: "엔티티 병합 후보: mb_acc_029a ↔ 카카오게임즈",
    features: { nameSimilarity: 0.88, domainMatch: false },
    createdAt: new Date().toISOString(),
    status: "pending",
  },
];

// ── Sub-components ────────────────────────────────────────────────────────────

function ConfidenceGateBar() {
  return (
    <div className="mb-8">
      <h2 className="text-sm font-semibold tracking-tight mb-3">신뢰도 게이트 구간</h2>
      <div className="relative h-8 rounded-lg overflow-hidden flex">
        <div className="flex-none w-[35%] bg-[color:var(--color-danger-bg)] flex items-center justify-center">
          <span className="text-xs font-medium text-[color:var(--color-danger)]">0 – 0.70 · 사람 직접</span>
        </div>
        <div className="flex-none w-[44%] bg-[color:var(--color-warning-bg)] flex items-center justify-center">
          <span className="text-xs font-medium text-[color:var(--color-warning)]">0.70 – 0.92 · 매니저 승인</span>
        </div>
        <div className="flex-none w-[21%] bg-[color:var(--color-success-bg)] flex items-center justify-center">
          <span className="text-xs font-medium text-[color:var(--color-success)]">0.92+ · 자동 실행</span>
        </div>
      </div>
    </div>
  );
}

function MdmCard({
  item,
  onApprove,
  onReject,
}: {
  item: MdmItem;
  onApprove: (id: string, type: "mdm" | "message") => void;
  onReject: (id: string, type: "mdm" | "message") => void;
}) {
  const isPending = item.status === "pending";
  const isApproved = item.status === "approved";
  const isRejected = item.status === "rejected";

  return (
    <Card className={cn(
      "transition-all",
      isApproved && "border-[color:var(--color-success)] opacity-80",
      isRejected && "border-[color:var(--color-danger)] opacity-60",
    )}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge tone="lime">MDM 병합</Badge>
            <CardTitle className="text-base">{item.accountName}</CardTitle>
            {isApproved && <Badge tone="success"><CheckCircle2 className="size-3" /> 승인됨</Badge>}
            {isRejected && <Badge tone="danger"><XCircle className="size-3" /> 반려됨</Badge>}
          </div>
          <div className="text-right shrink-0">
            <div className="text-2xl font-bold tabular-nums text-[color:var(--color-warning)]">
              {(item.confidence * 100).toFixed(0)}
              <span className="text-sm font-normal text-[color:var(--color-muted-foreground)]">%</span>
            </div>
            <div className="text-[10px] text-[color:var(--color-muted-foreground)] mt-0.5">신뢰도</div>
          </div>
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="text-sm text-[color:var(--color-muted-foreground)]">{item.description}</p>
        {Object.keys(item.features).length > 0 && (
          <div className="flex flex-wrap gap-2">
            {Object.entries(item.features).map(([k, v]) => (
              <code key={k} className="text-[11px] font-mono bg-[color:var(--color-muted)] border border-[color:var(--color-border)] rounded px-2 py-0.5">
                {k}: {String(v)}
              </code>
            ))}
          </div>
        )}
        {isPending && (
          <div className="flex gap-2 pt-1">
            <Button variant="primary" size="sm" className="flex-1" onClick={() => onApprove(item.id, "mdm")}>
              <CheckCircle2 className="size-4" /> 병합 승인
            </Button>
            <Button variant="danger" size="sm" className="flex-1" onClick={() => onReject(item.id, "mdm")}>
              <XCircle className="size-4" /> 반려
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function MessageCard({
  item,
  onApprove,
  onReject,
}: {
  item: MessageItem;
  onApprove: (id: string, type: "mdm" | "message") => void;
  onReject: (id: string, type: "mdm" | "message") => void;
}) {
  const isPending = item.status === "pending";
  const isApproved = item.status === "approved";
  const isRejected = item.status === "rejected";

  return (
    <Card className={cn(
      "transition-all",
      isApproved && "border-[color:var(--color-success)] opacity-80",
      isRejected && "border-[color:var(--color-danger)] opacity-60",
    )}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge tone="info"><Mail className="size-3" /> 메시지 승인</Badge>
            <CardTitle className="text-base">{item.subject}</CardTitle>
            {isApproved && <Badge tone="success"><CheckCircle2 className="size-3" /> 승인됨</Badge>}
            {isRejected && <Badge tone="danger"><XCircle className="size-3" /> 반려됨</Badge>}
          </div>
          <Badge tone="neutral">{item.purpose}</Badge>
        </div>
      </CardHeader>
      <CardBody className="space-y-3">
        {item.accountName && (
          <div className="text-sm text-[color:var(--color-muted-foreground)]">
            광고주:{" "}
            <Link href={`/accounts/${item.cmid}`} className="text-[color:var(--color-brand-ink)] hover:underline font-medium">
              {item.accountName}
            </Link>
          </div>
        )}
        <div className="rounded-md bg-[color:var(--color-muted)] px-3 py-2 text-sm text-[color:var(--color-foreground)]/80 line-clamp-3">
          {item.body}
        </div>
        {isPending && (
          <div className="flex gap-2 pt-1">
            <Button variant="primary" size="sm" className="flex-1" onClick={() => onApprove(item.id, "message")}>
              <CheckCircle2 className="size-4" /> 발송 승인
            </Button>
            <Button variant="danger" size="sm" className="flex-1" onClick={() => onReject(item.id, "message")}>
              <XCircle className="size-4" /> 반려
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

// ── Main queue ────────────────────────────────────────────────────────────────

function HitlQueue() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [stats, setStats] = useState<Stats>({ autoApproved: 0, pendingCount: 0, rejectedCount: 0 });
  const [loading, setLoading] = useState(true);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [apiEmpty, setApiEmpty] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/hitl");
        const data = await res.json();
        const mdm: MdmItem[] = (data.mdmCandidates ?? []).map((c: MdmItem) => ({ ...c, status: "pending" as const }));
        const msgs: MessageItem[] = (data.messagePending ?? []).map((m: MessageItem) => ({ ...m, status: "pending" as const }));
        const combined: QueueItem[] = [...mdm, ...msgs];
        if (combined.length === 0) {
          setApiEmpty(true);
          setItems(MOCK_MDM);
        } else {
          setItems(combined);
        }
        setStats(data.stats ?? { autoApproved: 0, pendingCount: combined.length, rejectedCount: 0 });
      } catch {
        setFetchFailed(true);
        setItems(MOCK_MDM);
        setStats({ autoApproved: 12, pendingCount: 3, rejectedCount: 2 });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleAction(id: string, type: "mdm" | "message", action: "approve" | "reject") {
    setActionError(null);
    // Optimistic update
    setItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, status: action === "approve" ? "approved" : "rejected" } : item,
      ),
    );
    setStats((prev) => ({ ...prev, pendingCount: Math.max(0, prev.pendingCount - 1) }));

    if (!fetchFailed) {
      try {
        const res = await fetch("/api/hitl", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, type, action, decidedBy: "demo_manager" }),
        });
        if (!res.ok) {
          throw new Error(`서버 오류 (${res.status})`);
        }
      } catch (e) {
        // Rollback optimistic update
        setItems((prev) =>
          prev.map((item) =>
            item.id === id ? { ...item, status: "pending" as const } : item,
          ),
        );
        setStats((prev) => ({ ...prev, pendingCount: prev.pendingCount + 1 }));
        setActionError("처리 실패 — 다시 시도해 주세요");
        console.error("HITL action error:", e);
      }
    }
  }

  const pendingCount = items.filter((i) => i.status === "pending").length;
  const allDone = !loading && pendingCount === 0 && items.length > 0;

  return (
    <>
      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        {[
          { label: "자동 실행 (0.92+)", value: `${stats.autoApproved}건`, icon: ShieldCheck, tone: "success" as const },
          { label: "검토 대기", value: `${pendingCount}건`, icon: Clock, tone: "warning" as const },
          { label: "부결", value: `${stats.rejectedCount}건`, icon: XCircle, tone: "danger" as const },
          { label: "P95 판단 시간", value: "2.3s", icon: Activity, tone: "info" as const },
        ].map(({ label, value, icon: Icon, tone }) => (
          <div key={label} className="rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-card)] px-4 py-3 flex items-center gap-3">
            <Icon className={cn("size-5 shrink-0",
              tone === "success" && "text-[color:var(--color-success)]",
              tone === "warning" && "text-[color:var(--color-warning)]",
              tone === "danger" && "text-[color:var(--color-danger)]",
              tone === "info" && "text-[color:var(--color-info)]",
            )} />
            <div>
              <div className="text-lg font-bold tabular-nums">{value}</div>
              <div className="text-xs text-[color:var(--color-muted-foreground)]">{label}</div>
            </div>
          </div>
        ))}
      </div>

      <ConfidenceGateBar />

      {fetchFailed && (
        <div className="mb-4 rounded-md border border-[color:var(--color-warning)] bg-[color:var(--color-warning-bg)] px-4 py-2 text-xs text-[color:var(--color-warning)]">
          API 연결 실패 — 목 데이터를 표시합니다.
        </div>
      )}
      {actionError && (
        <div className="mb-4 rounded-md border border-[color:var(--color-danger)] bg-[color:var(--color-danger-bg)] px-4 py-2 text-xs text-[color:var(--color-danger)]">
          {actionError}
        </div>
      )}

      {apiEmpty && !fetchFailed && (
        <div className="mb-4 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-muted)]/50 px-4 py-3 text-sm text-[color:var(--color-muted-foreground)]">
          시드 데이터에 검토 대기 항목이 없습니다.{" "}
          <Link href="/admin/seed" className="text-[color:var(--color-brand-ink)] hover:underline font-medium">
            /admin/seed에서 데이터를 초기화하세요.
          </Link>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 gap-3 text-[color:var(--color-muted-foreground)]">
          <span className="size-5 rounded-full border-2 border-[color:var(--color-brand-ink)] border-t-transparent animate-spin" />
          <span className="text-sm">로딩 중...</span>
        </div>
      ) : allDone ? (
        <div className="rounded-xl border border-[color:var(--color-success)] bg-[color:var(--color-success-bg)] px-6 py-10 text-center">
          <UserCheck className="size-10 mx-auto mb-3 text-[color:var(--color-success)]" />
          <p className="text-lg font-semibold text-[color:var(--color-success)]">모든 판단이 처리되었습니다</p>
          <p className="text-sm text-[color:var(--color-muted-foreground)] mt-1">새로운 Agent 판단이 도착하면 이곳에 표시됩니다.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((item) =>
            item.type === "mdm" ? (
              <MdmCard
                key={item.id}
                item={item}
                onApprove={(id, type) => handleAction(id, type, "approve")}
                onReject={(id, type) => handleAction(id, type, "reject")}
              />
            ) : (
              <MessageCard
                key={item.id}
                item={item}
                onApprove={(id, type) => handleAction(id, type, "approve")}
                onReject={(id, type) => handleAction(id, type, "reject")}
              />
            ),
          )}
        </div>
      )}
    </>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function HitlPage() {
  return (
    <AppShell>
      <PageHeader
        eyebrow="Sales Agent · Human-in-the-Loop"
        title="HITL 승인 게이트"
        description="신뢰도 0.7~0.92 구간의 Agent 판단은 매니저 검토 후 실행됩니다. 자동 실행(0.92+), 검토 필요(0.7~0.92), 사람 직접 판단(<0.7) 3단계 게이트."
        breadcrumbs={[
          { href: "/", label: "홈" },
          { href: "/agent", label: "Agent 대시보드" },
          { label: "HITL 승인 게이트" },
        ]}
      />
      <HitlQueue />
    </AppShell>
  );
}
