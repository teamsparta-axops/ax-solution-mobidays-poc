import { NextResponse } from "next/server";
import { z } from "zod";

import { semanticChunk } from "@/lib/extract/chunk";
import { extractMeetingMock } from "@/lib/extract/extract-mock";
import { redactPII } from "@/lib/extract/pii";
import { delay } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  text: z.string().min(20, "최소 20자 이상의 텍스트가 필요합니다"),
});

export async function POST(req: Request) {
  let text: string;
  try {
    const parsed = BodySchema.parse(await req.json());
    text = parsed.text;
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "잘못된 요청" },
      { status: 400 },
    );
  }

  // Step timings for the demo (simulate realistic latencies).
  const t0 = Date.now();
  const stage1End = await delayStep(60);
  const cleaned = preClean(text);
  const stage2End = Date.now();

  await delay(150);
  const pii = redactPII(cleaned);
  const stage3End = Date.now();

  if (pii.redacted.trim().length < 10) {
    return NextResponse.json({ error: "PII 마스킹 후 텍스트가 너무 짧습니다" }, { status: 400 });
  }

  await delay(50);
  const fields = await extractMeetingMock(pii.redacted);
  const stage4End = Date.now();

  await delay(80);
  // Entity linking stub — match by detectedCompany name in attendees
  const linked = linkEntities(fields.attendees);
  const stage5End = Date.now();

  await delay(60);
  const chunks = semanticChunk(pii.redacted, fields.topics.map((t) => t.label));
  const stage6End = Date.now();

  await delay(180); // embed
  const embeddingMeta = {
    model: "voyage-multilingual-2",
    dim: 1024,
    chunkCount: chunks.length,
    batches: Math.ceil(chunks.length / 8),
  };
  const stage7End = Date.now();

  await delay(50); // index
  const stage8End = Date.now();

  return NextResponse.json({
    timings: {
      parse: stage1End - t0,
      pii: stage3End - stage2End,
      extract: stage4End - stage3End,
      entityLink: stage5End - stage4End,
      chunk: stage6End - stage5End,
      embed: stage7End - stage6End,
      index: stage8End - stage7End,
      total: stage8End - t0,
    },
    cleaned,
    piiHits: pii.hits,
    redacted: pii.redacted,
    fields,
    linkedEntities: linked,
    chunks,
    embedding: embeddingMeta,
  });
}

async function delayStep(ms: number) {
  await delay(ms);
  return Date.now();
}

function preClean(s: string): string {
  // Trim trailing whitespace, strip page numbers like "- 1 -"
  return s
    .replace(/\r\n/g, "\n")
    .replace(/^- ?\d+ ?-$/gm, "")
    .replace(/ /g, " ")
    .trim();
}

function linkEntities(attendees: { name: string; party: string; companyName?: string }[]) {
  // Mock entity linking — map each attendee party=client to its likely CMID by name keyword.
  const KNOWN: Record<string, string> = {
    삼성전자: "mb_acc_samsung",
    "삼성 전자": "mb_acc_samsung",
    삼성: "mb_acc_samsung",
    Samsung: "mb_acc_samsung",
    "네오플라잇": "mb_acc_neoflight",
    NeoFlight: "mb_acc_neoflight",
    "현대자동차": "mb_acc_hyundai",
    "현대": "mb_acc_hyundai",
    Hyundai: "mb_acc_hyundai",
    "토스": "mb_acc_toss",
    Toss: "mb_acc_toss",
  };
  const links: { name: string; party: string; cmid?: string; companyName?: string; matched: boolean }[] = [];
  for (const a of attendees) {
    let cmid: string | undefined;
    if (a.companyName) {
      for (const k of Object.keys(KNOWN)) {
        if (a.companyName.includes(k)) {
          cmid = KNOWN[k];
          break;
        }
      }
    }
    links.push({
      name: a.name,
      party: a.party,
      cmid,
      companyName: a.companyName,
      matched: Boolean(cmid),
    });
  }
  return links;
}
