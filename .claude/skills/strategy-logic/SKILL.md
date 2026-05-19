# KDJ + 布林通道策略指標邏輯

## 共用邏輯

`signal-check.js`（Edge Function）與 `Strategy.jsx`（前端）**共用完全相同的計算邏輯**，修改時兩處都要同步更新。

## 指標計算

### 布林通道
- 週期：20 期
- 上軌：MA20 + 2σ
- 下軌：MA20 − 2σ

### KDJ
- 週期：9 期
- **必須使用真實 High/Low**（不能用 closes 的 max/min）
- 此設定與 TradingView 標準一致，偏差會導致訊號不符

## 訊號模式

| 模式 | `strategy_mode` 值 | 說明 |
|------|--------------------|------|
| 雙確認 | `signal` | 買入與賣出都需要 KDJ + 布林雙重確認 |
| 非對稱 | `asymmetric` | P002 模式：買入用 KDJ 條件，賣出用偏移閾值（非對稱邏輯） |

## 跨 K 棒記憶旗標

訊號判斷使用跨 K 棒記憶旗標，不是只看當前 K 棒：

- `jBelowFlag`：記錄 J 值曾跌破進場閾值
- `jAboveFlag`：記錄 J 值曾升破出場閾值

計算方式：**掃描完整歷史 K 線後**，才輸出最新一棒的最終訊號。不可截取部分歷史計算，否則旗標狀態會不正確。

## `strategy_tickers` 欄位對應

| 欄位 | 用途 |
|------|------|
| `ticker` | 股票代號 |
| `is_us` | 是否為美股（影響 K 線 API 呼叫） |
| `target` | 目標持倉比例 |
| `j_entry` | J 值進場閾值 |
| `j_exit` | J 值出場閾值 |
| `strategy_mode` | `"signal"` 或 `"asymmetric"` |
