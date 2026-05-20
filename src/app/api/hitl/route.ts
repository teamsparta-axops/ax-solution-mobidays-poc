export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { randomUUID } from "crypto";

export async function GET() {
  const [mdmPending, messagePending, autoApproved, rejectedCount] =
    await Promise.all([
      prisma.mdmCandidate.findMany({ where: { status: "pending" } }),
      prisma.message.findMany({ where: { status: "PendingApproval" } }),
      prisma.mdmCandidate.count({ where: { status: "merged" } }),
      prisma.mdmCandidate.count({ where: { status: "rejected" } }),
    ]);

  const mdmCandidates = mdmPending.map((c) => {
    const rightRef: Record<string, unknown> = (() => {
      try { return JSON.parse(c.rightRefJson); } catch { return {}; }
    })();
    const features: Record<string, unknown> = (() => {
      try { return JSON.parse(c.featuresJson); } catch { return {}; }
    })();
    return {
      id: c.id,
      type: "mdm" as const,
      confidence: c.score,
      accountName: String(rightRef.name ?? ""),
      description: `엔티티 병합 후보: ${c.leftCmid ?? "??"} ↔ ${String(rightRef.name ?? "?")}`,
      features,
      createdAt: c.createdAt.toISOString(),
    };
  });

  const messageItems = messagePending.map((m) => ({
    id: m.id,
    type: "message" as const,
    cmid: m.cmid,
    accountName: null as string | null,
    purpose: m.purpose,
    subject: m.subject,
    body: m.body.slice(0, 200),
    createdAt: m.createdAt.toISOString(),
  }));

  // Enrich message items with account names
  const cmids = [...new Set(messageItems.map((m) => m.cmid))];
  if (cmids.length > 0) {
    const accounts = await prisma.account.findMany({
      where: { cmid: { in: cmids } },
      select: { cmid: true, canonicalName: true },
    });
    const nameMap = Object.fromEntries(accounts.map((a) => [a.cmid, a.canonicalName]));
    for (const item of messageItems) {
      item.accountName = nameMap[item.cmid] ?? null;
    }
  }

  return NextResponse.json({
    mdmCandidates,
    messagePending: messageItems,
    stats: {
      autoApproved,
      pendingCount: mdmPending.length + messagePending.length,
      rejectedCount,
    },
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { id, type, action, decidedBy } = body as {
    id: string;
    type: "mdm" | "message";
    action: "approve" | "reject";
    decidedBy?: string;
  };

  if (!id || !type || !action) {
    return NextResponse.json({ error: "id, type, action required" }, { status: 400 });
  }

  const actor = decidedBy ?? "system";

  if (type === "mdm") {
    await prisma.mdmCandidate.update({
      where: { id },
      data: {
        status: action === "approve" ? "merged" : "rejected",
        decidedBy: actor,
        decidedAt: new Date(),
      },
    });
  } else {
    await prisma.message.update({
      where: { id },
      data: {
        status: action === "approve" ? "Approved" : "Rejected",
        approvedBy: actor,
        approvedAt: new Date(),
      },
    });
  }

  await prisma.auditLog.create({
    data: {
      id: randomUUID(),
      actor,
      action: action === "approve" ? "HITL_APPROVE" : "HITL_REJECT",
      resourceType: type === "mdm" ? "MdmCandidate" : "Message",
      resourceId: id,
      at: new Date(),
    },
  });

  return NextResponse.json({ ok: true });
}
