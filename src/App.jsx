import Strategy from "./Strategy";
import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabase";
import {
  AreaChart, Area, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, ReferenceLine
} from "recharts";

// ── 色彩 ─────────────────────────────────────────────────
const C = {
  bg: "#080C14", surface: "#0F1623", surface2: "#162030",
  border: "#1C2E45", accent: "#00C896", accentDim: "#00C89618",
  red: "#FF4D6D", redDim: "#FF4D6D18", gold: "#F5A623", goldDim: "#F5A62318",
  blue: "#4D9EFF", blueDim: "#4D9EFF18", purple: "#9B6DFF", orange: "#FF8C42",
  text: "#E2EAF4", textMuted: "#5A7399",
};
// ── 槓桿 ─────────────────────────────────────────────────
const LEVERAGE_MAP = {
  "00675L": 2, "00631L": 2, "00633L": 2, "00685L": 2,
  "QLD": 2, "TQQQ": 3, "SOXL": 3, "UPRO": 3, "SPXL": 3, "TECL": 3, "SSO": 2, "UDOW": 3,
};
// ── API Token ─────────────────────────────────────────────
const FINMIND_TOKEN = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1c2VyX2lkIjoiaHVodSIsImVtYWlsIjoiZXIwMDU2Nzg5MEBnbWFpbC5jb20ifQ.QJ3r5o23EqtdPJM_elCOMwjPKg4ivYyaGQNvYadejvs";

// ── 工具函數 ──────────────────────────────────────────────
const fmt = (n, d = 0) => Math.abs(n).toLocaleString("zh-TW", { maximumFractionDigits: d });
const fmtM = (n) => n >= 1000000 ? `${(n / 1000000).toFixed(2)}M` : `${(n / 1000).toFixed(0)}K`;
const pct = (n, d = 1) => `${(n * 100).toFixed(d)}%`;
const TT = { contentStyle: { background: "#162030", border: "1px solid #1C2E45", borderRadius: 8, color: "#E2EAF4", fontSize: 12 } };

// ── 價格抓取 API ──────────────────────────────────────────
async function fetchTWPrice(stockId) {
  try {
    const end = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const url = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${stockId}&start_date=${start}&end_date=${end}&token=${FINMIND_TOKEN}`;
    const res = await fetch(url);
    const json = await res.json();
    if (json.data?.length > 0) return json.data[json.data.length - 1].close;
  } catch { }
  return null;
}

async function fetchUSPrice(ticker) {
  try {
    const end = new Date().toISOString().slice(0,10);
    const start = new Date(Date.now()-7*86400000).toISOString().slice(0,10);
    const url = `https://api.finmindtrade.com/api/v4/data?dataset=USStockPrice&data_id=${ticker}&start_date=${start}&end_date=${end}&token=${FINMIND_TOKEN}`;
    const res = await fetch(url);
    const json = await res.json();
    if(json.data?.length>0) return json.data[json.data.length-1].Close;
  } catch {}
  return null;
}

async function fetchCryptoPrice(coinId) {
  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=twd`;
    const res = await fetch(url);
    const json = await res.json();
    return json[coinId]?.twd || null;
  } catch { }
  return null;
}

async function fetchUSDTWD() {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/USDTWD=X?interval=1d&range=5d`;
    const res = await fetch(url);
    const json = await res.json();
    const closes = json.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
    if (closes?.length > 0) return closes.filter(Boolean).pop();
  } catch { }
  return 31.5;
}

// ── 基本元件 ──────────────────────────────────────────────
function Card({ children, style = {} }) {
  return <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, ...style }}>{children}</div>;
}

function KPI({ label, value, sub, color = C.accent, prefix = "NT$" }) {
  return (
    <Card style={{ padding: "14px 18px", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, left: 0, width: 3, height: "100%", background: color, borderRadius: "14px 0 0 14px" }} />
      <div style={{ color: C.textMuted, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 5 }}>{label}</div>
      <div style={{ color, fontSize: 18, fontWeight: 700, fontFamily: "monospace" }}>{prefix}{typeof value === "number" ? fmt(value) : value}</div>
      {sub && <div style={{ color: C.textMuted, fontSize: 11, marginTop: 3 }}>{sub}</div>}
    </Card>
  );
}

function TabBtn({ label, icon, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      background: active ? C.accentDim : "transparent",
      border: `1px solid ${active ? C.accent : C.border}`,
      color: active ? C.accent : C.textMuted,
      borderRadius: 8, padding: "7px 13px", cursor: "pointer", fontSize: 12,
      fontWeight: active ? 600 : 400, display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap",
    }}>{icon} {label}</button>
  );
}

function Inp({ label, value, onChange, placeholder, type = "text" }) {
  return (
    <div>
      {label && <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 3 }}>{label}</div>}
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder || ""}
        style={{
          background: C.bg, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8,
          padding: "7px 10px", fontSize: 12, outline: "none", width: "100%", boxSizing: "border-box"
        }} />
    </div>
  );
}

function Sel({ label, value, onChange, options }) {
  return (
    <div>
      {label && <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 3 }}>{label}</div>}
      <select value={value} onChange={e => onChange(e.target.value)}
        style={{
          background: C.bg, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8,
          padding: "7px 10px", fontSize: 12, width: "100%", boxSizing: "border-box"
        }}>
        {options.map(o => <option key={o}>{o}</option>)}
      </select>
    </div>
  );
}

function Btn({ children, onClick, color = C.accent, outline = false, small = false, disabled = false }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background: outline ? "transparent" : disabled ? "#2a3a4a" : color,
      border: `1px solid ${outline ? C.border : disabled ? "#2a3a4a" : color}`,
      color: outline ? C.textMuted : disabled ? C.textMuted : (color === C.red ? "#fff" : "#08080C"),
      borderRadius: 8, padding: small ? "4px 10px" : "7px 14px",
      cursor: disabled ? "not-allowed" : "pointer", fontSize: small ? 11 : 12,
      fontWeight: outline ? 400 : 700, whiteSpace: "nowrap",
    }}>{children}</button>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "#000000BB", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 24, width: "100%", maxWidth: 540, maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{title}</div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: C.textMuted, cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Badge({ text, color = C.accent }) {
  return <span style={{ background: color + "20", color, border: `1px solid ${color}40`, borderRadius: 5, padding: "1px 7px", fontSize: 10, fontWeight: 600 }}>{text}</span>;
}

