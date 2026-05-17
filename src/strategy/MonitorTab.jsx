// ============================================================
// strategy/MonitorTab.jsx — 監控 Tab：列管股票 + 訊號摘要 + 圖表
// ============================================================

import { useState, useEffect } from "react";
import { supabase } from "../supabase";
import { C } from "../constants/theme";
import Card from "../components/ui/Card";
import { Btn, Input } from "./ui";
import { fetchTWKline, fetchUSKline } from "./klineApi";
import KChart from "./KChart";
import PreMarketSummary from "./PreMarketSummary";

// ─── 監控表單 sessionStorage 常數 ───────────────────────────────
// 頁面被瀏覽器回收（Page Discard）後重載，從 sessionStorage 還原填寫中的草稿
// 避免用戶切換視窗核對資料後回來發現表單清空
const MONITOR_FORM_DRAFT_KEY = 'wealthos_monitor_form_draft';
const MONITOR_FORM_DEFAULT = { ticker:"", is_us:false, target:0.5, j_entry:10, j_exit:90, amount:0, entry_date:"", strategy_mode:'signal', gate_pct:13 };

export default function MonitorTab({ allAssets }) {
  const [tickers, setTickers] = useState([]);
  const [klineMap, setKlineMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadingTicker, setLoadingTicker] = useState(""); // 顯示正在抓哪支
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState(null);

  // 初始化時從 sessionStorage 還原草稿（防止切換視窗後資料消失）
  const [form, setForm] = useState(() => {
    try {
      const saved = sessionStorage.getItem(MONITOR_FORM_DRAFT_KEY);
      if (saved) return { ...MONITOR_FORM_DEFAULT, ...JSON.parse(saved) };
    } catch {}
    return MONITOR_FORM_DEFAULT;
  });

  // 更新表單並同步寫入 sessionStorage
  function updateForm(patch) {
    setForm(prev => {
      const next = { ...prev, ...patch };
      try { sessionStorage.setItem(MONITOR_FORM_DRAFT_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }

  // 清除草稿（儲存成功或取消後呼叫）
  function clearFormDraft() {
    try { sessionStorage.removeItem(MONITOR_FORM_DRAFT_KEY); } catch {}
    setForm(MONITOR_FORM_DEFAULT);
  }

  async function loadTickers() {
    const { data } = await supabase.from("strategy_tickers").select("*").order("id");
    setTickers(data||[]);
    return data||[];
  }

  async function loadKlines(list) {
    setLoading(true);
    const map = {};
    // 逐一抓，顯示進度（避免同時打太多 API）
    for (const t of list) {
      setLoadingTicker(t.ticker);
      // 優先用 Supabase 快取（快）；kline-api 已修正 US stale check（D-025）
      // getKlineFromCache 內建內容新鮮度驗證（>5天拒絕）；Render 失敗時走保底快取
      map[t.ticker] = t.is_us
        ? await fetchUSKline(t.ticker, 720)
        : await fetchTWKline(t.ticker, 720);
    }
    setKlineMap(map);
    setLoadingTicker("");
    setLoading(false);
  }

  useEffect(() => {
    loadTickers().then(list => loadKlines(list));
  }, []);

  async function handleSave() {
    if (!form.ticker.trim()) return;
    if (editId) {
      await supabase.from("strategy_tickers").update(form).eq("id", editId);
    } else {
      await supabase.from("strategy_tickers").insert(form);
    }
    setShowAdd(false); setEditId(null);
    clearFormDraft(); // 儲存成功後清除 sessionStorage 草稿
    const list = await loadTickers();
    await loadKlines(list);
  }

  async function handleDelete(id) {
    await supabase.from("strategy_tickers").delete().eq("id", id);
    const list = await loadTickers();
    await loadKlines(list);
  }

  function handleEdit(t) {
    const editForm = { ticker:t.ticker, is_us:t.is_us, target:t.target, j_entry:t.j_entry, j_exit:t.j_exit, amount:t.amount||0, entry_date:t.entry_date||"", strategy_mode:t.strategy_mode||'signal', gate_pct:t.gate_pct||13 };
    setForm(editForm);
    try { sessionStorage.setItem(MONITOR_FORM_DRAFT_KEY, JSON.stringify(editForm)); } catch {}
    setEditId(t.id);
    setShowAdd(true);
  }

  return (
    <div>
      <div className="wos-monitor-header" style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16}}>
        <div>
          <div style={{fontWeight:700, fontSize:15, color:C.text}}>再平衡訊號監控</div>
          <div style={{color:C.textMuted, fontSize:12, marginTop:2}}>布林通道 (20,2) + KDJ (9,3,3)｜還原股價｜箭頭標記為訊號觸發點</div>
        </div>
        <Btn onClick={()=>{
          if (showAdd) { clearFormDraft(); setEditId(null); } // 取消時清除草稿
          setShowAdd(!showAdd);
        }}>
          {showAdd ? "✕ 取消" : "+ 新增股票"}
        </Btn>
      </div>

      {showAdd && (
        <Card style={{padding:16, marginBottom:16}}>
          <div style={{fontWeight:600, fontSize:13, marginBottom:12, color:C.accent}}>{editId?"編輯股票":"新增監控股票"}</div>
          <div className="wos-grid-form">
            <div>
              <div style={{fontSize:11, color:C.textMuted, marginBottom:4}}>股票代號</div>
              <Input value={form.ticker} onChange={e=>updateForm({ticker:e.target.value.toUpperCase()})} placeholder="如 00675L / QLD" style={{width:"100%"}}/>
            </div>
            <div>
              <div style={{fontSize:11, color:C.textMuted, marginBottom:4}}>市場</div>
              <select value={form.is_us} onChange={e=>updateForm({is_us:e.target.value==="true"})}
                style={{background:C.surface2, border:`1px solid ${C.border}`, color:C.text, borderRadius:8, padding:"7px 10px", fontSize:12, width:"100%"}}>
                <option value="false">台股</option>
                <option value="true">美股</option>
              </select>
            </div>
            <div>
              <div style={{fontSize:11, color:C.textMuted, marginBottom:4}}>目標佔比</div>
              <Input type="number" value={form.target} onChange={e=>updateForm({target:parseFloat(e.target.value)})} placeholder="0.5 = 50%" style={{width:"100%"}}/>
            </div>
            <div>
              <div style={{fontSize:11, color:C.textMuted, marginBottom:4}}>J值進場閾值</div>
              <Input type="number" value={form.j_entry} onChange={e=>updateForm({j_entry:parseFloat(e.target.value)})} style={{width:"100%"}}/>
            </div>
            <div>
              <div style={{fontSize:11, color:C.textMuted, marginBottom:4}}>J值出場閾值</div>
              <Input type="number" value={form.j_exit} onChange={e=>updateForm({j_exit:parseFloat(e.target.value)})} style={{width:"100%"}}/>
            </div>
            <div>
              <div style={{fontSize:11, color:C.textMuted, marginBottom:4}}>策略模式</div>
              <select value={form.strategy_mode} onChange={e=>updateForm({strategy_mode:e.target.value})}
                style={{background:C.surface2, border:`1px solid ${C.border}`, color:C.text, borderRadius:8, padding:"7px 10px", fontSize:12, width:"100%"}}>
                <option value="signal">原訊號再平衡（KDJ+布林）</option>
                <option value="asymmetric">⚡ P-002 非對稱（KDJ買+偏移賣）</option>
                <option value="p007">🔒 P-007 雙重確認（訊號＋偏離≥gate）</option>
              </select>
            </div>
            {form.strategy_mode === 'p007' && (
              <div>
                <div style={{fontSize:11, color:C.textMuted, marginBottom:4}}>Gate 偏離門檻（%）</div>
                <Input type="number" value={form.gate_pct} onChange={e=>updateForm({gate_pct:parseInt(e.target.value)||13})} style={{width:"100%"}} placeholder="預設 13（美股建議 13，台股建議 20）"/>
              </div>
            )}
            <div>
              {/* 幣別跟著市場走：美股填 USD，台股填 NT$ — 與資產頁面一致 */}
              <div style={{fontSize:11, color:C.textMuted, marginBottom:4}}>
                進場金額 ({form.is_us ? "USD" : "NT$"})
              </div>
              <Input type="number" value={form.amount} onChange={e=>updateForm({amount:parseFloat(e.target.value)||0})} style={{width:"100%"}}
                placeholder={form.is_us ? "如 10000 (USD)" : "如 500000 (NT$)"}/>
            </div>
            <div>
              <div style={{fontSize:11, color:C.textMuted, marginBottom:4}}>進場日期（策略模擬起算）</div>
              <Input type="date" value={form.entry_date||""} onChange={e=>updateForm({entry_date:e.target.value})} style={{width:"100%", colorScheme:"dark"}}/>
              <div style={{fontSize:10, color:C.textMuted, marginTop:3}}>填入後顯示策略模擬 vs 實際庫存對比</div>
            </div>
          </div>
          <Btn onClick={handleSave}>{editId?"儲存修改":"確認新增"}</Btn>
        </Card>
      )}

      {tickers.length > 0 && (
        <div style={{display:"flex", gap:8, flexWrap:"wrap", marginBottom:16}}>
          {tickers.map(t => (
            <div key={t.id} style={{display:"flex", alignItems:"center", gap:6, background:C.surface2, border:`1px solid ${C.border}`, borderRadius:8, padding:"6px 10px"}}>
              <span style={{fontWeight:600, fontSize:13}}>{t.ticker}</span>
              <span style={{color:C.textMuted, fontSize:11}}>{t.is_us?"美股":"台股"}</span>
              <span style={{color:C.textMuted, fontSize:11}}>J:{t.j_entry}/{t.j_exit}</span>
              {(t.strategy_mode||'signal')==='asymmetric' && <span style={{color:C.orange, fontSize:10, fontWeight:600}}>⚡非對稱</span>}
              {(t.strategy_mode||'signal')==='p007' && <span style={{color:"#FFD700", fontSize:10, fontWeight:600}}>🔒雙重(gate={t.gate_pct||13}%)</span>}
              <button onClick={()=>handleEdit(t)} style={{background:"none", border:"none", color:C.blue, cursor:"pointer", fontSize:11, padding:"0 2px"}}>編輯</button>
              <button onClick={()=>handleDelete(t.id)} style={{background:"none", border:"none", color:C.red, cursor:"pointer", fontSize:11, padding:"0 2px"}}>✕</button>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div style={{textAlign:"center", padding:40, color:C.accent}}>
          <div style={{marginBottom:8}}>抓取還原K線資料中...</div>
          {loadingTicker && <div style={{color:C.textMuted, fontSize:13}}>{loadingTicker} 處理中</div>}
        </div>
      ) : (
        <>
          <PreMarketSummary tickers={tickers} klineMap={klineMap} allAssets={allAssets} />
          {tickers.map(t => {
            const _cashName = t.is_us ? 'USD' : '現金';
            const _holding  = allAssets.find(a => a.name === t.ticker);
            const _cash     = allAssets.find(a => a.name === _cashName);
            const _pool     = (_holding?.value_twd || 0) + (_cash?.value_twd || 0);
            const _drift    = _pool > 0
              ? Math.abs((_holding?.value_twd || 0) / _pool * 100 - t.target * 100)
              : 0;
            return (
              <KChart
                key={t.id}
                data={klineMap[t.ticker]||[]}
                ticker={t.ticker}
                isUS={t.is_us}
                assets={allAssets}
                target={t.target}
                jEntry={t.j_entry}
                jExit={t.j_exit}
                strategyMode={t.strategy_mode||'signal'}
                driftPct={25}
                gatePct={t.gate_pct||13}
                tickerConfig={t}
                currentDrift={_drift}
              />
            );
          })}
        </>
      )}
    </div>
  );
}
