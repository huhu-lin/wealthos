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
      ::-webkit-scrollbar { width: 5px; height: 5px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: #1C2E45; border-radius: 3px; }
      ::-webkit-scrollbar-thumb:hover { background: #2A4A70; }

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
        border-color: #2A4A70 !important;
      }

      /* ── 導覽頁籤 hover ───────────────────────────────── */
      .wos-tab { transition: all 0.2s ease; }
      .wos-tab:hover {
        color: #E2EAF4 !important;
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
    `}</style>
  );
}
