// ============================================================
// strategy/ui.jsx — Strategy 模組內部專用 UI 元件
// 視覺刻意與全域 src/components/ui/ 不同（更小邊距/字級），
// 因此保留為模組私有，不混入共用元件庫。
// ============================================================

import { C, SH } from "../constants/theme";

export const fmt = (n, d = 0) =>
  Math.abs(n).toLocaleString("zh-TW", { maximumFractionDigits: d });

export function Card({ children, style = {} }) {
  return (
    <div style={{
      background: `linear-gradient(150deg, ${C.surface} 0%, ${C.surface2} 100%)`,
      border: `1px solid ${C.border}`,
      borderRadius: 14,
      boxShadow: SH.sm,
      ...style,
    }}>{children}</div>
  );
}

export function Badge({ text, color = C.accent }) {
  return (
    <span style={{
      background: color + "20",
      color,
      border: `1px solid ${color}40`,
      borderRadius: 5,
      padding: "2px 8px",
      fontSize: 11,
      fontWeight: 600,
    }}>{text}</span>
  );
}

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
