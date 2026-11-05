import type { RoleId, NightStep, Deck, Team } from './roles';

export type Phase =
  | 'lobby' | 'reveal' | 'night' | 'day_announce' | 'discussion'
  | 'vote' | 'vote_result' | 'hunter' | 'gameover';

export interface Settings {
  deck: Deck;
  reveal: 'full' | 'team' | 'none' | 'day_only';
  guardSelf: boolean;
  nightSeconds: number;
  discussSeconds: number;
  voteSeconds: number;
  tie: 'none' | 'revote';
  deadSeeRoles: boolean;
  modSeesRoles: boolean;
}

export interface PView {
  id: string;
  name: string;
  alive: boolean;
  connected: boolean;
  acked: boolean;
  role?: RoleId;
  revealed?: string;
  lover?: string;
}

export interface Announcement {
  title: string;
  deaths: { id: string; name: string; revealed?: string; cause: 'night' | 'day' | 'hunter' | 'lover' }[];
}

export interface VoteResult {
  lines: { voter: string; target: string | null }[];
  tally: { id: string; name: string; count: number }[];
  executed?: string;
  note: string;
}

export interface Turn {
  step: NightStep;
  confirmed: boolean;
  dead: boolean;
  lastGuard?: string;
  canSelf?: boolean;
  chosen?: string | string[];
  need?: number;
  targets?: string[];
  victims?: { id: string; name: string }[];
  canHeal?: boolean;
  canPoison?: boolean;
  save?: string;
  poison?: string;
  result?: { name: string; isWolf: boolean };
}

export interface View {
  code: string;
  phase: Phase;
  night: number;
  day: number;
  modName: string;
  modConnected: boolean;
  isMod: boolean;
  players: PView[];
  settings: Settings;
  timerEnd?: number;
  serverNow: number;
  announcement: Announcement | null;
  voteResult: VoteResult | null;
  winner?: Team;
  log?: string[];
  hunterActive: boolean;
  vote?: { candidates: string[]; myVote: string | null; votedCount: number; voterCount: number };
  mod?: {
    steps: NightStep[];
    current?: NightStep;
    calls: Partial<Record<NightStep, 'active' | 'done'>>;
    confirmed: boolean;
    ackCount: number;
    marks: Record<string, { tags: string[]; note: string }>;
    notes: string;
  };
  me?: {
    id: string;
    role?: RoleId;
    alive: boolean;
    loverName?: string;
    seerLog: { night: number; name: string; isWolf: boolean }[];
    hunterTurn: boolean;
  };
  turn?: Turn;
}
