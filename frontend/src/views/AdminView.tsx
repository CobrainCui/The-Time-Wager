import React, { useState, useEffect } from "react";
import { GameState } from "../types";
import { socket, BACKEND_URL } from "../socket";
import { TUTORIAL_SLIDES } from "../tutorialData";

const AUCTION_CARDS: Record<number, { id: string; name: string }[]> = {
  1: [
    { id: "buff_gold", name: "点石成金" },
    { id: "buff_short", name: "项目做空" },
  ],
  2: [
    { id: "buff_slack", name: "摸鱼传染" },
    { id: "buff_rebound", name: "反弹琵琶" },
    { id: "buff_insurance", name: "保险" },
  ],
  3: [
    { id: "buff_spirit", name: "精神老伙" },
    { id: "buff_swap", name: "偷天换日" },
    { id: "buff_lottery", name: "彩票" },
  ],
};

const CARD_NAME_MAP: Record<string, string> = {
  buff_gold: "点石成金", buff_short: "项目做空", buff_slack: "摸鱼传染",
  buff_rebound: "反弹琵琶", buff_insurance: "保险", buff_spirit: "精神老伙",
  buff_swap: "偷天换日", buff_lottery: "彩票",
};

interface Props {
  game: GameState;
  onExit?: () => void;
  projectImages?: Record<number, number>;
}

const PHASE_NAMES: Record<string, string> = {
  ERA_INTRO: "时代介绍", TUTORIAL: "新手教程", DRAFTING: "选座阶段",
  INVESTMENT: "投资决策", BUFF_USAGE: "道具使用", SETTLEMENT: "本轮结算",
  AUCTION: "拍卖会", GAME_OVER: "游戏结束", COMMUNITY_NAMING: "社区命名",
};

