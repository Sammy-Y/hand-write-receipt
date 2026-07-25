import { describe, expect, it } from 'vitest'
import {
  fromSales,
  fromSalesByMode,
  fromTotal,
  fromTotalByMode,
  itemsTotal,
  lineAmount,
  normalizeMoney,
  PERIOD_START_MONTHS,
  periodStartMonth,
  rocYear,
  rowAmount,
  rowsTotal,
  toChineseUpper,
  upperDigits,
  withTaxOverride,
} from './invoice'
import type { InvoiceItem } from '../types'

function item(overrides: Partial<InvoiceItem> = {}): InvoiceItem {
  return { name: '', quantity: null, unitPrice: null, amount: null, note: '', ...overrides }
}

describe('fromSales（未稅 → 稅額/總計）', () => {
  it('整除案例：100 → 稅 5、總計 105', () => {
    expect(fromSales(100)).toEqual({ sales: 100, tax: 5, total: 105 })
  })

  it('尾數四捨五入：稅額不滿一元四捨五入', () => {
    expect(fromSales(109).tax).toBe(5) // 5.45 → 5
    expect(fromSales(110).tax).toBe(6) // 5.5 → 6
    expect(fromSales(30).tax).toBe(2) // 1.5 → 2
    expect(fromSales(29).tax).toBe(1) // 1.45 → 1
  })

  it('0 與非法輸入回傳全 0', () => {
    expect(fromSales(0)).toEqual({ sales: 0, tax: 0, total: 0 })
    expect(fromSales(-50)).toEqual({ sales: 0, tax: 0, total: 0 })
    expect(fromSales(NaN)).toEqual({ sales: 0, tax: 0, total: 0 })
  })
})

describe('fromTotal（含稅 → 銷售額/稅額）', () => {
  it('整除案例：105 → 銷售額 100、稅 5', () => {
    expect(fromTotal(105)).toEqual({ sales: 100, tax: 5, total: 105 })
  })

  it('不整除案例：1000 → 銷售額 952、稅 48', () => {
    expect(fromTotal(1000)).toEqual({ sales: 952, tax: 48, total: 1000 })
  })

  it('恆等式：銷售額 + 稅額 === 總計（掃 1～10000 全部整數）', () => {
    for (let t = 1; t <= 10000; t++) {
      const r = fromTotal(t)
      expect(r.sales + r.tax).toBe(t)
    }
  })

  it('與 fromSales 互為近似反函數：由未稅算出的總計反推回原銷售額', () => {
    for (let s = 1; s <= 5000; s++) {
      const total = fromSales(s).total
      expect(fromTotal(total).sales).toBe(s)
    }
  })
})

describe('normalizeMoney（金額欄位正規化：整數元、非負）', () => {
  it('小數四捨五入成整數元', () => {
    expect(normalizeMoney(999.99)).toBe(1000)
    expect(normalizeMoney(100.5)).toBe(101)
    expect(normalizeMoney(33.33)).toBe(33)
    expect(normalizeMoney(1234.56)).toBe(1235)
    expect(normalizeMoney(0.5)).toBe(1)
  })

  it('負數、0 與非有限數視為 0', () => {
    expect(normalizeMoney(-100)).toBe(0)
    expect(normalizeMoney(-0.4)).toBe(0)
    expect(normalizeMoney(0)).toBe(0)
    expect(normalizeMoney(NaN)).toBe(0)
    expect(normalizeMoney(Infinity)).toBe(0)
    expect(normalizeMoney(-Infinity)).toBe(0)
  })
})

