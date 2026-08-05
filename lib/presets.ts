import type { ParseRule } from "./engine/types";

/**
 * 预置解析规则（已用 demos 真实样例验证通过）。
 * 这些是「规则配置数据」，不是硬编码解析逻辑——
 * 规则引擎对所有文件一视同仁，新增格式只需再加一条规则。
 */
export const PRESET_RULES: Omit<ParseRule, "id">[] = [
  {
    name: "黎明屯配送发货单（干扰头部+尾部收货）",
    description: "Excel：3 行干扰头部，表头第 4 行，合计行跳过，收货人/电话/地址散落在尾部独立行。",
    fileType: "excel",
    source: "manual",
    spec: {
      sheet: { mode: "first" },
      layout: {
        type: "table",
        headerLocate: { rowIndex: 3 },
        dataRange: { start: "afterHeader", end: { untilText: "合计" } },
        itemFieldsInRow: true,
      },
      fields: [
        { target: "externalCode", source: { kind: "labelValue", label: "单据号", scope: "sheet" } },
        { target: "store", source: { kind: "labelValue", label: "收货机构", scope: "sheet" } },
        { target: "skuCode", source: { kind: "column", headerMatch: "物品编码" } },
        { target: "skuName", source: { kind: "column", headerMatch: "物品名称" } },
        { target: "skuSpec", source: { kind: "column", headerMatch: "规格型号" } },
        { target: "skuQty", source: { kind: "column", headerMatch: "发货数量" }, transform: "toNumber" },
        { target: "receiverName", source: { kind: "labelValue", label: "收货人", scope: "sheet" } },
        { target: "receiverPhone", source: { kind: "labelValue", label: "收货电话", scope: "sheet" }, transform: "phoneNormalize" },
        { target: "receiverAddress", source: { kind: "labelValue", label: "收货地址", scope: "sheet" } },
      ],
      skip: [{ when: { cellContains: "合计" }, scope: "row" }],
    },
  },
  {
    name: "湖南仓发货明细（跨行聚合）",
    description: "Excel：按配送单号跨行聚合，收货信息随每行携带。",
    fileType: "excel",
    source: "manual",
    spec: {
      sheet: { mode: "first" },
      layout: { type: "table", headerLocate: { rowIndex: 1 }, dataRange: { start: "afterHeader" }, itemFieldsInRow: true },
      fields: [
        { target: "externalCode", source: { kind: "column", headerMatch: "配送单号" } },
        { target: "store", source: { kind: "column", headerMatch: "收货机构" } },
        { target: "skuCode", source: { kind: "column", headerMatch: "物品编码" } },
        { target: "skuName", source: { kind: "column", headerMatch: "物品名称" } },
        { target: "skuSpec", source: { kind: "column", headerMatch: "规格型号" } },
        { target: "skuQty", source: { kind: "column", headerMatch: "发货数量" }, transform: "toNumber" },
        { target: "receiverName", source: { kind: "column", headerMatch: "收货人" } },
        { target: "receiverPhone", source: { kind: "column", headerMatch: "收货电话" }, transform: "phoneNormalize" },
        { target: "receiverAddress", source: { kind: "column", headerMatch: "收货地址" } },
      ],
      groupBy: { by: "externalCode" },
    },
  },
  {
    name: "欢乐牧场 SKU×门店矩阵（矩阵转置）",
    description: "Excel：SKU 为行、门店为列的矩阵，转置为按门店聚合的运单。",
    fileType: "excel",
    source: "manual",
    spec: {
      sheet: { mode: "first" },
      layout: {
        type: "matrix",
        rowEntity: { headerRowIndex: 0, labelCols: [2, 3, 4, 7] },
        colEntity: { headerRowIndex: 0, colRange: [13, 17] },
        value: { skipEmptyOrZero: true },
        expandTo: "records",
        valueTarget: "skuQty",
        colHeaderTarget: "store",
      },
      fields: [
        { target: "skuCode", source: { kind: "column", headerMatch: "SKU条码" } },
        { target: "skuName", source: { kind: "column", headerMatch: "SKU名称" } },
        { target: "skuSpec", source: { kind: "column", headerMatch: "规格" } },
      ],
      groupBy: { by: "store" },
    },
  },
  {
    name: "多门店分Sheet出库单（多Sheet合并）",
    description: "Excel：每个 Sheet 一个门店出库单，遍历合并，尾部标签-值提取收货信息。",
    fileType: "excel",
    source: "manual",
    spec: {
      sheet: { mode: "all" },
      layout: {
        type: "table",
        headerLocate: { matchText: "出库数量" },
        dataRange: { start: "afterHeader", end: { untilText: "合计" } },
        itemFieldsInRow: true,
      },
      fields: [
        { target: "store", source: { kind: "labelValue", label: "收货门店", scope: "sheet" } },
        { target: "skuCode", source: { kind: "column", headerMatch: "物品编码" } },
        { target: "skuName", source: { kind: "column", headerMatch: "物品名称" } },
        { target: "skuSpec", source: { kind: "column", headerMatch: "规格型号" } },
        { target: "skuQty", source: { kind: "column", headerMatch: "出库数量" }, transform: "toNumber" },
        { target: "remark", source: { kind: "column", headerMatch: "备注" } },
        { target: "receiverName", source: { kind: "labelValue", label: "联系人", scope: "sheet" } },
        { target: "receiverPhone", source: { kind: "labelValue", label: "联系电话", scope: "sheet" }, transform: "phoneNormalize" },
        { target: "receiverAddress", source: { kind: "labelValue", label: "收货地址", scope: "sheet" } },
      ],
      skip: [{ when: { cellContains: "合计" }, scope: "row" }],
    },
  },
  {
    name: "门店调拨单（卡片式）",
    description: "Excel：以『调拨记录』为卡片边界的非标准表格，卡内含收货信息与物品小表。",
    fileType: "excel",
    source: "manual",
    spec: {
      sheet: { mode: "first" },
      layout: {
        type: "card",
        marker: { matchText: "调拨记录" },
        inner: {
          labels: [
            { label: "调入门店", target: "store" },
            { label: "收货人", target: "receiverName" },
            { label: "电话", target: "receiverPhone" },
            { label: "收货地址", target: "receiverAddress" },
          ],
          table: {
            type: "table",
            headerLocate: { matchText: "物品编码" },
            dataRange: { start: "afterHeader" },
            itemFieldsInRow: true,
          },
        },
      },
      fields: [
        { target: "skuCode", source: { kind: "column", headerMatch: "物品编码" } },
        { target: "skuName", source: { kind: "column", headerMatch: "物品名称" } },
        { target: "skuSpec", source: { kind: "column", headerMatch: "规格" } },
        { target: "skuQty", source: { kind: "column", headerMatch: "数量" }, transform: "toNumber" },
      ],
      skip: [{ when: { cellContains: "合计" }, scope: "row" }],
    },
  },
  {
    name: "黔寨寨配送单 PDF（文本解析）",
    description: "PDF：头部元信息 + 文本表格行 + 尾部收货信息，正则提取物品行。",
    fileType: "pdf",
    source: "manual",
    spec: {
      layout: {
        type: "text",
        itemLine: { regex: "(ZBWP\\d+)\\t([^\\t]+).*\\t(\\d+)\\s*$", groups: { skuCode: 1, skuName: 2, skuQty: 3 } },
      },
      fields: [
        { target: "externalCode", source: { kind: "labelValue", label: "单据编号", scope: "doc" } },
        { target: "store", source: { kind: "labelValue", label: "收货机构", scope: "doc" } },
        { target: "receiverName", source: { kind: "labelValue", label: "收货人", scope: "doc" } },
        { target: "receiverPhone", source: { kind: "labelValue", label: "收货电话", scope: "doc" }, transform: "phoneNormalize" },
        { target: "receiverAddress", source: { kind: "labelValue", label: "收货地址", scope: "doc" } },
      ],
    },
  },
];
