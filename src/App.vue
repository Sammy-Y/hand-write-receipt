<script setup lang="ts">
import { ref } from 'vue'
import InvoiceSheet from './components/InvoiceSheet.vue'
import {
  clampCopyType,
  fromSalesByMode,
  fromTotalByMode,
  periodStartMonth,
  rocYear,
  rowsTotal,
  withTaxOverride,
  type TaxBreakdown,
} from './lib/invoice'
import type { Buyer, CopyType, InvoiceItem, InvoiceType, TaxMode } from './types'

const ITEM_ROWS = 5

/** 預設民國年（依系統日期，使用者可改） */
function defaultRocYear(): string {
  return String(rocYear(new Date().getFullYear()))
}

/** 預設期別月份：當月所屬雙月期的起始月 */
function defaultPeriodMonth(): string {
  return String(periodStartMonth(new Date().getMonth() + 1))
}

function emptyItem(): InvoiceItem {
  return { name: '', quantity: null, unitPrice: null, amount: null, note: '' }
}

function emptyItems(): InvoiceItem[] {
  return Array.from({ length: ITEM_ROWS }, emptyItem)
}

function emptyBuyer(): Buyer {
  return { name: '', ubn: '', address: '' }
}

const invoiceType = ref<InvoiceType>('triplicate')
// 期別（標題下方）與民國日期（買受人區）的年份各自獨立，預設都是當年民國年
const periodYear = ref(defaultRocYear())
const periodMonth = ref(defaultPeriodMonth())
const buyer = ref<Buyer>(emptyBuyer())
const year = ref(defaultRocYear())
const month = ref('')
const day = ref('')
const items = ref<InvoiceItem[]>(emptyItems())
const sales = ref(0)
const tax = ref(0)
const total = ref(0)
const taxMode = ref<TaxMode>('taxable')
// 註腳右側聯次標示；預設第一聯　存根聯（ui-spec §2「註腳」）
const copyType = ref<CopyType>('stub')

/**
 * 金額三欄一律經由 invoice.ts 的純函式寫入（內含 normalizeMoney）：
 * 發票金額是整數元，不可出現小數、浮點雜訊或負數，否則稅額會印出
 * 47.99000000000001，且 upperDigits() 對非整數／非正數回全 null → 中文大寫九格整排空白。
 */
function applyBreakdown(next: TaxBreakdown) {
  sales.value = next.sales
  tax.value = next.tax
  total.value = next.total
}

/** 由銷售額依稅制往下算稅額與總計 */
function cascadeFromSales(nextSales: number) {
  applyBreakdown(fromSalesByMode(nextSales, taxMode.value))
}

/** 由總計依稅制反推銷售額與稅額 */
function cascadeFromTotal(nextTotal: number) {
  applyBreakdown(fromTotalByMode(nextTotal, taxMode.value))
}

/** 品項合計帶入金額區：三聯式視為銷售額、二聯式視為總計；合計為 0 不覆蓋 */
function applyItemsSum(sum: number) {
  if (sum <= 0) return
  if (invoiceType.value === 'triplicate') cascadeFromSales(sum)
  else cascadeFromTotal(sum)
}

function onItemsUpdate(next: InvoiceItem[]) {
  const before = rowsTotal(items.value)
  items.value = next
  const after = rowsTotal(next)
  if (after !== before) applyItemsSum(after)
}

function onTaxUpdate(nextTax: number) {
  applyBreakdown(withTaxOverride(sales.value, nextTax))
}

function onTaxModeUpdate(mode: TaxMode) {
  if (taxMode.value === mode) return
  taxMode.value = mode
  cascadeFromSales(sales.value)
}

