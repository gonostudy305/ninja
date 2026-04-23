import { Component, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { GameStateService } from '../../services/game-state.service';

@Component({
  selector: 'app-winner',
  imports: [CommonModule],
  templateUrl: './winner.component.html',
  styleUrl: './winner.component.css',
})
export class WinnerComponent {
  constructor(public gs: GameStateService, private router: Router) {
    effect(() => {
      if (this.gs.state().phase === 'lobby') {
        this.router.navigate(['/']);
      }
    });
  }

  get winner() {
    const s = this.gs.state();
    return s.players.find(p => p.id === s.gameWinnerId) ?? null;
  }

  getPlayerScore(p: any): number { return this.gs.getPlayerTotalScore(p); }

  get sortedPlayers() {
    return [...this.gs.state().players].sort((a, b) => this.getPlayerScore(b) - this.getPlayerScore(a));
  }

  factionLabel(f: string | undefined) {
    if (f === 'crane') return '🦢 Crane';
    if (f === 'lotus') return '🪷 Lotus';
    return '⚔️ Ronin';
  }
}
