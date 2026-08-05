import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const sp = req.nextUrl.searchParams;
  const batch = sp.get("batch");
  const code = sp.get("error_code");
  const page = Math.max(1, Number(sp.get("page") || 1));
  const pageSize = Math.min(200, Math.max(1, Number(sp.get("page_size") || 50)));

  const where: string[] = ["task_id=$1"];
  const params: unknown[] = [id];
  if (batch) { params.push(Number(batch)); where.push(`batch_index=$${params.length}`); }
  if (code) { params.push(code); where.push(`error_code=$${params.length}`); }
  const w = where.join(" AND ");

  try {
    const cnt = (await db.query(`SELECT COUNT(*)::int n FROM import_task_errors WHERE ${w}`, params)) as { n: number }[];
    const rows = (await db.query(
      `SELECT id,batch_index,row_number,field_name,raw_value,error_code,error_reason,suggestion,trace_id,created_at
       FROM import_task_errors WHERE ${w} ORDER BY row_number LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, (page - 1) * pageSize]
    )) as Record<string, unknown>[];
    return NextResponse.json({ ok: true, data: { items: rows, total: cnt[0].n, page, page_size: pageSize } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
