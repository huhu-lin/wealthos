// ============================================================
// App.jsx — 應用程式主殼層（Main Shell）
// 職責：
//   1. 資料載入：從 Supabase 撈取所有資產、負債、快照、質押
//   2. 匯率取得：呼叫 fetchUSDTWD() 取得即時 USD/TWD
//   3. 每日快照寫入：若今日尚無快照，自動寫入一筆
//   4. Tab 路由：依選中的 tab 切換渲染對應的頁面元件
// 注意：本檔案不再包含任何 UI 細節或業務邏輯，
//       所有頁面功能都已拆分至 src/components/ 子元件。
// ============================================================

import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabase";
import { C, fmt } from "./constants/theme";
import { fetchUSDTWD } from "./utils/priceApi";

// ── 頁面元件 ──────────────────────────────────────────────
import GlobalStyles  from "./components/ui/GlobalStyles";
import TabBtn        from "./components/ui/TabBtn";
import Overview      from "./components/Overview";
import TWAccount     from "./components/TWAccount";
import USAccount     from "./components/USAccount";
import CryptoAccount from "./components/CryptoAccount";
import OtherAccount  from "./components/OtherAccount";
import Liabilities   from "./components/Liabilities";
import Pledge        from "./components/Pledge";
import Strategy      from "./Strategy";

// ── Tab 清單（id 對應路由、label 顯示名稱、icon 圖示）──────
const TABS = [
  { id: "overview", label: "總覽", icon: "◎" },
  { id: "tw",       label: "台股", icon: "🇹🇼" },
  { id: "us",       label: "美股", icon: "🇺🇸" },
  { id: "crypto",   label: "加密", icon: "₿" },
  { id: "other",    label: "其他", icon: "🏠" },
  { id: "liab",     label: "負債", icon: "📋" },
  { id: "pledge",   label: "質押", icon: "🔒" },
  { id: "strategy", label: "策略", icon: "📈" },
];

