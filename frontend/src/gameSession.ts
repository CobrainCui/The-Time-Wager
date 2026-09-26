const SESSION_KEY = "gydd_game_session";

export type GameSession = { roomId: string; playerName: string };

export function saveGameSession(roomId: string, playerName: string): void {
  sessionStorage.setItem(
    SESSION_KEY,
    JSON.stringify({ roomId: roomId.trim(), playerName: playerName.trim() })
  );
}

export function clearGameSession(): void {
  sessionStorage.removeItem(SESSION_KEY);
}

export function loadGameSession(): GameSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GameSession;
    if (typeof parsed.roomId === "string" && typeof parsed.playerName === "string") {
      const roomId = parsed.roomId.trim();
      const playerName = parsed.playerName.trim();
      if (roomId && playerName) return { roomId, playerName };
    }
  } catch {
    /* ignore */
  }
  return null;
}
