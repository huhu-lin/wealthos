// ============================================================
// Pledge.jsx — 股票質押管理頁
// 功能：
//   - 顯示整戶質押狀況（總市值、總借款、維持率、可承受跌幅）
//   - 依股票代號分組顯示各筆質押明細
//   - 維持率低於警戒值時顯示紅色警告
//   - 一鍵更新質押股票股價（透過 proxy API → FinMind）
//   - 新增 / 編輯 / 刪除質押記錄
// ============================================================

import { useState } from "react";
import { supabase } from "../supabase";
import { C, fmt } from "../constants/theme";
import { fetchTWPrice } from "../utils/priceApi";
import { Inp, Btn } from "./ui/FormControls";
import Modal from "./ui/Modal";
import { Badge, SectionHeader } from "./ui/Badge";
import Card from "./ui/Card";

// 新增質押的預設空值
const emptyPledge = {
  name: "", ticker: "", shares: "", price: "",
  borrow_amount: "", warning_ratio: "160", note: "",
};

export default function Pledge({ pledges, reload }) {
  const [modal,    setModal]    = useState(null);
  const [form,     setForm]     = useState(emptyPledge);
  const [saving,   setSaving]   = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetchMsg, setFetchMsg] = useState("");
  const [error,    setError]    = useState(null);

  const set = k => v => setForm(p => ({ ...p, [k]: v }));

  // ── Modal 開啟邏輯 ────────────────────────────────────────
  const openAdd  = () => { setForm(emptyPledge); setModal("add"); };
  const openEdit = p => {
    setForm({
      name: p.name, ticker: p.ticker || "",
      shares: String(p.shares || ""), price: String(p.price || ""),
      borrow_amount: String(p.borrow_amount || ""),
      warning_ratio: String(p.warning_ratio || 160),
      note: p.note || "",
    });
    setModal(p);
  };

  // ── 儲存（新增或更新，含錯誤處理）────────────────────────
  const save = async () => {
    try {
      setSaving(true);
      setError(null);
      const shares        = parseFloat(form.shares)        || 0;
      const price         = parseFloat(form.price)         || 0;
      const market_value  = shares * price;
      const borrow_amount = parseFloat(form.borrow_amount) || 0;
      const warning_ratio = parseFloat(form.warning_ratio) || 160;
      const data = {
        name: form.name, ticker: form.ticker,
        shares, price, market_value,
        borrow_amount, warning_ratio,
        note: form.note || "",
      };
      let result;
      if (modal === "add") result = await supabase.from("pledges").insert(data);
      else                 result = await supabase.from("pledges").update(data).eq("id", modal.id);

      if (result.error) throw new Error(result.error.message);
      setSaving(false); setModal(null); reload();
    } catch (err) {
      setSaving(false);
      setError(err.message);
      alert(`⚠️ ${err.message || "儲存失敗"}`);
    }
  };

  const del = async id => {
    if (!window.confirm("確定刪除？")) return;
    try {
      const result = await supabase.from("pledges").delete().eq("id", id);
      if (result.error) throw new Error(result.error.message);
      reload();
    } catch (err) {
      alert(`⚠️ 刪除失敗: ${err.message}`);
    }
  };

  // ── 一鍵更新股價（透過 /api/update-prices，資料源：kline-api/yfinance）
  // pledges 表更新已整合進 update-prices endpoint
  const refreshPrices = async () => {
    try {
      setFetching(true);
      setFetchMsg("抓取股價中…（yfinance）");
      setError(null);

      const res  = await fetch("/api/update-prices", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);

      const pledgeResults = json.pledgeResults || [];
      const okCount       = pledgeResults.filter(r => r.ok).length;
      const failCount     = pledgeResults.filter(r => !r.ok).length;

      if (okCount === 0 && failCount === 0) {
        setFetchMsg("ℹ️ 無質押標的需更新");
      } else if (failCount > 0 && okCount === 0) {
        setFetchMsg(`❌ 無法取得股價（${failCount} 筆失敗），請稍後再試`);
      } else {
        setFetchMsg(`✅ 已更新 ${okCount} 筆${failCount > 0 ? `，${failCount} 筆失敗` : ""}`);
      }

      setTimeout(() => setFetchMsg(""), 4000);
      reload();
    } catch (err) {
      setFetchMsg("❌ 更新失敗：" + err.message);
      setError(err.message);
    } finally {
      setFetching(false);
    }
  };

  // ── 整戶合計計算 ─────────────────────────────────────────
  const totalMarket   = pledges.reduce((s, p) => s + (p.market_value   || 0), 0);
  const totalBorrow   = pledges.reduce((s, p) => s + (p.borrow_amount  || 0), 0);
  const totalMaxBorrow = totalMarket * 0.6;                          // 最高可借六成
  const totalUnused   = totalMaxBorrow - totalBorrow;                // 尚可借出額度
  const overallRatio  = totalBorrow > 0 ? totalMarket / totalBorrow * 100 : 0;
  const overallMaxDrop = totalBorrow > 0
    ? (1 - (totalBorrow * 1.6 / totalMarket)) * 100 : 0;

  // 維持率顏色：>= 250 綠色，>= 200 金色，< 200 紅色
  const ratioColor = r => r >= 250 ? C.accent : r >= 200 ? C.gold : C.red;

  return (
    <div className="wos-fade" style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── 整戶質押摘要卡片 ─────────────────────────────── */}
      <Card style={{
        padding: 20,
        // 維持率危險時邊框變紅、接近時變金色
        borderColor: overallRatio > 0 && overallRatio < 200 ? C.red
                   : overallRatio < 250 ? C.gold : C.border,
      }}>
        <SectionHeader
          title="整戶質押狀況"
          right={<>
            {fetchMsg && <span style={{ color: C.accent, fontSize: 12 }}>{fetchMsg}</span>}
            <Btn onClick={refreshPrices} color={C.blue} outline disabled={fetching}>🔄 更新股價</Btn>
            <Btn onClick={openAdd}>＋ 新增質押</Btn>
          </>}
        />

        {/* 六格整戶 KPI */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 10, marginTop: 14 }}>
          {[
            ["總質押市值",   "NT$" + fmt(totalMarket),                         C.blue],
            ["總借款",       "NT$" + fmt(totalBorrow),                         C.red],
            ["整戶維持率",   overallRatio > 0 ? overallRatio.toFixed(1) + "%" : "–", ratioColor(overallRatio)],
            ["可承受跌幅",   overallMaxDrop > 0 ? overallMaxDrop.toFixed(1) + "%" : "–", overallMaxDrop > 20 ? C.accent : C.red],
            ["最高可借(六成)", "NT$" + fmt(totalMaxBorrow),                    C.gold],
            ["尚可借出",     "NT$" + fmt(Math.max(totalUnused, 0)),             totalUnused > 0 ? C.accent : C.red],
          ].map(([l, v, c]) => (
            <div key={l} style={{
              background: C.surface3, borderRadius: 10, padding: "10px 14px",
              border: `1px solid ${C.border}`,
            }}>
              <div style={{ color: C.textMuted, fontSize: 10, marginBottom: 5, fontWeight: 600, letterSpacing: "0.06em" }}>{l}</div>
              <div style={{ color: c, fontWeight: 700, fontSize: 14, fontFamily: "'JetBrains Mono', monospace" }}>{v}</div>
            </div>
          ))}
        </div>

        {/* 整戶維持率低於 200% 時顯示警告橫幅 */}
        {overallRatio > 0 && overallRatio < 200 && (
          <div style={{
            marginTop: 14, padding: "10px 14px",
            background: C.redDim, border: `1px solid ${C.red}40`, borderRadius: 10,
            color: C.red, fontSize: 12, fontWeight: 500,
          }}>
            ⚠️ 整戶維持率 {overallRatio.toFixed(1)}% 低於 200%，請注意！
          </div>
        )}
      </Card>

      {/* 空狀態 */}
      {pledges.length === 0 && (
        <Card style={{ padding: 28, textAlign: "center" }}>
          <div style={{ color: C.textMuted, fontSize: 12 }}>🔒 尚無質押記錄</div>
          <div style={{ color: C.textDim, fontSize: 11, marginTop: 4 }}>點擊「＋ 新增質押」開始記錄</div>
        </Card>
      )}

      {/* ── 依股票代號分組顯示質押明細 ──────────────────── */}
      {Object.entries(
        // 先按 ticker 分組（無 ticker 則用 name）
        pledges.reduce((acc, p) => {
          const key = p.ticker || p.name;
          if (!acc[key]) acc[key] = [];
          acc[key].push(p);
          return acc;
        }, {})
      ).map(([ticker, items]) => {
        const groupMarket = items.reduce((s, p) => s + (p.market_value   || 0), 0);
        const groupBorrow = items.reduce((s, p) => s + (p.borrow_amount  || 0), 0);

        return (
          <Card key={ticker} style={{ padding: 18 }}>
            {/* 分組標題：股票代號、總股數、現價、整組市值 / 借款 */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontWeight: 700, fontSize: 15 }}>{ticker}</span>
                <Badge text={`${items.reduce((s, p) => s + (p.shares || 0), 0).toLocaleString()} 股`} color={C.blue} />
                {items[0]?.price > 0 && (
                  <span style={{ color: C.textMuted, fontSize: 12 }}>@ NT${items[0].price}</span>
                )}
              </div>
              <div style={{ color: C.textMuted, fontSize: 12 }}>
                市值 <span style={{ color: C.blue, fontWeight: 600 }}>NT${fmt(groupMarket)}</span>
                {" ｜ "}借款 <span style={{ color: C.red, fontWeight: 600 }}>NT${fmt(groupBorrow)}</span>
              </div>
            </div>

            {/* 各筆質押明細 */}
            {items.map((p, idx) => {
              const ratio       = p.borrow_amount > 0 ? (p.market_value || 0) / p.borrow_amount * 100 : 0;
              const maxDrop     = p.borrow_amount > 0
                ? (1 - (p.borrow_amount * (p.warning_ratio / 100) / (p.market_value || 1))) * 100 : 0;
              const maxBorrow   = (p.market_value || 0) * 0.6;
              const unusedQuota = maxBorrow - p.borrow_amount;
              // 維持率接近警戒線（警戒值的 110%）時標紅
              const isWarning   = ratio > 0 && ratio < p.warning_ratio * 1.1;

              return (
                <div key={p.id} style={{
                  background: C.surface3, borderRadius: 10, padding: "14px 16px",
                  border: `1px solid ${isWarning ? C.red : C.border}`,
                  marginBottom: 8,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>
                      第 {idx + 1} 筆 ｜ {p.shares} 股質押
                      {p.note && <span style={{ color: C.textMuted, fontSize: 11, marginLeft: 8 }}>{p.note}</span>}
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <Btn onClick={() => openEdit(p)} outline small>編輯</Btn>
                      <Btn onClick={() => del(p.id)} color={C.red} outline small>刪除</Btn>
                    </div>
                  </div>

                  {/* 六格單筆 KPI */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(100px,1fr))", gap: 8 }}>
                    {[
                      ["市值",     "NT$" + fmt(p.market_value || 0),                C.blue],
                      ["借款",     "NT$" + fmt(p.borrow_amount || 0),               C.red],
                      ["維持率",   ratio > 0 ? ratio.toFixed(1) + "%" : "–",        ratioColor(ratio)],
                      ["可承受跌幅", maxDrop > 0 ? maxDrop.toFixed(1) + "%" : "–",  maxDrop > 20 ? C.accent : C.red],
                      ["最高可借", "NT$" + fmt(maxBorrow),                          C.gold],
                      ["尚可借",   "NT$" + fmt(Math.max(unusedQuota, 0)),            unusedQuota > 0 ? C.accent : C.red],
                    ].map(([l, v, c]) => (
                      <div key={l} style={{ background: C.bg, borderRadius: 7, padding: "7px 10px" }}>
                        <div style={{ color: C.textDim, fontSize: 9, marginBottom: 3, fontWeight: 600, letterSpacing: "0.06em" }}>{l}</div>
                        <div style={{ color: c, fontWeight: 700, fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>{v}</div>
                      </div>
                    ))}
                  </div>

                  {/* 單筆維持率警告 */}
                  {isWarning && (
                    <div style={{
                      marginTop: 10, padding: "8px 12px",
                      background: C.redDim, borderRadius: 8, color: C.red, fontSize: 11, fontWeight: 500,
                    }}>
                      ⚠️ 維持率 {ratio.toFixed(1)}% 接近警戒線 {p.warning_ratio}%！
                    </div>
                  )}
                </div>
              );
            })}
          </Card>
        );
      })}

      {/* ── 新增 / 編輯 Modal ─────────────────────────────── */}
      {modal && (
        <Modal title={modal === "add" ? "新增質押" : "編輯質押"} onClose={() => setModal(null)}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
            <Inp label="名稱"          value={form.name}         onChange={set("name")}         placeholder="e.g. 006208 第一筆" />
            <Inp label="股票代號"      value={form.ticker}        onChange={set("ticker")}       placeholder="e.g. 006208" />
            <Inp label="質押股數"      type="number" value={form.shares}        onChange={set("shares")}       placeholder="e.g. 6000" />
            <Inp label="現價 (NT$)"    type="number" value={form.price}         onChange={set("price")}        placeholder="自動抓取" />
            <Inp label="已借出 (NT$)"  type="number" value={form.borrow_amount} onChange={set("borrow_amount")} placeholder="0" />
            <Inp label="警戒維持率 (%)" type="number" value={form.warning_ratio} onChange={set("warning_ratio")} placeholder="160" />
            <Inp label="備註"          value={form.note}          onChange={set("note")}         placeholder="選填" />
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
