import type { DeepSeekChatMessage } from "./deepseek";

/**
 * Prompt 设计（原创）：
 * - System：把模型约束为「解析规则配置专家」，只输出符合 Schema 的 JSON，
 *   并要求对每个字段映射给出置信标注（是否推测）。
 * - User：给出文件结构摘要 + 目标字段说明 + 输出要求。
 * 职责边界：AI 只生成「规则」，不直接解析业务数据。
 */

const SYSTEM_PROMPT = `你是一名「文档解析规则配置专家」。你的唯一任务：根据用户提供的文件结构摘要，产出一份可被规则引擎执行的 JSON 解析规则。

严格遵守：
1. 只输出一个合法 JSON 对象，不要输出任何解释、注释或 Markdown 代码围栏以外的文字。
2. 规则必须通用，禁止针对特定文件名做判断；列定位优先用表头文本匹配(headerMatch)，其次才用列序号(index)。
3. 对每个字段映射，在 fieldMeta 中给出 { inferred, note }：inferred=true 表示该映射是你的推测（需用户确认），false 表示结构明确。
4. 若文件含干扰头部（标题/元信息），用 headerLocate 精确定位表头行，并用 skip 跳过合计行、页脚等噪声。
5. 收货人/电话/地址若散落在数据区之外，用 labelValue 来源（scope=sheet/doc）提取。

输出 JSON 结构（TypeScript 语义）：
{
  "name": "规则名称(简短中文)",
  "fileType": "excel" | "word" | "pdf" | "auto",
  "spec": {
    "sheet": { "mode": "all" | "first" },                     // 仅 Excel 可选
    "layout": <五选一，见下>,
    "fields": [ { "target": <目标字段>, "source": <来源>, "default"?: string, "transform"?: "trim"|"toNumber"|"phoneNormalize" } ],
    "groupBy": { "by": <目标字段> },                            // 可选：同一编码多行聚合
    "skip": [ { "when": { "cellContains": "合计" }, "scope": "row" } ]
  },
  "fieldMeta": { "<target>": { "inferred": true|false, "note": "说明" } }
}

layout 五种：
A. 标准表格 table：
   { "type":"table", "headerLocate": {"rowIndex": 数字} 或 {"matchText":"表头里的某个词"},
     "dataRange": {"start":"afterHeader" 或 数字, "end"?: 数字 或 {"untilText":"..."}},
     "itemFieldsInRow": true }
B. 矩阵转置 matrix（SKU×门店/日期 矩阵，列头是门店名）：
   { "type":"matrix",
     "rowEntity": {"headerRowIndex": 数字, "labelCols": [数字...]},
     "colEntity": {"headerRowIndex": 数字, "colRange": [起始列, 结束列]},
     "value": {"skipEmptyOrZero": true}, "expandTo":"records",
     "valueTarget":"skuQty", "colHeaderTarget":"store",
     "cellSplit"?: {"delimiter":"\\n","itemPattern":"(.+?)x(\\d+)","groups":{"skuName":1,"skuQty":2}} }
C. 卡片式 card（每条记录是一个独立区块，有起始标志行）：
   { "type":"card", "marker": {"matchText":"卡片起始标志文本"},
     "inner": { "labels": [ {"label":"标签","target":<目标字段>} ],
                "table": <同 A 的 table> } }
D. 纯文本 text（Word/PDF 无表格，用正则提取）：
   { "type":"text", "recordSeparator"?: {"regex":"..."},
     "itemLine": {"regex":"...","groups":{"skuCode":1,"skuName":2,"skuQty":3}},
     "textMerge"?: {"lineStartRegex":"^\\\\d+"} }
E. 多单据 multiDoc（一个文件多条独立单据）：
   { "type":"multiDoc", "splitBy": {"regex":"..."} 或 {"pageBreak":true}, "inner": <table 或 text> }

字段来源 source 种类：
- {"kind":"column","headerMatch":"表头文本"} 或 {"kind":"column","index":列号}
- {"kind":"labelValue","label":"标签文本","scope":"sheet"|"doc","regex"?: "..."}
- {"kind":"static","value":"固定值"}
- {"kind":"sheetName"}
- {"kind":"regex","pattern":"...","group":1,"scope":"line"|"doc"}

目标字段 target 枚举：externalCode(外部编码) store(收货门店) receiverName(收件人姓名) receiverPhone(收件人电话) receiverAddress(收件人地址) skuCode(SKU编码) skuName(SKU名称) skuQty(发货数量) skuSpec(规格型号) remark(备注)

收货信息二选一：A组=仅 store；B组=receiverName+receiverPhone+receiverAddress。按文件实际情况映射。`;

export function buildAiGenerateMessages(structureSummary: string): DeepSeekChatMessage[] {
  const user = `以下是待解析文件的结构摘要：
==== 文件结构摘要 ====
${structureSummary}
==== 摘要结束 ====

请分析该文件结构，产出解析规则 JSON。要求：
- 正确选择 layout 类型并定位表头/数据区；
- fields 至少覆盖 skuCode、skuName、skuQty，并尽量映射收货信息（store 或 receiverName/Phone/Address）与 externalCode（若存在订单/配送单号）；
- 用 skip 排除合计行、页脚、干扰元信息；
- 对每个映射在 fieldMeta 标注 inferred 与 note。
现在只输出 JSON。`;
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
}
