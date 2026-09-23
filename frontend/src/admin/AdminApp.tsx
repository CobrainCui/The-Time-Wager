import { useCallback, useEffect, useRef, useState } from "react";
import { uiRem } from "../utils/typography";
import { socket } from "../socket";
import { GameState } from "../types";
import { AdminView } from "../views/AdminView";
import { AdminLogin } from "./AdminLogin";
import { clearAdminToken, getAdminToken, setAdminToken } from "./adminToken";

type AuthState = "connecting" | "login" | "authenticated";

interface AdminRoomSummary {
  roomId: string;
  playerCount: number;
  phase: string;
}

export default function AdminApp() {
  const [isConnected, setIsConnected] = useState(socket.connected);
  const [authState, setAuthState] = useState<AuthState>("connecting");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authPending, setAuthPending] = useState(false);
  const [game, setGame] = useState<GameState | null>(null);
  const [adminRoomList, setAdminRoomList] = useState<AdminRoomSummary[]>([]);
  const [projectImages, setProjectImages] = useState<Record<number, number>>({});
  const [eraImages, setEraImages] = useState<Record<string, number>>({});
  const [buffImages, setBuffImages] = useState<Record<string, number>>({});
  /** 断线重连后恢复观战房间 */
  const spectatingRoomIdRef = useRef<string | null>(null);
  const authTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearAuthTimeout = () => {
    if (authTimeoutRef.current) {
      clearTimeout(authTimeoutRef.current);
      authTimeoutRef.current = null;
    }
  };

  const authenticate = useCallback((token: string) => {
    const trimmed = token.trim();
    if (!trimmed) return;

    if (!socket.connected) {
      setAuthState("login");
      setAuthPending(false);
      setAuthError("未连接服务器：请先启动 server（端口 3001）并刷新页面");
      return;
    }

    setAuthPending(true);
    setAuthError(null);
    setAdminToken(trimmed);
    clearAuthTimeout();

    const onOk = () => {
      clearAuthTimeout();
      setAuthState("authenticated");
      setAuthPending(false);
      setAuthError(null);
      const roomId = spectatingRoomIdRef.current;
      if (roomId) socket.emit("adminSpectate", { targetRoomId: roomId });
    };

    const onFailed = ({ message }: { message?: string }) => {
      clearAuthTimeout();
      clearAdminToken();
      setAuthState("login");
      setAuthPending(false);
      setAuthError(message || "密钥无效");
      setGame(null);
    };

    socket.once("adminAuthOk", onOk);
    socket.once("adminAuthFailed", onFailed);

    authTimeoutRef.current = setTimeout(() => {
      socket.off("adminAuthOk", onOk);
      socket.off("adminAuthFailed", onFailed);
      clearAdminToken();
      setAuthPending(false);
      setAuthError(
        "验证超时：请确认已在 server 目录执行 npm run build 并重启，且 .env 中 ADMIN_TOKEN 与输入一致（等号两侧勿加空格）",
      );
      setAuthState("login");
      setGame(null);
    }, 15000);

    socket.emit("adminAuthenticate", { token: trimmed });
  }, []);

  useEffect(() => {
    const tryStoredAuth = () => {
      const stored = getAdminToken();
      if (stored) authenticate(stored);
      else {
        setAuthState("login");
        setAuthPending(false);
      }
    };

    const onConnect = () => {
      setIsConnected(true);
      setAuthState((s) => (s === "authenticated" ? s : "connecting"));
      tryStoredAuth();
    };
    const onDisconnect = () => {
      setIsConnected(false);
      setAuthPending(false);
    };

    const onGameUpdate = (newGame: GameState) => setGame(newGame);
    const onAdminRoomList = (list: AdminRoomSummary[]) => setAdminRoomList(list);
    const onRoomDissolved = () => {
      alert("房间已解散");
      setGame(null);
    };
    const onSyncImages = (images: Record<number, number>) => setProjectImages(images);
    const onSyncEraImages = (images: Record<string, number>) => setEraImages(images);
    const onSyncBuffImages = (images: Record<string, number>) => setBuffImages(images);

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("gameUpdate", onGameUpdate);
    socket.on("adminRoomList", onAdminRoomList);
    socket.on("roomDissolved", onRoomDissolved);
    socket.on("syncProjectImages", onSyncImages);
    socket.on("syncEraImages", onSyncEraImages);
    socket.on("syncBuffImages", onSyncBuffImages);

    if (socket.connected) onConnect();

    return () => {
      clearAuthTimeout();
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("gameUpdate", onGameUpdate);
      socket.off("adminRoomList", onAdminRoomList);
      socket.off("roomDissolved", onRoomDissolved);
      socket.off("syncProjectImages", onSyncImages);
      socket.off("syncEraImages", onSyncEraImages);
      socket.off("syncBuffImages", onSyncBuffImages);
    };
  }, [authenticate]);

  const handleSpectate = (roomId: string) => {
    spectatingRoomIdRef.current = roomId;
    socket.emit("adminSpectate", { targetRoomId: roomId });
  };
  const handleExitRoom = () => {
    spectatingRoomIdRef.current = null;
    if (game) socket.emit("adminLeaveRoom", { roomId: game.roomId });
    setGame(null);
  };

  const handleLogin = (token: string) => {
    if (!isConnected) {
      setAuthError("未连接服务器，请稍后重试");
      return;
    }
    authenticate(token);
  };

  const handleLogout = () => {
    clearAuthTimeout();
    clearAdminToken();
    spectatingRoomIdRef.current = null;
    setGame(null);
    setAdminRoomList([]);
    setAuthState("login");
    socket.disconnect();
    socket.connect();
  };

  if (!isConnected) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          background: "#070b14",
          flexDirection: "column",
          gap: "1rem",
        }}
      >
        <div
          style={{
            width: "3rem",
            height: "3rem",
            borderRadius: "50%",
            border: "3px solid rgba(255,255,255,0.1)",
            borderTopColor: "#3b82f6",
            animation: "spin 1s linear infinite",
          }}
        />
        <div style={{ color: "var(--color-text-muted)", fontSize: uiRem(1) }}>正在连接服务器...</div>
      </div>
    );
  }

  if (authState === "login" || authState === "connecting") {
    if (authState === "connecting" && (authPending || getAdminToken())) {
      return (
        <div className="page-center" style={{ minHeight: "100vh", background: "#070b14", color: "var(--color-text-muted)" }}>
          正在验证密钥…
        </div>
      );
    }
    return <AdminLogin onSubmit={handleLogin} error={authError} pending={authPending} />;
  }

  if (game) {
    return (
      <AdminView
        game={game}
        onExit={handleExitRoom}
        projectImages={projectImages}
        eraImages={eraImages}
        buffImages={buffImages}
        onProjectImageVersion={(id, version) =>
          setProjectImages((prev) => ({ ...prev, [id]: version }))
        }
        onEraImageVersion={(eraName, version) =>
          setEraImages((prev) => ({ ...prev, [eraName]: version }))
        }
        onBuffImageVersion={(cardId, version) =>
          setBuffImages((prev) => ({ ...prev, [cardId]: version }))
        }
      />
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#070b14", padding: "2rem 1.5rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "2rem", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <h1 style={{ fontSize: "2.5rem", fontWeight: 900, color: "#fbbf24", marginBottom: "0.375rem" }}>
            上帝视角控制台
          </h1>
          <p style={{ color: "var(--color-text-muted)", fontSize: uiRem(0.9) }}>
            当前活跃房间 ({adminRoomList.length})
          </p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={handleLogout}>
          退出登录
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          gap: "1rem",
        }}
      >
        {adminRoomList.map((room) => (
          <div
            key={room.roomId}
            style={{
              background: "var(--color-bg-card)",
              border: "1px solid var(--color-border)",
              borderRadius: "1.25rem",
              padding: "1.5rem",
            }}
          >
            <div style={{ fontFamily: "var(--font-mono)", fontSize: "2rem", fontWeight: 900, color: "#fbbf24", marginBottom: "0.5rem" }}>
              {room.roomId}
            </div>
            <div style={{ color: "var(--color-text-muted)", fontSize: uiRem(0.85), marginBottom: "1.25rem" }}>
              <div>人数：{room.playerCount} / 6</div>
              <div>阶段：{room.phase}</div>
            </div>
            <button type="button" onClick={() => handleSpectate(room.roomId)} className="btn btn-primary btn-full" style={{ fontSize: uiRem(0.9) }}>
              进入监视
            </button>
          </div>
        ))}
        {adminRoomList.length === 0 && (
          <div
            style={{
              gridColumn: "1 / -1",
              textAlign: "center",
              padding: "4rem",
              color: "var(--color-text-muted)",
              border: "2px dashed var(--color-border)",
              borderRadius: "1.25rem",
            }}
          >
            暂无活跃房间，等待玩家创建...
          </div>
        )}
      </div>
    </div>
  );
}
