# UI 規格：紙本統一發票同規格版面

> 參考圖：`docs/assets/invoice-reference.png`（台灣三聯式手寫統一發票，樣式同 https://tw.piliapp.com/vat-calculator/tw/ ）
> 核心原則：**畫面必須長得跟紙本發票一樣，不得自創版面**；但**所有欄位都要能讓使用者自己填**（這是本專案存在的理由——網路上的工具欄位不夠彈性）。自動計算是輔助：會自動帶入衍生欄位，但使用者隨時可手動覆寫任何一格。

## 1. 元件架構

- 新增 `src/components/InvoiceSheet.vue`：渲染**整張發票**（標題、期別、買受人區、品項表格、金額區、大寫欄、註腳）。發票區塊內不用 daisyUI class，用 scoped CSS 做紙本樣式。
- `App.vue`：保留發票類型 tabs（三聯式／二聯式）、「清除重填」按鈕、頁尾說明（daisyUI，屬工具外框），中央改放 `<InvoiceSheet>`。
- **刪除** `src/components/ItemsTable.vue`、`AmountPanel.vue` 及其測試檔；新寫 `InvoiceSheet.test.ts`；`App.test.ts` 對應改寫。
- `src/lib/invoice.ts` 既有函式不動，新增純函式（含單元測試）：
  - `upperDigits(total: number): (string | null)[]` — 回傳九個位置 `[億,仟,佰,拾,萬,仟,佰,拾,元]` 的大寫數字（`DIGITS`），高於最高有效位者為 `null`；`total <= 0` 或非整數時全為 `null`。例：10500 → `[null,null,null,null,'壹','零','伍','零','零']`。
  - `rowAmount(item: InvoiceItem): number` — `item.amount ?? lineAmount(item)`（手動覆寫優先）。
  - `rowsTotal(items: InvoiceItem[]): number` — rowAmount 加總。
- `src/types.ts`：
  - `Buyer` 加 `address: string`。
  - 新增 `InvoiceItem`：`{ name: string; quantity: number | null; unitPrice: number | null; amount: number | null; note: string }`（`amount: null` = 自動由數量×單價計算）。
  - 新增 `TaxMode = 'taxable' | 'zeroRate' | 'exempt'`（應稅／零稅率／免稅）。

## 2. 版面（三聯式，由上而下，全部在發票紙張框內）

1. **標題**：置中「統　一　發　票（三聯式）」，粗體、寬字距。
2. **期別**：置中一行「[年 input] 年 [月份 下拉] 月份」——**年份使用者可填**（`period-year-input`，民國年阿拉伯數字 3 碼，預設當年 = 西元 − 1911）；**月份為下拉選單**（`period-month-select`），固定六個雙月期選項，顯示中文：「一、二」「三、四」「五、六」「七、八」「九、十」「十一、十二」，預設依當月推算。前後「年」「月份」為印刷字。整行置中。
   - 下拉與 input 需融入紙本樣式：透明底、無框（或僅底線）、olive 字、字級同印刷字、`appearance: none`（下拉可保留極小箭頭或以 hover 提示可點）。
3. **買受人資訊區**（表格上方，左對齊，底線式輸入框）：
   - 「買 受 人：」input（`buyer-name-input`）
   - 「統一編號：」input（8 碼、`inputmode="numeric"`、`ubn-input`）——僅三聯式。
   - **民國日期行**：「中 華 民 國 [年 input] 年 [月 input] 月 [日 input] 日」——**年／月／日三格全部由使用者填**（`date-year-input`、`date-month-input`、`date-day-input`；年預設當年民國年、月日預設空白，皆可改）。
     - **日期合法性驗證（2026-07-25 新增，推翻先前「不驗證日期」的決定）**：不得出現不存在的日期（例如 8 月 32 日）。
       - 月只接受 1～12，超出即夾到 12。
       - 日只接受 1～該月天數，超出即夾到上限；天數依**民國年換算西元年**（西元 = 民國 + 1911）判斷閏年，二月為 28 或 29 日。月份未填時上限以 31 計。
       - 修改月份或年份後，若現有的日已超出新的上限，日要**跟著夾到上限**（例：日 31、月改成 2 → 28 或 29；日 29、年由閏年改為平年 → 28）。
       - 夾值後必須把結果**同步寫回畫面**（沿用金額欄同樣的回寫做法），否則畫面會殘留使用者打的無效值。
       - 期別年份不受此規則影響（僅維持 3 碼數字限制）。此行**水平置中**於發票紙張寬度（比參考圖更靠中間，不要貼右）；與統一編號同一視覺列時，統編靠左、日期置中，兩者不重疊（窄螢幕可讓日期行獨立成行仍保持置中）。
   - 「地　　址：」input（`buyer-address-input`）
