import { Injectable } from '@angular/core';
import { HouseCard, NinjaCard } from '../models/types';

@Injectable({ providedIn: 'root' })
export class DeckService {

  buildHouseDeck(playerCount: number): HouseCard[] {
    let lotusRanks = 2, craneRanks = 2, includeRonin = false;
    if (playerCount === 5) includeRonin = true;
    else if (playerCount === 6) { lotusRanks = 3; craneRanks = 3; }
    else if (playerCount === 7) { lotusRanks = 3; craneRanks = 3; includeRonin = true; }
    else if (playerCount === 8) { lotusRanks = 4; craneRanks = 4; }
    else if (playerCount === 9) { lotusRanks = 4; craneRanks = 4; includeRonin = true; }
    else if (playerCount === 10) { lotusRanks = 5; craneRanks = 5; }
    else if (playerCount === 11) { lotusRanks = 5; craneRanks = 5; includeRonin = true; }

    const cards: HouseCard[] = [];
    for (let i = 1; i <= lotusRanks; i++) cards.push({ id: `lotus-${i}`, faction: 'lotus', rank: i });
    for (let i = 1; i <= craneRanks; i++) cards.push({ id: `crane-${i}`, faction: 'crane', rank: i });
    if (includeRonin) cards.push({ id: 'ronin-1', faction: 'ronin', rank: 1 });
    return this.shuffle(cards);
  }

  buildNinjaDeck(): NinjaCard[] {
    const cards: NinjaCard[] = [];
    let uid = 0;
    const add = (t: Omit<NinjaCard, 'id'>) => cards.push({ id: `nc-${uid++}`, ...t });

    for (let p = 1; p <= 6; p++) add({ name: 'Spy', phase: 'spy', phaseOrder: p, description: 'Bí mật xem bài House của 1 người.', requiresTarget: true, isReact: false, isReveal: false, emoji: '🔍' });
    for (let p = 1; p <= 6; p++) add({ name: 'Mystic', phase: 'mystic', phaseOrder: p, description: 'Xem bài House và 1 trong 2 lá Ninja của 1 người.', requiresTarget: true, isReact: false, isReveal: false, emoji: '🔮' });

    add({ name: 'Shapeshifter', phase: 'trickster', phaseOrder: 1, tricksterNumber: 1, description: 'Xem bài House 2 người, có thể hoán đổi chúng bí mật.', requiresTarget: false, isReact: false, isReveal: false, emoji: '🎭' });
    add({ name: 'Grave Digger', phase: 'trickster', phaseOrder: 2, tricksterNumber: 2, description: 'Chọn 2 lá Ninja từ xấp bỏ để xem, lấy 1 lá về tay.', requiresTarget: false, isReact: false, isReveal: false, emoji: '⚰️' });
    add({ name: 'Troublemaker', phase: 'trickster', phaseOrder: 3, tricksterNumber: 3, description: 'Xem bài House của 1 người, có thể công khai cho cả bàn.', requiresTarget: true, isReact: false, isReveal: false, emoji: '😈' });
    add({ name: 'Spirit Merchant', phase: 'trickster', phaseOrder: 4, tricksterNumber: 4, description: 'Xem Token hoặc House của 1 người, có thể tráo đổi Token với họ.', requiresTarget: true, isReact: false, isReveal: false, emoji: '⚖️' });
    add({ name: 'Thief', phase: 'trickster', phaseOrder: 5, tricksterNumber: 5, description: 'Lật bài House mình, chọn 1 người và cướp 1 Token ngẫu nhiên của họ.', requiresTarget: false, isReact: false, isReveal: false, emoji: '🗡️' });
    add({ name: 'Judge', phase: 'trickster', phaseOrder: 6, tricksterNumber: 6, description: 'Lật bài House mình, GIẾT 1 người (Không thể bị chặn).', requiresTarget: true, isReact: false, isReveal: false, emoji: '⚖️' });

    for (let p = 1; p <= 6; p++) add({ name: 'Blind Assassin', phase: 'blind-assassin', phaseOrder: p, description: 'Chọn 1 người và GIẾT ngay lập tức (không được xem bài).', requiresTarget: true, isReact: false, isReveal: false, emoji: '🏹' });
    for (let p = 1; p <= 6; p++) add({ name: 'Shinobi', phase: 'shinobi', phaseOrder: p, description: 'Xem bài House của 1 người trước khi quyết định có GIẾT hay không.', requiresTarget: true, isReact: false, isReveal: false, emoji: '🗡️' });

    add({ name: 'Mastermind', phase: 'reveal', phaseOrder: 99, description: 'REVEAL: Thắng vòng ngay nếu còn sống đến cuối (trừ khi là Ronin).', requiresTarget: false, isReact: false, isReveal: true, emoji: '🧠' });
    add({ name: 'Mirror Monk', phase: 'react', phaseOrder: 99, description: 'REACT: Phản đòn khi bị Assassin/Shinobi giết (Giết ngược lại kẻ đó).', requiresTarget: false, isReact: true, isReveal: false, emoji: '🪞' });
    add({ name: 'Martyr', phase: 'react', phaseOrder: 99, description: 'REACT: Nhận 1 Token ngẫu nhiên thay vì chết khi bị Assassin/Shinobi tấn công.', requiresTarget: false, isReact: true, isReveal: false, emoji: '💛' });

    return this.shuffle(cards);
  }

  shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}
