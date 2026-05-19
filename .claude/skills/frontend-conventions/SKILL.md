# 前端架構慣例

## 設計常數（`src/constants/theme.js`）

所有顏色與格式化函式集中在此，**禁止在元件裡 hardcode 色碼**：

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

`LEVERAGE_MAP` 也在此，存放槓桿 ETF 的倍率對照表（如 `TQQQ: 3`、`00675L: 2`）。

## Tab 路由

`App.jsx` 用 `useState(tab)` 實作切換，**無 React Router**，依 `tab` 值條件渲染對應元件：

| tab 值 | 元件 |
|--------|------|
| `overview` | `Overview.jsx` |
| `tw` | `TWAccount.jsx` |
| `us` | `USAccount.jsx` |
| `crypto` | `CryptoAccount.jsx` |
| `other` | `OtherAccount.jsx` |
| `liab` | `Liabilities.jsx` |
| `pledge` | `Pledge.jsx` |
| `strategy` | `Strategy.jsx`（位於 `src/`，非 `components/` 下） |

## 共用 UI 元件（`src/components/ui/`）

跨頁面共用的原子元件：`Card`、`Badge`、`Modal`、`KPI`、`FormControls`、`TabBtn`、`GlobalStyles`

**例外**：`Strategy.jsx` 直接在檔案內定義自己的 `Card`、`Badge`、`Btn`、`Input`，未使用 `src/components/ui/`，勿強行整合。

## 價格 API（`src/utils/priceApi.js`）

前端所有外部 API 呼叫都走此模組（已內建 timeout 與重試）：

| 函式 | 說明 |
|------|------|
| `fetchTWPrice(stockId)` | 台股，透過 `/api/finmind-price` proxy |
| `fetchUSPrice(ticker)` | 美股，透過 `/api/finmind-price` proxy |
| `fetchCryptoPrice(coinId)` | 加密貨幣，直連 CoinGecko（coinId 如 `"bitcoin"`） |
| `fetchUSDTWD()` | 透過 `/api/usdtwd` proxy，抓 Yahoo Finance |
