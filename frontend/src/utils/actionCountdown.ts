/** 在收到服务端 serverNow 的瞬间计算偏差，之后 tick 时复用该固定值 */
export function computeClockSkewMs(serverNow: number): number {
  return serverNow - Date.now();
}

export function getRemainingMs(endsAt: number, clockSkewMs: number): number {
  return endsAt - Date.now() - clockSkewMs;
}

export function getRemainingSeconds(endsAt: number, clockSkewMs: number): number {
  return Math.max(0, Math.floor(getRemainingMs(endsAt, clockSkewMs) / 1000));
}
