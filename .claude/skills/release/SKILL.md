---
name: release
description: 發布新版本 — 版號、CHANGELOG、四道關卡、commit、annotated tag、GitHub Release。當使用者說「發一版」「打 tag」「release」「發布」時使用。
---

# 發布流程

## 1. 決定版號（語意化版本）

- 有 Added 或 Changed → minor（1.0.0 → 1.1.0）
- 只有 Fixed → patch
- 版號要同時改 `package.json` 與 CHANGELOG 章節

## 2. CHANGELOG 格式

`CHANGELOG.md` 用 Keep a Changelog 的**英文標準標頭**，內文寫繁體中文：

    ## [1.1.0] - 2026-07-25

    ### Added
    ### Changed
    ### Fixed
    ### Notes          ← 測試數字、驗證方式等補充
    ### Known Issues   ← 已知限制

只寫用到的標頭。可用標頭：Added / Changed / Deprecated / Removed / Fixed / Security，
外加本專案慣用的 Notes 與 Known Issues。

分類看語意而不是看「使用者叫它 bug」：新行為進 Added、既有行為改變進 Changed、
壞掉修好進 Fixed。每條寫「原本什麼症狀 → 現在什麼行為」，讓沒看過程式的人也懂。

檔案最後維護版本連結：

    [1.1.0]: https://github.com/Sammy-Y/hand-write-receipt/releases/tag/v1.1.0

## 3. 發布前四道關卡（全過才能發）

`npm test` → `npx playwright test` → `npx vue-tsc -b` → `npx vite build`

順手確認 `tests/e2e/` 沒有暫時檔殘留、`git status` 沒有未追蹤檔案。

## 4. Commit

標題一行，內文用 Added／Changed／Fixed 分段（同 CHANGELOG 分類），結尾附測試數字。
訊息最後加：

    Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

## 5. Annotated tag 與推送

    git tag -a vX.Y.Z -F -   # 內容為該版摘要，同 CHANGELOG 分類
    git push origin main
    git push origin vX.Y.Z

## 6. GitHub Release

`gh` 已登入（帳號 Sammy-Y，token 含 `repo` scope），直接用即可；若哪天失效就 `gh auth login`。

**Release 的 title 只放版號**（`v1.1.0`），不要在後面加中文摘要——摘要在 release notes
裡就有了，title 保持乾淨一致。

    awk '/^## \[X\.Y\.Z\]/{f=1; next} /^## \[/{f=0} f' CHANGELOG.md > /tmp/notes.md
    gh release create vX.Y.Z --title "vX.Y.Z" --notes-file /tmp/notes.md --verify-tag

Release 建立完成就結束，回報 release 網址給使用者。

## 發布後不做的事

- **不用等 Vercel 部署完成、也不用去查部署狀態。** push 到 `main` 會自動觸發 Production
  部署，讓它自己跑；build 失敗也不會弄壞線上站（前一版繼續服務）。
- **不用對線上網址再跑一輪 e2e。** 驗證以發布前的本機四道關卡（第 3 步）為準。
