import { NextRequest, NextResponse } from "next/server";
import { pump } from "@/lib/v4/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 手动/常驻 Worker 推进入口：scripts/worker.mjs 循环调用 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const maxMs = Math.min(30000, Number(body?.max_ms) || 8000);
    const result = await pump(maxMs);
    return NextResponse.json({ ok: true, data: result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
