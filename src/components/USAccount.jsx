// ============================================================
// USAccount.jsx — 美股帳戶管理頁
// 功能：
//   - 顯示美股 ETF / 股票持倉（美元 + 台幣雙幣顯示）
//   - 顯示美金現金
//   - 新增 / 編輯 / 刪除（Modal 表單）
//   - 一鍵更新股價（透過 proxy API → FinMind）
//   - 所有台幣換算依傳入的 usdRate 即時計算
// ============================================================

import { useState } from "react";
import { supabase } from "../supabase";
import { C, LEVERAGE_MAP, fmt } from "../constants/theme";
import { fetchUSPrice } from "../utils/priceApi";
import KPI from "./ui/KPI";
import { Inp, Sel, Btn } from "./ui/FormControls";
import Modal from "./ui/Modal";
import { Badge, AllocBar, SectionHeader } from "./ui/Badge";

const emptyUS = {
  type: "etf", name: "", ticker: "", shares: "",
  price_usd: "", cost: "", value_usd: "", target: "",
  leverage_ratio: "1", note: "",
};

export default function USAccount({ assets, usdRate, reload }) {
  const [modal,    setModal]    = useState(null);
  const [form,     setForm]     = useState(emptyUS);
  const [saving,   setSaving]   = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetchMsg, setFetchMsg] = useState("");

  const set = k => v => setForm(p => ({ ...p, [k]: v }));

  // ── 股數 / 美元價格聯動計算美元市值 ──────────────────────
  const handleChange = (k, v) => {
    const next   = { ...form, [k]: v };
    const shares = parseFloat(k === "shares"    ? v : next.shares)    || 0;
    const price  = parseFloat(k === "price_usd" ? v : next.price_usd) || 0;
    if (shares > 0 && price > 0) next.value_usd = String((shares * price).toFixed(2));
    setForm(next);
  };

  const openAdd  = () => { setForm(emptyUS); setModal("add"); };
  const openEdit = a => {
    setForm({
      type: a.type || "etf", name: a.name, ticker: a.ticker || "",
      shares: String(a.shares || ""), price_usd: String(a.price_usd || ""),
      cost: String(a.cost || ""), value_usd: String(a.value_usd || ""),
      target: String(a.target > 0 ? a.target * 100 : ""),
      leverage_ratio: String(a.leverage_ratio || 1),
      note: a.note || "",
    });
    setModal(a);
  };

  // ── 儲存（美元換算台幣後寫入）───────────────────────────
  const save = async () => {
    setSaving(true);
    const shares    = parseFloat(form.shares)    || 0;
    const cost      = parseFloat(form.cost)      || 0;
    const value_usd = parseFloat(form.value_usd) || 0;
    const data = {
      account: "us", type: form.type, name: form.name, ticker: form.ticker,
      shares, price_usd: parseFloat(form.price_usd) || 0,
      cost, cost_total: cost * shares * usdRate,   // 成本換算台幣
      value_usd, value_twd: value_usd * usdRate,   // 市值換算台幣
      target: (parseFloat(form.target) || 0) / 100,
      leverage_ratio: parseFloat(form.leverage_ratio) || 1,
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

  // ── 一鍵更新美股股價 ─────────────────────────────────────
  const refreshPrices = async () => {
    setFetching(true); setFetchMsg("抓取股價中…");
    for (const a of assets.filter(a => a.ticker && a.type === "etf")) {
      const price = await fetchUSPrice(a.ticker);
      if (price) {
        const value_usd = price * (a.shares || 0);
        await supabase.from("assets").update({
          price_usd: price, value_usd, value_twd: value_usd * usdRate,
        }).eq("id", a.id);
        setFetchMsg(`✅ ${a.ticker}: $${price.toFixed(2)}`);
      }
    }
    setFetching(false); setFetchMsg("✅ 更新完成");
    setTimeout(() => setFetchMsg(""), 3000);
    reload();
  };

  const etfs     = assets.filter(a => a.type === "etf");
  const cash     = assets.filter(a => a.type === "cash");
  const total    = assets.reduce((s, x) => s + (x.value_twd || 0), 0);
  const totalUSD = assets.reduce((s, x) => s + (x.value_usd || x.value_twd / usdRate), 0);

  // ── 損益計算（以台幣計）────────────────────────────────
  const renderPnl = a => {
    const ct = a.cost_total || (a.cost || 0) * (a.shares || 0) * usdRate;
    if (!ct) return null;
    const pnl = a.value_twd - ct;
    const pp  = pnl / ct * 100;
    return (
      <div style={{ fontSize: 11, color: pnl >= 0 ? C.accent : C.red, fontWeight: 600 }}>
        {pnl >= 0 ? "▲" : "▼"} NT${fmt(Math.abs(pnl))} ({pp >= 0 ? "+" : ""}{pp.toFixed(1)}%)
      </div>
    );
  };

  return (
    <div className="wos-fade" style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── KPI 摘要（台幣 + 美元 + 匯率）──────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
        <KPI label="美股總值(TWD)" value={total}                  color={C.blue} />
        <KPI label="美股總值(USD)" value={totalUSD.toFixed(0)} prefix="$" color={C.blue} />
        <KPI label="匯率 USD/TWD"  value={usdRate.toFixed(2)}  prefix="" color={C.textMuted} />
      </div>

      {/* ── ETF / 股票 ───────────────────────────────────── */}
      <SectionHeader
        title="ETF / 股票"
        right={<>
          {fetchMsg && <span style={{ color: C.accent, fontSize: 12 }}>{fetchMsg}</span>}
          <Btn onClick={refreshPrices} color={C.blue} outline disabled={fetching}>🔄 更新股價</Btn>
          <Btn onClick={openAdd}>＋ 新增</Btn>
        </>}
      />

      {etfs.map(a => {
        const acctPct = total > 0 ? a.value_twd / total * 100 : 0;
        const tgtPct  = (a.target || 0) * 100;
        return (
          <div key={a.id} className="wos-row" style={{
            background: C.surface, border: `1px solid ${C.border}`,
            borderLeft: `3px solid ${C.blue}`, borderRadius: 12, padding: "14px 18px",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 5 }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{a.name}</span>
                  {a.ticker && <Badge text={a.ticker} color={C.blue} />}
                  {(a.leverage_ratio || 1) > 1 && <Badge text={`${a.leverage_ratio}x`} color={C.orange} />}
                </div>
                <div style={{ color: C.textMuted, fontSize: 11 }}>
                  {a.shares > 0     && `${a.shares} 股`}
                  {a.price_usd > 0  && ` × $${a.price_usd}`}
                  {a.cost > 0       && ` ｜ 成本 $${a.cost}`}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ textAlign: "right" }}>
                  <div style={{ color: C.blue, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 15 }}>
                    NT${fmt(a.value_twd)}
                  </div>
                  <div style={{ color: C.textMuted, fontSize: 11 }}>${(a.value_usd || 0).toFixed(2)}</div>
                  {renderPnl(a)}
                </div>
                <Btn onClick={() => openEdit(a)} outline small>編輯</Btn>
                <Btn onClick={() => del(a.id)}   color={C.red} outline small>刪除</Btn>
              </div>
            </div>
            {tgtPct > 0 && <AllocBar actual={acctPct} target={tgtPct} total={total} value={a.value_twd} />}
          </div>
        );
      })}

      {/* ── 美金現金 ─────────────────────────────────────── */}
      <SectionHeader
        title="美金現金"
        right={<Btn onClick={() => { setForm({ ...emptyUS, type: "cash" }); setModal("add"); }}>＋ 新增</Btn>}
      />

      {cash.map(a => (
        <div key={a.id} className="wos-row" style={{
          background: C.surface, border: `1px solid ${C.border}`,
          borderLeft: `3px solid ${C.purple}`, borderRadius: 12,
          padding: "14px 18px",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 3 }}>{a.name}</div>
            <div style={{ color: C.textMuted, fontSize: 11 }}>${(a.value_usd || 0).toFixed(2)} USD</div>
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

      {/* ── Modal ────────────────────────────────────────── */}
      {modal && (
        <Modal title={modal === "add" ? "新增項目" : "編輯項目"} onClose={() => setModal(null)}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
            <Sel label="類型" value={form.type} onChange={set("type")} options={["etf", "cash"]} />
            <Inp label="名稱" value={form.name} onChange={set("name")} placeholder="e.g. VT" />
            {form.type === "etf" && <>
              <Inp label="股票代號" value={form.ticker}
                onChange={v => { set("ticker")(v); set("leverage_ratio")(String(LEVERAGE_MAP[v.toUpperCase()] || 1)); }}
                placeholder="e.g. VT"
              />
              <Inp label="股數"         type="number" value={form.shares}         onChange={v => handleChange("shares", v)}     placeholder="0" />
              <Inp label="現價 (USD)"   type="number" value={form.price_usd}      onChange={v => handleChange("price_usd", v)} placeholder="0" />
              <Inp label="成本價 (USD)" type="number" value={form.cost}           onChange={set("cost")}                       placeholder="0" />
              <Inp label="目標佔比 (%)" type="number" value={form.target}         onChange={set("target")}                     placeholder="e.g. 50" />
              <Inp label="槓桿倍數"     type="number" value={form.leverage_ratio} onChange={set("leverage_ratio")}             placeholder="1" />
            </>}
            {form.type === "cash" && (
              <Inp label="目標佔比 (%)" type="number" value={form.target} onChange={set("target")} placeholder="e.g. 50" />
            )}
            <Inp label="金額 (USD)" type="number" value={form.value_usd} onChange={set("value_usd")} placeholder="0" />
            <Inp label="備註"       value={form.note}    onChange={set("note")}    placeholder="選填" />
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
