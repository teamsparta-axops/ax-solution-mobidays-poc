"use client";

import { useState } from "react";
import { GitMerge, Scissors } from "lucide-react";

export function MdmActions({ candidateId }: { candidateId: string }) {
  const [done, setDone] = useState<"approved" | "rejected" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleAction(action: "approve" | "reject") {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/hitl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: candidateId, type: "mdm", action }),
      });
      if (!res.ok) {
        throw new Error(`서버 오류 (${res.status})`);
      }
      setDone(action === "approve" ? "approved" : "rejected");
    } catch (e) {
      setError(e instanceof Error ? e.message : "처리 실패");
    } finally {
      setLoading(false);
    }
  }

  if (done === "approved") {
    return (
      <div className="flex items-center gap-2 text-xs text-[color:var(--color-success)] font-medium">
        ✓ 병합 승인됨
      </div>
    );
  }
  if (done === "rejected") {
    return (
      <div className="flex items-center gap-2 text-xs text-[color:var(--color-danger)] font-medium">
        ✕ 반려됨
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <button
          disabled={loading}
          onClick={() => handleAction("approve")}
          className="inline-flex items-center gap-1 text-xs bg-[color:var(--color-brand-ink)] text-white px-3 h-8 rounded-md hover:bg-[color:var(--color-brand-ink-2)] disabled:opacity-50"
        >
          <GitMerge className="size-3" /> 병합 승인
        </button>
        <button
          disabled={loading}
          onClick={() => handleAction("reject")}
          className="inline-flex items-center gap-1 text-xs border border-[color:var(--color-border)] px-3 h-8 rounded-md hover:bg-[color:var(--color-muted)] disabled:opacity-50"
        >
          <Scissors className="size-3" /> 반려
        </button>
      </div>
      {error && (
        <div className="text-xs text-[color:var(--color-danger)]">{error}</div>
      )}
    </div>
  );
}
