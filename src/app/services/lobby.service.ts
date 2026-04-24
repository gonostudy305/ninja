import { inject, Injectable } from '@angular/core';
import { Database, ref, set, get } from '@angular/fire/database';
import { GameStateService, INITIAL_STATE } from './game-state.service';
import { DeckService } from './deck.service';
import { Player, GameState } from '../models/types';

@Injectable({ providedIn: 'root' })
export class LobbyService {
    private db = inject(Database);

    constructor(private gs: GameStateService, private deck: DeckService) { }

    async createRoom(playerName: string, mascot: string = 'wolf') {
        const rId = Math.random().toString(36).substring(2, 6).toUpperCase();
        const pId = Math.random().toString(36).substring(2, 9);

        const hostPlayer: Player = {
            id: pId, name: playerName, mascot, houseCard: null, ninjaCards: [],
            draftHand: [], draftPassCards: [], tokens: [], tokenHistory: [], isAlive: true, isHouseRevealed: false
        };

        const initState = { ...INITIAL_STATE, players: [hostPlayer] };
        await set(ref(this.db, `rooms/${rId}/gameState`), initState);

        this.gs.joinRoom(rId, pId);
        return rId;
    }

    async joinExistingRoom(rId: string, playerName: string, mascot: string = 'wolf') {
        const pId = Math.random().toString(36).substring(2, 9);

        const snap = await get(ref(this.db, `rooms/${rId.toUpperCase()}/gameState`));
        if (!snap.exists()) throw new Error('Room không tồn tại');

        const s = snap.val() as GameState;
        if (s.phase !== 'lobby') throw new Error('Trận đấu đã bắt đầu');
        if (s.players.length >= 11) throw new Error('Phòng đã đầy');
        if (s.players.some(p => p.mascot === mascot)) throw new Error('Mascot này đã được chọn');

        const newPlayer: Player = {
            id: pId, name: playerName, mascot, houseCard: null, ninjaCards: [],
            draftHand: [], draftPassCards: [], tokens: [], tokenHistory: [], isAlive: true, isHouseRevealed: false
        };

        s.players.push(newPlayer);
        await set(ref(this.db, `rooms/${rId.toUpperCase()}/gameState`), s);

        this.gs.joinRoom(rId.toUpperCase(), pId);
        return true;
    }

    startGameHost() {
        const players = this.gs.s.players;
        if (players.length < 4) return;
        const houseDeck = this.deck.buildHouseDeck(players.length);
        const initedPlayers = players.map((p, i) => ({ ...p, houseCard: houseDeck[i] }));
        this.gs.setState(() => ({
            ...INITIAL_STATE, phase: 'house-viewing', round: 1, players: initedPlayers,
            houseViewedIds: [], draftPickedIds: [],
        }));
    }
}
