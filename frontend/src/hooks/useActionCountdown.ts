import { useEffect, useState } from "react";
import { getRemainingSeconds } from "../utils/actionCountdown";

/** 投资阶段倒计时（秒），与 serverNow 对齐 */
export function useActionCountdown(
  enabled: boolean,
  endsAt: number | undefined,
  serverNow: number | undefined
): number {
  const [timeLeft, setTimeLeft] = useState(0);

  useEffect(() => {
    if (!enabled || !endsAt) {
      setTimeLeft(0);
      return;
    }
    const tick = () => setTimeLeft(getRemainingSeconds(endsAt, serverNow));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [enabled, endsAt, serverNow]);

  return timeLeft;
}
