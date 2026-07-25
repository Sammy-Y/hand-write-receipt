import { test, expect, type Locator, type Page } from '@playwright/test'

/**
 * e2e：紙本同規格版面（InvoiceSheet）。
 * selector 一律用 ui-spec.md 第 5 節的 data-testid 契約，版面細節（列數固定 5、
 * 金額欄也是 input、九格大寫）見第 2、3 節。
 */

// ---- 共用小工具 ----

/** 民國年 = 西元 − 1911（動態計算，不寫死） */
function currentRocYear(): string {
  return String(new Date().getFullYear() - 1911)
}

/** 當月所屬雙月期的起始月（一、二月 → '1'；十一、十二月 → '11'） */
function currentPeriodStartMonth(): string {
  const m = new Date().getMonth() + 1
  return String(m % 2 === 0 ? m - 1 : m)
}

/** 九格大寫：每格文字（去空白），如 10500 → ['億','仟','佰','拾','壹萬','零仟','伍佰','零拾','零元'] */
function upperCells(page: Page): Promise<string[]> {
  return page
    .getByTestId('chinese-upper')
    .locator('.upper-slot')
    .evaluateAll((els) => els.map((el) => (el.textContent ?? '').replace(/\s+/g, '')))
}

function itemRow(page: Page, index: number): Locator {
  return page.locator('table tbody tr').nth(index)
}

function computedStyle(locator: Locator, prop: string): Promise<string> {
  return locator.evaluate(
    (el, name) => getComputedStyle(el).getPropertyValue(name).trim(),
    prop,
  )
}

/** 元素的版位量測（判斷是否被截斷／是否換行增高） */
function metrics(locator: Locator) {
  return locator.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }))
}