4. **主表格**（單一 `<table>`，`border-collapse`，外框 2px、內線 1px 同色）：
   - 表頭：品名（寬）｜數量｜單價｜金額｜備註（寬），寬字距。
   - **品項固定 5 列**（跟紙本一樣，無新增/刪除按鈕）：
     - 品名：**必須能換行，不可截斷或被吃字**。改用自動增高的 `<textarea>`（`item-name-0`〜`item-name-4`，`rows="1"`、`resize: none`、`overflow: hidden`、`white-space: pre-wrap`、`word-break: break-word`、`line-height` 固定，input 事件時依 `scrollHeight` 調整高度）。內容變長時該列列高自然增高，格線隨之延展（紙本感保留：仍是同一張表格的框線）。手動按 Enter 可換行。
     - 備註欄（`item-note-0`、`item-note-1`）同樣採自動增高 textarea，可換行。
     - 數量／單價 number input（清空 = null；`item-qty-N`、`item-price-N`）
     - **金額也是 input**（`item-amount-N`）：預設自動顯示 rowAmount；使用者可直接輸入覆寫（設 `amount`）；之後再改數量或單價則清除覆寫（`amount = null`）回到自動計算。
     - 備註欄結構：第 1、2 列為可填欄位；第 3 列為獨立一格顯示印刷字「營業人蓋用統一發票專用章」（字下即格線）；第 4 列起以單一合併空白格延伸到大寫列，使 2px 外框完整封閉右下蓋章區。
5. **金額區**（同一張表格延續）：
   - 列「銷　售　額　合　計」（合併品名+數量+單價三欄）｜金額欄 number input（`sales-input`）｜備註欄空白格。
   - 列「營　業　稅」＋子欄「應稅｜零稅率｜免稅」——三個子欄各有下方小格，**可點選**（radio 行為，`tax-mode-taxable`／`tax-mode-zero`／`tax-mode-exempt`），選中者顯示「✓」，預設應稅｜**稅額欄也是 input**（`tax-input`），可手動覆寫。
   - 列「總　　　計」（合併左側）｜number input（`total-input`）。
   - 列「總計新臺幣（中文大寫）」標籤（左，小字兩行可）＋九格「億 仟 佰 拾 萬 仟 佰 拾 元」：每格印刷單位字，`upperDigits` 有值時在單位字**前**顯示大寫數字（10500 → 「壹萬 零仟 伍佰 零拾 零元」，億～拾萬格只有印刷單位字）。整排容器 `chinese-upper`（唯讀，自動跟隨總計）。
     - **大寫數字（實際數值）必須在格內置中**（`justify-content: center`，數字＋單位整組居中，不貼齊格線左緣）。
     - **刻意保留的行為（2026-07-25 使用者確認，勿「修正」）**：數值貼齊各自的印刷單位字，因此金額位數少時整串會偏右、左側的億／仟／佰／拾／萬空著——這與紙本寫法一致，是刻意的。**不要**為了視覺平衡把數值整組置中、隱藏空的單位字，或在下方多加一行置中大字。
     - **大寫數字用不同顏色**與印刷單位字區隔：數字用「手寫墨」色（藍 `#1d4ed8` 一類，class 如 `.upper-digit`），單位字維持 olive 印刷色；數字字級可略大、字重略粗，方便照著抄。
     - **空格以橫線槓掉（2026-07-25 新增）**：總計有值時，高於最高有效位、沒有大寫數字的格子（例如總計 3,570 時的億／仟／佰／拾／萬）要以一條**橫線劃掉**該格，這是紙本防止事後塗改金額的寫法。實作用 class（如 `.upper-slot--struck`）畫線，線色同 olive 印刷墨、橫貫該格；印刷單位字仍需看得見（不要蓋掉或隱藏）。
       - **總計為 0 或空白時九格一律不劃線**（空白表單不該滿排橫線）。
       - 此規則與上一條「不要隱藏空的單位字」並不衝突：格子與單位字都保留，只是多一條槓掉的線。
