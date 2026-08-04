-- ============================================================
-- 万能导入 V2 · Neon PostgreSQL 建表脚本
-- 在 Neon SQL Editor 中执行一次即可（幂等：使用 IF NOT EXISTS）
-- ============================================================

-- 解析规则
CREATE TABLE IF NOT EXISTS parse_rules (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  file_type   TEXT NOT NULL DEFAULT 'auto',      -- excel | word | pdf | auto
  spec        JSONB NOT NULL,                    -- RuleSpec 全文
  field_meta  JSONB,                             -- AI 逐字段置信标注
  source      TEXT NOT NULL DEFAULT 'manual',    -- manual | ai
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 导入批次（一次提交 = 一个批次）
CREATE TABLE IF NOT EXISTS import_batches (
  id           SERIAL PRIMARY KEY,
  file_name    TEXT,
  rule_id      INT REFERENCES parse_rules(id) ON DELETE SET NULL,
  total_rows   INT DEFAULT 0,
  success_rows INT DEFAULT 0,
  failed_rows  INT DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 运单（按外部编码聚合后的出库单）
CREATE TABLE IF NOT EXISTS waybills (
  id               SERIAL PRIMARY KEY,
  batch_id         INT REFERENCES import_batches(id) ON DELETE CASCADE,
  external_code    TEXT,                         -- 外部编码（可空）
  receiver_mode    TEXT NOT NULL DEFAULT 'B',    -- A=门店 | B=收件人
  store_name       TEXT,
  receiver_name    TEXT,
  receiver_phone   TEXT,
  receiver_address TEXT,
  remark           TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 运单物品行
CREATE TABLE IF NOT EXISTS waybill_items (
  id         SERIAL PRIMARY KEY,
  waybill_id INT NOT NULL REFERENCES waybills(id) ON DELETE CASCADE,
  sku_code   TEXT NOT NULL,
  sku_name   TEXT NOT NULL,
  qty        NUMERIC(12,2) NOT NULL,
  spec       TEXT,
  remark     TEXT
);

CREATE INDEX IF NOT EXISTS idx_waybills_ext     ON waybills(external_code);
CREATE INDEX IF NOT EXISTS idx_waybills_created ON waybills(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_waybill_items_wb ON waybill_items(waybill_id);
