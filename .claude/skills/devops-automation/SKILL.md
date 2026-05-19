# 環境變數與自動化排程

## 環境變數

複製 `.env.example` 為 `.env.local`：

| 變數 | 用途 | 前綴規則 |
|------|------|----------|
| `VITE_SUPABASE_URL` | 前端 Supabase 連線 | 需 `VITE_` 前綴（Vite 才能注入） |
| `VITE_SUPABASE_ANON_KEY` | 前端 anon key | 需 `VITE_` 前綴 |
| `SUPABASE_URL` | Vercel Edge Function 用 | 不加 `VITE_` |
| `SUPABASE_ANON_KEY` | Vercel Edge Function 用 | 不加 `VITE_` |
| `SUPABASE_SERVICE_KEY` | kline-api 寫入快取用 | 僅後端使用，絕對不能暴露前端 |
| `FINMIND_TOKEN` | FinMind API（台股/美股歷史資料） | — |
| `TELEGRAM_BOT_TOKEN` | 再平衡訊號推播 | — |
| `TELEGRAM_CHAT_ID` | 推播目標頻道 | — |
| `KLINE_API_URL` | kline-api 微服務 URL（Render/Railway） | — |

## GitHub Actions 排程

| Workflow | 執行時間（UTC） | 台灣時間 | 說明 |
|----------|----------------|----------|------|
| `daily-update.yml` | 00:00 & 05:30 週一至五 | 08:00 & 13:30 | 更新資產現價 + 每日快照 |
| `daily-precache.yml` | 22:00 每日 | 06:00+1 | 預熱台股 K 線快取 |
| `daily-precache-us.yml` | 23:30 每日 | 07:30+1 | 預熱美股 K 線快取（需等美股收盤後穩定） |
| `morning-brief.yml` | 22:30 每日 | 06:30+1 | Gemini 生成 AI 晨間摘要，存 Supabase |
| `premarket-telegram.yml` | 00:00 週一至五 | 08:00 | 盤前推播（美股/台指期夜盤/國際/AI 研判） |
| `postmarket-telegram.yml` | 07:30 週一至五 | 15:30 | 盤後推播（台股收盤/三大法人/AI 分析） |
| `keep-render-warm.yml` | 固定間隔 | — | 防止 Render 免費方案冷啟動 |

## Vercel Cron

`vercel.json` 設定在 UTC 06:45（週一至五）觸發：
- `/api/signal-check` — KDJ + 布林訊號計算
- `/api/warm-cache` — 快取預熱
- `/api/update-prices` — 資產現價更新

## 新聞來源（premarket/postmarket）

- 鉅亨網、UDN money、CNBC
- 24 小時內的新聞才納入分析（過濾舊新聞）
