import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import App from './App.vue'
import { periodStartMonth, rocYear } from './lib/invoice'

type Wrapper = ReturnType<typeof mount>

function inputValue(wrapper: Wrapper, testid: string): string {
  return (
    wrapper.find(`[data-testid="${testid}"]`).element as
      | HTMLInputElement
      | HTMLTextAreaElement
      | HTMLSelectElement
  ).value
}

/** 依系統日期算出的預設值（與 App 相同規則） */
const currentRocYear = String(rocYear(new Date().getFullYear()))
const currentPeriodMonth = String(periodStartMonth(new Date().getMonth() + 1))

function upperSlots(wrapper: Wrapper): string[] {
  return wrapper
    .find('[data-testid="chinese-upper"]')
    .findAll('.upper-slot')
    .map((slot) => slot.text())
}

async function fillItem(wrapper: Wrapper, row: number, quantity: string, unitPrice: string) {
  await wrapper.find(`[data-testid="item-qty-${row}"]`).setValue(quantity)
  await wrapper.find(`[data-testid="item-price-${row}"]`).setValue(unitPrice)
}

describe('App（發票類型切換）', () => {
  it('預設為三聯式，顯示統一編號欄與營業稅列', () => {
    const wrapper = mount(App)
    expect(wrapper.find('[data-testid="tab-triplicate"]').classes()).toContain('tab-active')
    expect(wrapper.find('[data-testid="ubn-input"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="sales-input"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="tax-input"]').exists()).toBe(true)
  })

  it('切到二聯式後統編與銷售額/營業稅列消失，框外顯示內含稅資訊', async () => {
    const wrapper = mount(App)
    await wrapper.find('[data-testid="tab-duplicate"]').trigger('click')
    expect(wrapper.find('[data-testid="ubn-input"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="sales-input"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="tax-input"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="tax-readonly"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="sales-readonly"]').exists()).toBe(true)
  })
})

describe('App（期別與民國日期：全部可填、預設依系統日期）', () => {
  it('期別年份與民國日期年份預設都是當年民國年，期別月份預設當期', () => {
    const wrapper = mount(App)
    expect(inputValue(wrapper, 'period-year-input')).toBe(currentRocYear)
    expect(inputValue(wrapper, 'period-month-select')).toBe(currentPeriodMonth)
    expect(inputValue(wrapper, 'date-year-input')).toBe(currentRocYear)
    expect(inputValue(wrapper, 'date-month-input')).toBe('')
    expect(inputValue(wrapper, 'date-day-input')).toBe('')
  })

  it('期別年份／月份與民國日期年月日皆可改，且兩個年份各自獨立', async () => {
    const wrapper = mount(App)
    await wrapper.find('[data-testid="period-year-input"]').setValue('120')
    await wrapper.find('[data-testid="period-month-select"]').setValue('11')
    await wrapper.find('[data-testid="date-year-input"]').setValue('99')
    await wrapper.find('[data-testid="date-month-input"]').setValue('7')
    await wrapper.find('[data-testid="date-day-input"]').setValue('25')

    expect(inputValue(wrapper, 'period-year-input')).toBe('120')
    expect(inputValue(wrapper, 'period-month-select')).toBe('11')
    expect(inputValue(wrapper, 'date-year-input')).toBe('99')
    expect(inputValue(wrapper, 'date-month-input')).toBe('7')
    expect(inputValue(wrapper, 'date-day-input')).toBe('25')
  })

  it('切換發票類型後期別與日期欄位值保留', async () => {
    const wrapper = mount(App)
    await wrapper.find('[data-testid="period-year-input"]').setValue('118')
    await wrapper.find('[data-testid="date-day-input"]').setValue('3')
    await wrapper.find('[data-testid="tab-duplicate"]').trigger('click')

    expect(inputValue(wrapper, 'period-year-input')).toBe('118')
    expect(inputValue(wrapper, 'date-day-input')).toBe('3')
  })
})

