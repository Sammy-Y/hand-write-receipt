/**
 * 台灣手寫統一發票稅額計算。
 *
 * 稅率 5%。依《加值型及非加值型營業稅法施行細則》第 32-1 條，
 * 銷項稅額尾數不滿一元者四捨五入。
 * 含稅反推時以「銷售額 = round(總計 / 1.05)、稅額 = 總計 − 銷售額」計算，
 * 保證 銷售額 + 稅額 === 總計，發票上不會出現尾差。
 */

import type { InvoiceItem, TaxMode } from '../types'

export const TAX_RATE = 0.05

export interface TaxBreakdown {
  /** 銷售額（未稅） */
  sales: number
  /** 營業稅額 */
  tax: number
  /** 總計（含稅） */
  total: number
}

/** 由未稅銷售額計算稅額與總計 */
export function fromSales(sales: number): TaxBreakdown {
  const s = normalizeMoney(sales)
  const tax = Math.round(s * TAX_RATE)
  return { sales: s, tax, total: s + tax }
}

/** 由含稅總計反推銷售額與稅額 */
export function fromTotal(total: number): TaxBreakdown {
  const t = normalizeMoney(total)
  const sales = Math.round(t / (1 + TAX_RATE))
  return { sales, tax: t - sales, total: t }
}

/**
 * 金額欄位正規化：非有限數或負數視為 0，去除小數（發票金額為整數元）。
 * 所有寫入銷售額／稅額／總計／列金額的路徑都必須先過這一關，否則
 * 會出現 47.99000000000001 這種浮點雜訊、負數金額，且非整數會讓中文大寫九格全空。
 */
export function normalizeMoney(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.round(n)
}

/** 依稅制由銷售額往下算：應稅課 5%，零稅率／免稅稅額為 0（總計 = 銷售額） */
export function fromSalesByMode(sales: number, mode: TaxMode): TaxBreakdown {
  if (mode === 'taxable') return fromSales(sales)
  const s = normalizeMoney(sales)
  return { sales: s, tax: 0, total: s }
}

/** 依稅制由總計反推：應稅反推 5%，零稅率／免稅銷售額 = 總計、稅額 0 */
export function fromTotalByMode(total: number, mode: TaxMode): TaxBreakdown {
  if (mode === 'taxable') return fromTotal(total)
  const t = normalizeMoney(total)
  return { sales: t, tax: 0, total: t }
}

/** 稅額手動覆寫：稅額正規化後 總計 = 銷售額 + 稅額（銷售額不動） */
export function withTaxOverride(sales: number, tax: number): TaxBreakdown {
  const s = normalizeMoney(sales)
  const t = normalizeMoney(tax)
  return { sales: s, tax: t, total: s + t }
}

export interface LineItem {
  name: string
  quantity: number | null
  unitPrice: number | null
}

/** 單一品項金額（數量 × 單價），未填視為 0 */
export function lineAmount(item: LineItem): number {
  const q = item.quantity ?? 0
  const p = item.unitPrice ?? 0
  if (!Number.isFinite(q) || !Number.isFinite(p) || q <= 0 || p <= 0) return 0
  return Math.round(q * p)
}

/** 全部品項金額合計 */
export function itemsTotal(items: LineItem[]): number {
  return items.reduce((sum, item) => sum + lineAmount(item), 0)
}

const DIGITS = ['零', '壹', '貳', '參', '肆', '伍', '陸', '柒', '捌', '玖']
const UNITS = ['', '拾', '佰', '仟']
const GROUP_UNITS = ['', '萬', '億', '兆']

/**
 * 金額轉發票總計欄中文大寫，如 10500 → 壹萬零伍佰元整。
 * 支援 0 ～ 9999 兆，超出範圍或非整數回傳空字串。
 */
export function toChineseUpper(amount: number): string {
  if (!Number.isInteger(amount) || amount < 0 || amount >= 1e16) return ''
  if (amount === 0) return '零元整'

  const groups: string[] = []
  let n = amount
  let groupIndex = 0
  let result = ''

  while (n > 0) {
    groups.push(formatGroup(n % 10000, GROUP_UNITS[groupIndex]))
    n = Math.floor(n / 10000)
    groupIndex++
  }

  // 由高位組到低位組串接；低位組不足四位（表示有跨組的零）補「零」
  for (let i = groups.length - 1; i >= 0; i--) {
    const part = groups[i]
    if (part === '') continue
    if (result !== '' && needsLeadingZero(amount, i)) result += '零'
    result += part
  }

  return result + '元整'
}

/** 0～9999 的一組四位數轉大寫（不含組單位時回空字串） */
function formatGroup(n: number, groupUnit: string): string {
  if (n === 0) return ''
  let s = ''
  let pendingZero = false
  for (let unit = 3; unit >= 0; unit--) {
    const d = Math.floor(n / 10 ** unit) % 10
    if (d === 0) {
      if (s !== '') pendingZero = true
    } else {
      if (pendingZero) s += '零'
      pendingZero = false
      s += DIGITS[d] + UNITS[unit]
    }
  }
  return s + groupUnit
}

/** 第 i 組（由低位算起）前是否需要補「零」：該組不滿千位表示與上一組間有零 */
function needsLeadingZero(amount: number, groupIndex: number): boolean {
  const group = Math.floor(amount / 10 ** (groupIndex * 4)) % 10000
  return group > 0 && group < 1000
}

/**
 * 發票「總計新臺幣（中文大寫）」九格的大寫數字。
 * 回傳九個位置 [億, 仟, 佰, 拾, 萬, 仟, 佰, 拾, 元] 對應的大寫數字（DIGITS），
 * 高於最高有效位者為 null；total <= 0、非整數或超過九位數時全為 null。
 * 例：10500 → [null, null, null, null, '壹', '零', '伍', '零', '零']。
 */
export function upperDigits(total: number): (string | null)[] {
  const slots: (string | null)[] = Array(9).fill(null)
  if (!Number.isInteger(total) || total <= 0 || total > 999_999_999) return slots
  const digits = String(total)
  for (let i = 0; i < digits.length; i++) {
    slots[9 - digits.length + i] = DIGITS[Number(digits[i])]
  }
  return slots
}

/** 單列金額：手動覆寫（amount 有值）優先，否則自動以數量 × 單價計算 */
export function rowAmount(item: InvoiceItem): number {
  return item.amount ?? lineAmount(item)
}

/** 全部品項列金額合計（手動覆寫優先） */
export function rowsTotal(items: InvoiceItem[]): number {
  return items.reduce((sum, item) => sum + rowAmount(item), 0)
}

/** 發票期別的六個雙月期起始月（一、二月 → 1；十一、十二月 → 11） */
export const PERIOD_START_MONTHS = [1, 3, 5, 7, 9, 11] as const

/** 西元年 → 民國年（西元 − 1911） */
export function rocYear(gregorianYear: number): number {
  return Math.trunc(gregorianYear) - 1911
}

/** 月份（1～12）所屬雙月期的起始月；超出範圍或非法值回傳 1 */
export function periodStartMonth(month: number): number {
  const m = Math.trunc(month)
  if (!Number.isFinite(m) || m < 1 || m > 12) return 1
  return m % 2 === 0 ? m - 1 : m
}
