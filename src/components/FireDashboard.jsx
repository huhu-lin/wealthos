// ============================================================
// FireDashboard.jsx — FIRE 財務自由進度頁
// 控制項：
//   - 情境報酬率（7% / 12% / 18%）
//   - FIRE 模式（Lean / Base / Fat）→ 決定月支出與 FIRE 數
//   - SWR 提領率（2.5% / 3% / 3.5% / 4%）→ 決定 FIRE 數倍數
// ============================================================

import { useMemo, useState } from "react";
import {
  LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceDot,
} from "recharts";
import { C, T, S, TT, fmt } from "../constants/theme";
import KPI  from "./ui/KPI";
import Card from "./ui/Card";
import CashflowManager from "./CashflowManager";

// ── 情境報酬率 ───────────────────────────────────────────────
const SCENARIOS = [
  { id: "conservative", label: "保守 7%",  rate: 0.07, color: C.blue   },
  { id: "moderate",     label: "中性 12%", rate: 0.12, color: C.gold   },
  { id: "aggressive",   label: "積極 18%", rate: 0.18, color: C.accent },
];

// ── FIRE 模式（月支出快捷點）─────────────────────────────────
const FIRE_MODES = [
  { key: "lean", label: "節約", monthly: 35000, color: C.accent, dash: "3 3"   },
  { key: "base", label: "一般", monthly: 45000, color: C.blue,   dash: "8 4"   },
  { key: "fat",  label: "舒適", monthly: 60000, color: C.purple, dash: "14 4"  },
];


const MONTHLY_MIN  = 20000;
const MONTHLY_MAX  = 100000;
const MONTHLY_STEP = 1000;

// 依金額決定顯示標籤與顏色（命中快捷點顯示對應 label，否則顯示「自訂」）
function resolveMode(monthly) {
  const hit = FIRE_MODES.find(m => m.monthly === monthly);
  return hit ?? { key: "custom", label: "自訂", monthly, color: C.gold };
}

// ── SWR 選項 ─────────────────────────────────────────────────
const SWR_OPTIONS = [
  { value: 0.025, label: "2.5%", years: "永久",  desc: "×40，永久不動本金", hint: "超長期 / 極保守" },
  { value: 0.030, label: "3%",   years: "40年+", desc: "×33，40年以上",     hint: "年輕退休建議"   },
  { value: 0.035, label: "3.5%", years: "30年",  desc: "×29，退休30年",     hint: "早退標準"       },
  { value: 0.040, label: "4%",   years: "25年",  desc: "×25，退休25年",     hint: "傳統法則"       },
];

// ── NPER（貸款還清月數）──────────────────────────────────────
function nper(annualRate, monthlyPayment, balance) {
  if (!balance || !monthlyPayment) return 0;
  if (annualRate === 0) return balance / monthlyPayment;
  const r = annualRate / 12 / 100;
  return -Math.log(1 - (r * balance) / monthlyPayment) / Math.log(1 + r);
}

// ── 複利成長曲線 ──────────────────────────────────────────────
function growthCurve(start, annualRate, annualContrib, years) {
  const thisYear = new Date().getFullYear();
  const pts = [];
  let val = start;
  for (let i = 0; i <= years; i++) {
    pts.push({ year: thisYear + i, value: Math.round(val) });
    val = val * (1 + annualRate) + annualContrib;
  }
  return pts;
}

function monthsToDate(months) {
  const d = new Date();
  d.setMonth(d.getMonth() + Math.ceil(months));
  return `${d.getFullYear()}年${d.getMonth() + 1}月`;
}

// ── 控制列按鈕 ───────────────────────────────────────────────
function CtrlBtn({ active, color, onClick, children, small }) {
  return (
    <button onClick={onClick} style={{
      padding: small ? "5px 12px" : "7px 18px",
      borderRadius: 8,
      border: `1px solid ${active ? color : C.border}`,
      background: active ? color + "18" : C.surface,
      color: active ? color : C.textMuted,
      fontSize: small ? 11 : 12, fontWeight: 700, cursor: "pointer",
      transition: "all 0.15s", whiteSpace: "nowrap",
    }}>
      {children}
    </button>
  );
}

