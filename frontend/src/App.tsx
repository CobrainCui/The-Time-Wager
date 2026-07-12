import { useEffect, useState } from "react";
import { socket } from "./socket";
import { GameState } from "./types";
import GameRoom from "./GameRoom";
import { Lobby } from "./views/Lobby";

function App() {
  const [isConnected, setIsConnected] = useState(socket.connected);
  const [game, setGame] = useState<GameState | null>(null);
  const [myPlayerId, setMyPlayerId] = useState<string>("");
  const [isGod, setIsGod] = useState(false);
  const [adminRoomList, setAdminRoomList] = useState<any[]>([]);
  const [projectImages, setProjectImages] = useState<Record<number, number>>({});

  useEffect(() => {
    const onConnect    = () => setIsConnected(true);
    const onDisconnect = () => setIsConnected(false);

    const onGameUpdate = (newGame: GameState) => {
      setGame(newGame);
      if (newGame && (newGame as any).isGodView) {
        setIsGod(true);
        setMyPlayerId("GOD");
      }
    };

    const onPlayerJoined  = ({ playerId }: { playerId: string }) => setMyPlayerId(playerId);
    const onAdminRoomList = (list: any[]) => { setAdminRoomList(list); setIsGod(true); };
    const onRoomDissolved = () => {
      alert("⚠️ 房间已被管理员解散！");
      setGame(null); setMyPlayerId(""); setIsGod(false);
    };
    const onError = (msg: string) => alert(`❌ ${msg}`);
    const onSyncImages = (images: Record<number, number>) => setProjectImages(images);

    socket.on("connect",       onConnect);
    socket.on("disconnect",    onDisconnect);
    socket.on("gameUpdate",    onGameUpdate);
    socket.on("playerJoined",  onPlayerJoined);
    socket.on("adminRoomList", onAdminRoomList);
    socket.on("roomDissolved", onRoomDissolved);
    socket.on("error",         onError);
    socket.on("syncProjectImages", onSyncImages);

    return () => {
      socket.off("connect",       onConnect);
      socket.off("disconnect",    onDisconnect);
      socket.off("gameUpdate",    onGameUpdate);
      socket.off("playerJoined",  onPlayerJoined);
      socket.off("adminRoomList", onAdminRoomList);
      socket.off("roomDissolved", onRoomDissolved);
      socket.off("error",         onError);
      socket.off("syncProjectImages", onSyncImages);
    };
  }, []);

  const handleSpectate  = (roomId: string) => socket.emit("adminSpectate", { targetRoomId: roomId });
  const handleExitRoom  = () => {
    if (game && isGod) socket.emit("adminLeaveRoom", { roomId: game.roomId });
    setGame(null);
  };

  /* ——— 连接中 ——— */
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
        <div style={{ color: "var(--color-text-muted)", fontSize: "1rem", animation: "pulse 2s infinite" }}>
          正在连接服务器...
        </div>
      </div>
    );
  }

  /* ——— 上帝模式：选房 ——— */
  if (isGod && !game) {
    return (
      <div style={{ minHeight: "100vh", background: "#070b14", padding: "2rem 1.5rem" }}>
        <h1
          style={{
            fontSize: "2.5rem",
            fontWeight: 900,
            color: "#fbbf24",
            marginBottom: "0.375rem",
          }}
        >
          👑 上帝视角控制台
        </h1>
        <p style={{ color: "var(--color-text-muted)", marginBottom: "2rem", fontSize: "0.9rem" }}>
          当前活跃房间 ({adminRoomList.length})
        </p>

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
                transition: "border-color 0.2s ease",
              }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.borderColor = "rgba(245,158,11,0.4)")}
              onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.borderColor = "var(--color-border)")}
            >
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "2rem",
                  fontWeight: 900,
                  color: "#fbbf24",
                  marginBottom: "0.5rem",
                }}
              >
                {room.roomId}
              </div>
              <div style={{ color: "var(--color-text-muted)", fontSize: "0.85rem", marginBottom: "1.25rem" }}>
                <div>人数：{room.playerCount} / 6</div>
                <div>阶段：{room.phase}</div>
              </div>
              <button
                onClick={() => handleSpectate(room.roomId)}
                className="btn btn-primary btn-full"
                style={{ fontSize: "0.9rem" }}
              >
                👁️ 进入监视
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
                fontSize: "1rem",
              }}
            >
              暂无活跃房间，等待玩家创建...
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ——— 游戏中 ——— */
  const me = game?.players.find((p) => p.id === myPlayerId);

  if ((isGod && game) || (game && me)) {
    return (
      <GameRoom
        game={game}
        myPlayerId={isGod ? "GOD" : myPlayerId}
        isGod={isGod}
        onExit={handleExitRoom}
        projectImages={projectImages}
      />
    );
  }

  /* ——— 大厅 ——— */
  return <Lobby game={game || ({ players: [] } as any)} />;
}

export default App;
