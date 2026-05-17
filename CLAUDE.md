# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案概述

WealthOS 是一個個人資產追蹤儀表板，以繁體中文介面為主，支援台股、美股、加密貨幣、其他資產與負債管理，並具備技術指標策略（KDJ + 布林通道）的再平衡訊號系統。

## 開發指令

```bash
npm run dev       # 啟動本機開發伺服器（Vite，http://localhost:5173）
npm run build     # 生產環境建置
npm run lint      # ESLint 靜態分析
npm run preview   # 預覽生產建置
```

本專案沒有測試框架。

### 環境變數設定

複製 `.env.example` 為 `.env.local`，填入以下變數：

| 變數 | 用途 |
|------|------|
| `VITE_SUPABASE_URL` | 前端 Supabase 連線（需 `VITE_` 前綴） |
| `VITE_SUPABASE_ANON_KEY` | 前端 Supabase anon key |
| `SUPABASE_URL` | Vercel API 路由用（不加 `VITE_`） |
| `SUPABASE_ANON_KEY` | Vercel API 路由用 |
| `FINMIND_TOKEN` | FinMind API Token（台股/美股歷史資料） |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | 再平衡訊號推播 |
| `KLINE_API_URL` | kline-api 微服務 URL（Render/Railway） |

## 系統架構

```
前端（React + Vite）── Vercel 部署
    │
    ├── /api/*.js        Vercel Edge Functions（serverless 後端）
    │
    ├── Supabase         資料庫（PostgreSQL + Auth + RLS）
    │
    └── kline-api/       獨立 Python FastAPI 微服務
                         部署於 Render/Railway
```

### 資料流

- **前端**：`App.jsx` 啟動時從 Supabase 撈取全部資料（assets、liabilities、pledges、monthly_snapshots），並取得即時 USD/TWD 匯率
- **股價更新**：`/api/update-prices` — Edge Function，直連 Yahoo Finance 更新資產現價，每日由 GitHub Actions 自動觸發（UTC 00:00 與 05:30）
- **K 線資料**：`kline-api/main.py` — FastAPI 服務，以 yfinance 抓還原股價，快取寫入 Supabase `kline_cache` 表
- **再平衡訊號**：`/api/signal-check` — 每日盤前（UTC 06:45）計算 KDJ + 布林指標，觸發時推播 Telegram
- **晨間摘要**：`scripts/morning_brief.py` — 用 Gemini API 生成總經摘要，存入 `morning_brief` 表

### Supabase 資料表

| 資料表 | 說明 |
|--------|------|
| `assets` | 各類資產（tw/us/crypto/other），欄位含 `shares`、`ticker`、`value_twd`、`account` |
| `liabilities` | 負債，欄位含 `value`（台幣） |
| `pledges` | 質押資產，含 `shares`、`ticker`、`market_value` |
| `monthly_snapshots` | 每日淨值快照（date、assets、liabilities、net、leverage） |
| `strategy_tickers` | 監控中的策略股票，含 `ticker`、`is_us`、`target`（目標比例）、`j_entry`、`j_exit`、`strategy_mode` |
| `kline_cache` | K 線快取（ticker、days、cached_date、data JSON），由 kline-api 寫入 |
| `morning_brief` | AI 晨間摘要，含 `brief_date`、`content` |

所有資料表均啟用 RLS，`user_id IS NULL` 的舊資料會在首次登入時自動歸屬給目前使用者（`App.jsx` 的自動認領邏輯）。

## 前端架構慣例

### 設計常數（`src/constants/theme.js`）

**所有顏色、格式化函式都集中在此**，不要在元件裡寫 hardcode 色碼：

```js
import { C, TT, fmt, fmtM, pct } from "../constants/theme";

C.accent    // 主色（綠）— 正值、主要按鈕
C.red       // 負值、警示
C.gold      // 警告、槓桿
C.blue      // 美股、資產總值
C.text      // 主要文字
C.textMuted // 次要文字

fmt(n)      // 千分位整數（台幣常用）
fmtM(n)     // 百萬/千縮寫（圖表 Y 軸）
pct(n)      // 百分比
TT          // recharts Tooltip 統一樣式
```

`LEVERAGE_MAP` 也在此，存放槓桿 ETF 的倍率對照表（如 TQQQ: 3、00675L: 2）。

### Tab 路由