6. **註腳**（框內最下）：左小字「※應稅、零稅率、免稅之銷售額應分別開立統一發票，並應於各該欄打「✓」。」；右「第一聯　存根聯」。

### 二聯式差異

- 標題「統　一　發　票（二聯式）」；**無統一編號列**（民國日期行仍保留且維持置中，年/月/日皆可填）。
- 金額區只有「總　計」input 列與中文大寫列（無銷售額合計、無營業稅列）。
- 發票框**外**下方小字：「內含稅額 $X｜銷售額 $Y」（`tax-readonly`、`sales-readonly`）。

## 3. 計算行為（自動帶入 + 全欄位可覆寫）

- 改數量/單價 → 該列金額自動 = round(數量×單價)，並清除該列手動覆寫。
- 改列金額 → 記為手動覆寫（amount 設值）。
- 任何品項金額變動 → 合計 = rowsTotal；三聯式：合計帶入銷售額並依稅制往下算；二聯式：合計帶入總計反推。合計為 0 時不覆蓋既有金額。
- 改銷售額 → 應稅：稅 = round(銷售額×5%)；零稅率/免稅：稅 = 0。總計 = 銷售額 + 稅。
- 改稅額（手動覆寫）→ 總計 = 銷售額 + 稅（銷售額不動）。
- 改總計 → 應稅：銷售額 = round(總計÷1.05)、稅 = 總計 − 銷售額；零稅率/免稅：銷售額 = 總計、稅 = 0。
- 切換應稅/零稅率/免稅 → 以現有銷售額重算稅與總計。
- 切換三聯/二聯 tab → 品項合計 > 0 時依新模式重算，否則保留。
- 清除重填 → 買受人（含地址、月/日）、5 列品項（含備註、覆寫）、金額全部歸零，稅制回應稅。
- 中文大寫九格永遠自動跟隨總計。

## 4. 視覺

- 紙張底色 cream（近 `#f5f3e7`）、墨色 olive（近 `#6b6414`），線與字同色；發票區塊配色固定（不隨深色主題變動）。
- 輸入框透明底、無邊框，融入格線；focus 淡色 outline；數字靠右。

### 金額千分位（2026-07-25 新增，推翻先前「不加千分位」的決定）

- **加三位撇的欄位**：各列金額（`item-amount-N`）、單價（`item-price-N`）、銷售額（`sales-input`）、營業稅額（`tax-input`）、總計（`total-input`），以及二聯式框外的內含稅額／銷售額（`tax-readonly`／`sales-readonly`）。
- **不加的欄位**：數量（`item-qty-N`，是計數不是金額）、期別年份與民國日期年月日。
- **編輯中不加、離開欄位才加**：input 取得 focus 時顯示純數字（好編輯、游標不會亂跳），blur 後顯示千分位。使用者未在編輯的欄位（例如改總計後被連動更新的銷售額與稅額）一律顯示千分位。
- 解析輸入時要先**剝除逗號**再交給 `normalizeMoney`，避免 `10,500` 被當成非數字歸零。
- 單價允許小數，千分位只加在整數部分（`1,234.5`）。
- 金額為 0 依紙本留白的規則不變；列金額被明確覆寫為 0 時仍顯示 `0`。
- **不要**複製參考圖的浮水印、廠商 logo（利百代、No.100）。
- RWD：發票區塊外層 `overflow-x-auto`、內容 `min-width` 約 640px——窄螢幕橫向捲動，**版面不重排**（跟紙一樣）。

