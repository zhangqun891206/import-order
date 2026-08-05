import { sql } from "./index";
import type { ParseRule } from "../engine/types";

interface RuleRow {
  id: number;
  name: string;
  description: string | null;
  file_type: string;
  spec: unknown;
  field_meta: unknown;
  source: string;
  created_at: string;
  updated_at: string;
}

function toRule(r: RuleRow): ParseRule {
  return {
    id: r.id,
    name: r.name,
    description: r.description || undefined,
    fileType: (r.file_type as ParseRule["fileType"]) || "auto",
    spec: r.spec as ParseRule["spec"],
    fieldMeta: (r.field_meta as ParseRule["fieldMeta"]) || undefined,
    source: (r.source as ParseRule["source"]) || "manual",
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listRules(): Promise<ParseRule[]> {
  const rows = (await sql()`SELECT * FROM parse_rules ORDER BY updated_at DESC`) as unknown as RuleRow[];
  return rows.map(toRule);
}

export async function getRule(id: number): Promise<ParseRule | null> {
  const rows = (await sql()`SELECT * FROM parse_rules WHERE id = ${id}`) as unknown as RuleRow[];
  return rows.length ? toRule(rows[0]) : null;
}

export async function createRule(input: {
  name: string;
  description?: string;
  fileType: string;
  spec: unknown;
  fieldMeta?: unknown;
  source?: string;
}): Promise<ParseRule> {
  const rows = (await sql()`
    INSERT INTO parse_rules (name, description, file_type, spec, field_meta, source)
    VALUES (${input.name}, ${input.description || null}, ${input.fileType},
            ${JSON.stringify(input.spec)}::jsonb, ${input.fieldMeta ? JSON.stringify(input.fieldMeta) : null}::jsonb,
            ${input.source || "manual"})
    RETURNING *
  `) as unknown as RuleRow[];
  return toRule(rows[0]);
}

export async function updateRule(
  id: number,
  patch: Partial<{ name: string; description: string; fileType: string; spec: unknown; fieldMeta: unknown; source: string }>
): Promise<ParseRule | null> {
  const existing = await getRule(id);
  if (!existing) return null;
  const next = {
    name: patch.name ?? existing.name,
    description: patch.description ?? existing.description ?? null,
    fileType: patch.fileType ?? existing.fileType,
    spec: patch.spec ?? existing.spec,
    fieldMeta: patch.fieldMeta ?? existing.fieldMeta ?? null,
    source: patch.source ?? existing.source ?? "manual",
  };
  const rows = (await sql()`
    UPDATE parse_rules SET
      name = ${next.name}, description = ${next.description}, file_type = ${next.fileType},
      spec = ${JSON.stringify(next.spec)}::jsonb,
      field_meta = ${next.fieldMeta ? JSON.stringify(next.fieldMeta) : null}::jsonb,
      source = ${next.source}, updated_at = now()
    WHERE id = ${id} RETURNING *
  `) as unknown as RuleRow[];
  return rows.length ? toRule(rows[0]) : null;
}

export async function deleteRule(id: number): Promise<boolean> {
  const rows = (await sql()`DELETE FROM parse_rules WHERE id = ${id} RETURNING id`) as unknown as { id: number }[];
  return rows.length > 0;
}

export async function duplicateRule(id: number): Promise<ParseRule | null> {
  const src = await getRule(id);
  if (!src) return null;
  return createRule({
    name: `${src.name} 副本`,
    description: src.description,
    fileType: src.fileType,
    spec: src.spec,
    fieldMeta: src.fieldMeta,
    source: "manual",
  });
}
