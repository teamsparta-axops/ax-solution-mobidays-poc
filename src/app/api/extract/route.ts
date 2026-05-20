import { z } from "zod";

import { semanticChunk } from "@/lib/extract/chunk";
import { extractMeetingMock, type MeetingExtraction } from "@/lib/extract/extract-mock";
import { redactPII } from "@/lib/extract/pii";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  text: z.string().min(20, "최소 20자 이상의 텍스트가 필요합니다"),
});

function preClean(s: string): string {
  return s
    .replace(/\r\n/g, "\n")
    .replace(/^- ?\d+ ?-$/gm, "")
    .replace(/ /g, " ")
    .trim();
}

function linkEntities(attendees: { name: string; party: string; companyName?: string }[]) {
  const KNOWN: Record<string, string> = {
    삼성전자: "mb_acc_samsung",
    "삼성 전자": "mb_acc_samsung",
    삼성: "mb_acc_samsung",
    Samsung: "mb_acc_samsung",
    네오플라잇: "mb_acc_neoflight",
    NeoFlight: "mb_acc_neoflight",
    현대자동차: "mb_acc_hyundai",
    현대: "mb_acc_hyundai",
    Hyundai: "mb_acc_hyundai",
    토스: "mb_acc_toss",
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
    links.push({ name: a.name, party: a.party, cmid, companyName: a.companyName, matched: Boolean(cmid) });
  }
  return links;
}

function computeSalesIntel(fields: MeetingExtraction) {
  const budgetTotal = fields.budgetSignals.reduce((s, b) => s + b.amountKrw, 0);
  const hasBudget = budgetTotal > 0;
  const positiveTopics = fields.topics.filter((t) => t.sentiment === "positive").length;
  const negativeTopics = fields.topics.filter((t) => t.sentiment === "negative").length;
  const buyingReadiness = Math.min(
    100,
    Math.round(
      (hasBudget ? 30 : 0) +
        positiveTopics * 10 +
        fields.actionItems.filter((a) => a.ownerParty === "client").length * 15 +
        (fields.nextMeeting ? 20 : 0),
    ),
  );
  const sentiment =
    negativeTopics > positiveTopics ? "negative" : positiveTopics > 1 ? "positive" : "neutral";
  const signals: string[] = [];
  if (hasBudget) signals.push(`예산 시그널 ${(budgetTotal / 1e8).toFixed(0)}억원`);
  if (fields.nextMeeting) signals.push("다음 미팅 확정");
  if (fields.competitorsMentioned.length)
    signals.push(`경쟁사 언급: ${fields.competitorsMentioned.join(", ")}`);
  if (fields.riskFlags.length) signals.push(`리스크: ${fields.riskFlags[0]}`);
  return { buyingReadiness, sentiment, signals, budgetTotal };
}

export async function POST(req: Request) {
  let text: string;
  try {
    const parsed = BodySchema.parse(await req.json());
    text = parsed.text;
  } catch (e: unknown) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "잘못된 요청" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: string, data: object) =>
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );

      try {
        emit("step", { step: "parse", status: "running", label: "텍스트 정제 중..." });
        const cleaned = preClean(text);
        emit("step", {
          step: "parse",
          status: "done",
          label: "텍스트 정제",
          charCount: cleaned.length,
        });

        emit("step", { step: "pii", status: "running", label: "PII 감지·마스킹 중..." });
        const pii = redactPII(cleaned);
        emit("step", {
          step: "pii",
          status: "done",
          label: "PII 마스킹",
          hitsCount: pii.hits.length,
          hits: pii.hits,
        });

        if (pii.redacted.trim().length < 10) {
          emit("error", { message: "PII 마스킹 후 텍스트가 너무 짧습니다" });
          controller.close();
          return;
        }

        emit("step", { step: "extract", status: "running", label: "GPT-4o 구조화 추출 중..." });
        const fields = await extractMeetingMock(pii.redacted);
        emit("step", {
          step: "extract",
          status: "done",
          label: "구조화 추출",
          attendeeCount: fields.attendees.length,
          topicCount: fields.topics.length,
        });

        emit("step", { step: "entity_link", status: "running", label: "엔티티 링킹 중..." });
        const linked = linkEntities(fields.attendees);
        emit("step", {
          step: "entity_link",
          status: "done",
          label: "엔티티 링킹",
          matchedCount: linked.filter((l) => l.matched).length,
        });

        emit("step", { step: "chunk", status: "running", label: "시맨틱 청킹 중..." });
        const chunks = semanticChunk(
          pii.redacted,
          fields.topics.map((t) => t.label),
        );
        emit("step", {
          step: "chunk",
          status: "done",
          label: "청킹 완료",
          chunkCount: chunks.length,
        });

        emit("step", {
          step: "embed",
          status: "running",
          label: "text-embedding-3-small 임베딩 중...",
        });
        const embeddingMeta = {
          model: "text-embedding-3-small",
          dim: 1536,
          chunkCount: chunks.length,
          batches: Math.ceil(chunks.length / 8),
        };
        await new Promise((r) => setTimeout(r, 400));
        emit("step", { step: "embed", status: "done", label: "임베딩 완료", ...embeddingMeta });

        emit("step", {
          step: "sales_intel",
          status: "running",
          label: "Sales 인텔리전스 분석 중...",
        });
        const salesIntel = computeSalesIntel(fields);
        emit("step", {
          step: "sales_intel",
          status: "done",
          label: "Sales 인텔리전스",
          ...salesIntel,
        });

        emit("complete", {
          cleaned,
          piiHits: pii.hits,
          redacted: pii.redacted,
          fields,
          linkedEntities: linked,
          chunks,
          embedding: embeddingMeta,
          salesIntel,
          timings: { total: Date.now() },
        });
      } catch (e) {
        emit("error", { message: e instanceof Error ? e.message : "처리 오류" });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