## 5. data-testid 契約（e2e 與元件測試共用）

`tab-triplicate`、`tab-duplicate`、`clear-button`、`period-year-input`、`period-month-select`、`buyer-name-input`、`ubn-input`、`buyer-address-input`、`date-year-input`、`date-month-input`、`date-day-input`、`item-name-N`、`item-qty-N`、`item-price-N`、`item-amount-N`、`item-note-0/1`、`sales-input`、`tax-input`、`total-input`、`tax-mode-taxable/zero/exempt`、`chinese-upper`、（大寫數字）`upper-digit-N`（N = 0～8，由億到元；僅在該位有數字時存在）、（大寫空格橫線槓掉）`upper-struck-N`（N = 0～8；僅該格因高於最高有效位而被橫線槓掉時存在，總計為 0 或空白時不存在）、（二聯式框外）`tax-readonly`、`sales-readonly`。

## 6. 清除重填涵蓋範圍

清除時一併重置：買受人名稱／統編／地址、民國日期（年回當年、月日清空）、期別（年回當年、月份回當期）、5 列品項（品名/數量/單價/金額覆寫/備註）、銷售額/稅額/總計、稅制回應稅。發票類型（三聯式／二聯式）維持不變。

## 7. 測試覆蓋範圍

測試檔集中在 `tests/`：單元／元件測試在 `tests/unit/`（Vitest），端對端測試在 `tests/e2e/`（Playwright）。

- `tests/unit/invoice.test.ts`：`upperDigits`（0、10500、100001、1e8、九位上限、非整數）、`rowAmount`／`rowsTotal`（覆寫優先）、`normalizeMoney`（負數／小數／NaN／Infinity）、`fromSalesByMode`／`fromTotalByMode`／`withTaxOverride`、恆等式全值域掃描、`formatMoney`（整數千分位、小數僅整數部分加逗號、負數、null／非有限數回空字串）、`daysInMonth`／`clampMonthValue`／`clampDayValue`（月份夾 1～12、日夾該月天數、二月依民國年換算西元年判斷閏年 28／29、年或月為 null 時的降級上限）。
- `tests/unit/InvoiceSheet.test.ts`：固定 5 列、金額覆寫 emit 與 DOM 回寫、稅制 ✓ 切換、三聯／二聯列差異、大寫九格內容與顏色契約、大寫空格橫線槓掉（3570 → 前五格劃線後四格無、0 或空白不劃線）、期別下拉六選項、日期只收數字與合法性驗證（8/32 夾 8/31、換月換年連動重夾）、textarea 自動增高與 ResizeObserver 行為、不 mutate props；金額千分位（focus 顯示純數字、blur 顯示千分位、單價小數千分位只加整數部分、貼上含逗號字串正確解析）；單價編輯中保留使用者打到一半的小數點（不強制清成整數）；單價 `type="text"` 濾除字母等非數字字元、不因此被判為 `null` 而靜默清空（F3）。
- `tests/unit/App.test.ts`：雙向計算、稅額手動覆寫、零稅率歸零、小數與負數正規化、切二聯式回應稅、清除重填涵蓋範圍。
- `tests/e2e/invoice.spec.ts`：本節 testid 契約全覆蓋，另含長品名不截斷（含縮放視窗與放大字級）、外框 2px／內線 1px、375px 統編不被裁、tabs 鍵盤操作、大寫空格橫線槓掉的位置與 olive 線色量測、金額千分位 focus／blur 顯示切換、貼上含逗號金額字串解析、民國日期合法性驗證（8/32 夾 8/31、換月換年連動重夾）、**F1 迴歸：鍵盤 Tab 聚焦到已顯示千分位的列金額／單價欄後直接打字，斷言是取代而非附加**、操作全程無 console／page／window error。
