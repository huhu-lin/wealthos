// ============================================================
// FormControls.jsx — 表單輸入元件群
// 包含三個基本表單控制元件，統一深色樣式：
//   Inp  — 文字/數字輸入框
//   Sel  — 下拉選單
//   Btn  — 操作按鈕（支援 outline / small / disabled / 危險色）
// ============================================================

import { C, SH } from "../../constants/theme";

// ── 文字 / 數字輸入框 ─────────────────────────────────────────
// label：欄位標題（選填）
// value / onChange：受控元件
// type：預設 "text"，可傳 "number"
// 行動裝置上 type="number" 會自動啟用 inputMode="decimal" 以優化鍵盤體驗
export function Inp({ label, value, onChange, placeholder, type = "text" }) {
  return (
    <div>
      {label && (
        <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 5, fontWeight: 500 }}>
          {label}
        </div>
      )}
      <input
        type={type}
        inputMode={type === "number" ? "decimal" : undefined}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder || ""}
        className="wos-input"
        style={{
          background: C.bg,
          border: `1px solid ${C.border}`,
          color: C.text,
          borderRadius: 8,
          padding: "8px 12px",
          fontSize: 13,
          outline: "none",
          width: "100%",
          boxSizing: "border-box",
          fontFamily: "'Inter', sans-serif",
          transition: "border-color 0.15s ease",
        }}
      />
    </div>
  );
}

// ── 下拉選單 ─────────────────────────────────────────────────
// options：字串陣列，e.g. ["etf", "cash"]
// labelMap：可選，{ value: "顯示文字" } 對照表
export function Sel({ label, value, onChange, options, labelMap }) {
  return (
    <div>
      {label && (
        <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 5, fontWeight: 500 }}>
          {label}
        </div>
      )}
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="wos-select"
        style={{
          background: C.bg,
          border: `1px solid ${C.border}`,
          color: C.text,
          borderRadius: 8,
          padding: "8px 12px",
          fontSize: 13,
          width: "100%",
          boxSizing: "border-box",
          cursor: "pointer",
          fontFamily: "'Inter', sans-serif",
          transition: "border-color 0.15s ease",
        }}
      >
        {options.map(o => <option key={o} value={o}>{labelMap ? (labelMap[o] ?? o) : o}</option>)}
      </select>
    </div>
  );
}

// ── 操作按鈕 ─────────────────────────────────────────────────
// color：按鈕主色，預設綠（C.accent），危險操作用 C.red
// outline：透明背景只留邊框（用於次要動作）
// small：較小尺寸（用於列表行內操作）
// disabled：禁用狀態（灰色不可點）
export function Btn({ children, onClick, color = C.accent, outline = false, small = false, disabled = false }) {
  const isRed = color === C.red;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="wos-btn"
      style={{
        background: disabled
          ? "#151e2e"
          : outline
            ? "transparent"
            : isRed
              ? `linear-gradient(135deg, ${color}DD, ${color}AA)` // 紅色按鈕較實心
              : `${color}20`,                                       // 其他按鈕半透明
        border: `1px solid ${disabled ? "#1a2a3a" : outline ? C.border : color + "55"}`,
        color: disabled ? C.textDim : outline ? C.textMuted : isRed ? "#fff" : color,
        borderRadius: 8,
        padding: small ? "5px 10px" : "8px 14px",
        cursor: disabled ? "not-allowed" : "pointer",
        fontSize: small ? 11 : 12,
        fontWeight: 600,
        whiteSpace: "nowrap",
        letterSpacing: "0.01em",
        fontFamily: "'Inter', sans-serif",
        boxShadow: disabled || outline ? "none" : isRed ? SH.glow(color) : `0 1px 2px rgba(0,0,0,0.3)`,
      }}
    >
      {children}
    </button>
  );
}
