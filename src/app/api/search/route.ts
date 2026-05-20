export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { embedText, cosineSimilarity, ensureChunkEmbedding } from "@/lib/search/embed";

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s가-힣]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function bm25Score(
  queryTokens: string[],
  docTokens: string[],
  avgDocLen: number,
  k1 = 1.5,
  b = 0.75,
): number {
  const docLen = docTokens.length;
  const termFreq: Record<string, number> = {};
  for (const t of docTokens) termFreq[t] = (termFreq[t] ?? 0) + 1;

  let score = 0;
  for (const qt of queryTokens) {
    const tf = termFreq[qt] ?? 0;
    if (tf === 0) continue;
    const idf = Math.log(1 + 50 / (tf + 0.5));
    const tfNorm =
      (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docLen / avgDocLen)));
    score += idf * tfNorm;
  }
  return score;
}

type ChunkWithDoc = Awaited<ReturnType<typeof prisma.docChunk.findMany>>[number] & {
  document: { title: string; sourceType: string; cmid: string | null };
};

function bm25Search(chunks: ChunkWithDoc[], q: string) {
  const queryTokens = tokenize(q);
  const docLengths = chunks.map((c) => tokenize(c.text).length);
  const avgDocLen = docLengths.length
    ? docLengths.reduce((a, b) => a + b, 0) / docLengths.length
    : 1;

  return chunks
    .map((chunk) => {
      const docTokens = tokenize(chunk.text);
      const score = bm25Score(queryTokens, docTokens, avgDocLen);
      return { chunk, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

export async function POST(req: Request) {
  let q = "";
  try {
    const body = await req.json();
    q = body.q ?? "";
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (q.length < 2) {
    return NextResponse.json({ error: "q must be at least 2 characters" }, { status: 400 });
  }

  const chunks = await prisma.docChunk.findMany({
    include: {
      document: {
        select: {
          title: true,
          sourceType: true,
          cmid: true,
        },
      },
    },
  });

  const totalChunks = chunks.length;
  const queryTokens = q.split(/\s+/).length;

  let scored: { chunk: ChunkWithDoc; score: number }[];
  let method: string;

  try {
    const queryVec = await embedText(q);

    const withScores = await Promise.all(
      chunks.map(async (chunk) => {
        const vec = await ensureChunkEmbedding(
          chunk.id,
          chunk.text,
          chunk.embeddingJson,
          prisma,
        );
        const score = cosineSimilarity(queryVec, vec);
        return { chunk: chunk as ChunkWithDoc, score };
      }),
    );

    scored = withScores
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    method = "openai-embedding-3-small";
  } catch {
    // Fallback to BM25
    scored = bm25Search(chunks as ChunkWithDoc[], q);
    method = "bm25-fallback";
  }

  const results = scored.map(({ chunk, score }) => {
    const topics: string[] = (() => {
      try { return JSON.parse(chunk.topicsJson); } catch { return []; }
    })();
    return {
      chunkId: chunk.id,
      documentTitle: chunk.document.title,
      sourceType: chunk.document.sourceType,
      cmid: chunk.document.cmid ?? null,
      score: Math.round(score * 10000) / 10000,
      highlight: chunk.text.slice(0, 200),
      topics,
    };
  });

  return NextResponse.json({ results, totalChunks, queryTokens, method });
}

// Keep GET for backwards-compat (redirects to POST behaviour via query param)
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const fakeReq = new Request(req.url, {
    method: "POST",
    body: JSON.stringify({ q }),
    headers: { "content-type": "application/json" },
  });
  return POST(fakeReq);
}
