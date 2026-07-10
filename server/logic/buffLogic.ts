import { GameState, ActiveBuff } from "../state/gameState.js";
import { buffCards } from "../data/game_data.js";

/**
 * 玩家使用道具卡的主逻辑
 */
export function useBuffCard(
    game: GameState, 
    playerId: string, 
    cardId: string, 
    params: { targetPlayerId?: string, targetProjectId?: number, extraData?: any }
): { success: boolean, msg: string } {

    const player = game.players.find(p => p.id === playerId);
    if (!player) return { success: false, msg: "玩家不存在" };

    // 1. 检查库存
    const cardIndex = player.inventory.indexOf(cardId);
    if (cardIndex === -1) return { success: false, msg: "你没有这张卡" };

    const cardDef = buffCards.find(c => c.id === cardId);
    if (!cardDef) return { success: false, msg: "未知卡牌数据" };

    const buff: ActiveBuff = {
        cardId,
        targetPlayerId: params.targetPlayerId,
        targetProjectId: params.targetProjectId,
        extraData: params.extraData
    };

    // --- 精神老伙 (+5精力) ---
    if (cardId === 'buff_spirit') {
        player.energy += 5;
        game.logs.push(`💪 ${player.name} 使用了【精神老伙】，精力 +5 (当前: ${player.energy})`);
    }
    
    // --- 摸鱼传染 (主动攻击) ---
    else if (cardId === 'buff_slack') {
        const target = game.players.find(p => p.id === params.targetPlayerId);
        if (!target) return { success: false, msg: "未指定目标" };
        
        // 检查目标是否已经开启了反弹琵琶
        const hasRebound = target.activeBuffs.some(b => b.cardId === 'buff_rebound');
        
        if (hasRebound) {
            // ✅ 反弹琵琶已开启：攻击无效，受害者回血
            // 逻辑：原 -5，现 +5。差额 +10。
            // 为了让数值准确，我们执行：
            // target.energy = (original - 5) + 10 = original + 5
            
            // 先扣 5 (模拟攻击命中)
            target.energy = Math.max(0, target.energy - 5);
            // 再加 10 (反弹回血)
            target.energy += 10;
            
            game.logs.push(`🛡️ ${player.name} 对 ${target.name} 使用【摸鱼传染】，但撞上【反弹琵琶】！${target.name} 精力 -5+10=+5`);
        } else {
            // ✅ 反弹未开启：正常扣血，并记录仇恨
            target.energy = Math.max(0, target.energy - 5);
            
            // 记录 "我被谁摸了"，以便后续如果我开反弹可以回溯
            if (!target.slackedBy) target.slackedBy = [];
            target.slackedBy.push(player.id);
            
            game.logs.push(`💤 ${player.name} 对 ${target.name} 使用【摸鱼传染】，${target.name} 精力 -5`);
        }
    }
    
    // --- 反弹琵琶 (主动开启护盾) ---
    else if (cardId === 'buff_rebound') {
        // 1. 开启护盾 (挂状态)
        // 状态已在函数末尾统一 push
        
        // 2. 回溯检查：本轮是否已经被摸过？
        if (player.slackedBy && player.slackedBy.length > 0) {
            // 有仇恨记录，触发回血
            // 每一次摸鱼记录对应 +10 精力 (把之前的 -5 变成 +5)
            const count = player.slackedBy.length;
            const recovery = count * 10;
            player.energy += recovery;
            
            game.logs.push(`🎵 ${player.name} 开启【反弹琵琶】，回溯反击了 ${count} 次摸鱼，精力恢复 ${recovery} (之前-5x${count}，现在+5x${count})`);
            
            // 清空记录
            player.slackedBy = [];
        } else {
            game.logs.push(`🛡️ ${player.name} 开启了【反弹琵琶】护盾，准备反击`);
        }
    }

    // --- 彩票 (等待上帝开奖) ---
    else if (cardId === 'buff_lottery') {
        game.logs.push(`🎲 ${player.name} 购买了【彩票】，请主持人开奖...`);
        // 不加钱，只挂状态
    }
    
    // --- 偷天换日 (交换顺位) ---
    else if (cardId === 'buff_swap') {
        const target = game.players.find(p => p.id === params.targetPlayerId);
        if (target) {
            const myOrder = player.draftOrder;
            const targetOrder = target.draftOrder;
            
            // ✅ 修复：直接交换 draftOrder
            player.draftOrder = targetOrder;
            target.draftOrder = myOrder;

            game.logs.push(`🔀 ${player.name} 使用【偷天换日】，与 ${target.name} 互换了结算顺位 (#${myOrder} <-> #${targetOrder})`);
        }
    }

    // --- 延迟生效类 ---
    else {
        game.logs.push(`🃏 ${player.name} 使用了卡牌【${cardDef.name}】，将在结算时生效`);
    }

    // 4. 消耗卡牌
    player.inventory.splice(cardIndex, 1);
    
    // 5. 加入已激活列表
    player.activeBuffs.push(buff);

    return { success: true, msg: "使用成功" };
}