import { NextRequest, NextResponse } from "next/server";
import { submitOrder, listWaybills } from "@/lib/db/waybills";
import { submitOrderSchema, waybillQuerySchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const q = waybillQuerySchema.parse({
      externalCode: sp.get("externalCode") || undefined,
      receiverName: sp.get("receiverName") || undefined,
      startDate: sp.get("startDate") || undefined,
      endDate: sp.get("endDate") || undefined,
      page: sp.get("page") || 1,
      pageSize: sp.get("pageSize") || 20,
    });
    const data = await listWaybills(q);
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = submitOrderSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.issues[0]?.message || "提交数据校验失败" },
        { status: 400 }
      );
    }
    const result = await submitOrder(parsed.data);
    return NextResponse.json({ ok: true, data: result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
