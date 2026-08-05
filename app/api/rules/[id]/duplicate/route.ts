import { NextRequest, NextResponse } from "next/server";
import { duplicateRule } from "@/lib/db/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const rule = await duplicateRule(Number(id));
    if (!rule) return NextResponse.json({ ok: false, error: "规则不存在" }, { status: 404 });
    return NextResponse.json({ ok: true, data: rule });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
