import { z } from "zod";

// ---------------- 解析规则 zod 校验 ----------------
export const ruleFileTypeSchema = z.enum(["excel", "word", "pdf", "auto"]);

/** 宽松校验规则 JSON（spec 结构由引擎负责执行期容错） */
export const createRuleSchema = z.object({
  name: z.string().min(1, "规则名称不能为空").max(100),
  description: z.string().max(500).optional(),
  fileType: ruleFileTypeSchema.default("auto"),
  spec: z.record(z.string(), z.unknown()).refine((v) => v && typeof v === "object" && "layout" in v, {
    message: "spec 必须包含 layout",
  }),
  fieldMeta: z.record(z.string(), z.unknown()).optional(),
  source: z.enum(["manual", "ai"]).default("manual"),
});

export const updateRuleSchema = createRuleSchema.partial().extend({
  id: z.number().int().positive(),
});

export type CreateRuleInput = z.infer<typeof createRuleSchema>;

// ---------------- 运单提交 zod 校验 ----------------
export const waybillItemSchema = z.object({
  skuCode: z.string().min(1, "SKU编码必填"),
  skuName: z.string().min(1, "SKU名称必填"),
  qty: z.union([z.number().positive("数量必须为正数"), z.string()]).refine(
    (v) => {
      const n = typeof v === "number" ? v : parseFloat(v);
      return Number.isFinite(n) && n > 0;
    },
    { message: "数量必须为正数" }
  ),
  spec: z.string().optional().nullable(),
  remark: z.string().optional().nullable(),
});

export const waybillSchema = z
  .object({
    externalCode: z.string().optional().nullable(),
    storeName: z.string().optional().nullable(),
    receiverName: z.string().optional().nullable(),
    receiverPhone: z.string().optional().nullable(),
    receiverAddress: z.string().optional().nullable(),
    remark: z.string().optional().nullable(),
    items: z.array(waybillItemSchema).min(1, "至少包含一个物品行"),
  })
  .refine(
    (v) => {
      const hasA = Boolean(v.storeName && v.storeName.trim());
      const hasB = Boolean(
        (v.receiverName || "").trim() && (v.receiverPhone || "").trim() && (v.receiverAddress || "").trim()
      );
      return hasA || hasB;
    },
    { message: "收货门店(A组) 与 收件人姓名+电话+地址(B组) 至少填一组" }
  );

export const submitOrderSchema = z.object({
  fileName: z.string().optional(),
  ruleId: z.number().int().positive().optional().nullable(),
  waybills: z.array(waybillSchema).min(1, "没有可提交的运单"),
});

export type SubmitOrderInput = z.infer<typeof submitOrderSchema>;

// ---------------- 运单查询 ----------------
export const waybillQuerySchema = z.object({
  externalCode: z.string().optional(),
  receiverName: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type WaybillQuery = z.infer<typeof waybillQuerySchema>;
