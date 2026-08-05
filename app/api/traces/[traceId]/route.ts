import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ traceId: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { traceId } = await ctx.params;
  try {
    const events = (await db.query(
      `SELECT trace_id,task_id,unit_id,event_name,event_status,message,occurred_at FROM trace_events WHERE trace_id=$1 ORDER BY occurred_at, id`,
      [traceId]
    )) as Record<string, unknown>[];
    return NextResponse.json({ ok: true, data: { trace_id: traceId, events } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
