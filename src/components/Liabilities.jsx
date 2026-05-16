// ============================================================
// Liabilities.jsx — 負債管理頁
// 功能：
//   - 顯示所有負債（信貸、信用卡、房貸等）
//   - 攤還模式：等額本利（固定月付）/ 等額本金（固定本金）
//   - 每月自動還款：頁面載入時若扣款日已過且本月未還，自動扣除
//   - 扣款日預警：今日扣款（紅色）、3日內即將扣款（金色）
//   - 新增 / 編輯 / 刪除
//   - 還款時間軸：視覺化顯示各貸款清零日期
// ============================================================

import { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "../supabase";
import { C, fmt } from "../constants/theme";
import KPI from "./ui/KPI";
import { Inp, Sel, Btn } from "./ui/FormControls";
import Modal from "./ui/Modal";
import { Badge, SectionHeader } from "./ui/Badge";

// ── 常數 ─────────────────────────────────────────────────────
const LIAB_CATS   = ["長期負債", "質押", "信用卡", "房貸", "其他"];
const AMORT_TYPES = ["annuity", "principal"]; // 等額本利 / 等額本金
const AMORT_LABEL = { annuity: "等額本利", principal: "等額本金" };

const emptyLiab = {
  name: "", value: "", rate: "", due_day: "",
  category: "長期負債",
  amortization_type: "annuity",
  monthly: "",           // 等額本利：固定月付
  monthly_principal: "", // 等額本金：固定每月本金
};

// ── 工具函式 ─────────────────────────────────────────────────

// 當月第一天（YYYY-MM-01 格式，用於 last_auto_payment 比對）
function thisMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
}

// 有效月付（顯示用）
function effectiveMonthly(l) {
  if (l.amortization_type === "principal") {
    const r = (l.rate || 0) / 12 / 100;
    return (l.monthly_principal || 0) + (l.value || 0) * r;
  }
  return l.monthly || 0;
}

// 等額本利：NPER 月數
function nperAnnuity(annualRate, monthlyPayment, balance) {
  if (!balance || !monthlyPayment) return 0;
  if (!annualRate) return balance / monthlyPayment;
  const r = annualRate / 12 / 100;
  const arg = 1 - (r * balance) / monthlyPayment;
  if (arg <= 0) return Infinity;
  return -Math.log(arg) / Math.log(1 + r);
}

// 統一月數計算
function monthsToPayoff(l) {
  if (l.value <= 0) return 0;
  if (l.amortization_type === "principal") {
    const mp = l.monthly_principal || 0;
    return mp > 0 ? Math.ceil(l.value / mp) : Infinity;
  }
  return nperAnnuity(l.rate || 0, l.monthly || 0, l.value);
}

// 總利息估算
function totalInterestEst(l, months) {
  if (!isFinite(months) || months <= 0) return 0;
  if (l.amortization_type === "principal") {
    const r = (l.rate || 0) / 12 / 100;
    const mp = l.monthly_principal || 0;
    // 等額本金：每月利息遞減，總利息 = r × mp × N(N-1)/2 + r × (balance mod mp) × ...
    // 簡化：sum = r × (balance + mp) × N / 2（梯形近似）
    return r * (l.value + mp) * months / 2;
  }
  return (l.monthly || 0) * months - l.value;
}

