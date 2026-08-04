import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let _sql: NeonQueryFunction<boolean, boolean> | null = null;

/**
 * Neon serverless HTTP 驱动（无长连接、Vercel 友好）。
 * 仅可在服务端（Route Handler / Server Component）调用。
 */
export function sql(): NeonQueryFunction<boolean, boolean> {
  if (_sql) return _sql;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("缺少环境变量 DATABASE_URL（Neon 连接串）");
  }
  _sql = neon(url);
  return _sql;
}

/** 测试数据库连通性：SELECT 1 */
export async function ping(): Promise<{ ok: boolean; detail?: string }> {
  try {
    const rows = await sql()`SELECT 1 AS ok`;
    return { ok: Array.isArray(rows) && rows.length > 0 };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}
