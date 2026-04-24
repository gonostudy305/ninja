import { inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { GameState, Player, NinjaCard, HouseCard, Faction, NightQueueItem } from '../models/types';
import { DeckService } from './deck.service';
import { Database, ref, set, get, onValue, update } from '@angular/fire/database';

export const INITIAL_STATE: GameState = {
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

  constructor(private deck: DeckService, private router: Router) { }

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

  setState(updater: (state: GameState) => GameState) {
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

    update(ref(this.db, `rooms/${rId}/gameState`), publicState);
  }

  update(patch: Partial<GameState>) {
    this.setState(s => ({ ...s, ...patch }));
  }

  log(message: string, isPublic = true) {
    this.update({ actionLog: [...this.s.actionLog, { message, isPublic }] });
  }

  announce(emoji: string, title: string, message: string) {
    this.update({ publicAnnouncement: { emoji, title, message } });
  }

  dismissAnnouncement() {
    this.update({ publicAnnouncement: null });
  }

  getRandomTokenValue(): number {
    const r = Math.random();
    if (r < 0.20) return 4;   // 20%
    if (r < 0.65) return 2;   // 45% (0.65 - 0.20)
    return 3;                // 35% (1.0 - 0.65)
  }

  addRandomTokenToPlayer(playerId: string, round: number, reason?: string): number {
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



  dismissCover() { this.update({ showCover: false, coverMessage: '' }); }



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
