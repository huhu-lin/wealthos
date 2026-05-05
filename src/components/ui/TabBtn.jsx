// ============================================================
// TabBtn.jsx — 導覽頁籤按鈕
// 用於 App 頂部的分頁切換，active 狀態有綠色光暈效果
// 用法：<TabBtn label="台股" icon="🇹🇼" active={tab==="tw"} onClick={...} />
// ============================================================

import { C } from "../../constants/theme";

export default function TabBtn({ label, icon, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className="wos-tab wos-tab-btn"
      style={{
        // active 時：綠藍漸層背景；inactive 時：透明
        background: active
          ? `linear-gradient(135deg, ${C.accent}20 0%, ${C.blue}10 100%)`
          : "transparent",
        border: `1px solid ${active ? C.accent + "55" : C.border}`,
        color: active ? C.accent : C.textMuted,
        borderRadius: 10,
        padding: "8px 14px",
        cursor: "pointer",
        fontSize: 12.5,
        fontWeight: active ? 600 : 400,
        display: "flex",
        alignItems: "center",
        gap: 6,
        whiteSpace: "nowrap",
        // active 時加上底部光暈
        boxShadow: active ? `0 0 18px ${C.accent}1A, inset 0 1px 0 ${C.accent}15` : "none",
        letterSpacing: "0.01em",
        fontFamily: "'Inter', sans-serif",
      }}
    >
      {icon} {label}
    </button>
  );
}
