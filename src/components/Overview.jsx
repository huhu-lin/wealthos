// ============================================================
// Overview.jsx — 總覽頁
// 顯示整體資產狀況，包含：
//   1. 淨值主卡（總資產、總負債、未實現損益）
//   2. KPI 格（財務槓桿、實際曝險倍率、USD/TWD 匯率）
//   3. 分類資產卡（台股 / 美股 / 加密 / 其他）
//   4. 趨勢折線圖（需有 snapshots 資料才顯示）
//   5. 配置圓餅圖
// ============================================================

import { useMemo, useState, useEffect } from "react";

// ── RWD Hook（本地定義）─────────────────────────────────────
function useWindowWidth() {
  const [w, setW] = useState(typeof window !== "undefined" ? window.innerWidth : 1280);
  useEffect(() => {
    const h = () => setW(window.innerWidth);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  return w;
}
import {
  AreaChart, Area, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from "recharts";

import { C, TT, fmt, fmtM, pct } from "../constants/theme";
import Card        from "./ui/Card";
import KPI         from "./ui/KPI";
import MarketBrief from "./MarketBrief";

export default function Overview({ twAssets, usAssets, cryptoAssets, otherAssets, liabilities, snapshots, usdRate }) {
  const winWidth = useWindowWidth();
  const isMobile = winWidth <= 480;

  // ── 資產 / 負債計算（useMemo 避免每次 render 重新計算）────────────────────
  const {
    twTotal, usTotal, cryptoTotal, otherTotal,
    totalAssets, totalLiab, netWorth, leverage, debtRatio,
    actualExposure, actualLeverage,
    totalCost, totalPnl, totalPnlPct,
  } = useMemo(() => {
    const tw = twAssets.reduce((s, x) => s + x.value_twd, 0);
    const us = usAssets.reduce((s, x) => s + x.value_twd, 0);
    const crypto = cryptoAssets.reduce((s, x) => s + x.value_twd, 0);
    const other = otherAssets.reduce((s, x) => s + x.value_twd, 0);
    const total = tw + us + crypto + other;
    const liab = liabilities.reduce((s, x) => s + x.value, 0);
    const net = total - liab;
    const lev = net > 0 ? total / net : 0;
    const debt = total > 0 ? liab / total : 0;

    // 實際曝險倍率（含 ETF 內含槓桿）
    const exposure = [...twAssets, ...usAssets].reduce(
      (s, x) => s + (x.value_twd || 0) * (x.leverage_ratio || 1), 0
    ) + crypto + other;
    const actLev = net > 0 ? exposure / net : 0;

    // 未實現損益
    const cost = [...twAssets, ...usAssets, ...cryptoAssets]
      .reduce((s, x) => s + (x.cost_total || 0), 0);
    const pnl = [...twAssets, ...usAssets, ...cryptoAssets].reduce((s, x) => {
      const ct = x.cost_total || (x.cost || 0) * (x.shares || 0);
      return ct > 0 ? s + (x.value_twd - ct) : s;
    }, 0);
    const pnlPct = cost > 0 ? pnl / cost * 100 : 0;

    return {
      twTotal: tw,
      usTotal: us,
      cryptoTotal: crypto,
      otherTotal: other,
      totalAssets: total,
      totalLiab: liab,
      netWorth: net,
      leverage: lev,
      debtRatio: debt,
      actualExposure: exposure,
      actualLeverage: actLev,
      totalCost: cost,
      totalPnl: pnl,
      totalPnlPct: pnlPct,
    };
  }, [twAssets, usAssets, cryptoAssets, otherAssets, liabilities]);

  // ── 週 / 月 / 年 結算計算 ───────────────────────────────────────────
  const periodReturns = useMemo(() => {
    if (!snapshots.length) return [];
    // snapshots 降序（最新在前），找距今最近 N 天的快照
    const findNet = (days) => {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      const target = cutoff.toISOString().slice(0, 10);
      // 找第一筆日期 <= target 的快照（即最接近 N 天前的那天）
      const snap = snapshots.find(s => s.date <= target);
      return snap ? snap.net : null;
    };
    const periods = [
      { label: "週結算", days: 7,   icon: "📅" },
      { label: "月結算", days: 30,  icon: "📆" },
      { label: "年結算", days: 365, icon: "🗓️" },
    ];
    return periods.map(({ label, days, icon }) => {
      const pastNet = findNet(days);
      if (!pastNet) return { label, icon, delta: null, pct: null };
      const delta = netWorth - pastNet;
      const pctChange = (delta / pastNet) * 100;
      return { label, icon, delta, pct: pctChange };
    });
  }, [snapshots, netWorth]);

  // ── 圓餅圖資料（useMemo 保證穩定的物件參考）─────────────────────────
  const pieData = useMemo(() => [
    { name: "台股",   value: twTotal },
    { name: "美股",   value: usTotal },
    { name: "加密貨幣", value: cryptoTotal },
    { name: "其他",   value: otherTotal },
  ].filter(x => x.value > 0), [twTotal, usTotal, cryptoTotal, otherTotal]);

  const pieColors = [C.accent, C.blue, C.gold, C.purple];

  return (
    <div className="wos-fade" style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── 每日市場摘要（盤前分析）── */}
      <MarketBrief />

      {/* ── 淨值主卡 ─────────────────────────────────────── */}
      <div style={{
        background: `linear-gradient(135deg, ${C.surface} 0%, #0d1a2d 100%)`,
        border: `1px solid ${C.borderHover}`,
        borderRadius: 16,
        padding: isMobile ? "16px 16px" : "22px 24px",
        position: "relative",
        overflow: "hidden",
        boxShadow: `0 0 40px ${C.accent}08`,
      }}>
        {/* 頂部彩色橫線 */}
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, height: 3,
          background: `linear-gradient(90deg, ${C.accent}, ${C.blue})`,
          borderRadius: "16px 16px 0 0",
        }} />
        {/* 右上角光暈 */}
        <div style={{
          position: "absolute", top: -20, right: -20, width: 140, height: 140,
          background: `radial-gradient(circle, ${C.accent}08, transparent 70%)`,
          pointerEvents: "none",
        }} />

        <div style={{ color: C.textMuted, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600, marginBottom: 6 }}>
          TOTAL NET WORTH
        </div>
        {/* 淨值大數字（桌機 36px / 手機 26px）*/}
        <div style={{
          color: C.accent, fontSize: isMobile ? 26 : 36, fontWeight: 700,
          fontFamily: "'JetBrains Mono', monospace",
          letterSpacing: "-0.03em", lineHeight: 1.1,
        }}>
          NT${fmt(netWorth)}
        </div>

        {/* 摘要行：總資產、總負債、未實現（手機允許換行）*/}
        <div style={{
          display: "flex", flexWrap: "wrap",
          gap: isMobile ? "8px 12px" : 20,
          marginTop: 10,
        }}>
          <span style={{ color: C.textMuted, fontSize: isMobile ? 11 : 12 }}>
            總資產 <span style={{ color: C.blue, fontWeight: 600, fontFamily: "monospace" }}>NT${fmtM(totalAssets)}</span>
          </span>
          <span style={{ color: C.textMuted, fontSize: isMobile ? 11 : 12 }}>
            總負債 <span style={{ color: C.red, fontWeight: 600, fontFamily: "monospace" }}>NT${fmtM(totalLiab)}</span>
          </span>
          <span style={{ color: C.textMuted, fontSize: isMobile ? 11 : 12 }}>
            未實現 <span style={{ color: totalPnl >= 0 ? C.accent : C.red, fontWeight: 600, fontFamily: "monospace" }}>
              {totalPnl >= 0 ? "+" : "-"}NT${fmtM(Math.abs(totalPnl))} ({totalPnlPct >= 0 ? "+" : ""}{totalPnlPct.toFixed(1)}%)
            </span>
          </span>
        </div>
      </div>

      {/* ── KPI 指標格 ───────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10 }}>
        <KPI label="財務槓桿"   value={leverage.toFixed(2) + "x"}      prefix="" color={C.gold}     sub={`負債比 ${pct(debtRatio)}`} />
        <KPI label="實際曝險倍率" value={actualLeverage.toFixed(2) + "x"} prefix="" color={C.orange}   sub="含ETF內含槓桿" />
        <KPI label="匯率 USD/TWD" value={usdRate.toFixed(2)}             prefix="" color={C.textMuted} />
      </div>

      {/* ── 週 / 月 / 年 結算 ───────────────────────────── */}
      {periodReturns.length > 0 && periodReturns.some(r => r.delta !== null) && (
        <div className="wos-grid-3">
          {periodReturns.map(({ label, icon, delta, pct: pctChange }) => {
            const hasData = delta !== null;
            const isPos = hasData && delta >= 0;
            const color = !hasData ? C.textMuted : isPos ? C.accent : C.red;
            return (
              <div key={label} style={{
                background: C.surface,
                border: `1px solid ${C.border}`,
                borderRadius: 12,
                padding: "12px 14px",
              }}>
                <div style={{ color: C.textMuted, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600, marginBottom: 6 }}>
                  {icon} {label}
                </div>
                {hasData ? (
                  <>
                    <div style={{ color, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 14, lineHeight: 1.2 }}>
                      {isPos ? "+" : ""}NT${fmtM(Math.abs(delta))}
                    </div>
                    <div style={{ color, fontSize: 11, marginTop: 3, fontWeight: 600 }}>
                      {isPos ? "▲" : "▼"} {Math.abs(pctChange).toFixed(2)}%
                    </div>
                  </>
                ) : (
                  <div style={{ color: C.textDim, fontSize: 12, marginTop: 4 }}>資料不足</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── 分類資產卡 ───────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {[
          { label: "🇹🇼  台股",   value: twTotal,     color: C.accent },
          { label: "🇺🇸  美股",   value: usTotal,     color: C.blue },
          { label: "₿  加密貨幣", value: cryptoTotal, color: C.gold },
          { label: "🏠  其他",   value: otherTotal,  color: C.purple },
        ].map(x => (
          <div key={x.label} className="wos-row" style={{
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderLeft: `3px solid ${x.color}`,
            borderRadius: 12,
            padding: "12px 16px",
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <div style={{ color: C.textMuted, fontSize: 12, fontWeight: 500 }}>{x.label}</div>
            <div style={{ textAlign: "right" }}>
              <div style={{ color: x.color, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 14 }}>
                NT${fmt(x.value)}
              </div>
              <div style={{ color: C.textDim, fontSize: 10, marginTop: 2 }}>
                {totalAssets > 0 ? pct(x.value / totalAssets) : "–"}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── 趨勢圖（需累積 snapshots 才顯示）────────────── */}
      {snapshots.length > 0 ? (
        <Card style={{ padding: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 16, color: C.text }}>
            資產 · 負債 · 淨值趨勢
          </div>
          <ResponsiveContainer width="100%" height={isMobile ? 150 : 220}>
            <AreaChart data={snapshots}>
              <defs>
                {[["net", C.accent], ["assets", C.blue], ["liabilities", C.red]].map(([k, c]) => (
                  <linearGradient key={k} id={`g${k}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={c} stopOpacity={0.25} />
                    <stop offset="95%" stopColor={c} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey="date" tick={{ fill: C.textMuted, fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis yAxisId="left"  tick={{ fill: C.textMuted, fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => `${(v / 1_000_000).toFixed(1)}M`} />
              <YAxis yAxisId="right" orientation="right" tick={{ fill: C.orange, fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => `${v.toFixed(1)}x`} />
              <Tooltip {...TT} formatter={(v, n) =>
                n === "leverage"
                  ? [`${v.toFixed(2)}x`, "財務槓桿"]
                  : [`NT$${fmtM(v)}`, n === "net" ? "淨值" : n === "assets" ? "總資產" : "總負債"]
              } />
              <Area yAxisId="left"  type="monotone" dataKey="liabilities" stroke={C.red}    strokeWidth={1.5} fill="url(#gliabilities)" dot={false} />
              <Area yAxisId="left"  type="monotone" dataKey="assets"      stroke={C.blue}   strokeWidth={1.5} fill="url(#gassets)"      dot={false} />
              <Area yAxisId="left"  type="monotone" dataKey="net"         stroke={C.accent} strokeWidth={2.5} fill="url(#gnet)"         dot={{ fill: C.accent, r: 3 }} />
              <Line yAxisId="right" type="monotone" dataKey="leverage"    stroke={C.orange} strokeWidth={2}   dot={false} strokeDasharray="4 2" />
            </AreaChart>
          </ResponsiveContainer>

          {/* 圖例（手機允許換行）*/}
          <div style={{ display: "flex", flexWrap: "wrap", gap: isMobile ? "6px 10px" : 16, justifyContent: "flex-end", marginTop: 8 }}>
            {[["淨值", C.accent], ["總資產", C.blue], ["總負債", C.red], ["財務槓桿", C.orange]].map(([l, c]) => (
              <div key={l} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <div style={{ width: 14, height: 2, background: c, borderRadius: 1 }} />
                <span style={{ color: C.textMuted, fontSize: 10 }}>{l}</span>
              </div>
            ))}
          </div>
        </Card>
      ) : (
        <Card style={{ padding: 24, textAlign: "center" }}>
          <div style={{ color: C.textMuted, fontSize: 13 }}>快照每日自動產生，資料累積後這裡會顯示趨勢圖</div>
        </Card>
      )}

      {/* ── 資產配置圓餅圖 ───────────────────────────────── */}
      {pieData.length > 0 && (
        <Card style={{ padding: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12, color: C.text }}>資產配置</div>
          <ResponsiveContainer width="100%" height={isMobile ? 150 : 180}>
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%"
                innerRadius={isMobile ? 36 : 50}
                outerRadius={isMobile ? 58 : 78}
                paddingAngle={5} dataKey="value">
                {pieData.map((_, i) => <Cell key={i} fill={pieColors[i]} />)}
              </Pie>
              <Tooltip {...TT} formatter={v => `NT$${fmtM(v)}`} />
              <Legend formatter={v => <span style={{ color: C.textMuted, fontSize: 11 }}>{v}</span>} />
            </PieChart>
          </ResponsiveContainer>
        </Card>
      )}
    </div>
  );
}
