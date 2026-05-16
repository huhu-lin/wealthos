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

import { C, TT, SH, fmt, fmtM, pct } from "../constants/theme";
import Card        from "./ui/Card";
import KPI         from "./ui/KPI";
import MarketBrief from "./MarketBrief";

export default function Overview({ twAssets, usAssets, cryptoAssets, otherAssets, liabilities, snapshots, usdRate, onTabChange }) {
  const winWidth = useWindowWidth();
  const isMobile = winWidth <= 480;

  // ── 週/月/年歷史 Modal ──────────────────────────────────────
  const [selectedPeriod, setSelectedPeriod] = useState(null); // null | 'week' | 'month' | 'year'

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
    // snapshots 升序（最舊在前），用 filter().at(-1) 取「目標日期前最近一筆」
    const findNetByTarget = (target) =>
      snapshots.filter(s => s.date <= target).at(-1)?.net ?? null;
    const findNet = (days) => {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      return findNetByTarget(cutoff.toISOString().slice(0, 10));
    };
    // 週結算：以本週一前一天（上週末）最近快照為基準
    const findWeekStartNet = () => {
      const d = new Date();
      const dow = d.getDay() === 0 ? 7 : d.getDay(); // 週一=1…週日=7
      const monday = new Date(d);
      monday.setDate(d.getDate() - dow + 1);
      const prevDay = new Date(monday);
      prevDay.setDate(monday.getDate() - 1); // 上週日
      return findNetByTarget(prevDay.toISOString().slice(0, 10));
    };
    const periods = [
      { label: "週結算", icon: "📅", type: "week",  pastNet: findWeekStartNet() },
      { label: "月結算", icon: "📆", type: "month", pastNet: findNet(30) },
      { label: "年結算", icon: "🗓️", type: "year",  pastNet: findNet(365) },
    ];
    return periods.map(({ label, icon, type, pastNet }) => {
      if (!pastNet) return { label, icon, type, delta: null, pct: null };
      const delta = netWorth - pastNet;
      const pctChange = (delta / pastNet) * 100;
      return { label, icon, type, delta, pct: pctChange };
    });
  }, [snapshots, netWorth]);

  // ── 週/月/年歷史結算資料 ────────────────────────────────────
  const periodHistory = useMemo(() => {
    if (!snapshots.length) return { week: [], month: [], year: [] };
    // 升序排列
    const sorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));

    const weekMap = {}, monthMap = {}, yearMap = {};
    sorted.forEach(s => {
      // 週 key：找該日所在週的週一日期
      const d = new Date(s.date + "T12:00:00");
      const dow = d.getDay() === 0 ? 7 : d.getDay(); // 週一=1 … 週日=7
      const mon = new Date(d);
      mon.setDate(d.getDate() - dow + 1);
      const weekKey = mon.toISOString().slice(0, 10);
      const monthKey = s.date.slice(0, 7);
      const yearKey  = s.date.slice(0, 4);

      const update = (map, key) => {
        if (!map[key]) map[key] = { first: s, last: s, key };
        else map[key].last = s;
      };
      update(weekMap,  weekKey);
      update(monthMap, monthKey);
      update(yearMap,  yearKey);
    });

    // 每個週期的起點 = 前一個週期最後一筆 snapshot，確保所有區間首尾相連
    const toResult = (map, labelFn, periodStartFn) => {
      const entries = Object.values(map).sort((a, b) => a.key.localeCompare(b.key)); // 升序
      return entries
        .map(({ first, last, key }) => {
          // 找「此週期開始日之前」最近一筆 snapshot 作為基準起點
          const periodStart = periodStartFn(key);
          const prevSnap = sorted.filter(s => s.date < periodStart).at(-1);
          const startSnap = prevSnap ?? first; // 若找不到前一筆（最早那期），退回自身第一筆
          const delta = last.net - startSnap.net;
          const pctChange = startSnap.net > 0 ? (delta / startSnap.net) * 100 : 0;
          return {
            key,
            label:     labelFn(key, first.date, last.date),
            delta,
            pct:       pctChange,
            startNet:  startSnap.net,
            endNet:    last.net,
            startDate: startSnap.date,
            endDate:   last.date,
          };
        })
        .sort((a, b) => b.key.localeCompare(a.key)); // 最新在前
    };

    // 週期開始日推算函式（各週期第一天，用來往前找 prevSnap）
    const weekStart  = (key) => key; // weekKey 本身就是週一
    const monthStart = (key) => key + "-01";
    const yearStart  = (key) => key + "-01-01";

    return {
      week:  toResult(weekMap,  (_, s, e) => `${s.slice(5).replace("-", "/")} ~ ${e.slice(5).replace("-", "/")}`, weekStart),
      month: toResult(monthMap, (k) => { const [y, m] = k.split("-"); return `${y}年${parseInt(m)}月`; }, monthStart),
      year:  toResult(yearMap,  (k) => `${k}年`, yearStart),
    };
  }, [snapshots]);

  // ── 趨勢圖資料：尾端追加/取代「今日即時」點，確保與卡片數字對齊 ──
  // 用本地時區算今天（toISOString 是 UTC，會差時區）
  // 若最後一筆已是今天的快照，直接取代為即時值（快照可能是早上跑的舊值）
  const snapshotsWithLive = useMemo(() => {
    if (!snapshots.length) return snapshots;
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const livePoint = {
      date: today,
      assets: totalAssets,
      liabilities: totalLiab,
      net: netWorth,
      leverage,
    };
    const last = snapshots[snapshots.length - 1];
    if (last?.date === today) return [...snapshots.slice(0, -1), livePoint];
    return [...snapshots, livePoint];
  }, [snapshots, totalAssets, totalLiab, netWorth, leverage]);

  // ── 圓餅圖資料（useMemo 保證穩定的物件參考）─────────────────────────
  const pieData = useMemo(() => [
    { name: "台股",   value: twTotal },
    { name: "美股",   value: usTotal },
    { name: "加密貨幣", value: cryptoTotal },
    { name: "其他",   value: otherTotal },
  ].filter(x => x.value > 0), [twTotal, usTotal, cryptoTotal, otherTotal]);

  const pieColors = [C.accent, C.blue, C.gold, C.purple];

  return (
    <>
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
          {periodReturns.map(({ label, icon, type, delta, pct: pctChange }) => {
            const hasData = delta !== null;
            const isPos = hasData && delta >= 0;
            const color = !hasData ? C.textMuted : isPos ? C.accent : C.red;
            const histLen = periodHistory[type]?.length ?? 0;
            return (
              <div
                key={label}
                onClick={() => histLen > 0 && setSelectedPeriod(type)}
                style={{
                  background: C.surface,
                  border: `1px solid ${C.border}`,
                  borderRadius: 12,
                  padding: "12px 14px",
                  cursor: histLen > 0 ? "pointer" : "default",
                  transition: "border-color 0.15s",
                  boxShadow: SH.sm,
                }}
                onMouseEnter={e => { if (histLen > 0) e.currentTarget.style.borderColor = C.accent; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                  <div style={{ color: C.textMuted, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600 }}>
                    {icon} {label}
                  </div>
                  {histLen > 0 && (
                    <span style={{ color: C.accent, fontSize: 9, opacity: 0.7, marginTop: 1 }}>歷史 ›</span>
                  )}
                </div>
                {hasData ? (
                  <>
                    <div style={{ color, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 14, lineHeight: 1.2 }}>
                      {isPos ? "+" : ""}NT${fmt(Math.abs(delta))}
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

      {/* ── 分類資產卡（可點擊跳轉對應分頁）─────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {[
          { label: "🇹🇼  台股",   value: twTotal,     color: C.accent, tab: "tw"     },
          { label: "🇺🇸  美股",   value: usTotal,     color: C.blue,   tab: "us"     },
          { label: "₿  加密貨幣", value: cryptoTotal, color: C.gold,   tab: "crypto" },
          { label: "🏠  其他",   value: otherTotal,  color: C.purple, tab: "other"  },
        ].map(x => (
          <div
            key={x.label}
            className="wos-row"
            onClick={() => onTabChange?.(x.tab)}
            style={{
              background: C.surface,
              border: `1px solid ${C.border}`,
              borderLeft: `3px solid ${x.color}`,
              borderRadius: 12,
              padding: "12px 16px",
              display: "flex", justifyContent: "space-between", alignItems: "center",
              cursor: onTabChange ? "pointer" : "default",
              boxShadow: SH.sm,
            }}
          >
            <div style={{ color: C.textMuted, fontSize: 12, fontWeight: 500 }}>
              {x.label}
              {onTabChange && <span style={{ color: x.color, fontSize: 9, marginLeft: 4, opacity: 0.7 }}>›</span>}
            </div>
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
            <AreaChart data={snapshotsWithLive}>
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

      {/* ── 週/月/年歷史結算 Modal（在 wos-fade 外，避免 transform 破壞 fixed 定位）── */}
      {selectedPeriod && (() => {
        const rows = periodHistory[selectedPeriod] ?? [];
        const titleMap = { week: "週結算歷史", month: "月結算歷史", year: "年結算歷史" };
        return (
          <div
            onClick={() => setSelectedPeriod(null)}
            style={{
              position: "fixed", inset: 0,
              background: "rgba(0,0,0,0.65)",
              zIndex: 1000,
              display: "flex", alignItems: "center", justifyContent: "center",
              padding: "0 16px",
            }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                background: "#0f1724",
                border: `1px solid ${C.border}`,
                borderRadius: 16,
                width: "100%",
                maxWidth: 520,
                maxHeight: "70vh",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
              }}
            >
              {/* Modal 標題 */}
              <div style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "14px 18px",
                borderBottom: `1px solid ${C.border}`,
                flexShrink: 0,
              }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: C.accent }}>
                  📋 {titleMap[selectedPeriod]}
                </div>
                <button
                  onClick={() => setSelectedPeriod(null)}
                  style={{
                    background: "none", border: "none", color: C.textMuted,
                    fontSize: 18, cursor: "pointer", lineHeight: 1, padding: "0 4px",
                  }}
                >×</button>
              </div>

              {/* 列表 */}
              <div style={{ overflowY: "auto", padding: "10px 12px", flex: 1 }}>
                {rows.length === 0 ? (
                  <div style={{ color: C.textMuted, fontSize: 12, textAlign: "center", padding: 20 }}>
                    資料不足，尚無歷史紀錄
                  </div>
                ) : (
                  rows.map((r, i) => {
                    const isPos = r.delta >= 0;
                    const color = isPos ? C.accent : C.red;
                    return (
                      <div key={r.key} style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "10px 8px",
                        borderBottom: i < rows.length - 1 ? `1px solid ${C.border}` : "none",
                      }}>
                        {/* 左：期間 */}
                        <div>
                          <div style={{ color: C.text, fontSize: 12, fontWeight: 600 }}>{r.label}</div>
                          <div style={{ color: C.textMuted, fontSize: 10, marginTop: 2 }}>
                            NT${fmt(r.startNet)} → NT${fmt(r.endNet)}
                          </div>
                        </div>
                        {/* 右：損益 */}
                        <div style={{ textAlign: "right" }}>
                          <div style={{
                            color,
                            fontFamily: "'JetBrains Mono', monospace",
                            fontWeight: 700,
                            fontSize: 13,
                          }}>
                            {isPos ? "+" : ""}NT${fmt(Math.abs(r.delta))}
                          </div>
                          <div style={{ color, fontSize: 11, marginTop: 2 }}>
                            {isPos ? "▲" : "▼"} {Math.abs(r.pct).toFixed(2)}%
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}
