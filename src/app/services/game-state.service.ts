import { inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { GameState, Player, NinjaCard, HouseCard, Faction, NightQueueItem } from '../models/types';
import { DeckService } from './deck.service';
import { Database, ref, set, get, onValue, update } from '@angular/fire/database';

const INITIAL_STATE: GameState = {
  phase: 'lobby', round: 0, players: [], currentPlayerIndex: 0,
  ninjaDiscardPile: [], tokenPool: 35, actionLog: [],
  nightQueue: [], currentNightActionIndex: 0,
  pendingModal: null, roundWinnerFaction: null, roundWinnerName: null,
  gameWinnerId: null, showCover: false, coverMessage: '',
  shinobiPeekedCard: null, shinobiTargetId: null, mastermindActive: false,
  houseViewedIds: [], draftPickedIds: [], publicAnnouncement: null,
};


@Injectable({ providedIn: 'root' })
export class GameStateService {
  private _state = signal<GameState>({ ...INITIAL_STATE });
  readonly state = this._state.asReadonly();
  
  private db = inject(Database);
  roomId = signal<string | null>(null);
  localPlayerId = signal<string | null>(null);

  constructor(private deck: DeckService, private router: Router) {}

  get s() { return this._state(); }
  
  joinRoom(roomId: string, playerId: string) {
    this.roomId.set(roomId);
    this.localPlayerId.set(playerId);

    onValue(ref(this.db, `rooms/${roomId}/gameState`), snap => {
      const val = snap.val();
      if (val) {
        // Firebase strips empty arrays → restore defaults
        const sanitized: GameState = {
          ...val,
          houseViewedIds: val.houseViewedIds ?? [],
          draftPickedIds: val.draftPickedIds ?? [],
          nightQueue: val.nightQueue ?? [],
          ninjaDiscardPile: val.ninjaDiscardPile ?? [],
          actionLog: val.actionLog ?? [],
          publicAnnouncement: val.publicAnnouncement ?? null,
          players: (val.players ?? []).map((p: Player) => ({
            ...p,
            tokens: p.tokens ?? [],
            ninjaCards: p.ninjaCards ?? [],
            draftHand: p.draftHand ?? [],
            draftPassCards: p.draftPassCards ?? [],
          })),
        };
        this._state.update(s => ({
          ...sanitized,
          pendingModal: s.pendingModal,
          shinobiPeekedCard: s.shinobiPeekedCard,
          shinobiTargetId: s.shinobiTargetId,
        }));
      }
    });

    onValue(ref(this.db, `rooms/${roomId}/private/${playerId}`), snap => {
      const priv = snap.val();
      if (priv) {
        this._state.update(s => ({
          ...s,
          pendingModal: priv.pendingModal !== undefined ? priv.pendingModal : s.pendingModal,
          shinobiPeekedCard: priv.shinobiPeekedCard !== undefined ? priv.shinobiPeekedCard : s.shinobiPeekedCard,
          shinobiTargetId: priv.shinobiTargetId !== undefined ? priv.shinobiTargetId : s.shinobiTargetId
        }));
      }
    });
  }

  private pushPrivate(playerId: string, data: any) {
    const rId = this.roomId();
    if (!rId) return;
    update(ref(this.db, `rooms/${rId}/private/${playerId}`), data);
  }

  private setState(updater: (state: GameState) => GameState) {
    const newState = updater(this.s);
    // Always update local state immediately
    this._state.set(newState);

    const rId = this.roomId();
    if (!rId) return;

    const publicState = { ...newState };

    if (newState.pendingModal !== undefined) {
      if (newState.pendingModal) {
        const recipientId = newState.pendingModal.type === 'react-choice'
          ? newState.pendingModal.targetId!
          : newState.pendingModal.actorId;
        this.pushPrivate(recipientId, { pendingModal: newState.pendingModal });
      } else {
        this.s.players.forEach(p => {
          this.pushPrivate(p.id, { pendingModal: null });
        });
      }
    }
    delete (publicState as any).pendingModal;

    if (newState.shinobiPeekedCard) {
      this.pushPrivate(this.localPlayerId()!, {
        shinobiPeekedCard: newState.shinobiPeekedCard,
        shinobiTargetId: newState.shinobiTargetId
      });
    }
    delete (publicState as any).shinobiPeekedCard;
    delete (publicState as any).shinobiTargetId;

    // Sanitize for Firebase: replace empty arrays with [] (Firebase may strip, but we handle on read)
    // Ensure players sub-arrays are never undefined before push
    (publicState as any).players = (publicState.players ?? []).map((p: Player) => ({
      ...p,
      tokens: p.tokens ?? [],
      ninjaCards: p.ninjaCards ?? [],
      draftHand: p.draftHand ?? [],
      draftPassCards: p.draftPassCards ?? [],
    }));

    set(ref(this.db, `rooms/${rId}/gameState`), publicState);
  }

  private update(patch: Partial<GameState>) {
    this.setState(s => ({ ...s, ...patch }));
  }

  private log(message: string, isPublic = true) {
    this.update({ actionLog: [...this.s.actionLog, { message, isPublic }] });
  }

  private announce(emoji: string, title: string, message: string) {
    this.update({ publicAnnouncement: { emoji, title, message } });
  }

  dismissAnnouncement() {
    this.update({ publicAnnouncement: null });
  }

  private getRandomTokenValue(): number {
    return [2, 3, 4][Math.floor(Math.random() * 3)];
  }

  private addRandomTokenToPlayer(playerId: string, round: number, reason?: string): number {
    const val = this.getRandomTokenValue();
    this.setState(s => ({
      ...s,
      players: s.players.map(p => p.id === playerId ? { 
        ...p, 
        tokens: [...p.tokens, val],
        tokenHistory: [...(p.tokenHistory || []), { round, amount: val, reason }] 
      } : p)
    }));
    return val;
  }

  getPlayerTotalScore(p: Player): number {
    return p.tokens.reduce((a, b) => a + b, 0);
  }

  // ─── LOBBY ───────────────────────────────────────────────────────
  async createRoom(playerName: string) {
    const rId = Math.random().toString(36).substring(2, 6).toUpperCase();
    const pId = Math.random().toString(36).substring(2, 9);
    
    const hostPlayer: Player = {
        id: pId, name: playerName, houseCard: null, ninjaCards: [],
        draftHand: [], draftPassCards: [], tokens: [], tokenHistory: [], isAlive: true, isHouseRevealed: false
    };

    const initState = { ...INITIAL_STATE, players: [hostPlayer] };
    await set(ref(this.db, `rooms/${rId}/gameState`), initState);
    
    this.joinRoom(rId, pId);
    return rId;
  }

  async joinExistingRoom(rId: string, playerName: string) {
    const pId = Math.random().toString(36).substring(2, 9);
    
    const snap = await get(ref(this.db, `rooms/${rId.toUpperCase()}/gameState`));
    if (!snap.exists()) throw new Error('Room không tồn tại');
    
    const s = snap.val() as GameState;
    if (s.phase !== 'lobby') throw new Error('Trận đấu đã bắt đầu');
    if (s.players.length >= 11) throw new Error('Phòng đã đầy');
    
    const newPlayer: Player = {
        id: pId, name: playerName, houseCard: null, ninjaCards: [],
        draftHand: [], draftPassCards: [], tokens: [], tokenHistory: [], isAlive: true, isHouseRevealed: false
    };

    s.players.push(newPlayer);
    await set(ref(this.db, `rooms/${rId.toUpperCase()}/gameState`), s);
    
    this.joinRoom(rId.toUpperCase(), pId);
    return true;
  }

  startGameHost() {
    const players = this.s.players;
    if (players.length < 4) return;
    const houseDeck = this.deck.buildHouseDeck(players.length);
    const initedPlayers = players.map((p, i) => ({ ...p, houseCard: houseDeck[i] }));
    this.setState(() => ({
      ...INITIAL_STATE, phase: 'house-viewing', round: 1, players: initedPlayers,
      houseViewedIds: [], draftPickedIds: [],
    }));
    // Navigation handled by effect in LobbyComponent for all clients
  }

  dismissCover() { this.update({ showCover: false, coverMessage: '' }); }

  playerViewedHouse() {
    const localId = this.localPlayerId();
    if (!localId) return;
    const viewed = [...new Set([...this.s.houseViewedIds, localId])];
    const allViewed = this.s.players.every(p => viewed.includes(p.id));
    if (allViewed) {
      this.setState(s => ({ ...s, houseViewedIds: viewed }));
      this.startDraft();
    } else {
      this.update({ houseViewedIds: viewed });
    }
  }

  private startDraft() {
    const ninja = this.deck.buildNinjaDeck();
    // Distribute draft hands per player simultaneously
    const players = this.s.players.map((p, i) => ({
      ...p, draftHand: ninja.slice(i * 3, i * 3 + 3), draftPassCards: [], ninjaCards: [],
    }));
    this.update({ phase: 'draft-pick1', players, currentPlayerIndex: 0, draftPickedIds: [] });
  }

  private get isHost(): boolean {
    return this.s.players[0]?.id === this.localPlayerId();
  }

  // Simultaneous draft: each player picks from their own hand independently
  draftPick1(playerId: string, cardIndex: number) {
    const player = this.s.players.find(p => p.id === playerId)!;
    const kept = player.draftHand[cardIndex];
    const pass = player.draftHand.filter((_, i) => i !== cardIndex);
    const pickedIds = [...new Set([...this.s.draftPickedIds, playerId])];
    this.setState(s => ({
      ...s,
      draftPickedIds: pickedIds,
      players: s.players.map(p => p.id === playerId
        ? { ...p, ninjaCards: [kept], draftPassCards: pass, draftHand: [] }
        : p)
    }));
    // Once all picked, rotate hands (host triggers, but state is already synced)
    if (pickedIds.length >= this.s.players.length) {
      setTimeout(() => this.rotateDraftHands(), 300);
    }
  }

  private rotateDraftHands() {
    const players = this.s.players;
    const rotated = players.map((p, i) => ({
      ...p, draftHand: players[(i + 1) % players.length].draftPassCards, draftPassCards: []
    }));
    this.update({ players: rotated, phase: 'draft-pick2', draftPickedIds: [] });
  }

  draftPick2(playerId: string, cardIndex: number) {
    const player = this.s.players.find(p => p.id === playerId)!;
    const kept = player.draftHand[cardIndex];
    const discarded = player.draftHand.find((_, i) => i !== cardIndex) ?? null;
    const discard = discarded ? [...this.s.ninjaDiscardPile, discarded] : this.s.ninjaDiscardPile;
    const pickedIds = [...new Set([...this.s.draftPickedIds, playerId])];
    this.setState(s => ({
      ...s,
      draftPickedIds: pickedIds,
      ninjaDiscardPile: discard,
      players: s.players.map(p => p.id === playerId
        ? { ...p, ninjaCards: [...p.ninjaCards, kept], draftHand: [] }
        : p)
    }));
    if (pickedIds.length >= this.s.players.length) {
      setTimeout(() => this.startNightPhase(), 300);
    }
  }

  private startNightPhase() {
    const queue: NightQueueItem[] = [];
    this.s.players.forEach(p => { if (!p.isAlive) return; p.ninjaCards.forEach(card => { if (!card.isReact && !card.isReveal) queue.push({ playerId: p.id, card, resolved: false }); }); });
    const phaseOrder = ['spy', 'mystic', 'trickster', 'blind-assassin', 'shinobi'];
    queue.sort((a, b) => { const pa = phaseOrder.indexOf(a.card.phase); const pb = phaseOrder.indexOf(b.card.phase); return pa !== pb ? pa - pb : a.card.phaseOrder - b.card.phaseOrder; });
    this.update({ nightQueue: queue, currentNightActionIndex: 0 });
    this.advanceNight();
  }

  private advanceNight() {
    const { nightQueue, currentNightActionIndex } = this.s;
    const prevActorId = this.s.players[this.s.currentPlayerIndex]?.id;
    let idx = currentNightActionIndex;
    while (idx < nightQueue.length && (nightQueue[idx].resolved || !this.isPlayerAlive(nightQueue[idx].playerId))) idx++;
    if (idx >= nightQueue.length) { this.endRound(); return; }
    const item = nightQueue[idx];
    const phaseMap: Record<string, string> = { 'spy': 'night-spy', 'mystic': 'night-mystic', 'trickster': 'night-trickster', 'blind-assassin': 'night-blind-assassin', 'shinobi': 'night-shinobi' };
    const nextActor = this.s.players.find(p => p.id === item.playerId);
    const actorChanged = nextActor?.id !== prevActorId;
    this.update({ phase: phaseMap[item.card.phase] as GameState['phase'], currentNightActionIndex: idx, currentPlayerIndex: this.s.players.findIndex(p => p.id === item.playerId) });
  }

  private isPlayerAlive(id: string): boolean { return this.s.players.find(p => p.id === id)?.isAlive ?? false; }

  actionViewHouseCard(actorId: string, targetId: string) {
    const actor = this.s.players.find(p => p.id === actorId)!;
    const target = this.s.players.find(p => p.id === targetId)!;
    this.log(`${actor.name} dùng Spy (1) lên ${target.name} | Xem bài Gia Tộc của mục tiêu`);
    this.update({ pendingModal: { type: 'spy-result', actorId, targetId, data: target.houseCard } });
  }

  actionViewMystic(actorId: string, targetId: string) {
    const actor = this.s.players.find(p => p.id === actorId)!;
    const target = this.s.players.find(p => p.id === targetId)!;
    this.log(`${actor.name} dùng Mystic (2) lên ${target.name} | Xem bài Gia Tộc và 1 lá Ninja của mục tiêu`);
    
    // A card is "hidden" if it's a passive card, or an active card whose phase hasn't started yet.
    // If an active card's phase is the current phase or a past phase, it's already public/used.
    const currentPhaseOrder = ['spy', 'mystic', 'trickster', 'blind-assassin', 'shinobi'];
    const currentQueueItem = this.s.nightQueue[this.s.currentNightActionIndex];
    const currentPhaseIdx = currentPhaseOrder.indexOf(currentQueueItem?.card.phase ?? '');

    const remainingNinjas = target.ninjaCards.filter(card => {
      if (card.isReact || card.isReveal) return true;
      const cardPhaseIdx = currentPhaseOrder.indexOf(card.phase);
      // Keep only if its phase is strictly AFTER the current phase
      return cardPhaseIdx > currentPhaseIdx;
    });

    const shuffledNinjas = this.shuffleArray(remainingNinjas);
    // Auto-reveal if only 1 card is eligible
    const autoRevealIndex = shuffledNinjas.length === 1 ? 0 : null;
    this.update({ pendingModal: { type: 'mystic-peek', actorId, targetId, data: { house: target.houseCard, ninjas: shuffledNinjas, revealedIndex: autoRevealIndex } } });
  }

  revealMysticNinja(index: number) {
    if (this.s.pendingModal?.type !== 'mystic-peek') return;
    this.update({ pendingModal: { ...this.s.pendingModal, data: { ...this.s.pendingModal.data, revealedIndex: index } } });
  }

  getParticipantsForPhase(phase: string): Player[] {
    const prefix = phase.replace('night-', '');
    const participants = this.s.players.filter(p => p.isAlive && p.ninjaCards.some(c => c.phase === prefix));
    
    return participants.sort((a, b) => {
      const orderA = a.ninjaCards.find(c => c.phase === prefix)?.phaseOrder ?? 99;
      const orderB = b.ninjaCards.find(c => c.phase === prefix)?.phaseOrder ?? 99;
      return orderA - orderB;
    });
  }

  closePeekModal() { this.markCurrentResolved(); this.update({ pendingModal: null }); this.advanceNight(); }

  actionShapeshifter(actorId: string, target1Id: string, target2Id: string) {
    const actor = this.s.players.find(p => p.id === actorId)!;
    const t1 = this.s.players.find(p => p.id === target1Id)!;
    const t2 = this.s.players.find(p => p.id === target2Id)!;
    this.log(`${actor.name} dùng Shapeshifter (Trickster 1) lên ${t1.name} và ${t2.name} | Có thể hoán đổi bí mật 2 thẻ Gia Tộc`);
    this.update({ pendingModal: { type: 'shapeshifter', actorId, data: { t1, t2 } } });
  }

  resolveShapeshifter(swap: boolean, t1Id: string, t2Id: string) {
    this.setState(s => ({
      ...s,
      players: s.players.map(p => {
        if (p.id === t1Id || p.id === t2Id) {
          const newHouseCard = swap ? s.players.find(x => x.id === (p.id === t1Id ? t2Id : t1Id))!.houseCard : p.houseCard;
          return { ...p, houseCard: newHouseCard, needsHouseReview: true };
        }
        return p;
      })
    }));
    this.log('Shapeshifter đã hành động lên 2 mục tiêu. (Có thể đã hoán đổi hoặc không!).');
    this.markCurrentResolved(); this.update({ pendingModal: null }); this.advanceNight();
  }

  actionGraveDigger(actorId: string) {
    const actor = this.s.players.find(p => p.id === actorId)!;
    this.log(`${actor.name} dùng Grave Digger (Trickster 2) | Bốc ngẫu nhiên 2 lá từ bài đã bỏ, chọn 1 lá để dùng lại`);
    const pile = this.s.ninjaDiscardPile;
    if (pile.length === 0) { this.markCurrentResolved(); this.advanceNight(); return; }
    // Show all n cards face-down, track which 2 the player has flipped
    const shuffledPile = this.shuffleArray(pile);
    this.update({ pendingModal: { type: 'grave-digger-inspect', actorId, data: { pile: shuffledPile, revealedIds: [] } } });
  }

  graveDiggerReveal(cardId: string) {
    if (this.s.pendingModal?.type !== 'grave-digger-inspect') return;
    const revealed: string[] = this.s.pendingModal.data.revealedIds ?? [];
    if (revealed.includes(cardId) || revealed.length >= 2) return;
    const newRevealed = [...revealed, cardId];
    if (newRevealed.length === 2) {
      // Both selected — move to pick phase
      const picks = (this.s.pendingModal.data.pile as NinjaCard[]).filter(c => newRevealed.includes(c.id));
      this.update({ pendingModal: { type: 'grave-digger-retrieve', actorId: this.s.pendingModal.actorId, data: { picks } } });
    } else {
      this.update({ pendingModal: { ...this.s.pendingModal, data: { ...this.s.pendingModal.data, revealedIds: newRevealed } } });
    }
  }

  resolveGraveDigger(actorId: string, chosenCard: NinjaCard | null) {
    if (chosenCard) {
      // Add card to player's hand
      this.setState(s => ({
        ...s,
        players: s.players.map(p => p.id === actorId ? { ...p, ninjaCards: [...p.ninjaCards, chosenCard] } : p),
        ninjaDiscardPile: s.ninjaDiscardPile.filter(c => c.id !== chosenCard.id)
      }));

      // Inject card into remaining night queue if its phase hasn't ended yet
      const currentPhaseOrder = ['spy', 'mystic', 'trickster', 'blind-assassin', 'shinobi'];
      const currentQueueItem = this.s.nightQueue[this.s.currentNightActionIndex];
      const currentPhaseIdx = currentPhaseOrder.indexOf(currentQueueItem?.card.phase ?? '');
      const cardPhaseIdx = currentPhaseOrder.indexOf(chosenCard.phase);

      if (!chosenCard.isReact && !chosenCard.isReveal) {
        // Insert into queue after current position in correct order
        const newItem: NightQueueItem = { playerId: actorId, card: chosenCard, resolved: false };
        const remaining = this.s.nightQueue.slice(this.s.currentNightActionIndex + 1);
        const insertIdx = remaining.findIndex(qi => {
          const qi_phase = currentPhaseOrder.indexOf(qi.card.phase);
          if (qi_phase !== cardPhaseIdx) return qi_phase > cardPhaseIdx;
          return qi.card.phaseOrder > chosenCard.phaseOrder;
        });
        const insertAt = insertIdx === -1 ? remaining.length : insertIdx;
        const newRemaining = [...remaining.slice(0, insertAt), newItem, ...remaining.slice(insertAt)];
        const newQueue = [...this.s.nightQueue.slice(0, this.s.currentNightActionIndex + 1), ...newRemaining];
        this.update({ nightQueue: newQueue });
        
        if (insertAt === 0) {
          this.log(`Grave Digger đã nhận 1 lá bí mật và dùng ngay lập tức!`);
        } else {
          this.log(`Grave Digger đã nhận 1 lá bí mật — chờ tới đúng lượt pha để dùng.`);
        }
      }
    }
    this.markCurrentResolved(); this.update({ pendingModal: null }); this.advanceNight();
  }

  actionTroublemaker(actorId: string, targetId: string) {
    const actor = this.s.players.find(p => p.id === actorId)!;
    const target = this.s.players.find(p => p.id === targetId)!;
    this.log(`${actor.name} dùng Troublemaker (Trickster 3) lên ${target.name} | Xem bài Gia Tộc và có thể tiết lộ cho cả bàn`);
    this.update({ pendingModal: { type: 'troublemaker', actorId, targetId, data: target.houseCard } });
  }

  resolveTroublemaker(reveal: boolean, targetId: string) {
    if (reveal) {
      this.setState(s => ({
        ...s,
        players: s.players.map(p => p.id === targetId ? { ...p, isHouseRevealed: true } : p)
      }));
      this.log('Troublemaker tiết lộ bài House!');
    }
    this.markCurrentResolved(); this.update({ pendingModal: null }); this.advanceNight();
  }

  private shuffleArray<T>(array: T[]): T[] {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /**
   * Spirit Merchant: Chose to peek House OR 1 face-down Token.
   * mode: 'house' | 'token'
   */
  actionSpiritMerchant(actorId: string, targetId: string, mode: 'house' | 'token') {
    const target = this.s.players.find(p => p.id === targetId)!;
    const actor = this.s.players.find(p => p.id === actorId)!;
    this.log(`${actor.name} dùng Spirit Merchant (Trickster 4) lên ${target.name} | Xem Gia Tộc hoặc đếm Token của mục tiêu, có thể hoán đổi 1 Token`);
    if (mode === 'house') {
      // Show house card. Offer to swap a token if both have tokens.
      const shuffledTargetTokens = this.shuffleArray(target.tokens);
      const shuffledActorTokens = this.shuffleArray(actor.tokens);
      const targetForModal = { ...target, tokens: shuffledTargetTokens };
      const actorForModal = { ...actor, tokens: shuffledActorTokens };
      this.setState(s => ({
        ...s,
        players: s.players.map(p =>
          p.id === targetId ? { ...p, tokens: shuffledTargetTokens } :
          p.id === actorId  ? { ...p, tokens: shuffledActorTokens  } : p
        ),
        pendingModal: { type: 'spirit-merchant', actorId, targetId, data: { peekMode: 'house', actor: actorForModal, target: targetForModal } }
      }));
    } else {
      // Show how many tokens target has (face-down), allow swap
      const shuffledTargetTokens = this.shuffleArray(target.tokens);
      const shuffledActorTokens = this.shuffleArray(actor.tokens);
      this.setState(s => ({
        ...s,
        players: s.players.map(p =>
          p.id === targetId ? { ...p, tokens: shuffledTargetTokens } :
          p.id === actorId  ? { ...p, tokens: shuffledActorTokens  } : p
        ),
        pendingModal: { type: 'spirit-merchant', actorId, targetId,
          data: { peekMode: 'token', targetTokenCount: target.tokens.length, actor: { ...actor, tokens: shuffledActorTokens }, target: { ...target, tokens: shuffledTargetTokens } } }
      }));
    }
  }

  /**
   * actorTokenIdx / targetTokenIdx: index of token to swap (-1 = skip swap).
   */
  resolveSpiritMerchant(actorId: string, targetId: string, actorTokenIdx: number, targetTokenIdx: number) {
    if (actorTokenIdx >= 0 && targetTokenIdx >= 0) {
      this.setState(s => ({
        ...s,
        players: s.players.map(p => {
          if (p.id === actorId) {
            const victim = s.players.find(v => v.id === targetId)!;
            const myToken = p.tokens[actorTokenIdx];
            const theirToken = victim.tokens[targetTokenIdx];
            const newTokens = [...p.tokens];
            newTokens[actorTokenIdx] = theirToken;
            return { 
              ...p, 
              tokens: newTokens, 
              tokenHistory: [...(p.tokenHistory || []), { round: s.round, amount: -myToken, reason: 'Hoán đổi' }, { round: s.round, amount: theirToken, reason: 'Hoán đổi' }] 
            };
          }
          if (p.id === targetId) {
            const me = s.players.find(v => v.id === actorId)!;
            const myToken = me.tokens[actorTokenIdx];
            const theirToken = p.tokens[targetTokenIdx];
            const newTokens = [...p.tokens];
            newTokens[targetTokenIdx] = myToken;
            return { 
              ...p, 
              tokens: newTokens, 
              tokenHistory: [...(p.tokenHistory || []), { round: s.round, amount: -theirToken, reason: 'Hoán đổi' }, { round: s.round, amount: myToken, reason: 'Hoán đổi' }] 
            };
          }
          return p;
        })
      }));
      this.log('Spirit Merchant đã bí mật hoán đổi 1 Token!');
    }
    this.markCurrentResolved(); this.update({ pendingModal: null }); this.advanceNight();
  }

  actionThief(actorId: string) {
    const actorName = this.s.players.find(p => p.id === actorId)!.name;
    this.log(`${actorName} dùng Thief (Trickster 5) | Lật bài Gia Tộc và cướp 1 Token bí mật từ người có nhiều Token hơn`);
    this.setState(s => {
      const otherAlivePlayers = s.players.filter(p => p.id !== actorId && p.isAlive);
      
      // Anyone who has at least 1 token is a valid victim
      const victims = otherAlivePlayers.filter(p => p.tokens.length > 0)
                                       .map(v => ({ ...v, tokens: this.shuffleArray(v.tokens) }));
        
      const newPlayers = s.players.map(p => {
        if (p.id === actorId) return { ...p, isHouseRevealed: true };
        const v = victims.find(vx => vx.id === p.id);
        if (v) return v;
        return p;
      });

      return {
        ...s,
        players: newPlayers,
        pendingModal: { type: 'thief', actorId, data: { victims } }
      };
    });
  }

  resolveThief(actorId: string, targetId: string | null, tokenIndex: number = -1) {
    if (targetId && tokenIndex >= 0) {
      this.setState(s => {
        const victim = s.players.find(p => p.id === targetId)!;
        const stolenToken = victim.tokens[tokenIndex];
        return {
          ...s,
          players: s.players.map(p => {
            if (p.id === actorId) return { 
              ...p, 
              tokens: [...p.tokens, stolenToken], 
              tokenHistory: [...(p.tokenHistory || []), { round: s.round, amount: stolenToken, reason: 'Trộm' }] 
            };
            if (p.id === targetId) return { 
              ...p, 
              tokens: p.tokens.filter((_, i) => i !== tokenIndex), 
              tokenHistory: [...(p.tokenHistory || []), { round: s.round, amount: -stolenToken, reason: 'Bị trộm' }] 
            };
            return p;
          })
        };
      });
      this.log('Thief đã cướp bí mật 1 Token!');
    }
    this.markCurrentResolved(); this.update({ pendingModal: null }); this.advanceNight();
  }

  actionJudge(actorId: string, targetId: string) {
    const actor = this.s.players.find(p => p.id === actorId)!;
    const target = this.s.players.find(p => p.id === targetId)!;
    this.log(`${actor.name} dùng Judge (Trickster 6) lên ${target.name} | Lật bài Gia Tộc và giết mục tiêu, không ai có thể phản đòn`);
    this.setState(s => ({
      ...s,
      players: s.players.map(p => {
        if (p.id === actorId) return { ...p, isHouseRevealed: true };
        if (p.id === targetId) return { ...p, isAlive: false };
        return p;
      })
    }));
    this.announce('⚖️', 'Judge ra tay!', `${actor.name} lật bài Gia Tộc và hành quyết ${target.name}! Không ai có thể phản đòn.`);
    this.log(`Judge ${actor.name} hành quyết ${target.name}!`);
    this.markCurrentResolved(); this.advanceNight();
  }

  attemptKill(actorId: string, targetId: string) {
    const actor = this.s.players.find(p => p.id === actorId)!;
    const target = this.s.players.find(p => p.id === targetId)!;
    if (!target.isAlive) { this.markCurrentResolved(); this.advanceNight(); return; }
    this.log(`${actor.name} tấn công ${target.name} | Ra đòn ám sát (Blind Assassin hoặc Shinobi)`);
    // Martyr: auto-triggers, player dies but gets secret token — announce to all!
    const martyr = target.ninjaCards.find(c => c.isReact && c.name === 'Martyr');
    if (martyr) {
      this.addRandomTokenToPlayer(targetId, this.s.round, 'Martyr');
      this.setState(s => ({
        ...s,
        players: s.players.map(p =>
          p.id === targetId ? { ...p, isAlive: false } : p
        )
      }));
      this.announce('🕊️', 'Martyr lật bài!', `${target.name} ngã xuống — nhưng bí mật nhận được 1 Token trước khi chết!`);
      this.log(`${target.name} lật Martyr và ngã xuống — nhưng bí mật nhận được 1 Token!`);
      this.markCurrentResolved(); this.advanceNight(); return;
    }

    // Mirror Monk: gives the player a choice to counter-kill
    const mirrorMonks = target.ninjaCards.filter(c => c.isReact && c.name === 'Mirror Monk');
    if (mirrorMonks.length > 0) {
      this.update({ pendingModal: { type: 'react-choice', actorId, targetId, data: { reactCards: mirrorMonks } } });
    } else {
      this.executeKill(actorId, targetId);
    }
  }

  resolveReact(targetId: string, reactCardId: string | null, actorId: string) {
    const actor = this.s.players.find(p => p.id === actorId)!;
    const target = this.s.players.find(p => p.id === targetId)!;
    this.update({ pendingModal: null });
    if (reactCardId) {
      // Only Mirror Monk reaches here; Martyr is auto-handled in attemptKill
      this.setState(s => ({ ...s, players: s.players.map(p => p.id === actorId ? { ...p, isAlive: false } : p) }));
      this.announce('🪞', 'Mirror Monk phản đòn!', `${target.name} lật Mirror Monk — ${actor.name} bị tiêu diệt ngược lại!`);
      this.log('Mirror Monk phản đòn tiêu diệt kẻ tấn công!');
      this.markCurrentResolved(); this.advanceNight();
    } else {
      this.executeKill(actorId, targetId);
    }
  }

  private executeKill(actorId: string, targetId: string) {
    this.setState(s => ({ ...s, players: s.players.map(p => p.id === targetId ? { ...p, isAlive: false } : p) }));
    this.log('Một vụ ám sát đã xảy ra!'); this.markCurrentResolved(); this.advanceNight();
  }

  shinobiPeek(actorId: string, targetId: string) {
    const actor = this.s.players.find(p => p.id === actorId)!;
    const target = this.s.players.find(p => p.id === targetId)!;
    this.log(`${actor.name} dùng Shinobi lên ${target.name} | Nhìn trộm bài Gia Tộc, quyết định có giết không`);
    this.update({ shinobiPeekedCard: target.houseCard, shinobiTargetId: targetId, pendingModal: { type: 'shinobi-peek', actorId, targetId, data: target.houseCard } });
  }

  resolveShinobi(actorId: string, targetId: string, doKill: boolean) {
    this.update({ pendingModal: null, shinobiPeekedCard: null, shinobiTargetId: null });
    if (doKill) { this.attemptKill(actorId, targetId); }
    else { this.log('Shinobi quyết định tha mạng.'); this.markCurrentResolved(); this.advanceNight(); }
  }

  skipNightAction() { this.markCurrentResolved(); this.advanceNight(); }

  private markCurrentResolved() {
    this.setState(s => ({
      ...s,
      nightQueue: s.nightQueue.map((item, i) => i === s.currentNightActionIndex ? { ...item, resolved: true } : item)
    }));
  }

  private endRound() {
    this.setState(s => {
      const bestAlive = s.players.filter(p => p.isAlive && p.houseCard?.faction !== 'ronin')
        .sort((a,b) => a.houseCard!.rank - b.houseCard!.rank)[0];
      
      const mm = s.players.find(p => p.isAlive && p.ninjaCards.some(c => c.name === 'Mastermind'));
      let winFaction: Faction | null = null;

      if (mm) {
        if (mm.houseCard?.faction === 'ronin') {
          winFaction = null; // Ronin Mastermind = Nobody wins
          this.log(`Mastermind là Ronin (${mm.name})! Không gia tộc nào thắng.`);
        } else {
          winFaction = mm.houseCard!.faction;
          this.log(`${mm.name} lật Mastermind! Phe ${winFaction.toUpperCase()} thắng.`);
        }
      } else {
        winFaction = bestAlive?.houseCard?.faction ?? null;
      }
      
      const newPlayers = s.players.map(p => {
        const isRonin = p.houseCard?.faction === 'ronin';
        const isMastermindRonin = p.ninjaCards.some(c => c.name === 'Mastermind') && isRonin;

        if (winFaction && !isRonin && p.houseCard?.faction === winFaction) {
          const val = this.getRandomTokenValue();
          return { ...p, tokens: [...p.tokens, val], tokenHistory: [...(p.tokenHistory || []), { round: s.round, amount: val, reason: 'Thắng vòng' }], isHouseRevealed: true, needsHouseReview: false };
        }
        if (isRonin && p.isAlive && !isMastermindRonin) {
           const val = this.getRandomTokenValue();
           return { ...p, tokens: [...p.tokens, val], tokenHistory: [...(p.tokenHistory || []), { round: s.round, amount: val, reason: 'Ronin sống sót' }], isHouseRevealed: true, needsHouseReview: false };
        }
        return { ...p, isHouseRevealed: true, needsHouseReview: false };
      });

      return {
        ...s,
        players: newPlayers,
        phase: 'end-round',
        roundWinnerFaction: winFaction || null,
        mastermindActive: false
      };
    });
    const wf = this.s.roundWinnerFaction;
    if (wf) this.log(`Phe ${wf.toUpperCase()} thắng vòng!`);
  }

  nextRound() {
    if (this.s.players.some(p => this.getPlayerTotalScore(p) >= 10)) {
      const winner = this.s.players.reduce((a,b) => this.getPlayerTotalScore(a) > this.getPlayerTotalScore(b) ? a : b);
      this.update({ phase: 'game-over', gameWinnerId: winner.id });
      this.router.navigate(['/end']); return;
    }
    const houseDeck = this.deck.buildHouseDeck(this.s.players.length);
    this.setState(s => ({
      ...s,
      phase: 'house-viewing', round: s.round + 1,
      players: s.players.map((p, i) => ({ ...p, houseCard: houseDeck[i], ninjaCards: [], draftHand: [], draftPassCards: [], isAlive: true, isHouseRevealed: false })),
      currentPlayerIndex: 0, nightQueue: [], currentNightActionIndex: 0, roundWinnerFaction: null, actionLog: [], ninjaDiscardPile: [],
      showCover: false, coverMessage: '', houseViewedIds: [], draftPickedIds: []
    }));
  }

  resetGame() {
    this.setState(s => ({
      ...INITIAL_STATE,
      players: s.players.map(p => ({
        ...p,
        houseCard: null,
        ninjaCards: [],
        draftHand: [],
        draftPassCards: [],
        tokens: [],
        tokenHistory: [],
        isAlive: true,
        isHouseRevealed: false,
        needsHouseReview: false
      }))
    }));
    this.router.navigate(['/']); 
  }
}
