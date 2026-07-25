import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import InvoiceSheet from '../../src/components/InvoiceSheet.vue'
import sheetSource from '../../src/components/InvoiceSheet.vue?raw'
import type { Buyer, CopyType, InvoiceItem, InvoiceType, TaxMode } from '../../src/types'

function emptyItem(overrides: Partial<InvoiceItem> = {}): InvoiceItem {
  return { name: '', quantity: null, unitPrice: null, amount: null, note: '', ...overrides }
}

function emptyItems(): InvoiceItem[] {
  return Array.from({ length: 5 }, () => emptyItem())
}

interface SheetProps {
  invoiceType: InvoiceType
  periodYear: string
  periodMonth: string
  buyer: Buyer
  year: string
  month: string
  day: string
  items: InvoiceItem[]
  sales: number
  tax: number
  total: number
  taxMode: TaxMode
  copyType: CopyType
}

function mountSheet(overrides: Partial<SheetProps> = {}) {
  const props: SheetProps = {
    invoiceType: 'triplicate',
    periodYear: '115',
    periodMonth: '7',
    buyer: { name: '', ubn: '', address: '' },
    year: '115',
    month: '',
    day: '',
    items: emptyItems(),
    sales: 0,
    tax: 0,
    total: 0,
    taxMode: 'taxable',
    copyType: 'stub',
    ...overrides,
  }
  return mount(InvoiceSheet, { props })
}

type Wrapper = ReturnType<typeof mountSheet>

function lastEmittedItems(wrapper: Wrapper): InvoiceItem[] {
  const events = wrapper.emitted('update:items')!
  return events[events.length - 1][0] as InvoiceItem[]
}

function fieldValue(wrapper: Wrapper, testid: string): string {
  return (
    wrapper.find(`[data-testid="${testid}"]`).element as
      | HTMLInputElement
      | HTMLTextAreaElement
      | HTMLSelectElement
  ).value
}

