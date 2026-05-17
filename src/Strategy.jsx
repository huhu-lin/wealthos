// ============================================================
// Strategy.jsx — 策略模組外殼（Tab 切換）
// 監控／回測子模組已拆分至 src/strategy/
// ============================================================

import { useState } from "react";
import { C } from "./constants/theme";
import MonitorTab from "./strategy/MonitorTab";
import BacktestTab from "./strategy/BacktestTab";

export default function Strategy({ allAssets }) {
  const [tab, setTab] = useState("monitor");

  return (
    <div style={{display:"flex", flexDirection:"column", gap:0}}>
      <div style={{display:"flex", gap:8, marginBottom:20}}>
        {[["monitor","📡 監控"],["backtest","📊 回測"]].map(([key,label])=>(
          <button key={key} onClick={()=>setTab(key)} style={{
            background: tab===key ? C.accent+"18" : "transparent",
            color: tab===key ? C.accent : C.textMuted,
            border: `1px solid ${tab===key ? C.accent+"60" : C.border}`,
            borderRadius:8, padding:"8px 18px", fontSize:13, fontWeight:600, cursor:"pointer"
          }}>{label}</button>
        ))}
      </div>

      {tab==="monitor" && <MonitorTab allAssets={allAssets}/>}
      {tab==="backtest" && <BacktestTab/>}
    </div>
  );
}