/** 被 overflow: hidden 裁掉的高度（> 0 就是吃字） */
async function clippedHeight(locator: Locator): Promise<number> {
  const m = await metrics(locator)
  return m.scrollHeight - m.clientHeight
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

// ---- 1. 三聯式正算 ----

test('三聯式正算：數量 2 × 單價 5000 → 列金額 10000、銷售額 10000、稅 500、總計 10500、大寫九格', async ({
  page,
}) => {
  await expect(page.getByTestId('tab-triplicate')).toHaveClass(/tab-active/)

  await page.getByTestId('item-qty-0').fill('2')
  await page.getByTestId('item-price-0').fill('5000')

  // 以上兩欄填完後皆已離開聚焦（後面欄位從未 focus 過）→ 一律顯示千分位
  await expect(page.getByTestId('item-amount-0')).toHaveValue('10,000')
  await expect(page.getByTestId('sales-input')).toHaveValue('10,000')
  await expect(page.getByTestId('tax-input')).toHaveValue('500')
  await expect(page.getByTestId('total-input')).toHaveValue('10,500')

  // 億～拾萬（第 0～3 格）只有印刷單位字，萬位起才有大寫數字
  expect(await upperCells(page)).toEqual([
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
  await expect(page.getByTestId('upper-digit-0')).toHaveCount(0)
  await expect(page.getByTestId('upper-digit-3')).toHaveCount(0)
  await expect(page.getByTestId('upper-digit-4')).toHaveText('壹')
  await expect(page.getByTestId('upper-digit-6')).toHaveText('伍')
})

// ---- 2. 總計反推 ----

test('三聯式反推：總計輸入 10500 → 銷售額 10000、稅額 500', async ({ page }) => {
  await page.getByTestId('total-input').fill('10500')

  await expect(page.getByTestId('sales-input')).toHaveValue('10,000')
  await expect(page.getByTestId('tax-input')).toHaveValue('500')
  expect((await upperCells(page)).slice(4)).toEqual(['壹萬', '零仟', '伍佰', '零拾', '零元'])
})

// ---- 3. 列金額手動覆寫 ----

test('列金額手動覆寫：直接填 3000 生效；再改數量則清除覆寫回自動計算', async ({ page }) => {
  await page.getByTestId('item-qty-0').fill('2')
  await page.getByTestId('item-price-0').fill('5000')
  await expect(page.getByTestId('sales-input')).toHaveValue('10,000')

  // 手動覆寫列金額（數量／單價不動）；填入後 item-price-0 已離開聚焦 → 顯示千分位
  //
  // item-amount-0 目前顯示的是千分位格式「10,000」（從未被聚焦過）。直接 fill()
  // 即可正確取代成「3000」：InvoiceSheet 的 focus handler 把顯示值從「10,000」
  // 同步改寫成「10000」後，會把選取範圍設回全選，接下來的插入才會是「取代」
  // 而不是「附加」在字尾（F1 修正，見 InvoiceSheet.vue 的 focusRewrite）。
  const amount0 = page.getByTestId('item-amount-0')
  await amount0.fill('3000')
  await expect(page.getByTestId('item-qty-0')).toHaveValue('2')
  await expect(page.getByTestId('item-price-0')).toHaveValue('5,000')
  await expect(page.getByTestId('sales-input')).toHaveValue('3,000')
  await expect(page.getByTestId('total-input')).toHaveValue('3,150')

  // 再改數量 → 覆寫清除，回到 數量 × 單價；item-amount-0 已離開聚焦 → 顯示千分位
  await page.getByTestId('item-qty-0').fill('4')
  await expect(page.getByTestId('item-amount-0')).toHaveValue('20,000')
  await expect(page.getByTestId('sales-input')).toHaveValue('20,000')
  await expect(page.getByTestId('total-input')).toHaveValue('21,000')
})

// ---- 4. 稅額手動覆寫 ----

test('稅額手動覆寫：總計 = 銷售額 + 新稅額，銷售額不變', async ({ page }) => {
  await page.getByTestId('item-qty-0').fill('2')
  await page.getByTestId('item-price-0').fill('5000')
  await expect(page.getByTestId('tax-input')).toHaveValue('500')

  await page.getByTestId('tax-input').fill('800')

  await expect(page.getByTestId('sales-input')).toHaveValue('10,000')
  await expect(page.getByTestId('total-input')).toHaveValue('10,800')
})

// ---- 5. 稅制切換 ----

test('稅制切換：零稅率 → 稅額 0、總計 = 銷售額；回應稅 → 恢復 5%', async ({ page }) => {
  await page.getByTestId('item-qty-0').fill('2')
  await page.getByTestId('item-price-0').fill('5000')
  await expect(page.getByTestId('total-input')).toHaveValue('10,500')
  await expect(page.getByTestId('tax-mode-taxable')).toHaveText('✓')

  await page.getByTestId('tax-mode-zero').click()

  await expect(page.getByTestId('tax-mode-zero')).toHaveText('✓')
  await expect(page.getByTestId('tax-mode-taxable')).toHaveText('')
  // 稅額 0 在紙本上留白（moneyDisplay(0) = ''）
  await expect(page.getByTestId('tax-input')).toHaveValue('')
  await expect(page.getByTestId('sales-input')).toHaveValue('10,000')
  await expect(page.getByTestId('total-input')).toHaveValue('10,000')

  await page.getByTestId('tax-mode-taxable').click()

  await expect(page.getByTestId('tax-mode-taxable')).toHaveText('✓')
  await expect(page.getByTestId('tax-input')).toHaveValue('500')
  await expect(page.getByTestId('total-input')).toHaveValue('10,500')
})

// ---- 6. 二聯式 ----

test('二聯式：無統編、無營業稅列，日期行仍在；數量 1 × 單價 1050 → 內含稅額 50、銷售額 1000', async ({
  page,
}) => {
  await expect(page.getByTestId('ubn-input')).toBeVisible()

  await page.getByTestId('tab-duplicate').click()
  await expect(page.getByTestId('tab-duplicate')).toHaveClass(/tab-active/)

  await expect(page.getByTestId('ubn-input')).toHaveCount(0)
  await expect(page.getByTestId('sales-input')).toHaveCount(0)
  await expect(page.getByTestId('tax-input')).toHaveCount(0)
  await expect(page.getByTestId('tax-mode-taxable')).toHaveCount(0)

  // 民國日期行保留且仍置中
  await expect(page.getByTestId('date-year-input')).toBeVisible()
  await expect(page.getByTestId('date-month-input')).toBeVisible()
  await expect(page.getByTestId('date-day-input')).toBeVisible()

  await page.getByTestId('item-qty-0').fill('1')
  await page.getByTestId('item-price-0').fill('1050')

  await expect(page.getByTestId('total-input')).toHaveValue('1,050')
  await expect(page.getByTestId('tax-readonly')).toHaveText('內含稅額 $50')
  await expect(page.getByTestId('sales-readonly')).toHaveText('銷售額 $1,000')
  expect((await upperCells(page)).slice(5)).toEqual(['壹仟', '零佰', '伍拾', '零元'])
})

// ---- 7. 多列品項 ----

test('多列品項：兩列合計正確；清空第 2 列數量後合計恢復', async ({ page }) => {
  await expect(page.getByTestId('item-name-4')).toBeVisible()
  await expect(page.locator('table tbody tr td textarea[data-testid^="item-name-"]')).toHaveCount(5)

  await page.getByTestId('item-qty-0').fill('1')
  await page.getByTestId('item-price-0').fill('1000')
  await expect(page.getByTestId('sales-input')).toHaveValue('1,000')

  await page.getByTestId('item-qty-1').fill('3')
  await page.getByTestId('item-price-1').fill('200')

  await expect(page.getByTestId('item-amount-1')).toHaveValue('600')
  await expect(page.getByTestId('sales-input')).toHaveValue('1,600')
  await expect(page.getByTestId('total-input')).toHaveValue('1,680')

  await page.getByTestId('item-qty-1').fill('')

  await expect(page.getByTestId('item-amount-1')).toHaveValue('')
  await expect(page.getByTestId('sales-input')).toHaveValue('1,000')
  await expect(page.getByTestId('total-input')).toHaveValue('1,050')
})

// ---- 8. 品名長字串換行 ----

test('品名長字串：自動換行不吃字，列高隨內容增高，表格不橫向溢出', async ({ page }) => {
  const longName = '長品名測試'.repeat(10) // 50 字
  expect(longName.length).toBeGreaterThan(40)

  const nameCell = page.getByTestId('item-name-0')
  const singleLine = page.getByTestId('item-name-1')

  const before = await metrics(nameCell)
  const rowHeightBefore = (await itemRow(page, 0).boundingBox())!.height

  await nameCell.fill(longName)

  // 內容完整保留，不截斷
  await expect(nameCell).toHaveValue(longName)

  const after = await metrics(nameCell)
  // 無水平截斷（換行而非橫向捲動）
  expect(after.scrollWidth).toBeLessThanOrEqual(after.clientWidth + 1)
  // 自動增高：內容高度沒有被裁掉（overflow: hidden 下 scrollHeight ≈ clientHeight）
  expect(after.scrollHeight).toBeLessThanOrEqual(after.clientHeight + 2)
  // 有換行 → 比單行高
  expect(after.clientHeight).toBeGreaterThan(before.clientHeight)
  const singleLineHeight = (await metrics(singleLine)).clientHeight
  expect(after.clientHeight).toBeGreaterThan(singleLineHeight)

  // 該列列高跟著長高（格線延展）
  const rowHeightAfter = (await itemRow(page, 0).boundingBox())!.height
  expect(rowHeightAfter).toBeGreaterThan(rowHeightBefore)

  // 表格本身沒有產生水平溢出
  const table = await metrics(page.locator('table.invoice-grid'))
  expect(table.scrollWidth).toBeLessThanOrEqual(table.clientWidth + 1)
  const wrap = await metrics(page.locator('.overflow-x-auto'))
  expect(wrap.scrollWidth).toBeLessThanOrEqual(wrap.clientWidth + 1)

  // 備註欄同樣可換行不截斷
  await page.getByTestId('item-note-0').fill(longName)
  await expect(page.getByTestId('item-note-0')).toHaveValue(longName)
  const note = await metrics(page.getByTestId('item-note-0'))
  expect(note.scrollWidth).toBeLessThanOrEqual(note.clientWidth + 1)
  expect(note.scrollHeight).toBeLessThanOrEqual(note.clientHeight + 2)
})

// ---- 9. 年月日全部可填 ----

test('年月日皆可填：民國日期三格與期別年份可改、期別月份下拉可選', async ({ page }) => {
  await page.getByTestId('date-year-input').fill('115')
  await page.getByTestId('date-month-input').fill('7')
  await page.getByTestId('date-day-input').fill('15')

  await expect(page.getByTestId('date-year-input')).toHaveValue('115')
  await expect(page.getByTestId('date-month-input')).toHaveValue('7')
  await expect(page.getByTestId('date-day-input')).toHaveValue('15')

  await page.getByTestId('period-year-input').fill('114')
  await expect(page.getByTestId('period-year-input')).toHaveValue('114')

  const period = page.getByTestId('period-month-select')
  await period.selectOption('3')
  await expect(period).toHaveValue('3')
  // 畫面上顯示的選項文字同步更新為「三、四」
  const shown = await period.evaluate(
    (el) => (el as HTMLSelectElement).selectedOptions[0]?.textContent?.trim() ?? '',
  )
  expect(shown).toBe('三、四')

  // 六個雙月期選項
  expect(
    await period.locator('option').evaluateAll((els) =>
      els.map((el) => (el.textContent ?? '').trim()),
    ),
  ).toEqual(['一、二', '三、四', '五、六', '七、八', '九、十', '十一、十二'])
})

// ---- 10. 民國日期行置中 ----

test('民國日期行水平置中於發票寬度，且與統一編號不重疊', async ({ page }) => {
  const sheet = page.locator('.sheet')
  const rocDate = page.locator('.roc-date')
  const ubn = page.getByTestId('ubn-input')

  const sheetBox = (await sheet.boundingBox())!
  const dateBox = (await rocDate.boundingBox())!
  const ubnBox = (await ubn.boundingBox())!

  const sheetCenter = sheetBox.x + sheetBox.width / 2
  const dateCenter = dateBox.x + dateBox.width / 2
  // 置中：日期行中心貼近紙張中心（容許 5% 紙寬誤差），且明顯不貼右
  expect(Math.abs(dateCenter - sheetCenter)).toBeLessThan(sheetBox.width * 0.05)
  expect(dateBox.x + dateBox.width).toBeLessThan(sheetBox.x + sheetBox.width - 40)

  // 統編靠左且與日期不重疊
  expect(ubnBox.x).toBeLessThan(dateBox.x)
  expect(ubnBox.x + ubnBox.width).toBeLessThanOrEqual(dateBox.x + 1)
})

// ---- 11. 大寫數字顏色與置中 ----

test('大寫數字：手寫墨色與印刷單位字不同色，且在格內置中', async ({ page }) => {
  await page.getByTestId('total-input').fill('10500')

  const slot = page.getByTestId('chinese-upper').locator('.upper-slot').nth(4)
  const digit = page.getByTestId('upper-digit-4')
  const unit = slot.locator('.upper-unit')

  await expect(digit).toHaveText('壹')
  await expect(unit).toHaveText('萬')

  const digitColor = await computedStyle(digit, 'color')
  const unitColor = await computedStyle(unit, 'color')
  expect(digitColor).not.toBe(unitColor)

  // 印刷單位字維持 olive，大寫數字為藍色手寫墨
  expect(unitColor).toBe('rgb(107, 100, 20)')
  expect(digitColor).toBe('rgb(29, 78, 216)')

  // 數字＋單位整組在格內置中
  expect(await computedStyle(slot, 'justify-content')).toBe('center')

  // 略大略粗，方便照著抄
  const digitSize = parseFloat(await computedStyle(digit, 'font-size'))
  const unitSize = parseFloat(await computedStyle(unit, 'font-size'))
  expect(digitSize).toBeGreaterThan(unitSize)
  expect(Number(await computedStyle(digit, 'font-weight'))).toBeGreaterThanOrEqual(
    Number(await computedStyle(unit, 'font-weight')),
  )
})

// ---- 11b. 大寫空格橫線槓掉 ----

test('大寫空格橫線槓掉：總計 3570 → 前五格（億仟佰拾萬）劃線、後四格無線；線為 olive 印刷墨；單位字仍可見', async ({
  page,
}) => {
  await page.getByTestId('total-input').fill('3570')

  // 只有高於最高有效位（億／仟／佰／拾／萬，i=0~4）的空格劃線
  await expect(page.getByTestId('chinese-upper').locator('.upper-slot--struck')).toHaveCount(5)
  for (const i of [0, 1, 2, 3, 4]) {
    await expect(page.getByTestId(`upper-struck-${i}`)).toHaveCount(1)
  }
  for (const i of [5, 6, 7, 8]) {
    await expect(page.getByTestId(`upper-struck-${i}`)).toHaveCount(0)
  }

  // 線用 ::after 畫出、絕對定位橫貫格內，顏色同 olive 印刷墨（與單位字同色系）
  const afterStyle = await page.getByTestId('upper-struck-0').evaluate((el) => {
    const cs = getComputedStyle(el, '::after')
    return {
      position: cs.position,
      backgroundColor: cs.backgroundColor,
      height: parseFloat(cs.height),
      left: cs.left,
      right: cs.right,
    }
  })
  expect(afterStyle.position).toBe('absolute')
  expect(afterStyle.backgroundColor).toBe('rgb(107, 100, 20)')
  expect(afterStyle.height).toBeGreaterThanOrEqual(1)
  expect(afterStyle.left).not.toBe('0px')
  expect(afterStyle.right).not.toBe('0px')

  // 印刷單位字仍要看得見（不被線蓋掉或隱藏），且不是用 text-decoration 槓字
  const unit = page.getByTestId('upper-struck-0').locator('.upper-unit')
  await expect(unit).toHaveText('億')
  await expect(unit).toBeVisible()
  const unitBox = await unit.boundingBox()
  expect(unitBox?.width).toBeGreaterThan(0)
  expect(unitBox?.height).toBeGreaterThan(0)
  expect(await computedStyle(unit, 'text-decoration-line')).toBe('none')

  // 總計為 0 或空白時九格一律不劃線
  await page.getByTestId('total-input').fill('')
  await expect(page.getByTestId('chinese-upper').locator('.upper-slot--struck')).toHaveCount(0)
})

// ---- 12. 買受人欄位可填 ----

test('買受人區：名稱、統編、地址皆可填且值保留', async ({ page }) => {
  await page.getByTestId('buyer-name-input').fill('測試商行')
  await page.getByTestId('ubn-input').fill('12345678')
  await page.getByTestId('buyer-address-input').fill('台北市中正區重慶南路一段 122 號')

  await expect(page.getByTestId('buyer-name-input')).toHaveValue('測試商行')
  await expect(page.getByTestId('ubn-input')).toHaveValue('12345678')
  await expect(page.getByTestId('buyer-address-input')).toHaveValue(
    '台北市中正區重慶南路一段 122 號',
  )
})

// ---- 13. 清除重填 ----

test('清除重填：買受人／品項／金額歸零、大寫無數字、期別與日期回預設當年', async ({ page }) => {
  await page.getByTestId('buyer-name-input').fill('測試商行')
  await page.getByTestId('ubn-input').fill('12345678')
  await page.getByTestId('buyer-address-input').fill('台北市中正區重慶南路一段 122 號')
  await page.getByTestId('item-name-0').fill('長品名測試'.repeat(6))
  await page.getByTestId('item-note-0').fill('備註測試')
  await page.getByTestId('item-qty-0').fill('2')
  await page.getByTestId('item-price-0').fill('5000')
  await page.getByTestId('item-amount-1').fill('700')
  await page.getByTestId('period-year-input').fill('110')
  await page.getByTestId('period-month-select').selectOption('11')
  await page.getByTestId('date-year-input').fill('99')
  await page.getByTestId('date-month-input').fill('7')
  await page.getByTestId('date-day-input').fill('15')
  await page.getByTestId('tax-mode-exempt').click()

  await expect(page.getByTestId('total-input')).toHaveValue('10,700')

  await page.getByTestId('clear-button').click()

  await expect(page.getByTestId('buyer-name-input')).toHaveValue('')
  await expect(page.getByTestId('ubn-input')).toHaveValue('')
  await expect(page.getByTestId('buyer-address-input')).toHaveValue('')
  await expect(page.getByTestId('item-name-0')).toHaveValue('')
  await expect(page.getByTestId('item-note-0')).toHaveValue('')
  await expect(page.getByTestId('item-qty-0')).toHaveValue('')
  await expect(page.getByTestId('item-price-0')).toHaveValue('')
  await expect(page.getByTestId('item-amount-0')).toHaveValue('')
  await expect(page.getByTestId('item-amount-1')).toHaveValue('')
  await expect(page.getByTestId('sales-input')).toHaveValue('')
  await expect(page.getByTestId('tax-input')).toHaveValue('')
  await expect(page.getByTestId('total-input')).toHaveValue('')

  // 大寫九格只剩印刷單位字
  expect(await upperCells(page)).toEqual([
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
  await expect(page.getByTestId('chinese-upper').locator('.upper-digit')).toHaveCount(0)

  // 稅制回應稅
  await expect(page.getByTestId('tax-mode-taxable')).toHaveText('✓')
  await expect(page.getByTestId('tax-mode-exempt')).toHaveText('')

  // 期別回當年當期、民國日期年回當年、月日清空
  await expect(page.getByTestId('period-year-input')).toHaveValue(currentRocYear())
  await expect(page.getByTestId('period-month-select')).toHaveValue(currentPeriodStartMonth())
  await expect(page.getByTestId('date-year-input')).toHaveValue(currentRocYear())
  await expect(page.getByTestId('date-month-input')).toHaveValue('')
  await expect(page.getByTestId('date-day-input')).toHaveValue('')
})

// ---- 14. 預設值 ----

test('預設值：期別與民國日期的年份為當年民國年（動態計算），期別月份為當期', async ({ page }) => {
  await expect(page.getByTestId('period-year-input')).toHaveValue(currentRocYear())
  await expect(page.getByTestId('period-month-select')).toHaveValue(currentPeriodStartMonth())
  await expect(page.getByTestId('date-year-input')).toHaveValue(currentRocYear())
  await expect(page.getByTestId('date-month-input')).toHaveValue('')
  await expect(page.getByTestId('date-day-input')).toHaveValue('')

  // 期別整行：印刷字「年」「月份」＋預設選中的雙月期標籤
  const period = page.locator('.period')
  await expect(period).toContainText('年')
  await expect(period).toContainText('月份')
  const shownPeriod = await page
    .getByTestId('period-month-select')
    .evaluate((el) => (el as HTMLSelectElement).selectedOptions[0]?.textContent?.trim() ?? '')
  const start = Number(currentPeriodStartMonth())
  const zh = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二']
  expect(shownPeriod).toBe(`${zh[start - 1]}、${zh[start]}`)
})

// ---- 15. 小數金額：一律整數元，稅額乾淨、大寫九格不空白 ----

test('小數金額：總計 999.99 → 1000／稅 48（無浮點雜訊），大寫九格照樣有數字可抄', async ({
  page,
}) => {
  await page.getByTestId('total-input').fill('999.99')

  await expect(page.getByTestId('total-input')).toHaveValue('1000')
  await expect(page.getByTestId('sales-input')).toHaveValue('952')
  await expect(page.getByTestId('tax-input')).toHaveValue('48')
  expect((await upperCells(page)).slice(5)).toEqual(['壹仟', '零佰', '零拾', '零元'])
  await expect(page.getByTestId('chinese-upper').locator('.upper-digit')).toHaveCount(4)

  // 其他小數入口：總計 100.1、銷售額 1000.5、列金額 100.5
  await page.getByTestId('total-input').fill('100.1')
  await expect(page.getByTestId('total-input')).toHaveValue('100')
  await expect(page.getByTestId('tax-input')).toHaveValue('5')

  await page.getByTestId('sales-input').fill('1000.5')
  // sales-input 剛填完仍聚焦中 → 顯示純數字；total-input 已離開聚焦 → 顯示千分位
  await expect(page.getByTestId('sales-input')).toHaveValue('1001')
  await expect(page.getByTestId('tax-input')).toHaveValue('50')
  await expect(page.getByTestId('total-input')).toHaveValue('1,051')

  await page.getByTestId('item-amount-0').fill('100.5')
  await expect(page.getByTestId('item-amount-0')).toHaveValue('101')
  await expect(page.getByTestId('sales-input')).toHaveValue('101')
  await expect(page.getByTestId('tax-input')).toHaveValue('5')
  await expect(page.getByTestId('total-input')).toHaveValue('106')
  await expect(page.getByTestId('chinese-upper').locator('.upper-digit')).toHaveCount(3)
})

// ---- 16. 負數不進入金額區 ----

test('負數金額：總計 -100 歸零、大寫九格無數字；列金額 -500 顯示 0，畫面不出現負值', async ({
  page,
}) => {
  await page.getByTestId('total-input').fill('-100')

  await expect(page.getByTestId('total-input')).toHaveValue('')
  await expect(page.getByTestId('sales-input')).toHaveValue('')
  await expect(page.getByTestId('tax-input')).toHaveValue('')
  await expect(page.getByTestId('chinese-upper').locator('.upper-digit')).toHaveCount(0)

  await page.getByTestId('item-amount-0').fill('1000')
  await expect(page.getByTestId('sales-input')).toHaveValue('1,000')

  await page.getByTestId('item-amount-0').fill('-500')
  await expect(page.getByTestId('item-amount-0')).toHaveValue('0')
  // 合計歸零時不覆蓋既有金額（ui-spec.md §3），但不會出現負銷售額／負總計
  await expect(page.getByTestId('sales-input')).toHaveValue('1,000')
  await expect(page.getByTestId('total-input')).toHaveValue('1,050')

  await page.getByTestId('tax-input').fill('-9999')
  await expect(page.getByTestId('tax-input')).toHaveValue('')
  await expect(page.getByTestId('sales-input')).toHaveValue('1,000')
  await expect(page.getByTestId('total-input')).toHaveValue('1,000')
})

// ---- 17. 欄寬／字級改變後品名重新增高（不吃字） ----

test('視窗縮窄與字級放大後，長品名依新欄寬重算高度，內容不被裁切', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })

  const longName = '視窗縮放長品名測試內容'.repeat(6)
  const name = page.getByTestId('item-name-0')
  await name.fill(longName)
  await expect.poll(() => clippedHeight(name)).toBeLessThanOrEqual(2)

  // 縮視窗 → 品名欄變窄，需重新增高
  await page.setViewportSize({ width: 500, height: 900 })
  await expect.poll(() => clippedHeight(name)).toBeLessThanOrEqual(2)

  // 字級放大（等同 Ctrl + 放大／系統最小字級設定）
  await page.locator('.sheet').evaluate((el) => {
    ;(el as HTMLElement).style.fontSize = '1.4rem'
  })
  await expect.poll(() => clippedHeight(name)).toBeLessThanOrEqual(2)

  // 放大回原字級後也不能殘留過高／過低
  await page.locator('.sheet').evaluate((el) => {
    ;(el as HTMLElement).style.fontSize = ''
  })
  await expect.poll(() => clippedHeight(name)).toBeLessThanOrEqual(2)
  await expect(name).toHaveValue(longName)

  // 備註欄同樣重算
  const note = page.getByTestId('item-note-0')
  await note.fill(longName)
  await page.setViewportSize({ width: 1400, height: 900 })
  await expect.poll(() => clippedHeight(note)).toBeLessThanOrEqual(2)
})

// ---- 18. 二聯式沒有稅制欄位 → 切過去時回應稅 ----

test('三聯式選零稅率後切二聯式：稅制回應稅，2000 → 內含稅額 $95、銷售額 $1905', async ({
  page,
}) => {
  await page.getByTestId('sales-input').fill('1000')
  await page.getByTestId('tax-mode-zero').click()
  await expect(page.getByTestId('tax-input')).toHaveValue('')

  await page.getByTestId('tab-duplicate').click()
  // 二聯式沒有任何稅制欄位（spec §2 二聯式差異），所以不能讓零稅率沿用成看不見又改不回的狀態
  await expect(page.getByTestId('tax-mode-taxable')).toHaveCount(0)
  await expect(page.getByTestId('tax-readonly')).toHaveText('內含稅額 $48')

  // total-input 目前顯示千分位格式「1,000」且從未被聚焦過；直接 fill() 即可正確
  // 取代（focus handler 回寫後會設回全選，見 F1 修正）
  const total = page.getByTestId('total-input')
  await total.fill('2000')
  await expect(page.getByTestId('tax-readonly')).toHaveText('內含稅額 $95')
  await expect(page.getByTestId('sales-readonly')).toHaveText('銷售額 $1,905')

  await page.getByTestId('tab-triplicate').click()
  await expect(page.getByTestId('tax-mode-taxable')).toHaveText('✓')
  await expect(page.getByTestId('tax-mode-zero')).toHaveText('')
})

// ---- 18b. 金額千分位：blur 顯示逗號、focus 顯示純數字 ----

test('金額千分位：欄位聚焦時顯示純數字，離開欄位（blur）後顯示千分位；連動更新的欄位也套用千分位', async ({
  page,
}) => {
  const sales = page.getByTestId('sales-input')

  await sales.fill('10000')
  // 剛填完仍聚焦中 → 顯示純數字（游標不會因為插入逗號而亂跳）
  await expect(sales).toHaveValue('10000')

  await sales.blur()
  // 離開欄位 → 顯示千分位
  await expect(sales).toHaveValue('10,000')

  // 重新聚焦 → 立刻變回純數字，方便繼續編輯
  await sales.focus()
  await expect(sales).toHaveValue('10000')

  await sales.blur()
  await expect(sales).toHaveValue('10,000')

  // 連動更新（銷售額 → 總計、稅額）且從未被使用者聚焦過的欄位，一律顯示千分位
  await expect(page.getByTestId('total-input')).toHaveValue('10,500')
  await expect(page.getByTestId('tax-input')).toHaveValue('500')

  // 列金額／單價欄位也適用同樣的 focus／blur 規則
  await page.getByTestId('item-qty-0').fill('2')
  const price = page.getByTestId('item-price-0')
  await price.fill('6000')
  await expect(price).toHaveValue('6000') // 剛填完仍聚焦中
  await price.blur()
  await expect(price).toHaveValue('6,000')
  await expect(page.getByTestId('item-amount-0')).toHaveValue('12,000') // 從未聚焦，顯示千分位
})

// ---- 18c. 直接貼上含逗號的金額字串仍可正確解析 ----

test('直接貼上含逗號的金額字串（如「10,500」）能正確解析成數字，不會被當非數字歸零', async ({
  page,
}) => {
  const sales = page.getByTestId('sales-input')

  // Playwright 的 fill() 等同「聚焦→設值→觸發 input」，模擬使用者聚焦後貼上含逗號的字串
  await sales.fill('10,500')
  // 聚焦中立刻剝除逗號、顯示純數字
  await expect(sales).toHaveValue('10500')
  // 稅額／總計依正確解析出的 10500 算出（不是 NaN → 0）
  await expect(page.getByTestId('tax-input')).toHaveValue('525')
  await expect(page.getByTestId('total-input')).toHaveValue('11,025')

  await sales.blur()
  await expect(sales).toHaveValue('10,500')

  // 單價欄位貼上含逗號字串也能正確解析（允許小數，千分位只加在整數部分）
  await page.getByTestId('item-qty-0').fill('1')
  const price = page.getByTestId('item-price-0')
  await price.fill('1,234.5')
  await expect(price).toHaveValue('1234.5')
  await price.blur()
  await expect(price).toHaveValue('1,234.5')
  await expect(page.getByTestId('item-amount-0')).toHaveValue('1,235') // round(1234.5) = 1235
})

// ---- 18d. F1 迴歸：Tab 鍵盤聚焦到已顯示千分位的欄位後直接打字，須為取代而非附加 ----

test('F1 迴歸：Tab 聚焦到已顯示千分位的列金額欄後直接打字，是取代而非附加', async ({ page }) => {
  // 先讓 item-amount-0 離開聚焦，顯示千分位「12,345」
  const amount0 = page.getByTestId('item-amount-0')
  await amount0.fill('12345')
  await amount0.blur()
  await expect(amount0).toHaveValue('12,345')

  // 用鍵盤 Tab（而非滑鼠 click／fill()）從上一欄（單價）聚焦進來：瀏覽器對已有內容的
  // 文字欄位在鍵盤 Tab 聚焦時會全選其內容，這正是 focus handler 的 DOM 回寫
  // （千分位「12,345」→ 純數字「12345」）必須保住的全選範圍（F1）。
  await page.getByTestId('item-price-0').focus()
  await page.keyboard.press('Tab')
  await expect(amount0).toBeFocused()

  // 直接打字（非 fill()）：若全選範圍被回寫清掉、游標收合到字尾，結果會是附加
  // 「12345500」；修好後應是取代，值變成「500」
  await page.keyboard.type('500')
  await expect(amount0).toHaveValue('500')

  await amount0.blur()
  await expect(amount0).toHaveValue('500')
})

test('F1 迴歸：Tab 聚焦到已顯示千分位的單價欄（含小數）後直接打字，是取代而非附加', async ({
  page,
}) => {
  // 先讓 item-price-0 離開聚焦，顯示千分位＋小數「1,234.5」
  const price0 = page.getByTestId('item-price-0')
  await price0.fill('1234.5')
  await price0.blur()
  await expect(price0).toHaveValue('1,234.5')

  // 用鍵盤 Tab 從上一欄（數量）聚焦進來
  await page.getByTestId('item-qty-0').focus()
  await page.keyboard.press('Tab')
  await expect(price0).toBeFocused()

  // 直接打字：修好前會變成「1234.599」（附加），修好後應是取代，值變成「99」
  await page.keyboard.type('99')
  await expect(price0).toHaveValue('99')

  await price0.blur()
  await expect(price0).toHaveValue('99')
})

// ---- 19. 外框 2px、印刷字內距 ----

test('表格外框 2px、內線 1px，表頭與標籤印刷字不貼齊格線（spec §2.4）', async ({ page }) => {
  const headTop = page.locator('table.invoice-grid th.bt2').first()
  const leftCell = page.locator('table.invoice-grid td.bl2').first()
  const rightCell = page.locator('table.invoice-grid td.br2').first()
  const bottomCell = page.locator('table.invoice-grid td.bb2').first()

  expect(await computedStyle(headTop, 'border-top-width')).toBe('2px')
  expect(await computedStyle(leftCell, 'border-left-width')).toBe('2px')
  expect(await computedStyle(rightCell, 'border-right-width')).toBe('2px')
  expect(await computedStyle(bottomCell, 'border-bottom-width')).toBe('2px')

  // 內線維持 1px
  const innerCell = page.locator('table.invoice-grid tbody tr').first().locator('td').nth(1)
  expect(await computedStyle(innerCell, 'border-top-width')).toBe('1px')

  // 印刷字左右有內距（不再是 padding: 0 貼齊格線）
  expect(parseFloat(await computedStyle(headTop, 'padding-left'))).toBeGreaterThan(8)
  expect(parseFloat(await computedStyle(headTop, 'padding-right'))).toBeGreaterThan(8)
  const labelCell = page.locator('table.invoice-grid td.label-cell').first()
  expect(parseFloat(await computedStyle(labelCell, 'padding-left'))).toBeGreaterThan(8)

  // 「零稅率」連成一組置中，不被分散對齊拉開
  const zeroLabel = page.locator('table.invoice-grid td.subhead').nth(1)
  await expect(zeroLabel).toHaveText('零稅率')
  expect(await computedStyle(zeroLabel, 'text-align-last')).toBe('center')
})

// ---- 20. 窄螢幕統一編號不被裁 ----

test('375px 窄螢幕：統一編號 8 碼完整顯示，日期行獨立成行仍置中', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 })
  await page.getByTestId('ubn-input').fill('12345678')

  const ubn = await metrics(page.getByTestId('ubn-input'))
  expect(ubn.scrollWidth).toBeLessThanOrEqual(ubn.clientWidth + 1)

  // 日期行自成一行（在統編下方）且仍置中
  const ubnBox = (await page.getByTestId('ubn-input').boundingBox())!
  const dateBox = (await page.locator('.roc-date').boundingBox())!
  const sheetBox = (await page.locator('.sheet').boundingBox())!
  expect(ubnBox.y + ubnBox.height).toBeLessThanOrEqual(dateBox.y + 1)
  expect(await computedStyle(page.locator('.roc-date'), 'justify-content')).toBe('center')
  const dateCenter = dateBox.x + dateBox.width / 2
  expect(Math.abs(dateCenter - (sheetBox.x + sheetBox.width / 2))).toBeLessThan(
    sheetBox.width * 0.05,
  )
})