/** scoped CSS 在 happy-dom（無 layout）不會套用，樣式契約改由 SFC 樣式原始碼驗證 */
function cssRule(selector: string): string {
  const match = sheetSource.match(
    new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`, 'm'),
  )
  return match ? match[1] : ''
}

describe('InvoiceSheet（品項固定 5 列）', () => {
  it('固定渲染 5 列品項，無新增/刪除按鈕', () => {
    const wrapper = mountSheet()
    for (let i = 0; i < 5; i++) {
      expect(wrapper.find(`[data-testid="item-name-${i}"]`).exists()).toBe(true)
      expect(wrapper.find(`[data-testid="item-qty-${i}"]`).exists()).toBe(true)
      expect(wrapper.find(`[data-testid="item-price-${i}"]`).exists()).toBe(true)
      expect(wrapper.find(`[data-testid="item-amount-${i}"]`).exists()).toBe(true)
    }
    expect(wrapper.find('[data-testid="item-name-5"]').exists()).toBe(false)
    expect(wrapper.find('button').exists()).toBe(false)
  })

  it('備註欄：第 1、2 列為 input，第 3 列為專用章印刷字格', () => {
    const wrapper = mountSheet()
    expect(wrapper.find('[data-testid="item-note-0"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="item-note-1"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="item-note-2"]').exists()).toBe(false)
    const stamp = wrapper.find('td.stamp')
    expect(stamp.exists()).toBe(true)
    expect(stamp.attributes('rowspan')).toBeUndefined()
    expect(stamp.text()).toBe('營業人蓋用統一發票專用章')
  })

  it('專用章下方為單一合併空白格，延伸到表格最後一列（外框封閉右下角）', () => {
    const triple = mountSheet({ invoiceType: 'triplicate' })
    const tripleBlank = triple.find('td.stamp-blank')
    expect(tripleBlank.exists()).toBe(true)
    // 第 4、5 品項列 + 銷售額合計 + 營業稅兩列 + 總計 + 大寫 = 7 列
    expect(tripleBlank.attributes('rowspan')).toBe('7')

    const dup = mountSheet({ invoiceType: 'duplicate' })
    // 第 4、5 品項列 + 總計 + 大寫 = 4 列
    expect(dup.find('td.stamp-blank').attributes('rowspan')).toBe('4')
  })
})

describe('InvoiceSheet（品名／備註可換行、不吃字）', () => {
  const LONG_NAME =
    '客製化印刷紙盒（含內襯、雷射燙金、四色印刷、防潮處理、專屬版模開版費與運費）'.repeat(2)

  it('品名與備註為自動增高 textarea（rows=1、不設 maxlength）', () => {
    const wrapper = mountSheet()
    for (const testid of ['item-name-0', 'item-name-4', 'item-note-0', 'item-note-1']) {
      const el = wrapper.find(`[data-testid="${testid}"]`).element
      expect(el.tagName).toBe('TEXTAREA')
      expect(el.getAttribute('rows')).toBe('1')
      expect(el.getAttribute('maxlength')).toBeNull()
    }
  })

  it('超長品名完整顯示不截斷（textarea 值等於整串文字）', () => {
    const items = emptyItems()
    items[0] = emptyItem({ name: LONG_NAME, note: LONG_NAME })
    const wrapper = mountSheet({ items })
    expect(fieldValue(wrapper, 'item-name-0')).toBe(LONG_NAME)
    expect(fieldValue(wrapper, 'item-note-0')).toBe(LONG_NAME)
  })

  it('輸入超長品名／含換行的備註 → emit 完整原字串', async () => {
    const wrapper = mountSheet()
    await wrapper.find('[data-testid="item-name-0"]').setValue(LONG_NAME)
    expect(lastEmittedItems(wrapper)[0].name).toBe(LONG_NAME)
    expect(lastEmittedItems(wrapper)[0].name.length).toBe(LONG_NAME.length)

    const multiline = '第一行\n第二行'
    await wrapper.find('[data-testid="item-note-1"]').setValue(multiline)
    expect(lastEmittedItems(wrapper)[1].note).toBe(multiline)
  })

  it('樣式契約：textarea 不可 resize、隱藏溢出、自動換行（列高隨內容增長）', () => {
    const rule = cssRule('.cell-textarea')
    expect(rule).toContain('resize: none')
    expect(rule).toContain('overflow: hidden')
    expect(rule).toContain('white-space: pre-wrap')
    expect(rule).toContain('word-break: break-word')
  })
})

describe('InvoiceSheet（期別：年可填、月份下拉）', () => {
  it('年份 input 顯示 props 值並 emit update:periodYear', async () => {
    const wrapper = mountSheet({ periodYear: '115' })
    expect(fieldValue(wrapper, 'period-year-input')).toBe('115')
    await wrapper.find('[data-testid="period-year-input"]').setValue('116')
    expect(wrapper.emitted('update:periodYear')).toEqual([['116']])
  })

  it('月份下拉固定六個雙月期選項（顯示中文、值為起始月）', () => {
    const wrapper = mountSheet()
    const options = wrapper.find('[data-testid="period-month-select"]').findAll('option')
    expect(options.map((o) => o.text())).toEqual([
      '一、二',
      '三、四',
      '五、六',
      '七、八',
      '九、十',
      '十一、十二',
    ])
    expect(options.map((o) => o.attributes('value'))).toEqual(['1', '3', '5', '7', '9', '11'])
  })

  it('下拉目前值依 props，切換時 emit update:periodMonth', async () => {
    const wrapper = mountSheet({ periodMonth: '7' })
    expect(fieldValue(wrapper, 'period-month-select')).toBe('7')
    await wrapper.find('[data-testid="period-month-select"]').setValue('11')
    expect(wrapper.emitted('update:periodMonth')).toEqual([['11']])
  })

  it('期別行前後保留印刷字「年」「月份」且整行置中', () => {
    const wrapper = mountSheet()
    const period = wrapper.find('p.period')
    expect(period.text()).toContain('年')
    expect(period.text()).toContain('月份')
    expect(cssRule('.period')).toContain('justify-content: center')
  })
})

describe('InvoiceSheet（金額欄自動顯示與手動覆寫）', () => {
  it('金額欄預設顯示 rowAmount（數量 × 單價，覆寫優先）', () => {
    const items = emptyItems()
    items[0] = emptyItem({ quantity: 2, unitPrice: 100 })
    items[1] = emptyItem({ quantity: 2, unitPrice: 100, amount: 999 })
    const wrapper = mountSheet({ items })
    expect(fieldValue(wrapper, 'item-amount-0')).toBe('200')
    expect(fieldValue(wrapper, 'item-amount-1')).toBe('999')
  })

  it('直接輸入金額 → emit 帶手動覆寫（amount 設值）', async () => {
    const wrapper = mountSheet()
    await wrapper.find('[data-testid="item-amount-0"]').setValue('500')
    const emitted = lastEmittedItems(wrapper)
    expect(emitted[0].amount).toBe(500)
  })

  it('清空金額欄 → emit amount 為 null（回到自動計算）', async () => {
    const items = emptyItems()
    items[0] = emptyItem({ quantity: 2, unitPrice: 100, amount: 999 })
    const wrapper = mountSheet({ items })
    await wrapper.find('[data-testid="item-amount-0"]').setValue('')
    expect(lastEmittedItems(wrapper)[0].amount).toBeNull()
  })

  it('改數量或單價 → emit 清除該列覆寫（amount 為 null）', async () => {
    const items = emptyItems()
    items[0] = emptyItem({ quantity: 2, unitPrice: 100, amount: 500 })
    const wrapper = mountSheet({ items })

    await wrapper.find('[data-testid="item-qty-0"]').setValue('3')
    let emitted = lastEmittedItems(wrapper)
    expect(emitted[0].quantity).toBe(3)
    expect(emitted[0].amount).toBeNull()

    await wrapper.find('[data-testid="item-price-0"]').setValue('150')
    emitted = lastEmittedItems(wrapper)
    expect(emitted[0].unitPrice).toBe(150)
    expect(emitted[0].amount).toBeNull()
  })

  it('不 mutate props：emit 新陣列，原 props 不變', async () => {
    const items = emptyItems()
    const wrapper = mountSheet({ items })
    await wrapper.find('[data-testid="item-qty-0"]').setValue('7')
    await wrapper.find('[data-testid="item-name-1"]').setValue('紙箱')

    expect(items[0].quantity).toBeNull()
    expect(items[1].name).toBe('')
    const emitted = lastEmittedItems(wrapper)
    expect(emitted).not.toBe(items)
    expect(emitted[1]).not.toBe(items[1])
  })
})

describe('InvoiceSheet（金額欄一律整數元、非負）', () => {
  it('列金額輸入小數 100.5 → emit 101，且欄位顯示 101', async () => {
    const wrapper = mountSheet()
    const amount = wrapper.find('[data-testid="item-amount-0"]')
    await amount.setValue('100.5')

    expect(lastEmittedItems(wrapper)[0].amount).toBe(101)
    expect(fieldValue(wrapper, 'item-amount-0')).toBe('101')
  })

  it('列金額輸入負數 -500 → emit 0，畫面顯示 0（不留 -500）', async () => {
    const wrapper = mountSheet()
    await wrapper.find('[data-testid="item-amount-0"]').setValue('-500')

    expect(lastEmittedItems(wrapper)[0].amount).toBe(0)
    expect(fieldValue(wrapper, 'item-amount-0')).toBe('0')
  })

  it('銷售額／稅額／總計輸入小數與負數 → emit 整數且非負', async () => {
    const wrapper = mountSheet()
    await wrapper.find('[data-testid="sales-input"]').setValue('1000.5')
    await wrapper.find('[data-testid="tax-input"]').setValue('47.99000000000001')
    await wrapper.find('[data-testid="total-input"]').setValue('-100')

    expect(wrapper.emitted('update:sales')).toEqual([[1001]])
    expect(wrapper.emitted('update:tax')).toEqual([[48]])
    expect(wrapper.emitted('update:total')).toEqual([[0]])
    // 正規化後的值同步回 DOM（0 依紙本留白）
    expect(fieldValue(wrapper, 'total-input')).toBe('')
  })

  it('明確填 0 的列金額顯示 0（贈品列），未覆寫且合計 0 才留白', () => {
    const items = emptyItems()
    items[0] = emptyItem({ name: '贈品', amount: 0 })
    items[1] = emptyItem({ quantity: null, unitPrice: null })
    const wrapper = mountSheet({ items })

    expect(fieldValue(wrapper, 'item-amount-0')).toBe('0')
    expect(fieldValue(wrapper, 'item-amount-1')).toBe('')
  })
})

describe('InvoiceSheet（金額千分位：ui-spec.md「金額千分位」）', () => {
  it('列金額／單價／銷售額／稅額／總計改用 type="text" 搭配對應 inputmode（手機仍跳數字鍵盤）', () => {
    const wrapper = mountSheet()
    for (const testid of ['item-amount-0', 'sales-input', 'tax-input', 'total-input']) {
      const el = wrapper.find(`[data-testid="${testid}"]`).element as HTMLInputElement
      expect(el.type).toBe('text')
      expect(el.getAttribute('inputmode')).toBe('numeric')
    }
    const price = wrapper.find('[data-testid="item-price-0"]').element as HTMLInputElement
    expect(price.type).toBe('text')
    expect(price.getAttribute('inputmode')).toBe('decimal')
    // 數量維持 type="number"（不加千分位，是計數不是金額）
    const qty = wrapper.find('[data-testid="item-qty-0"]').element as HTMLInputElement
    expect(qty.type).toBe('number')
  })

  it('未聚焦（含被連動更新）的欄位一律顯示千分位：列金額、單價、銷售額、稅額、總計', () => {
    const items = emptyItems()
    items[0] = emptyItem({ quantity: 2, unitPrice: 12345, amount: 10000 })
    const wrapper = mountSheet({ items, sales: 12345, tax: 617, total: 12962 })

    expect(fieldValue(wrapper, 'item-amount-0')).toBe('10,000')
    expect(fieldValue(wrapper, 'item-price-0')).toBe('12,345')
    expect(fieldValue(wrapper, 'sales-input')).toBe('12,345')
    expect(fieldValue(wrapper, 'total-input')).toBe('12,962')
  })

  it('二聯式框外內含稅額／銷售額一律顯示千分位', () => {
    const wrapper = mountSheet({ invoiceType: 'duplicate', sales: 190500, tax: 9525, total: 200025 })
    expect(wrapper.find('[data-testid="tax-readonly"]').text()).toBe('內含稅額 $9,525')
    expect(wrapper.find('[data-testid="sales-readonly"]').text()).toBe('銷售額 $190,500')
  })

  it('欄位 focus 時顯示純數字（不含千分位），blur 後恢復千分位', async () => {
    const wrapper = mountSheet({ sales: 10000 })
    const sales = wrapper.find('[data-testid="sales-input"]')
    expect(fieldValue(wrapper, 'sales-input')).toBe('10,000')

    await sales.trigger('focus')
    expect(fieldValue(wrapper, 'sales-input')).toBe('10000')

    await sales.trigger('blur')
    expect(fieldValue(wrapper, 'sales-input')).toBe('10,000')
  })

  it('列金額／單價欄位同樣支援 focus 顯示純數字、blur 顯示千分位', async () => {
    const items = emptyItems()
    items[0] = emptyItem({ quantity: 2, unitPrice: 6000, amount: 12000 })
    const wrapper = mountSheet({ items })
    const amount = wrapper.find('[data-testid="item-amount-0"]')
    const price = wrapper.find('[data-testid="item-price-0"]')

    expect(fieldValue(wrapper, 'item-amount-0')).toBe('12,000')
    expect(fieldValue(wrapper, 'item-price-0')).toBe('6,000')

    await amount.trigger('focus')
    await price.trigger('focus')
    expect(fieldValue(wrapper, 'item-amount-0')).toBe('12000')
    expect(fieldValue(wrapper, 'item-price-0')).toBe('6000')

    await amount.trigger('blur')
    await price.trigger('blur')
    expect(fieldValue(wrapper, 'item-amount-0')).toBe('12,000')
    expect(fieldValue(wrapper, 'item-price-0')).toBe('6,000')
  })

  it('解析輸入時先剝除逗號：直接貼上「10,500」能正確解析成 10500（不會被當非數字歸零）', async () => {
    const wrapper = mountSheet()
    await wrapper.find('[data-testid="sales-input"]').setValue('10,500')
    expect(wrapper.emitted('update:sales')).toEqual([[10500]])
    expect(fieldValue(wrapper, 'sales-input')).toBe('10,500')
  })

  it('聚焦中貼上含逗號字串 → 立即剝除逗號、顯示純數字', async () => {
    const wrapper = mountSheet()
    const sales = wrapper.find('[data-testid="sales-input"]')
    await sales.trigger('focus')
    await sales.setValue('10,500')

    expect(fieldValue(wrapper, 'sales-input')).toBe('10500')
    expect(wrapper.emitted('update:sales')).toEqual([[10500]])
  })

  it('單價允許小數，千分位只加在整數部分（1234.5 → 1,234.5）', () => {
    const items = emptyItems()
    items[0] = emptyItem({ unitPrice: 1234.5 })
    const wrapper = mountSheet({ items })
    expect(fieldValue(wrapper, 'item-price-0')).toBe('1,234.5')
  })

  it('單價編輯中輸入小數點不會被強制清成整數（保留使用者打到一半的字元）', async () => {
    const wrapper = mountSheet()
    const price = wrapper.find('[data-testid="item-price-0"]')
    await price.trigger('focus')
    await price.setValue('12.')

    expect(fieldValue(wrapper, 'item-price-0')).toBe('12.')
    expect(lastEmittedItems(wrapper)[0].unitPrice).toBe(12)

    await price.setValue('12.5')
    expect(fieldValue(wrapper, 'item-price-0')).toBe('12.5')
    expect(lastEmittedItems(wrapper)[0].unitPrice).toBe(12.5)
  })

  it('單價 type="text" 失去瀏覽器數字過濾後，仍濾除字母等非數字字元，不會讓單價被判為 null 而靜默清空（F3）', async () => {
    const wrapper = mountSheet()
    const price = wrapper.find('[data-testid="item-price-0"]')
    await price.trigger('focus')

    // 使用者打出「1a2.5b」：字母應被濾掉，只留「12.5」，單價正確解析為 12.5，不是 null
    await price.setValue('1a2.5b')
    expect(fieldValue(wrapper, 'item-price-0')).toBe('12.5')
    expect(lastEmittedItems(wrapper)[0].unitPrice).toBe(12.5)

    // 第二個小數點應被濾掉（維持只有一個小數點的合法數字字串），不會讓值變成 NaN
    await price.setValue('1.2.3')
    expect(fieldValue(wrapper, 'item-price-0')).toBe('1.23')
    expect(lastEmittedItems(wrapper)[0].unitPrice).toBe(1.23)

    // 全部是非法字元 → 濾完是空字串 → 視為未填（null），而不是靜默清空成 0
    await price.setValue('abc')
    expect(fieldValue(wrapper, 'item-price-0')).toBe('')
    expect(lastEmittedItems(wrapper)[0].unitPrice).toBeNull()

    await price.trigger('blur')
    // blur 後仍是「留白」（未填），不是被清空成看不出原因的空白
    expect(fieldValue(wrapper, 'item-price-0')).toBe('')
  })

  it('金額為 0（含明確覆寫為 0）千分位格式化後仍顯示 0，不受千分位邏輯影響變空白', () => {
    const items = emptyItems()
    items[0] = emptyItem({ name: '贈品', amount: 0 })
    const wrapper = mountSheet({ items })
    expect(fieldValue(wrapper, 'item-amount-0')).toBe('0')
  })
})

describe('InvoiceSheet（民國年月日只收數字）', () => {
  it('期別年／年／月／日填入非數字 → emit 濾除後的數字字串並回寫 DOM', async () => {
    const wrapper = mountSheet()
    await wrapper.find('[data-testid="period-year-input"]').setValue('abc')
    await wrapper.find('[data-testid="date-year-input"]').setValue('1a1b5')
    await wrapper.find('[data-testid="date-month-input"]').setValue('9x')
    await wrapper.find('[data-testid="date-day-input"]').setValue('中2文5')

    expect(wrapper.emitted('update:periodYear')).toEqual([['']])
    expect(wrapper.emitted('update:year')).toEqual([['115']])
    expect(wrapper.emitted('update:month')).toEqual([['9']])
    expect(wrapper.emitted('update:day')).toEqual([['25']])
    expect(fieldValue(wrapper, 'period-year-input')).toBe('')
  })
})

describe('InvoiceSheet（欄寬／字級改變後重算 textarea 高度，不吃字）', () => {
  /**
   * 假的 ResizeObserver + 手動抽取的 requestAnimationFrame，
   * 讓測試能分別觀察「回呼當下」與「下一個 frame」的 DOM 狀態。
   */
  function stubResizeEnvironment() {
    const observed: Element[] = []
    const frames: FrameRequestCallback[] = []
    let notify: (() => void) | null = null

    class FakeResizeObserver {
      constructor(callback: () => void) {
        notify = callback
      }
      observe(el: Element) {
        observed.push(el)
      }
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb))
    vi.stubGlobal('cancelAnimationFrame', () => {})

    return {
      observed,
      notify: () => notify!(),
      /** 跑完所有排隊中的 frame 回呼 */
      flushFrames: () => {
        while (frames.length) frames.shift()!(0)
      },
      pendingFrames: () => frames.length,
    }
  }

  /** 固定 scrollHeight（happy-dom 無 layout，得自己餵量測結果） */
  function fakeScrollHeight(el: HTMLTextAreaElement, value: number) {
    Object.defineProperty(el, 'scrollHeight', { configurable: true, value })
  }

  it('尺寸變化（ResizeObserver）→ 依新的 scrollHeight 重算每個 textarea 高度', () => {
    const env = stubResizeEnvironment()

    try {
      const wrapper = mountSheet()
      // 觀察整張發票（欄寬與字級變化都反映在 .sheet 尺寸上）
      expect(env.observed.some((el) => el.classList.contains('sheet'))).toBe(true)

      const name = wrapper.find('[data-testid="item-name-0"]').element as HTMLTextAreaElement
      const note = wrapper.find('[data-testid="item-note-0"]').element as HTMLTextAreaElement
      for (const el of [name, note]) {
        el.style.height = '150px' // 舊欄寬算出的高度
        // 欄變窄／字變大後內容需要更高（否則 overflow: hidden 直接裁掉後面幾行）
        fakeScrollHeight(el, 195)
      }

      env.notify()
      env.flushFrames()

      expect(name.style.height).toBe('195px')
      expect(note.style.height).toBe('195px')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('ResizeObserver 回呼本身不寫 DOM（延到下一個 frame）→ 不會觸發 RO loop 錯誤', () => {
    const env = stubResizeEnvironment()

    try {
      const wrapper = mountSheet()
      const name = wrapper.find('[data-testid="item-name-0"]').element as HTMLTextAreaElement
      name.style.height = '150px'
      fakeScrollHeight(name, 195)

      env.notify()

      // 回呼中改高度會改變被觀察的 .sheet 尺寸，瀏覽器就會丟
      // 「ResizeObserver loop completed with undelivered notifications」
      expect(name.style.height).toBe('150px')
      expect(env.pendingFrames()).toBe(1)

      // 多次通知只合併成一個 frame（縮視窗會連發很多次）
      env.notify()
      env.notify()
      expect(env.pendingFrames()).toBe(1)

      env.flushFrames()
      expect(name.style.height).toBe('195px')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('高度已經正確時不留下任何淨變化（冪等）→ 重算會收斂，不會被自己的寫入無限喚醒', () => {
    const env = stubResizeEnvironment()

    try {
      const wrapper = mountSheet()
      const name = wrapper.find('[data-testid="item-name-0"]').element as HTMLTextAreaElement
      name.style.height = '195px'
      fakeScrollHeight(name, 195)

      const writes: string[] = []
      const style = name.style
      const setProperty = style.setProperty.bind(style)
      vi.spyOn(style, 'setProperty').mockImplementation((prop: string, value: string | null) => {
        if (prop === 'height') writes.push(String(value))
        setProperty(prop, value ?? '')
      })

      env.notify()
      env.flushFrames()

      // 只有量測用的 height: auto 探測與立刻還原，沒有第三次寫入、也沒有新的高度值。
      // 探測不會活到 frame 結束，尺寸觀察是在每輪 layout 後才比對尺寸，
      // 所以「淨變化為零」就等於不會再被自己喚醒。
      expect(writes).toEqual(['auto', '195px'])
      expect(name.style.height).toBe('195px')

      // 內容變高時才真的寫入新高度（確認上面的「不寫」不是因為整個機制沒跑）
      fakeScrollHeight(name, 240)
      env.notify()
      env.flushFrames()
      expect(name.style.height).toBe('240px')
    } finally {
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
    }
  })
})

describe('InvoiceSheet（表格框線與印刷字內距，同紙本）', () => {
  it('儲存格基礎樣式用 :where() 降特異性，2px 外框與印刷字內距不會被蓋掉', () => {
    // `.invoice-grid th` 的 type selector 會贏過 .bt2／.head，border shorthand 也會重設外框寬度
    expect(sheetSource).toContain('.invoice-grid :where(th, td)')
    expect(sheetSource).not.toContain('.invoice-grid th,')
  })

  it('外框四邊為 2px（spec §2.4 外框 2px、內線 1px）', () => {
    expect(cssRule('.bt2')).toContain('border-top-width: 2px')
    expect(cssRule('.bb2')).toContain('border-bottom-width: 2px')
    expect(cssRule('.bl2')).toContain('border-left-width: 2px')
    expect(cssRule('.br2')).toContain('border-right-width: 2px')
  })

  it('表頭與標籤格的印刷字有左右內距（不貼齊格線黏成「名數」）', () => {
    expect(cssRule('.head')).toMatch(/padding:\s*0\.3rem\s+0\.[1-9]\d*rem/)
    // 寬欄（品名／金額／備註）內距更大
    expect(cssRule('.head-wide')).toMatch(/padding-inline:\s*1rem/)
    expect(cssRule('.label-cell')).toMatch(/padding:\s*0\.3rem\s+[01]\.?\d*rem/)
    expect(cssRule('.subhead')).toMatch(/padding:\s*0\.15rem\s+0\.[1-9]\d*rem/)
  })

  it('寬欄表頭（品名／金額／備註）掛 head-wide，窄欄（數量／單價）不掛（避免印刷字換行）', () => {
    const heads = mountSheet().findAll('th.head')
    expect(heads.map((th) => th.text())).toEqual([
      '品　　　　名',
      '數　量',
      '單　價',
      '金　　額',
      '備　　　註',
    ])
    expect(heads.map((th) => th.classes().includes('head-wide'))).toEqual([
      true,
      false,
      false,
      true,
      true,
    ])
  })

  it('「零稅率」連成一組置中，不被分散對齊拉開', () => {
    const zero = mountSheet().findAll('td.subhead')[1]
    expect(zero.text()).toBe('零稅率')
    expect(zero.classes()).toContain('subhead-tight')
    expect(cssRule('.subhead-tight')).toContain('text-align-last: center')
  })
})

describe('InvoiceSheet（稅制 ✓ 切換）', () => {
  it('預設應稅打 ✓，其餘空白', () => {
    const wrapper = mountSheet({ taxMode: 'taxable' })
    expect(wrapper.find('[data-testid="tax-mode-taxable"]').text()).toBe('✓')
    expect(wrapper.find('[data-testid="tax-mode-zero"]').text()).toBe('')
    expect(wrapper.find('[data-testid="tax-mode-exempt"]').text()).toBe('')
  })

  it('點選零稅率格 → emit update:taxMode zeroRate；免稅 → exempt', async () => {
    const wrapper = mountSheet()
    await wrapper.find('[data-testid="tax-mode-zero"]').trigger('click')
    await wrapper.find('[data-testid="tax-mode-exempt"]').trigger('click')
    expect(wrapper.emitted('update:taxMode')).toEqual([['zeroRate'], ['exempt']])
  })

  it('taxMode 為 zeroRate 時 ✓ 顯示在零稅率格', () => {
    const wrapper = mountSheet({ taxMode: 'zeroRate' })
    expect(wrapper.find('[data-testid="tax-mode-taxable"]').text()).toBe('')
    expect(wrapper.find('[data-testid="tax-mode-zero"]').text()).toBe('✓')
  })
})

describe('InvoiceSheet（三聯式／二聯式列差異）', () => {
  it('三聯式：有統編、銷售額合計、營業稅列，無框外內含稅資訊', () => {
    const wrapper = mountSheet({ invoiceType: 'triplicate' })
    expect(wrapper.text()).toContain('統　一　發　票（三聯式）')
    expect(wrapper.find('[data-testid="ubn-input"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="sales-input"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="tax-input"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="tax-mode-taxable"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="total-input"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="tax-readonly"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="sales-readonly"]').exists()).toBe(false)
  })

  it('二聯式：無統編與銷售額/營業稅列，框外顯示內含稅額與銷售額', () => {
    const wrapper = mountSheet({ invoiceType: 'duplicate', sales: 1000, tax: 50, total: 1050 })
    expect(wrapper.text()).toContain('統　一　發　票（二聯式）')
    expect(wrapper.find('[data-testid="ubn-input"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="sales-input"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="tax-input"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="tax-mode-taxable"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="total-input"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="date-year-input"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="date-month-input"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="tax-readonly"]').text()).toBe('內含稅額 $50')
    expect(wrapper.find('[data-testid="sales-readonly"]').text()).toBe('銷售額 $1,000')
  })
})

describe('InvoiceSheet（註腳：三聯式專屬提示句與聯次可選，ui-spec §2「註腳」）', () => {
  function copyOptionTexts(wrapper: Wrapper): string[] {
    return wrapper
      .find('[data-testid="copy-select"]')
      .findAll('option')
      .map((opt) => opt.text())
  }

  it('三聯式左側顯示應稅／零稅率／免稅提示句', () => {
    const wrapper = mountSheet({ invoiceType: 'triplicate' })
    expect(wrapper.find('.footnote-rule').text()).toContain(
      '※應稅、零稅率、免稅之銷售額應分別開立統一發票',
    )
  })

  it('二聯式左側不顯示提示句，但註腳列仍存在（維持版面高度）', () => {
    const wrapper = mountSheet({ invoiceType: 'duplicate' })
    expect(wrapper.find('.footnote-rule').exists()).toBe(true)
    expect(wrapper.find('.footnote-rule').text()).toBe('')
    expect(wrapper.text()).not.toContain('應稅、零稅率、免稅')
  })

  it('三聯式聯次下拉有三個選項：第一聯存根聯／第二聯扣抵聯／第三聯收執聯', () => {
    const wrapper = mountSheet({ invoiceType: 'triplicate' })
    expect(copyOptionTexts(wrapper)).toEqual(['第一聯　存根聯', '第二聯　扣抵聯', '第三聯　收執聯'])
  })

  it('二聯式聯次下拉只有兩個選項：第一聯存根聯／第二聯收執聯', () => {
    const wrapper = mountSheet({ invoiceType: 'duplicate' })
    expect(copyOptionTexts(wrapper)).toEqual(['第一聯　存根聯', '第二聯　收執聯'])
  })

  it('預設值為第一聯　存根聯', () => {
    const wrapper = mountSheet()
    expect(fieldValue(wrapper, 'copy-select')).toBe('stub')
  })

  it('切換聯次會 emit update:copyType', async () => {
    const wrapper = mountSheet({ invoiceType: 'triplicate' })
    await wrapper.find('[data-testid="copy-select"]').setValue('deduction')
    expect(wrapper.emitted('update:copyType')![0]).toEqual(['deduction'])
  })

  it('樣式契約：聯次下拉透明底、無框、appearance: none', () => {
    expect(cssRule('.copy-select')).toContain('background: transparent')
    expect(cssRule('.copy-select')).toContain('border: 0')
    expect(cssRule('.copy-select')).toContain('appearance: none')
  })
})

describe('InvoiceSheet（中文大寫九格）', () => {
  function slotTexts(wrapper: Wrapper): string[] {
    return wrapper
      .find('[data-testid="chinese-upper"]')
      .findAll('.upper-slot')
      .map((slot) => slot.text())
  }

  it('總計 0 → 九格只有印刷單位字，且無任何大寫數字', () => {
    const wrapper = mountSheet({ total: 0 })
    expect(slotTexts(wrapper)).toEqual(['億', '仟', '佰', '拾', '萬', '仟', '佰', '拾', '元'])
    expect(wrapper.findAll('.upper-digit')).toHaveLength(0)
  })

  it('總計 10500 → 壹萬 零仟 伍佰 零拾 零元（億～拾萬格只有單位字）', () => {
    expect(slotTexts(mountSheet({ total: 10500 }))).toEqual([
      '億',
      '仟',
      '佰',
      '拾',
      '壹萬',
      '零仟',
      '伍佰',
      '零拾',
      '零元',
    ])
  })

  it('大寫數字帶 upper-digit class 與 upper-digit-N testid（僅有值的位存在）', () => {
    const wrapper = mountSheet({ total: 10500 })
    for (const i of [0, 1, 2, 3]) {
      expect(wrapper.find(`[data-testid="upper-digit-${i}"]`).exists()).toBe(false)
    }
    const digits = [4, 5, 6, 7, 8].map((i) => wrapper.find(`[data-testid="upper-digit-${i}"]`))
    expect(digits.map((d) => d.text())).toEqual(['壹', '零', '伍', '零', '零'])
    for (const d of digits) expect(d.classes()).toContain('upper-digit')
  })

  it('樣式契約：大寫數字整組在格內置中、用手寫墨藍色且略大略粗', () => {
    expect(cssRule('.upper-slot')).toContain('justify-content: center')
    expect(cssRule('.upper-digit')).toContain('color: var(--hand-ink)')
    expect(cssRule('.invoice-wrap')).toContain('--hand-ink: #1d4ed8')
    expect(cssRule('.upper-digit')).toMatch(/font-size:\s*1\.\d+em/)
    expect(cssRule('.upper-digit')).toMatch(/font-weight:\s*(800|bold)/)
  })

  it('總計 3570 → 前五格（億仟佰拾萬）橫線槓掉，後四格（仟佰拾元）沒有', () => {
    const wrapper = mountSheet({ total: 3570 })
    const slots = wrapper.find('[data-testid="chinese-upper"]').findAll('.upper-slot')
    expect(slots).toHaveLength(9)
    for (const i of [0, 1, 2, 3, 4]) {
      expect(slots[i].classes()).toContain('upper-slot--struck')
      expect(slots[i].attributes('data-testid')).toBe(`upper-struck-${i}`)
    }
    for (const i of [5, 6, 7, 8]) {
      expect(slots[i].classes()).not.toContain('upper-slot--struck')
      expect(wrapper.find(`[data-testid="upper-struck-${i}"]`).exists()).toBe(false)
    }
    // 印刷單位字仍要看得見，不因劃線而被隱藏
    expect(slots.map((s) => s.find('.upper-unit').text())).toEqual([
      '億',
      '仟',
      '佰',
      '拾',
      '萬',
      '仟',
      '佰',
      '拾',
      '元',
    ])
  })

  it('總計 0 或空白 → 九格一律不劃線', () => {
    for (const total of [0, NaN]) {
      const wrapper = mountSheet({ total })
      expect(wrapper.findAll('.upper-slot--struck')).toHaveLength(0)
    }
  })

  it('樣式契約：橫線槓掉用 olive 印刷墨色（同 --ink），且橫貫整格而非文字刪除線', () => {
    expect(cssRule('.upper-slot--struck::after')).toContain('background: var(--ink)')
    expect(cssRule('.upper-slot--struck::after')).toMatch(/position:\s*absolute/)
    expect(cssRule('.upper-digit')).not.toMatch(/text-decoration/)
    expect(cssRule('.upper-unit')).not.toMatch(/text-decoration/)
  })
})

describe('InvoiceSheet（買受人區與民國日期行）', () => {
  it('買受人／統編／地址 emit update:buyer 新物件，不 mutate props', async () => {
    const buyer: Buyer = { name: '', ubn: '', address: '' }
    const wrapper = mountSheet({ buyer })
    await wrapper.find('[data-testid="buyer-name-input"]').setValue('好望角商行')
    await wrapper.find('[data-testid="buyer-address-input"]').setValue('台北市中正區一號')

    const events = wrapper.emitted('update:buyer')!
    expect((events[0][0] as Buyer).name).toBe('好望角商行')
    expect((events[1][0] as Buyer).address).toBe('台北市中正區一號')
    expect(buyer.name).toBe('')
    expect(buyer.address).toBe('')
  })

  it('年／月／日三格皆可填，各自 emit', async () => {
    const wrapper = mountSheet({ year: '115', month: '', day: '' })
    expect(fieldValue(wrapper, 'date-year-input')).toBe('115')

    await wrapper.find('[data-testid="date-year-input"]').setValue('116')
    await wrapper.find('[data-testid="date-month-input"]').setValue('7')
    await wrapper.find('[data-testid="date-day-input"]').setValue('25')
    expect(wrapper.emitted('update:year')).toEqual([['116']])
    expect(wrapper.emitted('update:month')).toEqual([['7']])
    expect(wrapper.emitted('update:day')).toEqual([['25']])
  })

  it('日期合法性驗證：輸入不存在的日（8 月 32 日）→ 夾成 31 並回寫 DOM', async () => {
    const wrapper = mountSheet({ year: '115', month: '8', day: '' })
    await wrapper.find('[data-testid="date-day-input"]').setValue('32')

    expect(wrapper.emitted('update:day')).toEqual([['31']])
    expect(fieldValue(wrapper, 'date-day-input')).toBe('31')
  })

  it('日期合法性驗證：月改為 2、既有日 31 超出上限 → 依年份夾成 28 或 29 並回寫日期日 input', async () => {
    const leap = mountSheet({ year: '113', month: '', day: '31' }) // 民國 113 = 2024 閏年
    await leap.find('[data-testid="date-month-input"]').setValue('2')
    expect(leap.emitted('update:month')).toEqual([['2']])
    expect(leap.emitted('update:day')).toEqual([['29']])
    expect(fieldValue(leap, 'date-day-input')).toBe('29')

    const common = mountSheet({ year: '114', month: '', day: '31' }) // 民國 114 = 2025 平年
    await common.find('[data-testid="date-month-input"]').setValue('2')
    expect(common.emitted('update:day')).toEqual([['28']])
    expect(fieldValue(common, 'date-day-input')).toBe('28')
  })

  it('日期合法性驗證：月份超出 1～12 夾到 12，並同步回寫月份 input', async () => {
    const wrapper = mountSheet({ year: '115', month: '', day: '' })
    await wrapper.find('[data-testid="date-month-input"]').setValue('13')

    expect(wrapper.emitted('update:month')).toEqual([['12']])
    expect(fieldValue(wrapper, 'date-month-input')).toBe('12')
  })

  it('日期合法性驗證：改年份造成既有二月 29 日失效（閏年改平年）→ 夾成 28', async () => {
    const wrapper = mountSheet({ year: '113', month: '2', day: '29' }) // 民國 113 = 2024 閏年
    await wrapper.find('[data-testid="date-year-input"]').setValue('114') // 民國 114 = 2025 平年

    expect(wrapper.emitted('update:year')).toEqual([['114']])
    expect(wrapper.emitted('update:day')).toEqual([['28']])
    expect(fieldValue(wrapper, 'date-day-input')).toBe('28')
  })

  it('民國日期行置中：統編在左側欄、日期在中間欄（左右各 1fr）', () => {
    const wrapper = mountSheet({ invoiceType: 'triplicate' })
    const dateLine = wrapper.find('.date-line')
    expect(dateLine.exists()).toBe(true)
    // 三欄結構：左（統編）｜中（日期）｜右（等寬留白）
    const children = dateLine.element.children
    expect(children).toHaveLength(3)
    expect(children[0].querySelector('[data-testid="ubn-input"]')).not.toBeNull()
    expect(children[1].classList.contains('roc-date')).toBe(true)
    // 左右欄等寬（minmax(0, 1fr)）→ 中間的日期整組水平置中於紙張寬度
    expect(cssRule('.date-line')).toContain(
      'grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr)',
    )
    expect(dateLine.text()).toContain('中華民國')
  })

  it('二聯式：無統編但日期行仍存在且維持置中結構', () => {
    const wrapper = mountSheet({ invoiceType: 'duplicate' })
    const dateLine = wrapper.find('.date-line')
    expect(dateLine.element.children).toHaveLength(3)
    expect(wrapper.find('[data-testid="ubn-input"]').exists()).toBe(false)
    expect(dateLine.find('.roc-date').exists()).toBe(true)
  })
})
