import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { GameStateService, INITIAL_STATE } from './game-state.service';
import { DeckService } from './deck.service';
import { Player, NinjaCard, GameState, NightQueueItem, Faction } from '../models/types';

@Injectable({ providedIn: 'root' })
export class NightActionService {
    constructor(private gs: GameStateService, private deck: DeckService, private router: Router) { }

    private get s() { return this.gs.s; }
    private update(patch: Partial<GameState>) { this.gs.update(patch); }
    private setState(updater: (state: GameState) => GameState) { this.gs.setState(updater); }
    private log(message: string, isPublic = true) { this.gs.log(message, isPublic); }
    private announce(emoji: string, title: string, message: string) { this.gs.announce(emoji, title, message); }
    private addRandomTokenToPlayer(playerId: string, round: number, reason?: string) { return this.gs.addRandomTokenToPlayer(playerId, round, reason); }
    private getPlayerTotalScore(p: Player) { return this.gs.getPlayerTotalScore(p); }
    private getRandomTokenValue() { return this.gs.getRandomTokenValue(); }

    startNightPhase() {
        const queue: NightQueueItem[] = [];
        this.s.players.forEach(p => { if (!p.isAlive) return; p.ninjaCards.forEach(card => { if (!card.isReact && !card.isReveal) queue.push({ playerId: p.id, card, resolved: false }); }); });
        const phaseOrder = ['spy', 'mystic', 'trickster', 'blind-assassin', 'shinobi'];
        queue.sort((a, b) => { const pa = phaseOrder.indexOf(a.card.phase); const pb = phaseOrder.indexOf(b.card.phase); return pa !== pb ? pa - pb : a.card.phaseOrder - b.card.phaseOrder; });
        this.update({ nightQueue: queue, currentNightActionIndex: 0 });
        this.advanceNight();
    }

    advanceNight() {
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

        const currentPhaseOrder = ['spy', 'mystic', 'trickster', 'blind-assassin', 'shinobi'];
        const currentQueueItem = this.s.nightQueue[this.s.currentNightActionIndex];
        const currentPhaseIdx = currentPhaseOrder.indexOf(currentQueueItem?.card.phase ?? '');

        const remainingNinjas = target.ninjaCards.filter(card => {
            if (card.isReact || card.isReveal) return true;
            const cardPhaseIdx = currentPhaseOrder.indexOf(card.phase);
            return cardPhaseIdx > currentPhaseIdx;
        });

        const shuffledNinjas = this.shuffleArray(remainingNinjas);
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
        const shuffledPile = this.shuffleArray(pile);
        this.update({ pendingModal: { type: 'grave-digger-inspect', actorId, data: { pile: shuffledPile, revealedIds: [] } } });
    }

    graveDiggerReveal(cardId: string) {
        if (this.s.pendingModal?.type !== 'grave-digger-inspect') return;
        const revealed: string[] = this.s.pendingModal.data.revealedIds ?? [];
        if (revealed.includes(cardId) || revealed.length >= 2) return;
        const newRevealed = [...revealed, cardId];
        if (newRevealed.length === 2) {
            const picks = (this.s.pendingModal.data.pile as NinjaCard[]).filter(c => newRevealed.includes(c.id));
            this.update({ pendingModal: { type: 'grave-digger-retrieve', actorId: this.s.pendingModal.actorId, data: { picks } } });
        } else {
            this.update({ pendingModal: { ...this.s.pendingModal, data: { ...this.s.pendingModal.data, revealedIds: newRevealed } } });
        }
    }

    resolveGraveDigger(actorId: string, chosenCard: NinjaCard | null) {
        if (chosenCard) {
            this.setState(s => ({
                ...s,
                players: s.players.map(p => p.id === actorId ? { ...p, ninjaCards: [...p.ninjaCards, chosenCard] } : p),
                ninjaDiscardPile: s.ninjaDiscardPile.filter(c => c.id !== chosenCard.id)
            }));

            const currentPhaseOrder = ['spy', 'mystic', 'trickster', 'blind-assassin', 'shinobi'];
            const currentQueueItem = this.s.nightQueue[this.s.currentNightActionIndex];
            const currentPhaseIdx = currentPhaseOrder.indexOf(currentQueueItem?.card.phase ?? '');
            const cardPhaseIdx = currentPhaseOrder.indexOf(chosenCard.phase);

            if (!chosenCard.isReact && !chosenCard.isReveal) {
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

    actionSpiritMerchant(actorId: string, targetId: string, mode: 'house' | 'token') {
        const target = this.s.players.find(p => p.id === targetId)!;
        const actor = this.s.players.find(p => p.id === actorId)!;
        this.log(`${actor.name} dùng Spirit Merchant (Trickster 4) lên ${target.name} | Xem Gia Tộc hoặc đếm Token của mục tiêu, có thể hoán đổi 1 Token`);
        if (mode === 'house') {
            const shuffledTargetTokens = this.shuffleArray(target.tokens);
            const shuffledActorTokens = this.shuffleArray(actor.tokens);
            const targetForModal = { ...target, tokens: shuffledTargetTokens };
            const actorForModal = { ...actor, tokens: shuffledActorTokens };
            this.setState(s => ({
                ...s,
                players: s.players.map(p =>
                    p.id === targetId ? { ...p, tokens: shuffledTargetTokens } :
                        p.id === actorId ? { ...p, tokens: shuffledActorTokens } : p
                ),
                pendingModal: { type: 'spirit-merchant', actorId, targetId, data: { peekMode: 'house', actor: actorForModal, target: targetForModal } }
            }));
        } else {
            const shuffledTargetTokens = this.shuffleArray(target.tokens);
            const shuffledActorTokens = this.shuffleArray(actor.tokens);
            this.setState(s => ({
                ...s,
                players: s.players.map(p =>
                    p.id === targetId ? { ...p, tokens: shuffledTargetTokens } :
                        p.id === actorId ? { ...p, tokens: shuffledActorTokens } : p
                ),
                pendingModal: {
                    type: 'spirit-merchant', actorId, targetId,
                    data: { peekMode: 'token', targetTokenCount: target.tokens.length, actor: { ...actor, tokens: shuffledActorTokens }, target: { ...target, tokens: shuffledTargetTokens } }
                }
            }));
        }
    }

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
                .sort((a, b) => a.houseCard!.rank - b.houseCard!.rank)[0];

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
            const winner = this.s.players.reduce((a, b) => this.getPlayerTotalScore(a) > this.getPlayerTotalScore(b) ? a : b);
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
}