// ---- 21. tabs 鍵盤可用 ----

test('發票類型 tabs 可用鍵盤聚焦與切換（Tab → Enter）', async ({ page }) => {
  await page.keyboard.press('Tab')
  await expect(page.getByTestId('tab-triplicate')).toBeFocused()

  await page.keyboard.press('Tab')
  await expect(page.getByTestId('tab-duplicate')).toBeFocused()

  await page.keyboard.press('Enter')
  await expect(page.getByTestId('tab-duplicate')).toHaveClass(/tab-active/)
  await expect(page.getByTestId('ubn-input')).toHaveCount(0)
})

// ---- 22. 民國年月日只收數字 ----

test('期別年與民國日期只收阿拉伯數字（abc 進不去、9a 只留 9）', async ({ page }) => {
  await page.getByTestId('period-year-input').fill('abc')
  await expect(page.getByTestId('period-year-input')).toHaveValue('')

  await page.getByTestId('date-month-input').fill('9a')
  await expect(page.getByTestId('date-month-input')).toHaveValue('9')

  // maxlength=2，非數字字元被濾掉後只留數字（'2x' → '2'、'x5' → '5'）
  await page.getByTestId('date-day-input').fill('2x')
  await expect(page.getByTestId('date-day-input')).toHaveValue('2')

  await page.getByTestId('date-day-input').fill('x5')
  await expect(page.getByTestId('date-day-input')).toHaveValue('5')

  await page.getByTestId('date-year-input').fill('中文')
  await expect(page.getByTestId('date-year-input')).toHaveValue('')
})

