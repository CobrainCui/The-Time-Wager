/** 与服务端 broadcast 中的 serverNow 对齐本地时钟 */
export function getServerClockSkewMs(serverNow?: number): number {
  return serverNow != null ? serverNow - Date.now() : 0;
}

export function getRemainingMs(endsAt: number, serverNow?: number): number {
  return endsAt - Date.now() - getServerClockSkewMs(serverNow);
}

export function getRemainingSeconds(endsAt: number, serverNow?: number): number {
  return Math.max(0, Math.floor(getRemainingMs(endsAt, serverNow) / 1000));
}