export const AdminView: React.FC<Props> = ({ game, onExit, projectImages = {} }) => {
  const [timeLeft, setTimeLeft] = useState(0);
  const [auctionCost, setAuctionCost] = useState(0);

  useEffect(() => {
    const target = game.investmentEndsAt || game.buffPhaseEndsAt;
    if (!target) { setTimeLeft(0); return; }
    const t = setInterval(() => setTimeLeft(Math.max(0, Math.floor((target - Date.now()) / 1000))), 1000);
    return () => clearInterval(t);
  }, [game.investmentEndsAt, game.buffPhaseEndsAt]);

  const emit = (event: string, extra?: object) => socket.emit(event, { roomId: game.roomId, ...extra });

  const handleProposeBuff = (playerId: string, cardId: string) => {
    if (game.phase !== "AUCTION") { alert("只能在拍卖阶段发卡"); return; }
    emit("adminProposeBuff", { playerId, cardId, cost: auctionCost });
    alert("已发送交易请求");
  };

  const handleSocialRate = (playerId: string, rank: string) => {
    if (!rank) return;
    emit("adminRateSocial", { targetPlayerId: playerId, rank });
  };

  const handleSettleLottery = (playerId: string) => {
    const amount = prompt("请输入彩票中奖金额（可负）:", "0");
    if (amount !== null) emit("adminSettleLottery", { targetPlayerId: playerId, amount: Number(amount) });
  };

  const sortedPlayers = [...game.players].sort((a, b) => b.wealth - a.wealth);
  const currentStep = game.tutorialStep || 0;
  const isLastStep = currentStep >= TUTORIAL_SLIDES.length - 1;
  const auctionRound = Math.max(1, Math.min(game.currentEra - 1, 3)) as 1 | 2 | 3;
  const currentAuctionCards = AUCTION_CARDS[auctionRound] || AUCTION_CARDS[1];

  const mins = Math.floor(timeLeft / 60);
  const secs = (timeLeft % 60).toString().padStart(2, "0");
  const isUrgent = timeLeft < 60 && timeLeft > 0;

  const handleImageUpload = (id: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (typeof ev.target?.result === 'string') {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX_WIDTH = 800;
          const MAX_HEIGHT = 800;
          let width = img.width;
          let height = img.height;
          
          if (width > height) {
            if (width > MAX_WIDTH) {
              height *= MAX_WIDTH / width;
              width = MAX_WIDTH;
            }
          } else {
            if (height > MAX_HEIGHT) {
              width *= MAX_HEIGHT / height;
              height = MAX_HEIGHT;
            }
          }
          
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);
          
          canvas.toBlob(async (blob) => {
            if (!blob) return;
            const formData = new FormData();
            formData.append("id", id.toString());
            formData.append("image", blob, `${id}.jpg`);
            
            try {
              const res = await fetch(`${BACKEND_URL}/api/upload-image`, {
                method: "POST",
                body: formData
              });
              if (!res.ok) alert("上传失败！");
            } catch (err) {
              console.error(err);
              alert("上传出错：" + err);
            }
          }, 'image/jpeg', 0.6);
        };
        img.src = ev.target.result;
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div style={{ minHeight: "100vh", background: "#070b14", color: "white", fontFamily: "var(--font-sans)" }}>
      {/* 顶部控制栏 */}
      <div
        style={{
          background: "rgba(245,158,11,0.06)",
          borderBottom: "1px solid rgba(245,158,11,0.2)",
          padding: "1rem 1.5rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "1rem",
          position: "sticky",
          top: 0,
          zIndex: 40,
          backdropFilter: "blur(16px)",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <h1 style={{ fontSize: "1.2rem", fontWeight: 800, color: "#fbbf24" }}>👑 上帝控制台</h1>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: "var(--color-text-muted)" }}>
              Room: {game.roomId}
            </span>
          </div>
          <div style={{ display: "flex", gap: "1rem", alignItems: "center", marginTop: "0.25rem", flexWrap: "wrap", fontSize: "0.8rem" }}>
            <span>
              阶段:{" "}
              <span style={{ color: "#60a5fa", fontWeight: 700 }}>
                {PHASE_NAMES[game.phase] || game.phase}
              </span>
            </span>
            <span style={{ color: "var(--color-text-muted)" }}>Era {game.currentEra} · R{game.roundInEra}</span>
            {timeLeft > 0 && (
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontWeight: 700,
                  color: isUrgent ? "#ef4444" : "#34d399",
                  background: isUrgent ? "rgba(239,68,68,0.15)" : "rgba(52,211,153,0.1)",
                  padding: "0.15rem 0.6rem",
                  borderRadius: "0.375rem",
                  animation: isUrgent ? "pulse 1s infinite" : undefined,
                }}
              >
                ⏱ {mins}:{secs}
              </span>
            )}
          </div>
        </div>

        <div style={{ display: "flex", gap: "0.625rem", flexWrap: "wrap" }}>
          {game.phase === "ERA_INTRO" && (
            <>
              <button className="btn btn-primary btn-sm" onClick={() => emit("adminStartTutorial")}>🎓 教程</button>
              <button className="btn btn-success btn-sm" onClick={() => { if (confirm("确认开局？")) emit("adminStartGame"); }}>▶ 开局</button>
            </>
          )}
          {game.phase === "TUTORIAL" && (
            <>
              <button className="btn btn-ghost btn-sm" onClick={() => emit("adminTutorialPrev")} disabled={currentStep === 0}>←</button>
              <span style={{ padding: "0.3rem 0.5rem", fontSize: "0.8rem", color: "var(--color-text-muted)" }}>{currentStep + 1}/{TUTORIAL_SLIDES.length}</span>
              {isLastStep
                ? <button className="btn btn-success btn-sm" onClick={() => emit("adminEndTutorial")}>✓ 完成</button>
                : <button className="btn btn-primary btn-sm" onClick={() => emit("adminTutorialNext")}>→</button>
              }
            </>
          )}
          {game.phase === "AUCTION" ? (
            <button className="btn btn-purple btn-sm animate-pulse" onClick={() => { if (confirm("结束拍卖并进入下一阶段？")) emit("adminEndAuction"); }}>🏁 结束拍卖</button>
          ) : (
            <button className="btn btn-sm" style={{ background: "rgba(168,85,247,0.15)", border: "1px solid rgba(168,85,247,0.4)", color: "#c084fc" }} onClick={() => { if (confirm("开启拍卖阶段？")) emit("adminSkipPhase", { targetPhase: "AUCTION" }); }}>🔨 拍卖</button>
          )}
          {game.phase !== "ERA_INTRO" && game.phase !== "TUTORIAL" && (
            <button className="btn btn-sm" style={{ background: "rgba(249,115,22,0.15)", border: "1px solid rgba(249,115,22,0.35)", color: "#fb923c" }} onClick={() => { if (confirm(`跳过 [${game.phase}]？`)) emit("adminSkipPhase"); }}>⏭ 跳过</button>
          )}
          <button className="btn btn-danger btn-sm" onClick={() => { if (confirm("警告：解散房间？")) emit("adminDissolveRoom"); }}>💣 解散</button>
          <button className="btn btn-ghost btn-sm" onClick={onExit}>← 返回</button>
        </div>
      </div>

      <div style={{ padding: "1.5rem", maxWidth: "1400px", margin: "0 auto" }}>
        
        {/* 项目图片管理 */}
        <div
          style={{
            background: "rgba(16,185,129,0.08)",
            border: "2px solid rgba(16,185,129,0.4)",
            borderRadius: "1.25rem",
            padding: "1.5rem",
            marginBottom: "1.5rem",
          }}
        >
          <h2 style={{ fontSize: "1.2rem", fontWeight: 800, color: "#34d399", marginBottom: "1rem" }}>
            🖼️ 游戏项目图片全局管理
          </h2>
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            {game.activeProjects.map(proj => (
              <div key={proj.id} style={{
                background: "rgba(0,0,0,0.3)", border: "1px solid rgba(16,185,129,0.25)",
                borderRadius: "0.875rem", padding: "1rem", width: "200px", textAlign: "center"
              }}>
                <div style={{ fontWeight: 700, color: "white", marginBottom: "0.5rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{proj.name}</div>
                {projectImages[proj.id] ? (
                  <img src={`${BACKEND_URL}/uploads/${proj.id}.jpg?v=${projectImages[proj.id]}`} alt={proj.name} style={{ width: "100%", height: "100px", objectFit: "cover", borderRadius: "0.5rem", marginBottom: "0.5rem" }} />
                ) : (
                  <div style={{ width: "100%", height: "100px", background: "rgba(255,255,255,0.05)", borderRadius: "0.5rem", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-text-muted)", fontSize: "0.8rem", marginBottom: "0.5rem" }}>
                    <img src={`/images/projects/${proj.name}.jpg?v=final2`} className="w-full h-32 object-cover rounded-md" alt={proj.name} onError={(e) => e.currentTarget.style.display='none'} />
                  </div>
                )}
                <label className="btn btn-sm btn-full" style={{ background: "rgba(16,185,129,0.2)", border: "1px solid #10b981", color: "#34d399", cursor: "pointer", display: "block" }}>
                  上传图片
                  <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => handleImageUpload(proj.id, e)} />
                </label>
              </div>
            ))}
            {game.activeProjects.length === 0 && (
              <div style={{ color: "var(--color-text-muted)" }}>当游戏正式开始并抽取项目后，方可上传图片。</div>
            )}
          </div>
        </div>

        {/* AI 与自动调优控制台 */}
        <div
          style={{
            background: "rgba(59,130,246,0.08)",
            border: "2px solid rgba(59,130,246,0.4)",
            borderRadius: "1.25rem",
            padding: "1.5rem",
            marginBottom: "1.5rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "1rem"
          }}
        >
          <div>
            <h2 style={{ fontSize: "1.2rem", fontWeight: 800, color: "#60a5fa", marginBottom: "0.5rem" }}>🤖 AI 调优控制台</h2>
            <div style={{ color: "var(--color-text-muted)", fontSize: "0.8rem" }}>通过加入具备特定性格设定的大模型玩家，自动进行游戏以调优参数权重。</div>
          </div>
          <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <select id="aiPersonaSelect" className="input" style={{ fontSize: "0.85rem" }}>
                <option value="罗盘精算师">罗盘精算师 (理智/算计)</option>
                <option value="时荫植者">时荫植者 (长线/蛰伏)</option>
                <option value="涌机触发者">涌机触发者 (高风险/攻击)</option>
                <option value="瞬刻炼金士">瞬刻炼金士 (短线/机会主义)</option>
              </select>
              <button 
                className="btn btn-sm" 
                style={{ background: "rgba(59,130,246,0.2)", border: "1px solid #3b82f6", color: "#60a5fa" }}
                onClick={() => {
                  const sel = document.getElementById("aiPersonaSelect") as HTMLSelectElement;
                  if (sel) emit("adminAddAI", { persona: sel.value });
                }}
              >+ 添加 AI 玩家</button>
            </div>
            <div style={{ width: "1px", height: "30px", background: "rgba(255,255,255,0.1)" }}></div>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <input id="autoTuneIterations" type="number" defaultValue={5} className="input" style={{ width: "4rem", textAlign: "center" }} title="迭代次数" />
              <button 
                className="btn btn-danger btn-sm" 
                onClick={() => {
                  const it = document.getElementById("autoTuneIterations") as HTMLInputElement;
                  const iterations = Number(it?.value) || 5;
                  if (confirm(`将在后端全自动运行 ${iterations} 次 6个大模型的游戏，确保已配置 OPENAI_API_KEY。确认执行？`)) {
                    emit("adminStartAutoPlay", { iterations });
                  }
                }}
              >⚡ 开始无头对弈 (Auto-Play)</button>
            </div>
          </div>
        </div>

        {/* 拍卖面板 */}
        {game.phase === "AUCTION" && (
          <div
            style={{
              background: "rgba(168,85,247,0.08)",
              border: "2px solid rgba(168,85,247,0.4)",
              borderRadius: "1.25rem",
              padding: "1.5rem",
              marginBottom: "1.5rem",
              boxShadow: "0 0 30px rgba(168,85,247,0.15)",
            }}
          >
            <h2 style={{ fontSize: "1.2rem", fontWeight: 800, color: "#c084fc", marginBottom: "1rem" }}>
              🔨 拍卖发卡控制台
            </h2>
            <div style={{ display: "flex", alignItems: "center", gap: "0.875rem", marginBottom: "1.25rem" }}>
              <label style={{ fontWeight: 700, color: "#fbbf24", fontSize: "0.875rem" }}>成交价格：</label>
              <input
                type="number"
                value={auctionCost}
                onChange={(e) => setAuctionCost(Number(e.target.value))}
                className="input"
                style={{ width: "7rem", textAlign: "center", fontFamily: "var(--font-mono)", fontSize: "1.1rem" }}
              />
              <span style={{ color: "var(--color-text-muted)", fontSize: "0.8rem" }}>先设定价格，再点击发放</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "1rem" }}>
              {currentAuctionCards.map((card) => (
                <div
                  key={card.id}
                  style={{
                    background: "rgba(0,0,0,0.3)",
                    border: "1px solid rgba(168,85,247,0.25)",
                    borderRadius: "0.875rem",
                    padding: "1rem",
                  }}
                >
                  <div style={{ fontWeight: 700, color: "#d8b4fe", marginBottom: "0.75rem", fontSize: "0.95rem" }}>
                    🃏 {card.name}
                  </div>
                  <select
                    className="input"
                    style={{ fontSize: "0.85rem" }}
                    onChange={(e) => { if (e.target.value) { handleProposeBuff(e.target.value, card.id); e.target.value = ""; } }}
                  >
                    <option value="">发给玩家...</option>
                    {sortedPlayers.map((p) => (
                      <option key={p.id} value={p.id}>{p.name} (💰{p.wealth})</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "1.5rem" }}>
          {/* 玩家监控表 */}
          <div
            style={{
              background: "var(--color-bg-card)",
              border: "1px solid var(--color-border)",
              borderRadius: "1.25rem",
              overflow: "hidden",
            }}
          >
            <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid var(--color-border)" }}>
              <h2 style={{ fontWeight: 700, fontSize: "1rem" }}>👥 玩家实时监控</h2>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                <thead>
                  <tr style={{ background: "rgba(255,255,255,0.02)", color: "var(--color-text-muted)" }}>
                    {["#", "昵称", "状态", "社交", "手牌", "已用", "⚡", "💰", "操作"].map((h, i) => (
                      <th key={i} style={{ padding: "0.75rem 0.875rem", fontWeight: 700, fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "left", whiteSpace: "nowrap" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedPlayers.map((p, idx) => {
                    const hasLottery = p.activeBuffs?.some((b) => b.cardId === "buff_lottery");
                    return (
                      <tr key={p.id} style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                        <td style={{ padding: "0.875rem", color: "var(--color-text-muted)" }}>{idx + 1}</td>
                        <td style={{ padding: "0.875rem", fontWeight: 700, color: "white" }}>{p.name}</td>
                        <td style={{ padding: "0.875rem" }}>
                          {p.connected ? (p.ready ? <span style={{ color: "#34d399" }}>✅</span> : <span style={{ color: "#fbbf24" }}>⏳</span>) : <span style={{ color: "#f87171" }}>❌</span>}
                        </td>
                        <td style={{ padding: "0.875rem" }}>
                          <select
                            style={{
                              background: "rgba(15, 20, 60, 0.85)",
                              border: `1px solid ${p.socialRank === "A" ? "rgba(212,175,55,0.6)" : "rgba(212,175,55,0.2)"}`,
                              borderRadius: "0.375rem",
                              color: p.socialRank === "A" ? "#d4af37" : "var(--color-text-secondary)",
                              padding: "0.25rem 0.5rem",
                              fontSize: "0.8rem",
                              outline: "none",
                              cursor: "pointer",
                            }}
                            value={p.socialRank || ""}
                            onChange={(e) => handleSocialRate(p.id, e.target.value)}
                          >
                            <option value="">待评</option>
                            {["A", "B", "C", "D", "E"].map((r) => (
                              <option key={r} value={r}>{r}</option>
                            ))}
                          </select>
                        </td>
                        <td style={{ padding: "0.875rem" }}>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
                            {(p.inventory || []).map((cid, i) => (
                              <span key={i} style={{ background: "rgba(168,85,247,0.2)", border: "1px solid rgba(168,85,247,0.4)", borderRadius: "0.25rem", padding: "0.15rem 0.5rem", color: "#d8b4fe", fontSize: "0.7rem", whiteSpace: "nowrap" }}>
                                {CARD_NAME_MAP[cid] || cid}
                              </span>
                            ))}
                            {(!p.inventory || p.inventory.length === 0) && <span style={{ color: "var(--color-text-muted)" }}>—</span>}
                          </div>
                        </td>
                        <td style={{ padding: "0.875rem" }}>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
                            {(p.usedCards || []).map((cid, i) => (
                              <span key={i} style={{ color: "var(--color-text-muted)", textDecoration: "line-through", fontSize: "0.7rem" }}>
                                {CARD_NAME_MAP[cid] || cid}
                              </span>
                            ))}
                            {(!p.usedCards || p.usedCards.length === 0) && <span style={{ color: "var(--color-text-muted)", fontSize: "0.7rem" }}>—</span>}
                          </div>
                        </td>
                        <td style={{ padding: "0.875rem", fontFamily: "var(--font-mono)", fontWeight: 700, color: "#34d399" }}>{p.energy}</td>
                        <td style={{ padding: "0.875rem", fontFamily: "var(--font-mono)", fontWeight: 700, color: "#fbbf24" }}>{p.wealth}</td>
                        <td style={{ padding: "0.875rem" }}>
                          <div style={{ display: "flex", gap: "0.375rem", flexWrap: "wrap" }}>
                            <button
                              onClick={() => { if (confirm(`踢出 ${p.name}？`)) emit("adminKickPlayer", { targetPlayerId: p.id }); }}
                              style={{ fontSize: "0.7rem", padding: "0.2rem 0.5rem", background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.35)", borderRadius: "0.375rem", color: "#f87171", cursor: "pointer" }}
                            >踢</button>
                            {p.ready && (
                              <button
                                onClick={() => { if (confirm(`解锁 ${p.name}？`)) emit("adminUnlockPlayer", { targetPlayerId: p.id }); }}
                                style={{ fontSize: "0.7rem", padding: "0.2rem 0.5rem", background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.35)", borderRadius: "0.375rem", color: "#fbbf24", cursor: "pointer" }}
                              >解</button>
                            )}
                            {hasLottery && (
                              <button
                                onClick={() => handleSettleLottery(p.id)}
                                className="animate-pulse"
                                style={{ fontSize: "0.7rem", padding: "0.2rem 0.5rem", background: "rgba(16,185,129,0.2)", border: "1px solid rgba(16,185,129,0.4)", borderRadius: "0.375rem", color: "#34d399", cursor: "pointer" }}
                              >🎲</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* 日志 */}
          <div
            style={{
              background: "var(--color-bg-card)",
              border: "1px solid var(--color-border)",
              borderRadius: "1.25rem",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              height: "600px",
            }}
          >
            <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid var(--color-border)", flexShrink: 0 }}>
              <h2 style={{ fontWeight: 700, fontSize: "1rem" }}>📜 游戏日志</h2>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "0.875rem" }}>
              {[...game.logs].reverse().map((log, i) => (
                <div
                  key={i}
                  style={{
                    borderLeft: "2px solid rgba(255,255,255,0.06)",
                    paddingLeft: "0.75rem",
                    paddingTop: "0.375rem",
                    paddingBottom: "0.375rem",
                    fontSize: "0.75rem",
                    color: "var(--color-text-secondary)",
                    lineHeight: 1.5,
                  }}
                >
                  {log}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
