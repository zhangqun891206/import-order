import { NextRequest, NextResponse } from "next/server";
import { findExistingExternalCodes } from "@/lib/db/waybills";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const codes: string[] = Array.isArray(body?.codes)
      ? (body.codes as unknown[]).filter((c): c is string => typeof c === "string")
      : [];
    const existing = await findExistingExternalCodes(codes);
    return NextResponse.json({ ok: true, data: { existing: Array.from(existing) } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
