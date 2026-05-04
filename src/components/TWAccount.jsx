// ============================================================
// TWAccount.jsx — 台股帳戶管理頁
// 功能：
//   - 顯示台股 ETF / 股票持倉列表，含損益與目標配置進度條
//   - 顯示台幣現金列表
//   - 新增 / 編輯 / 刪除持倉（Modal 表單）
//   - 一鍵更新股價（透過 proxy API → FinMind）
// ============================================================

import { useState, useEffect, useRef } from "react";
import { supabase } from "../supabase";
import { C, LEVERAGE_MAP, fmt } from "../constants/theme";
import { fetchTWPrice } from "../utils/priceApi";
import KPI from "./ui/KPI";
import { Inp, Sel, Btn } from "./ui/FormControls";
import Modal from "./ui/Modal";
import { Badge, AllocBar, SectionHeader } from "./ui/Badge";

// 新增表單的預設空值
const emptyTW = {
  type: "etf", name: "", ticker: "", shares: "",
  price: "", cost: "", value_twd: "", target: "",
  leverage_ratio: "1", note: "",
};

export default function TWAccount({ assets, reload }) {
  // ── 狀態 ─────────────────────────────────────────────────
  const [modal,    setModal]    = useState(null);   // null=關閉, "add"=新增, object=編輯
  const [form,     setForm]     = useState(emptyTW);
  const [saving,   setSaving]   = useState(false);
  const [fetching, setFetching] = useState(false);  // 股價抓取中
  const [fetchMsg, setFetchMsg] = useState("");     // 股價抓取狀態訊息
  const [error,    setError]    = useState(null);   // 操作錯誤訊息
  const fetchMsgTimer = useRef(null);               // setTimeout 計時器 ref，便於清理

  // 清理 setTimeout 的 useEffect
  useEffect(() => {
    return () => {
      if (fetchMsgTimer.current) {
        clearTimeout(fetchMsgTimer.current);
      }
    };
  }, []);

  // 快速設定單一欄位
  const set = k => v => setForm(p => ({ ...p, [k]: v }));

  // ── 股數 / 價格聯動計算市值 ──────────────────────────────
  const handleChange = (k, v) => {
    const next = { ...form, [k]: v };
    const shares = parseFloat(k === "shares" ? v : next.shares) || 0;
    const price  = parseFloat(k === "price"  ? v : next.price)  || 0;
    if (shares > 0 && price > 0) next.value_twd = String((shares * price).toFixed(0));
    setForm(next);
  };

  // ── Modal 開啟邏輯 ────────────────────────────────────────
  const openAdd  = () => { setForm(emptyTW); setModal("add"); };
  const openEdit = a => {
    setForm({
      type: a.type || "etf", name: a.name, ticker: a.ticker || "",
      shares: String(a.shares || ""), price: String(a.price || ""),
      cost: String(a.cost || ""), value_twd: String(a.value_twd || ""),
      target: String(a.target > 0 ? a.target * 100 : ""),
      leverage_ratio: String(a.leverage_ratio || 1),
      note: a.note || "",
    });
    setModal(a);
  };

  // ── 儲存（新增或更新，含錯誤處理）────────────────────────
  const save = async () => {
    try {
      setSaving(true);
      setError(null);
      const shares = parseFloat(form.shares) || 0;
      const cost   = parseFloat(form.cost)   || 0;
      const data = {
        account: "tw", type: form.type, name: form.name, ticker: form.ticker,
        shares, price: parseFloat(form.price) || 0,
        cost, cost_total: cost * shares,
        value_twd: parseFloat(form.value_twd) || 0,
        target: (parseFloat(form.target) || 0) / 100,
        leverage_ratio: parseFloat(form.leverage_ratio) || 1,
        note: form.note,
      };
      let result;
      if (modal === "add") result = await supabase.from("assets").insert(data);
      else                 result = await supabase.from("assets").update(data).eq("id", modal.id);

      if (result.error) throw new Error(result.error.message);
      setSaving(false); setModal(null); reload();
    } catch (err) {
      setSaving(false);
      setError(err.message || "儲存失敗，請重試");
      alert(`⚠️ ${err.message || "儲存失敗"}`);
    }
  };

  // ── 刪除（含錯誤處理）──────────────────────────────────
  const del = async id => {
    if (!window.confirm("確定刪除？")) return;
    try {
      const result = await supabase.from("assets").delete().eq("id", id);
      if (result.error) throw new Error(result.error.message);
      reload();
    } catch (err) {
      alert(`⚠️ 刪除失敗: ${err.message}`);
    }
  };

  // ── 一鍵更新股價（含錯誤處理）────────────────────────────
  // 只更新 type=etf 且有 ticker 的資產
  const refreshPrices = async () => {
    try {
      setFetching(true);
      setFetchMsg("抓取股價中…");
      setError(null);
      const etfsToUpdate = assets.filter(a => a.ticker && a.type === "etf");
      if (etfsToUpdate.length === 0) {
        setFetchMsg("ℹ️ 無需更新的 ETF");
        if (fetchMsgTimer.current) clearTimeout(fetchMsgTimer.current);
        fetchMsgTimer.current = setTimeout(() => setFetchMsg(""), 2000);
        setFetching(false);
        return;
      }
      for (const a of etfsToUpdate) {
        const price = await fetchTWPrice(a.ticker);
        if (price) {
          const result = await supabase.from("assets").update({ price, value_twd: price * (a.shares || 0) }).eq("id", a.id);
          if (result.error) throw new Error(result.error.message);
          setFetchMsg(`✅ ${a.ticker}: NT$${price}`);
        } else {
          setFetchMsg(`❌ ${a.ticker}: 無法取得股價`);
        }
      }
      setFetchMsg("✅ 更新完成");
      if (fetchMsgTimer.current) clearTimeout(fetchMsgTimer.current);
      fetchMsgTimer.current = setTimeout(() => setFetchMsg(""), 3000);
      reload();
    } catch (err) {
      setFetching(false);
      setFetchMsg("❌ 更新失敗");
      setError(err.message);
      alert(`⚠️ 股價更新失敗: ${err.message}`);
    } finally {
      setFetching(false);
    }
  };

  // ── 資料分組 ─────────────────────────────────────────────
  const etfs  = assets.filter(a => a.type === "etf");
  const cash  = assets.filter(a => a.type === "cash");
  const total = assets.reduce((s, x) => s + (x.value_twd || 0), 0);

  // ── 損益顯示 ─────────────────────────────────────────────
  const renderPnl = a => {
    const ct = a.cost_total || (a.cost || 0) * (a.shares || 0);
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

      {/* ── KPI 摘要 ─────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
        <KPI label="台股總值"   value={total}                                     color={C.accent} />
        <KPI label="ETF / 股票" value={etfs.reduce((s, x) => s + x.value_twd, 0)} color={C.blue} />
        <KPI label="台幣現金"   value={cash.reduce((s, x) => s + x.value_twd, 0)} color={C.purple} />
      </div>

      {/* ── ETF / 股票區塊 ───────────────────────────────── */}
      <SectionHeader
        title="ETF / 股票"
        right={<>
          {fetchMsg && <span style={{ color: C.accent, fontSize: 12 }}>{fetchMsg}</span>}
          <Btn onClick={refreshPrices} color={C.blue} outline disabled={fetching}>🔄 更新股價</Btn>
          <Btn onClick={openAdd}>＋ 新增</Btn>
        </>}
      />

      {etfs.length === 0 ? (
        <div style={{
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          padding: "24px 18px",
          textAlign: "center",
        }}>
          <div style={{ color: C.textMuted, fontSize: 12 }}>
            📌 尚無 ETF / 股票
          </div>
          <div style={{ color: C.textDim, fontSize: 11, marginTop: 4 }}>
            點擊「＋ 新增」開始記錄你的投資
          </div>
        </div>
      ) : etfs.map(a => {
        const acctPct = total > 0 ? a.value_twd / total * 100 : 0;
        const tgtPct  = (a.target || 0) * 100;
        return (
          <div key={a.id} className="wos-row" style={{
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderLeft: `3px solid ${C.accent}`,
            borderRadius: 12,
            padding: "14px 18px",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 5 }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{a.name}</span>
                  {a.ticker && <Badge text={a.ticker} color={C.blue} />}
                  {(a.leverage_ratio || 1) > 1 && <Badge text={`${a.leverage_ratio}x`} color={C.orange} />}
                </div>
                <div style={{ color: C.textMuted, fontSize: 11 }}>
                  {a.shares > 0 && `${a.shares.toLocaleString()} 股`}
                  {a.price > 0  && ` × NT$${a.price}`}
                  {a.cost > 0   && ` ｜ 成本 NT$${a.cost}`}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ textAlign: "right" }}>
                  <div style={{ color: C.accent, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 15 }}>
                    NT${fmt(a.value_twd)}
                  </div>
                  {renderPnl(a)}
                </div>
                <Btn onClick={() => openEdit(a)} outline small>編輯</Btn>
                <Btn onClick={() => del(a.id)}   color={C.red} outline small>刪除</Btn>
              </div>
            </div>
            {/* 目標配置進度條（有設目標才顯示） */}
            {tgtPct > 0 && <AllocBar actual={acctPct} target={tgtPct} total={total} value={a.value_twd} />}
          </div>
        );
      })}

      {/* ── 台幣現金區塊 ─────────────────────────────────── */}
      <SectionHeader
        title="台幣現金"
        right={<Btn onClick={() => { setForm({ ...emptyTW, type: "cash" }); setModal("add"); }}>＋ 新增</Btn>}
      />

      {cash.length === 0 ? (
        <div style={{
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          padding: "24px 18px",
          textAlign: "center",
        }}>
          <div style={{ color: C.textMuted, fontSize: 12 }}>
            💳 尚無台幣現金記錄
          </div>
          <div style={{ color: C.textDim, fontSize: 11, marginTop: 4 }}>
            點擊「＋ 新增」新增現金帳戶
          </div>
        </div>
      ) : cash.map(a => {
        const acctPct = total > 0 ? a.value_twd / total * 100 : 0;
        const tgtPct  = (a.target || 0) * 100;
        return (
          <div key={a.id} className="wos-row" style={{
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderLeft: `3px solid ${C.purple}`,
            borderRadius: 12,
            padding: "14px 18px",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 3 }}>{a.name}</div>
                <div style={{ color: C.textMuted, fontSize: 11 }}>{a.note}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ color: C.purple, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 15 }}>
                  NT${fmt(a.value_twd)}
                </div>
                <Btn onClick={() => openEdit(a)} outline small>編輯</Btn>
                <Btn onClick={() => del(a.id)}   color={C.red} outline small>刪除</Btn>
              </div>
            </div>
            {tgtPct > 0 && <AllocBar actual={acctPct} target={tgtPct} total={total} value={a.value_twd} />}
          </div>
        );
      })}

      {/* ── 新增 / 編輯 Modal ─────────────────────────────── */}
      {modal && (
        <Modal title={modal === "add" ? "新增項目" : "編輯項目"} onClose={() => setModal(null)}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
            <Sel label="類型" value={form.type} onChange={set("type")} options={["etf", "cash"]} />
            <Inp label="名稱" value={form.name} onChange={set("name")} placeholder="e.g. 006208" />
            {form.type === "etf" && <>
              <Inp label="股票代號" value={form.ticker}
                onChange={v => {
                  set("ticker")(v);
                  // 自動帶入槓桿倍率
                  set("leverage_ratio")(String(LEVERAGE_MAP[v.toUpperCase()] || 1));
                }}
                placeholder="e.g. 006208"
              />
              <Inp label="股數"          type="number" value={form.shares}         onChange={v => handleChange("shares", v)} placeholder="0" />
              <Inp label="現價 (NT$)"    type="number" value={form.price}          onChange={v => handleChange("price", v)}  placeholder="0" />
              <Inp label="成本價 (NT$)"  type="number" value={form.cost}           onChange={set("cost")}                    placeholder="0" />
              <Inp label="目標佔比 (%)"  type="number" value={form.target}         onChange={set("target")}                  placeholder="e.g. 50" />
              <Inp label="槓桿倍數"      type="number" value={form.leverage_ratio} onChange={set("leverage_ratio")}          placeholder="1" />
            </>}
            {form.type === "cash" && (
              <Inp label="目標佔比 (%)" type="number" value={form.target} onChange={set("target")} placeholder="e.g. 50" />
            )}
            <Inp label="市值 (NT$)" type="number" value={form.value_twd} onChange={set("value_twd")} placeholder="0" />
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