// ══════════════════════════════════════════════════════════
// 總覽
// ══════════════════════════════════════════════════════════
function Overview({ twAssets, usAssets, cryptoAssets, otherAssets, liabilities, snapshots, usdRate }) {
  const twTotal = twAssets.reduce((s, x) => s + x.value_twd, 0);
  const usTotal = usAssets.reduce((s, x) => s + x.value_twd, 0);
  const cryptoTotal = cryptoAssets.reduce((s, x) => s + x.value_twd, 0);
  const otherTotal = otherAssets.reduce((s, x) => s + x.value_twd, 0);
  const totalAssets = twTotal + usTotal + cryptoTotal + otherTotal;
  const totalLiab = liabilities.reduce((s, x) => s + x.value, 0);
  const netWorth = totalAssets - totalLiab;
  const leverage = netWorth > 0 ? totalAssets / netWorth : 0;
  const debtRatio = totalAssets > 0 ? totalLiab / totalAssets : 0;

  // 實際曝險（含ETF內含槓桿）
  const actualExposure = [...twAssets, ...usAssets].reduce((s, x) => s + (x.value_twd || 0) * (x.leverage_ratio || 1), 0) + cryptoTotal + otherTotal;
  const actualLeverage = netWorth > 0 ? actualExposure / netWorth : 0;

  const totalCost = [...twAssets, ...usAssets, ...cryptoAssets].reduce((s, x) => s + (x.cost_total || 0), 0);
  const totalPnl = [...twAssets,...usAssets,...cryptoAssets].reduce((s,x)=>{
  const ct = x.cost_total||(x.cost||0)*(x.shares||0);
  return ct>0 ? s+(x.value_twd-ct) : s;
},0);
  const totalPnlPct = totalCost > 0 ? totalPnl / totalCost * 100 : 0;

  const pieData = [
    { name: "台股", value: twTotal },
    { name: "美股", value: usTotal },
    { name: "加密貨幣", value: cryptoTotal },
    { name: "其他", value: otherTotal },
  ].filter(x => x.value > 0);
  const pieColors = [C.accent, C.blue, C.gold, C.purple];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10 }}>
        <KPI label="總淨值" value={netWorth} color={C.accent} />
        <KPI label="總資產" value={totalAssets} color={C.blue} />
        <KPI label="總負債" value={totalLiab} color={C.red} />
        <KPI label="財務槓桿" value={leverage.toFixed(2) + "x"} prefix="" color={C.gold} sub={`負債比 ${pct(debtRatio)}`} />
        <KPI label="實際曝險倍率" value={actualLeverage.toFixed(2) + "x"} prefix="" color={C.orange} sub="含ETF內含槓桿" />
        <KPI label="未實現損益" value={totalPnl} prefix="" color={totalPnl >= 0 ? C.accent : C.red}
          sub={`${totalPnl >= 0 ? "+" : ""}NT$${fmt(totalPnl)} (${totalPnlPct >= 0 ? "+" : ""}${totalPnlPct.toFixed(1)}%)`} />
        <KPI label="匯率 USD/TWD" value={usdRate.toFixed(2)} prefix="" color={C.textMuted} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {[
          { label: "台股", value: twTotal, color: C.accent },
          { label: "美股", value: usTotal, color: C.blue },
          { label: "加密貨幣", value: cryptoTotal, color: C.gold },
          { label: "其他", value: otherTotal, color: C.purple },
        ].map(x => (
          <Card key={x.label} style={{ padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ color: C.textMuted, fontSize: 12 }}>{x.label}</div>
            <div>
              <div style={{ color: x.color, fontFamily: "monospace", fontWeight: 700, fontSize: 14 }}>NT${fmt(x.value)}</div>
              <div style={{ color: C.textMuted, fontSize: 10, textAlign: "right" }}>{totalAssets > 0 ? pct(x.value / totalAssets) : "-"}</div>
            </div>
          </Card>
        ))}
      </div>

      {snapshots.length > 0 ? (
        <Card style={{ padding: 18 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 14 }}>資產 / 負債 / 淨值 / 槓桿 趨勢</div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={snapshots}>
              <defs>
                {[["net", C.accent], ["assets", C.blue], ["liabilities", C.red]].map(([k, c]) => (
                  <linearGradient key={k} id={`g${k}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={c} stopOpacity={0.2} />
                    <stop offset="95%" stopColor={c} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey="date" tick={{ fill: C.textMuted, fontSize: 10 }} tickLine={false} />
              <YAxis yAxisId="left" tick={{ fill: C.textMuted, fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => `${(v / 1000000).toFixed(1)}M`} />
              <YAxis yAxisId="right" orientation="right" tick={{ fill: C.orange, fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => `${v.toFixed(1)}x`} />
              <Tooltip {...TT} formatter={(v, n) => n === "leverage" ? [`${v.toFixed(2)}x`, "財務槓桿"] : [`NT$${fmtM(v)}`, n === "net" ? "淨值" : n === "assets" ? "總資產" : "總負債"]} />
              <Area yAxisId="left" type="monotone" dataKey="liabilities" stroke={C.red} strokeWidth={1.5} fill="url(#gliabilities)" dot={false} />
              <Area yAxisId="left" type="monotone" dataKey="assets" stroke={C.blue} strokeWidth={1.5} fill="url(#gassets)" dot={false} />
              <Area yAxisId="left" type="monotone" dataKey="net" stroke={C.accent} strokeWidth={2.5} fill="url(#gnet)" dot={{ fill: C.accent, r: 3 }} />
              <Line yAxisId="right" type="monotone" dataKey="leverage" stroke={C.orange} strokeWidth={2} dot={false} strokeDasharray="4 2" />
            </AreaChart>
          </ResponsiveContainer>
          <div style={{ display: "flex", gap: 14, justifyContent: "flex-end", marginTop: 6 }}>
            {[["淨值", C.accent], ["總資產", C.blue], ["總負債", C.red], ["財務槓桿", C.orange]].map(([l, c]) => (
              <div key={l} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <div style={{ width: 14, height: 2, background: c }} /><span style={{ color: C.textMuted, fontSize: 10 }}>{l}</span>
              </div>
            ))}
          </div>
        </Card>
      ) : (
        <Card style={{ padding: 24, textAlign: "center" }}>
          <div style={{ color: C.textMuted, fontSize: 13 }}>快照每日自動產生，資料累積後這裡會顯示趨勢圖</div>
        </Card>
      )}

      {pieData.length > 0 && (
        <Card style={{ padding: 18 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>資產配置</div>
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={4} dataKey="value">
                {pieData.map((_, i) => <Cell key={i} fill={pieColors[i]} />)}
              </Pie>
              <Tooltip {...TT} formatter={v => `NT$${fmtM(v)}`} />
              <Legend formatter={v => <span style={{ color: C.textMuted, fontSize: 11 }}>{v}</span>} />
            </PieChart>
          </ResponsiveContainer>
        </Card>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// 台股帳戶
// ══════════════════════════════════════════════════════════
const emptyTW = {type:"etf",name:"",ticker:"",shares:"",price:"",cost:"",value_twd:"",target:"",leverage_ratio:"1",note:""};

function TWAccount({assets,reload}) {
  const [modal,setModal] = useState(null);
  const [form,setForm] = useState(emptyTW);
  const [saving,setSaving] = useState(false);
  const [fetching,setFetching] = useState(false);
  const [fetchMsg,setFetchMsg] = useState("");
  const set = k => v => setForm(p=>({...p,[k]:v}));

  const handleChange = (k,v) => {
    const next = {...form,[k]:v};
    const shares = parseFloat(k==="shares"?v:next.shares)||0;
    const price = parseFloat(k==="price"?v:next.price)||0;
    if(shares>0&&price>0) next.value_twd = String((shares*price).toFixed(0));
    setForm(next);
  };

  const openAdd = () => { setForm(emptyTW); setModal("add"); };
  const openEdit = a => {
    setForm({
      type:a.type||"etf", name:a.name, ticker:a.ticker||"",
      shares:String(a.shares||""), price:String(a.price||""),
      cost:String(a.cost||""), value_twd:String(a.value_twd||""),
      target:String(a.target>0?a.target*100:""),
      leverage_ratio:String(a.leverage_ratio||1),
      note:a.note||""
    });
    setModal(a);
  };

  const save = async () => {
    setSaving(true);
    const shares = parseFloat(form.shares)||0;
    const cost = parseFloat(form.cost)||0;
    const data = {
      account:"tw", type:form.type, name:form.name, ticker:form.ticker,
      shares, price:parseFloat(form.price)||0,
      cost, cost_total:cost*shares,
      value_twd:parseFloat(form.value_twd)||0,
      target:(parseFloat(form.target)||0)/100,
      leverage_ratio:parseFloat(form.leverage_ratio)||1,
      note:form.note,
    };
    if(modal==="add") await supabase.from("assets").insert(data);
    else await supabase.from("assets").update(data).eq("id",modal.id);
    setSaving(false); setModal(null); reload();
  };

  const del = async id => {
    if(!window.confirm("確定刪除？")) return;
    await supabase.from("assets").delete().eq("id",id);
    reload();
  };

  const refreshPrices = async () => {
    setFetching(true); setFetchMsg("抓取股價中...");
    const etfs = assets.filter(a=>a.ticker&&a.type==="etf");
    for(const a of etfs) {
      const price = await fetchTWPrice(a.ticker);
      if(price) {
        const value_twd = price*(a.shares||0);
        await supabase.from("assets").update({price,value_twd}).eq("id",a.id);
        setFetchMsg(`✅ ${a.ticker}: NT$${price}`);
      }
    }
    setFetching(false); setFetchMsg("✅ 更新完成");
    setTimeout(()=>setFetchMsg(""),3000);
    reload();
  };

  const etfs = assets.filter(a=>a.type==="etf");
  const cash = assets.filter(a=>a.type==="cash");
  const total = assets.reduce((s,x)=>s+(x.value_twd||0),0);

  const renderPnl = a => {
    const ct = a.cost_total||(a.cost||0)*(a.shares||0);
    if(!ct) return null;
    const pnl = a.value_twd-ct;
    const pp = pnl/ct*100;
    return <div style={{fontSize:11,color:pnl>=0?C.accent:C.red}}>{pnl>=0?"+":""}{fmt(pnl)} ({pp>=0?"+":""}{pp.toFixed(1)}%)</div>;
  };

  const renderAllocation = a => {
    if(!total) return null;
    const actual = a.value_twd/total*100;
    const target = (a.target||0)*100;
    if(!target) return <div style={{color:C.textMuted,fontSize:10}}>{actual.toFixed(1)}%</div>;
    const diff = actual - target;
    const diffAmt = (a.value_twd) - (target/100*total);
    return (
      <div style={{fontSize:10,textAlign:"right"}}>
        <div style={{color:C.textMuted}}>實際 {actual.toFixed(1)}% ｜ 目標 {target.toFixed(1)}%</div>
        <div style={{color:diff>0?C.red:C.accent}}>
          {diff>0?"▲":"▼"} {Math.abs(diff).toFixed(1)}% （{diff>0?"賣出":"買入"} NT${fmt(Math.abs(diffAmt))}）
        </div>
      </div>
    );
  };

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
        <KPI label="台股總值" value={total} color={C.accent}/>
        <KPI label="ETF/股票" value={etfs.reduce((s,x)=>s+x.value_twd,0)} color={C.blue}/>
        <KPI label="台幣現金" value={cash.reduce((s,x)=>s+x.value_twd,0)} color={C.purple}/>
      </div>

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div style={{fontWeight:600,fontSize:14}}>ETF / 股票</div>
        <div style={{display:"flex",gap:8}}>
          {fetchMsg&&<span style={{color:C.accent,fontSize:12,alignSelf:"center"}}>{fetchMsg}</span>}
          <Btn onClick={refreshPrices} color={C.blue} outline disabled={fetching}>🔄 更新股價</Btn>
          <Btn onClick={openAdd}>+ 新增</Btn>
        </div>
      </div>

      {etfs.map(a=>(
        <Card key={a.id} style={{padding:"12px 16px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div>
              <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:3}}>
                <span style={{fontWeight:600,fontSize:14}}>{a.name}</span>
                {a.ticker&&<Badge text={a.ticker} color={C.blue}/>}
                {(a.leverage_ratio||1)>1&&<Badge text={`${a.leverage_ratio}x槓桿`} color={C.orange}/>}
              </div>
              <div style={{color:C.textMuted,fontSize:11}}>
                {a.shares>0&&`${a.shares.toLocaleString()} 股`}
                {a.price>0&&` × NT$${a.price}`}
                {a.cost>0&&` ｜ 成本 NT$${a.cost}`}
              </div>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <div style={{textAlign:"right"}}>
                <div style={{color:C.accent,fontFamily:"monospace",fontWeight:700,fontSize:14}}>NT${fmt(a.value_twd)}</div>
                {renderPnl(a)}
                {renderAllocation(a)}
              </div>
              <Btn onClick={()=>openEdit(a)} outline small>編輯</Btn>
              <Btn onClick={()=>del(a.id)} color={C.red} outline small>刪除</Btn>
            </div>
          </div>
        </Card>
      ))}

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:8}}>
        <div style={{fontWeight:600,fontSize:14}}>台幣現金</div>
        <Btn onClick={()=>{setForm({...emptyTW,type:"cash"});setModal("add");}}>+ 新增</Btn>
      </div>

      {cash.map(a=>(
        <Card key={a.id} style={{padding:"12px 16px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div>
              <div style={{fontWeight:600,fontSize:14,marginBottom:3}}>{a.name}</div>
              <div style={{color:C.textMuted,fontSize:11}}>{a.note}</div>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <div style={{textAlign:"right"}}>
                <div style={{color:C.purple,fontFamily:"monospace",fontWeight:700,fontSize:14}}>NT${fmt(a.value_twd)}</div>
                {renderAllocation(a)}
              </div>
              <Btn onClick={()=>openEdit(a)} outline small>編輯</Btn>
              <Btn onClick={()=>del(a.id)} color={C.red} outline small>刪除</Btn>
            </div>
          </div>
        </Card>
      ))}

      {modal&&(
        <Modal title={modal==="add"?"新增項目":"編輯項目"} onClose={()=>setModal(null)}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
            <Sel label="類型" value={form.type} onChange={set("type")} options={["etf","cash"]}/>
            <Inp label="名稱" value={form.name} onChange={set("name")} placeholder="e.g. 006208"/>
            {form.type==="etf"&&<>
              <Inp label="股票代號" value={form.ticker} onChange={v=>{set("ticker")(v); set("leverage_ratio")(String(LEVERAGE_MAP[v.toUpperCase()]||1));}} placeholder="e.g. 006208"/>
              <Inp label="股數" type="number" value={form.shares} onChange={v=>handleChange("shares",v)} placeholder="0"/>
              <Inp label="現價 (NT$)" type="number" value={form.price} onChange={v=>handleChange("price",v)} placeholder="0"/>
              <Inp label="成本價 (NT$)" type="number" value={form.cost} onChange={set("cost")} placeholder="0"/>
              <Inp label="目標佔比 (%)" type="number" value={form.target} onChange={set("target")} placeholder="e.g. 50"/>
              <Inp label="槓桿倍數" type="number" value={form.leverage_ratio} onChange={set("leverage_ratio")} placeholder="1"/>
            </>}
            {form.type==="cash"&&<>
              <Inp label="目標佔比 (%)" type="number" value={form.target} onChange={set("target")} placeholder="e.g. 50"/>
            </>}
            <Inp label="市值 (NT$)" type="number" value={form.value_twd} onChange={set("value_twd")} placeholder="0"/>
            <Inp label="備註" value={form.note} onChange={set("note")} placeholder="選填"/>
          </div>
          <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
            <Btn onClick={()=>setModal(null)} outline>取消</Btn>
            <Btn onClick={save}>{saving?"儲存中...":"確認儲存"}</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// 美股帳戶
// ══════════════════════════════════════════════════════════
const emptyUS = {type:"etf",name:"",ticker:"",shares:"",price_usd:"",cost:"",value_usd:"",target:"",leverage_ratio:"1",note:""};

function USAccount({assets,usdRate,reload}) {
  const [modal,setModal] = useState(null);
  const [form,setForm] = useState(emptyUS);
  const [saving,setSaving] = useState(false);
  const [fetching,setFetching] = useState(false);
  const [fetchMsg,setFetchMsg] = useState("");
  const set = k => v => setForm(p=>({...p,[k]:v}));

  const handleChange = (k,v) => {
    const next = {...form,[k]:v};
    const shares = parseFloat(k==="shares"?v:next.shares)||0;
    const price = parseFloat(k==="price_usd"?v:next.price_usd)||0;
    if(shares>0&&price>0) next.value_usd = String((shares*price).toFixed(2));
    setForm(next);
  };

  const openAdd = () => { setForm(emptyUS); setModal("add"); };
  const openEdit = a => {
    setForm({
      type:a.type||"etf", name:a.name, ticker:a.ticker||"",
      shares:String(a.shares||""), price_usd:String(a.price_usd||""),
      cost:String(a.cost||""), value_usd:String(a.value_usd||""),
      target:String(a.target>0?a.target*100:""),
      leverage_ratio:String(a.leverage_ratio||1),
      note:a.note||""
    });
    setModal(a);
  };

  const save = async () => {
    setSaving(true);
    const shares = parseFloat(form.shares)||0;
    const cost = parseFloat(form.cost)||0;
    const value_usd = parseFloat(form.value_usd)||0;
    const data = {
      account:"us", type:form.type, name:form.name, ticker:form.ticker,
      shares, price_usd:parseFloat(form.price_usd)||0,
      cost, cost_total:cost*shares*usdRate,
      value_usd, value_twd:value_usd*usdRate,
      target:(parseFloat(form.target)||0)/100,
      leverage_ratio:parseFloat(form.leverage_ratio)||1,
      note:form.note,
    };
    if(modal==="add") await supabase.from("assets").insert(data);
    else await supabase.from("assets").update(data).eq("id",modal.id);
    setSaving(false); setModal(null); reload();
  };

  const del = async id => {
    if(!window.confirm("確定刪除？")) return;
    await supabase.from("assets").delete().eq("id",id);
    reload();
  };

  const refreshPrices = async () => {
    setFetching(true); setFetchMsg("抓取股價中...");
    const etfs = assets.filter(a=>a.ticker&&a.type==="etf");
    for(const a of etfs) {
      const price = await fetchUSPrice(a.ticker);
      if(price) {
        const value_usd = price*(a.shares||0);
        const value_twd = value_usd*usdRate;
        await supabase.from("assets").update({price_usd:price,value_usd,value_twd}).eq("id",a.id);
        setFetchMsg(`✅ ${a.ticker}: $${price.toFixed(2)}`);
      }
    }
    setFetching(false); setFetchMsg("✅ 更新完成");
    setTimeout(()=>setFetchMsg(""),3000);
    reload();
  };

  const etfs = assets.filter(a=>a.type==="etf");
  const cash = assets.filter(a=>a.type==="cash");
  const total = assets.reduce((s,x)=>s+(x.value_twd||0),0);
  const totalUSD = assets.reduce((s,x)=>s+(x.value_usd||x.value_twd/usdRate),0);

  const renderPnl = a => {
    const ct = a.cost_total||(a.cost||0)*(a.shares||0)*usdRate;
    if(!ct) return null;
    const pnl = a.value_twd-ct;
    const pp = pnl/ct*100;
    return <div style={{fontSize:11,color:pnl>=0?C.accent:C.red}}>{pnl>=0?"+":""}{fmt(pnl)} ({pp>=0?"+":""}{pp.toFixed(1)}%)</div>;
  };

  const renderAllocation = a => {
    if(!total) return null;
    const actual = a.value_twd/total*100;
    const target = (a.target||0)*100;
    if(!target) return <div style={{color:C.textMuted,fontSize:10}}>{actual.toFixed(1)}%</div>;
    const diff = actual - target;
    const diffAmt = a.value_twd - (target/100*total);
    return (
      <div style={{fontSize:10,textAlign:"right"}}>
        <div style={{color:C.textMuted}}>實際 {actual.toFixed(1)}% ｜ 目標 {target.toFixed(1)}%</div>
        <div style={{color:diff>0?C.red:C.accent}}>
          {diff>0?"▲":"▼"} {Math.abs(diff).toFixed(1)}% （{diff>0?"賣出":"買入"} NT${fmt(Math.abs(diffAmt))}）
        </div>
      </div>
    );
  };

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
        <KPI label="美股總值(TWD)" value={total} color={C.blue}/>
        <KPI label="美股總值(USD)" value={totalUSD.toFixed(0)} prefix="$" color={C.blue}/>
        <KPI label="匯率 USD/TWD" value={usdRate.toFixed(2)} prefix="" color={C.textMuted}/>
      </div>

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div style={{fontWeight:600,fontSize:14}}>ETF / 股票</div>
        <div style={{display:"flex",gap:8}}>
          {fetchMsg&&<span style={{color:C.accent,fontSize:12,alignSelf:"center"}}>{fetchMsg}</span>}
          <Btn onClick={refreshPrices} color={C.blue} outline disabled={fetching}>🔄 更新股價</Btn>
          <Btn onClick={openAdd}>+ 新增</Btn>
        </div>
      </div>

      {etfs.map(a=>(
        <Card key={a.id} style={{padding:"12px 16px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div>
              <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:3}}>
                <span style={{fontWeight:600,fontSize:14}}>{a.name}</span>
                {a.ticker&&<Badge text={a.ticker} color={C.blue}/>}
                {(a.leverage_ratio||1)>1&&<Badge text={`${a.leverage_ratio}x槓桿`} color={C.orange}/>}
              </div>
              <div style={{color:C.textMuted,fontSize:11}}>
                {a.shares>0&&`${a.shares} 股`}
                {a.price_usd>0&&` × $${a.price_usd}`}
                {a.cost>0&&` ｜ 成本 $${a.cost}`}
              </div>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <div style={{textAlign:"right"}}>
                <div style={{color:C.blue,fontFamily:"monospace",fontWeight:700,fontSize:14}}>NT${fmt(a.value_twd)}</div>
                <div style={{color:C.textMuted,fontSize:11}}>${(a.value_usd||0).toFixed(2)}</div>
                {renderPnl(a)}
                {renderAllocation(a)}
              </div>
              <Btn onClick={()=>openEdit(a)} outline small>編輯</Btn>
              <Btn onClick={()=>del(a.id)} color={C.red} outline small>刪除</Btn>
            </div>
          </div>
        </Card>
      ))}

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:8}}>
        <div style={{fontWeight:600,fontSize:14}}>美金現金</div>
        <Btn onClick={()=>{setForm({...emptyUS,type:"cash"});setModal("add");}}>+ 新增</Btn>
      </div>

      {cash.map(a=>(
        <Card key={a.id} style={{padding:"12px 16px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div>
              <div style={{fontWeight:600,fontSize:14,marginBottom:3}}>{a.name}</div>
              <div style={{color:C.textMuted,fontSize:11}}>${(a.value_usd||0).toFixed(2)} USD</div>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <div style={{textAlign:"right"}}>
                <div style={{color:C.purple,fontFamily:"monospace",fontWeight:700,fontSize:14}}>NT${fmt(a.value_twd)}</div>
                {renderAllocation(a)}
              </div>
              <Btn onClick={()=>openEdit(a)} outline small>編輯</Btn>
              <Btn onClick={()=>del(a.id)} color={C.red} outline small>刪除</Btn>
            </div>
          </div>
        </Card>
      ))}

      {modal&&(
        <Modal title={modal==="add"?"新增項目":"編輯項目"} onClose={()=>setModal(null)}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
            <Sel label="類型" value={form.type} onChange={set("type")} options={["etf","cash"]}/>
            <Inp label="名稱" value={form.name} onChange={set("name")} placeholder="e.g. VT"/>
            {form.type==="etf"&&<>
              <Inp label="股票代號" value={form.ticker} onChange={v=>{set("ticker")(v); set("leverage_ratio")(String(LEVERAGE_MAP[v.toUpperCase()]||1));}} placeholder="e.g. VT"/>
              <Inp label="股數" type="number" value={form.shares} onChange={v=>handleChange("shares",v)} placeholder="0"/>
              <Inp label="現價 (USD)" type="number" value={form.price_usd} onChange={v=>handleChange("price_usd",v)} placeholder="0"/>
              <Inp label="成本價 (USD)" type="number" value={form.cost} onChange={set("cost")} placeholder="0"/>
              <Inp label="目標佔比 (%)" type="number" value={form.target} onChange={set("target")} placeholder="e.g. 50"/>
              <Inp label="槓桿倍數" type="number" value={form.leverage_ratio} onChange={set("leverage_ratio")} placeholder="1"/>
            </>}
            {form.type==="cash"&&<>
              <Inp label="目標佔比 (%)" type="number" value={form.target} onChange={set("target")} placeholder="e.g. 50"/>
            </>}
            <Inp label="金額 (USD)" type="number" value={form.value_usd} onChange={set("value_usd")} placeholder="0"/>
            <Inp label="備註" value={form.note} onChange={set("note")} placeholder="選填"/>
          </div>
          <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
            <Btn onClick={()=>setModal(null)} outline>取消</Btn>
            <Btn onClick={save}>{saving?"儲存中...":"確認儲存"}</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// 加密貨幣帳戶
// ══════════════════════════════════════════════════════════
const COIN_IDS = { "BTC": "bitcoin", "ETH": "ethereum", "BNB": "binancecoin", "SOL": "solana", "USDT": "tether", "USDC": "usd-coin" };
const emptyCrypto = { name: "", coin_id: "", amount: "", cost: "", note: "" };

function CryptoAccount({ assets, reload }) {
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(emptyCrypto);
  const [saving, setSaving] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetchMsg, setFetchMsg] = useState("");
  const set = k => v => setForm(p => ({ ...p, [k]: v }));

  const openAdd = () => { setForm(emptyCrypto); setModal("add"); };
  const openEdit = a => {
    setForm({ name: a.name, coin_id: a.coin_id || "", amount: String(a.shares || ""), cost: String(a.cost || ""), note: a.note || "" });
    setModal(a);
  };

  const save = async () => {
    setSaving(true);
    const amount = parseFloat(form.amount) || 0;
    const cost = parseFloat(form.cost) || 0;
    const data = {
      account: "crypto", type: "crypto", name: form.name, coin_id: form.coin_id,
      shares: amount, cost, cost_total: cost * amount,
      value_twd: 0, note: form.note,
    };
    if (modal === "add") await supabase.from("assets").insert(data);
    else await supabase.from("assets").update(data).eq("id", modal.id);
    setSaving(false); setModal(null); reload();
  };

  const del = async id => {
    if (!window.confirm("確定刪除？")) return;
    await supabase.from("assets").delete().eq("id", id);
    reload();
  };

  const refreshPrices = async () => {
    setFetching(true); setFetchMsg("抓取幣價中...");
    const coins = assets.filter(a => a.coin_id);
    for (const a of coins) {
      const price = await fetchCryptoPrice(a.coin_id);
      if (price) {
        const value_twd = price * (a.shares || 0);
        await supabase.from("assets").update({ price_twd: price, value_twd }).eq("id", a.id);
        setFetchMsg(`✅ ${a.name}: NT$${fmt(price)}`);
      }
    }
    setFetching(false); setFetchMsg("✅ 更新完成");
    setTimeout(() => setFetchMsg(""), 3000);
    reload();
  };

  const total = assets.reduce((s, x) => s + x.value_twd, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <KPI label="加密貨幣總值" value={total} color={C.gold} />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>持倉</div>
        <div style={{ display: "flex", gap: 8 }}>
          {fetchMsg && <span style={{ color: C.accent, fontSize: 12, alignSelf: "center" }}>{fetchMsg}</span>}
          <Btn onClick={refreshPrices} color={C.gold} outline disabled={fetching}>🔄 更新幣價</Btn>
          <Btn onClick={openAdd}>+ 新增</Btn>
        </div>
      </div>

      {assets.length === 0 && <Card style={{ padding: 24, textAlign: "center" }}><div style={{ color: C.textMuted }}>尚無加密貨幣持倉</div></Card>}

      {assets.map(a => {
        const ct = a.cost_total || (a.cost || 0) * (a.shares || 0);
        const pnl = ct > 0 ? a.value_twd - ct : null;
        const pp = ct > 0 ? pnl / ct * 100 : null;
        return (
          <Card key={a.id} style={{ padding: "12px 16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 3 }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{a.name}</span>
                  {a.coin_id && <Badge text={a.coin_id} color={C.gold} />}
                </div>
                <div style={{ color: C.textMuted, fontSize: 11 }}>
                  數量 {a.shares}
                  {a.cost > 0 && ` ｜ 成本 NT$${fmt(a.cost)}`}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ textAlign: "right" }}>
                  <div style={{ color: C.gold, fontFamily: "monospace", fontWeight: 700, fontSize: 14 }}>NT${fmt(a.value_twd)}</div>
                  {pnl !== null && <div style={{ fontSize: 11, color: pnl >= 0 ? C.accent : C.red }}>{pnl >= 0 ? "+" : ""}{fmt(pnl)} ({pp >= 0 ? "+" : ""}{pp.toFixed(1)}%)</div>}
                </div>
                <Btn onClick={() => openEdit(a)} outline small>編輯</Btn>
                <Btn onClick={() => del(a.id)} color={C.red} outline small>刪除</Btn>
              </div>
            </div>
          </Card>
        );
      })}

      {modal && (
        <Modal title={modal === "add" ? "新增加密貨幣" : "編輯加密貨幣"} onClose={() => setModal(null)}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
            <Inp label="名稱" value={form.name} onChange={set("name")} placeholder="e.g. Bitcoin" />
            <Sel label="幣種 ID" value={form.coin_id} onChange={set("coin_id")} options={["bitcoin", "ethereum", "binancecoin", "solana", "tether", "usd-coin"]} />
            <Inp label="數量" type="number" value={form.amount} onChange={set("amount")} placeholder="0" />
            <Inp label="成本 (NT$/個)" type="number" value={form.cost} onChange={set("cost")} placeholder="0" />
            <Inp label="備註" value={form.note} onChange={set("note")} placeholder="選填" />
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Btn onClick={() => setModal(null)} outline>取消</Btn>
            <Btn onClick={save}>{saving ? "儲存中..." : "確認儲存"}</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// 其他資產
// ══════════════════════════════════════════════════════════
const emptyOther = { name: "", value_twd: "", note: "" };

function OtherAccount({ assets, reload }) {
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(emptyOther);
  const [saving, setSaving] = useState(false);
  const set = k => v => setForm(p => ({ ...p, [k]: v }));

  const openAdd = () => { setForm(emptyOther); setModal("add"); };
  const openEdit = a => { setForm({ name: a.name, value_twd: String(a.value_twd || ""), note: a.note || "" }); setModal(a); };

  const save = async () => {
    setSaving(true);
    const data = { account: "other", type: "other", name: form.name, value_twd: parseFloat(form.value_twd) || 0, note: form.note };
    if (modal === "add") await supabase.from("assets").insert(data);
    else await supabase.from("assets").update(data).eq("id", modal.id);
    setSaving(false); setModal(null); reload();
  };

  const del = async id => {
    if (!window.confirm("確定刪除？")) return;
    await supabase.from("assets").delete().eq("id", id);
    reload();
  };

  const total = assets.reduce((s, x) => s + x.value_twd, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <KPI label="其他資產總值" value={total} color={C.purple} />
        <Btn onClick={openAdd}>+ 新增</Btn>
      </div>
      {assets.map(a => (
        <Card key={a.id} style={{ padding: "12px 16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{a.name}</div>
              <div style={{ color: C.textMuted, fontSize: 11 }}>{a.note}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ color: C.purple, fontFamily: "monospace", fontWeight: 700, fontSize: 14 }}>NT${fmt(a.value_twd)}</div>
              <Btn onClick={() => openEdit(a)} outline small>編輯</Btn>
              <Btn onClick={() => del(a.id)} color={C.red} outline small>刪除</Btn>
            </div>
          </div>
        </Card>
      ))}
      {modal && (
        <Modal title={modal === "add" ? "新增其他資產" : "編輯其他資產"} onClose={() => setModal(null)}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
            <Inp label="名稱" value={form.name} onChange={set("name")} placeholder="e.g. 台北市公寓" />
            <Inp label="估值 (NT$)" type="number" value={form.value_twd} onChange={set("value_twd")} placeholder="0" />
            <Inp label="備註" value={form.note} onChange={set("note")} placeholder="選填" />
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Btn onClick={() => setModal(null)} outline>取消</Btn>
            <Btn onClick={save}>{saving ? "儲存中..." : "確認儲存"}</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// 負債
// ══════════════════════════════════════════════════════════
const LIAB_CATS = ["長期負債", "質押", "信用卡", "房貸", "其他"];
const emptyLiab = { name: "", value: "", monthly: "", rate: "", due_day: "", category: "長期負債" };

function Liabilities({ liabilities, reload }) {
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(emptyLiab);
  const [saving, setSaving] = useState(false);
  const set = k => v => setForm(p => ({ ...p, [k]: v }));

  const openAdd = () => { setForm(emptyLiab); setModal("add"); };
  const openEdit = l => {
    setForm({
      name: l.name, value: String(l.value || ""), monthly: String(l.monthly || ""),
      rate: String(l.rate || ""), due_day: String(l.due_day || ""), category: l.category
    });
    setModal(l);
  };

  const save = async () => {
    setSaving(true);
    const data = {
      name: form.name, value: parseFloat(form.value) || 0,
      monthly: parseFloat(form.monthly) || 0, rate: parseFloat(form.rate) || 0,
      due_day: parseInt(form.due_day) || 0, category: form.category,
    };
    if (modal === "add") await supabase.from("liabilities").insert(data);
    else await supabase.from("liabilities").update(data).eq("id", modal.id);
    setSaving(false); setModal(null); reload();
  };

  const del = async id => {
    if (!window.confirm("確定刪除？")) return;
    await supabase.from("liabilities").delete().eq("id", id);
    reload();
  };

  const processPayment = async (l) => {
    if (!window.confirm(`確認本月還款 NT$${fmt(l.monthly)}？餘額將從 NT$${fmt(l.value)} 扣減至 NT$${fmt(l.value - l.monthly)}`)) return;
    await supabase.from("liabilities").update({ value: l.value - l.monthly }).eq("id", l.id);
    reload();
  };

  const today = new Date().getDate();
  const total = liabilities.reduce((s, l) => s + l.value, 0);
  const monthlyTotal = liabilities.reduce((s, l) => s + l.monthly, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontWeight: 600, fontSize: 15 }}>負債清單</div>
        <Btn onClick={openAdd} color={C.red}>+ 新增負債</Btn>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <KPI label="總負債" value={total} color={C.red} />
        <KPI label="月還款合計" value={monthlyTotal} color={C.gold} />
      </div>

      {liabilities.map(l => {
        const isDueToday = l.due_day === today;
        const isDueSoon = Math.abs(l.due_day - today) <= 3 && l.due_day > today;
        return (
          <Card key={l.id} style={{ padding: "12px 16px", borderColor: isDueToday ? C.red : isDueSoon ? C.gold : C.border }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{l.name}</span>
                  <Badge text={l.category} color={C.red} />
                  {l.rate > 0 && <Badge text={`${l.rate}%`} color={C.orange} />}
                  {isDueToday && <Badge text="今日扣款" color={C.red} />}
                  {isDueSoon && <Badge text={`${l.due_day}日扣款`} color={C.gold} />}
                </div>
                <div style={{ color: C.textMuted, fontSize: 11 }}>
                  {l.monthly > 0 && `月還款 NT$${fmt(l.monthly)}`}
                  {l.due_day > 0 && ` ｜ 每月${l.due_day}日`}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ color: C.red, fontFamily: "monospace", fontWeight: 700, fontSize: 14 }}>NT${fmt(l.value)}</div>
                {l.monthly > 0 && <Btn onClick={() => processPayment(l)} color={C.gold} small>還款</Btn>}
                <Btn onClick={() => openEdit(l)} outline small>編輯</Btn>
                <Btn onClick={() => del(l.id)} color={C.red} outline small>刪除</Btn>
              </div>
            </div>
          </Card>
        );
      })}

      {modal && (
        <Modal title={modal === "add" ? "新增負債" : "編輯負債"} onClose={() => setModal(null)}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
            <Sel label="類別" value={form.category} onChange={set("category")} options={LIAB_CATS} />
            <Inp label="名稱" value={form.name} onChange={set("name")} placeholder="e.g. 信貸" />
            <Inp label="餘額 (NT$)" type="number" value={form.value} onChange={set("value")} placeholder="0" />
            <Inp label="月還款 (NT$)" type="number" value={form.monthly} onChange={set("monthly")} placeholder="0" />
            <Inp label="年利率 (%)" type="number" value={form.rate} onChange={set("rate")} placeholder="0" />
            <Inp label="扣款日 (幾號)" type="number" value={form.due_day} onChange={set("due_day")} placeholder="e.g. 15" />
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Btn onClick={() => setModal(null)} outline>取消</Btn>
            <Btn onClick={save} color={C.red}>{saving ? "儲存中..." : "確認儲存"}</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// 質押專頁
// ══════════════════════════════════════════════════════════
const emptyPledge = { name: "", ticker: "", shares: "", price: "", borrow_amount: "", warning_ratio: "160", note: "" };

function Pledge({ pledges, reload }) {
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(emptyPledge);
  const [saving, setSaving] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetchMsg, setFetchMsg] = useState("");
  const set = k => v => setForm(p => ({ ...p, [k]: v }));

  const openAdd = () => { setForm(emptyPledge); setModal("add"); };
  const openEdit = p => {
    setForm({
      name: p.name, ticker: p.ticker || "",
      shares: String(p.shares || ""),
      price: String(p.price || ""),
      borrow_amount: String(p.borrow_amount || ""),
      warning_ratio: String(p.warning_ratio || 160),
      note: p.note || ""
    });
    setModal(p);
  };

  const save = async () => {
    setSaving(true);
    const shares = parseFloat(form.shares) || 0;
    const price = parseFloat(form.price) || 0;
    const market_value = shares * price;
    const borrow_amount = parseFloat(form.borrow_amount) || 0;
    const warning_ratio = parseFloat(form.warning_ratio) || 160;
    const data = {
      name: form.name, ticker: form.ticker, shares, price,
      market_value, borrow_amount, warning_ratio, note: form.note || ""
    };
    if (modal === "add") await supabase.from("pledges").insert(data);
    else await supabase.from("pledges").update(data).eq("id", modal.id);
    setSaving(false); setModal(null); reload();
  };

  const del = async id => {
    if (!window.confirm("確定刪除？")) return;
    await supabase.from("pledges").delete().eq("id", id);
    reload();
  };

  const refreshPrices = async () => {
    setFetching(true); setFetchMsg("抓取股價中...");
    for (const p of pledges) {
      if (!p.ticker) continue;
      const price = await fetchTWPrice(p.ticker);
      if (price) {
        const market_value = price * (p.shares || 0);
        await supabase.from("pledges").update({ price, market_value }).eq("id", p.id);
        setFetchMsg(`✅ ${p.ticker}: NT$${price}`);
      }
    }
    setFetching(false); setFetchMsg("✅ 更新完成");
    setTimeout(() => setFetchMsg(""), 3000);
    reload();
  };

  const totalMarket = pledges.reduce((s, p) => s + (p.market_value || 0), 0);
  const totalBorrow = pledges.reduce((s, p) => s + (p.borrow_amount || 0), 0);
  const totalMaxBorrow = totalMarket * 0.6;
  const totalUnused = totalMaxBorrow - totalBorrow;
  const overallRatio = totalBorrow > 0 ? totalMarket / totalBorrow * 100 : 0;
  const overallMaxDrop = totalBorrow > 0 ? (1 - (totalBorrow * 1.6 / totalMarket)) * 100 : 0;
  const ratioColor = r => r >= 250 ? C.accent : r >= 200 ? C.gold : C.red;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Card style={{ padding: 18, borderColor: overallRatio > 0 && overallRatio < 200 ? C.red : overallRatio < 250 ? C.gold : C.border }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>整戶質押狀況</div>
          <div style={{ display: "flex", gap: 8 }}>
            {fetchMsg && <span style={{ color: C.accent, fontSize: 12, alignSelf: "center" }}>{fetchMsg}</span>}
            <Btn onClick={refreshPrices} color={C.blue} outline disabled={fetching}>🔄 更新股價</Btn>
            <Btn onClick={openAdd}>+ 新增質押</Btn>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 10 }}>
          {[
            ["總質押市值", "NT$" + fmt(totalMarket), C.blue],
            ["總借款", "NT$" + fmt(totalBorrow), C.red],
            ["整戶維持率", overallRatio > 0 ? overallRatio.toFixed(1) + "%" : "-", ratioColor(overallRatio)],
            ["整戶可承受跌幅", overallMaxDrop > 0 ? overallMaxDrop.toFixed(1) + "%" : "-", overallMaxDrop > 20 ? C.accent : C.red],
            ["最高可借(六成)", "NT$" + fmt(totalMaxBorrow), C.gold],
            ["尚可借出", "NT$" + fmt(Math.max(totalUnused, 0)), totalUnused > 0 ? C.accent : C.red],
          ].map(([l, v, c]) => (
            <div key={l} style={{ background: C.surface2, borderRadius: 8, padding: "10px 12px", border: `1px solid ${C.border}` }}>
              <div style={{ color: C.textMuted, fontSize: 10, marginBottom: 4 }}>{l}</div>
              <div style={{ color: c, fontWeight: 700, fontSize: 14, fontFamily: "monospace" }}>{v}</div>
            </div>
          ))}
        </div>
        {overallRatio > 0 && overallRatio < 200 && (
          <div style={{ marginTop: 12, padding: "9px 12px", background: C.redDim, border: `1px solid ${C.red}40`, borderRadius: 8, color: C.red, fontSize: 12 }}>
            ⚠️ 整戶維持率 {overallRatio.toFixed(1)}% 低於 200%，請注意！
          </div>
        )}
      </Card>

      {pledges.length === 0 && (
        <Card style={{ padding: 24, textAlign: "center" }}><div style={{ color: C.textMuted }}>尚無質押記錄</div></Card>
      )}

      {Object.entries(
        pledges.reduce((acc, p) => {
          const key = p.ticker || p.name;
          if (!acc[key]) acc[key] = [];
          acc[key].push(p);
          return acc;
        }, {})
      ).map(([ticker, items]) => {
        const groupMarket = items.reduce((s, p) => s + (p.market_value || 0), 0);
        const groupBorrow = items.reduce((s, p) => s + (p.borrow_amount || 0), 0);
        return (
          <Card key={ticker} style={{ padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontWeight: 700, fontSize: 15 }}>{ticker}</span>
                <Badge text={`${items.reduce((s, p) => s + (p.shares || 0), 0).toLocaleString()} 股`} color={C.blue} />
                {items[0]?.price > 0 && <span style={{ color: C.textMuted, fontSize: 12 }}>@ NT${items[0].price}</span>}
              </div>
              <div style={{ color: C.textMuted, fontSize: 12 }}>
                合計市值 <span style={{ color: C.blue, fontWeight: 600 }}>NT${fmt(groupMarket)}</span> ｜
                合計借款 <span style={{ color: C.red, fontWeight: 600 }}>NT${fmt(groupBorrow)}</span>
              </div>
            </div>
            {items.map((p, idx) => {
              const ratio = p.borrow_amount > 0 ? (p.market_value || 0) / p.borrow_amount * 100 : 0;
              const maxDrop = p.borrow_amount > 0 ? (1 - (p.borrow_amount * (p.warning_ratio / 100) / (p.market_value || 1))) * 100 : 0;
              const maxBorrow = (p.market_value || 0) * 0.6;
              const unusedQuota = maxBorrow - p.borrow_amount;
              const isWarning = ratio > 0 && ratio < p.warning_ratio * 1.1;
              return (
                <div key={p.id} style={{ background: C.surface2, borderRadius: 10, padding: "12px 14px", border: `1px solid ${isWarning ? C.red : C.border}`, marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>
                      第 {idx + 1} 筆 ｜ {p.shares} 股質押
                      {p.note && <span style={{ color: C.textMuted, fontSize: 11, marginLeft: 8 }}>{p.note}</span>}
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <Btn onClick={() => openEdit(p)} outline small>編輯</Btn>
                      <Btn onClick={() => del(p.id)} color={C.red} outline small>刪除</Btn>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(100px,1fr))", gap: 8 }}>
                    {[
                      ["市值", "NT$" + fmt(p.market_value || 0), C.blue],
                      ["借款", "NT$" + fmt(p.borrow_amount || 0), C.red],
                      ["維持率", ratio > 0 ? ratio.toFixed(1) + "%" : "-", ratioColor(ratio)],
                      ["可承受跌幅", maxDrop > 0 ? maxDrop.toFixed(1) + "%" : "-", maxDrop > 20 ? C.accent : C.red],
                      ["最高可借", "NT$" + fmt(maxBorrow), C.gold],
                      ["尚可借", "NT$" + fmt(Math.max(unusedQuota, 0)), unusedQuota > 0 ? C.accent : C.red],
                    ].map(([l, v, c]) => (
                      <div key={l} style={{ background: C.bg, borderRadius: 6, padding: "6px 8px" }}>
                        <div style={{ color: C.textMuted, fontSize: 9, marginBottom: 2 }}>{l}</div>
                        <div style={{ color: c, fontWeight: 700, fontSize: 12, fontFamily: "monospace" }}>{v}</div>
                      </div>
                    ))}
                  </div>
                  {isWarning && (
                    <div style={{ marginTop: 8, padding: "6px 10px", background: C.redDim, borderRadius: 6, color: C.red, fontSize: 11 }}>
                      ⚠️ 維持率 {ratio.toFixed(1)}% 接近警戒線 {p.warning_ratio}%！
                    </div>
                  )}
                </div>
              );
            })}
          </Card>
        );
      })}

      {modal && (
        <Modal title={modal === "add" ? "新增質押" : "編輯質押"} onClose={() => setModal(null)}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
            <Inp label="名稱" value={form.name} onChange={set("name")} placeholder="e.g. 006208 第一筆" />
            <Inp label="股票代號" value={form.ticker} onChange={set("ticker")} placeholder="e.g. 006208" />
            <Inp label="質押股數" type="number" value={form.shares} onChange={set("shares")} placeholder="e.g. 6000" />
            <Inp label="現價 (NT$)" type="number" value={form.price} onChange={set("price")} placeholder="自動抓取" />
            <Inp label="已借出 (NT$)" type="number" value={form.borrow_amount} onChange={set("borrow_amount")} placeholder="0" />
            <Inp label="警戒維持率 (%)" type="number" value={form.warning_ratio} onChange={set("warning_ratio")} placeholder="160" />
            <Inp label="備註" value={form.note} onChange={set("note")} placeholder="選填" />
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Btn onClick={() => setModal(null)} outline>取消</Btn>
            <Btn onClick={save}>{saving ? "儲存中..." : "確認儲存"}</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// 主元件
// ══════════════════════════════════════════════════════════
export default function App() {
  const [tab, setTab] = useState("overview");
  const [allAssets, setAllAssets] = useState([]);
  const [liabilities, setLiabilities] = useState([]);
  const [snapshots, setSnapshots] = useState([]);
  const [pledges, setPledges] = useState([]);
  const [usdRate, setUsdRate] = useState(31.5);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [a, l, s, p, rate] = await Promise.all([
      supabase.from("assets").select("*").order("account"),
      supabase.from("liabilities").select("*"),
      supabase.from("monthly_snapshots").select("*").order("date"),
      supabase.from("pledges").select("*"),
      fetchUSDTWD(),
    ]);
    setAllAssets(a.data || []);
    setLiabilities(l.data || []);
    setSnapshots(s.data || []);
    setPledges(p.data || []);
    setUsdRate(rate || 31.5);
    setLoading(false);

    const today = new Date().toISOString().slice(0, 10);
    const existing = s.data?.find(x => x.date === today);
    if (!existing && (a.data || []).length > 0) {
      const totalAssets = (a.data || []).reduce((sum, x) => sum + (x.value_twd || 0), 0);
      const totalLiab = (l.data || []).reduce((sum, x) => sum + x.value, 0);
      const net = totalAssets - totalLiab;
      const leverage = net > 0 ? totalAssets / net : 0;
      await supabase.from("monthly_snapshots").insert({
        date: today, assets: totalAssets, liabilities: totalLiab, net, leverage
      });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const twAssets = allAssets.filter(a => a.account === "tw");
  const usAssets = allAssets.filter(a => a.account === "us");
  const cryptoAssets = allAssets.filter(a => a.account === "crypto");
  const otherAssets = allAssets.filter(a => a.account === "other");

  const totalAssets = allAssets.reduce((s, x) => s + (x.value_twd || 0), 0);
  const totalLiab = liabilities.reduce((s, x) => s + x.value, 0);
  const netWorth = totalAssets - totalLiab;

  const tabs = [
    { id: "overview", label: "總覽", icon: "📊" },
    { id: "tw", label: "台股", icon: "🇹🇼" },
    { id: "us", label: "美股", icon: "🇺🇸" },
    { id: "crypto", label: "加密", icon: "₿" },
    { id: "other", label: "其他", icon: "🏠" },
    { id: "liab", label: "負債", icon: "📋" },
    { id: "pledge", label: "質押", icon: "🔒" },
    {id:"strategy", label:"策略", icon:"📈"},
  ];

  if (loading) return (
    <div style={{ background: C.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: C.accent, fontSize: 18, flexDirection: "column", gap: 12 }}>
      <div>載入中...</div>
      <div style={{ color: C.textMuted, fontSize: 12 }}>抓取即時匯率中</div>
    </div>
  );

  return (
    <div style={{ background: C.bg, minHeight: "100vh", color: C.text, fontFamily: "'DM Sans','Noto Sans TC',sans-serif" }}>
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "12px 22px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 32, height: 32, background: `linear-gradient(135deg,${C.accent},${C.blue})`, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>💰</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>WealthOS</div>
            <div style={{ color: C.textMuted, fontSize: 10 }}>個人資產監控系統</div>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ color: C.accent, fontWeight: 700, fontFamily: "monospace", fontSize: 15 }}>NT${fmt(netWorth)}</div>
          <div style={{ color: C.textMuted, fontSize: 10 }}>淨值 ｜ USD/TWD {usdRate.toFixed(2)}</div>
        </div>
      </div>

      <div style={{ padding: "18px 22px" }}>
        <div style={{ display: "flex", gap: 7, marginBottom: 18, flexWrap: "wrap" }}>
          {tabs.map(t => <TabBtn key={t.id} {...t} active={tab === t.id} onClick={() => setTab(t.id)} />)}
        </div>
        {tab === "overview" && <Overview twAssets={twAssets} usAssets={usAssets} cryptoAssets={cryptoAssets} otherAssets={otherAssets} liabilities={liabilities} snapshots={snapshots} usdRate={usdRate} />}
        {tab === "tw" && <TWAccount assets={twAssets} reload={load} />}
        {tab === "us" && <USAccount assets={usAssets} usdRate={usdRate} reload={load} />}
        {tab === "crypto" && <CryptoAccount assets={cryptoAssets} reload={load} />}
        {tab === "other" && <OtherAccount assets={otherAssets} reload={load} />}
        {tab === "liab" && <Liabilities liabilities={liabilities} reload={load} />}
        {tab === "pledge" && <Pledge pledges={pledges} reload={load} />}
        {tab ==="strategy"&&<Strategy allAssets={allAssets}/>}
      </div>
    </div>
  );
}