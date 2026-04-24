import { Component, computed, signal, effect, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { GameStateService } from '../../services/game-state.service';
import { Player, NinjaCard, HouseCard } from '../../models/types';
import { PlayerByIdPipe } from '../../pipes/player-by-id.pipe';

@Component({
  selector: 'app-game-board',
  standalone: true,
  imports: [CommonModule, PlayerByIdPipe],
  templateUrl: './game-board.component.html',
  styleUrls: ['./game-board.component.css']
})
export class GameBoardComponent {
  get s() { return this.gs.state(); }

  constructor(public gs: GameStateService, private router: Router) {
    effect(() => {
      if (this.gs.state().phase === 'game-over') {
        this.router.navigate(['/end']);
      }
    });
  }

  // Computed properties for UI help
  currentPhaseQueueItems = computed(() => {
    const s = this.gs.state();
    if (!s.phase.startsWith('night-')) return [];
    const prefix = s.phase.replace('night-', '');
    return s.nightQueue.filter(qi => {
      const p = s.players.find(x => x.id === qi.playerId);
      return qi.card.phase === prefix && p && p.isAlive;
    });
  });

  currentNightQueueItem = computed(() => {
    const s = this.gs.state();
    return s.nightQueue[s.currentNightActionIndex] ?? null;
  });

  currentNightActor = computed(() => {
    const s = this.gs.state();
    return s.players[s.currentPlayerIndex] ?? null;
  });
  currentNightCard = computed(() => {
    const s = this.gs.state();
    return s.nightQueue[s.currentNightActionIndex]?.card ?? null;
  });
  currentPlayer = computed(() => this.gs.state().players[this.gs.state().currentPlayerIndex]);
  localPlayer = computed(() => this.gs.state().players.find(p => p.id === this.gs.localPlayerId()) ?? null);

  // Local UI state
  showCard = false;
  selectedCardIndex: number | null = null;
  selectedTargetId: string | null = null;
  selected2ndTargetId: string | null = null;

  toggleShowCard() { this.showCard = !this.showCard; }

  doneViewing() {
    this.showCard = false;
    this.gs.playerViewedHouse();
  }

  selectCard(idx: number) { this.selectedCardIndex = idx; }

  confirmDraftPick() {
    if (this.selectedCardIndex === null) return;
    const pId = this.localPlayer()?.id;
    if (!pId) return;

    if (this.s.phase === 'draft-pick1') {
      this.gs.draftPick1(pId, this.selectedCardIndex);
    } else {
      this.gs.draftPick2(pId, this.selectedCardIndex);
    }
    this.selectedCardIndex = null;
  }

  selectTarget(id: string) { this.selectedTargetId = id; }
  selectTarget2(id: string) { this.selected2ndTargetId = id; }

  confirmSpyAction() {
    if (!this.selectedTargetId) return;
    const actor = this.currentNightActor();
    const card = this.currentNightCard();
    if (!actor || !card) return;

    if (card.phase === 'spy') {
      this.gs.actionViewHouseCard(actor.id, this.selectedTargetId);
    } else if (card.phase === 'mystic') {
      this.gs.actionViewMystic(actor.id, this.selectedTargetId);
    }
    this.selectedTargetId = null;
  }

  confirmTricksterAction() {
    const actor = this.currentNightActor()!;
    const card = this.currentNightCard()!;

    switch (card.tricksterNumber) {
      case 1:
        this.gs.actionShapeshifter(actor.id, this.selectedTargetId!, this.selected2ndTargetId!);
        break;
      case 2:
        this.gs.actionGraveDigger(actor.id);
        break;
      case 3:
        this.gs.actionTroublemaker(actor.id, this.selectedTargetId!);
        break;
      case 4:
        if (!this.spiritMerchantMode) {
          // First: player must pick which mode (house or token) before target
          return; // handled by separate button in template
        }
        this.gs.actionSpiritMerchant(actor.id, this.selectedTargetId!, this.spiritMerchantMode);
        this.spiritMerchantMode = null;
        break;
      case 5:
        this.gs.actionThief(actor.id);
        break;
      case 6:
        this.gs.actionJudge(actor.id, this.selectedTargetId!);
        break;
    }
    this.selectedTargetId = null;
    this.selected2ndTargetId = null;
  }

  confirmAssassin() {
    if (!this.selectedTargetId) return;
    this.gs.attemptKill(this.currentNightActor()!.id, this.selectedTargetId);
    this.selectedTargetId = null;
  }

  shinobiPeek() {
    if (!this.selectedTargetId) return;
    this.gs.shinobiPeek(this.currentNightActor()!.id, this.selectedTargetId);
  }

  shinobiDecide(doKill: boolean) {
    const m = this.s.pendingModal!; // actorId = the Shinobi player
    this.gs.resolveShinobi(m.actorId, m.targetId!, doKill);
    this.selectedTargetId = null;
  }

  // Modal Handlers
  resolveShapeshifterModal(swap: boolean) {
    const m = this.s.pendingModal!;
    this.gs.resolveShapeshifter(swap, m.data.t1.id, m.data.t2.id);
  }

  revealMysticNinja(idx: number) { this.gs.revealMysticNinja(idx); }

  spiritMerchantMode: 'house' | 'token' | null = null;
  spiritMerchantActorTokenIdx: number = -1;
  spiritMerchantTargetTokenIdx: number = -1;

  setSpiritMerchantMode(mode: 'house' | 'token') { this.spiritMerchantMode = mode; }

  resolveSpiritMerchant(targetTokenIdx: number) {
    const m = this.s.pendingModal!;
    this.gs.resolveSpiritMerchant(m.actorId, m.data.target.id, this.spiritMerchantActorTokenIdx, targetTokenIdx);
    this.spiritMerchantActorTokenIdx = -1;
    this.spiritMerchantTargetTokenIdx = -1;
  }

  inspectGraveDiggerCard(id: string) { this.gs.graveDiggerReveal(id); }

  resolveGraveDigger(card: NinjaCard | null) {
    const actorId = this.s.pendingModal?.actorId;
    if (actorId) this.gs.resolveGraveDigger(actorId, card);
  }

  getPlayerScore(p: Player): number { return this.gs.getPlayerTotalScore(p); }

  resolveThief(victimId: string, tokenIndex: number) {
    const actorId = this.s.pendingModal?.actorId;
    if (actorId) this.gs.resolveThief(actorId, victimId, tokenIndex);
  }

  resolveTroublemaker(reveal: boolean) {
    const m = this.s.pendingModal!;
    this.gs.resolveTroublemaker(reveal, m.targetId!);
  }

  resolveReact(reactCardId: string | null) {
    const m = this.s.pendingModal!;
    this.gs.resolveReact(m.targetId!, reactCardId, m.actorId);
  }

  // Helpers
  didPlayerWinRound(p: Player): boolean {
    const isRonin = p.houseCard?.faction === 'ronin';
    const isMastermindRonin = p.ninjaCards.some(c => c.name === 'Mastermind') && isRonin;
    const winFaction = this.s.roundWinnerFaction;

    if (winFaction && !isRonin && p.houseCard?.faction === winFaction) return true;
    if (isRonin && p.isAlive && !isMastermindRonin) return true;
    return false;
  }

  getUnusedNinjaCards(p: Player): NinjaCard[] {
    if (!this.s.phase.startsWith('night-')) return p.ninjaCards;
    const currentPhaseOrder = ['spy', 'mystic', 'trickster', 'blind-assassin', 'shinobi'];
    const currentQueueItem = this.s.nightQueue[this.s.currentNightActionIndex];
    const currentPhaseIdx = currentPhaseOrder.indexOf(currentQueueItem?.card.phase ?? '');

    return p.ninjaCards.filter(card => {
      if (card.isReact || card.isReveal) return true;
      const cardPhaseIdx = currentPhaseOrder.indexOf(card.phase);
      return cardPhaseIdx > currentPhaseIdx;
    });
  }

  getRemainingNinjaCount(p: Player): number {
    return this.getUnusedNinjaCards(p).length;
  }

  getPhaseOrderForPlayer(p: Player): number | null {
    const phasePrefix = this.s.phase.replace('night-', '');
    const card = p.ninjaCards.find(c => c.phase === phasePrefix);
    return card ? card.phaseOrder : null;
  }

  isCurrentActor(playerId: string): boolean {
    const actor = this.currentNightActor();
    return !!actor && actor.id === playerId;
  }

  otherAlivePlayers(excludeId: string) {
    return this.s.players.filter((p: Player) => p.id !== excludeId && p.isAlive);
  }

  factionLabel(f: string | undefined): string {
    if (f === 'crane') return 'Crane (Sếu)';
    if (f === 'lotus') return 'Lotus (Sen)';
    if (f === 'ronin') return 'Ronin';
    return 'Chưa rõ';
  }

  factionClass(f: string | undefined): string {
    return f ?? 'unknown';
  }

  rankLabel(r: number): string {
    if (r === 1) return 'Thủ lĩnh';
    return `Hạng ${r}`;
  }

  phaseLabel(phase: string): string {
    const labels: Record<string, string> = {
      'lobby': 'Phòng chờ',
      'house-viewing': 'Xem bài Gia tộc',
      'draft-pick1': 'Draft lá 1',
      'draft-pick2': 'Draft lá 2',
      'night-spy': 'Pha 1: Spy',
      'night-mystic': 'Pha 2: Mystic',
      'night-trickster': 'Pha 3: Trickster',
      'night-blind-assassin': 'Pha 4: Blind Assassin',
      'night-shinobi': 'Pha 5: Shinobi',
      'end-round': 'Phát thưởng & Kết thúc',
      'game-over': 'Trò chơi kết thúc'
    };
    return labels[phase] || phase;
  }

  @HostListener('window:keydown', ['$event'])
  handleKeyDown(event: KeyboardEvent) {
    const isEditing = document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA';
    if (isEditing) return;

    // Modals
    if (this.s.pendingModal) {
      if (['spy-result', 'mystic-peek'].includes(this.s.pendingModal.type)) {
        if (event.key === 'Enter' || event.key === 'Escape' || event.key === ' ') {
          if (this.s.pendingModal.type === 'mystic-peek' && this.s.pendingModal.data?.revealedIndex === null) return;
          this.gs.closePeekModal();
        }
        return;
      }
      if (this.s.pendingModal.type === 'shapeshifter' && this.s.pendingModal.actorId === this.gs.localPlayerId()) {
        if (event.key === 'Enter') this.resolveShapeshifterModal(true);
        if (event.key === 'Escape' || event.key === ' ') this.resolveShapeshifterModal(false);
      }
      return;
    }

    // Cover Screen
    if (this.s.showCover && (event.key === 'Enter' || event.key === ' ')) {
      this.gs.dismissCover();
      return;
    }

    // Public Announcement
    if (this.s.publicAnnouncement && (event.key === 'Enter' || event.key === ' ')) {
      this.gs.dismissAnnouncement();
      return;
    }

    // Draft Phase
    if (this.s.phase.startsWith('draft-')) {
      const myHand = this.localPlayer()?.draftHand ?? [];
      if (event.key === '1' && myHand.length > 0) this.selectCard(0);
      if (event.key === '2' && myHand.length > 1) this.selectCard(1);
      if (event.key === 'Enter') this.confirmDraftPick();
      return;
    }

    // House Viewing
    if (this.s.phase === 'house-viewing' && !this.s.houseViewedIds.includes(this.gs.localPlayerId() ?? '')) {
      if (event.key === 'Enter' || event.key === ' ') this.doneViewing();
      return;
    }

    // End Round
    if (this.s.phase === 'end-round' && (event.key === 'Enter' || event.key === ' ')) {
      this.gs.nextRound();
      return;
    }

    // Night Phase Actions
    if (this.s.phase.startsWith('night-') && this.currentNightActor()?.id === this.gs.localPlayerId()) {
      if (event.key === 'Enter') {
        if (this.s.phase === 'night-spy' || this.s.phase === 'night-mystic') this.confirmSpyAction();
        if (this.s.phase === 'night-trickster') this.confirmTricksterAction();
        if (this.s.phase === 'night-blind-assassin') this.confirmAssassin();
        if (this.s.phase === 'night-shinobi') this.shinobiPeek();
      }
      if (event.key === 'Escape' || event.key === ' ') {
        this.gs.skipNightAction();
      }

      const num = parseInt(event.key);
      if (!isNaN(num) && num >= 1 && num <= 9) {
        const targets = this.otherAlivePlayers(this.gs.localPlayerId()!);
        if (targets[num - 1]) {
          const card = this.currentNightCard();
          if (this.s.phase === 'night-trickster' && card?.tricksterNumber === 1 && this.selectedTargetId) {
            this.selectTarget2(targets[num - 1].id);
          } else {
            this.selectTarget(targets[num - 1].id);
          }
        }
      }
    }
  }
}
