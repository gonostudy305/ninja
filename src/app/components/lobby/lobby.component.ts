import { Component, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { GameStateService } from '../../services/game-state.service';
import { LobbyService } from '../../services/lobby.service';
import { MASCOTS } from '../../models/types';

@Component({
  selector: 'app-lobby',
  imports: [CommonModule, FormsModule],
  templateUrl: './lobby.component.html',
  styleUrl: './lobby.component.css',
})
export class LobbyComponent {
  playerName = signal('');
  roomCodeInput = signal('');
  mascotList = MASCOTS;
  selectedMascot = signal(this.mascotList[0]);

  get s() { return this.gs.state; }
  get rId() { return this.gs.roomId; }
  get lId() { return this.gs.localPlayerId; }

  constructor(private gs: GameStateService, private lobby: LobbyService, private router: Router) {
    effect(() => {
      if (this.s().phase !== 'lobby') {
        this.router.navigate(['/game']);
      }
    });
  }

  get isHost() {
    const state = this.s();
    return state.players.length > 0 && state.players[0].id === this.lId();
  }

  async createRoom() {
    if (!this.playerName().trim()) { alert('Vui lòng nhập tên!'); return; }
    try {
      await this.lobby.createRoom(this.playerName().trim(), this.selectedMascot());
    } catch (e: any) {
      alert(e.message);
    }
  }

  async joinRoom() {
    if (!this.playerName().trim()) { alert('Vui lòng nhập tên!'); return; }
    if (!this.roomCodeInput().trim()) { alert('Vui lòng nhập mã phòng!'); return; }
    try {
      await this.lobby.joinExistingRoom(this.roomCodeInput().trim(), this.playerName().trim(), this.selectedMascot());
    } catch (e: any) {
      alert(e.message);
    }
  }

  startGame() {
    this.lobby.startGameHost();
  }
}
