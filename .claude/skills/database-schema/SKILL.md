# Supabase 資料表結構與 RLS

## 資料表一覽

| 資料表 | 說明 | 關鍵欄位 |
|--------|------|----------|
| `assets` | 各類資產 | `shares`、`ticker`、`value_twd`、`account`、type（tw/us/crypto/other） |
| `liabilities` | 負債 | `value`（台幣） |
| `pledges` | 質押資產 | `shares`、`ticker`、`market_value` |
| `monthly_snapshots` | 每日淨值快照 | `date`、`assets`、`liabilities`、`net`、`leverage` |
| `strategy_tickers` | 監控中的策略股票 | `ticker`、`is_us`、`target`（目標比例）、`j_entry`、`j_exit`、`strategy_mode` |
| `kline_cache` | K 線快取 | `ticker`、`days`、`cached_date`、`data`（JSON） |
| `morning_brief` | AI 晨間摘要 | `brief_date`、`content` |

## RLS 策略

- 所有資料表均啟用 Row Level Security
- 資料以 `user_id` 欄位隔離，各用戶只能存取自己的資料
- `kline_cache` 與 `morning_brief` 為共用快取，寫入需要 `SUPABASE_SERVICE_KEY`（anon key 無寫入權限）

## user_id 自動認領邏輯

`App.jsx` 啟動時自動執行：首次登入時，將 `user_id IS NULL` 的舊資料歸屬給目前登入用戶。這確保在導入 Auth 前建立的資料不會遺失。

## 資料流概覽

```
App.jsx 啟動
  └─ 從 Supabase 撈取：assets、liabilities、pledges、monthly_snapshots
  └─ 取得即時 USD/TWD 匯率（/api/usdtwd）
  └─ 執行 user_id 自動認領（如有舊資料）

/api/update-prices（每日 GitHub Actions 觸發）
  └─ Yahoo Finance 取得現價
  └─ 更新 assets.value_twd
  └─ 寫入 monthly_snapshots 快照

kline-api/main.py
  └─ yfinance 取得 K 線
  └─ 寫入 kline_cache（需 SERVICE_KEY）

scripts/morning_brief.py
  └─ Gemini API 生成摘要
  └─ 寫入 morning_brief（需 SERVICE_KEY）
```
