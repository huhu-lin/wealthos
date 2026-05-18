import { useState } from "react";
import { C } from "./constants/theme";
import TabBtn from "./components/ui/TabBtn";
import TWAccount from "./components/TWAccount";
import USAccount from "./components/USAccount";
import CryptoAccount from "./components/CryptoAccount";
import OtherAccount from "./components/OtherAccount";

const SUB_TABS = [
  { id: "tw",     label: "台股", icon: "🇹🇼" },
  { id: "us",     label: "美股", icon: "🇺🇸" },
  { id: "crypto", label: "加密", icon: "₿"   },
  { id: "other",  label: "其他", icon: "🏠"  },
];

export default function AssetsTab({ twAssets, usAssets, cryptoAssets, otherAssets, usdRate, reload }) {
  const [sub, setSub] = useState("tw");

  return (
    <div className="wos-fade" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{
        display: "flex", gap: 6,
        paddingBottom: 12, marginBottom: 4,
        borderBottom: `1px solid ${C.border}`,
        overflowX: "auto", scrollbarWidth: "none",
      }}>
        {SUB_TABS.map(t => (
          <TabBtn key={t.id} {...t} active={sub === t.id} onClick={() => setSub(t.id)} />
        ))}
      </div>

      {sub === "tw"     && <TWAccount     assets={twAssets}     reload={reload} />}
      {sub === "us"     && <USAccount     assets={usAssets}     usdRate={usdRate} reload={reload} />}
      {sub === "crypto" && <CryptoAccount assets={cryptoAssets} reload={reload} />}
      {sub === "other"  && <OtherAccount  assets={otherAssets}  reload={reload} />}
    </div>
  );
}
