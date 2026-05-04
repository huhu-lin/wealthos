// ============================================================
// MarketBrief.jsx — 每日盤前市場摘要卡
// 顯示：總經指標（VIX / 美債10Y / DXY / 美股指數 / 台股加權）
//        + Gemini AI 盤前分析文字
// 資料來源：Supabase morning_brief 表（每日 08:00 由 GitHub Actions 生成）
// 位置：總覽頁頂部
// ============================================================

import { useState, useEffect } from "react";
import { supabase }            from "../supabase";
import { C }                   from "../constants/theme";
import Card                    from "./ui/Card";

export default function MarketBrief() {
  const [brief,   setBrief]   = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetch() {
      const today = new Date().toISOString().slice(0, 10);
      const { data } = await supabase
        .from("morning_brief")
        .select("*")
        .eq("brief_date", today)
        .limit(1);
      setBrief(data?.[0] || null);
      setLoading(false);
    }
    fetch();
  }, []);

  const dateLabel = new Date().toLocaleDateString("zh-TW", {
    month: "numeric", day: "numeric", weekday: "short",
  });

  const macros = [
    { label: "VIX",    val: brief?.vix,        unit: "",  chg: null },
    { label: "美債10Y", val: brief?.us10y,      unit: "%", chg: null },
    { label: "DXY",    val: brief?.dxy,         unit: "",  chg: null },
    { label: "S&P500", val: null, chg: brief?.sp500_chg },
    { label: "NASDAQ", val: null, chg: brief?.nasdaq_chg },
    { label: "台股加權", val: null, chg: brief?.twii_chg },
  ];

  if (loading) return (
    <Card style={{ padding: 16, marginBottom: 16, opacity: 0.5 }}>
      <div style={{ color: C.textMuted, fontSize: 12, textAlign: "center" }}>載入盤前摘要中…</div>
    </Card>
  );

  return (
    <Card style={{ padding: 16, marginBottom: 20, border: `1px solid ${C.accent}30` }}>
      {/* ── 標題列 ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: C.accent, display: "flex", alignItems: "center", gap: 6 }}>
          <span>📊</span> 今日市場摘要
        </div>
        <div style={{ color: C.textMuted, fontSize: 11 }}>{dateLabel}</div>
      </div>

      {brief ? (
        <>
          {/* ── 總經指標格 ── */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(6, 1fr)",
            gap: 6,
            marginBottom: 12,
          }}>
            {macros.map(({ label, val, unit, chg }) => (
              <div key={label} style={{
                background: C.surface2, borderRadius: 8, padding: "8px 6px",
                textAlign: "center", border: `1px solid ${C.border}`,
              }}>
                <div style={{ color: C.textMuted, fontSize: 10, marginBottom: 4 }}>{label}</div>
                {val != null
                  ? <div style={{ color: C.text, fontWeight: 700, fontSize: 13 }}>{val}{unit}</div>
                  : chg != null
                    ? <div style={{
                        color: chg >= 0 ? C.accent : C.red,
                        fontWeight: 700, fontSize: 13,
                      }}>
                        {chg >= 0 ? "+" : ""}{Number(chg).toFixed(2)}%
                      </div>
                    : <div style={{ color: C.textMuted, fontSize: 13 }}>—</div>
                }
              </div>
            ))}
          </div>

          {/* ── AI 摘要文字 ── */}
          {brief.ai_summary ? (
            <div style={{
              background: C.surface2,
              borderRadius: 8,
              padding: "12px 14px",
              fontSize: 12,
              lineHeight: 1.9,
              color: C.text,
              borderLeft: `3px solid ${C.accent}`,
            }}>
              <span style={{ color: C.accent, fontWeight: 700, marginRight: 6 }}>🤖 AI 盤前分析</span>
              {brief.ai_summary}
            </div>
          ) : (
            <div style={{
              background: C.surface2, borderRadius: 8, padding: "10px 14px",
              fontSize: 11, color: C.textMuted, textAlign: "center",
            }}>
              AI 摘要生成中，請稍後重新整理
            </div>
          )}
        </>
      ) : (
        <div style={{
          background: C.surface2, borderRadius: 8, padding: "14px",
          fontSize: 11, color: C.textMuted, textAlign: "center", lineHeight: 1.8,
        }}>
          📅 每日 08:00 自動生成盤前摘要<br />
          <span style={{ color: C.textDim }}>今日摘要尚未就緒，請於開盤前重新整理</span>
        </div>
      )}
    </Card>
  );
}