describe('fromSalesByMode / fromTotalByMode（依稅制計算，含正規化）', () => {
  it('應稅：銷售額課 5%、總計反推 5%', () => {
    expect(fromSalesByMode(1000, 'taxable')).toEqual({ sales: 1000, tax: 50, total: 1050 })
    expect(fromTotalByMode(1050, 'taxable')).toEqual({ sales: 1000, tax: 50, total: 1050 })
  })

  it('零稅率／免稅：稅額 0、銷售額 = 總計', () => {
    expect(fromSalesByMode(1000, 'zeroRate')).toEqual({ sales: 1000, tax: 0, total: 1000 })
    expect(fromSalesByMode(1000, 'exempt')).toEqual({ sales: 1000, tax: 0, total: 1000 })
    expect(fromTotalByMode(2000, 'zeroRate')).toEqual({ sales: 2000, tax: 0, total: 2000 })
  })

  it('小數輸入先四捨五入 → 稅額不會出現 47.99000000000001 這種浮點雜訊', () => {
    expect(fromTotalByMode(999.99, 'taxable')).toEqual({ sales: 952, tax: 48, total: 1000 })
    expect(fromTotalByMode(100.1, 'taxable')).toEqual({ sales: 95, tax: 5, total: 100 })
    expect(fromTotalByMode(33.33, 'taxable')).toEqual({ sales: 31, tax: 2, total: 33 })
    expect(fromSalesByMode(1000.5, 'taxable')).toEqual({ sales: 1001, tax: 50, total: 1051 })
    expect(fromSalesByMode(1234.56, 'zeroRate')).toEqual({ sales: 1235, tax: 0, total: 1235 })
  })

  it('小數輸入後三欄都是整數且總計有大寫可抄（九格不空白）', () => {
    for (const raw of [999.99, 100.1, 33.33, 1050.5, 1234.56, 0.5]) {
      for (const mode of ['taxable', 'zeroRate', 'exempt'] as const) {
        const r = mode === 'taxable' ? fromTotalByMode(raw, mode) : fromSalesByMode(raw, mode)
        expect(Number.isInteger(r.sales)).toBe(true)
        expect(Number.isInteger(r.tax)).toBe(true)
        expect(Number.isInteger(r.total)).toBe(true)
        expect(r.sales + r.tax).toBe(r.total)
        expect(upperDigits(r.total).some((d) => d !== null)).toBe(true)
      }
    }
  })

  it('負數不產生負銷售額／負稅額／負總計', () => {
    expect(fromTotalByMode(-100, 'taxable')).toEqual({ sales: 0, tax: 0, total: 0 })
    expect(fromSalesByMode(-1000, 'taxable')).toEqual({ sales: 0, tax: 0, total: 0 })
    expect(fromSalesByMode(-1000, 'exempt')).toEqual({ sales: 0, tax: 0, total: 0 })
    expect(fromTotalByMode(NaN, 'zeroRate')).toEqual({ sales: 0, tax: 0, total: 0 })
  })
})

describe('withTaxOverride（稅額手動覆寫）', () => {
  it('總計 = 銷售額 + 稅額，銷售額不動', () => {
    expect(withTaxOverride(10000, 600)).toEqual({ sales: 10000, tax: 600, total: 10600 })
  })

  it('小數稅額四捨五入、負稅額視為 0（總計不會變負數）', () => {
    expect(withTaxOverride(1000, 50.5)).toEqual({ sales: 1000, tax: 51, total: 1051 })
    expect(withTaxOverride(1000, -9999)).toEqual({ sales: 1000, tax: 0, total: 1000 })
    expect(withTaxOverride(-1000, 50)).toEqual({ sales: 0, tax: 50, total: 50 })
  })
})

describe('品項計算', () => {
  it('數量 × 單價', () => {
    expect(lineAmount({ name: 'A', quantity: 3, unitPrice: 120 })).toBe(360)
  })

  it('未填欄位視為 0', () => {
    expect(lineAmount({ name: '', quantity: null, unitPrice: 100 })).toBe(0)
    expect(lineAmount({ name: '', quantity: 2, unitPrice: null })).toBe(0)
  })

  it('多品項加總', () => {
    expect(
      itemsTotal([
        { name: 'A', quantity: 2, unitPrice: 100 },
        { name: 'B', quantity: 1, unitPrice: 350 },
        { name: 'C', quantity: null, unitPrice: null },
      ]),
    ).toBe(550)
  })
})

