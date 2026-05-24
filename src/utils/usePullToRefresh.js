import { useEffect, useRef, useState } from "react";

// 行動裝置 / PWA 下拉重整 hook
// 只在 window.scrollY === 0 時接管 touch 手勢，下拉超過 threshold 後放開觸發 onRefresh
export function usePullToRefresh(onRefresh, { threshold = 70, disabled = false } = {}) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const startYRef = useRef(0);
  const pullingRef = useRef(false);
  const pullRef = useRef(0);
  const refreshingRef = useRef(false);
  const onRefreshRef = useRef(onRefresh);

  useEffect(() => { onRefreshRef.current = onRefresh; }, [onRefresh]);

  useEffect(() => {
    if (disabled) return;

    const onTouchStart = (e) => {
      if (refreshingRef.current) return;
      if (window.scrollY > 0) return;
      startYRef.current = e.touches[0].clientY;
      pullingRef.current = true;
    };

    const onTouchMove = (e) => {
      if (!pullingRef.current) return;
      const dy = e.touches[0].clientY - startYRef.current;
      if (dy <= 0) {
        pullRef.current = 0;
        setPull(0);
        return;
      }
      const damped = Math.min(dy * 0.5, threshold * 1.5);
      pullRef.current = damped;
      setPull(damped);
      if (dy > 10 && e.cancelable) e.preventDefault();
    };

    const onTouchEnd = async () => {
      if (!pullingRef.current) return;
      pullingRef.current = false;
      if (pullRef.current >= threshold) {
        refreshingRef.current = true;
        setRefreshing(true);
        try {
          await onRefreshRef.current?.();
        } finally {
          refreshingRef.current = false;
          setRefreshing(false);
          pullRef.current = 0;
          setPull(0);
        }
      } else {
        pullRef.current = 0;
        setPull(0);
      }
    };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd);
    window.addEventListener("touchcancel", onTouchEnd);
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [threshold, disabled]);

  return { pull, refreshing, threshold };
}
