// POST — save a Message draft to DB
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { nanoid } from "nanoid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  cmid: z.string(),
  purpose: z.enum(["Invitation", "Proposal", "Reminder", "FollowUp", "PostEvent"]),
  channel: z.string().default("Email"),
  subject: z.string(),
  body: z.string(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  const d = parsed.data;
  const msg = await prisma.message.create({
    data: { id: nanoid(), cmid: d.cmid, purpose: d.purpose, channel: d.channel, subject: d.subject, body: d.body, status: "Draft" },
  });
  return NextResponse.json({ id: msg.id });
}
