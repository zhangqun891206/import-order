-- ============================================================
-- V4 异步事件驱动重构 · 新增数据模型（Neon PostgreSQL）
-- 复用：waybills / waybill_items / parse_rules（不破坏已有语义）
-- ============================================================

-- SKU 主数据（压测 + 校验）
CREATE TABLE IF NOT EXISTS sku_master (
  id         SERIAL PRIMARY KEY,
  sku_code   TEXT NOT NULL,
  name       TEXT NOT NULL,
  spec       TEXT,
  unit       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uk_sku_master_code ON sku_master(sku_code);

-- 导入任务主表
CREATE TABLE IF NOT EXISTS import_tasks (
  id                TEXT PRIMARY KEY,
  file_name         TEXT,
  rule_id           INT,
  status            TEXT NOT NULL DEFAULT 'pending', -- pending/processing/completed/partial_success/failed
  total_rows        INT NOT NULL DEFAULT 0,
  processed_rows    INT NOT NULL DEFAULT 0,
  success_rows      INT NOT NULL DEFAULT 0,
  failed_rows       INT NOT NULL DEFAULT 0,
  total_batches     INT NOT NULL DEFAULT 0,
  completed_batches INT NOT NULL DEFAULT 0,
  trace_id          TEXT,
  degraded          BOOLEAN NOT NULL DEFAULT false,
  unverified_sku_rows INT NOT NULL DEFAULT 0,
  file_bytes        TEXT,               -- base64 原始文件（可复读引用）
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_import_tasks_status_created ON import_tasks(status, created_at DESC);

-- 处理单元状态表（解析单元 + 批次单元）
CREATE TABLE IF NOT EXISTS import_task_batches (
  id           SERIAL PRIMARY KEY,
  task_id      TEXT NOT NULL REFERENCES import_tasks(id) ON DELETE CASCADE,
  unit_id      TEXT NOT NULL,
  batch_index  INT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'batch',  -- parse | batch
  start_row    INT,
  end_row      INT,
  status       TEXT NOT NULL DEFAULT 'pending', -- pending/processing/done/failed
  retry_count  INT NOT NULL DEFAULT 0,
  locked_at    TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  rows_total   INT NOT NULL DEFAULT 0,
  rows_ok      INT NOT NULL DEFAULT 0,
  rows_err     INT NOT NULL DEFAULT 0,
  UNIQUE (task_id, unit_id)
);
CREATE INDEX IF NOT EXISTS idx_batches_claim ON import_task_batches(status, batch_index);

-- 行暂存（解析单元产出，供批次单元读取）
CREATE TABLE IF NOT EXISTS import_task_rows (
  task_id         TEXT NOT NULL,
  row_number      INT NOT NULL,
  external_code   TEXT,
  store           TEXT,
  receiver_name   TEXT,
  receiver_phone  TEXT,
  receiver_address TEXT,
  sku_code        TEXT,
  sku_name        TEXT,
  sku_qty         NUMERIC(12,2),
  sku_spec        TEXT,
  remark          TEXT,
  PRIMARY KEY (task_id, row_number)
);

-- 行级错误明细
CREATE TABLE IF NOT EXISTS import_task_errors (
  id           SERIAL PRIMARY KEY,
  task_id      TEXT NOT NULL,
  unit_id      TEXT,
  batch_index  INT,
  row_number   INT,
  field_name   TEXT,
  raw_value    TEXT,
  error_code   TEXT,
  error_reason TEXT,
  suggestion   TEXT,
  trace_id     TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_errors_task_unit ON import_task_errors(task_id, unit_id);
CREATE INDEX IF NOT EXISTS idx_errors_code ON import_task_errors(error_code);

-- 事务性发件箱（可靠事件表 / DB 队列）
CREATE TABLE IF NOT EXISTS event_outbox (
  id            TEXT PRIMARY KEY,
  aggregate_id  TEXT,
  event_type    TEXT NOT NULL,
  schema_version INT NOT NULL DEFAULT 1,
  payload       JSONB NOT NULL,
  trace_id      TEXT,
  status        TEXT NOT NULL DEFAULT 'pending', -- pending/sent/failed
  retry_count   INT NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_outbox_status_next ON event_outbox(status, next_retry_at);

-- 处理单元性能日志
CREATE TABLE IF NOT EXISTS batch_performance_log (
  id                  SERIAL PRIMARY KEY,
  task_id             TEXT NOT NULL,
  unit_id             TEXT,
  batch_index         INT,
  parse_duration_ms   INT,
  rule_duration_ms    INT,
  validate_duration_ms INT,
  insert_duration_ms  INT,
  total_duration_ms   INT,
  status              TEXT,
  trace_id            TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_perf_task_unit ON batch_performance_log(task_id, unit_id);
CREATE INDEX IF NOT EXISTS idx_perf_created ON batch_performance_log(created_at DESC);

-- 链路时间线事件
CREATE TABLE IF NOT EXISTS trace_events (
  id           SERIAL PRIMARY KEY,
  trace_id     TEXT NOT NULL,
  task_id      TEXT,
  unit_id      TEXT,
  event_name   TEXT NOT NULL,
  event_status TEXT NOT NULL DEFAULT 'ok',
  message      TEXT,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trace_trace_occ ON trace_events(trace_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_trace_task ON trace_events(task_id, occurred_at);

-- waybills 增加业务去重键（异步管道 UPSERT 幂等），不破坏已有字段
ALTER TABLE waybills ADD COLUMN IF NOT EXISTS dedup_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uk_waybills_dedup ON waybills(dedup_key);
