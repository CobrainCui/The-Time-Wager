import { GameState, ActiveProject } from "./gameState.js";
import { 
  shortTermProjects, 
  longTermProjects, 
  riskProjects,
  ProjectCard,
  eraCards
} from "../data/game_data.js";
import { shuffleArray } from "../utils/shuffle.js";

export function drawProjectsForEra(game: GameState) {
  
  // 1. 换代处理：移除旧时代的风险项目 (保留其他类型未完成的项目)
  if (game.roundInEra === 1 && game.currentEra > 1) {
      game.activeProjects = game.activeProjects.filter(p => p.type !== 'risk');
      game.logs.push(`⚠️ 新时代开始，旧时代的风险项目已移除`);
  }

  // 2. 更新时代卡 (确保不重复)
  if (game.roundInEra === 1) {
      // eraSequence 是在游戏初始化时生成的 [0,1,2,3,4] 的乱序数组
      // 我们按顺序取，保证不重复
      const index = game.currentEra - 1; 
      
      // 防止越界 (虽然逻辑上不会，做个保护)
      if (index < game.eraSequence.length) {
          const cardId = game.eraSequence[index]; 
          // eraCards 的 ID 是 1-5，而 sequence 是 0-4? 
          // 检查 createInitialGame: shuffleArray([0, 1, 2, 3, 4]). 
          // 检查 game_data: eraCards id 是 1,2,3,4,5.
          // 修正：假设 sequence 对应数组下标
          game.currentEraCard = eraCards.find(c => c.id === (cardId + 1)) || eraCards[0];
      } else {
          // 如果超出了（比如Era 6），默认取最后一个或随机
          game.currentEraCard = eraCards[eraCards.length - 1];
      }
      
      game.logs.push(`🌍 时代主题更新：${game.currentEraCard.name} (${game.currentEraCard.era})`);
  }
  
  // 仅在每代第一轮发新卡
  if (game.roundInEra !== 1) return;

  const newProjects: ActiveProject[] = [];

  const toActive = (card: ProjectCard): ActiveProject => {
    return {
      id: card.id,
      name: card.name,
      type: card.type,
      color: mapEraToColor(card.era), 
      maxEnergy: card.maxEnergy,
      era: card.era,
      accumulatedInvested: 0, 
      currentInvested: 0,
      roundsNoInvestment: 0,
      investedThisRound: false,
      rankRewards: card.rankRewards,
      overInvestPenalty: card.overInvestPenalty,
      startRound: card.startRound,
      
      investorRecords: {},
      earningRecords: {},
      totalPayout: 0
    };
  };

  const isAvailable = (p: ProjectCard) => 
      !game.activeProjects.some(ap => ap.id === p.id) && !game.drawnProjects.has(p.id);

  const currentTheme = game.currentEraCard?.era; 
  
  // ✅ 修改点1：短期和长期项目不再筛选 p.era === currentTheme，改为完全随机
  const availableShort = shortTermProjects.filter(p => isAvailable(p));
  const availableLong  = longTermProjects.filter(p => isAvailable(p));
  
  // ✅ 风险项目：必须跟随当前时代
  const availableRisk  = riskProjects.filter(p => 
      !isProjectActiveOrDrawn(game, p.id) && 
      p.era === currentTheme
  );

  // 数量分配
  let countShort = 0;
  let countLong = 0;
  let countRisk = 1; 

  if (game.currentEra === 1) {
      countShort = 3; countLong = 2; 
  } else {
      countShort = 2; countLong = 1; 
  }

  const drawnShort = sample(availableShort, countShort);
  const drawnLong = sample(availableLong, countLong);
  const drawnRisk = sample(availableRisk, countRisk); 

  [...drawnShort, ...drawnLong, ...drawnRisk].forEach(p => {
      newProjects.push(toActive(p));
      game.drawnProjects.add(p.id);
      
      if (p.type === 'risk') {
          game.totalRiskEnergyAvailable += p.maxEnergy;
      }
  });

  game.activeProjects.push(...newProjects);
  
  if (newProjects.length > 0) {
    game.logs.push(`🎴 本轮发布(${newProjects.length}): ${newProjects.map(p => p.name).join("、")}`);
  } else {
    game.logs.push(`🎴 本轮无新项目发布`);
  }
}

function isProjectActiveOrDrawn(game: GameState, pid: number): boolean {
    const isActive = game.activeProjects.some(ap => ap.id === pid);
    const isDrawn = game.drawnProjects.has(pid);
    return isActive || isDrawn;
}

function sample(pool: ProjectCard[], count: number): ProjectCard[] {
  return shuffleArray(pool).slice(0, count);
}

function mapEraToColor(era?: string): string {
    switch(era) {
        case '气候': return 'green';
        case '科技': return 'blue';
        case '文化': return 'red';
        case '健康': return 'orange';
        case '心理': return 'yellow';
        default: return 'gray';
    }
}