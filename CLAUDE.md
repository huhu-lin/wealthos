# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

WealthOS 是個人財務管理儀表板（繁體中文），支援台股、美股、加密貨幣與負債追蹤、FIRE 退休規劃、現金流管理，以及 KDJ + 布林通道策略訊號與多組合回測。

## 開發指令

```bash
npm run dev      # Vite 開發伺服器（http://localhost:5173）
npm run build    # 生產建置
npm run lint     # ESLint 靜態分析
npm run preview  # 預覽生產建置
```

本專案**沒有測試框架**。

kline-api Python 服務（`kline-api/`）需另行啟動：`uvicorn main:app --reload`

## 架構總覽

**三層服務架構：**

```
前端 (React + Vite → Vercel)
  └─ /api/*.js  Vercel Edge Functions（Node, runtime: 'edge'）
       ├─ proxy 外部 API（FinMind、Yahoo Finance、CoinGecko）
       ├─ Telegram webhook 接收指令
       └─ Vercel Cron（平日 06:45 UTC）：signal-check / update-prices / warm-cache

kline-api/ (Python FastAPI → Render/Railway)
  └─ GET /kline/tw, /kline/us → 回傳 OHLCV；寫入 Supabase kline_cache（用 SERVICE_KEY）

Supabase (PostgreSQL + Auth + RLS)
  └─ supabase/functions/daily-update/ (Deno) — 每日價格快照備援
```

**前端路由：** `App.jsx` 用 `useState(tab)` 條件渲染各頁，**無 React Router**。每個 Tab 是獨立元件（`src/components/`）。

**主題系統（`src/constants/theme.js`）：**
- `C` — 色彩 token（`C.accent`, `C.red`, `C.bg` 等）
- `T` — 字級 scale（`T.h1`~`T.caption`、`T.mono`）
- `S` — 8px 間距 grid（`S.sm`, `S.md`, `S.xl` 等）
- `fmt` / `fmtM` / `pct` — 數字格式化工具函式

**資料流：**
- 前端需取外部資料 → `src/utils/priceApi.js` → `/api/*` Edge Function → 外部 API
- 前端需取 K 線 → `src/strategy/klineApi.js` → `/api/kline-tw` 或 `/api/kline-us` → Render 服務
- 策略指標計算邏輯在 `src/utils/strategyIndicators.js`（前端回測）與 `api/signal-check.js`（伺服器端）共用相同邏輯

## 絕對禁止事項

1. **禁止 hardcode 色碼**：所有顏色、字級、間距必須使用 `src/constants/theme.js` 的 `C`、`T`、`S`、`fmt`
2. **Edge Function 必須宣告 runtime**：每個 `/api/*.js` 都要有 `export const config = { runtime: 'edge' }`
3. **禁止繞過 RLS**：用 JWT forward 而非 `SERVICE_KEY`（例外：kline-api 寫入 `kline_cache` 才用 `SUPABASE_SERVICE_KEY`）
4. **禁止引入 React Router**：Tab 路由固定用 `App.jsx` 的 `useState(tab)` 條件渲染
5. **禁止前端直接呼叫外部 API**：一律走 `src/utils/priceApi.js`

## 環境變數

| 變數 | 用途 |
|------|------|
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | 前端 Supabase client |
| `FINMIND_TOKEN` | FinMind API（Edge Function 私密） |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | Edge Function / kline-api Supabase client |
| `SUPABASE_SERVICE_KEY` | kline-api 寫入 kline_cache 專用 |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Telegram 通知與 webhook |
| `KLINE_API_URL` | Render/Railway kline-api 服務端點 |
| `ALLOWED_ORIGINS` | kline-api CORS 白名單 |

## 技能索引（按需載入）

| 主題 | 技能檔路徑 |
|------|------------|
| 前端慣例（主題常數、Tab 路由、共用元件、Price API） | `.claude/skills/frontend-conventions/SKILL.md` |
| Vercel Edge Functions 規範 | `.claude/skills/api-edge-functions/SKILL.md` |
| Supabase 資料表結構與 RLS | `.claude/skills/database-schema/SKILL.md` |
| KDJ + 布林策略指標邏輯 | `.claude/skills/strategy-logic/SKILL.md` |
| 環境變數 + GitHub Actions 排程 | `.claude/skills/devops-automation/SKILL.md` |
