import React, { useState, useEffect } from "react";
import { GameState } from "./types";
import { EraIntro } from "./views/EraIntro";
import { Drafting } from "./views/Drafting";
import { Investment } from "./views/Investment";
import { Settlement } from "./views/Settlement";
import { Lobby } from "./views/Lobby";
import { AdminView } from "./views/AdminView";
import { CommunityNaming } from "./views/CommunityNaming";
import { GameOver } from "./views/GameOver";
import { TutorialView } from "./views/TutorialView";
import { BuffUsage } from "./views/BuffUsage";
import { socket } from "./socket";

const BUFF_NAME_MAP: Record<string, string> = {
  buff_gold: "点石成金", buff_short: "项目做空", buff_slack: "摸鱼传染",
  buff_rebound: "反弹琵琶", buff_insurance: "保险", buff_spirit: "精神老伙",
  buff_swap: "偷天换日", buff_lottery: "彩票",
};

interface GameRoomProps {
  game: GameState;
  myPlayerId: string;
  isGod?: boolean;
  onExit?: () => void;
  projectImages?: Record<number, string>;
}

// ——— 拍卖确认弹窗 ———
const AuctionConfirmModal: React.FC = () => {
  const [request, setRequest] = useState<{ cardId: string; cost: number } | null>(null);

  useEffect(() => {
    const handler = (data: { cardId: string; cost: number }) => setRequest(data);
    socket.on("auctionTradeRequest", handler);
    return () => { socket.off("auctionTradeRequest", handler); };
  }, []);

  const handleRespond = (accept: boolean) => {
    if (!request) return;
    socket.emit("playerRespondAuction", { cardId: request.cardId, cost: request.cost, accept });
    setRequest(null);
  };

  if (!request) return null;
  const cardName = BUFF_NAME_MAP[request.cardId] || request.cardId;

  return (
    <div className="modal-overlay">
      <div
        className="modal-box animate-bounce-in"
        style={{
          border: "2px solid rgba(168,85,247,0.6)",
          boxShadow: "0 0 60px rgba(168,85,247,0.35)",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: "3.5rem", marginBottom: "1rem" }}>🔨</div>
        <h3 style={{ fontSize: "1.4rem", fontWeight: 800, color: "white", marginBottom: "0.5rem" }}>
          竞拍成功！
        </h3>
        <p style={{ color: "var(--color-text-secondary)", marginBottom: "0.75rem" }}>
          你拍得了{" "}
          <span style={{ color: "#d8b4fe", fontWeight: 800, fontSize: "1.1rem" }}>{cardName}</span>
        </p>
        <div
          style={{
            background: "rgba(168,85,247,0.1)",
            border: "1px solid rgba(168,85,247,0.25)",
            borderRadius: "0.875rem",
            padding: "1rem",
            marginBottom: "1.5rem",
          }}
        >
          <div style={{ fontSize: "0.7rem", color: "var(--color-text-muted)", marginBottom: "0.25rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>需支付</div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "3rem", fontWeight: 900, color: "#fbbf24", lineHeight: 1 }}>
            {request.cost}
          </div>
        </div>
        <div style={{ display: "flex", gap: "0.75rem" }}>
          <button
            onClick={() => handleRespond(false)}
            className="btn btn-ghost"
            style={{ flex: 1 }}
          >
            金额有误
          </button>
          <button
            onClick={() => handleRespond(true)}
            className="btn btn-purple"
            style={{ flex: 1, fontSize: "1rem" }}
          >
            确认支付 ✓
          </button>
        </div>
      </div>
    </div>
  );
};

// ——— 资金往来浮窗 ———
const TransactionOverlay: React.FC<{ game: GameState; me: any }> = ({ game, me }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [target, setTarget] = useState("");
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState("");

  const pendingTxs = game.transactions?.filter((t) => t.toId === me.id && t.status === "pending") || [];

  const handleTransfer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!target || amount <= 0) return;
    if (confirm(`确认转账 ${amount} 财富？`)) {
      socket.emit("createTransaction", { toId: target, amount, note });
      setAmount(0); setNote(""); setIsOpen(false);
      alert("转账请求已发送");
    }
  };

  const handleRespond = (txId: string, accept: boolean) => {
    socket.emit("respondTransaction", { txId, accept });
  };

  return (
    <>
      {/* 悬浮按钮 */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          position: "fixed",
          bottom: "6.5rem",
          right: "1.5rem",
          zIndex: 50,
          width: "3.5rem",
          height: "3.5rem",
          borderRadius: "50%",
          background: "linear-gradient(135deg, #3b82f6, #6366f1)",
          border: "none",
          color: "white",
          fontSize: "1.5rem",
          cursor: "pointer",
          boxShadow: "0 4px 20px rgba(59,130,246,0.4)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "transform 0.2s ease",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.1)")}
        onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
        title="资金往来"
      >
        💸
        {pendingTxs.length > 0 && (
          <span
            className="animate-bounce"
            style={{
              position: "absolute",
              top: "-0.25rem",
              right: "-0.25rem",
              background: "#ef4444",
              color: "white",
              fontSize: "0.65rem",
              fontWeight: 800,
              width: "1.25rem",
              height: "1.25rem",
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {pendingTxs.length}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="modal-overlay" onClick={() => setIsOpen(false)}>
          <div
            className="modal-box"
            style={{ maxHeight: "85vh", overflowY: "auto", maxWidth: "440px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
              <h3 style={{ fontWeight: 800, fontSize: "1.15rem", color: "white" }}>💸 资金往来</h3>
              <button onClick={() => setIsOpen(false)} style={{ background: "none", border: "none", color: "var(--color-text-muted)", fontSize: "1.25rem", cursor: "pointer" }}>×</button>
            </div>

            {/* 待处理 */}
            {pendingTxs.length > 0 && (
              <div style={{ marginBottom: "1.25rem" }}>
                <div style={{ fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#fbbf24", marginBottom: "0.75rem" }}>
                  待处理请求 ({pendingTxs.length})
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                  {pendingTxs.map((tx) => (
                    <div key={tx.id} style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: "0.875rem", padding: "1rem" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                        <span style={{ color: "var(--color-text-secondary)", fontSize: "0.875rem" }}>来自：<span style={{ color: "white", fontWeight: 700 }}>{tx.fromName}</span></span>
                        <span style={{ fontFamily: "var(--font-mono)", fontWeight: 800, color: "#fbbf24", fontSize: "1.1rem" }}>+{tx.amount}</span>
                      </div>
                      {tx.note && <div style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", marginBottom: "0.75rem" }}>备注：{tx.note}</div>}
                      <div style={{ display: "flex", gap: "0.5rem" }}>
                        <button onClick={() => handleRespond(tx.id, true)} className="btn btn-success btn-sm" style={{ flex: 1 }}>✓ 接收</button>
                        <button onClick={() => handleRespond(tx.id, false)} className="btn btn-danger btn-sm" style={{ flex: 1 }}>✕ 退回</button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="divider" />
              </div>
            )}

            {/* 发起转账 */}
            <form onSubmit={handleTransfer} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div style={{ fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#60a5fa" }}>发起转账</div>
              <div>
                <label style={{ display: "block", fontSize: "0.75rem", color: "var(--color-text-muted)", marginBottom: "0.5rem" }}>收款人</label>
                <select className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
                  <option value="">— 选择玩家 —</option>
                  {game.players.filter((p) => p.id !== me.id).map((p) => (
                    <option key={p.id} value={p.id}>{p.name} (💰{p.wealth})</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.75rem", color: "var(--color-text-muted)", marginBottom: "0.5rem" }}>金额（最多 {me.wealth}）</label>
                <input type="number" min={1} max={me.wealth} className="input" style={{ fontFamily: "var(--font-mono)", textAlign: "center", fontSize: "1.25rem" }} value={amount || ""} onChange={(e) => setAmount(Number(e.target.value))} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.75rem", color: "var(--color-text-muted)", marginBottom: "0.5rem" }}>备注（可选）</label>
                <input type="text" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="合作愉快..." />
              </div>
              <button type="submit" className="btn btn-primary btn-full" disabled={!target || amount <= 0 || amount > me.wealth} style={{ fontSize: "1rem", padding: "0.875rem" }}>
                确认发送
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
};

// ——— 拍卖等待页 ———
const AuctionWaiting: React.FC = () => (
  <div
    className="page-center flex-col"
    style={{
      background: `radial-gradient(ellipse at 50% 40%, rgba(168,85,247,0.15) 0%, transparent 60%), #070b14`,
      minHeight: "100vh",
      textAlign: "center",
    }}
  >
    <div style={{ fontSize: "6rem", animation: "float 2s ease-in-out infinite", marginBottom: "2rem" }}>🔨</div>
    <h1 style={{ fontSize: "2.5rem", fontWeight: 900, color: "#c084fc", marginBottom: "0.875rem" }}>
      拍卖会进行中
    </h1>
    <p style={{ color: "var(--color-text-secondary)", fontSize: "1rem", marginBottom: "2rem" }}>
      请关注主持人，参与竞拍强力道具卡
    </p>
    <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center" }}>
      {[0.2, 0.4, 0.6].map((d, i) => (
        <div key={i} style={{ width: "0.625rem", height: "0.625rem", borderRadius: "50%", background: "#a855f7", animation: `pulse 1.2s ${d}s infinite` }} />
      ))}
    </div>
  </div>
);

// ——— 主 GameRoom ———
export default function GameRoom({ game, myPlayerId, isGod, onExit, projectImages = {} }: GameRoomProps) {
  if (isGod) {
    return <AdminView game={game} onExit={onExit} projectImages={projectImages} />;
  }

  const me = game.players.find((p) => p.id === myPlayerId);
  if (!me) {
    return (
      <div className="page-center" style={{ flexDirection: "column", gap: "1rem" }}>
        <div style={{ fontSize: "3rem" }}>❌</div>
        <div style={{ color: "#f87171", fontWeight: 700 }}>未识别玩家身份，请刷新重试</div>
      </div>
    );
  }

  const isIntro = game.phase === "ERA_INTRO";

  const renderMainView = () => {
    if (game.phase === "BUFF_USAGE" && me.ready) {
      return <Investment game={game} me={me} mode="investment" projectImages={projectImages} />;
    }
    switch (game.phase) {
      case "ERA_INTRO":       return <EraIntro game={game} me={me} />;
      case "TUTORIAL":        return <TutorialView game={game} me={me} />;
      case "DRAFTING":        return <Drafting game={game} me={me} />;
      case "BUFF_USAGE":      return <BuffUsage game={game} me={me} />;
      case "INVESTMENT":      return <Investment game={game} me={me} mode="investment" projectImages={projectImages} />;
      case "SETTLEMENT":      return <Settlement game={game} me={me} />;
      case "AUCTION":         return <AuctionWaiting />;
      case "COMMUNITY_NAMING":return <CommunityNaming game={game} me={me} />;
      case "GAME_OVER":       return <GameOver game={game} me={me} />;
      default:                return <EraIntro game={game} me={me} />;
    }
  };

  return (
    <div style={{ position: "relative", minHeight: "100vh" }}>
      {renderMainView()}
      {!isIntro && <TransactionOverlay game={game} me={me} />}
      <AuctionConfirmModal />
    </div>
  );
}
