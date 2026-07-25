/**
 * 台灣手寫統一發票稅額計算。
 *
 * 稅率 5%。依《加值型及非加值型營業稅法施行細則》第 32-1 條，
 * 銷項稅額尾數不滿一元者四捨五入。
 * 含稅反推時以「銷售額 = round(總計 / 1.05)、稅額 = 總計 − 銷售額」計算，
 * 保證 銷售額 + 稅額 === 總計，發票上不會出現尾差。
 */

import type { CopyType, InvoiceItem, InvoiceType, TaxMode } from '../types'

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

/**
 * 金額顯示千分位格式化（ui-spec.md「金額千分位」）：整數部分每三位加一個逗號，
 * 小數部分（單價允許小數）原樣保留在小數點後，不四捨五入、不補零。
 * null 或非有限數（欄位未填／非法值）回傳空字串——是否要因為「留白」而顯示空白
 * 由呼叫端決定（例如列金額被明確覆寫為 0 時仍要顯示 "0"，本函式對 0 也回傳 "0"）。
 */
export function formatMoney(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return ''
  const negative = n < 0
  const [intPart, decPart] = String(Math.abs(n)).split('.')
  const withComma = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const sign = negative ? '-' : ''
  return decPart ? `${sign}${withComma}.${decPart}` : `${sign}${withComma}`
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

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/**
 * 民國年是否為西元閏年（西元 = 民國 + 1911）。
 * 年份為 null 或非法值（非有限數）時視為平年（Feb 上限 28），
 * 因為沒有年份資訊時無法判斷是否閏年，保守回傳平年上限。
 */
function isRocLeapYear(rocYear: number | null): boolean {
  if (rocYear === null) return false
  const y = Math.trunc(rocYear)
  if (!Number.isFinite(y)) return false
  const gregorian = y + 1911
  return (gregorian % 4 === 0 && gregorian % 100 !== 0) || gregorian % 400 === 0
}

/**
 * 民國日期「年、月」→ 該月天數上限（用於驗證日期合法性，ui-spec §2 民國日期行）。
 * - 月份為 null 或不在 1～12（超出範圍）時，上限以 31 計。
 * - 二月依民國年換算西元年判斷閏年，回傳 28 或 29；年份為 null 或非法值時視為平年（28）。
 * - 其餘月份依大小月固定天數，年份不影響。
 */
export function daysInMonth(rocYear: number | null, month: number | null): number {
  if (month === null) return 31
  const m = Math.trunc(month)
  if (!Number.isFinite(m) || m < 1 || m > 12) return 31
  if (m === 2) return isRocLeapYear(rocYear) ? 29 : 28
  return DAYS_IN_MONTH[m - 1]
}

/** 民國日期「月」輸入值夾到 1～12；未填（null）維持 null */
export function clampMonthValue(month: number | null): number | null {
  if (month === null || !Number.isFinite(month)) return null
  const m = Math.trunc(month)
  return Math.min(12, Math.max(1, m))
}

/**
 * 民國日期「日」輸入值依（可能剛變動的）年、月夾到 1～該月天數；未填（null）維持 null。
 * 用於「日超出即夾到該月天數上限」與「改月份／年份後既有日跟著夾」（ui-spec §2 民國日期行）。
 */
export function clampDayValue(
  day: number | null,
  rocYear: number | null,
  month: number | null,
): number | null {
  if (day === null || !Number.isFinite(day)) return null
  const max = daysInMonth(rocYear, month)
  const d = Math.trunc(day)
  return Math.min(max, Math.max(1, d))
}

/**
 * 聯次選項（依《統一發票使用辦法》，ui-spec §2「註腳」）：
 * 三聯式第一～三聯為存根聯／扣抵聯／收執聯；二聯式沒有扣抵聯，第二聯即收執聯。
 */
export const COPY_OPTIONS: Record<InvoiceType, { value: CopyType; label: string }[]> = {
  triplicate: [
    { value: 'stub', label: '第一聯　存根聯' },
    { value: 'deduction', label: '第二聯　扣抵聯' },
    { value: 'receipt', label: '第三聯　收執聯' },
  ],
  duplicate: [
    { value: 'stub', label: '第一聯　存根聯' },
    { value: 'receipt', label: '第二聯　收執聯' },
  ],
}

/**
 * 切換發票類型時的聯次夾值：目前選的聯次在新類型不存在（例如三聯式選了扣抵聯後
 * 切二聯式），夾到該類型的最後一個選項（二聯式 → 收執聯）；存在則維持不變。
 */
export function clampCopyType(copyType: CopyType, invoiceType: InvoiceType): CopyType {
  const options = COPY_OPTIONS[invoiceType]
  if (options.some((opt) => opt.value === copyType)) return copyType
  return options[options.length - 1].value
}