export default function FireDashboard({ allAssets, liabilities, cashflow = [], strategies = [], reload }) {
  const [rate,      setRate]      = useState(0.12);   // 名目報酬率，預設中性 12%
  const [inflation, setInflation] = useState(0.02);   // 預設通膨 2%
  const [monthly,   setMonthly]   = useState(45000);  // 預設 Base 45K/月
  const [swr,       setSwr]       = useState(0.030);  // 預設 3%（33歲適合）
  const [subTab,    setSubTab]    = useState("dashboard"); // "dashboard" | "cashflow"

  const realRate = rate - inflation; // 實質報酬率（名目 − 通膨），允許 ≤ 0
  const scen     = SCENARIOS.find(s => s.rate === rate)
                 ?? { id: "custom", label: `自訂 ${(rate * 100).toFixed(1)}%`, rate, color: C.text };
  const mode    = resolveMode(monthly);
  const swrOpt  = SWR_OPTIONS.find(o => o.value === swr);
  const fireNum = Math.round(monthly * 12 / swr);

  const totalAssets = useMemo(
    () => allAssets.reduce((s, x) => s + (x.value_twd || 0), 0),
    [allAssets]
  );

  // ── 從 cashflow 計算實際年化儲蓄（近 12 個月加總）──────────
  const cashflowStats = useMemo(() => {
    if (!cashflow.length) return null;
    const recent = cashflow.slice(0, 12); // 已按 month DESC 排序
    const totalSavings = recent.reduce((s, r) => s + Number(r.net_savings || 0), 0);
    const months = recent.length;
    const annualSavings = Math.round(totalSavings / months * 12);
    const avgSalary     = Math.round(recent.reduce((s, r) => s + Number(r.salary || 0) + Number(r.bonus || 0), 0) / months);
    const avgCC         = Math.round(recent.reduce((s, r) => s + Number(r.cc_total || 0), 0) / months);
    const avgFixed      = Math.round(recent.reduce((s, r) => s + Number(r.fixed || 0), 0) / months);
    return { annualSavings, avgSalary, avgCC, avgFixed, months };
  }, [cashflow]);

  const loans = useMemo(() => ({
    credit:  liabilities.find(l => l.name === "信貸") || {},
    student: liabilities.find(l => l.name === "學貸") || {},
    pledge:  liabilities.find(l => l.name === "質押") || {},
  }), [liabilities]);

  const payoffs = useMemo(() => {
    const { credit, student } = loans;
    const cm = nper(credit.rate  || 0, credit.monthly  || 0, credit.value  || 0);
    const sm = nper(0,                  student.monthly || 0, student.value || 0);
    return {
      credit:  { months: cm, date: monthsToDate(cm), years: (cm / 12).toFixed(1) },
      student: { months: sm, date: monthsToDate(sm), years: (sm / 12).toFixed(1) },
    };
  }, [loans]);

  // ── 核心指標 ─────────────────────────────────────────────────
  const metrics = useMemo(() => {
    const annualReturn = totalAssets * realRate;
    const modeAnnual   = monthly * 12;
    const workOptional = annualReturn / modeAnnual;

    const coastYears = totalAssets >= fireNum
      ? 0
      : (totalAssets > 0 && realRate > 0)
        ? Math.log(fireNum / totalAssets) / Math.log(1 + realRate)
        : Infinity;

    const { credit, pledge } = loans;
    const totalBorrow  = (credit.value || 0) + (pledge.value || 0);
    const weightedCost = totalBorrow > 0
      ? ((credit.value || 0) * (credit.rate || 0) / 100
       + (pledge.value || 0) * (pledge.rate || 0) / 100) / totalBorrow
      : 0;

    return {
      annualReturn,
      modeAnnual,
      workOptional,
      dynamicWithdrawal: totalAssets * swr / 12,
      coastYears,
      weightedCost,
      arbitrage: rate - weightedCost, // 套利比較維持名目（通膨兩邊抵消）
    };
  }, [totalAssets, realRate, rate, monthly, fireNum, swr, loans]);

  // ── 三情境成長圖（年存款優先用實際，否則 18萬）────────────
  const annualContrib = cashflowStats?.annualSavings ?? 180000;
  const chartData = useMemo(() => {
    const real = (n) => n - inflation;
    const c7   = growthCurve(totalAssets, real(0.07), annualContrib, 25);
    const c12  = growthCurve(totalAssets, real(0.12), annualContrib, 25);
    const c18  = growthCurve(totalAssets, real(0.18), annualContrib, 25);
    const cust = growthCurve(totalAssets, realRate,   annualContrib, 25);
    return c7.map((p, i) => ({
      year:    p.year,
      c7:      c7[i].value,
      c12:     c12[i].value,
      c18:     c18[i].value,
      cCustom: cust[i].value,
    }));
  }, [totalAssets, annualContrib, realRate, inflation]);

  // ── 三模式快捷點 + 自訂目標 × 目前 SWR 進度條 ──────────────
  const fireProgress = useMemo(() => {
    const base = FIRE_MODES.map(m => {
      const target    = Math.round(m.monthly * 12 / swr);
      const pct       = Math.min(totalAssets / target, 1);
      const remaining = Math.max(target - totalAssets, 0);
      const yearsLeft = remaining > 0
        ? (totalAssets > 0 && realRate > 0)
          ? Math.log(target / totalAssets) / Math.log(1 + realRate)
          : Infinity
        : 0;
      return { ...m, target, pct, remaining, yearsLeft };
    });
    if (!FIRE_MODES.some(m => m.monthly === monthly)) {
      const target    = Math.round(monthly * 12 / swr);
      const pct       = Math.min(totalAssets / target, 1);
      const remaining = Math.max(target - totalAssets, 0);
      const yearsLeft = remaining > 0
        ? (totalAssets > 0 && realRate > 0)
          ? Math.log(target / totalAssets) / Math.log(1 + realRate)
          : Infinity
        : 0;
      base.push({ key: "custom", label: "自訂", monthly, color: C.gold, dash: "6 2 2 2", target, pct, remaining, yearsLeft });
    }
    return base;
  }, [totalAssets, realRate, swr, monthly]);

  const fireCrossings = useMemo(() => {
    const hit = chartData.find(d => d.cCustom >= fireNum);
    return hit ? [{ year: hit.year, value: hit.cCustom }] : [];
  }, [chartData, fireNum]);

  // ── 策略訊號狀態（P-007 聯動）────────────────────────────
  const signalState = useMemo(() => {
    if (!strategies.length) return { type: "NEUTRAL" };
    const now = new Date();
    const sellSigs = [], buySigs = [], hotSigs = [], loadSigs = [];
    for (const st of strategies) {
      const daysSince = st.last_signal_date
        ? Math.floor((now - new Date(st.last_signal_date)) / 86400000) : Infinity;
      if (st.last_signal === "SELL" && daysSince <= 10) sellSigs.push(st);
      if (st.last_signal === "BUY"  && daysSince <= 10) buySigs.push(st);
      if (st.j_above_flag) hotSigs.push(st);
      if (st.j_below_flag) loadSigs.push(st);
    }
    if (sellSigs.length > 0) return { type: "SELL_SIGNAL",  tickers: sellSigs };
    if (hotSigs.length  > 0) return { type: "OVERHEATED",   tickers: hotSigs  };
    if (buySigs.length  > 0) return { type: "BUY_SIGNAL",   tickers: buySigs  };
    if (loadSigs.length > 0) return { type: "LOADING",      tickers: loadSigs };
    return { type: "NEUTRAL" };
  }, [strategies]);

  // 保守情境（用於賣訊比較）
  const conservativeMetrics = useMemo(() => {
    const conservRealRate = SCENARIOS[0].rate - inflation; // 保守 7% 實質
    const modeAnnual      = monthly * 12;
    const conservFireNum  = Math.round(monthly * 12 / swr);
    const coastYears      = totalAssets >= conservFireNum ? 0
      : (totalAssets > 0 && conservRealRate > 0)
        ? Math.log(conservFireNum / totalAssets) / Math.log(1 + conservRealRate)
        : Infinity;
    return {
      workOptional: (totalAssets * conservRealRate) / modeAnnual,
      coastYears,
      dynamicWithdrawal: totalAssets * swr / 12,
      deltaVsCurrentRate: (realRate - conservRealRate) * 100,
    };
  }, [totalAssets, monthly, swr, realRate, inflation]);

  return (
    <div className="wos-fade" style={{ display: "flex", flexDirection: "column", gap: 14 }}>

      {/* ── 子分頁切換 ──────────────────────────────────────── */}
      <div style={{
        display: "flex", gap: 6, alignItems: "center",
        paddingBottom: 4, borderBottom: `1px solid ${C.border}`,
      }}>
        <CtrlBtn active={subTab === "dashboard"} color={C.accent}
          onClick={() => setSubTab("dashboard")}>
          📊 FIRE 儀表板
        </CtrlBtn>
        <CtrlBtn active={subTab === "cashflow"} color={C.blue}
          onClick={() => setSubTab("cashflow")}>
          💰 現金流紀錄
        </CtrlBtn>
      </div>

      {subTab === "cashflow" && (
        <CashflowManager cashflow={cashflow} reload={reload} />
      )}

      {subTab === "dashboard" && (<>

      {/* ── 頁面說明句 ───────────────────────────────────────── */}
      <div style={{
        background: C.surface3, border: `1px solid ${C.border}`,
        borderRadius: 12, padding: "14px 18px",
        fontSize: 13, color: C.textMuted, lineHeight: 1.6,
      }}>
        <span style={{ fontWeight: 700, color: C.text }}>財務自由試算</span>
        {" "}— 以月支出{" "}
        <span style={{ color: mode.color, fontWeight: 700 }}>NT${fmt(monthly)}/月</span>
        {" "}、實質報酬{" "}
        <span style={{ color: scen.color, fontWeight: 700 }}>{(realRate * 100).toFixed(1)}%</span>
        <span style={{ color: C.textDim, fontSize: 11 }}>{" "}（名目 {(rate * 100).toFixed(1)}% − 通膨 {(inflation * 100).toFixed(1)}%）</span>
        {" "}推算，資產累積到{" "}
        <span style={{ color: mode.color, fontWeight: 700 }}>NT${(fireNum / 1e6).toFixed(1)}M</span>
        {" "}後，每年投資報酬就夠支應生活，不再依賴工作收入。
        {fireCrossings[0] && (
          <span>
            {" "}預計{" "}
            <span style={{ color: scen.color, fontWeight: 700, fontSize: 15 }}>{fireCrossings[0].year} 年</span>
            {" "}達標。
          </span>
        )}
      </div>

      {/* ── P-007 訊號 Banner ────────────────────────────────── */}
      {signalState.type !== "NEUTRAL" && (() => {
        const cfg = {
          SELL_SIGNAL: { icon: "📉", label: "賣訊已觸發", sub: "P-007 KDJ＋布林雙確認賣出訊號成立，建議對照保守情境評估 FIRE 進度", col: C.red   },
          OVERHEATED:  { icon: "🔥", label: "市場過熱蓄勢", sub: "J 值已超過閾值，等待回落確認賣訊。建議以保守報酬率試算",              col: C.orange },
          BUY_SIGNAL:  { icon: "📈", label: "買訊已觸發", sub: "P-007 出現買入訊號，再平衡機會窗口開啟，組合資金配置中",             col: C.accent },
          LOADING:     { icon: "⚡", label: "低位蓄力中", sub: "J 值已低於進場閾值，等待反彈確認買訊，市場正在築底",                  col: C.blue   },
        }[signalState.type];
        const isSellAlert = signalState.type === "SELL_SIGNAL" || signalState.type === "OVERHEATED";
        return (
          <div style={{
            background: cfg.col + "12",
            border: `1px solid ${cfg.col}55`,
            borderLeft: `3px solid ${cfg.col}`,
            borderRadius: 12, padding: "12px 16px",
            display: "flex", alignItems: "flex-start", gap: 12,
          }}>
            <span style={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }}>{cfg.icon}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3, flexWrap: "wrap" }}>
                <span style={{ fontWeight: 700, fontSize: 13, color: cfg.col }}>策略聯動 — {cfg.label}</span>
                {(signalState.tickers || []).map(t => (
                  <span key={t.ticker} style={{
                    background: cfg.col + "20", color: cfg.col,
                    border: `1px solid ${cfg.col}40`,
                    borderRadius: 5, padding: "1px 7px", fontSize: 11, fontWeight: 600,
                  }}>{t.ticker} J={t.latest_j?.toFixed(1) ?? "–"}</span>
                ))}
              </div>
              <div style={{ fontSize: 11, color: C.textMuted }}>{cfg.sub}</div>
              {isSellAlert && conservativeMetrics.deltaVsCurrentRate > 0 && (
                <div style={{
                  marginTop: 10,
                  display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8,
                }}>
                  {[
                    { label: "保守 7% Work Optional", val: `${(conservativeMetrics.workOptional * 100).toFixed(0)}%`, dim: `vs 現況 ${(metrics.workOptional * 100).toFixed(0)}%` },
                    { label: "保守 7% Coast FIRE",    val: isFinite(conservativeMetrics.coastYears) ? `${conservativeMetrics.coastYears.toFixed(1)} 年` : "—",  dim: `vs 現況 ${isFinite(metrics.coastYears) ? metrics.coastYears.toFixed(1) + " 年" : "—"}` },
                    { label: "報酬率假設差距",            val: `-${conservativeMetrics.deltaVsCurrentRate.toFixed(0)}pp`, dim: "保守 7% vs 目前情境" },
                  ].map(item => (
                    <div key={item.label} style={{
                      background: C.surface3, borderRadius: 8, padding: "8px 10px",
                      border: `1px solid ${C.border}`,
                    }}>
                      <div style={{ fontSize: 9, color: C.textDim, marginBottom: 3 }}>{item.label}</div>
                      <div style={{ ...T.mono, fontSize: 14, fontWeight: 700, color: C.red }}>{item.val}</div>
                      <div style={{ fontSize: 10, color: C.textDim }}>{item.dim}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── 控制列 ──────────────────────────────────────────── */}
      <Card style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
        {/* Row 1: 報酬率滑桿 + 快捷點 */}
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, color: C.textDim, width: 56, flexShrink: 0 }}>報酬率</span>
          <input
            type="range" min={1} max={30} step={0.5}
            value={rate * 100}
            onChange={e => setRate(Number(e.target.value) / 100)}
            style={{ flex: 1, minWidth: 160, maxWidth: 280, accentColor: scen.color, cursor: "pointer" }}
          />
          <span style={{ ...T.mono, fontSize: 13, fontWeight: 700, color: scen.color, minWidth: 52 }}>
            {(rate * 100).toFixed(1)}%
          </span>
          <div style={{ display: "flex", gap: 4 }}>
            {SCENARIOS.map(s => (
              <CtrlBtn key={s.id} small active={rate === s.rate} color={s.color} onClick={() => setRate(s.rate)}>
                {s.label}
              </CtrlBtn>
            ))}
          </div>
          <span style={{ marginLeft: "auto", fontSize: 10, color: C.textDim }}>
            起點 NT${fmt(Math.round(totalAssets))}
          </span>
        </div>

        {/* Row 2: 月支出滑桿（含 Lean/Base/Fat 快捷點）*/}
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, color: C.textDim, width: 56, flexShrink: 0 }}>月支出</span>
          <input
            type="range"
            min={MONTHLY_MIN}
            max={MONTHLY_MAX}
            step={MONTHLY_STEP}
            value={monthly}
            onChange={e => setMonthly(Number(e.target.value))}
            style={{
              flex: 1, minWidth: 180, maxWidth: 360,
              accentColor: mode.color, cursor: "pointer",
            }}
          />
          <span style={{
            ...T.mono, fontSize: 12, fontWeight: 700, color: mode.color, minWidth: 110,
          }}>
            NT${fmt(monthly)}/月
          </span>
          <span style={{ fontSize: 10, color: C.textDim }}>（{mode.label}）</span>
          <div style={{ display: "flex", gap: 4, marginLeft: 4 }}>
            {FIRE_MODES.map(m => (
              <CtrlBtn key={m.key} small active={monthly === m.monthly} color={m.color}
                onClick={() => setMonthly(m.monthly)}>
                {m.label} {m.monthly / 1000}K
              </CtrlBtn>
            ))}
          </div>
        </div>

        {/* Row 3: 通膨率 */}
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, color: C.textDim, width: 56, flexShrink: 0 }}>通膨率</span>
          <input
            type="range" min={0} max={6} step={0.25}
            value={inflation * 100}
            onChange={e => setInflation(Number(e.target.value) / 100)}
            style={{ flex: 1, minWidth: 160, maxWidth: 280, accentColor: C.red, cursor: "pointer" }}
          />
          <span style={{ ...T.mono, fontSize: 13, fontWeight: 700, color: C.red, minWidth: 52 }}>
            {(inflation * 100).toFixed(2)}%
          </span>
          <div style={{ display: "flex", gap: 4 }}>
            {[{ label: "1%", v: 0.01 }, { label: "2%", v: 0.02 }, { label: "3%", v: 0.03 }].map(o => (
              <CtrlBtn key={o.v} small active={inflation === o.v} color={C.red} onClick={() => setInflation(o.v)}>
                {o.label}
              </CtrlBtn>
            ))}
          </div>
          <span style={{ fontSize: 10, color: C.textDim, marginLeft: 4 }}>
            實質報酬率{" "}
            <span style={{ color: realRate <= 0 ? C.red : realRate < 0.03 ? C.gold : C.accent, fontWeight: 700 }}>
              {(realRate * 100).toFixed(1)}%
            </span>
            {realRate <= 0
              ? <span style={{ color: C.red, marginLeft: 4 }}>⚠ 通膨超過報酬率，年數試算暫停</span>
              : <>{" "}（名目 {(rate * 100).toFixed(1)}% − 通膨 {(inflation * 100).toFixed(2)}%）</>
            }
          </span>
        </div>

        {/* Row 4: 退休提領率 */}
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, color: C.textDim, width: 56, flexShrink: 0 }}>提領率</span>
          {SWR_OPTIONS.map(o => (
            <CtrlBtn key={o.value} small active={swr === o.value} color={C.gold}
              onClick={() => setSwr(o.value)}>
              <div style={{ lineHeight: 1.3, textAlign: "center" }}>
                <div>{o.label}</div>
                <div style={{ fontSize: 9, fontWeight: 400, opacity: 0.8 }}>{o.years}</div>
              </div>
            </CtrlBtn>
          ))}
          <span style={{ fontSize: 10, color: C.textDim, marginLeft: 4, lineHeight: 1.5 }}>
            退休後每年花掉資產的{" "}
            <span style={{ color: C.gold }}>{swrOpt.label}</span>。
            {" "}存到{" "}
            <strong style={{ color: mode.color }}>NT${fmt(fireNum)}</strong>
            {" "}後，每年可領{" "}
            <strong style={{ color: C.accent }}>NT${fmt(monthly * 12)}</strong>
            {" "}= 月支出 × 12，理論上能撐{" "}
            <span style={{ color: C.gold }}>{swrOpt.years}</span>。
          </span>
        </div>
      </Card>

      {/* ── 現金流摘要條 ─────────────────────────────────────── */}
      {cashflowStats ? (
        <div className="wos-grid-fire-kpi" style={{
          padding: "12px 16px",
          background: C.surface3, border: `1px solid ${C.border}`, borderRadius: 12,
        }}>
          <CfStat label={`月均薪資（近${cashflowStats.months}月）`} value={cashflowStats.avgSalary} color={C.accent} />
          <CfStat label="月均固定支出"   value={cashflowStats.avgFixed}  color={C.red}    neg />
          <CfStat label="月均信用卡"     value={cashflowStats.avgCC}     color={C.gold}   neg />
          <CfStat label="實際年化儲蓄"   value={cashflowStats.annualSavings} color={cashflowStats.annualSavings >= 0 ? C.accent : C.red} />
        </div>
      ) : (
        <div style={{
          padding: "10px 16px", background: C.surface3,
          border: `1px dashed ${C.border}`, borderRadius: 12,
          fontSize: 11, color: C.textDim, display: "flex", alignItems: "center", gap: 8,
        }}>
          <span>📂</span>
          <span>尚未匯入現金流資料 — 成長圖暫用預設 NT$180,000/年。用 Cowork 跑月度帳單後資料會自動更新。</span>
        </div>
      )}

      {/* ── KPI 卡片 ─────────────────────────────────────────── */}
      <div className="wos-grid-fire-kpi">
        <KPI
          label={`Coast FIRE（${mode.label}）`}
          value={metrics.coastYears <= 0 ? "已達成 ✓" : isFinite(metrics.coastYears) ? `${metrics.coastYears.toFixed(1)} 年` : "—"}
          prefix=""
          sub={`不存新錢自然滾到 NT$${fmt(fireNum)}`}
          color={metrics.coastYears <= 0 ? C.accent : scen.color}
        />
        <KPI
          label={`Work Optional（${mode.label}）`}
          value={`${(metrics.workOptional * 100).toFixed(0)}%`}
          prefix=""
          sub={`年報酬 NT$${fmt(Math.round(metrics.annualReturn))} vs 年支出 NT$${fmt(metrics.modeAnnual)}`}
          color={metrics.workOptional >= 1 ? C.accent : C.gold}
        />
        <KPI
          label={`每月可安全提領（${swrOpt.label} 提領率）`}
          value={Math.round(metrics.dynamicWithdrawal)}
          sub={`若現在退休每月可花這金額，長期不耗盡組合｜${swrOpt.hint}`}
          color={C.purple}
        />
        <KPI
          label="負債套利空間"
          value={`+${(metrics.arbitrage * 100).toFixed(1)}%`}
          prefix=""
          sub={`名目報酬 ${(rate * 100).toFixed(1)}% − 借款 ${(metrics.weightedCost * 100).toFixed(2)}%｜台灣無風險利率（10年公債）約 1.5–2%`}
          color={C.gold}
        />
      </div>

      {/* ── 成長預測圖 ────────────────────────────────────────── */}
      <Card style={{ padding: "20px 20px 12px" }}>
        <div style={{
          ...T.section, color: C.text,
          marginBottom: S.lg, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
        }}>
          投資組合成長預測（25年）
          <span style={{ fontSize: 10, fontWeight: 400, textTransform: "none", color: C.textDim }}>
            {cashflowStats
              ? <>— 年存 <span style={{ color: C.accent }}>NT${fmt(annualContrib)}（近{cashflowStats.months}月實際）</span></>
              : <>— 年存 <span style={{ color: C.gold }}>NT$180,000（預設）</span></>}
            {" "}｜以今日購買力試算（已扣 {(inflation * 100).toFixed(1)}% 通膨）｜▲ 達標年份
          </span>
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={chartData} margin={{ top: 20, right: 70, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
            <XAxis dataKey="year" tick={{ fill: C.textDim, fontSize: 11 }} />
            <YAxis tickFormatter={v => `${(v / 1e6).toFixed(0)}M`}
              tick={{ fill: C.textDim, fontSize: 11 }} width={40} />
            <Tooltip
              {...TT}
              formatter={(v, name) => [`NT$${fmt(v)}`, name]}
              labelFormatter={l => `${l} 年`}
            />
            <Line type="monotone" dataKey="c7"      stroke={C.blue   + "44"} strokeWidth={1} dot={false} name="保守 7%（參考）"  strokeDasharray="4 3" />
            <Line type="monotone" dataKey="c12"     stroke={C.gold   + "44"} strokeWidth={1} dot={false} name="中性 12%（參考）" strokeDasharray="4 3" />
            <Line type="monotone" dataKey="c18"     stroke={C.accent + "44"} strokeWidth={1} dot={false} name="積極 18%（參考）" strokeDasharray="4 3" />
            <Line type="monotone" dataKey="cCustom" stroke={scen.color}      strokeWidth={2.5} dot={false} name={`你的設定 ${(rate * 100).toFixed(1)}%`} />
            {fireCrossings.map(c => (
              <ReferenceDot
                key={c.year}
                x={c.year} y={c.value}
                r={5} fill={scen.color} stroke={C.bg} strokeWidth={1.5}
                label={{ value: `${c.year}`, fill: scen.color, fontSize: 9, position: "top" }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </Card>

      {/* ── FIRE 進度 + 負債里程碑 ───────────────────────────── */}
      <div className="wos-grid-fire-main">

        {/* FIRE 三目標進度條 */}
        <Card style={{ padding: "20px" }}>
          <div style={{ ...T.section, color: C.text, marginBottom: S.sm - 2 }}>
            FIRE 目標進度
          </div>
          <div style={{ fontSize: 10, color: C.textDim, marginBottom: 16 }}>
            以 {swrOpt.label} 提領率（{swrOpt.desc}）計算所需資產，點擊快捷切換目標
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
            {fireProgress.map(fp => {
              const isActive = fp.monthly === monthly;
              return (
              <div key={fp.key}
                onClick={() => setMonthly(fp.monthly)}
                style={{ cursor: "pointer", opacity: isActive ? 1 : 0.55, transition: "opacity 0.2s" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {isActive && (
                      <span style={{ color: fp.color, fontSize: 10 }}>▶</span>
                    )}
                    <span style={{ color: fp.color, fontWeight: 700, fontSize: 13 }}>{fp.label} FIRE</span>
                    <span style={{ color: C.textMuted, fontSize: 11 }}>月支出 NT${fmt(fp.monthly)}</span>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <span style={{ ...T.mono, color: fp.color, fontWeight: 800, fontSize: 15 }}>
                      {(fp.pct * 100).toFixed(0)}%
                    </span>
                    <span style={{ color: C.textDim, fontSize: 10, marginLeft: 6 }}>
                      / NT${(fp.target / 1e6).toFixed(1)}M
                    </span>
                  </div>
                </div>
                <div style={{ background: C.surface3, borderRadius: 4, height: 7, overflow: "hidden" }}>
                  <div style={{
                    width: `${fp.pct * 100}%`, height: 7, borderRadius: 4,
                    background: `linear-gradient(90deg, ${fp.color}88, ${fp.color})`,
                    transition: "width 0.6s ease",
                  }} />
                </div>
                <div style={{ color: C.textDim, fontSize: 10, marginTop: 5 }}>
                  {fp.remaining > 0
                    ? isFinite(fp.yearsLeft) ? `還差 NT$${fmt(Math.round(fp.remaining))} ｜ ${scen.label} 情境約 ${fp.yearsLeft.toFixed(1)} 年後達標` : `還差 NT$${fmt(Math.round(fp.remaining))}`
                    : "✓ 已達成"}
                </div>
              </div>
              );
            })}
          </div>
        </Card>

        {/* 右欄：負債里程碑 + 保險緩衝 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

          {/* 負債還清里程碑 */}
          <Card style={{ padding: "20px", flex: 1 }}>
            <div style={{ ...T.section, color: C.text, marginBottom: S.md + 2 }}>
              負債還清里程碑
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <MilestoneCard
                name="學貸" color={C.blue}
                balance={loans.student.value || 0} rate={loans.student.rate || 0}
                targetDate={payoffs.student.date} yearsLeft={payoffs.student.years}
                released={loans.student.monthly || 0}
                note="0% 無息，照時程走即可"
              />
              <MilestoneCard
                name="信貸" color={C.orange}
                balance={loans.credit.value || 0} rate={loans.credit.rate || 0}
                targetDate={payoffs.credit.date} yearsLeft={payoffs.credit.years}
                released={loans.credit.monthly || 0}
                note={`利差 +${((scen.rate - (loans.credit.rate || 0) / 100) * 100).toFixed(1)}%，不急著提前還`}
              />
              <div style={{
                background: C.surface3, border: `1px solid ${C.border}`,
                borderLeft: `3px solid ${C.gold}`, borderRadius: 10, padding: "12px 14px",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                  <span style={{ color: C.gold, fontWeight: 700, fontSize: 12 }}>質押</span>
                  <span style={{ color: C.textDim, fontSize: 10 }}>BBD 策略</span>
                </div>
                <div style={{ color: C.textMuted, fontSize: 11 }}>
                  餘額 NT${fmt(loans.pledge.value || 0)} ｜ {loans.pledge.rate || 0}% ｜ 年息 NT${fmt(Math.round((loans.pledge.value || 0) * (loans.pledge.rate || 0) / 100))}
                </div>
              </div>
              <div style={{
                padding: "10px 14px",
                background: C.accent + "0F", border: `1px solid ${C.accent}30`, borderRadius: 10,
              }}>
                <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 4 }}>學貸 + 信貸全還清後</div>
                <div style={{ ...T.mono, color: C.accent, fontWeight: 700, fontSize: 14 }}>
                  月現金流 +NT${fmt((loans.student.monthly || 0) + (loans.credit.monthly || 0))}
                </div>
              </div>
            </div>
          </Card>

          {/* 保險緩衝 */}
          <Card style={{ padding: "14px 16px" }}>
            <div style={{ ...T.section, color: C.text, marginBottom: S.md - 2 }}>
              保險緩衝
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <InsuranceRow icon="🏥" label="實支實付醫療險" value="NT$200,000" color={C.blue}
                note="重大醫療不需動用投資組合" />
              <InsuranceRow icon="🛡️" label="人壽保險" value="有效" color={C.accent}
                note="家庭責任覆蓋，降低遺留風險" />
              <div style={{
                padding: "7px 10px",
                background: C.gold + "0F", border: `1px solid ${C.gold}22`, borderRadius: 8,
                fontSize: 10, color: C.gold, lineHeight: 1.6,
              }}>
                保險覆蓋醫療尾端風險，FIRE 數無需額外保留大額醫療備用金
              </div>
            </div>
          </Card>

        </div>
      </div>

      </>)}
    </div>
  );
}

function CfStat({ label, value, color, neg }) {
  return (
    <div>
      <div style={{ fontSize: 9, color: C.textDim, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
      <div style={{ ...T.mono, color, fontWeight: 700, fontSize: 14 }}>
        {neg ? "-" : ""}NT${fmt(Math.abs(value))}
      </div>
    </div>
  );
}

function MilestoneCard({ name, color, balance, rate, targetDate, yearsLeft, released, note }) {
  return (
    <div style={{
      background: C.surface3, border: `1px solid ${C.border}`,
      borderLeft: `3px solid ${color}`, borderRadius: 10, padding: "12px 14px",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
        <span style={{ color, fontWeight: 700, fontSize: 12 }}>{name}</span>
        <span style={{ color: C.text, fontWeight: 600, fontSize: 12 }}>{targetDate} 還清</span>
      </div>
      <div style={{ color: C.textMuted, fontSize: 11, marginBottom: 5 }}>
        餘額 NT${fmt(balance)} ｜ 利率 {rate}% ｜ 剩 {yearsLeft} 年
      </div>
      <div style={{ color: C.textDim, fontSize: 10, marginBottom: 6 }}>{note}</div>
      <div style={{ padding: "4px 8px", background: color + "15", borderRadius: 6, fontSize: 10, color, fontWeight: 600 }}>
        還清後月現金流 +NT${fmt(released)}
      </div>
    </div>
  );
}

function InsuranceRow({ icon, label, value, color, note }) {
  return (
    <div style={{
      display: "flex", gap: 10, alignItems: "flex-start",
      padding: "8px 10px", background: C.surface3, borderRadius: 8,
      border: `1px solid ${C.border}`,
    }}>
      <span style={{ fontSize: 16, lineHeight: 1 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: C.text }}>{label}</span>
          <span style={{ ...T.mono, color, fontWeight: 700, fontSize: 11 }}>{value}</span>
        </div>
        <div style={{ color: C.textDim, fontSize: 10, marginTop: 3 }}>{note}</div>
      </div>
    </div>
  );
}
