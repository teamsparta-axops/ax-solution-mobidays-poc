import { NextResponse } from "next/server";
import { z } from "zod";

import { draftMessage } from "@/lib/agent/message";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  cmid: z.string(),
  purpose: z.enum(["Invitation", "Proposal", "Reminder", "FollowUp", "PostEvent"]),
  channel: z.enum(["email", "kakao", "sms"]).optional(),
  tone: z.enum(["formal", "friendly", "concise"]).default("formal"),
  sessionId: z.string().optional(),
});

export async function POST(req: Request) {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "잘못된 요청" },
      { status: 400 },
    );
  }

  const account = await prisma.account.findUnique({
    where: { cmid: body.cmid },
    include: {
      contacts: { where: { isPrimary: true }, take: 1 },
      activities: { orderBy: { occurredAt: "desc" }, take: 1 },
    },
  });
  if (!account) {
    return NextResponse.json({ error: "광고주를 찾을 수 없습니다" }, { status: 404 });
  }

  let sessionTitle: string | undefined;
  if (body.sessionId) {
    const s = await prisma.session.findUnique({ where: { id: body.sessionId } });
    if (s) sessionTitle = s.title;
  }

  const primaryContact = account.contacts[0];
  const lastActivity = account.activities[0];

  // Fetch DocChunks from account's documents for topic enrichment
  const docChunks = await prisma.docChunk.findMany({
    where: { document: { cmid: body.cmid } },
    take: 10,
    orderBy: { ordinal: "asc" },
    select: { text: true, topicsJson: true },
  });
  // Extract unique topics from chunks
  const chunkTopics = [...new Set(
    docChunks.flatMap(c => {
      if (!c.topicsJson) return [];
      try { return JSON.parse(c.topicsJson) as string[]; } catch { return []; }
    })
  )].slice(0, 5);

  const activityTopics: string[] = lastActivity
    ? (JSON.parse(lastActivity.topicsJson) as string[])
    : [];
  const mergedTopics = [...new Set([...activityTopics, ...chunkTopics])];

  const draft = await draftMessage({
    purpose: body.purpose,
    accountName: account.canonicalName,
    contactName: primaryContact?.fullName,
    contactTitle: primaryContact?.title ?? undefined,
    tone: body.tone,
    topics: mergedTopics,
    sessionTitle,
    personalTouch: lastActivity?.bodySummary ?? undefined,
  });

  const contactEmail = primaryContact?.email ?? null;
  const gmailHref = contactEmail
    ? "mailto:" + encodeURIComponent(contactEmail) + "?subject=" + encodeURIComponent(draft.subject) + "&body=" + encodeURIComponent(draft.body)
    : undefined;

  return NextResponse.json({
    subject: draft.subject,
    body: draft.body,
    variables: {
      accountName: account.canonicalName,
      contactName: primaryContact?.fullName ?? "",
      contactTitle: primaryContact?.title ?? "",
      lastActivitySubject: lastActivity?.subject ?? "",
      marketingBudgetKrw: account.marketingBudgetKrw?.toString() ?? "",
      leadStage: account.leadStage ?? "",
      channel: body.channel ?? "email",
      ...draft.variables,
    },
    evidence: draft.evidence,
    gmailHref,
    contactEmail,
  });
}
