// ============================================================
// strategy/ui.jsx — Strategy 模組內部專用 UI 元件
// Btn 與 Input 因簽名/字級與共用元件差異較大，保留模組私有。
// Card 與 Badge 已改用 src/components/ui/。
// ============================================================

import { C } from "../constants/theme";

export const fmt = (n, d = 0) =>
  Math.abs(n).toLocaleString("zh-TW", { maximumFractionDigits: d });

export function Btn({ children, onClick, color = C.accent, style = {} }) {
  return (
    <button onClick={onClick} style={{
      background: color + "18",
      color,
      border: `1px solid ${color}40`,
      borderRadius: 8,
      padding: "7px 14px",
      fontSize: 12,
      fontWeight: 600,
      cursor: "pointer",
      ...style,
    }}>{children}</button>
  );
}

export function Input({ value, onChange, placeholder, style = {}, type = "text" }) {
  return (
    <input
      type={type} value={value} onChange={onChange} placeholder={placeholder}
      style={{
        background: C.surface2,
        border: `1px solid ${C.border}`,
        color: C.text,
        borderRadius: 8,
        padding: "7px 10px",
        fontSize: 12,
        outline: "none",
        ...style,
      }}
    />
  );
}
