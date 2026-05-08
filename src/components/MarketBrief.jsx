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

const AI_PREVIEW_LEN = 60; // 預設顯示字數

export default function MarketBrief() {
  const [brief,    setBrief]    = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [aiExpanded, setAiExpanded] = useState(false);

  useEffect(() => {
    async function load() {
      // 不限定今日，改抓最新一筆（週末 / 假日也能顯示上一個交易日資料）
      const { data } = await supabase
        .from("morning_brief")
        .select("*")
        .order("brief_date", { ascending: false })
        .limit(1);
      setBrief(data?.[0] || null);
      setLoading(false);
    }
    load();
  }, []);

  const todayStr = new Date().toISOString().slice(0, 10);
  const isStale  = brief && brief.brief_date !== todayStr; // 資料非今日（週末/假日）

  // 資料日期標籤（顯示於右上角）
  const dateLabel = brief?.brief_date
    ? new Date(brief.brief_date + "T00:00:00+08:00").toLocaleDateString("zh-TW", {
        month: "numeric", day: "numeric", weekday: "short",
      })
    : new Date().toLocaleDateString("zh-TW", { month: "numeric", day: "numeric", weekday: "short" });

  // 資料新鮮度標籤：顯示摘要生成時間（TWN 時區）
  const freshnessLabel = (() => {
    if (!brief?.created_at) return null;
    try {
      const t = new Date(brief.created_at);
      const hhmm = t.toLocaleTimeString("zh-TW", {
        timeZone: "Asia/Taipei",
        hour: "2-digit", minute: "2-digit", hour12: false,
      });
      return isStale
        ? `上一個交易日資料｜${hhmm} 更新`
        : `資料截至美東收盤｜${hhmm} 更新`;
    } catch { return null; }
  })();

  const macros = [
    { label: "VIX",    val: brief?.vix,        unit: "",  chg: null },
    { label: "美債10Y", val: brief?.us10y,      unit: "%", chg: null },
    { label: "DXY",    val: brief?.dxy,         unit: "",  chg: null },
    { label: "S&P500", val: null, chg: brief?.sp500_chg },
    { label: "NASDAQ", val: null, chg: brief?.nasdaq_chg },
    // 台股加權：有點位時顯示「點位 + 漲跌%」，無點位（舊資料）退回只顯示漲跌%
    {
      label: "台股加權",
      val:   brief?.twii_value ? Math.round(brief.twii_value).toLocaleString() : null,
      unit:  "",
      chg:   brief?.twii_chg,
      hasValue: !!brief?.twii_value,  // 標記是否有實際點位
    },
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
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
          <div style={{ color: C.textMuted, fontSize: 11 }}>{dateLabel}</div>
          {freshnessLabel && (
            <div style={{ color: C.textDim || C.textMuted, fontSize: 10, opacity: 0.7 }}>{freshnessLabel}</div>
          )}
        </div>
      </div>

      {brief ? (
        <>
          {/* ── 總經指標格（桌機6欄 / 手機3欄，由 .wos-grid-6-3 控制）── */}
          <div className="wos-grid-6-3" style={{ marginBottom: 12 }}>
            {macros.map(({ label, val, unit, chg, hasValue }) => (
              <div key={label} style={{
                background: C.surface2, borderRadius: 8, padding: "8px 6px",
                textAlign: "center", border: `1px solid ${C.border}`,
              }}>
                <div style={{ color: C.textMuted, fontSize: 10, marginBottom: 4 }}>{label}</div>
                {val != null && hasValue
                  // 台股加權：點位（大字）+ 漲跌%（小字）
                  ? <>
                      <div style={{ color: C.text, fontWeight: 700, fontSize: 13 }}>{val}{unit}</div>
                      {chg != null && (
                        <div style={{ color: chg >= 0 ? C.accent : C.red, fontSize: 10, marginTop: 2 }}>
                          {chg >= 0 ? "+" : ""}{Number(chg).toFixed(2)}%
                        </div>
                      )}
                    </>
                  : val != null
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
          {brief.ai_summary ? (() => {
            const full    = brief.ai_summary;
            const needCut = full.length > AI_PREVIEW_LEN;
            const preview = needCut ? full.slice(0, AI_PREVIEW_LEN) : full;
            return (
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
                {aiExpanded ? full : preview}
                {needCut && !aiExpanded && <span style={{ color: C.textMuted }}>…</span>}
                {needCut && (
                  <button
                    onClick={() => setAiExpanded(v => !v)}
                    style={{
                      display: "block",
                      marginTop: 8,
                      background: "none",
                      border: "none",
                      color: C.accent,
                      fontSize: 11,
                      cursor: "pointer",
                      padding: 0,
                      fontWeight: 600,
                      letterSpacing: "0.03em",
                    }}
                  >
                    {aiExpanded ? "收起 ▴" : "展開閱讀全部 ▾"}
                  </button>
                )}
              </div>
            );
          })() : (
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
          📅 每日 08:00（台灣時間）自動生成盤前摘要<br />
          <span style={{ color: C.textDim || C.textMuted }}>尚無資料，請稍後重新整理</span>
        </div>
      )}
    </Card>
  );
}
