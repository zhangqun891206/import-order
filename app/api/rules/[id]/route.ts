import { NextRequest, NextResponse } from "next/server";
import { getRule, updateRule, deleteRule } from "@/lib/db/rules";
import { updateRuleSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const rule = await getRule(Number(id));
  if (!rule) return NextResponse.json({ ok: false, error: "规则不存在" }, { status: 404 });
  return NextResponse.json({ ok: true, data: rule });
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = await req.json();
  const parsed = updateRuleSchema.safeParse({ ...body, id: Number(id) });
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message || "参数校验失败" }, { status: 400 });
  }
  const rule = await updateRule(Number(id), {
    name: parsed.data.name,
    description: parsed.data.description,
    fileType: parsed.data.fileType,
    spec: parsed.data.spec,
    fieldMeta: parsed.data.fieldMeta,
    source: parsed.data.source,
  });
  if (!rule) return NextResponse.json({ ok: false, error: "规则不存在" }, { status: 404 });
  return NextResponse.json({ ok: true, data: rule });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const ok = await deleteRule(Number(id));
  if (!ok) return NextResponse.json({ ok: false, error: "规则不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
