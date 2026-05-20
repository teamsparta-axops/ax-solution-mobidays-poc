import { getOpenAI } from "@/lib/openai";

export async function embedText(text: string): Promise<number[]> {
  const res = await getOpenAI().embeddings.create({
    model: "text-embedding-3-small",
    input: text.slice(0, 8000),
  });
  if (!res.data || res.data.length === 0) throw new Error("OpenAI returned empty embedding");
  return res.data[0].embedding;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-8);
}

export async function ensureChunkEmbedding(
  chunkId: string,
  text: string,
  existingJson: string | null,
  prisma: import("@prisma/client").PrismaClient,
): Promise<number[]> {
  if (existingJson) {
    try { return JSON.parse(existingJson) as number[]; } catch {}
  }
  const vec = await embedText(text);
  await prisma.docChunk.update({
    where: { id: chunkId },
    data: { embeddingJson: JSON.stringify(vec) },
  });
  return vec;
}
