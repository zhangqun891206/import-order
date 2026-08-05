import { NextRequest, NextResponse } from "next/server";
import { getWaybillDetail } from "@/lib/db/waybills";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const data = await getWaybillDetail(Number(id));
    if (!data) return NextResponse.json({ ok: false, error: "运单不存在" }, { status: 404 });
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
