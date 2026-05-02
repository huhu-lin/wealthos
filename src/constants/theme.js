// ============================================================
// theme.js — 全域設計常數
// 這裡集中管理所有顏色、槓桿對照表、圖表樣式、格式化工具
// 任何視覺相關的常數改這裡就好，不需要翻每個元件
// ============================================================

// ── 色彩系統 ─────────────────────────────────────────────────
// 整個 App 統一使用這組顏色，深色系為主
export const C = {
  bg: "#05080F",          // 最底層背景
  surface: "#0B1120",     // 卡片背景
  surface2: "#101928",    // 卡片漸層結尾
  surface3: "#162030",    // 內嵌區塊背景
  border: "#1C2E45",      // 預設邊框
  borderHover: "#2A4A70", // hover 邊框
  accent: "#00C896",      // 主色（綠）— 正值、主要按鈕
  accentDim: "#00C89615", // 主色低透明度背景
  accentGlow: "#00C89630",// 主色發光效果
  red: "#FF4757",         // 負值、負債、警示
  redDim: "#FF475715",
  gold: "#FFB020",        // 警告、月還款、槓桿
  goldDim: "#FFB02015",
  blue: "#4D9EFF",        // 美股、資產總值
  blueDim: "#4D9EFF15",
  purple: "#9B6DFF",      // 其他資產、現金
  orange: "#FF6B35",      // 曝險倍率、強調
  text: "#E2EAF4",        // 主要文字
  textMuted: "#5A7399",   // 次要文字
  textDim: "#3A5478",     // 更淡的說明文字
};

// ── 槓桿倍數對照表 ────────────────────────────────────────────
// 輸入股票代號會自動帶入槓桿倍率，用於計算實際曝險
export const LEVERAGE_MAP = {
  // 台灣槓桿 ETF（2x）
  "00675L": 2, "00631L": 2, "00633L": 2, "00685L": 2,
  // 美國槓桿 ETF（2x / 3x）
  "QLD": 2, "TQQQ": 3, "SOXL": 3, "UPRO": 3,
  "SPXL": 3, "TECL": 3, "SSO": 2, "UDOW": 3,
};

// ── 圖表 Tooltip 統一樣式 ─────────────────────────────────────
// recharts 的 Tooltip 共用設定，維持深色系風格
export const TT = {
  contentStyle: {
    background: "#101928",
    border: "1px solid #1C2E45",
    borderRadius: 10,
    color: "#E2EAF4",
    fontSize: 12,
    boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
  },
  cursor: { stroke: "#2A4A70", strokeWidth: 1 },
};

// ── 數值格式化工具 ────────────────────────────────────────────
// fmt：整數千分位（台幣常用）
// fmtM：百萬/千 縮寫（圖表 Y 軸、大數字摘要用）
// pct：百分比顯示
export const fmt  = (n, d = 0) => Math.abs(n).toLocaleString("zh-TW", { maximumFractionDigits: d });
export const fmtM = (n) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : `${(n / 1_000).toFixed(0)}K`;
export const pct  = (n, d = 1) => `${(n * 100).toFixed(d)}%`;