`App.jsx` 用簡單的 `useState(tab)` 實作 tab 切換，無 React Router，依 `tab` 值條件渲染對應元件：

```
overview → Overview.jsx
tw       → TWAccount.jsx
us       → USAccount.jsx
crypto   → CryptoAccount.jsx
other    → OtherAccount.jsx
liab     → Liabilities.jsx
pledge   → Pledge.jsx
strategy → Strategy.jsx（獨立於 src/，非 components/ 下）
```

### 共用 UI 元件（`src/components/ui/`）

`Card`、`Badge`、`Modal`、`KPI`、`FormControls`、`TabBtn`、`GlobalStyles` — 這些是跨頁面共用的原子元件。

`Strategy.jsx` 是例外，它直接在檔案內定義自己的 `Card`、`Badge`、`Btn`、`Input` 元件，未使用 `src/components/ui/`。

### 價格 API（`src/utils/priceApi.js`）

前端所有外部 API 呼叫都走此模組（帶 timeout 與重試）：

- `fetchTWPrice(stockId)` — 台股，透過 `/api/finmind-price` proxy
- `fetchUSPrice(ticker)` — 美股，透過 `/api/finmind-price` proxy
- `fetchCryptoPrice(coinId)` — 加密，直連 CoinGecko（coinId 如 `"bitcoin"`）
- `fetchUSDTWD()` — 透過 `/api/usdtwd` proxy，抓 Yahoo Finance

## Vercel Edge Functions（`/api/*.js`）

所有 API 路由都是 Edge Function，必須加：

```js
export const config = { runtime: 'edge' };
```

`/api/update-prices` 支援用戶 JWT forward（`Authorization: Bearer <token>`），以確保 RLS 正確運作，不需要 SERVICE_KEY。

## kline-api（`kline-api/main.py`）

獨立的 Python FastAPI 微服務，部署於 Render 或 Railway：

- `GET /kline/tw?ticker=006208&days=720` — 台股還原 K 線
- `GET /kline/us?ticker=QLD&days=720` — 美股還原 K 線
- `GET /health` — 健康檢查

台股 ticker 會自動加上 `.TW` 後綴。快取機制：先查 `kline_cache`（Supabase），沒有或過期才打 yfinance。快取 key 使用台灣時區日期（`_TW` 後綴用於台股過期判斷）。寫入快取需要 `SUPABASE_SERVICE_KEY`（anon key 因 RLS 無寫入權限）。

## 策略指標邏輯

KDJ + 布林通道（`signal-check.js` 與 `Strategy.jsx` 共用同樣邏輯）：

- **布林通道**：20 期，±2σ
- **KDJ**：9 期，使用真實 High/Low（非 closes 的 max/min），與 TradingView 標準一致
- **訊號模式**：`signal`（雙確認）vs `asymmetric`（P002：買入用 KDJ，賣出用偏移閾值）
- 訊號判斷使用**跨 K 棒記憶旗標**（`jBelowFlag`/`jAboveFlag`），掃描完整歷史後才輸出最新一棒的訊號

## GitHub Actions 自動化排程

| Workflow | 執行時間（UTC） | 說明 |
|----------|----------------|------|
| `daily-update.yml` | 00:00 & 05:30 週一至五 | 更新資產現價 + 每日快照 |
| `daily-precache.yml` | 22:00 每日 | 預熱台股 K 線快取 |
| `daily-precache-us.yml` | 23:30 每日 | 預熱美股 K 線快取（美股需等收盤後穩定） |
| `morning-brief.yml` | 22:30 每日（= TWN 06:30） | 生成 AI 晨間摘要（存 Supabase 給前端） |
| `premarket-telegram.yml` | 00:00 週一至五（= TWN 08:00） | 推播盤前重點（美股/台指期夜盤/國際/AI 研判，新聞來源：鉅亨網+UDN money+CNBC，24h 過濾） |
| `postmarket-telegram.yml` | 07:30 週一至五（= TWN 15:30） | 推播盤後總結（台股收盤/三大法人/AI 分析，新聞來源：鉅亨網+UDN money，24h 過濾） |
| `keep-render-warm.yml` | 固定間隔 | 防止 Render 免費方案冷啟動 |

Vercel 另有 cron（`vercel.json`）在 UTC 06:45 週一至五觸發 `signal-check`、`warm-cache`、`update-prices`。
