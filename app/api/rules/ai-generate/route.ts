import { NextRequest, NextResponse } from "next/server";
import { chatCompletion, extractJson, DeepSeekError } from "@/lib/ai/deepseek";
import { buildAiGenerateMessages } from "@/lib/ai/prompt";
import type { ParseRule } from "@/lib/engine/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const summary: string = typeof body?.summary === "string" ? body.summary : "";
    if (!summary.trim()) {
      return NextResponse.json({ ok: false, error: "缺少文件结构摘要" }, { status: 400 });
    }

    const messages = buildAiGenerateMessages(summary);
    let content: string;
    try {
      content = await chatCompletion(messages, { temperature: 0.2, maxTokens: 4096, timeoutMs: 60_000 });
    } catch (e) {
      if (e instanceof DeepSeekError) {
        return NextResponse.json({ ok: false, error: e.message }, { status: 502 });
      }
      throw e;
    }

    const rule = extractJson<Partial<ParseRule>>(content);
    if (!rule || typeof rule !== "object" || !rule.spec || !("layout" in (rule.spec as object))) {
      return NextResponse.json({ ok: false, error: "AI 返回的规则缺少 spec.layout，请重试或手动配置" }, { status: 502 });
    }

    return NextResponse.json({
      ok: true,
      data: {
        name: rule.name || "AI 生成规则",
        description: rule.description,
        fileType: rule.fileType || "auto",
        spec: rule.spec,
        fieldMeta: rule.fieldMeta || {},
        source: "ai",
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
