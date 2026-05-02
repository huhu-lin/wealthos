// ============================================================
// Badge.jsx — 標籤徽章 + 配置進度條 + 區塊標題
// 三個小型通用元件：
//   Badge       — 代號/類別標籤（如股票代號、槓桿倍數）
//   AllocBar    — 目標配置進度條（顯示實際 vs 目標比例）
//   SectionHeader — 區塊標題列（左標題 + 右側操作區）
// ============================================================

import { C, fmt } from "../../constants/theme";

// ── 標籤徽章 ─────────────────────────────────────────────────
// 半透明色塊 + 細邊框，用於顯示股票代號、槓桿倍數、類別等
// 用法：<Badge text="006208" color={C.blue} />
export function Badge({ text, color = C.accent }) {
  return (
    <span style={{
      background: color + "18",
      color,
      border: `1px solid ${color}35`,
      borderRadius: 6,
      padding: "2px 8px",
      fontSize: 11,
      fontWeight: 600,
      letterSpacing: "0.02em",
      fontFamily: "'Inter', sans-serif",
    }}>
      {text}
    </span>
  );
}

// ── 配置進度條 ────────────────────────────────────────────────
// 顯示資產佔比 vs 目標佔比的差距，並計算需買/賣金額
// actual：實際百分比（0-100）
// target：目標百分比（0-100）
// total：帳戶總值（用來計算買賣金額）
// value：該項目市值
export function AllocBar({ actual, target, total, value }) {
  if (!total || !target) return null;

  const diff    = actual - target;                        // 超過目標為正，不足為負
  const diffAmt = value - (target / 100 * total);        // 超出/不足的金額
  const barWidth = Math.min((actual / target) * 100, 130); // 進度條寬度上限 130%
  // 顏色判斷：±1.5% 內綠，超標紅，不足金
  const barColor = Math.abs(diff) < 1.5 ? C.accent : diff > 0 ? C.red : C.gold;

  return (
    <div style={{ marginTop: 10 }}>
      {/* 數值文字列 */}
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5, fontSize: 10 }}>
        <span style={{ color: C.textMuted }}>
          實際 <span style={{ color: C.text, fontWeight: 600 }}>{actual.toFixed(1)}%</span>
          {"  "}目標 <span style={{ color: C.textMuted }}>{target.toFixed(1)}%</span>
        </span>
        <span style={{ color: barColor, fontWeight: 600 }}>
          {diff > 0 ? "▲" : "▼"} {Math.abs(diff).toFixed(1)}%
          （{diff > 0 ? "賣出" : "買入"} NT${fmt(Math.abs(diffAmt))}）
        </span>
      </div>

      {/* 進度條本體 */}
      <div style={{ height: 4, background: C.border, borderRadius: 3, overflow: "hidden" }}>
        <div
          className="wos-bar-fill"
          style={{
            height: "100%",
            width: `${Math.min(barWidth, 100)}%`,
            background: `linear-gradient(90deg, ${barColor}, ${barColor}AA)`,
            borderRadius: 3,
          }}
        />
      </div>
    </div>
  );
}

// ── 區塊標題列 ───────────────────────────────────────────────
// 帶下邊框的標題 + 右側操作按鈕區
// 用法：<SectionHeader title="ETF / 股票" right={<Btn>＋ 新增</Btn>} />
export function SectionHeader({ title, right }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      paddingBottom: 10,
      borderBottom: `1px solid ${C.border}`,
      marginBottom: 2,
    }}>
      <div style={{ fontWeight: 700, fontSize: 13, color: C.text, letterSpacing: "0.01em" }}>
        {title}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {right}
      </div>
    </div>
  );
}
