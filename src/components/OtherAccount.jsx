// ============================================================
// OtherAccount.jsx — 其他資產管理頁
// 功能：
//   - 管理非股票/加密類資產（例：不動產、貴金屬、儲蓄險）
//   - 手動輸入估值，無自動抓價功能
//   - 新增 / 編輯 / 刪除
// ============================================================

import { useState } from "react";
import { supabase } from "../supabase";
import { C, fmt } from "../constants/theme";
import KPI from "./ui/KPI";
import { Inp, Btn } from "./ui/FormControls";
import Modal from "./ui/Modal";
import { SectionHeader } from "./ui/Badge";

const emptyOther = { name: "", value_twd: "", note: "" };

export default function OtherAccount({ assets, reload }) {
  const [modal,  setModal]  = useState(null);
  const [form,   setForm]   = useState(emptyOther);
  const [saving, setSaving] = useState(false);

  const set = k => v => setForm(p => ({ ...p, [k]: v }));

  const openAdd  = () => { setForm(emptyOther); setModal("add"); };
  const openEdit = a => {
    setForm({ name: a.name, value_twd: String(a.value_twd || ""), note: a.note || "" });
    setModal(a);
  };

  const save = async () => {
    setSaving(true);
    const data = {
      account: "other", type: "other",
      name: form.name,
      value_twd: parseFloat(form.value_twd) || 0,
      note: form.note,
    };
    if (modal === "add") await supabase.from("assets").insert(data);
    else                 await supabase.from("assets").update(data).eq("id", modal.id);
    setSaving(false); setModal(null); reload();
  };

  const del = async id => {
    if (!window.confirm("確定刪除？")) return;
    await supabase.from("assets").delete().eq("id", id);
    reload();
  };

  const total = assets.reduce((s, x) => s + x.value_twd, 0);

  return (
    <div className="wos-fade" style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* 標題列 + KPI 合併（其他資產較少，合在一起比較緊湊）*/}
      <SectionHeader
        title="其他資產"
        right={<>
          <KPI label="其他資產總值" value={total} color={C.purple} />
          <Btn onClick={openAdd}>＋ 新增</Btn>
        </>}
      />

      {/* 資產列表 */}
      {assets.map(a => (
        <div key={a.id} className="wos-row" style={{
          background: C.surface, border: `1px solid ${C.border}`,
          borderLeft: `3px solid ${C.purple}`, borderRadius: 12,
          padding: "14px 18px",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{a.name}</div>
            <div style={{ color: C.textMuted, fontSize: 11, marginTop: 3 }}>{a.note}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ color: C.purple, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 15 }}>
              NT${fmt(a.value_twd)}
            </div>
            <Btn onClick={() => openEdit(a)} outline small>編輯</Btn>
            <Btn onClick={() => del(a.id)}   color={C.red} outline small>刪除</Btn>
          </div>
        </div>
      ))}

      {modal && (
        <Modal title={modal === "add" ? "新增其他資產" : "編輯其他資產"} onClose={() => setModal(null)}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
            <Inp label="名稱"      value={form.name}      onChange={set("name")}      placeholder="e.g. 台北市公寓" />
            <Inp label="估值 (NT$)" type="number" value={form.value_twd} onChange={set("value_twd")} placeholder="0" />
            <Inp label="備註"      value={form.note}      onChange={set("note")}      placeholder="選填" />
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Btn onClick={() => setModal(null)} outline>取消</Btn>
            <Btn onClick={save}>{saving ? "儲存中…" : "確認儲存"}</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}
