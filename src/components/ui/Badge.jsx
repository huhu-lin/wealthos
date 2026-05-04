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

// ── 偏移指針 ─────────────────────────────────────────────────
// 視覺化顯示「實際佔比偏離目標」的幅度
// actual：實際百分比（0-100）
// target：目標百分比（0-100）
// total：帳戶總值（用來計算買賣金額）
// value：該項目市值
// driftThreshold：再平衡觸發門檻（預設 ±5%）
export function AllocBar({ actual, target, total, value, driftThreshold = 5 }) {
  if (!total || !target) return null;

  const diff    = actual - target;          // 偏移量（正=超配，負=不足）
  const diffAmt = value - (target / 100 * total);

  // 顏色：±1.5% 平衡綠，超過門檻紅/金，中間警示橙
  const absD = Math.abs(diff);
  const driftColor =
    absD < 1.5              ? C.accent :
    absD >= driftThreshold  ? (diff > 0 ? C.red : C.gold) :
                              C.orange;

  // 指針位置：以目標為中心，±driftThreshold 為量程兩端
  // 超出量程時 clamp 到邊界
  const range = Math.max(driftThreshold, absD + 1);  // 自動擴張量程
  const needlePct = Math.min(Math.max((diff / range) * 50 + 50, 2), 98); // 0-100% 位置

  // 狀態文字
  const statusLabel = absD < 1.5 ? "平衡" : diff > 0 ? "超配" : "不足";

  return (
    <div style={{ marginTop: 10 }}>
      {/* ── 數值摘要列 ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, fontSize: 10 }}>
        <div style={{ display: "flex", gap: 10 }}>
          <span style={{ color: C.textMuted }}>
            實際 <span style={{ color: C.text, fontWeight: 700 }}>{actual.toFixed(1)}%</span>
          </span>
          <span style={{ color: C.textMuted }}>
            目標 <span style={{ color: C.textMuted, fontWeight: 600 }}>{target.toFixed(1)}%</span>
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{
            background: driftColor + "20",
            color: driftColor,
            border: `1px solid ${driftColor}50`,
            borderRadius: 4,
            padding: "1px 6px",
            fontSize: 10,
            fontWeight: 700,
          }}>
            {statusLabel}
          </span>
          <span style={{ color: driftColor, fontWeight: 600 }}>
            {diff >= 0 ? "+" : ""}{diff.toFixed(1)}%
            <span style={{ color: C.textMuted, fontWeight: 400 }}>
              {" "}（{diff > 0 ? "可賣出" : "可買入"} NT${fmt(Math.abs(diffAmt))}）
            </span>
          </span>
        </div>
      </div>

      {/* ── 偏移指針軌道 ── */}
      <div style={{ position: "relative", height: 20, marginBottom: 2 }}>
        {/* 背景漸層軌道：左=不足(金)，中=平衡(綠)，右=超配(紅) */}
        <div style={{
          position: "absolute", top: 8, left: 0, right: 0, height: 4,
          background: `linear-gradient(90deg, ${C.gold}60 0%, ${C.accent}80 45%, ${C.accent}80 55%, ${C.red}60 100%)`,
          borderRadius: 3,
        }} />
        {/* 中心目標刻度線 */}
        <div style={{
          position: "absolute", top: 4, left: "50%", width: 2, height: 12,
          background: C.textMuted + "80",
          transform: "translateX(-50%)",
          borderRadius: 1,
        }} />
        {/* 偏移指針菱形 */}
        <div style={{
          position: "absolute",
          top: 4,
          left: `${needlePct}%`,
          transform: "translateX(-50%)",
          width: 12,
          height: 12,
          background: driftColor,
          borderRadius: "2px",
          rotate: "45deg",
          boxShadow: `0 0 6px ${driftColor}80`,
          transition: "left 0.4s ease",
        }} />
      </div>

      {/* ── 刻度標籤 ── */}
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: C.textDim, paddingTop: 2 }}>
        <span style={{ color: C.gold }}>不足 -{range.toFixed(0)}%</span>
        <span style={{ color: C.accent }}>目標 {target.toFixed(0)}%</span>
        <span style={{ color: C.red }}>超配 +{range.toFixed(0)}%</span>
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
