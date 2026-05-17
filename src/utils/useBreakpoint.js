// ============================================================
// useBreakpoint.js — 統一響應式 Hook
// 全 App 共用一份視窗寬度狀態，避免每個元件各自監聽 resize
// 用法：
//   const isMobile = useIsMobile();          // ≤480px
//   const isTablet = useIsTablet();          // ≤768px
//   const width    = useWindowWidth();       // 原始 px 數值
// ============================================================

import { useState, useEffect } from "react";
import { BP } from "../constants/theme";

export function useWindowWidth() {
  const [width, setWidth] = useState(
    typeof window !== "undefined" ? window.innerWidth : 1280
  );
  useEffect(() => {
    const handler = () => setWidth(window.innerWidth);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return width;
}

export function useIsMobile() {
  return useWindowWidth() <= BP.mobile;
}

export function useIsTablet() {
  return useWindowWidth() <= BP.tablet;
}
