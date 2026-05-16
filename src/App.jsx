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

import { useState, useEffect, useCallback, useMemo } from "react";
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
import FireDashboard from "./components/FireDashboard";
import LoginPage     from "./components/LoginPage";

// ── Tab 清單（id 對應路由、label 顯示名稱、icon 圖示）──────
const TABS = [
  { id: "overview", label: "總覽", icon: "◎" },
  { id: "strategy", label: "策略", icon: "📈" },  // C-006: 核心功能移至第二位
  { id: "tw",       label: "台股", icon: "🇹🇼" },
  { id: "us",       label: "美股", icon: "🇺🇸" },
  { id: "crypto",   label: "加密", icon: "₿" },
  { id: "other",    label: "其他", icon: "🏠" },
  { id: "liab",     label: "負債", icon: "📋" },
  { id: "pledge",   label: "質押", icon: "🔒" },
  { id: "fire",     label: "FIRE", icon: "🔥" },
];

// ── RWD Hook（本地定義，避免跨模組依賴）────────────────────
function useWindowWidth() {
  const [width, setWidth] = useState(typeof window !== "undefined" ? window.innerWidth : 1280);
  useEffect(() => {
    const handler = () => setWidth(window.innerWidth);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return width;
}

export default function App() {
  const winWidth  = useWindowWidth();
  const isMobile  = winWidth <= 600;

  // ── Auth 狀態 ─────────────────────────────────────────────
  const [session,     setSession]     = useState(undefined); // undefined = 初始化中, null = 未登入
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    // 取得目前 session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthChecked(true);
    });
    // 監聽登入/登出狀態變化
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => subscription.unsubscribe();
  }, []);

  // ── 狀態 ─────────────────────────────────────────────────
  const [tab,         setTab]         = useState("overview");
  const [allAssets,   setAllAssets]   = useState([]);
  const [liabilities, setLiabilities] = useState([]);
  const [snapshots,   setSnapshots]   = useState([]);
  const [pledges,     setPledges]     = useState([]);
  const [cashflow,    setCashflow]    = useState([]);
  const [strategies,  setStrategies]  = useState([]);
  const [usdRate,     setUsdRate]     = useState(31.5);
  const [loading,     setLoading]     = useState(true);

  // ── 狀態：錯誤處理 ───────────────────────────────────────
  const [error, setError] = useState(null);

  // ── 資料載入（同時撈所有資料表 + 匯率，含錯誤處理）────────
  const load = useCallback(async () => {
    try {
      setError(null);
      setLoading(true);

      // ── 自動認領舊資料（user_id IS NULL → 指定給目前登入用戶）
      // 用 localStorage 旗標確保每個帳號只執行一次，防止第二個帳號搶走資料
      const uid = (await supabase.auth.getUser()).data.user?.id;
      if (uid) {
        const claimKey = `legacy_claimed_${uid}`;
        if (!localStorage.getItem(claimKey)) {
          await Promise.all([
            supabase.from("assets").update({ user_id: uid }).is("user_id", null),
            supabase.from("liabilities").update({ user_id: uid }).is("user_id", null),
            supabase.from("pledges").update({ user_id: uid }).is("user_id", null),
            supabase.from("monthly_snapshots").update({ user_id: uid }).is("user_id", null),
            supabase.from("strategy_tickers").update({ user_id: uid }).is("user_id", null),
          ]);
          localStorage.setItem(claimKey, '1');
        }
      }
      const [a, l, s, p, cf, st, rate] = await Promise.all([
        supabase.from("assets").select("*").order("account"),
        supabase.from("liabilities").select("*"),
        supabase.from("monthly_snapshots").select("*").order("date", { ascending: false }).limit(365),
        supabase.from("pledges").select("*"),
        supabase.from("cashflow_summary").select("*").order("month", { ascending: false }).limit(24),
        supabase.from("strategy_tickers").select("ticker,is_us,latest_j,j_above_flag,j_below_flag,last_signal,last_signal_date,j_entry,j_exit"),
        fetchUSDTWD(),
      ]);

      // 檢查 Supabase 錯誤
      if (a.error) throw new Error(`資產資料載入失敗: ${a.error.message}`);
      if (l.error) throw new Error(`負債資料載入失敗: ${l.error.message}`);
      if (s.error) throw new Error(`快照資料載入失敗: ${s.error.message}`);
      if (p.error) throw new Error(`質押資料載入失敗: ${p.error.message}`);
      // cashflow 是選配，載入失敗不中斷

      setAllAssets(a.data   || []);
      setLiabilities(l.data || []);
      setSnapshots((s.data || []).sort((x, y) => new Date(x.date) - new Date(y.date)));
      setPledges(p.data     || []);
      setCashflow(cf.data   || []);
      setStrategies(st.data || []);
      setUsdRate(rate       || 31.5);

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
    } catch (err) {
      console.error("載入失敗:", err);
      setError(err.message || "資料載入失敗，請檢查網路連線");
    } finally {
      setLoading(false);
    }
  }, []);

  // 只在已登入時才載入資料
  useEffect(() => { if (session) load(); }, [load, session]);

  // ── 資料分組（傳入各子頁面，使用 useMemo 避免不必要重新計算）────────
  const twAssets = useMemo(() => allAssets.filter(a => a.account === "tw"), [allAssets]);
  const usAssets = useMemo(() => allAssets.filter(a => a.account === "us"), [allAssets]);
  const cryptoAssets = useMemo(() => allAssets.filter(a => a.account === "crypto"), [allAssets]);
  const otherAssets = useMemo(() => allAssets.filter(a => a.account === "other"), [allAssets]);

  // 計算財務指標（useMemo 保證只在 allAssets 或 liabilities 改變時重新計算）
  const { totalAssets, totalLiab, netWorth } = useMemo(() => {
    const total = allAssets.reduce((s, x) => s + (x.value_twd || 0), 0);
    const liab = liabilities.reduce((s, x) => s + x.value, 0);
    return {
      totalAssets: total,
      totalLiab: liab,
      netWorth: total - liab,
    };
  }, [allAssets, liabilities]);

  // ── Auth 守衛：未登入或初始化中 ───────────────────────────
  if (!authChecked) return null; // 等待 session 初始化，避免閃爍
  if (!session) return <LoginPage />;

  // ── 登出處理 ──────────────────────────────────────────────
  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  // ── 載入中或錯誤畫面 ──────────────────────────────────────
  if (loading || error) {
    return (
      <>
        <GlobalStyles />
        <div style={{
          background: C.bg, minHeight: "100vh",
          display: "flex", alignItems: "center", justifyContent: "center",
          flexDirection: "column", gap: 20,
        }}>
          {error ? (
            // 錯誤狀態
            <>
              <div style={{
                width: 56, height: 56,
                background: C.red + "20",
                borderRadius: 14,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 28,
              }}>⚠️</div>
              <div style={{ textAlign: "center", maxWidth: 380 }}>
                <div style={{ color: C.text, fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
                  資料載入失敗
                </div>
                <div style={{ color: C.textMuted, fontSize: 12, marginBottom: 16, lineHeight: 1.5 }}>
                  {error}
                </div>
                <button
                  onClick={() => load()}
                  style={{
                    background: C.accent,
                    color: "#fff",
                    border: "none",
                    borderRadius: 8,
                    padding: "8px 16px",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "filter 0.15s",
                  }}
                  onMouseEnter={e => e.target.style.filter = "brightness(1.1)"}
                  onMouseLeave={e => e.target.style.filter = "brightness(1)"}
                >
                  重新嘗試
                </button>
              </div>
            </>
          ) : (
            // 載入中狀態（改進版本）
            <>
              <div style={{
                width: 56, height: 56,
                background: `linear-gradient(135deg, ${C.accent}, ${C.blue})`,
                borderRadius: 14,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 26,
                boxShadow: `0 8px 24px ${C.accent}40`,
                animation: "wos-pulse 2s ease infinite",
              }}>💰</div>
              <div style={{ position: "relative", width: 48, height: 48 }}>
                <div className="wos-loader" style={{ width: "100%", height: "100%" }} />
              </div>
              <div style={{ textAlign: "center", maxWidth: 240 }}>
                <div style={{ color: C.text, fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                  載入資產資料中
                </div>
                <div style={{ color: C.textMuted, fontSize: 11, letterSpacing: "0.05em" }}>
                  正在連線至 Supabase…
                </div>
              </div>
            </>
          )}
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
          padding: "0 16px", height: 64,
          display: "flex", justifyContent: "space-between", alignItems: "center",
          position: "sticky", top: 0, zIndex: 100,
          boxShadow: "0 4px 20px rgba(0,0,0,0.35)",
          gap: 12,
          flexWrap: "nowrap",
          minHeight: 64,
          "@media (max-width: 768px)": {
            padding: "0 12px",
            gap: 8,
          }
        }}>
          {/* Logo + 標題 */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flexShrink: 0 }}>
            <div style={{
              width: 38, height: 38,
              background: `linear-gradient(135deg, ${C.accent}, ${C.blue})`,
              borderRadius: 10,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 18, boxShadow: `0 4px 14px ${C.accent}45`, flexShrink: 0,
            }}>💰</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14, letterSpacing: "-0.02em", whiteSpace: "nowrap" }}>WealthOS</div>
              <div style={{ color: C.textMuted, fontSize: 9, letterSpacing: "0.04em", whiteSpace: "nowrap" }}>資產監控</div>
            </div>
          </div>

          {/* 右側：淨值 + 匯率 + 登出 */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto", flexShrink: 0 }}>
            {/* NET WORTH：桌機顯示，手機隱藏（600px 以下） */}
            {!isMobile && (
              <div style={{ textAlign: "right" }}>
                <div style={{ color: C.textMuted, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600, marginBottom: 2 }}>NET WORTH</div>
                <div style={{ color: C.accent, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", fontSize: 16, letterSpacing: "-0.02em" }}>
                  NT${fmt(netWorth)}
                </div>
              </div>
            )}
            <div style={{
              padding: isMobile ? "4px 8px" : "5px 10px",
              background: C.accentDim, border: `1px solid ${C.accent}35`,
              borderRadius: 20, color: C.textMuted, fontSize: isMobile ? 9 : 10,
              fontFamily: "monospace", whiteSpace: "nowrap",
            }}>
              USD {usdRate.toFixed(2)}
            </div>
            {/* 用戶 email 縮寫 + 登出按鈕 */}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{
                width: 30, height: 30,
                background: C.surface3,
                border: `1px solid ${C.border}`,
                borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 12, color: C.textMuted, fontWeight: 600,
                flexShrink: 0,
              }}>
                {session.user.email?.[0]?.toUpperCase() || "U"}
              </div>
              <button
                onClick={handleLogout}
                title="登出"
                style={{
                  background: C.surface3,
                  border: `1px solid ${C.border}`,
                  borderRadius: 8,
                  padding: "5px 10px",
                  color: C.textMuted,
                  fontSize: 11,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  transition: "border-color 0.2s, color 0.2s",
                }}
                onMouseEnter={e => { e.target.style.borderColor = C.red; e.target.style.color = C.red; }}
                onMouseLeave={e => { e.target.style.borderColor = C.border; e.target.style.color = C.textMuted; }}
              >
                登出
              </button>
            </div>
          </div>
        </div>

        {/* ── 主內容區 ─────────────────────────────────────── */}
        <div style={{ padding: "16px 12px", maxWidth: 1100, margin: "0 auto" }}>

          {/* Tab 導覽列（手機上可橫向捲動） */}
          <div style={{
            display: "flex", gap: 6, marginBottom: 20, paddingBottom: 16, borderBottom: `1px solid ${C.border}`,
            overflowX: "auto", overflowY: "hidden",
            scrollBehavior: "smooth",
            WebkitOverflowScrolling: "touch",
            msOverflowStyle: "none",  // IE 和 Edge 隱藏 scrollbar
            scrollbarWidth: "none",   // Firefox 隱藏 scrollbar
          }}>
            {TABS.map(t => (
              <TabBtn key={t.id} {...t} active={tab === t.id} onClick={() => setTab(t.id)} />
            ))}
          </div>

          {/* 去除 scrollbar 的 CSS */}
          <style>{`
            div::-webkit-scrollbar { display: none; }
          `}</style>

          {/* ── Tab 路由：依 tab 狀態渲染對應頁面元件 ────── */}
          {tab === "overview" && (
            <Overview
              twAssets={twAssets} usAssets={usAssets}
              cryptoAssets={cryptoAssets} otherAssets={otherAssets}
              liabilities={liabilities} snapshots={snapshots} usdRate={usdRate}
              onTabChange={setTab}
            />
          )}
          {tab === "tw"       && <TWAccount     assets={twAssets}     reload={load} />}
          {tab === "us"       && <USAccount     assets={usAssets}     usdRate={usdRate} reload={load} />}
          {tab === "crypto"   && <CryptoAccount assets={cryptoAssets} reload={load} />}
          {tab === "other"    && <OtherAccount  assets={otherAssets}  reload={load} />}
          {tab === "liab"     && <Liabilities   liabilities={liabilities} reload={load} />}
          {tab === "pledge"   && <Pledge        pledges={pledges}     reload={load} />}
          {tab === "strategy" && <Strategy      allAssets={allAssets} />}
          {tab === "fire"     && <FireDashboard allAssets={allAssets} liabilities={liabilities} cashflow={cashflow} strategies={strategies} reload={load} />}
        </div>
      </div>
    </>
  );
}