export default function App() {
  // ── 狀態 ─────────────────────────────────────────────────
  const [tab,         setTab]         = useState("overview");
  const [allAssets,   setAllAssets]   = useState([]);
  const [liabilities, setLiabilities] = useState([]);
  const [snapshots,   setSnapshots]   = useState([]);
  const [pledges,     setPledges]     = useState([]);
  const [usdRate,     setUsdRate]     = useState(31.5);
  const [loading,     setLoading]     = useState(true);

  // ── 資料載入（同時撈所有資料表 + 匯率）──────────────────
  const load = useCallback(async () => {
    const [a, l, s, p, rate] = await Promise.all([
      supabase.from("assets").select("*").order("account"),
      supabase.from("liabilities").select("*"),
      supabase.from("monthly_snapshots").select("*").order("date"),
      supabase.from("pledges").select("*"),
      fetchUSDTWD(),
    ]);
    setAllAssets(a.data   || []);
    setLiabilities(l.data || []);
    setSnapshots(s.data   || []);
    setPledges(p.data     || []);
    setUsdRate(rate       || 31.5);
    setLoading(false);

    // ── 每日自動快照（當天尚無快照且有資產時寫入）─────────
    const today    = new Date().toISOString().slice(0, 10);
    const existing = s.data?.find(x => x.date === today);
    if (!existing && (a.data || []).length > 0) {
      const totalAssets = (a.data || []).reduce((sum, x) => sum + (x.value_twd || 0), 0);
      const totalLiab   = (l.data || []).reduce((sum, x) => sum + x.value, 0);
      const net         = totalAssets - totalLiab;
      const leverage    = net > 0 ? totalAssets / net : 0;
      await supabase.from("monthly_snapshots").insert({
        date: today, assets: totalAssets, liabilities: totalLiab, net, leverage,
      });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── 資料分組（傳入各子頁面）──────────────────────────────
  const twAssets     = allAssets.filter(a => a.account === "tw");
  const usAssets     = allAssets.filter(a => a.account === "us");
  const cryptoAssets = allAssets.filter(a => a.account === "crypto");
  const otherAssets  = allAssets.filter(a => a.account === "other");

  const totalAssets = allAssets.reduce((s, x) => s + (x.value_twd || 0), 0);
  const totalLiab   = liabilities.reduce((s, x) => s + x.value, 0);
  const netWorth    = totalAssets - totalLiab;

  // ── 載入中畫面 ───────────────────────────────────────────
  if (loading) {
    return (
      <>
        <GlobalStyles />
        <div style={{
          background: C.bg, minHeight: "100vh",
          display: "flex", alignItems: "center", justifyContent: "center",
          flexDirection: "column", gap: 20,
        }}>
          <div style={{
            width: 52, height: 52,
            background: `linear-gradient(135deg, ${C.accent}, ${C.blue})`,
            borderRadius: 14,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 24,
            boxShadow: `0 8px 24px ${C.accent}40`,
            animation: "wos-pulse 2s ease infinite",
          }}>💰</div>
          <div className="wos-loader" />
          <div style={{ color: C.textMuted, fontSize: 12, letterSpacing: "0.05em" }}>
            載入資產資料中…
          </div>
        </div>
      </>
    );
  }

  // ── 主介面 ───────────────────────────────────────────────
  return (
    <>
      <GlobalStyles />
      <div style={{ background: C.bg, minHeight: "100vh", color: C.text, fontFamily: "'Inter','Noto Sans TC',sans-serif" }}>

        {/* ── Header（黏性頂部導覽列）──────────────────────── */}
        <div style={{
          background: `linear-gradient(90deg, ${C.surface} 0%, #0a162a 100%)`,
          borderBottom: `1px solid ${C.border}`,
          padding: "0 24px", height: 64,
          display: "flex", justifyContent: "space-between", alignItems: "center",
          position: "sticky", top: 0, zIndex: 100,
          boxShadow: "0 4px 20px rgba(0,0,0,0.35)",
        }}>
          {/* Logo + 標題 */}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 38, height: 38,
              background: `linear-gradient(135deg, ${C.accent}, ${C.blue})`,
              borderRadius: 10,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 18, boxShadow: `0 4px 14px ${C.accent}45`, flexShrink: 0,
            }}>💰</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-0.02em" }}>WealthOS</div>
              <div style={{ color: C.textMuted, fontSize: 10, letterSpacing: "0.04em" }}>個人資產監控系統</div>
            </div>
          </div>

          {/* 右側：淨值 + 匯率 */}
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ textAlign: "right" }}>
              <div style={{ color: C.textMuted, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 2 }}>NET WORTH</div>
              <div style={{ color: C.accent, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", fontSize: 18, letterSpacing: "-0.02em" }}>
                NT${fmt(netWorth)}
              </div>
            </div>
            <div style={{
              padding: "5px 12px",
              background: C.accentDim, border: `1px solid ${C.accent}35`,
              borderRadius: 20, color: C.textMuted, fontSize: 11, fontFamily: "monospace", whiteSpace: "nowrap",
            }}>
              USD {usdRate.toFixed(2)}
            </div>
          </div>
        </div>

        {/* ── 主內容區 ─────────────────────────────────────── */}
        <div style={{ padding: "20px 24px", maxWidth: 1100, margin: "0 auto" }}>

          {/* Tab 導覽列 */}
          <div style={{
            display: "flex", gap: 6, marginBottom: 20, flexWrap: "wrap",
            paddingBottom: 16, borderBottom: `1px solid ${C.border}`,
          }}>
            {TABS.map(t => (
              <TabBtn key={t.id} {...t} active={tab === t.id} onClick={() => setTab(t.id)} />
            ))}
          </div>

          {/* ── Tab 路由：依 tab 狀態渲染對應頁面元件 ────── */}
          {tab === "overview" && (
            <Overview
              twAssets={twAssets} usAssets={usAssets}
              cryptoAssets={cryptoAssets} otherAssets={otherAssets}
              liabilities={liabilities} snapshots={snapshots} usdRate={usdRate}
            />
          )}
          {tab === "tw"       && <TWAccount     assets={twAssets}     reload={load} />}
          {tab === "us"       && <USAccount     assets={usAssets}     usdRate={usdRate} reload={load} />}
          {tab === "crypto"   && <CryptoAccount assets={cryptoAssets} reload={load} />}
          {tab === "other"    && <OtherAccount  assets={otherAssets}  reload={load} />}
          {tab === "liab"     && <Liabilities   liabilities={liabilities} reload={load} />}
          {tab === "pledge"   && <Pledge        pledges={pledges}     reload={load} />}
          {tab === "strategy" && <Strategy      allAssets={allAssets} />}
        </div>
      </div>
    </>
  );
}
