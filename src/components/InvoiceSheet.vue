<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, type ObjectDirective } from 'vue'
import {
  clampDayValue,
  clampMonthValue,
  COPY_OPTIONS,
  formatMoney,
  normalizeMoney,
  PERIOD_START_MONTHS,
  rowAmount,
  upperDigits,
} from '../lib/invoice'
import type { Buyer, CopyType, InvoiceItem, InvoiceType, TaxMode } from '../types'

const props = defineProps<{
  invoiceType: InvoiceType
  /** 期別的民國年（可填，字串） */
  periodYear: string
  /** 期別雙月期的起始月（'1' | '3' | '5' | '7' | '9' | '11'） */
  periodMonth: string
  buyer: Buyer
  /** 民國日期的「年」（可空字串） */
  year: string
  /** 民國日期的「月」（可空字串） */
  month: string
  /** 民國日期的「日」（可空字串） */
  day: string
  items: InvoiceItem[]
  sales: number
  tax: number
  total: number
  taxMode: TaxMode
  /** 註腳右側聯次標示 */
  copyType: CopyType
}>()

const emit = defineEmits<{
  (e: 'update:periodYear', value: string): void
  (e: 'update:periodMonth', value: string): void
  (e: 'update:buyer', value: Buyer): void
  (e: 'update:year', value: string): void
  (e: 'update:month', value: string): void
  (e: 'update:day', value: string): void
  (e: 'update:items', value: InvoiceItem[]): void
  (e: 'update:sales', value: number): void
  (e: 'update:tax', value: number): void
  (e: 'update:total', value: number): void
  (e: 'update:taxMode', value: TaxMode): void
  (e: 'update:copyType', value: CopyType): void
}>()

const isTriplicate = computed(() => props.invoiceType === 'triplicate')

// ---- 期別下拉（固定六個雙月期） ----
const ZH_MONTHS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二']

const PERIOD_OPTIONS = PERIOD_START_MONTHS.map((start) => ({
  value: String(start),
  label: `${ZH_MONTHS[start - 1]}、${ZH_MONTHS[start]}`,
}))

// ---- 註腳右側聯次下拉（依發票類型限縮選項） ----
const copyOptions = computed(() => COPY_OPTIONS[props.invoiceType])

function onCopyTypeChange(event: Event) {
  emit('update:copyType', inputValue(event) as CopyType)
}

// ---- 品項（固定 5 列） ----
const rows = computed(() => props.items.slice(0, 5))

