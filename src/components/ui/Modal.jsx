// ============================================================
// Modal.jsx — 彈出對話框
// 全螢幕遮罩 + 中央卡片，用於新增/編輯表單
// 用法：<Modal title="新增項目" onClose={() => setModal(null)}>
//         表單內容...
//       </Modal>
// ============================================================

import { C } from "../../constants/theme";

export default function Modal({ title, onClose, children }) {
  return (
    // 半透明遮罩層，點擊遮罩不關閉（需點 ✕ 或取消按鈕）
    <div style={{
      position: "fixed", inset: 0,
      background: "rgba(0,0,0,0.62)",
      backdropFilter: "blur(4px)",
      WebkitBackdropFilter: "blur(4px)",
      zIndex: 1000,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 20,
      animation: "wos-backdropFade 0.2s ease forwards",
    }}>
      {/* 對話框本體，帶入場動畫 */}
      <div className="wos-slide" style={{
        background: `linear-gradient(150deg, ${C.surface} 0%, ${C.surface2} 100%)`,
        border: `1px solid ${C.borderHover}`,
        borderRadius: 18,
        width: "100%",
        maxWidth: 560,
        maxHeight: "92vh",
        overflowY: "auto",
        boxShadow: "0 28px 72px rgba(0,0,0,0.65), 0 8px 24px rgba(0,0,0,0.4)",
      }}>

        {/* 標題列 + 關閉按鈕 */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "18px 22px",
          borderBottom: `1px solid ${C.border}`,
        }}>
          <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-0.01em" }}>
            {title}
          </div>
          <button
            onClick={onClose}
            style={{
              background: C.surface3,
              border: `1px solid ${C.border}`,
              color: C.textMuted,
              cursor: "pointer",
              fontSize: 14,
              width: 28, height: 28,
              borderRadius: 7,
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "all 0.15s",
              fontFamily: "sans-serif",
            }}
          >✕</button>
        </div>

        {/* 內容區 */}
        <div style={{ padding: "20px 22px" }}>
          {children}
        </div>
      </div>
    </div>
  );
}
