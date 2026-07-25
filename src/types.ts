/** 發票類型：三聯式（有統編）/ 二聯式（無統編） */
export type InvoiceType = 'triplicate' | 'duplicate'

export interface Buyer {
  /** 買受人名稱 */
  name: string
  /** 統一編號（8 碼，三聯式用） */
  ubn: string
  /** 地址 */
  address: string
}

/** 發票品項列；`amount: null` 表示自動由數量 × 單價計算，設值代表使用者手動覆寫 */
export interface InvoiceItem {
  name: string
  quantity: number | null
  unitPrice: number | null
  amount: number | null
  note: string
}

/** 課稅別：應稅／零稅率／免稅 */
export type TaxMode = 'taxable' | 'zeroRate' | 'exempt'
