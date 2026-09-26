import { useCallback, useEffect, useRef, useState } from "react";
import { socket } from "../socket";

const FIRST_CONNECT_MS = 20_000;

export function useSocketConnection() {
  const [connected, setConnected] = useState(socket.connected);
  const [error, setError] = useState<string | null>(null);
  const firstConnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearFirstConnectTimer = useCallback(() => {
    if (firstConnectTimerRef.current) {
      clearTimeout(firstConnectTimerRef.current);
      firstConnectTimerRef.current = null;
    }
  }, []);

  const retry = useCallback(() => {
    setError(null);
    clearFirstConnectTimer();
    if (!socket.connected) {
      firstConnectTimerRef.current = setTimeout(() => {
        if (!socket.connected) {
          setError(
            "无法连接 WebSocket。生产环境请确认站点 Nginx 已配置 location /socket.io/ 反代到 Node（3001）；本地请先启动 server 再通过 Vite 打开页面。",
          );
        }
      }, FIRST_CONNECT_MS);
      socket.connect();
    }
  }, [clearFirstConnectTimer]);

  useEffect(() => {
    const onConnect = () => {
      clearFirstConnectTimer();
      setConnected(true);
      setError(null);
    };

    const onDisconnect = () => {
      setConnected(false);
      // 短暂断线重连时不立刻报错，交给 reconnect_failed / 首连超时
    };

    const onConnectError = () => {
      setConnected(false);
      setError(
        "连接被拒绝或网络异常。请确认后端已启动，且当前域名已反代 /socket.io/ 到 Node。",
      );
    };

    const onReconnectFailed = () => {
      setConnected(false);
      setError("多次重连失败，请检查网络或服务器状态后重试。");
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.on("reconnect_failed", onReconnectFailed);

    if (socket.connected) {
      onConnect();
    } else {
      firstConnectTimerRef.current = setTimeout(() => {
        if (!socket.connected) {
          setError(
            "连接超时。生产 admin 子域需配置 /socket.io/ 反代；本地请启动 server（3001）并使用 npm run dev 访问 admin.html。",
          );
        }
      }, FIRST_CONNECT_MS);
    }

    return () => {
      clearFirstConnectTimer();
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.off("reconnect_failed", onReconnectFailed);
    };
  }, [clearFirstConnectTimer]);

  return { connected, error, retry };
}