describe('App（長品名不吃字）', () => {
  it('超長品名與多行備註原字串完整保留在 textarea 內', async () => {
    const wrapper = mount(App)
    const longName = '客製化印刷紙盒（含內襯、燙金、四色印刷、開版費）'.repeat(4)
    await wrapper.find('[data-testid="item-name-0"]').setValue(longName)
    await wrapper.find('[data-testid="item-note-0"]').setValue('第一行\n第二行')

    expect(inputValue(wrapper, 'item-name-0')).toBe(longName)
    expect(inputValue(wrapper, 'item-note-0')).toBe('第一行\n第二行')
  })
})

describe('App（三聯式：品項合計視為未稅銷售額）', () => {
  it('數量 2、單價 5000 → 銷售額 10000、稅 500、總計 10500、大寫九格正確', async () => {
    const wrapper = mount(App)
    await fillItem(wrapper, 0, '2', '5000')

    expect(inputValue(wrapper, 'item-amount-0')).toBe('10000')
    expect(inputValue(wrapper, 'sales-input')).toBe('10000')
    expect(inputValue(wrapper, 'tax-input')).toBe('500')
    expect(inputValue(wrapper, 'total-input')).toBe('10500')
    expect(upperSlots(wrapper)).toEqual([
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

  it('多列填值合計正確；直接填金額覆寫也計入合計', async () => {
    const wrapper = mount(App)
    await fillItem(wrapper, 0, '2', '100')
    await wrapper.find('[data-testid="item-amount-1"]').setValue('300')
    await wrapper.find('[data-testid="item-amount-2"]').setValue('500')

    expect(inputValue(wrapper, 'sales-input')).toBe('1000')
    expect(inputValue(wrapper, 'tax-input')).toBe('50')
    expect(inputValue(wrapper, 'total-input')).toBe('1050')
  })

  it('改數量清除該列金額覆寫，回到自動計算', async () => {
    const wrapper = mount(App)
    await fillItem(wrapper, 0, '2', '100')
    await wrapper.find('[data-testid="item-amount-0"]').setValue('999')
    expect(inputValue(wrapper, 'sales-input')).toBe('999')

    await wrapper.find('[data-testid="item-qty-0"]').setValue('3')
    expect(inputValue(wrapper, 'item-amount-0')).toBe('300')
    expect(inputValue(wrapper, 'sales-input')).toBe('300')
  })
})

describe('App（三聯式：金額區雙向計算）', () => {
  it('輸入總計 10500 反推銷售額 10000、稅額 500', async () => {
    const wrapper = mount(App)
    await wrapper.find('[data-testid="total-input"]').setValue('10500')

    expect(inputValue(wrapper, 'sales-input')).toBe('10000')
    expect(inputValue(wrapper, 'tax-input')).toBe('500')
  })

  it('稅額手動覆寫 → 總計 = 銷售額 + 稅，銷售額不動', async () => {
    const wrapper = mount(App)
    await wrapper.find('[data-testid="sales-input"]').setValue('10000')
    expect(inputValue(wrapper, 'total-input')).toBe('10500')

    await wrapper.find('[data-testid="tax-input"]').setValue('600')
    expect(inputValue(wrapper, 'sales-input')).toBe('10000')
    expect(inputValue(wrapper, 'total-input')).toBe('10600')
  })

  it('切零稅率 → 稅額歸 0、總計 = 銷售額；切回應稅重算', async () => {
    const wrapper = mount(App)
    await wrapper.find('[data-testid="sales-input"]').setValue('1000')
    expect(inputValue(wrapper, 'tax-input')).toBe('50')

    await wrapper.find('[data-testid="tax-mode-zero"]').trigger('click')
    expect(wrapper.find('[data-testid="tax-mode-zero"]').text()).toBe('✓')
    expect(inputValue(wrapper, 'tax-input')).toBe('')
    expect(inputValue(wrapper, 'total-input')).toBe('1000')

    await wrapper.find('[data-testid="tax-mode-taxable"]').trigger('click')
    expect(inputValue(wrapper, 'tax-input')).toBe('50')
    expect(inputValue(wrapper, 'total-input')).toBe('1050')
  })
})

describe('App（二聯式：品項合計視為含稅總計）', () => {
  it('數量 1、單價 1050 → 總計 1050，框外顯示內含稅額 50、銷售額 1000', async () => {
    const wrapper = mount(App)
    await wrapper.find('[data-testid="tab-duplicate"]').trigger('click')
    await fillItem(wrapper, 0, '1', '1050')

    expect(inputValue(wrapper, 'total-input')).toBe('1050')
    expect(wrapper.find('[data-testid="tax-readonly"]').text()).toContain('50')
    expect(wrapper.find('[data-testid="sales-readonly"]').text()).toContain('1000')
  })

  it('三聯式切到二聯式時以品項合計重算為含稅', async () => {
    const wrapper = mount(App)
    await fillItem(wrapper, 0, '1', '1050')
    expect(inputValue(wrapper, 'total-input')).toBe('1103') // 未稅 1050 + 稅 53

    await wrapper.find('[data-testid="tab-duplicate"]').trigger('click')
    expect(inputValue(wrapper, 'total-input')).toBe('1050')
    expect(wrapper.find('[data-testid="sales-readonly"]').text()).toContain('1000')
  })
})

describe('App（金額一律整數元：小數不留浮點雜訊、大寫九格不空白）', () => {
  function upperDigitCount(wrapper: Wrapper): number {
    return wrapper.find('[data-testid="chinese-upper"]').findAll('.upper-digit').length
  }

  it('總計輸入 999.99 → 四捨五入 1000、稅額 48（不是 47.99000000000001）、九格有數字可抄', async () => {
    const wrapper = mount(App)
    await wrapper.find('[data-testid="total-input"]').setValue('999.99')

    expect(inputValue(wrapper, 'total-input')).toBe('1000')
    expect(inputValue(wrapper, 'sales-input')).toBe('952')
    expect(inputValue(wrapper, 'tax-input')).toBe('48')
    expect(upperSlots(wrapper).slice(5)).toEqual(['壹仟', '零佰', '零拾', '零元'])
    expect(upperDigitCount(wrapper)).toBe(4)
  })

  it('小數輸入的其他路徑（總計 100.1／33.33、銷售額 1000.5、列金額 100.5）都得整數稅額', async () => {
    const wrapper = mount(App)

    await wrapper.find('[data-testid="total-input"]').setValue('100.1')
    expect(inputValue(wrapper, 'tax-input')).toBe('5')
    expect(inputValue(wrapper, 'total-input')).toBe('100')

    await wrapper.find('[data-testid="total-input"]').setValue('33.33')
    expect(inputValue(wrapper, 'tax-input')).toBe('2')
    expect(inputValue(wrapper, 'total-input')).toBe('33')

    await wrapper.find('[data-testid="sales-input"]').setValue('1000.5')
    expect(inputValue(wrapper, 'sales-input')).toBe('1001')
    expect(inputValue(wrapper, 'tax-input')).toBe('50')
    expect(inputValue(wrapper, 'total-input')).toBe('1051')

    await wrapper.find('[data-testid="item-amount-0"]').setValue('100.5')
    expect(inputValue(wrapper, 'item-amount-0')).toBe('101')
    expect(inputValue(wrapper, 'sales-input')).toBe('101')
    expect(inputValue(wrapper, 'tax-input')).toBe('5')
    expect(inputValue(wrapper, 'total-input')).toBe('106')
    expect(upperDigitCount(wrapper)).toBeGreaterThan(0)
  })

  it('稅額手動覆寫小數 50.5 → 51（整數），總計跟著整數', async () => {
    const wrapper = mount(App)
    await wrapper.find('[data-testid="sales-input"]').setValue('1000')
    await wrapper.find('[data-testid="tax-input"]').setValue('50.5')

    expect(inputValue(wrapper, 'tax-input')).toBe('51')
    expect(inputValue(wrapper, 'total-input')).toBe('1051')
  })
})

describe('App（負數不進入金額區）', () => {
  it('總計 -100 → 金額三欄歸零、大寫九格無數字', async () => {
    const wrapper = mount(App)
    await wrapper.find('[data-testid="total-input"]').setValue('-100')

    expect(inputValue(wrapper, 'total-input')).toBe('')
    expect(inputValue(wrapper, 'sales-input')).toBe('')
    expect(inputValue(wrapper, 'tax-input')).toBe('')
    expect(upperSlots(wrapper)).toEqual(['億', '仟', '佰', '拾', '萬', '仟', '佰', '拾', '元'])
  })

  it('銷售額 -1000 → 歸零；稅額覆寫 -9999 → 稅 0、總計不變成負數', async () => {
    const wrapper = mount(App)
    await wrapper.find('[data-testid="sales-input"]').setValue('-1000')
    expect(inputValue(wrapper, 'sales-input')).toBe('')
    expect(inputValue(wrapper, 'total-input')).toBe('')

    await wrapper.find('[data-testid="sales-input"]').setValue('1000')
    await wrapper.find('[data-testid="tax-input"]').setValue('-9999')
    expect(inputValue(wrapper, 'tax-input')).toBe('')
    expect(inputValue(wrapper, 'sales-input')).toBe('1000')
    expect(inputValue(wrapper, 'total-input')).toBe('1000')
  })

  it('列金額填負數 → 該列顯示 0（不顯示 -500），金額區不出現負值', async () => {
    const wrapper = mount(App)
    await wrapper.find('[data-testid="item-amount-0"]').setValue('1000')
    expect(inputValue(wrapper, 'sales-input')).toBe('1000')

    await wrapper.find('[data-testid="item-amount-0"]').setValue('-500')

    expect(inputValue(wrapper, 'item-amount-0')).toBe('0')
    for (const testid of ['item-amount-0', 'sales-input', 'tax-input', 'total-input']) {
      expect(inputValue(wrapper, testid).startsWith('-')).toBe(false)
    }
    // 合計歸零時不覆蓋既有金額（ui-spec.md §3）
    expect(inputValue(wrapper, 'sales-input')).toBe('1000')
    expect(inputValue(wrapper, 'total-input')).toBe('1050')
  })
})

describe('App（二聯式沒有稅制欄位 → 切過去時稅制回應稅）', () => {
  it('三聯式選零稅率後切二聯式：總計 2000 → 內含稅額 $95、銷售額 $1905', async () => {
    const wrapper = mount(App)
    await wrapper.find('[data-testid="sales-input"]').setValue('1000')
    await wrapper.find('[data-testid="tax-mode-zero"]').trigger('click')
    expect(inputValue(wrapper, 'tax-input')).toBe('')

    await wrapper.find('[data-testid="tab-duplicate"]').trigger('click')
    // 二聯式沒有任何稅制欄位可點，所以切過去時就得回應稅（否則稅額永遠 $0 且改不回來）
    expect(wrapper.find('[data-testid="tax-mode-zero"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="tax-readonly"]').text()).toBe('內含稅額 $48')

    await wrapper.find('[data-testid="total-input"]').setValue('2000')
    expect(wrapper.find('[data-testid="tax-readonly"]').text()).toBe('內含稅額 $95')
    expect(wrapper.find('[data-testid="sales-readonly"]').text()).toBe('銷售額 $1905')
  })

  it('切回三聯式時稅制顯示為應稅（✓ 在應稅格）', async () => {
    const wrapper = mount(App)
    await wrapper.find('[data-testid="tax-mode-exempt"]').trigger('click')
    await wrapper.find('[data-testid="tab-duplicate"]').trigger('click')
    await wrapper.find('[data-testid="tab-triplicate"]').trigger('click')

    expect(wrapper.find('[data-testid="tax-mode-taxable"]').text()).toBe('✓')
    expect(wrapper.find('[data-testid="tax-mode-exempt"]').text()).toBe('')
  })
})

describe('App（期別年與民國日期只收數字）', () => {
  it('期別年填 abc → 空白；日期月填 9a → 9；年填中文 → 空白', async () => {
    const wrapper = mount(App)
    await wrapper.find('[data-testid="period-year-input"]').setValue('abc')
    await wrapper.find('[data-testid="date-month-input"]').setValue('9a')
    await wrapper.find('[data-testid="date-year-input"]').setValue('中文')
    await wrapper.find('[data-testid="date-day-input"]').setValue('2x5')

    expect(inputValue(wrapper, 'period-year-input')).toBe('')
    expect(inputValue(wrapper, 'date-month-input')).toBe('9')
    expect(inputValue(wrapper, 'date-year-input')).toBe('')
    expect(inputValue(wrapper, 'date-day-input')).toBe('25')
  })
})

describe('App（清除重填）', () => {
  async function fillEverything(wrapper: Wrapper) {
    await wrapper.find('[data-testid="period-year-input"]').setValue('120')
    await wrapper.find('[data-testid="period-month-select"]').setValue('11')
    await wrapper.find('[data-testid="buyer-name-input"]').setValue('測試買受人')
    await wrapper.find('[data-testid="ubn-input"]').setValue('12345678')
    await wrapper.find('[data-testid="buyer-address-input"]').setValue('台北市')
    await wrapper.find('[data-testid="date-year-input"]').setValue('99')
    await wrapper.find('[data-testid="date-month-input"]').setValue('7')
    await wrapper.find('[data-testid="date-day-input"]').setValue('25')
    await fillItem(wrapper, 0, '2', '5000')
    await wrapper.find('[data-testid="item-name-0"]').setValue('很長很長的品名'.repeat(5))
    await wrapper.find('[data-testid="item-note-0"]').setValue('備註文字\n第二行')
    await wrapper.find('[data-testid="item-name-4"]').setValue('第五列品名')
    await wrapper.find('[data-testid="item-note-1"]').setValue('第二列備註')
    await wrapper.find('[data-testid="item-amount-1"]').setValue('300')
    await wrapper.find('[data-testid="tax-mode-exempt"]').trigger('click')
  }

  it('清除後買受人、品項、金額全部歸零，稅制回應稅', async () => {
    const wrapper = mount(App)
    await fillEverything(wrapper)

    await wrapper.find('[data-testid="clear-button"]').trigger('click')

    for (const testid of [
      'buyer-name-input',
      'ubn-input',
      'buyer-address-input',
      'date-month-input',
      'date-day-input',
      'item-name-0',
      'item-qty-0',
      'item-price-0',
      'item-amount-0',
      'item-note-0',
      'item-note-1',
      'item-name-4',
      'item-amount-1',
      'sales-input',
      'tax-input',
      'total-input',
    ]) {
      expect(inputValue(wrapper, testid)).toBe('')
    }
    expect(wrapper.find('[data-testid="tax-mode-taxable"]').text()).toBe('✓')
    expect(wrapper.find('[data-testid="tax-mode-exempt"]').text()).toBe('')
    expect(upperSlots(wrapper)).toEqual(['億', '仟', '佰', '拾', '萬', '仟', '佰', '拾', '元'])
  })

  it('清除後期別（年／月份）與民國日期年份回到系統日期預設', async () => {
    const wrapper = mount(App)
    await fillEverything(wrapper)

    await wrapper.find('[data-testid="clear-button"]').trigger('click')

    expect(inputValue(wrapper, 'period-year-input')).toBe(currentRocYear)
    expect(inputValue(wrapper, 'period-month-select')).toBe(currentPeriodMonth)
    expect(inputValue(wrapper, 'date-year-input')).toBe(currentRocYear)
    expect(inputValue(wrapper, 'date-month-input')).toBe('')
    expect(inputValue(wrapper, 'date-day-input')).toBe('')
  })
})
