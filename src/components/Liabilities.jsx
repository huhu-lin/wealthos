// ============================================================
// Liabilities.jsx — 負債管理頁
// 功能：
//   - 顯示所有負債（信貸、信用卡、房貸等）
//   - 扣款日預警：今日扣款（紅色）、3日內即將扣款（金色）
//   - 支援月還款紀錄（按「還款」按鈕直接扣除餘額）
//   - 新增 / 編輯 / 刪除
// ============================================================

import { useState } from "react";
import { supabase } from "../supabase";
import { C, fmt } from "../constants/theme";
import KPI from "./ui/KPI";
import { Inp, Sel, Btn } from "./ui/FormControls";
import Modal from "./ui/Modal";
import { Badge, SectionHeader } from "./ui/Badge";

// 負債類別選項
const LIAB_CATS = ["長期負債", "質押", "信用卡", "房貸", "其他"];
const emptyLiab = { name: "", value: "", monthly: "", rate: "", due_day: "", category: "長期負債" };

export default function Liabilities({ liabilities, reload }) {
  const [modal,  setModal]  = useState(null);
  const [form,   setForm]   = useState(emptyLiab);
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState(null);

  const set = k => v => setForm(p => ({ ...p, [k]: v }));

  const openAdd  = () => { setForm(emptyLiab); setModal("add"); };
  const openEdit = l => {
    setForm({
      name: l.name, value: String(l.value || ""), monthly: String(l.monthly || ""),
      rate: String(l.rate || ""), due_day: String(l.due_day || ""), category: l.category,
    });
    setModal(l);
  };

  const save = async () => {
    try {
      setSaving(true);
      setError(null);
      const data = {
        name: form.name,
        value:   parseFloat(form.value)   || 0,
        monthly: parseFloat(form.monthly) || 0,
        rate:    parseFloat(form.rate)    || 0,
        due_day: parseInt(form.due_day)   || 0,
        category: form.category,
      };
      let result;
      if (modal === "add") result = await supabase.from("liabilities").insert(data);
      else                 result = await supabase.from("liabilities").update(data).eq("id", modal.id);

      if (result.error) throw new Error(result.error.message);
      setSaving(false); setModal(null); reload();
    } catch (err) {
      setSaving(false);
      setError(err.message || "儲存失敗");
      alert(`⚠️ ${err.message || "儲存失敗"}`);
    }
  };

  const del = async id => {
    if (!window.confirm("確定刪除？")) return;
    try {
      const result = await supabase.from("liabilities").delete().eq("id", id);
      if (result.error) throw new Error(result.error.message);
      reload();
    } catch (err) {
      alert(`⚠️ 刪除失敗: ${err.message}`);
    }
  };

  // ── 月還款（含錯誤處理）──────────────────────────────────
  const processPayment = async l => {
    if (!window.confirm(`確認本月還款 NT$${fmt(l.monthly)}？`)) return;
    try {
      const result = await supabase.from("liabilities").update({ value: l.value - l.monthly }).eq("id", l.id);
      if (result.error) throw new Error(result.error.message);
      reload();
    } catch (err) {
      alert(`⚠️ 還款失敗: ${err.message}`);
    }
  };

  const today        = new Date().getDate(); // 今天幾號（用於扣款日預警）
  // C-012: 計算距下次扣款日的天數（處理跨月情境）
  // 例：今天29日，扣款日2日（下個月）→ daysUntilDue = 3，不漏警
  const daysUntilDue = (dueDay) => {
    if (dueDay === today) return 0;
    if (dueDay > today) return dueDay - today;          // 本月還沒到
    const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    return daysInMonth - today + dueDay;                 // 跨月到下個月
  };
  const total        = liabilities.reduce((s, l) => s + l.value,   0);
  const monthlyTotal = liabilities.reduce((s, l) => s + l.monthly, 0);

  return (
    <div className="wos-fade" style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── KPI：總負債 + 每月還款合計 ──────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <KPI label="總負債"    value={total}        color={C.red} />
        <KPI label="月還款合計" value={monthlyTotal} color={C.gold} />
      </div>

      <SectionHeader title="負債清單" right={<Btn onClick={openAdd} color={C.red}>＋ 新增負債</Btn>} />

      {liabilities.length === 0 ? (
        <div style={{
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          padding: "24px 18px",
          textAlign: "center",
        }}>
          <div style={{ color: C.textMuted, fontSize: 12 }}>
            ✨ 目前無任何負債
          </div>
          <div style={{ color: C.textDim, fontSize: 11, marginTop: 4 }}>
            這很棒！繼續保持
          </div>
        </div>
      ) : liabilities.map(l => {
        // 扣款日預警判斷（C-012: 使用 daysUntilDue 支援跨月計算）
        const isDueToday = l.due_day === today;
        const isDueSoon  = !isDueToday && l.due_day > 0 && daysUntilDue(l.due_day) <= 3;

        return (
          <div key={l.id} className="wos-row" style={{
            background: C.surface,
            // 邊框顏色：今日扣款=紅，即將=金，一般=預設
            border: `1px solid ${isDueToday ? C.red : isDueSoon ? C.gold : C.border}`,
            borderLeft: `3px solid ${isDueToday ? C.red : isDueSoon ? C.gold : C.red + "88"}`,
            borderRadius: 12,
            padding: "14px 18px",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{l.name}</span>
                  <Badge text={l.category}         color={C.red} />
                  {l.rate > 0    && <Badge text={`${l.rate}%`}           color={C.orange} />}
                  {isDueToday    && <Badge text="今日扣款"                 color={C.red} />}
                  {isDueSoon     && <Badge text={`${l.due_day}日扣款`}    color={C.gold} />}
                </div>
                <div style={{ color: C.textMuted, fontSize: 11 }}>
                  {l.monthly > 0  && `月還款 NT$${fmt(l.monthly)}`}
                  {l.due_day > 0  && ` ｜ 每月${l.due_day}日`}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                <div style={{ color: C.red, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 15 }}>
                  NT${fmt(l.value)}
                </div>
                {l.monthly > 0 && <Btn onClick={() => processPayment(l)} color={C.gold} small>還款</Btn>}
                <Btn onClick={() => openEdit(l)} outline small>編輯</Btn>
                <Btn onClick={() => del(l.id)}   color={C.red} outline small>刪除</Btn>
              </div>
            </div>
          </div>
        );
      })}

      {modal && (
        <Modal title={modal === "add" ? "新增負債" : "編輯負債"} onClose={() => setModal(null)}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
            <Sel label="類別"        value={form.category} onChange={set("category")} options={LIAB_CATS} />
            <Inp label="名稱"        value={form.name}     onChange={set("name")}     placeholder="e.g. 信貸" />
            <Inp label="餘額 (NT$)"  type="number" value={form.value}   onChange={set("value")}   placeholder="0" />
            <Inp label="月還款 (NT$)" type="number" value={form.monthly} onChange={set("monthly")} placeholder="0" />
            <Inp label="年利率 (%)"  type="number" value={form.rate}    onChange={set("rate")}    placeholder="0" />
            <Inp label="扣款日 (幾號)" type="number" value={form.due_day} onChange={set("due_day")} placeholder="e.g. 15" />
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
