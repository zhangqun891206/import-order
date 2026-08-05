# 万能导入 V2 · 智能多格式批量下单系统

通过「可配置解析规则引擎 + 大模型辅助规则生成」，把 Excel / Word / PDF 等任意格式的出库单解析为结构化运单，在线预览编辑后批量下单并持久化到 Neon，部署于 Vercel。

## 技术栈

- **框架**：Next.js 15（App Router）+ TypeScript
- **UI**：Tailwind CSS v4（鲸天风格，主色 `#0fc6c2`）
- **文件解析**：SheetJS（Excel）、JSZip（Word docx）、pdfjs-dist（PDF），全部在浏览器端归一化为统一中间表示（IR）
- **规则引擎**：自研 DSL，纯函数执行器（浏览器/Node/Worker 通用）
- **大模型**：DeepSeek（OpenAI 兼容协议），用于「生成解析规则」
- **数据库**：Neon PostgreSQL（`@neondatabase/serverless` HTTP 驱动）
- **部署**：Vercel

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量（见下）
#    .env.local 中填入 DEEPSEEK_API_KEY 与 DATABASE_URL

# 3. 初始化数据库（建表）
npm run db:setup

# 4. 灌入预置解析规则（已用 demos 真实样例验证）
npm run db:seed

# 5. 本地运行
npm run dev

# 生产构建
npm run build && npm start
```

### 环境变量（`.env.local`）

| 变量 | 说明 |
| --- | --- |
| `DEEPSEEK_API_KEY` | DeepSeek API Key（仅服务端使用，不提交、不下发前端） |
| `DEEPSEEK_BASE_URL` | 默认 `https://api.deepseek.com` |
| `DEEPSEEK_MODEL` | 默认 `deepseek-chat` |
| `DATABASE_URL` | Neon 连接串（Vercel Marketplace 集成，pooler） |

> `.env.local` 已加入 `.gitignore`，密钥不会进入版本库。Vercel 侧通过 Environment Variables 配置同名变量。

## 架构：规则引擎 + AI 辅助生成

**核心理念**：不为每种文件写 if-else，而是设计一套通用「规则描述语言」。每种新格式只需配置一条规则（可 AI 生成、可手动编辑），系统代码零改动。

1. **归一化（IR）**：上传文件在浏览器端归一化为统一中间表示 —— Excel→单元格矩阵（含合并/多 Sheet）、Word→段落文本、PDF→按 y 坐标重组的文本行。
2. **规则 DSL**：规则 JSON 描述「布局（table/matrix/card/text/multiDoc）+ 字段映射 + 聚合 + 跳过」。字段来源支持：表格列（表头匹配/列号）、标签-值、正则、静态值、Sheet 名。
3. **执行**：纯函数执行器消费 IR + 规则，产出结构化运单（含跨行聚合、矩阵转置、卡片拆分、复合单元格拆分等能力）。
4. **AI 辅助**：新建规则时，先把文件结构摘要发给 DeepSeek，生成规则草稿并逐字段标注「是否推测」；用户核对/微调 → 「试解析」预览 → 保存。AI 只生成规则，不直接解析数据。

### 目录结构

```
app/
  page.tsx                 # 文件导入主流程（上传→选规则→解析→预览→提交）
  rules/page.tsx           # 解析规则管理（增删改复制）
  waybills/page.tsx        # 已导入运单（筛选/分页）
  api/rules/...            # 规则 CRUD + ai-generate
  api/waybills/...         # 提交下单 / 查询 / 查重
  api/db/ping              # 数据库连通性
components/
  ImportFlow.tsx           # 导入编排
  PreviewTable.tsx         # 虚拟滚动可编辑表格（@tanstack/react-virtual）
  RuleEditor.tsx           # 规则编辑器（表单 + JSON + AI + 试解析）
  Nav.tsx
lib/
  ir/                      # 归一化：excel / word / pdf
  engine/                  # DSL 类型 + 执行器
  ai/                      # DeepSeek 封装 + Prompt + IR 摘要
  db/                      # Neon 访问层（rules / waybills）
  validate.ts              # 校验引擎（必填/格式/A-B组/外部编码查重）
  presets.ts               # 预置规则（已验证）
db/schema.sql              # 建表脚本
scripts/setup-db.mjs       # 建表
scripts/seed-rules.mjs     # 灌入预置规则
test/run-engine.mjs        # 引擎自测（6 份样例断言）
```

## 大模型调用说明（提交要求）

- **使用的模型**：DeepSeek `deepseek-chat`，通过 OpenAI 兼容端点 `https://api.deepseek.com/chat/completions` 调用，封装于 `lib/ai/deepseek.ts`（含 60s 超时熔断、失败重试与结构化错误）。
- **Prompt 设计思路**（`lib/ai/prompt.ts`）：
  - System 把模型约束为「解析规则配置专家」：只输出符合 Schema 的 JSON；列定位优先表头文本匹配；干扰头部用表头定位 + skip 处理；散落收货信息用标签-值提取。
  - User 输入「文件结构摘要」（`lib/ai/schema.ts` 从 IR 压缩而来，控制 token）+ 目标字段说明 + 输出要求。
  - 要求对每个字段映射在 `fieldMeta` 标注 `inferred`（是否推测）与说明，前端据此显示「推测」徽标，交由用户最终确认。
  - 职责边界：**AI 生成的是规则，不直接解析业务数据**。
- **API Key 配置方式**：仅存在环境变量（本地 `.env.local`、线上 Vercel Environment Variables），只在服务端 Route Handler 中读取，**不入库、不进 Git、不暴露给前端**。

## 部署（Vercel）

1. 将仓库导入 Vercel（Framework 自动识别为 Next.js）。
2. 在 Vercel → Environment Variables 配置 `DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL`、`DATABASE_URL`。
3. 数据库建议通过 Vercel Marketplace 添加 Neon 并注入 `DATABASE_URL`。
4. 部署前本地执行 `npm run db:setup` 与 `npm run db:seed` 完成建表与预置规则。

## 数据库

- 建表脚本：`db/schema.sql`（`parse_rules` / `import_batches` / `waybills` / `waybill_items`）。
- 外部编码查重：提交前调用 `/api/waybills/check-dup`，服务端 `external_code = ANY(...)` 返回已存在集合，前端标红。

## 引擎自测

```bash
node --experimental-strip-types test/run-engine.mjs
```

对 demos 目录 6 份真实样例（黎明屯/湖南仓/欢乐牧场矩阵/多门店多 Sheet/卡片式/黔寨寨 PDF）断言解析结果，全部通过。
