import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  yaml: z.string(),
});

interface ExplainResult {
  summary: string;
  conditions: string[];
  outputs: string[];
  risks: string[];
  suggestion: string;
}

const FALLBACK: ExplainResult = {
  summary: "YAML 룰을 분석할 수 없습니다.",
  conditions: ["YAML 내용을 확인하세요."],
  outputs: [],
  risks: ["AI 분석 서비스에 연결할 수 없습니다."],
  suggestion: "나중에 다시 시도하세요.",
};

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

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return NextResponse.json(FALLBACK);

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "당신은 비즈니스 룰 엔진 전문가입니다. YAML 룰을 분석하여 한국어로 쉽게 설명합니다.",
          },
          {
            role: "user",
            content: `다음 YAML 룰을 분석하여 JSON으로 응답하세요: {"summary": "한 줄 요약", "conditions": ["조건1", "조건2", ...], "outputs": ["결과1", ...], "risks": ["주의사항"], "suggestion": "개선 제안"}\n\n${body.yaml}`,
          },
        ],
      }),
    });

    if (!response.ok) return NextResponse.json(FALLBACK);

    const json = await response.json();
    const content = json.choices?.[0]?.message?.content;
    if (!content) return NextResponse.json(FALLBACK);

    const parsed: ExplainResult = JSON.parse(content);
    return NextResponse.json(parsed);
  } catch {
    return NextResponse.json(FALLBACK);
  }
}