describe('toChineseUpper（中文大寫）', () => {
  it.each<[number, string]>([
    [0, '零元整'],
    [5, '伍元整'],
    [10, '壹拾元整'],
    [105, '壹佰零伍元整'],
    [1005, '壹仟零伍元整'],
    [1050, '壹仟零伍拾元整'],
    [1500, '壹仟伍佰元整'],
    [10000, '壹萬元整'],
    [10500, '壹萬零伍佰元整'],
    [100005, '壹拾萬零伍元整'],
    [123456, '壹拾貳萬參仟肆佰伍拾陸元整'],
    [100000000, '壹億元整'],
    [100010000, '壹億零壹萬元整'],
    [1000000005, '壹拾億零伍元整'],
  ])('%d → %s', (input, expected) => {
    expect(toChineseUpper(input)).toBe(expected)
  })

  it('連續零只寫一個零', () => {
    expect(toChineseUpper(90000009)).toBe('玖仟萬零玖元整')
  })

  it('非整數或負數回空字串', () => {
    expect(toChineseUpper(1.5)).toBe('')
    expect(toChineseUpper(-1)).toBe('')
  })
})

describe('upperDigits（大寫九格 [億,仟,佰,拾,萬,仟,佰,拾,元]）', () => {
  it('0 → 全為 null', () => {
    expect(upperDigits(0)).toEqual(Array(9).fill(null))
  })

  it('10500 → 高於萬位為 null，其餘逐位大寫', () => {
    expect(upperDigits(10500)).toEqual([null, null, null, null, '壹', '零', '伍', '零', '零'])
  })

  it('100001 → 拾萬位為壹、元位為壹、中間補零', () => {
    expect(upperDigits(100001)).toEqual([null, null, null, '壹', '零', '零', '零', '零', '壹'])
  })

  it('1e8 → 九格全滿（壹億）', () => {
    expect(upperDigits(1e8)).toEqual(['壹', '零', '零', '零', '零', '零', '零', '零', '零'])
  })

  it('非整數或負數 → 全為 null', () => {
    expect(upperDigits(1.5)).toEqual(Array(9).fill(null))
    expect(upperDigits(-10)).toEqual(Array(9).fill(null))
  })

  it('超過九位數（1e9）→ 全為 null', () => {
    expect(upperDigits(1e9)).toEqual(Array(9).fill(null))
  })
})

describe('rocYear / periodStartMonth（民國年與雙月期）', () => {
  it('西元轉民國：2026 → 115', () => {
    expect(rocYear(2026)).toBe(115)
    expect(rocYear(1911)).toBe(0)
  })

  it('六個雙月期起始月固定為 1、3、5、7、9、11', () => {
    expect([...PERIOD_START_MONTHS]).toEqual([1, 3, 5, 7, 9, 11])
  })

  it('各月推算所屬雙月期起始月', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(periodStartMonth)).toEqual([
      1, 1, 3, 3, 5, 5, 7, 7, 9, 9, 11, 11,
    ])
  })

  it('超出範圍或非法值回傳 1', () => {
    expect(periodStartMonth(0)).toBe(1)
    expect(periodStartMonth(13)).toBe(1)
    expect(periodStartMonth(NaN)).toBe(1)
  })
})

describe('rowAmount / rowsTotal（手動覆寫優先）', () => {
  it('amount 為 null 時自動以數量 × 單價計算', () => {
    expect(rowAmount(item({ quantity: 3, unitPrice: 120 }))).toBe(360)
    expect(rowAmount(item())).toBe(0)
  })

  it('amount 有值時覆寫優先（含 0）', () => {
    expect(rowAmount(item({ quantity: 3, unitPrice: 120, amount: 999 }))).toBe(999)
    expect(rowAmount(item({ quantity: 3, unitPrice: 120, amount: 0 }))).toBe(0)
    expect(rowAmount(item({ amount: 500 }))).toBe(500)
  })

  it('rowsTotal 混合自動與覆寫加總', () => {
    expect(
      rowsTotal([
        item({ quantity: 2, unitPrice: 100 }), // 自動 200
        item({ quantity: 1, unitPrice: 350, amount: 300 }), // 覆寫 300
        item(), // 空列 0
        item({ amount: 50 }), // 純覆寫 50
      ]),
    ).toBe(550)
  })
})
