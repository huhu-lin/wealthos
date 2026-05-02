// ============================================================
// Card.jsx — 通用卡片容器
// 深色漸層背景 + 細邊框，整個 App 的基本視覺單元
// 用法：<Card style={{ padding: 20 }}>內容</Card>
// ============================================================

import { C } from "../../constants/theme";

export default function Card({ children, style = {}, className = "" }) {
  return (
    <div
      className={className}
      style={{
        background: `linear-gradient(150deg, ${C.surface} 0%, ${C.surface2} 100%)`,
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
