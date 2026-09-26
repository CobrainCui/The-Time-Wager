import { useEffect, useState } from "react";
import { socket } from "./socket";
import { GameState } from "./types";
import GameRoom from "./GameRoom";
import { Lobby } from "./views/Lobby";
import { clearGameSession, loadGameSession } from "./gameSession";
import { ConnectionGate } from "./components/ConnectionGate";
import { useSocketConnection } from "./hooks/useSocketConnection";

function tryRejoinFromSession() {
  const session = loadGameSession();
  if (session) {
    socket.emit("joinGame", { roomId: session.roomId, name: session.playerName });
  }
}

function App() {
  const { connected, error: connectError, retry: retryConnect } = useSocketConnection();
  const [game, setGame] = useState<GameState | null>(null);
  const [myPlayerId, setMyPlayerId] = useState<string>("");
  const [projectImages, setProjectImages] = useState<Record<number, number>>({});
  const [eraImages, setEraImages] = useState<Record<string, number>>({});
  const [buffImages, setBuffImages] = useState<Record<string, number>>({});
  const [playerNotify, setPlayerNotify] = useState<string | null>(null);

  useEffect(() => {
    if (!playerNotify) return;
    const t = window.setTimeout(() => setPlayerNotify(null), 6000);
    return () => window.clearTimeout(t);
  }, [playerNotify]);

  useEffect(() => {
    const onConnect = () => tryRejoinFromSession();

    const onGameUpdate = (newGame: GameState) => setGame(newGame);
    const onPlayerJoined = ({ playerId }: { playerId: string }) => setMyPlayerId(playerId);
    const onRoomDissolved = () => {
      alert("⚠️ 房间已被管理员解散！");
      clearGameSession();
      setGame(null);
      setMyPlayerId("");
    };
    const onError = (msg: string) => alert(`❌ ${msg}`);
    const onPlayerKicked = ({ message }: { message?: string }) => {
      alert(message || "你已被移出房间");
      clearGameSession();
      setGame(null);
      setMyPlayerId("");
    };
    const onPlayerNotify = ({ message }: { message: string }) => setPlayerNotify(message);
    const onSyncImages = (images: Record<number, number>) => setProjectImages(images);
    const onSyncEraImages = (images: Record<string, number>) => setEraImages(images);
    const onSyncBuffImages = (images: Record<string, number>) => setBuffImages(images);

    socket.on("connect", onConnect);
    socket.on("gameUpdate", onGameUpdate);
    socket.on("playerJoined", onPlayerJoined);
    socket.on("roomDissolved", onRoomDissolved);
    socket.on("error", onError);
    socket.on("playerKicked", onPlayerKicked);
    socket.on("playerNotify", onPlayerNotify);
    socket.on("syncProjectImages", onSyncImages);
    socket.on("syncEraImages", onSyncEraImages);
    socket.on("syncBuffImages", onSyncBuffImages);

    if (socket.connected) tryRejoinFromSession();

    return () => {
      socket.off("connect", onConnect);
      socket.off("gameUpdate", onGameUpdate);
      socket.off("playerJoined", onPlayerJoined);
      socket.off("roomDissolved", onRoomDissolved);
      socket.off("error", onError);
      socket.off("playerKicked", onPlayerKicked);
      socket.off("playerNotify", onPlayerNotify);
      socket.off("syncProjectImages", onSyncImages);
      socket.off("syncEraImages", onSyncEraImages);
      socket.off("syncBuffImages", onSyncBuffImages);
    };
  }, []);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible" || !loadGameSession()) return;
      if (!socket.connected) return;
      socket.emit("requestGameState");
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const handleExitRoom = () => {
    socket.emit("leaveGame");
    clearGameSession();
    setGame(null);
    setMyPlayerId("");
  };

  const me = game?.players.find((p) => p.id === myPlayerId);

  const notifyToast = playerNotify ? (
    <div className="player-notify-toast" role="status" aria-live="polite">
      {playerNotify}
    </div>
  ) : null;

  return (
    <ConnectionGate connected={connected} error={connectError} onRetry={retryConnect} variant="player">
      {game && me ? (
        <>
          {notifyToast}
          <GameRoom
            game={game}
            myPlayerId={myPlayerId}
            projectImages={projectImages}
            eraImages={eraImages}
            buffImages={buffImages}
            onExit={handleExitRoom}
          />
        </>
      ) : (
        <>
          {notifyToast}
          <Lobby game={game || ({ players: [] } as unknown as GameState)} />
        </>
      )}
    </ConnectionGate>
  );
}

export default App;
