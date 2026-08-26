export type ProjectType = 'short' | 'long' | 'risk';

export interface ProjectCard {
  id: number;
  name: string;
  type: ProjectType;
  maxEnergy: number;
  era?: string;
  rankRewards?: number[];
  overInvestPenalty?: number[];
  eraBonusApplicable?: boolean;
  startRound?: number;
}

export interface EventOption {
  energyChange: number;
  wealthChange?: number;
  description: string;
}

export interface EventCard {
  id: number;
  name: string;
  description: string;
  optionA: {
    energyChange: number;
    wealthChange: number;
    description: string;
  };
  optionB: {
    energyChange: number;
    wealthChange: number;
    description: string;
  };
}

export interface EraCard {
  id: number;
  name: string;
  era: string;    
  description: string;
  themeColor: string;
}

export type BuffType = 'gain' | 'interfere' | 'special';

export interface BuffCard {
  id: string; 
  name: string;
  type: BuffType;
  description: string;
  auctionRound: number; 
}

// ====== Buff 卡池 ======
export const buffCards: BuffCard[] = [
  { id: 'buff_gold', name: '点石成金', type: 'gain', description: '本轮投资回报 x1.5', auctionRound: 1 },
  { id: 'buff_short', name: '项目做空', type: 'special', description: '猜测项目状态，赢取回报', auctionRound: 1 },
  { id: 'buff_slack', name: '摸鱼传染', type: 'interfere', description: '指定对手减少 5 精力', auctionRound: 2 },
  { id: 'buff_rebound', name: '反弹琵琶', type: 'special', description: '被干扰时获得 10 精力', auctionRound: 2 },
  { id: 'buff_insurance', name: '保险', type: 'special', description: '项目爆掉且投入>=5时获100财富', auctionRound: 2 },
  { id: 'buff_spirit', name: '精神老伙', type: 'gain', description: '本轮增加 5 精力', auctionRound: 3 },
  { id: 'buff_swap', name: '偷天换日', type: 'interfere', description: '选座时与对手互换排名', auctionRound: 3 },
  { id: 'buff_lottery', name: '彩票', type: 'special', description: '投20面骰子获财富', auctionRound: 3 },
];

// ====== 短期项目 (无变化) ======
export const shortTermProjects: ProjectCard[] = [
  {id: 1, name:'新能源汽车', type:'short', maxEnergy:23, era:'气候', rankRewards:[45,30,20,15,10,5], overInvestPenalty:[-35,-20,-15,-10,-5,-5], eraBonusApplicable:true},
  {id: 2, name:'兴建巨型水坝', type:'short', maxEnergy:30, era:'气候', rankRewards:[55,35,25,20,15,5], overInvestPenalty:[-40,-25,-20,-15,-5,-5], eraBonusApplicable:true},
  {id: 3, name:'视频会议', type:'short', maxEnergy:23, era:'科技', rankRewards:[45,30,20,15,10,5], overInvestPenalty:[-35,-20,-15,-10,-5,-5], eraBonusApplicable:true},
  {id: 4, name:'数字地图', type:'short', maxEnergy:18, era:'科技', rankRewards:[30,20,15,10,5,5], overInvestPenalty:[-25,-15,-10,-10,-5,-5], eraBonusApplicable:true},
  {id: 5, name:'国际文化艺术节', type:'short', maxEnergy:18, era:'文化', rankRewards:[30,20,15,10,5,5], overInvestPenalty:[-25,-15,-10,-10,-5,-5], eraBonusApplicable:true},
  {id: 6, name:'民俗主题公园', type:'short', maxEnergy:30, era:'文化', rankRewards:[55,35,25,20,15,5], overInvestPenalty:[-40,-25,-20,-15,-5,-5], eraBonusApplicable:true},
  {id: 7, name:'公共体育设施免费开放', type:'short', maxEnergy:23, era:'健康', rankRewards:[45,30,20,15,10,5], overInvestPenalty:[-35,-20,-15,-10,-5,-5], eraBonusApplicable:true},
  {id: 8, name:'“全民健身日”嘉年华', type:'short', maxEnergy:18, era:'健康', rankRewards:[30,20,15,10,5,5], overInvestPenalty:[-25,-15,-10,-10,-5,-5], eraBonusApplicable:true},
  {id: 9, name:'数字排毒', type:'short', maxEnergy:23, era:'心理', rankRewards:[45,30,20,15,10,5], overInvestPenalty:[-35,-20,-15,-10,-5,-5], eraBonusApplicable:true},
  {id: 10, name:'EAP全面推行', type:'short', maxEnergy:30, era:'心理', rankRewards:[55,35,25,20,15,5], overInvestPenalty:[-40,-25,-20,-15,-5,-5], eraBonusApplicable:true}
];

// ====== 长期项目 (移除 requiredWisdom) ======
export const longTermProjects: ProjectCard[] = [
  {id:101, name:'植树造林', type:'long', maxEnergy:70, era:'气候', rankRewards:[65,45,35,25,20,10]},
  {id:102, name:'城市海绵体改造', type:'long', maxEnergy:80, era:'气候', rankRewards:[70,50,40,30,23,13]},
  {id:103, name:'数字图书馆', type:'long', maxEnergy:70, era:'科技', rankRewards:[65,45,35,25,20,10]},
  {id:104, name:'遗产保护基金', type:'long', maxEnergy:70, era:'文化', rankRewards:[65,45,35,25,20,10]},
  {id:105, name:'文化桥梁使者', type:'long', maxEnergy:80, era:'文化', rankRewards:[70,50,40,30,23,13]},
  {id:106, name:'建立体育俱乐部', type:'long', maxEnergy:70, era:'健康', rankRewards:[65,45,35,25,20,10]},
  {id:107, name:'心理学教育普及', type:'long', maxEnergy:90, era:'心理', rankRewards:[75,55,45,35,25,15]}
];

// ====== 风险项目 (保持不变) ======
export const riskProjects: ProjectCard[] = [
  {id:201, name:'开采化石能源', type:'risk', maxEnergy:12, era:'气候'},
  {id:202, name:'成瘾算法', type:'risk', maxEnergy:8, era:'科技'},
  {id:203, name:'数据监控', type:'risk', maxEnergy:12, era:'科技'},
  {id:204, name:'文化商品化', type:'risk', maxEnergy:12, era:'文化'},
  {id:205, name:'营养代餐', type:'risk', maxEnergy:12, era:'健康'},
  {id:206, name:'完美身材', type:'risk', maxEnergy:8, era:'健康'},
  {id:207, name:'幸福药丸', type:'risk', maxEnergy:8, era:'心理'},
  {id:208, name:'大师速成班', type:'risk', maxEnergy:12, era:'心理'}
];

// ====== 时代卡 ======
export const eraCards: EraCard[] = [
  { id: 1, name: "蔚蓝星球计划", era: "气候", description: "全球聚焦气候行动", themeColor: "green" },
  { id: 2, name: "数字星河时代", era: "科技", description: "信息技术爆发", themeColor: "blue" },
  { id: 3, name: "多元文明交响", era: "文化", description: "文化交流与认同", themeColor: "red" },
  { id: 4, name: "生命活力运动", era: "健康", description: "全民健康意识提升", themeColor: "orange" },
  { id: 5, name: "心灵觉醒浪潮", era: "心理", description: "心理健康成为核心议题", themeColor: "yellow" }
];

export const eventCards: EventCard[] = [];