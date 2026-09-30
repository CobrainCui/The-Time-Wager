import { useLayoutEffect, useRef } from "react";

/**
 * 测量固定底栏实际占用高度（含 bottom 偏移与换行），写入内容区与 documentElement 的
 * --dock-clearance，供 padding-bottom 与固定定位的私信坞使用。
 *
 * @param enabled 无底栏时写入较小留白
 * @param observeKey 底栏 DOM/内容切换时传入（如 ready），以便重新测量
 */
export function useFixedDockClearance(enabled: boolean, observeKey?: string | number | boolean) {
  const contentRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const content = contentRef.current;
    const root = document.documentElement;

    const setClearance = (value: string) => {
      content?.style.setProperty("--dock-clearance", value);
      root.style.setProperty("--dock-clearance", value);
    };

    if (!enabled) {
      setClearance("1.5rem");
      return () => {
        root.style.removeProperty("--dock-clearance");
      };
    }

    const dock = dockRef.current;
    if (!dock) return;

    const apply = () => {
      const rect = dock.getBoundingClientRect();
      // 底栏所在页被分段切换隐藏（display:none）时 rect 全为 0，不能按整屏计算
      if (rect.height === 0) {
        setClearance("1.5rem");
        return;
      }
      const covered = Math.max(0, Math.ceil(window.innerHeight - rect.top));
      // 额外 12px，避免最后一行贴紧底栏
      setClearance(`${covered + 12}px`);
    };

    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(dock);
    window.addEventListener("resize", apply);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", apply);
      root.style.removeProperty("--dock-clearance");
    };
  }, [enabled, observeKey]);

  return { contentRef, dockRef };
}
