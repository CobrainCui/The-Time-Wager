import { useEffect, useRef } from "react";
import { computeClockSkewMs } from "../utils/actionCountdown";

/** 随 gameUpdate 中的 serverNow 重新校准，供 interval 内读取最新 skew */
export function useServerClockSkewRef(serverNow?: number) {
  const skewRef = useRef(0);
  useEffect(() => {
    if (serverNow != null) {
      skewRef.current = computeClockSkewMs(serverNow);
    }
  }, [serverNow]);
  return skewRef;
}
