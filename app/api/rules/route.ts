import { NextRequest, NextResponse } from "next/server";
import { listRules, createRule } from "@/lib/db/rules";
import { createRuleSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rules = await listRules();
    return NextResponse.json({ ok: true, data: rules });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = createRuleSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message || "参数校验失败" }, { status: 400 });
    }
    const rule = await createRule({
      name: parsed.data.name,
      description: parsed.data.description,
      fileType: parsed.data.fileType,
      spec: parsed.data.spec,
      fieldMeta: parsed.data.fieldMeta,
      source: parsed.data.source,
    });
    return NextResponse.json({ ok: true, data: rule });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
