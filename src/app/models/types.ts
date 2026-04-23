export type Faction = 'crane' | 'lotus' | 'ronin';
export type NinjaPhase = 'spy' | 'mystic' | 'trickster' | 'blind-assassin' | 'shinobi' | 'react' | 'reveal';
export type GamePhase =
  | 'lobby'
  | 'house-viewing'
  | 'draft-pick1'
  | 'draft-pick2'
  | 'night-spy'
  | 'night-mystic'
  | 'night-trickster'
  | 'night-blind-assassin'
  | 'night-shinobi'
  | 'end-round'
  | 'game-over';

export interface HouseCard {
  id: string;
  faction: Faction;
  rank: number;
}

export interface NinjaCard {
  id: string;
  name: string;
  phase: NinjaPhase;
  phaseOrder: number;
  tricksterNumber?: number;
  description: string;
  requiresTarget: boolean;
  isReact: boolean;
  isReveal: boolean;
  emoji: string;
}

export interface Player {
  id: string;
  name: string;
  houseCard: HouseCard | null;
  ninjaCards: NinjaCard[];
  draftHand: NinjaCard[];
  draftPassCards: NinjaCard[];
  tokens: number[];
  tokenHistory: { round: number; amount: number; reason?: string }[];
  isAlive: boolean;
  isHouseRevealed: boolean;
  needsHouseReview?: boolean;
}

export interface ActionLog {
  message: string;
  isPublic: boolean;
}

export type ModalType =
  | 'spy-result'
  | 'mystic-peek'
  | 'shapeshifter'
  | 'grave-digger-inspect'
  | 'grave-digger-retrieve'
  | 'troublemaker'
  | 'spirit-merchant'
  | 'thief'
  | 'judge'
  | 'shinobi-peek'
  | 'react-choice';

export interface PendingModal {
  type: ModalType;
  actorId: string;
  targetId?: string;
  data?: any;
}

export interface NightQueueItem {
  playerId: string;
  card: NinjaCard;
  resolved: boolean;
}

export interface GameState {
  phase: GamePhase;
  round: number;
  players: Player[];
  currentPlayerIndex: number;
  ninjaDiscardPile: NinjaCard[];
  tokenPool: number;
  actionLog: { message: string; isPublic: boolean }[];
  nightQueue: NightQueueItem[];
  currentNightActionIndex: number;
  pendingModal: PendingModal | null;
  roundWinnerFaction: Faction | null;
  roundWinnerName: string | null;
  gameWinnerId: string | null;
  showCover: boolean;
  coverMessage: string;
  shinobiPeekedCard: HouseCard | null;
  shinobiTargetId: string | null;
  mastermindActive: boolean;
  houseViewedIds: string[];
  draftPickedIds: string[];
  publicAnnouncement: { emoji: string; title: string; message: string } | null;
}
