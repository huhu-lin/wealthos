// ============================================================
// CryptoAccount.jsx — 加密貨幣帳戶管理頁
// 功能：
//   - 顯示加密貨幣持倉列表（台幣計價）
//   - 新增 / 編輯 / 刪除持倉
//   - 一鍵更新幣價（CoinGecko 公開 API，不需 token）
// ============================================================

import { useState } from "react";
import { supabase } from "../supabase";
import { C, fmt } from "../constants/theme";
import { fetchCryptoPrice } from "../utils/priceApi";
import KPI from "./ui/KPI";
import { Inp, Sel, Btn } from "./ui/FormControls";
import Modal from "./ui/Modal";
import { Badge, SectionHeader } from "./ui/Badge";

// 支援的幣種 ID（CoinGecko 格式）
const COIN_IDS = {
  "BTC": "bitcoin", "ETH": "ethereum", "BNB": "binancecoin",
  "SOL": "solana",  "USDT": "tether",  "USDC": "usd-coin",
};

const emptyCrypto = { name: "", coin_id: "", amount: "", cost: "", note: "" };

export default function CryptoAccount({ assets, reload }) {
  const [modal,    setModal]    = useState(null);
  const [form,     setForm]     = useState(emptyCrypto);
  const [saving,   setSaving]   = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetchMsg, setFetchMsg] = useState("");

  const set = k => v => setForm(p => ({ ...p, [k]: v }));

  const openAdd  = () => { setForm(emptyCrypto); setModal("add"); };
  const openEdit = a => {
    setForm({ name: a.name, coin_id: a.coin_id || "", amount: String(a.shares || ""), cost: String(a.cost || ""), note: a.note || "" });
    setModal(a);
  };

  // ── 儲存加密貨幣持倉 ─────────────────────────────────────
  // 新增時 value_twd=0，需等更新幣價後才有市值
  const save = async () => {
    setSaving(true);
    const amount = parseFloat(form.amount) || 0;
    const cost   = parseFloat(form.cost)   || 0;
    const data = {
      account: "crypto", type: "crypto",
      name: form.name, coin_id: form.coin_id,
      shares: amount, cost, cost_total: cost * amount,
      value_twd: 0, note: form.note,
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

  // ── 一鍵更新幣價（CoinGecko）────────────────────────────
  const refreshPrices = async () => {
    setFetching(true); setFetchMsg("抓取幣價中…");
    for (const a of assets.filter(a => a.coin_id)) {
      const price = await fetchCryptoPrice(a.coin_id);
      if (price) {
        await supabase.from("assets").update({ price_twd: price, value_twd: price * (a.shares || 0) }).eq("id", a.id);
        setFetchMsg(`✅ ${a.name}: NT$${fmt(price)}`);
      }
    }
    setFetching(false); setFetchMsg("✅ 更新完成");
    setTimeout(() => setFetchMsg(""), 3000);
    reload();
  };

  const total = assets.reduce((s, x) => s + x.value_twd, 0);

  return (
    <div className="wos-fade" style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      <KPI label="加密貨幣總值" value={total} color={C.gold} />

      <SectionHeader
        title="持倉"
        right={<>
          {fetchMsg && <span style={{ color: C.accent, fontSize: 12 }}>{fetchMsg}</span>}
          <Btn onClick={refreshPrices} color={C.gold} outline disabled={fetching}>🔄 更新幣價</Btn>
          <Btn onClick={openAdd}>＋ 新增</Btn>
        </>}
      />

      {/* 空狀態提示 */}
      {assets.length === 0 && (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 28, textAlign: "center" }}>
          <div style={{ color: C.textMuted, fontSize: 13 }}>尚無加密貨幣持倉</div>
        </div>
      )}

      {/* 持倉列表 */}
      {assets.map(a => {
        const ct  = a.cost_total || (a.cost || 0) * (a.shares || 0);
        const pnl = ct > 0 ? a.value_twd - ct : null;
        const pp  = ct > 0 ? pnl / ct * 100  : null;
        return (
          <div key={a.id} className="wos-row" style={{
            background: C.surface, border: `1px solid ${C.border}`,
            borderLeft: `3px solid ${C.gold}`, borderRadius: 12,
            padding: "14px 18px",
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 5 }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{a.name}</span>
                {a.coin_id && <Badge text={a.coin_id} color={C.gold} />}
              </div>
              <div style={{ color: C.textMuted, fontSize: 11 }}>
                數量 {a.shares}
                {a.cost > 0 && ` ｜ 成本 NT$${fmt(a.cost)}`}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ textAlign: "right" }}>
                <div style={{ color: C.gold, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 15 }}>
                  NT${fmt(a.value_twd)}
                </div>
                {pnl !== null && (
                  <div style={{ fontSize: 11, color: pnl >= 0 ? C.accent : C.red, fontWeight: 600 }}>
                    {pnl >= 0 ? "▲" : "▼"} NT${fmt(Math.abs(pnl))} ({pp >= 0 ? "+" : ""}{pp.toFixed(1)}%)
                  </div>
                )}
              </div>
              <Btn onClick={() => openEdit(a)} outline small>編輯</Btn>
              <Btn onClick={() => del(a.id)}   color={C.red} outline small>刪除</Btn>
            </div>
          </div>
        );
      })}

      {modal && (
        <Modal title={modal === "add" ? "新增加密貨幣" : "編輯加密貨幣"} onClose={() => setModal(null)}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
            <Inp label="名稱"      value={form.name}    onChange={set("name")}    placeholder="e.g. Bitcoin" />
            <Sel label="幣種 ID"   value={form.coin_id} onChange={set("coin_id")} options={["bitcoin","ethereum","binancecoin","solana","tether","usd-coin"]} />
            <Inp label="數量"      type="number" value={form.amount} onChange={set("amount")} placeholder="0" />
            <Inp label="成本 (NT$/個)" type="number" value={form.cost} onChange={set("cost")} placeholder="0" />
            <Inp label="備註"      value={form.note}    onChange={set("note")}    placeholder="選填" />
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