// ---- 23. 民國日期合法性驗證：不存在的日期要被夾到合法範圍 ----

test('民國日期合法性驗證：8/32 夾成 8/31，月改 2 後日自動夾到 28/29', async ({ page }) => {
  // 民國 113 = 2024 閏年，先固定年份讓二月天數可預期
  await page.getByTestId('date-year-input').fill('113')
  await page.getByTestId('date-month-input').fill('8')
  await page.getByTestId('date-day-input').fill('32')
  await expect(page.getByTestId('date-day-input')).toHaveValue('31')

  // 月改成 2（閏年）：既有的日 31 超出二月上限，要自動夾到 29
  await page.getByTestId('date-month-input').fill('2')
  await expect(page.getByTestId('date-day-input')).toHaveValue('29')

  // 年改回平年：既有的日 29 超出新上限，要自動夾到 28
  await page.getByTestId('date-year-input').fill('114')
  await expect(page.getByTestId('date-day-input')).toHaveValue('28')
})

// ---- 24. 自動增高流程不得產生瀏覽器錯誤（ResizeObserver loop 守門） ----

test('自動增高（長品名＋縮視窗＋放大字級）全程不產生 console error／page error／window error', async ({
  page,
}) => {
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (error) => pageErrors.push(`${error.name}: ${error.message}`))

  /**
   * 「ResizeObserver loop completed with undelivered notifications」是瀏覽器直接派發到
   * window 的 error 事件（Vite client 就是這樣抓到、跳出 dev 錯誤遮罩並回報到終端機的），
   * 它不經過 console API、也不是 CDP 的 exceptionThrown，所以 page.on('console') 與
   * page.on('pageerror') 兩個都收不到 → 必須自己在頁面內掛 error 監聽器才守得住。
   */
  await page.addInitScript(() => {
    const bucket: string[] = []
    ;(window as unknown as { __pageErrors: string[] }).__pageErrors = bucket
    window.addEventListener('error', (event) =>
      bucket.push(event.message || String((event as ErrorEvent).error)),
    )
    window.addEventListener('unhandledrejection', (event) =>
      bucket.push(String((event as PromiseRejectionEvent).reason)),
    )
  })
  // beforeEach 已經 goto 過，重新載入讓 init script 生效
  await page.reload()

  const longName = '守門長品名測試內容'.repeat(6)
  const name = page.getByTestId('item-name-0')
  const note = page.getByTestId('item-note-0')
  const sheet = page.locator('.sheet')

  await page.setViewportSize({ width: 1400, height: 900 })

  // 1) 一次貼上長品名／備註（fill）
  await name.fill(longName)
  await note.fill(longName)
  // 2) 逐字輸入（每個 input 事件都會 autoGrow，最容易和尺寸觀察打起來）
  await page.getByTestId('item-name-1').pressSequentially('逐字輸入長品名'.repeat(3), { delay: 5 })

  // 3) 連續縮放視窗（欄寬一直變 → 反覆重算高度）
  for (const width of [1200, 900, 700, 640, 500, 375, 800, 1400]) {
    await page.setViewportSize({ width, height: 900 })
    await page.waitForTimeout(60)
  }

  // 4) 放大字級（等同 Ctrl + 放大／系統最小字級）再回復
  await sheet.evaluate((el) => {
    ;(el as HTMLElement).style.fontSize = '1.4rem'
  })
  await expect.poll(() => clippedHeight(name)).toBeLessThanOrEqual(2)
  await sheet.evaluate((el) => {
    ;(el as HTMLElement).style.fontSize = ''
  })
  await expect.poll(() => clippedHeight(name)).toBeLessThanOrEqual(2)

  // 5) 切換聯式與清除重填（重新掛載／重繪 textarea）
  await page.getByTestId('tab-duplicate').click()
  await page.getByTestId('tab-triplicate').click()
  await page.getByTestId('clear-button').click()
  await name.fill(longName)
  await expect.poll(() => clippedHeight(name)).toBeLessThanOrEqual(2)
  // 收斂用：留幾個 frame 讓延後的重算全部跑完
  await page.waitForTimeout(300)

  const windowErrors = await page.evaluate(
    () => (window as unknown as { __pageErrors: string[] }).__pageErrors,
  )
  const all = [...windowErrors, ...consoleErrors, ...pageErrors]

  // 不得有任何未處理錯誤；ResizeObserver loop 是本條守門的主角，訊息單獨點名方便回歸時定位
  expect(all.join('\n')).not.toContain('ResizeObserver')
  expect(windowErrors, `window error: ${windowErrors.join(' | ')}`).toEqual([])
  expect(consoleErrors, `console error: ${consoleErrors.join(' | ')}`).toEqual([])
  expect(pageErrors, `page error: ${pageErrors.join(' | ')}`).toEqual([])

  // 守門不可以靠「關掉自動增高」來過關：內容必須仍然完整顯示、不被裁切
  await expect(name).toHaveValue(longName)
  expect(await clippedHeight(name)).toBeLessThanOrEqual(2)
})
