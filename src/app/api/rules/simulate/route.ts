import { z } from "zod";

import { prisma } from "@/lib/db";
import { runRule } from "@/lib/rules/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  ruleId: z.string().optional(),
  yaml: z.string().optional(),
  industryFilter: z.string().optional(),
  limit: z.number().default(40),
});

export async function POST(req: Request) {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "잘못된 요청" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  let yamlText: string | undefined = body.yaml;
  if (!yamlText && body.ruleId) {
    const r = await prisma.ruleDefinition.findUnique({ where: { id: body.ruleId } });
    if (!r)
      return new Response(JSON.stringify({ error: "rule not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    yamlText = r.yaml;
  }
  if (!yamlText) {
    return new Response(
      JSON.stringify({ error: "yaml 또는 ruleId 중 하나가 필요합니다" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const accounts = await prisma.account.findMany({
    where: body.industryFilter ? { industryLabel: body.industryFilter } : undefined,
    take: body.limit,
    select: {
      cmid: true,
      canonicalName: true,
      customerTier: true,
      industryLabel: true,
    },
  });

  const capturedYaml = yamlText;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (data: object) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

      let processed = 0;
      const distribution: Record<string, number> = {};
      const changes: unknown[] = [];

      emit({ type: "start", total: accounts.length });

      for (const a of accounts) {
        const r = await runRule(capturedYaml, { cmid: a.cmid }, { trigger: "simulate", dryRun: true });
        processed++;
        const newTier =
          (r.decision as Record<string, unknown> | null)?.customer_tier as string | null ?? null;
        const tierKey = newTier ?? "변화없음";
        distribution[tierKey] = (distribution[tierKey] ?? 0) + 1;
        const changed = Boolean(newTier && newTier !== a.customerTier);
        if (changed)
          changes.push({
            cmid: a.cmid,
            name: a.canonicalName,
            industry: a.industryLabel,
            from: a.customerTier,
            to: newTier,
            latencyMs: r.latencyMs,
          });

        emit({
          type: "progress",
          processed,
          total: accounts.length,
          cmid: a.cmid,
          name: a.canonicalName,
          decision: r.decision,
          latencyMs: r.latencyMs,
          changed,
        });
      }

      emit({ type: "complete", total: accounts.length, distribution, changes });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
}
