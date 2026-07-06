"use strict";

/**
 * Deterministic layer: match extracted estimate line items against the product
 * catalog and compute cost / CO2 deltas in code (never left to the AI).
 */

function buildKeywordIndex(products) {
  // Longest keyword first so more specific matches win.
  const entries = [];
  products
    .filter((p) => p.active)
    .forEach((p) => {
      String(p.keywords || "")
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean)
        .forEach((kw) => entries.push({ keyword: kw, product: p }));
    });
  entries.sort((a, b) => b.keyword.length - a.keyword.length);
  return entries;
}

function matchName(name, index) {
  if (!name) return null;
  const n = String(name);
  for (const e of index) {
    if (n.includes(e.keyword)) return e;
  }
  return null;
}

function num(v, fallback = 0) {
  if (typeof v === "number" && isFinite(v)) return v;
  if (v == null) return fallback;
  const parsed = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return isFinite(parsed) ? parsed : fallback;
}

/**
 * items: [{ name, qty, unit, unitPrice, amount }]
 * products: rows from DB
 * returns { rows, totals }
 */
function analyze(items, products) {
  const index = buildKeywordIndex(products);

  const rows = items.map((raw) => {
    const qty = num(raw.qty, 1) || 1;
    let unitPrice = num(raw.unitPrice, NaN);
    let amount = num(raw.amount, NaN);
    if (!isFinite(unitPrice) && isFinite(amount)) unitPrice = amount / qty;
    if (!isFinite(amount) && isFinite(unitPrice)) amount = unitPrice * qty;
    if (!isFinite(amount)) amount = 0;
    if (!isFinite(unitPrice)) unitPrice = 0;

    const match = matchName(raw.name, index);
    if (!match) {
      return { name: raw.name, qty, unit: raw.unit || "", unitPrice, amount, matched: false };
    }
    const p = match.product;
    const newUnitPrice = p.unit_price;
    const newAmount = newUnitPrice * qty;
    const baselineCO2 = (p.baseline_co2_per_unit || 0) * qty;
    const newCO2 = (p.co2_per_unit || 0) * qty;
    const co2Diff = baselineCO2 - newCO2;
    return {
      name: raw.name,
      qty,
      unit: raw.unit || p.unit || "",
      unitPrice,
      amount,
      matched: true,
      matchedKeyword: match.keyword,
      product: {
        id: p.id,
        name: p.name,
        category: p.category,
        unit: p.unit,
        unit_price: p.unit_price,
        co2_per_unit: p.co2_per_unit,
        baseline_co2_per_unit: p.baseline_co2_per_unit,
        verified: p.verified,
        data_source: p.data_source,
      },
      newUnitPrice,
      newAmount,
      costDiff: amount - newAmount,
      baselineCO2,
      newCO2,
      co2Diff,
      co2DiffPercent: baselineCO2 > 0 ? (co2Diff / baselineCO2) * 100 : 0,
    };
  });

  const matched = rows.filter((r) => r.matched);
  const totals = {
    count: matched.length,
    totalItems: rows.length,
    originalCost: sum(matched, "amount"),
    newCost: sum(matched, "newAmount"),
    costSaving: sum(matched, "costDiff"),
    baselineCO2: sum(matched, "baselineCO2"),
    newCO2: sum(matched, "newCO2"),
    co2Saving: sum(matched, "co2Diff"),
  };
  totals.co2Percent = totals.baselineCO2 > 0 ? (totals.co2Saving / totals.baselineCO2) * 100 : 0;

  // GX-ETS（排出量取引制度）参考価格による排出枠換算額（円）
  // 2026年度 政府公表: 調整基準取引価格 1,700円/t-CO2, 参考上限取引価格 4,300円/t-CO2
  const tonsSaved = totals.co2Saving / 1000;
  totals.etsValueLow = tonsSaved * ETS_PRICE_LOW;
  totals.etsValueHigh = tonsSaved * ETS_PRICE_HIGH;

  return { rows, totals };
}

const ETS_PRICE_LOW = Number(process.env.ETS_PRICE_LOW || 1700); // 調整基準取引価格
const ETS_PRICE_HIGH = Number(process.env.ETS_PRICE_HIGH || 4300); // 参考上限取引価格

function sum(arr, key) {
  return arr.reduce((s, r) => s + (Number(r[key]) || 0), 0);
}

mo
