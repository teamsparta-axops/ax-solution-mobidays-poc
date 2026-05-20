import { NextResponse } from "next/server";
import { z } from "zod";
import { nanoid } from "nanoid";

import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  cmid: z.string().min(1),
  title: z.string().default("미팅록"),
  redacted: z.string().min(1),
  occurredAt: z.string().nullable().optional(),
  topics: z.array(z.string()).default([]),
  chunks: z.array(
    z.object({
      ordinal: z.number(),
      text: z.string(),
      topics: z.array(z.string()).default([]),
      sectionPath: z.string().default(""),
    }),
  ),
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

  const docId = `doc_${nanoid(12)}`;
  const activityId = `act_${nanoid(12)}`;

  try {
    await prisma.$transaction(async (tx) => {
      // Create Document
      await tx.document.create({
        data: {
          id: docId,
          cmid: body.cmid,
          sourceType: "meeting_note",
          title: body.title,
          body: body.redacted,
          bodyRedacted: body.redacted,
          language: "ko",
        },
      });

      // Create DocChunks
      if (body.chunks.length > 0) {
        await tx.docChunk.createMany({
          data: body.chunks.map((c) => ({
            id: `chunk_${nanoid(12)}`,
            documentId: docId,
            ordinal: c.ordinal,
            text: c.text,
            topicsJson: JSON.stringify(c.topics),
            metadataJson: JSON.stringify({ sectionPath: c.sectionPath }),
          })),
        });
      }

      // Create Activity
      await tx.activity.create({
        data: {
          id: activityId,
          cmid: body.cmid,
          type: "Meeting",
          subject: body.title,
          body: body.redacted,
          topicsJson: JSON.stringify(body.topics),
          occurredAt: body.occurredAt ? new Date(body.occurredAt) : new Date(),
          piiRedacted: true,
          sourceSystem: "extract_pipeline",
        },
      });
    });

    return NextResponse.json({
      ok: true,
      docId,
      activityId,
      chunkCount: body.chunks.length,
    });
  } catch (e: unknown) {
    console.error("[extract/save]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "저장 실패" },
      { status: 500 },
    );
  }
}