function inputValue(event: Event): string {
  return (event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value
}

/**
 * 自動增高：把 textarea 高度調成內容高度，讓長品名／備註完整換行顯示而不被截斷。
 * 無 layout 的環境（happy-dom 測試、SSR）scrollHeight 為 0，此時保持 CSS 預設高度即可。
 *
 * 冪等：量測時先放開高度限制讀 scrollHeight，讀完立刻還原原值，只有在算出的高度
 * 與現有 inline height 不同時才真的寫入。高度沒變就不留下任何淨變化，
 * 尺寸觀察（ResizeObserver）因此不會被自己的寫入反覆喚醒。
 */
function autoGrow(el: HTMLTextAreaElement | null) {
  if (!el) return
  const current = el.style.height
  el.style.height = 'auto'
  const content = el.scrollHeight
  el.style.height = current
  if (content <= 0) return
  const next = `${content}px`
  if (current !== next) el.style.height = next
}

const vAutogrow: ObjectDirective<HTMLTextAreaElement> = {
  mounted: (el) => autoGrow(el),
  updated: (el) => autoGrow(el),
}

/** 整張發票的根元素；欄寬／字級改變時要重算所有 textarea 高度 */
const sheetEl = ref<HTMLElement | null>(null)

/**
 * 重算全部自動增高 textarea 的高度。
 * inline height 是依「當時的欄寬與字級」算出來的，視窗縮放、開關 devtools、
 * Ctrl +/-、系統最小字級改變後欄寬或行高會變，舊高度配上 overflow: hidden
 * 就會把後面幾行裁掉（吃字），所以尺寸一變就得重算。
 */
function regrowAll() {
  const root = sheetEl.value
  if (!root) return
  root.querySelectorAll('textarea').forEach((el) => autoGrow(el))
}

let sheetObserver: ResizeObserver | null = null
let pendingFrame: number | null = null

/**
 * 排一次「下一個 frame 再重算」。
 *
 * 關鍵：**絕不在 ResizeObserver 回呼裡寫 DOM**。回呼中改 textarea 高度會改變被觀察的
 * .sheet 尺寸，而被觀察元素本身在回呼中變大變小時，這筆新通知的 DOM 深度不比當次
 * 廣播更深，瀏覽器只能把它列為 skipped 並丟出
 * 「ResizeObserver loop completed with undelivered notifications」
 * （dev 會跳 Vite 錯誤遮罩、正式站噴 console error）。
 *
 * 把寫入延到下一個 frame，回呼本身零 DOM 變動，迴圈警告就不存在；而延後寫入造成的
 * 那一次尺寸通知，會因為 autoGrow 冪等（高度已正確 → 不寫）在下一輪自然收斂。
 *
 * 註：不採「寬度沒變就 bail」的做法——字級變大（Ctrl +／系統最小字級）時欄寬不變、
 * 行高卻變了，bail 會讓舊高度配上 overflow: hidden 直接吃掉後面幾行（e2e 第 17 條）。
 */
function scheduleRegrow() {
  if (typeof requestAnimationFrame !== 'function') {
    regrowAll()
    return
  }
  if (pendingFrame !== null) return
  pendingFrame = requestAnimationFrame(() => {
    pendingFrame = null
    regrowAll()
  })
}

onMounted(() => {
  if (typeof ResizeObserver !== 'undefined' && sheetEl.value) {
    // 觀察整張發票：欄寬（表格寬度）或字級改變都會讓 .sheet 的尺寸改變。
    sheetObserver = new ResizeObserver(scheduleRegrow)
    sheetObserver.observe(sheetEl.value)
  }
  // 沒有 ResizeObserver 的環境退回視窗 resize（至少涵蓋縮視窗這條主要路徑）
  window.addEventListener('resize', scheduleRegrow)
})

onBeforeUnmount(() => {
  sheetObserver?.disconnect()
  sheetObserver = null
  if (pendingFrame !== null && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(pendingFrame)
  }
  pendingFrame = null
  window.removeEventListener('resize', scheduleRegrow)
})

function onTextareaInput(event: Event, apply: (value: string) => void) {
  const el = event.target as HTMLTextAreaElement
  apply(el.value)
  autoGrow(el)
}

/** number input 值 → number | null（清空 = null）。數量／單價允許小數（秤重、單價含角） */
function parseNullable(raw: string): number | null {
  if (raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

/**
 * 目前正在編輯中（已 focus、尚未 blur）的金額欄位暫存顯示字串，key 為
 * `item-amount-N`／`item-price-N`／`sales`／`tax`／`total`。
 * key 存在於此表示「編輯中」：顯示純數字（不含千分位）且逐鍵同步這裡的值，
 * 千分位格式化只在 blur（或從未 focus 過，例如被連動更新的欄位）時套用——
 * 否則使用者打字途中每個鍵盤事件都重新插入逗號，游標會亂跳，單價的小數點／
 * 結尾字元也會被強制打斷（ui-spec.md「金額千分位」）。
 */
const drafts = reactive<Record<string, string>>({})

/** 金額字串加千分位；空字串（紙本留白）維持空白 */
function formatOrBlank(raw: string): string {
  return raw === '' ? '' : formatMoney(Number(raw))
}

/**
 * 金額欄（列金額／銷售額／稅額／總計）值 → 整數元：
 * 先剝除千分位逗號，小數四捨五入、負數與非法值視為 0（發票上不存在小數元或負金額）。
 * 少了剝除逗號，使用者貼上「10,500」會被 Number() 判成 NaN 而被 normalizeMoney 歸零。
 */
function parseMoney(raw: string): number {
  return normalizeMoney(Number(raw.replace(/,/g, '')))
}

/** 銷售額／稅額／總計「純數字」值：0 依紙本留白規則不變 */
function rawMoneyDisplay(v: number): string {
  return v === 0 ? '' : String(v)
}

/** 銷售額／稅額／總計顯示：編輯中顯示純數字；否則（含被連動更新、從未 focus 過）顯示千分位 */
function moneyDisplay(key: string, v: number): string {
  if (key in drafts) return drafts[key]
  return formatOrBlank(rawMoneyDisplay(v))
}

/**
 * 三個 focus handler（金額／列金額／單價）共用：把 `el.value` 同步改寫成 `raw`
 * （千分位格式「12,345」→ 純數字「12345」），並在改寫後把選取範圍設回「整段全選」。
 *
 * 原生 DOM 對 `el.value` 賦值一律會把選取範圍重置成游標收合在字尾——即使賦值前
 * 已經是全選也一樣。一開始的作法是「賦值前記錄是否已為全選、賦值後只在原本就是
 * 全選時才還原」，這對真實鍵盤 Tab 進入（瀏覽器在 focus 事件當下就已建立好全選，
 * 我們的 handler 觀察得到）有效；但用獨立 harness 逐步量測後發現對 Playwright
 * `fill()` 無效——`fill()` 內部呼叫 `input.select()` 來全選，而 `.select()` 是在
 * focus 事件「派發完成之後」才真正套用全選範圍，我們的 handler 執行當下量到的
 * 還是尚未套用的預設狀態（collapsed），判斷結果永遠是「非全選」，於是永遠不還原，
 * 附加（而非取代）的 bug 依舊出現（如 12345 + 500 → 12345500）。
 *
 * 因此改為「賦值後一律設回全選」，不再依賴賦值前的（在多種觸發路徑下並不可靠的）
 * 選取狀態判斷。這對可能誤傷的情境（使用者用滑鼠點欄位中間、想在特定位置插入字元）
 * 影響有限：這批欄位本來就是「一次填一個完整金額」的用途（類似試算表儲存格），
 * 聚焦即全選、方便直接打新數字覆蓋，是這類欄位常見且合理的互動慣例；且該情境
 * 目前不在任何測試涵蓋範圍內。
 *
 * `setSelectionRange` 在部分 input type（如 number、email）上會拋錯或不存在；
 * 三個呼叫端目前都是 `type="text"`，故可用，但仍以 `typeof` 防護，避免日後欄位
 * type 改變時整段炸掉。
 */
function focusRewrite(el: HTMLInputElement, raw: string) {
  if (el.value === raw) return
  el.value = raw
  if (typeof el.setSelectionRange === 'function') {
    el.setSelectionRange(0, raw.length)
  }
}

/**
 * focus 時切成純數字顯示：除了更新 drafts（供下次 render 用），也要「同步」把 DOM
 * 的 value 直接改寫成純數字，不能只靠 Vue 之後的 reactive re-render。
 * 少了這一步，畫面從「10,000」變成「10000」會延到下一個 tick 才由 Vue 補上；
 * 這段空窗期間如果有任何動作（例如自動化測試的 fill()、或使用者緊接著打字）
 * 先用了還沒改寫的「10,000」，之後 Vue 才把 value 改成「10000」，時序就會亂掉。
 *
 * 同步回寫本身也有陷阱：原生 DOM 對 `el.value` 賦值一律會把選取範圍重置成游標
 * 收合在字尾。若使用者剛好是用鍵盤 Tab 進來（瀏覽器對已有內容的欄位會全選）或
 * 自動化工具呼叫 fill()，這裡的回寫會把選取範圍清掉，接下來的輸入就會變成
 * 「附加」而不是「取代」，兩段數字黏在一起（如 10000 + 3000 → 100003000）。
 * 因此改寫透過 `focusRewrite`：回寫後一律把選取範圍設回全選，讓後續輸入
 * （不論是使用者打字或自動化工具的插入）維持「取代」語意（詳見該函式註解）。
 */
function onMoneyFocus(event: FocusEvent, key: string, v: number) {
  const raw = rawMoneyDisplay(v)
  drafts[key] = raw
  focusRewrite(event.target as HTMLInputElement, raw)
}

function onMoneyBlur(key: string) {
  delete drafts[key]
}

/**
 * 金額欄輸入：正規化成整數元，並把正規化後的字串同步寫回 DOM。
 * 少了這個回寫，使用者打的 -100／999.99 在正規化結果與目前值相同時（例如 -100 → 0，
 * 而金額本來就是 0）不會觸發 Vue 重新 patch，畫面就會殘留負數／小數，和實際金額不一致。
 * 編輯中（drafts 有這個 key）回寫純數字；未在編輯（例如測試直接 setValue、或貼上後
 * 從未 focus 過）則直接回寫千分位格式，兩者都要與剛正規化出來的 value 一致。
 */
function onMoneyInput(key: string, event: Event, apply: (value: number) => void) {
  const el = event.target as HTMLInputElement
  const editing = key in drafts
  const value = parseMoney(el.value)
  const raw = rawMoneyDisplay(value)
  const display = editing ? raw : formatOrBlank(raw)
  if (editing) drafts[key] = display
  if (el.value !== display) el.value = display
  apply(value)
}

/**
 * 列金額「純數字」值：手動覆寫（含明確填 0，例如贈品列）照原值顯示；
 * 未覆寫時自動顯示 數量 × 單價，為 0 則留白（紙本空格）。
 */
function amountRaw(item: InvoiceItem): string {
  if (item.amount !== null) return String(item.amount)
  const v = rowAmount(item)
  return v === 0 ? '' : String(v)
}

/** 列金額顯示：編輯中顯示純數字，否則顯示千分位格式 */
function amountDisplay(item: InvoiceItem, index: number): string {
  const key = `item-amount-${index}`
  if (key in drafts) return drafts[key]
  return formatOrBlank(amountRaw(item))
}

/** focus 切純數字需同步回寫 DOM，理由同 focusRewrite 的說明（避免清掉 focus 當下的全選範圍） */
function onAmountFocus(event: FocusEvent, item: InvoiceItem, index: number) {
  const raw = amountRaw(item)
  drafts[`item-amount-${index}`] = raw
  focusRewrite(event.target as HTMLInputElement, raw)
}

function onAmountBlur(index: number) {
  delete drafts[`item-amount-${index}`]
}

/** 列金額輸入：清空 = 回自動計算（null）；其餘正規化成整數元（明確填 0 保留顯示 0） */
function onAmountInput(event: Event, index: number) {
  const el = event.target as HTMLInputElement
  const key = `item-amount-${index}`
  const editing = key in drafts
  if (el.value === '') {
    if (editing) drafts[key] = ''
    patchItem(index, { amount: null })
    return
  }
  const value = parseMoney(el.value)
  const raw = String(value)
  const display = editing ? raw : formatMoney(value)
  if (editing) drafts[key] = display
  if (el.value !== display) el.value = display
  patchItem(index, { amount: value })
}

/** 單價顯示：編輯中顯示純數字，否則顯示千分位格式（只加在整數部分，小數保留原樣） */
function priceDisplay(item: InvoiceItem, index: number): string {
  const key = `item-price-${index}`
  if (key in drafts) return drafts[key]
  return formatOrBlank(item.unitPrice === null ? '' : String(item.unitPrice))
}

/** focus 切純數字需同步回寫 DOM，理由同 focusRewrite 的說明（避免清掉 focus 當下的全選範圍） */
function onPriceFocus(event: FocusEvent, item: InvoiceItem, index: number) {
  const raw = item.unitPrice === null ? '' : String(item.unitPrice)
  drafts[`item-price-${index}`] = raw
  focusRewrite(event.target as HTMLInputElement, raw)
}

function onPriceBlur(index: number) {
  delete drafts[`item-price-${index}`]
}

/**
 * 濾除單價欄不合法的字元：只保留數字與最多一個小數點（等同 /^\d*\.?\d*$/）。
 * 逐字元過濾而非數值轉換，是為了保留「使用者打到一半的小數點」——例如「12.」
 * 要能停留原樣，不能被強制清成「12」（ui-spec.md「金額千分位」）。
 * 這個欄位改成 type="text" 後失去瀏覽器原生的數字鍵盤過濾，若不在這裡濾除字母
 * 等雜訊字元，使用者可以打出「1a2.5b」這種字串：`parseNullable` 對它算出 NaN、
 * 整列單價被判為 null、金額歸零，且會在 blur 時被靜默清空，使用者不會知道自己
 * 打的字被丟掉了。
 */
function filterPriceChars(raw: string): string {
  const digitsAndDot = raw.replace(/[^\d.]/g, '')
  const firstDot = digitsAndDot.indexOf('.')
  if (firstDot === -1) return digitsAndDot
  // 只留第一個小數點，之後再輸入的小數點一律濾掉（值仍是合法數字，不會變成 NaN）
  return digitsAndDot.slice(0, firstDot + 1) + digitsAndDot.slice(firstDot + 1).replace(/\./g, '')
}

/**
 * 單價輸入：允許小數（秤重、單價含角），剝除千分位逗號與非數字雜訊字元
 * （見 filterPriceChars），不四捨五入／不清成整數。
 * 編輯中維持使用者剛輸入的原始字元（含小數點、結尾字元），避免每個輸入事件都把
 * 「12.」這種打字打到一半的字串強制改寫成「12」，讓使用者打不出小數。
 */
function onPriceInput(event: Event, index: number) {
  const el = event.target as HTMLInputElement
  const key = `item-price-${index}`
  const editing = key in drafts
  const cleaned = filterPriceChars(el.value.replace(/,/g, ''))
  const value = parseNullable(cleaned)
  const display = editing ? cleaned : formatOrBlank(value === null ? '' : String(value))
  if (editing) drafts[key] = display
  if (el.value !== display) el.value = display
  patchItem(index, { unitPrice: value, amount: null })
}

/**
 * 民國年／月／日與期別年份只收阿拉伯數字（spec：民國年阿拉伯數字 3 碼、inputmode="numeric"）。
 * 濾掉非數字後同步寫回 DOM，避免濾除結果與舊值相同時 Vue 不更新、畫面殘留「115a」。
 */
function digitsOnly(event: Event): string {
  const el = event.target as HTMLInputElement
  const cleaned = el.value.replace(/\D/g, '')
  if (el.value !== cleaned) el.value = cleaned
  return cleaned
}

/** 民國日期「日」input 的 DOM 元素；月／年變動時要把重新夾好的值回寫到這個（別的）欄位 */
const dateDayInputEl = ref<HTMLInputElement | null>(null)

/**
 * 依（可能剛變動的）年、月，把現有的日夾到合法上限（daysInMonth）；
 * 超出上限才 emit 新值並回寫日期日 input 的 DOM——
 * 沿用金額欄同樣的回寫做法（ui-spec §2 民國日期行「日期合法性驗證」）：
 * 少了回寫，夾值結果與畫面顯示的舊值不同步時，使用者打的無效日仍會殘留在畫面上。
 */
function reclampDay(nextYear: string, nextMonth: string) {
  const clamped = clampDayValue(
    parseNullable(props.day),
    parseNullable(nextYear),
    parseNullable(nextMonth),
  )
  const nextDay = clamped === null ? '' : String(clamped)
  if (nextDay !== props.day) emit('update:day', nextDay)
  const el = dateDayInputEl.value
  if (el && el.value !== nextDay) el.value = nextDay
}

/** 民國日期「年」：只收數字；年份改變可能讓二月 29 日失效，故連帶重新夾日 */
function onDateYearInput(event: Event) {
  const cleaned = digitsOnly(event)
  emit('update:year', cleaned)
  reclampDay(cleaned, props.month)
}

/** 民國日期「月」：只收數字，並夾到 1～12；月份改變的月天數不同，連帶重新夾日 */
function onDateMonthInput(event: Event) {
  const el = event.target as HTMLInputElement
  const cleaned = digitsOnly(event)
  const clampedMonth = clampMonthValue(parseNullable(cleaned))
  const nextMonth = clampedMonth === null ? '' : String(clampedMonth)
  if (el.value !== nextMonth) el.value = nextMonth
  emit('update:month', nextMonth)
  reclampDay(props.year, nextMonth)
}

/** 民國日期「日」：只收數字，並依目前年、月夾到 1～該月天數（不存在的日期，如 8/32） */
function onDateDayInput(event: Event) {
  const el = event.target as HTMLInputElement
  const cleaned = digitsOnly(event)
  const clampedDay = clampDayValue(
    parseNullable(cleaned),
    parseNullable(props.year),
    parseNullable(props.month),
  )
  const nextDay = clampedDay === null ? '' : String(clampedDay)
  if (el.value !== nextDay) el.value = nextDay
  emit('update:day', nextDay)
}

function patchItem(index: number, patch: Partial<InvoiceItem>) {
  emit(
    'update:items',
    props.items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
  )
}

function patchBuyer(patch: Partial<Buyer>) {
  emit('update:buyer', { ...props.buyer, ...patch })
}

// ---- 稅制 ----
const TAX_MODE_CELLS: { mode: TaxMode; testid: string }[] = [
  { mode: 'taxable', testid: 'tax-mode-taxable' },
  { mode: 'zeroRate', testid: 'tax-mode-zero' },
  { mode: 'exempt', testid: 'tax-mode-exempt' },
]

// ---- 中文大寫九格 ----
const UPPER_UNITS = ['億', '仟', '佰', '拾', '萬', '仟', '佰', '拾', '元']
const upperSlots = computed(() =>
  upperDigits(props.total).map((digit, i) => ({
    digit,
    unit: UPPER_UNITS[i],
    // 總計有值（正整數）時，高於最高有效位、沒有大寫數字的格子要橫線槓掉；
    // 總計為 0 或空白（upperDigits 全回 null）時九格一律不劃線。
    struck: digit === null && props.total > 0,
  })),
)
</script>

<template>
  <div class="invoice-wrap">
    <div ref="sheetEl" class="sheet">
      <h2 class="title">統　一　發　票（{{ isTriplicate ? '三聯式' : '二聯式' }}）</h2>

      <!-- 期別：年可填、月份為固定六個雙月期下拉，整行置中 -->
      <p class="period">
        <input
          type="text"
          inputmode="numeric"
          maxlength="3"
          aria-label="期別民國年"
          class="paper-input period-year"
          data-testid="period-year-input"
          :value="periodYear"
          @input="emit('update:periodYear', digitsOnly($event))"
        />
        <span class="printed">年</span>
        <select
          aria-label="期別月份"
          class="paper-input period-select"
          data-testid="period-month-select"
          :value="periodMonth"
          @change="emit('update:periodMonth', inputValue($event))"
        >
          <option v-for="opt in PERIOD_OPTIONS" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>
        <span class="printed">月份</span>
      </p>

      <div class="buyer">
        <div class="buyer-line">
          <label class="field">
            <span class="field-label">買 受 人：</span>
            <input
              type="text"
              class="line-input"
              data-testid="buyer-name-input"
              :value="buyer.name"
              @input="patchBuyer({ name: inputValue($event) })"
            />
          </label>
        </div>

        <!-- 民國日期行：左欄放統一編號（三聯式），日期整組置中於紙張寬度（左右各留 1fr） -->
        <div class="date-line">
          <div class="date-side">
            <label v-if="isTriplicate" class="field">
              <span class="field-label">統一編號：</span>
              <input
                type="text"
                inputmode="numeric"
                maxlength="8"
                class="line-input ubn-input"
                data-testid="ubn-input"
                :value="buyer.ubn"
                @input="patchBuyer({ ubn: inputValue($event) })"
              />
            </label>
          </div>

          <span class="roc-date">
            <span class="roc-label">中華民國</span>
            <input
              type="text"
              inputmode="numeric"
              maxlength="3"
              aria-label="開立日期民國年"
              class="line-input date-input date-year"
              data-testid="date-year-input"
              :value="year"
              @input="onDateYearInput($event)"
            />
            <span class="printed">年</span>
            <input
              type="text"
              inputmode="numeric"
              maxlength="2"
              aria-label="開立日期月"
              class="line-input date-input"
              data-testid="date-month-input"
              :value="month"
              @input="onDateMonthInput($event)"
            />
            <span class="printed">月</span>
            <input
              ref="dateDayInputEl"
              type="text"
              inputmode="numeric"
              maxlength="2"
              aria-label="開立日期日"
              class="line-input date-input"
              data-testid="date-day-input"
              :value="day"
              @input="onDateDayInput($event)"
            />
            <span class="printed">日</span>
          </span>

          <div class="date-side" aria-hidden="true"></div>
        </div>

        <div class="buyer-line">
          <label class="field">
            <span class="field-label">地　　址：</span>
            <input
              type="text"
              class="line-input"
              data-testid="buyer-address-input"
              :value="buyer.address"
              @input="patchBuyer({ address: inputValue($event) })"
            />
          </label>
        </div>
      </div>

      <!-- 底層分成 9 個細欄，讓營業稅列的格線（標籤較寬、三子欄均分）
           不必與上方數量／單價欄切齊（同紙本）。
           邊界：12｜23｜27｜32｜39｜41｜50｜69｜100 -->
      <table class="invoice-grid">
        <colgroup>
          <col style="width: 12%" />
          <col style="width: 11%" />
          <col style="width: 4%" />
          <col style="width: 5%" />
          <col style="width: 7%" />
          <col style="width: 2%" />
          <col style="width: 9%" />
          <col style="width: 19%" />
          <col style="width: 31%" />
        </colgroup>
        <thead>
          <tr>
            <th colspan="3" class="head head-wide bl2 bt2">品　　　　名</th>
            <th colspan="2" class="head bt2">數　量</th>
            <th colspan="2" class="head bt2">單　價</th>
            <th class="head head-wide bt2">金　　額</th>
            <th class="head head-wide bt2 br2">備　　　註</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(item, i) in rows" :key="i">
            <td colspan="3" class="bl2">
              <!-- 品名：自動增高 textarea，長字自動換行、列高隨之增長，不截斷 -->
              <textarea
                v-autogrow
                rows="1"
                class="cell-input cell-textarea"
                :data-testid="`item-name-${i}`"
                :value="item.name"
                @input="onTextareaInput($event, (value) => patchItem(i, { name: value }))"
              ></textarea>
            </td>
            <td colspan="2">
              <input
                type="number"
                class="cell-input num"
                :data-testid="`item-qty-${i}`"
                :value="item.quantity ?? ''"
                @input="patchItem(i, { quantity: parseNullable(inputValue($event)), amount: null })"
              />
            </td>
            <td colspan="2">
              <input
                type="text"
                inputmode="decimal"
                class="cell-input num"
                :data-testid="`item-price-${i}`"
                :value="priceDisplay(item, i)"
                @input="onPriceInput($event, i)"
                @focus="onPriceFocus($event, item, i)"
                @blur="onPriceBlur(i)"
              />
            </td>
            <td>
              <input
                type="text"
                inputmode="numeric"
                class="cell-input num"
                :data-testid="`item-amount-${i}`"
                :value="amountDisplay(item, i)"
                @input="onAmountInput($event, i)"
                @focus="onAmountFocus($event, item, i)"
                @blur="onAmountBlur(i)"
              />
            </td>
            <td v-if="i < 2" class="br2">
              <textarea
                v-autogrow
                rows="1"
                class="cell-input cell-textarea"
                :data-testid="`item-note-${i}`"
                :value="item.note"
                @input="onTextareaInput($event, (value) => patchItem(i, { note: value }))"
              ></textarea>
            </td>
            <!-- 第 3 列：專用章印刷字獨立一格，底邊即文字下方那條格線 -->
            <td v-else-if="i === 2" class="stamp br2">營業人蓋用統一發票專用章</td>
            <!-- 第 4 列起：單一合併空白格，一路延伸到表格最後一列（大寫列），
                 讓 2px 外框完整圍住右下角的蓋章區 -->
            <td v-else-if="i === 3" :rowspan="isTriplicate ? 7 : 4" class="stamp-blank br2 bb2"></td>
          </tr>

          <template v-if="isTriplicate">
            <tr>
              <td colspan="7" class="label-cell bl2">銷　售　額　合　計</td>
              <td>
                <input
                  type="text"
                  inputmode="numeric"
                  class="cell-input num"
                  data-testid="sales-input"
                  :value="moneyDisplay('sales', sales)"
                  @input="onMoneyInput('sales', $event, (value) => emit('update:sales', value))"
                  @focus="onMoneyFocus($event, 'sales', sales)"
                  @blur="onMoneyBlur('sales')"
                />
              </td>
            </tr>
            <tr>
              <td rowspan="2" colspan="2" class="label-cell bl2">營　業　稅</td>
              <td colspan="2" class="subhead">應　稅</td>
              <!-- 「零稅率」是連在一起的一組（同紙本），不分散對齊拉開成「零 稅 率」 -->
              <td colspan="2" class="subhead subhead-tight">零稅率</td>
              <td class="subhead">免　稅</td>
              <td rowspan="2">
                <input
                  type="text"
                  inputmode="numeric"
                  class="cell-input num"
                  data-testid="tax-input"
                  :value="moneyDisplay('tax', tax)"
                  @input="onMoneyInput('tax', $event, (value) => emit('update:tax', value))"
                  @focus="onMoneyFocus($event, 'tax', tax)"
                  @blur="onMoneyBlur('tax')"
                />
              </td>
            </tr>
            <tr>
              <td
                v-for="(cell, ci) in TAX_MODE_CELLS"
                :key="cell.mode"
                :colspan="ci < 2 ? 2 : 1"
                class="check"
                role="button"
                tabindex="0"
                :data-testid="cell.testid"
                :aria-pressed="taxMode === cell.mode"
                @click="emit('update:taxMode', cell.mode)"
                @keydown.enter="emit('update:taxMode', cell.mode)"
                @keydown.space.prevent="emit('update:taxMode', cell.mode)"
              >
                {{ taxMode === cell.mode ? '✓' : '' }}
              </td>
            </tr>
          </template>

          <tr>
            <td colspan="7" class="label-cell bl2">總　　　　計</td>
            <td>
              <input
                type="text"
                inputmode="numeric"
                class="cell-input num"
                data-testid="total-input"
                :value="moneyDisplay('total', total)"
                @input="onMoneyInput('total', $event, (value) => emit('update:total', value))"
                @focus="onMoneyFocus($event, 'total', total)"
                @blur="onMoneyBlur('total')"
              />
            </td>
          </tr>
          <tr>
            <td class="upper-label bl2 bb2">總計新臺幣<br />（中文大寫）</td>
            <td colspan="7" class="upper-cell bb2">
              <div class="upper-row" data-testid="chinese-upper">
                <span
                  v-for="(slot, i) in upperSlots"
                  :key="i"
                  class="upper-slot"
                  :class="{ 'upper-slot--struck': slot.struck }"
                  :data-testid="slot.struck ? `upper-struck-${i}` : undefined"
                >
                  <span v-if="slot.digit" class="upper-digit" :data-testid="`upper-digit-${i}`">{{
                    slot.digit
                  }}</span
                  ><span class="upper-unit">{{ slot.unit }}</span>
                </span>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <div class="footnote">
        <!-- 二聯式沒有應稅／零稅率／免稅欄位，這句只在三聯式顯示；
             左側留空但這一列仍保留，維持版面高度（ui-spec §2「註腳」／「二聯式差異」） -->
        <span class="footnote-rule">{{
          isTriplicate
            ? '※應稅、零稅率、免稅之銷售額應分別開立統一發票，並應於各該欄打「✓」。'
            : ''
        }}</span>
        <select
          aria-label="聯次"
          class="copy-select"
          data-testid="copy-select"
          :value="copyType"
          @change="onCopyTypeChange($event)"
        >
          <option v-for="opt in copyOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>
      </div>
    </div>

    <p v-if="!isTriplicate" class="dup-note">
      <span data-testid="tax-readonly">內含稅額 ${{ formatMoney(tax) }}</span
      >｜<span data-testid="sales-readonly">銷售額 ${{ formatMoney(sales) }}</span>
    </p>
  </div>
</template>

<style scoped>
/* 紙本發票樣式：配色固定（cream 紙、olive 墨），不隨深淺色主題變動 */
.invoice-wrap {
  --paper: #f5f3e7;
  --ink: #6b6414;
  /* 手寫墨（藍）：使用者填的大寫數字用此色，與 olive 印刷字區隔 */
  --hand-ink: #1d4ed8;
  min-width: 640px;
}

.sheet {
  background: var(--paper);
  color: var(--ink);
  border: 1px solid color-mix(in srgb, var(--ink) 55%, var(--paper));
  box-shadow: 0 1px 4px rgb(0 0 0 / 0.12);
  padding: 1rem 1.25rem 0.75rem;
  font-family: 'Noto Serif TC', 'Songti TC', 'PMingLiU', 'MingLiU', serif;
  font-size: 0.95rem;
  line-height: 1.4;
}

.title {
  text-align: center;
  font-size: 1.45rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  margin: 0;
}

/* ---- 期別（年 input + 月份下拉，整行置中） ---- */
.period {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 0.15rem;
  font-size: 1.05rem;
  font-weight: 600;
  letter-spacing: 0.12em;
  margin: 0.15rem 0 0.6rem;
}

.printed {
  white-space: nowrap;
}

/* 透明底、僅底線的紙本風輸入元件（期別用） */
.paper-input {
  border: 0;
  border-bottom: 1px solid color-mix(in srgb, var(--ink) 45%, var(--paper));
  background: transparent;
  color: inherit;
  font: inherit;
  letter-spacing: inherit;
  text-align: center;
  padding: 0 0.15rem;
  appearance: none;
  -webkit-appearance: none;
}

.paper-input:focus {
  outline: 2px solid color-mix(in srgb, var(--ink) 35%, var(--paper));
  outline-offset: -2px;
}

.period-year {
  width: 3.2em;
}

/* 下拉：紙本樣式（透明底、僅底線、olive 字），右側極小箭頭提示可點。
   箭頭需與後面的印刷字「月份」留白，否則會被讀成多一個雜訊字元。 */
.period-select {
  width: 5.6em;
  padding-right: 0.6em;
  margin-right: 0.35rem;
  cursor: pointer;
  text-align: center;
  text-align-last: center;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8 6'%3E%3Cpath d='M0 0h8L4 6z' fill='%236b6414'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 0.08em center;
  background-size: 0.45em 0.34em;
}

.period-select:hover {
  background-color: color-mix(in srgb, var(--ink) 8%, var(--paper));
}

/* 下拉的選項清單由瀏覽器繪製，字色需另外指定才不會吃到系統預設 */
.period-select option {
  color: #1a1a1a;
}

/* ---- 買受人資訊區 ---- */
.buyer {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  margin-bottom: 0.5rem;
}

.buyer-line {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1.25rem;
}

/* 民國日期行：左右各 1fr、日期在中間 auto 欄 → 日期整組水平置中於紙張寬度，
   同時統一編號靠左且不與日期重疊 */
.date-line {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: baseline;
  gap: 0.75rem;
}

.date-side {
  display: flex;
  align-items: baseline;
  min-width: 0;
}

.field {
  display: flex;
  align-items: baseline;
  gap: 0.35rem;
  flex: 1 1 auto;
  min-width: 0;
}

.field-label {
  font-weight: 700;
  letter-spacing: 0.08em;
  white-space: nowrap;
}

.roc-date {
  display: flex;
  align-items: baseline;
  gap: 0.15rem;
  font-weight: 700;
  white-space: nowrap;
}

.roc-label {
  letter-spacing: 0.35em;
  padding-right: 0.1rem;
}

.line-input {
  flex: 1 1 auto;
  min-width: 0;
  border: 0;
  border-bottom: 1px solid color-mix(in srgb, var(--ink) 60%, var(--paper));
  background: transparent;
  color: inherit;
  font: inherit;
  padding: 0 0.25rem;
}

.ubn-input {
  flex: 0 1 9em;
  letter-spacing: 0.2em;
}

.date-input {
  flex: none;
  width: 2.2em;
  text-align: center;
}

.date-year {
  width: 3.2em;
}

/* ---- 主表格 ----
   注意：class 不可叫 .grid，會撞到 Tailwind 的 display:grid utility，
   使 table 排版整個崩壞（thead/tbody 脫離、colgroup 失效）。 */
.invoice-grid {
  display: table;
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}

/* 用 :where() 讓這條基礎樣式的特異性維持在 class 層級（0,1,0＋scoped 屬性），
   否則 `.invoice-grid th` 的 type selector 會贏過下面 .bt2／.head 等修飾 class，
   把 2px 外框與印刷字內距整組蓋掉（border shorthand 也會重設 border-*-width）。 */
.invoice-grid :where(th, td) {
  border: 1px solid var(--ink);
  padding: 0;
  height: 2.3rem;
  font-weight: inherit;
  vertical-align: middle;
}

/* 外框 2px（逐格標註；備註欄的合併蓋章格延伸到最後一列，外框完整圍住整張表） */
.bt2 {
  border-top-width: 2px;
}
.bb2 {
  border-bottom-width: 2px;
}
.bl2 {
  border-left-width: 2px;
}
.br2 {
  border-right-width: 2px;
}

/* 印刷標籤字距：分散對齊撐滿儲存格（品在最左、名在最右），同紙本印刷。
   內距要夠大，字才不會貼齊格線、讓「名｜數」「量｜單」跨格線黏成一個詞；
   但也不能大到在 min-width 640px（欄最窄）時把印刷字擠到換行，故窄欄用較小內距。 */
.head {
  text-align: justify;
  text-align-last: justify;
  font-weight: 700;
  padding: 0.3rem 0.5rem;
}

/* 寬欄（品名／金額／備註）內距加大，字離格線更遠、更接近紙本 */
.head-wide {
  padding-inline: 1rem;
}

.cell-input {
  display: block;
  width: 100%;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  padding: 0.4rem 0.45rem;
}

/* 品名／備註：自動增高（JS 依 scrollHeight 調整），文字換行不截斷 */
.cell-textarea {
  resize: none;
  overflow: hidden;
  white-space: pre-wrap;
  overflow-wrap: break-word;
  word-break: break-word;
  line-height: 1.5;
  height: auto;
  min-height: calc(1.5em + 0.8rem);
}

.cell-input:focus,
.line-input:focus {
  outline: 2px solid color-mix(in srgb, var(--ink) 35%, var(--paper));
  outline-offset: -2px;
}

.num {
  text-align: right;
}

/* 隱藏 number input 的上下箭頭，維持紙本觀感 */
.cell-input::-webkit-outer-spin-button,
.cell-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.cell-input[type='number'] {
  -moz-appearance: textfield;
  appearance: textfield;
}

/* 專用章印刷字：獨立一格（第 3 列高度），底邊格線即文字下方那條線 */
.stamp {
  text-align: justify;
  text-align-last: justify;
  vertical-align: middle;
  /* 印刷字幾乎等於欄寬（min-width 640px 時只差 1px），橫向內距只會逼它換行；
     這格是整串置中印刷字，不存在與鄰欄黏在一起的問題 */
  padding: 0.4rem 0;
  font-weight: 700;
}

/* 專用章下方的合併空白蓋章區（延伸到表格最後一列） */
.stamp-blank {
  height: auto;
}

.label-cell {
  text-align: justify;
  text-align-last: justify;
  font-weight: 700;
  padding: 0.3rem 1rem;
}

.subhead {
  text-align: justify;
  text-align-last: justify;
  font-weight: 700;
  font-size: 0.85rem;
  padding: 0.15rem 0.3rem;
  height: auto;
}

/* 「零稅率」三字連成一組置中（格窄，分散對齊會拉開又貼線） */
.subhead-tight {
  text-align: center;
  text-align-last: center;
  padding-inline: 0.15rem;
}

.check {
  text-align: center;
  height: 1.5rem;
  cursor: pointer;
  user-select: none;
  font-weight: 700;
}

.check:hover {
  background: color-mix(in srgb, var(--ink) 8%, var(--paper));
}

/* ---- 中文大寫九格 ---- */
.upper-label {
  text-align: center;
  font-size: 0.72rem;
  font-weight: 700;
  line-height: 1.35;
  /* 同 .stamp：置中兩行小字，橫向內距沒有視覺作用卻會擠到換行 */
  padding: 0.25rem 0;
}

.upper-cell {
  padding: 0.25rem 0.3rem;
}

.upper-row {
  display: flex;
}

/* 每格等寬，「大寫數字 + 印刷單位字」整組在格內置中（不貼齊格線左緣） */
.upper-slot {
  position: relative;
  flex: 1 1 0;
  display: flex;
  align-items: baseline;
  justify-content: center;
  font-weight: 700;
  letter-spacing: 0.05em;
  white-space: nowrap;
}

/* 沒有大寫數字的空格（高於最高有效位）：橫線槓掉整格，防止事後塗改加大金額。
   線用 ::after 畫在格內、橫貫整格；印刷單位字仍需疊在線之上可見。 */
.upper-slot--struck::after {
  content: '';
  position: absolute;
  left: 4%;
  right: 4%;
  top: 50%;
  height: 2px;
  background: var(--ink);
  transform: translateY(-50%);
  z-index: 0;
}

/* 實際數值用手寫墨藍色、略大略粗，與 olive 印刷單位字明顯區隔 */
.upper-digit {
  position: relative;
  z-index: 1;
  color: var(--hand-ink);
  font-size: 1.12em;
  font-weight: 800;
}

.upper-unit {
  position: relative;
  z-index: 1;
  color: var(--ink);
}

/* ---- 註腳 ---- */
.footnote {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  margin-top: 0.4rem;
  font-size: 0.72rem;
}

/* 聯次下拉：樣式比照期別下拉（透明底、無框、olive 印刷色、appearance: none 加極小箭頭），
   但字級同註腳（0.72rem，繼承自 .footnote），不是期別下拉的印刷字級，
   且刻意不設 border-bottom（無框）——不得改變註腳列的高度或對齊。 */
/* 聯次字級刻意大於註腳句（0.95rem 而非繼承 .footnote 的 0.72rem）：
   參考圖右下「第一聯　存根聯」比左側註腳句明顯更大更粗，且註腳列的高度是由它
   決定的——用 font: inherit 會讓整列從 21.3px 縮到 16.1px，違反 spec §2.6
   「不得改變註腳列的高度或對齊」。改字級時請同步量測 .footnote 的高度。 */
.copy-select {
  border: 0;
  background: transparent;
  color: inherit;
  font-family: inherit;
  font-size: 0.95rem;
  font-weight: 700;
  letter-spacing: 0.15em;
  white-space: nowrap;
  text-align: right;
  padding: 0 0.55em 0 0.15rem;
  appearance: none;
  -webkit-appearance: none;
  cursor: pointer;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8 6'%3E%3Cpath d='M0 0h8L4 6z' fill='%236b6414'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 0.05em center;
  background-size: 0.4em 0.3em;
}

.copy-select:hover {
  background-color: color-mix(in srgb, var(--ink) 8%, var(--paper));
}

.copy-select:focus {
  outline: 2px solid color-mix(in srgb, var(--ink) 35%, var(--paper));
  outline-offset: -2px;
}

.copy-select option {
  color: #1a1a1a;
}

/* 窄螢幕（發票縮到 min-width 640px 時）：日期行獨立成行仍保持置中（spec §2.3），
   否則左右各 1fr 的置中會把左欄壓窄，統一編號 8 碼被裁到看不見前兩碼 */
@media (max-width: 700px) {
  .date-line {
    grid-template-columns: minmax(0, 1fr);
    gap: 0.2rem;
  }

  /* 空的側欄（三聯式右側留白、二聯式左側無統編）在單欄堆疊時不佔一行 */
  .date-line .date-side:empty {
    display: none;
  }

  .date-line .roc-date {
    justify-content: center;
  }
}

/* ---- 二聯式框外資訊 ---- */
.dup-note {
  margin: 0.5rem 0 0;
  text-align: center;
  font-size: 0.8rem;
  opacity: 0.75;
}
</style>
