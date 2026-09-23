import { useEffect, useState } from "react";
import { uiRem } from "./utils/typography";
import { socket } from "./socket";
import { GameState } from "./types";
import GameRoom from "./GameRoom";
import { Lobby } from "./views/Lobby";

function App() {
  const [isConnected, setIsConnected] = useState(socket.connected);
  const [game, setGame] = useState<GameState | null>(null);
  const [myPlayerId, setMyPlayerId] = useState<string>("");
  const [projectImages, setProjectImages] = useState<Record<number, number>>({});
  const [eraImages, setEraImages] = useState<Record<string, number>>({});
  const [buffImages, setBuffImages] = useState<Record<string, number>>({});

  useEffect(() => {
    const onConnect = () => setIsConnected(true);
    const onDisconnect = () => setIsConnected(false);

    const onGameUpdate = (newGame: GameState) => setGame(newGame);
    const onPlayerJoined = ({ playerId }: { playerId: string }) => setMyPlayerId(playerId);
    const onRoomDissolved = () => {
      alert("⚠️ 房间已被管理员解散！");
      setGame(null);
      setMyPlayerId("");
    };
    const onError = (msg: string) => alert(`❌ ${msg}`);
    const onSyncImages = (images: Record<number, number>) => setProjectImages(images);
    const onSyncEraImages = (images: Record<string, number>) => setEraImages(images);
    const onSyncBuffImages = (images: Record<string, number>) => setBuffImages(images);

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("gameUpdate", onGameUpdate);
    socket.on("playerJoined", onPlayerJoined);
    socket.on("roomDissolved", onRoomDissolved);
    socket.on("error", onError);
    socket.on("syncProjectImages", onSyncImages);
    socket.on("syncEraImages", onSyncEraImages);
    socket.on("syncBuffImages", onSyncBuffImages);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("gameUpdate", onGameUpdate);
      socket.off("playerJoined", onPlayerJoined);
      socket.off("roomDissolved", onRoomDissolved);
      socket.off("error", onError);
      socket.off("syncProjectImages", onSyncImages);
      socket.off("syncEraImages", onSyncEraImages);
      socket.off("syncBuffImages", onSyncBuffImages);
    };
  }, []);

  const handleExitRoom = () => {
    setGame(null);
    setMyPlayerId("");
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
        <div style={{ color: "var(--color-text-muted)", fontSize: uiRem(1), animation: "pulse 2s infinite" }}>
          正在连接服务器...
        </div>
      </div>
    );
  }

  const me = game?.players.find((p) => p.id === myPlayerId);

  if (game && me) {
    return (
      <GameRoom
        game={game}
        myPlayerId={myPlayerId}
        projectImages={projectImages}
        eraImages={eraImages}
        buffImages={buffImages}
        onExit={handleExitRoom}
      />
    );
  }

  return <Lobby game={game || ({ players: [] } as unknown as GameState)} />;
}

export default App;
