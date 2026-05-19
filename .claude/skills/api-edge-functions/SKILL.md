# Vercel Edge Functions 規範

## 必要設定

每個 `/api/*.js` 都必須宣告 runtime，否則部署會失敗：

```js
export const config = { runtime: 'edge' };
```

## API 路由一覽

| 路由 | 說明 |
|------|------|
| `/api/update-prices` | 更新資產現價（Yahoo Finance），支援 JWT forward |
| `/api/finmind-price` | 台股／美股報價 proxy（供前端 `priceApi.js` 呼叫） |
| `/api/signal-check` | 計算 KDJ + 布林指標，觸發時推播 Telegram |
| `/api/warm-cache` | 預熱 K 線快取 |
| `/api/usdtwd` | USD/TWD 匯率 proxy（Yahoo Finance） |

## RLS 與 JWT Forward

`/api/update-prices` 支援用戶 JWT forward：

```
Authorization: Bearer <token>
```

透過此機制讓 Edge Function 以用戶身份操作 Supabase，確保 RLS 正確運作，**不需要 `SUPABASE_SERVICE_KEY`**。

## kline-api 微服務（`kline-api/main.py`）

獨立的 Python FastAPI 微服務，部署於 Render 或 Railway。Edge Function 透過 `KLINE_API_URL` 環境變數呼叫：

| 端點 | 說明 |
|------|------|
| `GET /kline/tw?ticker=006208&days=720` | 台股還原 K 線（自動加 `.TW` 後綴） |
| `GET /kline/us?ticker=QLD&days=720` | 美股還原 K 線 |
| `GET /health` | 健康檢查 |

快取機制：先查 `kline_cache`（Supabase），沒有或過期才打 yfinance。快取 key 使用台灣時區日期（台股用 `_TW` 後綴判斷過期）。寫入快取需要 `SUPABASE_SERVICE_KEY`（anon key 因 RLS 無寫入權限）。