// ── 還款時間軸（Gantt 視覺化）──────────────────────────────
function PayoffTimeline({ liabilities }) {
  const now     = new Date();
  const nowYear = now.getFullYear() + now.getMonth() / 12;
  const BAR_COLORS = [C.red, C.gold, C.blue, C.purple, C.orange, C.accent];

  const items = useMemo(() => {
    return liabilities
      .filter(l => l.value > 0 && (l.monthly > 0 || l.monthly_principal > 0))
      .map(l => {
        const months = monthsToPayoff(l);
        if (!isFinite(months) || months <= 0) return null;
        const payoffYear    = nowYear + months / 12;
        const totalInterest = totalInterestEst(l, months);
        return { ...l, months, payoffYear, totalInterest };
      })
      .filter(Boolean)
      .sort((a, b) => a.payoffYear - b.payoffYear);
  }, [liabilities]);

  if (items.length === 0) return null;

  const maxYear   = Math.max(...items.map(i => i.payoffYear));
  const spanYears = Math.max(maxYear - nowYear, 1);
  const debtFreeD = new Date(now.getFullYear(), now.getMonth() + Math.round(Math.max(...items.map(i => i.months))));

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 18px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <span style={{ fontWeight: 700, fontSize: 13, color: C.text }}>還款時間軸</span>
        <span style={{ fontSize: 11, color: C.textMuted }}>
          全部清零：<span style={{ color: C.accent, fontWeight: 700 }}>
            {debtFreeD.getFullYear()}年{debtFreeD.getMonth()+1}月
          </span>
        </span>
      </div>

      {/* 年份刻度 */}
      <div style={{ position: "relative", marginBottom: 6, paddingLeft: 92 }}>
        {(() => {
          const ticks = [];
          for (let y = Math.ceil(nowYear); y <= Math.ceil(maxYear) + 1; y++) {
            const pct = ((y - nowYear) / spanYears) * 100;
            if (pct > 100) break;
            ticks.push(
              <span key={y} style={{
                position: "absolute", left: `${pct}%`,
                transform: "translateX(-50%)", fontSize: 10, color: C.textDim,
              }}>{y}</span>
            );
          }
          return ticks;
        })()}
        <div style={{ height: 14 }} />
      </div>

      {/* 甘特條 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map((item, i) => {
          const barWidth = Math.min(((item.payoffYear - nowYear) / spanYears) * 100, 100);
          const col      = BAR_COLORS[i % BAR_COLORS.length];
          const payoffD  = new Date(now.getFullYear(), now.getMonth() + Math.round(item.months));
          const isAnnuity = item.amortization_type !== "principal";
          return (
            <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 86, flexShrink: 0, fontSize: 11, color: C.textMuted, textAlign: "right" }}>
                {item.name}
                <span style={{ fontSize: 9, color: C.textDim, display: "block" }}>
                  {isAnnuity ? "等額本利" : "等額本金"}
                </span>
              </div>
              <div style={{ flex: 1, position: "relative", height: 22, background: C.surface3, borderRadius: 6, overflow: "hidden" }}>
                <div style={{
                  position: "absolute", left: 0, top: 0, bottom: 0,
                  width: `${barWidth}%`,
                  background: `linear-gradient(90deg, ${col}99, ${col})`,
                  borderRadius: 6,
                  display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 6,
                  transition: "width 0.6s ease",
                }}>
                  <span style={{ fontSize: 10, color: "#fff", fontWeight: 700, whiteSpace: "nowrap" }}>
                    {payoffD.getFullYear()}/{String(payoffD.getMonth()+1).padStart(2,"0")}
                  </span>
                </div>
              </div>
              <div style={{ width: 76, flexShrink: 0, fontSize: 10, color: C.textDim, textAlign: "right" }}>
                利息 +{fmt(Math.round(item.totalInterest / 1000))}K
              </div>
            </div>
          );
        })}
      </div>

      {/* 債務套利摘要 */}
      {items.filter(l => l.rate > 0 && l.rate < 10).length > 0 && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 6 }}>債務套利試算（年化報酬 vs 借貸成本）</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {items.filter(l => l.rate > 0 && l.rate < 10).map(item => (
              <div key={item.id} style={{
                background: C.surface3, borderRadius: 8, padding: "8px 12px",
                border: `1px solid ${C.border}`, fontSize: 11,
              }}>
                <div style={{ color: C.textMuted, marginBottom: 4 }}>{item.name} @ {item.rate}%</div>
                <div style={{ display: "flex", gap: 8 }}>
                  {[[7,"保7%",C.accent],[12,"中12%",C.gold],[18,"積18%",C.blue]].map(([r,label,col]) => {
                    const arb = (r - item.rate).toFixed(1);
                    return <span key={r} style={{ color: +arb >= 0 ? col : C.red }}>{label}: +{arb}%</span>;
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── 主元件 ───────────────────────────────────────────────────
export default function Liabilities({ liabilities, reload }) {
  const [modal,      setModal]      = useState(null);
  const [form,       setForm]       = useState(emptyLiab);
  const [saving,     setSaving]     = useState(false);
  const autoRanRef = useRef(false); // 防止 StrictMode 雙次執行

  const set = k => v => setForm(p => ({ ...p, [k]: v }));

  // ── 自動還款（每月一次）──────────────────────────────────
  useEffect(() => {
    if (autoRanRef.current || liabilities.length === 0) return;
    autoRanRef.current = true;

    const today    = new Date();
    const todayDay = today.getDate();
    const curMonth = thisMonthKey();
    let didUpdate  = false;

    const updates = liabilities
      .filter(l => {
        if (l.value <= 0) return false;
        // 等額本利需有 monthly；等額本金需有 monthly_principal
        const hasPmt = l.amortization_type === "principal"
          ? l.monthly_principal > 0
          : l.monthly > 0;
        if (!hasPmt) return false;
        // 本月已還過就跳過
        if (l.last_auto_payment && l.last_auto_payment.slice(0,7) === curMonth.slice(0,7)) return false;
        // 若有設扣款日，需等到當日或之後才還
        if (l.due_day > 0 && todayDay < l.due_day) return false;
        return true;
      })
      .map(l => {
        let newBalance;
        if (l.amortization_type === "principal") {
          newBalance = Math.max(0, l.value - l.monthly_principal);
        } else {
          const r = (l.rate || 0) / 12 / 100;
          newBalance = r > 0
            ? Math.max(0, l.value * (1 + r) - l.monthly)
            : Math.max(0, l.value - l.monthly);
        }
        return { id: l.id, newBalance };
      });

    if (updates.length === 0) return;

    (async () => {
      for (const { id, newBalance } of updates) {
        await supabase.from("liabilities").update({
          value: newBalance,
          last_auto_payment: curMonth,
        }).eq("id", id);
        didUpdate = true;
      }
      if (didUpdate) reload();
    })();
  }, [liabilities]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 新增 / 編輯 ──────────────────────────────────────────
  const openAdd  = () => { setForm(emptyLiab); setModal("add"); };
  const openEdit = l => {
    setForm({
      name:             l.name,
      value:            String(l.value            || ""),
      rate:             String(l.rate             || ""),
      due_day:          String(l.due_day          || ""),
      category:         l.category,
      amortization_type: l.amortization_type     || "annuity",
      monthly:          String(l.monthly          || ""),
      monthly_principal: String(l.monthly_principal || ""),
    });
    setModal(l);
  };

  const save = async () => {
    try {
      setSaving(true);
      const isAnnuity = form.amortization_type === "annuity";
      const data = {
        name:              form.name,
        value:             parseFloat(form.value)             || 0,
        rate:              parseFloat(form.rate)              || 0,
        due_day:           parseInt(form.due_day)             || 0,
        category:          form.category,
        amortization_type: form.amortization_type,
        monthly:           isAnnuity ? (parseFloat(form.monthly) || 0) : 0,
        monthly_principal: !isAnnuity ? (parseFloat(form.monthly_principal) || 0) : 0,
      };
      const result = modal === "add"
        ? await supabase.from("liabilities").insert(data)
        : await supabase.from("liabilities").update(data).eq("id", modal.id);

      if (result.error) throw new Error(result.error.message);
      setSaving(false); setModal(null); reload();
    } catch (err) {
      setSaving(false);
      alert(`⚠️ ${err.message || "儲存失敗"}`);
    }
  };

  const del = async id => {
    if (!window.confirm("確定刪除？")) return;
    const result = await supabase.from("liabilities").delete().eq("id", id);
    if (result.error) alert(`⚠️ 刪除失敗: ${result.error.message}`);
    else reload();
  };

  // 手動補還款（edge case）
  const manualPay = async l => {
    const pm = l.amortization_type === "principal"
      ? l.monthly_principal
      : l.monthly;
    if (!window.confirm(`手動補還款 NT$${fmt(Math.round(pm))}？`)) return;
    const r = (l.rate || 0) / 12 / 100;
    const newBalance = l.amortization_type === "principal"
      ? Math.max(0, l.value - l.monthly_principal)
      : Math.max(0, r > 0 ? l.value * (1 + r) - l.monthly : l.value - l.monthly);
    const result = await supabase.from("liabilities").update({
      value: newBalance,
      last_auto_payment: thisMonthKey(),
    }).eq("id", l.id);
    if (result.error) alert(`⚠️ ${result.error.message}`);
    else reload();
  };

  // ── 衍生值 ───────────────────────────────────────────────
  const today     = new Date().getDate();
  const daysUntilDue = dueDay => {
    if (dueDay === today) return 0;
    if (dueDay > today)  return dueDay - today;
    const dim = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    return dim - today + dueDay;
  };

  const total        = liabilities.reduce((s, l) => s + l.value, 0);
  const monthlyTotal = liabilities.reduce((s, l) => s + effectiveMonthly(l), 0);
  const curMonth     = thisMonthKey().slice(0, 7);

  return (
    <div className="wos-fade" style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── KPI ──────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <KPI label="總負債"    value={total}        color={C.red} />
        <KPI label="月還款合計" value={monthlyTotal} color={C.gold} />
      </div>

      <SectionHeader title="負債清單" right={<Btn onClick={openAdd} color={C.red}>＋ 新增負債</Btn>} />

      {liabilities.length === 0 ? (
        <div style={{
          background: C.surface, border: `1px solid ${C.border}`,
          borderRadius: 12, padding: "24px 18px", textAlign: "center",
        }}>
          <div style={{ color: C.textMuted, fontSize: 12 }}>✨ 目前無任何負債</div>
          <div style={{ color: C.textDim,   fontSize: 11, marginTop: 4 }}>這很棒！繼續保持</div>
        </div>
      ) : liabilities.map(l => {
        const isDueToday  = l.due_day === today;
        const isDueSoon   = !isDueToday && l.due_day > 0 && daysUntilDue(l.due_day) <= 3;
        const isPaidThisMonth = l.last_auto_payment && l.last_auto_payment.slice(0,7) === curMonth;
        const isAnnuity   = l.amortization_type !== "principal";
        const effMonthly  = effectiveMonthly(l);
        // 本月尚未自動還但扣款日已過
        const needsManual = !isPaidThisMonth && l.due_day > 0 && today >= l.due_day;

        return (
          <div key={l.id} className="wos-row" style={{
            background: C.surface,
            border:     `1px solid ${isDueToday ? C.red : isDueSoon ? C.gold : C.border}`,
            borderLeft: `3px solid ${isDueToday ? C.red : isDueSoon ? C.gold : C.red + "88"}`,
            borderRadius: 12, padding: "14px 18px",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{l.name}</span>
                  <Badge text={l.category}                          color={C.red} />
                  <Badge text={AMORT_LABEL[l.amortization_type] || "等額本利"} color={C.blue} />
                  {l.rate > 0   && <Badge text={`${l.rate}%`}        color={C.orange} />}
                  {isDueToday   && <Badge text="今日扣款"              color={C.red} />}
                  {isDueSoon    && <Badge text={`${l.due_day}日扣款`} color={C.gold} />}
                  {isPaidThisMonth && <Badge text="本月已還" color={C.accent} />}
                </div>
                <div style={{ color: C.textMuted, fontSize: 11, display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {isAnnuity ? (
                    <>
                      <span>月付 NT${fmt(Math.round(effMonthly))}</span>
                      {l.rate > 0 && <span style={{ color: C.textDim }}>
                        其中利息 NT${fmt(Math.round(l.value * (l.rate/12/100)))}
                      </span>}
                    </>
                  ) : (
                    <>
                      <span>本金 NT${fmt(l.monthly_principal)}</span>
                      <span>＋ 利息 NT${fmt(Math.round(l.value * (l.rate/12/100)))}</span>
                      <span style={{ color: C.gold }}>= 本月 NT${fmt(Math.round(effMonthly))}</span>
                    </>
                  )}
                  {l.due_day > 0 && <span>每月{l.due_day}日</span>}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                <div style={{ color: C.red, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 15 }}>
                  NT${fmt(l.value)}
                </div>
                {needsManual && (
                  <Btn onClick={() => manualPay(l)} color={C.gold} small>補還款</Btn>
                )}
                <Btn onClick={() => openEdit(l)} outline small>編輯</Btn>
                <Btn onClick={() => del(l.id)}   color={C.red} outline small>刪除</Btn>
              </div>
            </div>
          </div>
        );
      })}

      {/* ── 還款時間軸 ──────────────────────────────────────── */}
      {liabilities.length > 0 && <PayoffTimeline liabilities={liabilities} />}

      {/* ── 新增 / 編輯 Modal ────────────────────────────── */}
      {modal && (
        <Modal title={modal === "add" ? "新增負債" : "編輯負債"} onClose={() => setModal(null)}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
            <Sel label="類別"
              value={form.category}
              onChange={set("category")}
              options={LIAB_CATS} />
            <Inp label="名稱"
              value={form.name}
              onChange={set("name")}
              placeholder="e.g. 信貸" />
            <Inp label="目前餘額 (NT$)" type="number"
              value={form.value}
              onChange={set("value")}
              placeholder="0" />
            <Inp label="年利率 (%)" type="number"
              value={form.rate}
              onChange={set("rate")}
              placeholder="0" />
            <Sel label="攤還方式"
              value={form.amortization_type}
              onChange={set("amortization_type")}
              options={AMORT_TYPES}
              labelMap={AMORT_LABEL} />
            <Inp label="扣款日 (幾號)" type="number"
              value={form.due_day}
              onChange={set("due_day")}
              placeholder="e.g. 5" />

            {form.amortization_type === "annuity" ? (
              <Inp label="固定月付 (NT$)" type="number"
                value={form.monthly}
                onChange={set("monthly")}
                placeholder="本金＋利息合計" />
            ) : (
              <Inp label="每月固定本金 (NT$)" type="number"
                value={form.monthly_principal}
                onChange={set("monthly_principal")}
                placeholder="月攤本金" />
            )}

            {/* 預覽本月有效月付 */}
            {form.amortization_type === "principal" && form.monthly_principal && form.value && (
              <div style={{
                gridColumn: "1 / -1",
                background: C.surface3, borderRadius: 8, padding: "8px 12px",
                fontSize: 11, color: C.textMuted,
              }}>
                本月有效月付 = 本金 {fmt(parseFloat(form.monthly_principal))} ＋ 利息{" "}
                {fmt(Math.round(parseFloat(form.value) * (parseFloat(form.rate)||0) / 12 / 100))}
                {" "}= <span style={{ color: C.gold, fontWeight: 700 }}>
                  NT${fmt(Math.round(
                    parseFloat(form.monthly_principal) +
                    parseFloat(form.value) * (parseFloat(form.rate)||0) / 12 / 100
                  ))}
                </span>
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Btn onClick={() => setModal(null)} outline>取消</Btn>
            <Btn onClick={save} color={C.red}>{saving ? "儲存中…" : "確認儲存"}</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}
