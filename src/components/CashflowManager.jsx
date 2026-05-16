// ============================================================
// CashflowManager.jsx — 現金流月度紀錄管理
// 功能：
//   - 列出近 12 個月薪資 / 獎金 / 固定支出 / 信用卡 / 備註
//   - 新增本月（預填上月的固定支出）
//   - 編輯 / 刪除任一月
//   - 寫入 Supabase cashflow 表（VIEW cashflow_summary 自動衍生 cc_total/net_savings）
// ============================================================

import { useState } from "react";
import { supabase } from "../supabase";
import { C, fmt } from "../constants/theme";
import { Inp, Btn } from "./ui/FormControls";
import Modal from "./ui/Modal";

// 月份字串 YYYY-MM-01
function monthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-01`;
}

const emptyForm = {
  month: monthKey(),
  salary: "", bonus: "", fixed: "", cc_tsb: "", cc_fub: "", note: "",
};

export default function CashflowManager({ cashflow = [], reload }) {
  const [modal,  setModal]  = useState(null); // null | "add" | row object
  const [form,   setForm]   = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const set = k => v => setForm(p => ({ ...p, [k]: v }));

  // 新增本月：預填上月固定支出
  const openAdd = () => {
    const last = cashflow[0]; // 已按 month DESC
    setForm({
      ...emptyForm,
      month: monthKey(),
      fixed: last ? String(last.fixed || "") : "",
    });
    setModal("add");
  };

  const openEdit = row => {
    setForm({
      month:  row.month,
      salary: String(row.salary  || ""),
      bonus:  String(row.bonus   || ""),
      fixed:  String(row.fixed   || ""),
      cc_tsb: String(row.cc_tsb  || ""),
      cc_fub: String(row.cc_fub  || ""),
      note:   row.note || "",
    });
    setModal(row);
  };

  const save = async () => {
    try {
      setSaving(true);
      const data = {
        month:  form.month,
        salary: parseFloat(form.salary) || 0,
        bonus:  parseFloat(form.bonus)  || 0,
        fixed:  parseFloat(form.fixed)  || 0,
        cc_tsb: parseFloat(form.cc_tsb) || 0,
        cc_fub: parseFloat(form.cc_fub) || 0,
        note:   form.note || null,
      };
      // 用 upsert on (month, user_id)，更新時不變更 user_id
      const result = await supabase.from("cashflow").upsert(data, {
        onConflict: "month,user_id",
      });
      if (result.error) throw new Error(result.error.message);
      setSaving(false); setModal(null); reload();
    } catch (err) {
      setSaving(false);
      alert(`⚠️ ${err.message || "儲存失敗"}`);
    }
  };

  const del = async row => {
    if (!window.confirm(`刪除 ${row.month.slice(0,7)} 的紀錄？`)) return;
    const result = await supabase.from("cashflow").delete().eq("month", row.month);
    if (result.error) alert(`⚠️ ${result.error.message}`);
    else reload();
  };

  const ccTotal     = (r) => Number(r.cc_tsb || 0) + Number(r.cc_fub || 0);
  const netSavings  = (r) => Number(r.salary||0) + Number(r.bonus||0) - Number(r.fixed||0) - ccTotal(r);
  const monthLabel  = (m) => `${m.slice(0,4)}/${m.slice(5,7)}`;

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div>
          <span style={{ fontWeight: 700, fontSize: 13, color: C.text }}>現金流紀錄</span>
          <span style={{ fontSize: 11, color: C.textMuted, marginLeft: 8 }}>
            共 {cashflow.length} 月 ｜ 用於 FIRE 儀表板的實際儲蓄計算
          </span>
        </div>
        <Btn onClick={openAdd} color={C.accent} small>＋ 新增本月</Btn>
      </div>

      {cashflow.length === 0 ? (
        <div style={{ color: C.textMuted, fontSize: 11, textAlign: "center", padding: "16px 0" }}>
          尚無紀錄，點「新增本月」開始
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 360, overflowY: "auto" }}>
          {cashflow.map(r => {
            const net = netSavings(r);
            return (
              <div key={r.month} style={{
                background: C.surface3,
                border: `1px solid ${C.border}`,
                borderRadius: 8, padding: "8px 12px",
                display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
              }}>
                <div style={{ width: 52, flexShrink: 0, fontWeight: 700, fontSize: 12, color: C.blue }}>
                  {monthLabel(r.month)}
                </div>
                <div style={{ flex: 1, minWidth: 0, display: "flex", gap: 10, fontSize: 11, flexWrap: "wrap", color: C.textMuted }}>
                  <span>薪 <span style={{ color: C.accent, fontWeight: 600 }}>{fmt(r.salary)}</span></span>
                  {r.bonus > 0 && <span>獎 <span style={{ color: C.gold, fontWeight: 600 }}>{fmt(r.bonus)}</span></span>}
                  <span>固 <span style={{ color: C.text }}>{fmt(r.fixed)}</span></span>
                  <span>CC <span style={{ color: C.red }}>{fmt(ccTotal(r))}</span>
                    {r.cc_fub > 0 && <span style={{ color: C.textDim, fontSize: 9 }}> (新{fmt(r.cc_tsb)}/富{fmt(r.cc_fub)})</span>}
                  </span>
                  <span>結餘 <span style={{ color: net >= 0 ? C.accent : C.red, fontWeight: 700 }}>
                    {net >= 0 ? "+" : "-"}{fmt(Math.abs(net))}
                  </span></span>
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <Btn onClick={() => openEdit(r)} outline small>編輯</Btn>
                  <Btn onClick={() => del(r)} color={C.red} outline small>刪</Btn>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Modal ─────────────────────────────────────────── */}
      {modal && (
        <Modal title={modal === "add" ? "新增現金流月度" : `編輯 ${monthLabel(form.month)}`} onClose={() => setModal(null)}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
            <Inp label="月份 (YYYY-MM-01)" type="text"
              value={form.month} onChange={set("month")}
              placeholder="2026-05-01" />
            <Inp label="薪資 (NT$)" type="number"
              value={form.salary} onChange={set("salary")} placeholder="0" />
            <Inp label="獎金 (NT$)" type="number"
              value={form.bonus} onChange={set("bonus")} placeholder="年終 / 留任 / 三節" />
            <Inp label="固定支出 (NT$)" type="number"
              value={form.fixed} onChange={set("fixed")} placeholder="房租水電保險" />
            <Inp label="信用卡 - 台新 (NT$)" type="number"
              value={form.cc_tsb} onChange={set("cc_tsb")} placeholder="0" />
            <Inp label="信用卡 - 富邦 (NT$)" type="number"
              value={form.cc_fub} onChange={set("cc_fub")} placeholder="0" />
            <div style={{ gridColumn: "1 / -1" }}>
              <Inp label="備註（選填）" type="text"
                value={form.note} onChange={set("note")} placeholder="e.g. 大額消費月 / 電腦採購" />
            </div>
          </div>

          {/* 即時結餘預覽 */}
          {(form.salary || form.bonus) && (() => {
            const s = parseFloat(form.salary)||0, b = parseFloat(form.bonus)||0;
            const f = parseFloat(form.fixed)||0;
            const cc = (parseFloat(form.cc_tsb)||0) + (parseFloat(form.cc_fub)||0);
            const net = s + b - f - cc;
            return (
              <div style={{
                background: C.surface3, borderRadius: 8, padding: "10px 12px",
                marginBottom: 12, fontSize: 12, color: C.textMuted,
              }}>
                收入 {fmt(s+b)} − 固定 {fmt(f)} − 信用卡 {fmt(cc)} =
                <span style={{ color: net >= 0 ? C.accent : C.red, fontWeight: 700, marginLeft: 6 }}>
                  {net >= 0 ? "+" : "−"}NT${fmt(Math.abs(net))} 結餘
                </span>
              </div>
            );
          })()}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Btn onClick={() => setModal(null)} outline>取消</Btn>
            <Btn onClick={save} color={C.accent}>{saving ? "儲存中…" : "確認儲存"}</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}