function selectInvoiceType(type: InvoiceType) {
  if (invoiceType.value === type) return
  invoiceType.value = type

  // 二聯式版面沒有稅制欄位（spec §2「二聯式差異」：金額區只有總計列與大寫列），
  // 若沿用三聯式選的零稅率／免稅，畫面上既看不到也改不回來，框外內含稅額會永遠是 $0。
  // 二聯式是含稅零售發票 → 切過去時稅制回應稅，並依新稅制重算金額。
  const restoredTaxable = type === 'duplicate' && taxMode.value !== 'taxable'
  if (restoredTaxable) taxMode.value = 'taxable'

  const sum = rowsTotal(items.value)
  if (sum > 0) applyItemsSum(sum)
  else if (restoredTaxable) cascadeFromTotal(total.value)

  // 聯次夾值（ui-spec §2「註腳」）：目前選的聯次在新類型不存在（如三聯式選了
  // 扣抵聯後切二聯式）就夾到新類型的最後一聯。
  copyType.value = clampCopyType(copyType.value, type)
}

function clearAll() {
  periodYear.value = defaultRocYear()
  periodMonth.value = defaultPeriodMonth()
  buyer.value = emptyBuyer()
  year.value = defaultRocYear()
  month.value = ''
  day.value = ''
  items.value = emptyItems()
  sales.value = 0
  tax.value = 0
  total.value = 0
  taxMode.value = 'taxable'
  copyType.value = 'stub'
}
</script>

<template>
  <div class="min-h-screen bg-base-200">
    <div class="max-w-3xl mx-auto px-4 py-6 flex flex-col gap-6">
      <header class="text-center">
        <h1 class="text-2xl font-bold">手寫發票小幫手</h1>
        <p class="text-sm text-base-content/60 mt-1">
          照紙本發票版面直接填寫，自動帶入稅額拆分與中文大寫，欄欄可手動覆寫
        </p>
      </header>

      <div role="tablist" class="tabs tabs-box justify-center">
        <!-- tabindex + Enter/Space：<a> 沒有 href 不會進 Tab 順序，否則只能用滑鼠切換 -->
        <a
          role="tab"
          class="tab"
          tabindex="0"
          data-testid="tab-triplicate"
          :aria-selected="invoiceType === 'triplicate'"
          :class="{ 'tab-active': invoiceType === 'triplicate' }"
          @click="selectInvoiceType('triplicate')"
          @keydown.enter="selectInvoiceType('triplicate')"
          @keydown.space.prevent="selectInvoiceType('triplicate')"
        >
          三聯式
        </a>
        <a
          role="tab"
          class="tab"
          tabindex="0"
          data-testid="tab-duplicate"
          :aria-selected="invoiceType === 'duplicate'"
          :class="{ 'tab-active': invoiceType === 'duplicate' }"
          @click="selectInvoiceType('duplicate')"
          @keydown.enter="selectInvoiceType('duplicate')"
          @keydown.space.prevent="selectInvoiceType('duplicate')"
        >
          二聯式
        </a>
      </div>

      <div class="overflow-x-auto">
        <InvoiceSheet
          :invoice-type="invoiceType"
          :period-year="periodYear"
          :period-month="periodMonth"
          :buyer="buyer"
          :year="year"
          :month="month"
          :day="day"
          :items="items"
          :sales="sales"
          :tax="tax"
          :total="total"
          :tax-mode="taxMode"
          :copy-type="copyType"
          @update:period-year="periodYear = $event"
          @update:period-month="periodMonth = $event"
          @update:buyer="buyer = $event"
          @update:year="year = $event"
          @update:month="month = $event"
          @update:day="day = $event"
          @update:items="onItemsUpdate"
          @update:sales="cascadeFromSales"
          @update:tax="onTaxUpdate"
          @update:total="cascadeFromTotal"
          @update:taxMode="onTaxModeUpdate"
          @update:copyType="copyType = $event"
        />
      </div>

      <button
        type="button"
        class="btn btn-outline btn-error"
        data-testid="clear-button"
        @click="clearAll"
      >
        清除重填
      </button>

      <footer class="text-center text-xs text-base-content/50 leading-relaxed pb-4">
        稅率 5%，依營業稅法施行細則第 32-1 條四捨五入 ・ 本工具不儲存任何資料
      </footer>
    </div>
  </div>
</template>
