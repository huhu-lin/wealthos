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
  border: "#2A3F5C",      // 預設邊框
  borderHover: "#3D5A82", // hover 邊框
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
  text: "#F1F5FB",        // 主要文字
  textMuted: "#A7BBD6",   // 次要文字（提升對比度）
  textDim: "#7A92B4",     // 更淡的說明文字（提升對比度）
};

// ── 字級系統（Typography Scale）──────────────────────────────
// 集中管理字體大小／字重／行高，避免各元件 inline 寫死
// 用法：<div style={{ ...T.h2, color: C.text }}>標題</div>
export const T = {
  h1:      { fontSize: 28, fontWeight: 700, lineHeight: 1.2,  letterSpacing: "-0.01em" },
  h2:      { fontSize: 20, fontWeight: 700, lineHeight: 1.3 },
  h3:      { fontSize: 16, fontWeight: 600, lineHeight: 1.4 },
  body:    { fontSize: 14, fontWeight: 400, lineHeight: 1.5 },
  caption: { fontSize: 12, fontWeight: 500, lineHeight: 1.4 },
  label:   { fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" },
  mono:    { fontFamily: "'JetBrains Mono', 'Courier New', monospace", letterSpacing: "-0.02em" },
};

// ── 間距系統（8px Grid）──────────────────────────────────────
// 統一 padding／margin／gap 數值，所有間距盡量套用此系統
export const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, "2xl": 32, "3xl": 48 };

// ── 陰影系統（Elevation）─────────────────────────────────────
// sm：細微浮起（卡片）／ md：明顯層次（彈窗、hover 卡片）
// glow(color)：彩色發光陰影，用於主按鈕等需要強調的元素
export const SH = {
  sm: "0 1px 3px rgba(0,0,0,0.4), 0 4px 12px rgba(0,0,0,0.25)",
  md: "0 8px 24px rgba(0,0,0,0.5), 0 2px 6px rgba(0,0,0,0.3)",
  glow: (color) => `0 2px 10px ${color}45, 0 1px 3px rgba(0,0,0,0.3)`,
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
    border: "1px solid #2A3F5C",
    borderRadius: 10,
    color: "#F1F5FB",
    fontSize: 13,
    boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
  },
  cursor: { stroke: "#3D5A82", strokeWidth: 1 },
};

// ── 數值格式化工具 ────────────────────────────────────────────
// fmt：整數千分位（台幣常用）
// fmtM：百萬/千 縮寫（圖表 Y 軸、大數字摘要用）
// pct：百分比顯示
export const fmt  = (n, d = 0) => Math.abs(n).toLocaleString("zh-TW", { maximumFractionDigits: d });
export const fmtM = (n) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : `${(n / 1_000).toFixed(0)}K`;
export const pct  = (n, d = 1) => `${(n * 100).toFixed(d)}%`;
