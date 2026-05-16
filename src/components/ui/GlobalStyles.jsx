// ============================================================
// GlobalStyles.jsx — 全域 CSS 注入元件
// 包含：字型載入、reset、動畫 keyframe、共用 class
// 放在 App 最頂層渲染一次即可，不需重複使用
// ============================================================

export default function GlobalStyles() {
  return (
    <style>{`
      /* ── 字型 ─────────────────────────────────────────── */
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');

      *, *::before, *::after { box-sizing: border-box; }

      body {
        background: #05080F;
        font-family: 'Inter', 'Noto Sans TC', system-ui, sans-serif;
      }

      /* ── 捲軸樣式 ─────────────────────────────────────── */
      ::-webkit-scrollbar { width: 8px; height: 8px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: #2A3F5C; border-radius: 4px; }
      ::-webkit-scrollbar-thumb:hover { background: #3D5A82; }

      /* ── 動畫 keyframes ───────────────────────────────── */
      /* wos-fadeIn：頁面/頁籤切換時的淡入效果 */
      @keyframes wos-fadeIn {
        from { opacity: 0; transform: translateY(8px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      /* wos-slideUp：Modal 彈出動畫 */
      @keyframes wos-slideUp {
        from { opacity: 0; transform: translateY(14px) scale(0.98); }
        to   { opacity: 1; transform: translateY(0) scale(1); }
      }
      /* wos-backdropFade：Modal 遮罩淡入 */
      @keyframes wos-backdropFade {
        from { opacity: 0; }
        to   { opacity: 1; }
      }
      /* wos-spin：載入 spinner 旋轉 */
      @keyframes wos-spin {
        to { transform: rotate(360deg); }
      }
      /* wos-pulse：Logo 跳動效果 */
      @keyframes wos-pulse {
        0%, 100% { opacity: 0.7; }
        50%       { opacity: 1; }
      }

      /* ── 動畫 class ───────────────────────────────────── */
      .wos-fade  { animation: wos-fadeIn  0.3s ease forwards; }
      .wos-slide { animation: wos-slideUp 0.3s cubic-bezier(.16,1,.3,1) forwards; }

      /* ── 載入圈 ───────────────────────────────────────── */
      .wos-loader {
        width: 40px; height: 40px;
        border: 3px solid rgba(0,200,150,0.15);
        border-top-color: #00C896;
        border-radius: 50%;
        animation: wos-spin 0.75s linear infinite;
      }

      /* ── KPI 卡片 hover 效果 ──────────────────────────── */
      .wos-kpi {
        transition: transform 0.2s ease, box-shadow 0.2s ease;
        cursor: default;
      }
      .wos-kpi:hover {
        transform: translateY(-3px);
        box-shadow: 0 16px 40px rgba(0,0,0,0.55), 0 4px 12px rgba(0,0,0,0.3);
      }

      /* ── 資產列 hover 效果 ────────────────────────────── */
      .wos-row { transition: background 0.15s ease, border-color 0.15s ease; }
      .wos-row:hover {
        background: #111928 !important;
        border-color: #3D5A82 !important;
      }

      /* ── 導覽頁籤 hover ───────────────────────────────── */
      .wos-tab { transition: all 0.2s ease; }
      .wos-tab:hover {
        color: #F1F5FB !important;
        background: rgba(255,255,255,0.04) !important;
      }

      /* ── 按鈕 hover / active ──────────────────────────── */
      .wos-btn { transition: filter 0.15s ease, transform 0.15s ease; }
      .wos-btn:hover:not(:disabled) {
        filter: brightness(1.18);
        transform: translateY(-1px);
      }
      .wos-btn:active:not(:disabled) {
        transform: translateY(0);
        filter: brightness(0.95);
      }

      /* ── 輸入框 focus ─────────────────────────────────── */
      .wos-input:focus, .wos-select:focus {
        outline: none !important;
        border-color: #00C896 !important;
        box-shadow: 0 0 0 3px rgba(0,200,150,0.13) !important;
      }

      /* ── 配置進度條動畫 ───────────────────────────────── */
      .wos-bar-fill { transition: width 1s cubic-bezier(.4,0,.2,1); }

      /* ══════════════════════════════════════════════════════
         RWD 響應式格線系統
         Breakpoints:
           Mobile  : ≤ 480px  (手機直向)
           Tablet  : ≤ 768px  (手機橫向 / 小平板)
           Desktop : > 768px  (桌機 / 大平板)
         ══════════════════════════════════════════════════════ */

      /* ── 2 欄 → 手機 1 欄 ─────────────────────────────── */
      .wos-grid-2 {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 10px;
      }
      @media (max-width: 480px) {
        .wos-grid-2 { grid-template-columns: 1fr; }
      }

      /* ── 3 欄 → 平板 2 欄 → 手機 1 欄 ─────────────────── */
      .wos-grid-3 {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 10px;
      }
      @media (max-width: 768px) {
        .wos-grid-3 { grid-template-columns: repeat(2, 1fr); }
      }
      @media (max-width: 480px) {
        .wos-grid-3 { grid-template-columns: 1fr; }
      }

      /* ── 6 欄 → 手機 3 欄（MarketBrief 總經指標）──────── */
      .wos-grid-6-3 {
        display: grid;
        grid-template-columns: repeat(6, 1fr);
        gap: 6px;
      }
      @media (max-width: 600px) {
        .wos-grid-6-3 { grid-template-columns: repeat(3, 1fr); }
      }

      /* ── 3 欄訊號卡 → 手機 1 欄（PreMarketSummary）─────── */
      .wos-grid-signal {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
        font-size: 11px;
      }
      @media (max-width: 600px) {
        .wos-grid-signal { grid-template-columns: 1fr; }
      }

      /* ── 監控表單：3 欄 → 2 欄 → 1 欄 ─────────────────── */
      .wos-grid-form {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 10px;
        margin-bottom: 12px;
      }
      @media (max-width: 640px) {
        .wos-grid-form { grid-template-columns: repeat(2, 1fr); }
      }
      @media (max-width: 400px) {
        .wos-grid-form { grid-template-columns: 1fr; }
      }

      /* ── 回測說明文字：手機縮小字 ──────────────────────── */
      @media (max-width: 480px) {
        .wos-desc-card { font-size: 10px !important; line-height: 1.6 !important; }
      }

      /* ── 手機隱藏 ───────────────────────────────────────── */
      @media (max-width: 600px) {
        .wos-hide-mobile { display: none !important; }
      }

      /* ── 手機顯示（桌機隱藏）────────────────────────────── */
      .wos-show-mobile { display: none !important; }
      @media (max-width: 600px) {
        .wos-show-mobile { display: block !important; }
      }

      /* ── Tab 按鈕手機尺寸縮小 ───────────────────────────── */
      @media (max-width: 480px) {
        .wos-tab-btn {
          padding: 6px 10px !important;
          font-size: 11px !important;
          white-space: nowrap;
        }
      }

      /* ── 績效結果卡片：2欄 → 手機1欄 ───────────────────── */
      .wos-result-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 10px;
        margin-bottom: 16px;
      }
      @media (max-width: 320px) {
        .wos-result-grid { grid-template-columns: 1fr; }
      }

      /* ── KChart 標題列：手機換行 ─────────────────────────── */
      @media (max-width: 480px) {
        .wos-kchart-header {
          flex-direction: column !important;
          align-items: flex-start !important;
          gap: 6px !important;
        }
        .wos-kchart-badges {
          flex-wrap: wrap !important;
          gap: 4px !important;
        }
      }

      /* ── 監控標題列：手機換行 ───────────────────────────── */
      @media (max-width: 480px) {
        .wos-monitor-header {
          flex-direction: column !important;
          align-items: flex-start !important;
          gap: 8px !important;
        }
      }

      /* ── 回測底部按鈕區：手機換行 ───────────────────────── */
      @media (max-width: 480px) {
        .wos-run-row {
          flex-direction: column !important;
          align-items: flex-start !important;
          gap: 8px !important;
        }
      }
    `}</style>
  );
}
