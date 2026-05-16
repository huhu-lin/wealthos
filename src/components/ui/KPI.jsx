// ============================================================
// KPI.jsx — 關鍵指標卡片
// 顯示單一數字指標，上方有色彩標線 + 角落光暈效果
// 用法：<KPI label="總資產" value={1234567} color={C.accent} />
//       <KPI label="匯率" value="31.50" prefix="" color={C.gold} sub="USD/TWD" />
// ============================================================

import { C, T, S, SH, fmt } from "../../constants/theme";

export default function KPI({ label, value, sub, color = C.accent, prefix = "NT$" }) {
  return (
    <div
      className="wos-kpi"
      style={{
        background: `linear-gradient(150deg, ${C.surface} 0%, ${C.surface2} 100%)`,
        border: `1px solid ${C.border}`,
        borderTop: `2px solid ${color}`,
        borderRadius: 14,
        padding: `${S.lg}px ${S.lg + 2}px`,
        position: "relative",
        overflow: "hidden",
        boxShadow: SH.sm,
      }}
    >
      {/* 右上角光暈裝飾 */}
      <div style={{
        position: "absolute", top: 0, right: 0, width: 72, height: 72,
        background: `radial-gradient(circle at top right, ${color}18, transparent 70%)`,
        pointerEvents: "none",
      }} />

      {/* 指標標題（全大寫小字） */}
      <div style={{ ...T.label, fontSize: 10, color: C.textMuted, marginBottom: S.sm }}>
        {label}
      </div>

      {/* 主要數值（等寬字型） */}
      <div style={{ ...T.h2, ...T.mono, color, lineHeight: 1.2 }}>
        {prefix}{typeof value === "number" ? fmt(value) : value}
      </div>

      {/* 副標題說明（選填） */}
      {sub && (
        <div style={{ ...T.caption, color: C.textMuted, marginTop: S.xs + 2 }}>
          {sub}
        </div>
      )}
    </div>
  );
}
