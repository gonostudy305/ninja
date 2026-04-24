import { Injectable } from '@angular/core';
import { GameStateService } from './game-state.service';
import { DeckService } from './deck.service';
import { NightActionService } from './night-action.service';

@Injectable({ providedIn: 'root' })
export class DraftService {
    constructor(private gs: GameStateService, private deck: DeckService, private nightAction: NightActionService) { }

    playerViewedHouse() {
        const localId = this.gs.localPlayerId();
        if (!localId) return;
        const viewed = [...new Set([...this.gs.s.houseViewedIds, localId])];
        const allViewed = this.gs.s.players.every(p => viewed.includes(p.id));
        if (allViewed) {
            this.gs.setState(s => ({ ...s, houseViewedIds: viewed }));
            this.startDraft();
        } else {
            this.gs.update({ houseViewedIds: viewed });
        }
    }

    private startDraft() {
        const ninja = this.deck.buildNinjaDeck();
        // Distribute draft hands per player simultaneously
        const players = this.gs.s.players.map((p, i) => ({
            ...p, draftHand: ninja.slice(i * 3, i * 3 + 3), draftPassCards: [], ninjaCards: [],
        }));
        this.gs.update({ phase: 'draft-pick1', players, currentPlayerIndex: 0, draftPickedIds: [] });
    }

    // Simultaneous draft: each player picks from their own hand independently
    draftPick1(playerId: string, cardIndex: number) {
        const player = this.gs.s.players.find(p => p.id === playerId)!;
        const kept = player.draftHand[cardIndex];
        const pass = player.draftHand.filter((_, i) => i !== cardIndex);
        const pickedIds = [...new Set([...this.gs.s.draftPickedIds, playerId])];
        this.gs.setState(s => ({
            ...s,
            draftPickedIds: pickedIds,
            players: s.players.map(p => p.id === playerId
                ? { ...p, ninjaCards: [kept], draftPassCards: pass, draftHand: [] }
                : p)
        }));
        // Once all picked, rotate hands
        if (pickedIds.length >= this.gs.s.players.length) {
            setTimeout(() => this.rotateDraftHands(), 300);
        }
    }

    private rotateDraftHands() {
        const players = this.gs.s.players;
        const rotated = players.map((p, i) => ({
            ...p, draftHand: players[(i + 1) % players.length].draftPassCards, draftPassCards: []
        }));
        this.gs.update({ players: rotated, phase: 'draft-pick2', draftPickedIds: [] });
    }

    draftPick2(playerId: string, cardIndex: number) {
        const player = this.gs.s.players.find(p => p.id === playerId)!;
        const kept = player.draftHand[cardIndex];
        const discarded = player.draftHand.find((_, i) => i !== cardIndex) ?? null;
        const discard = discarded ? [...this.gs.s.ninjaDiscardPile, discarded] : this.gs.s.ninjaDiscardPile;
        const pickedIds = [...new Set([...this.gs.s.draftPickedIds, playerId])];
        this.gs.setState(s => ({
            ...s,
            draftPickedIds: pickedIds,
            ninjaDiscardPile: discard,
            players: s.players.map(p => p.id === playerId
                ? { ...p, ninjaCards: [...p.ninjaCards, kept], draftHand: [] }
                : p)
        }));
        if (pickedIds.length >= this.gs.s.players.length) {
            setTimeout(() => this.nightAction.startNightPhase(), 300);
        }
    }
}
