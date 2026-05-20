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
  variants: z.number().optional(),
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

  // Fetch recent activities (up to 5) for rich context
  const recentActivities = await prisma.activity.findMany({
    where: { cmid: body.cmid },
    orderBy: { occurredAt: "desc" },
    take: 5,
    select: { type: true, subject: true, bodySummary: true, occurredAt: true, topicsJson: true },
  });

  // Fetch latest relationship score
  const relScoreRow = await prisma.relationshipScore.findFirst({
    where: { cmid: body.cmid },
    orderBy: { snapshotAt: "desc" },
    select: { score: true, factorsJson: true },
  });
  const relationshipScore = relScoreRow?.score !== undefined ? relScoreRow.score : undefined;

  const baseInput = {
    purpose: body.purpose,
    accountName: account.canonicalName,
    contactName: primaryContact?.fullName,
    contactTitle: primaryContact?.title ?? undefined,
    topics: mergedTopics,
    sessionTitle,
    personalTouch: lastActivity?.bodySummary ?? undefined,
    recentActivities: recentActivities.map((a) => ({
      type: a.type,
      subject: a.subject ?? undefined,
      bodySummary: a.bodySummary ?? undefined,
      occurredAt: a.occurredAt,
    })),
    relationshipScore,
  };

  // Always generate 2 variants: formal + friendly
  const [v1, v2] = await Promise.all([
    draftMessage({ ...baseInput, tone: "formal" }),
    draftMessage({ ...baseInput, tone: "friendly" }),
  ]);

  const contactEmail = primaryContact?.email ?? null;

  function buildHref(subject: string, bodyText: string): string | undefined {
    if (!contactEmail) return undefined;
    return (
      "mailto:" +
      encodeURIComponent(contactEmail) +
      "?subject=" +
      encodeURIComponent(subject) +
      "&body=" +
      encodeURIComponent(bodyText)
    );
  }

  const variables = {
    accountName: account.canonicalName,
    contactName: primaryContact?.fullName ?? "",
    contactTitle: primaryContact?.title ?? "",
    lastActivitySubject: lastActivity?.subject ?? "",
    marketingBudgetKrw: account.marketingBudgetKrw?.toString() ?? "",
    leadStage: account.leadStage ?? "",
    channel: body.channel ?? "email",
    relationshipScore: relationshipScore?.toString() ?? "",
    ...v1.variables,
  };

  // Merge evidence from both variants (deduplicated by text)
  const evidenceMap = new Map<string, { type: string; text: string }>();
  for (const e of [...v1.evidence, ...v2.evidence]) {
    if (!evidenceMap.has(e.text)) evidenceMap.set(e.text, e);
  }
  const evidence = Array.from(evidenceMap.values());

  return NextResponse.json({
    variants: [
      {
        tone: "formal",
        subject: v1.subject,
        body: v1.body,
        gmailHref: buildHref(v1.subject, v1.body),
      },
      {
        tone: "friendly",
        subject: v2.subject,
        body: v2.body,
        gmailHref: buildHref(v2.subject, v2.body),
      },
    ],
    variables,
    evidence,
    contactEmail,
  });
}
