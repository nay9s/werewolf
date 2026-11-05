// กฎเกมทั้งหมดอยู่ที่นี่ (ไม่มีโค้ดเครือข่าย) เพื่อให้ทดสอบง่าย
import { randomBytes, randomInt } from 'crypto';
import { ROLES, RoleId, Team, NightStep, NIGHT_ORDER, stepRoles, Deck } from './roles';

export type Phase =
  | 'lobby'
  | 'reveal'
  | 'night'
  | 'day_announce'
  | 'discussion'
  | 'vote'
  | 'vote_result'
  | 'hunter'
  | 'gameover';
export type RevealMode = 'full' | 'team' | 'none' | 'day_only';
export type DeathCause = 'night' | 'day' | 'hunter' | 'lover';

export interface Player {
  id: string;
  name: string;
  role?: RoleId;
  alive: boolean;
  connected: boolean;
  acked: boolean;
  lover?: string;
  revealed?: string;
  seerLog: { night: number; targetId: string; isWolf: boolean }[];
}

export interface Settings {
  deck: Deck;
  reveal: RevealMode;
  guardSelf: boolean;
  nightSeconds: number;
  discussSeconds: number;
  voteSeconds: number;
  tie: 'none' | 'revote';
  deadSeeRoles: boolean;
  modSeesRoles: boolean;
}

export interface NightData {
  calls: Partial<Record<NightStep, 'active' | 'done'>>;
  confirmed: Partial<Record<NightStep, boolean>>;
  fakeAt?: number;
  cupid?: string[];
  guard?: string;
  wolfTargets: string[];
  seer?: string;
  witchSave?: string;
  witchPoison?: string;
}

export interface Announcement {
  title: string;
  deaths: { id: string; name: string; revealed?: string; cause: DeathCause }[];
}

export interface VoteResult {
  lines: { voter: string; target: string | null }[];
  tally: { id: string; name: string; count: number }[];
  executed?: string;
  note: string;
}

export interface Room {
  code: string;
  modId: string;
  modName: string;
  modConnected: boolean;
  players: Player[];
  settings: Settings;
  phase: Phase;
  night: number;
  day: number;
  current?: NightStep;
  timerEnd?: number;
  nightData: NightData;
  lastGuard?: string;
  witchHealUsed: boolean;
  witchPoisonUsed: boolean;
  doubleKillPending: boolean;
  doubleKillNight: boolean;
  announcement: Announcement | null;
  votes: Record<string, string>;
  voteCandidates: string[];
  revoteDone: boolean;
  voteResult: VoteResult | null;
  hunterPending: string[];
  afterHunter: Phase;
  winner?: Team;
  log: string[];
  marks: Record<string, { tags: string[]; note: string }>;
  modNotes: string;
}

export class GameError extends Error {}
const fail = (m: string): never => {
  throw new GameError(m);
};
export const newId = () => randomBytes(12).toString('hex');
export const teamOf = (r?: RoleId): Team | undefined => (r ? ROLES[r].team : undefined);

const defaultSettings = (): Settings => ({
  deck: { werewolf: 1, seer: 1 },
  reveal: 'full',
  guardSelf: false,
  nightSeconds: 25,
  discussSeconds: 300,
  voteSeconds: 30,
  tie: 'none',
  deadSeeRoles: true,
  modSeesRoles: false,
});
const emptyNight = (): NightData => ({ calls: {}, confirmed: {}, wolfTargets: [] });

export function newRoom(code: string, modName: string): Room {
  return {
    code,
    modId: newId(),
    modName: cleanName(modName),
    modConnected: true,
    players: [],
    settings: defaultSettings(),
    phase: 'lobby',
    night: 0,
    day: 0,
    nightData: emptyNight(),
    witchHealUsed: false,
    witchPoisonUsed: false,
    doubleKillPending: false,
    doubleKillNight: false,
    announcement: null,
    votes: {},
    voteCandidates: [],
    revoteDone: false,
    voteResult: null,
    hunterPending: [],
    afterHunter: 'day_announce',
    log: [],
    marks: {},
    modNotes: '',
  };
}

function cleanName(n: unknown): string {
  const s = String(n ?? '').trim().slice(0, 20);
  if (!s) fail('กรุณาใส่ชื่อ');
  return s;
}
const isMod = (room: Room, actor: string) => actor === room.modId || fail('เฉพาะ Moderator เท่านั้น');
const player = (room: Room, id: string) => room.players.find((p) => p.id === id) ?? fail('ไม่พบผู้เล่น');
const alivePlayer = (room: Room, id: unknown) => {
  const p = room.players.find((x) => x.id === id && x.alive);
  return p ?? fail('เลือกผู้เล่นที่ยังมีชีวิตอยู่');
};
const nameOf = (room: Room, id?: string) => room.players.find((p) => p.id === id)?.name ?? '-';
const inGame = (room: Room, r: RoleId) => room.players.some((p) => p.role === r);

// ---------- Lobby ----------
export function joinRoom(room: Room, name: unknown): string {
  if (room.phase !== 'lobby') fail('เกมเริ่มไปแล้ว');
  const n = cleanName(name);
  if (room.players.length >= 30) fail('ห้องเต็ม');
  if (n === room.modName || room.players.some((p) => p.name === n)) fail('ชื่อนี้ถูกใช้แล้ว');
  const id = newId();
  room.players.push({ id, name: n, alive: true, connected: true, acked: false, seerLog: [] });
  return id;
}

export function kick(room: Room, actor: string, pid: string) {
  isMod(room, actor);
  if (room.phase !== 'lobby') fail('เตะได้เฉพาะก่อนเริ่มเกม');
  room.players = room.players.filter((p) => p.id !== pid);
}

const clamp = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

export function updateSettings(room: Room, actor: string, s: Partial<Settings>) {
  isMod(room, actor);
  if (room.phase !== 'lobby') fail('แก้ตั้งค่าได้เฉพาะก่อนเริ่มเกม');
  const cur = room.settings;
  if (s.deck) {
    const deck: Deck = {};
    for (const r of Object.keys(ROLES) as RoleId[]) {
      if (r === 'villager') continue;
      const max = ROLES[r].unique ? 1 : 30;
      const v = clamp(s.deck[r], 0, max, 0);
      if (v) deck[r] = v;
    }
    cur.deck = deck;
  }
  if (s.reveal && ['full', 'team', 'none', 'day_only'].includes(s.reveal)) cur.reveal = s.reveal;
  if (s.tie && ['none', 'revote'].includes(s.tie)) cur.tie = s.tie;
  if (s.guardSelf !== undefined) cur.guardSelf = !!s.guardSelf;
  if (s.deadSeeRoles !== undefined) cur.deadSeeRoles = !!s.deadSeeRoles;
  if (s.modSeesRoles !== undefined) cur.modSeesRoles = !!s.modSeesRoles;
  if (s.nightSeconds !== undefined) cur.nightSeconds = clamp(s.nightSeconds, 10, 120, 25);
  if (s.discussSeconds !== undefined) cur.discussSeconds = clamp(s.discussSeconds, 60, 1800, 300);
  if (s.voteSeconds !== undefined) cur.voteSeconds = clamp(s.voteSeconds, 10, 180, 30);
}

export const deckTotal = (d: Deck) => Object.values(d).reduce((a, b) => a + (b ?? 0), 0);

export function validateDeck(room: Room) {
  const n = room.players.length;
  const d = room.settings.deck;
  if (n < 3) fail('ต้องมีผู้เล่นอย่างน้อย 3 คน');
  if ((d.werewolf ?? 0) < 1) fail('ต้องมีหมาป่าอย่างน้อย 1 ตัว');
  if (deckTotal(d) > n) fail('จำนวน Role เกินจำนวนผู้เล่น');
  const wolves = (d.werewolf ?? 0) + (d.wolfcub ?? 0);
  if (wolves * 2 >= n) fail('หมาป่าต้องน้อยกว่าครึ่งของผู้เล่น ไม่งั้นหมาป่าชนะทันที');
}

function resetGame(room: Room) {
  room.night = 0;
  room.day = 0;
  room.current = undefined;
  room.timerEnd = undefined;
  room.nightData = emptyNight();
  room.lastGuard = undefined;
  room.witchHealUsed = false;
  room.witchPoisonUsed = false;
  room.doubleKillPending = false;
  room.doubleKillNight = false;
  room.announcement = null;
  room.votes = {};
  room.voteCandidates = [];
  room.revoteDone = false;
  room.voteResult = null;
  room.hunterPending = [];
  room.winner = undefined;
  room.log = [];
  room.marks = {};
  for (const p of room.players) {
    p.role = undefined;
    p.alive = true;
    p.acked = false;
    p.lover = undefined;
    p.revealed = undefined;
    p.seerLog = [];
  }
}

// สุ่มบนเซิร์ฟเวอร์ด้วย Fisher-Yates + crypto.randomInt
export function startGame(room: Room, actor: string) {
  isMod(room, actor);
  if (room.phase !== 'lobby') fail('เกมเริ่มไปแล้ว');
  validateDeck(room);
  resetGame(room);
  const cards: RoleId[] = [];
  for (const [r, c] of Object.entries(room.settings.deck) as [RoleId, number][]) {
    for (let i = 0; i < c; i++) cards.push(r);
  }
  while (cards.length < room.players.length) cards.push('villager');
  for (let i = cards.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  room.players.forEach((p, i) => (p.role = cards[i]));
  room.phase = 'reveal';
  room.log.push('แจก Role: ' + room.players.map((p) => `${p.name}=${ROLES[p.role!].name}`).join(', '));
}

export function ackRole(room: Room, actor: string) {
  if (room.phase !== 'reveal') fail('ไม่ใช่ช่วงดู Role');
  player(room, actor).acked = true;
}

// ---------- Night ----------
export function availableSteps(room: Room): NightStep[] {
  return NIGHT_ORDER.filter((s) =>
    s === 'cupid' ? room.night === 1 && inGame(room, 'cupid') : stepRoles(s).some((r) => inGame(room, r)),
  );
}
const stepAllDead = (room: Room, s: NightStep) =>
  !room.players.some((p) => p.alive && stepRoles(s).includes(p.role!));

export function startNight(room: Room, actor: string) {
  isMod(room, actor);
  if (!['reveal', 'day_announce', 'discussion', 'vote_result'].includes(room.phase)) fail('ยังเริ่มกลางคืนไม่ได้');
  room.night += 1;
  room.nightData = emptyNight();
  room.doubleKillNight = room.doubleKillPending;
  room.doubleKillPending = false;
  room.phase = 'night';
  room.current = undefined;
  room.timerEnd = undefined;
  room.votes = {};
  room.voteResult = null;
  room.revoteDone = false;
  room.announcement = null;
}

export function callStep(room: Room, actor: string, step: NightStep) {
  isMod(room, actor);
  if (room.phase !== 'night') fail('ไม่ใช่กลางคืน');
  if (!availableSteps(room).includes(step)) fail('Role นี้ไม่มีในเกม');
  if (room.current && room.current !== step) endStep(room);
  room.current = step;
  room.nightData.calls[step] = 'active';
  room.nightData.confirmed[step] = false;
  const now = Date.now();
  room.timerEnd = now + room.settings.nightSeconds * 1000;
  // Role ที่ตายหมดแล้ว: แกล้งทำเป็น "ยืนยันแล้ว" หลังเวลาสุ่ม เพื่อไม่ให้ Moderator/ห้องเดาได้
  room.nightData.fakeAt = stepAllDead(room, step) ? now + randomInt(4000, 11000) : undefined;
}

export function endStep(room: Room) {
  if (!room.current) return;
  room.nightData.calls[room.current] = 'done';
  room.current = undefined;
  room.timerEnd = undefined;
  room.nightData.fakeAt = undefined;
}

export function addTime(room: Room, actor: string, sec: number) {
  isMod(room, actor);
  if (!room.timerEnd) return fail('ไม่มี timer ที่กำลังเดิน');
  room.timerEnd += clamp(sec, 5, 120, 10) * 1000;
}

export interface NightActionInput {
  targets?: string[];
  confirm?: boolean;
  save?: string | null;
  poison?: string | null;
}

export function nightAction(room: Room, actor: string, a: NightActionInput) {
  const step = room.current;
  if (room.phase !== 'night' || !step) fail('ยังไม่ถึงตาคุณ');
  const me = player(room, actor);
  if (!me.alive || !stepRoles(step!).includes(me.role!)) fail('ยังไม่ถึงตาคุณ');
  const nd = room.nightData;
  if (nd.confirmed[step!]) fail('ยืนยันไปแล้ว');
  const targets = [...new Set((a.targets ?? []).map(String))];

  switch (step) {
    case 'cupid': {
      if (targets.length !== 2) fail('เลือกคู่รัก 2 คน');
      const [x, y] = targets.map((t) => alivePlayer(room, t));
      x.lover = y.id;
      y.lover = x.id;
      nd.cupid = targets;
      break;
    }
    case 'bodyguard': {
      const t = alivePlayer(room, targets[0]);
      if (t.id === room.lastGuard) fail('ห้ามป้องกันคนเดิมสองคืนติด');
      if (t.id === me.id && !room.settings.guardSelf) fail('ห้ามป้องกันตัวเอง');
      nd.guard = t.id;
      break;
    }
    case 'wolves': {
      const preys = room.players.filter((p) => p.alive && teamOf(p.role) !== 'wolf');
      const need = Math.min(room.doubleKillNight ? 2 : 1, preys.length);
      if (targets.length > need) fail(`เลือกได้ ${need} คน`);
      for (const t of targets) {
        const p = alivePlayer(room, t);
        if (teamOf(p.role) === 'wolf') fail('เลือกหมาป่าด้วยกันไม่ได้');
      }
      nd.wolfTargets = targets;
      if (!a.confirm) return; // แค่ชี้ ยังไม่ยืนยัน — เพื่อนหมาป่าเห็นทันที
      if (targets.length !== need) fail(`ต้องเลือก ${need} คน`);
      break;
    }
    case 'seer': {
      const t = alivePlayer(room, targets[0]);
      if (t.id === me.id) fail('ส่องตัวเองไม่ได้');
      nd.seer = t.id;
      me.seerLog.push({ night: room.night, targetId: t.id, isWolf: teamOf(t.role) === 'wolf' });
      break;
    }
    case 'witch': {
      const save = a.save ?? undefined;
      const poison = a.poison ?? undefined;
      if (save && poison) fail('ใช้ยาได้คืนละขวด');
      if (save) {
        if (room.witchHealUsed) fail('ใช้ยาชุบชีวิตไปแล้ว');
        if (!nd.wolfTargets.includes(save)) fail('ชุบได้เฉพาะเหยื่อของหมาป่าคืนนี้');
        nd.witchSave = save;
        room.witchHealUsed = true;
      }
      if (poison) {
        if (room.witchPoisonUsed) fail('ใช้ยาพิษไปแล้ว');
        alivePlayer(room, poison);
        nd.witchPoison = poison;
        room.witchPoisonUsed = true;
      }
      break;
    }
  }
  nd.confirmed[step!] = true;
}

function revealText(room: Room, p: Player, cause: DeathCause): string | undefined {
  const r = ROLES[p.role!];
  const full = `${r.emoji} ${r.name}`;
  switch (room.settings.reveal) {
    case 'full':
      return full;
    case 'team':
      return r.team === 'wolf' ? '🐺 ฝ่ายหมาป่า' : '🏘️ ฝ่ายชาวบ้าน';
    case 'none':
      return undefined;
    case 'day_only':
      return cause === 'night' ? undefined : full;
  }
}

// ฆ่าผู้เล่น + ลูกโซ่คู่รัก + ธงลูกหมาป่า + คิวนายพราน
function kill(room: Room, ids: string[], cause: DeathCause): Announcement['deaths'] {
  const out: Announcement['deaths'] = [];
  const queue: [string, DeathCause][] = ids.map((i) => [i, cause]);
  while (queue.length) {
    const [id, c] = queue.shift()!;
    const p = room.players.find((x) => x.id === id);
    if (!p || !p.alive) continue;
    p.alive = false;
    p.revealed = revealText(room, p, c === 'lover' ? cause : c);
    out.push({ id: p.id, name: p.name, revealed: p.revealed, cause: c });
    if (p.role === 'wolfcub') room.doubleKillPending = true;
    if (p.role === 'hunter') room.hunterPending.push(p.id);
    if (p.lover) queue.push([p.lover, 'lover']);
  }
  return out;
}

export function checkWin(room: Room): boolean {
  const alive = room.players.filter((p) => p.alive);
  const wolves = alive.filter((p) => teamOf(p.role) === 'wolf').length;
  const others = alive.length - wolves;
  let w: Team | undefined;
  if (alive.length === 0) w = 'wolf'; // ตายพร้อมกันหมด → ฝ่ายหมาป่าชนะ (กฎ Ultimate Werewolf)
  else if (wolves === 0) w = 'village';
  else if (wolves >= others) w = 'wolf';
  if (!w) return false;
  room.winner = w;
  room.phase = 'gameover';
  room.current = undefined;
  room.timerEnd = undefined;
  room.log.push(w === 'wolf' ? '🐺 ฝ่ายหมาป่าชนะ' : '🏘️ ฝ่ายชาวบ้านชนะ');
  return true;
}

function afterDeaths(room: Room, next: Phase) {
  if (room.hunterPending.length) {
    room.phase = 'hunter';
    room.afterHunter = next;
    return;
  }
  if (!checkWin(room)) room.phase = next;
}

export function endNight(room: Room, actor: string) {
  isMod(room, actor);
  if (room.phase !== 'night') fail('ไม่ใช่กลางคืน');
  endStep(room);
  const nd = room.nightData;
  const deaths = nd.wolfTargets.filter((t) => t !== nd.guard && t !== nd.witchSave);
  if (nd.witchPoison && !deaths.includes(nd.witchPoison)) deaths.push(nd.witchPoison);
  room.lastGuard = nd.guard;

  const parts = [`คืนที่ ${room.night}:`];
  if (nd.cupid) parts.push(`คิวปิดจับคู่ ${nd.cupid.map((i) => nameOf(room, i)).join(' ❤ ')}`);
  if (nd.guard) parts.push(`บอดี้การ์ดป้องกัน ${nameOf(room, nd.guard)}`);
  parts.push(`หมาป่ากัด ${nd.wolfTargets.map((i) => nameOf(room, i)).join(', ') || '-'}`);
  if (nd.seer) parts.push(`หมอดูส่อง ${nameOf(room, nd.seer)}`);
  if (nd.witchSave) parts.push(`แม่มดชุบ ${nameOf(room, nd.witchSave)}`);
  if (nd.witchPoison) parts.push(`แม่มดวางยา ${nameOf(room, nd.witchPoison)}`);
  room.log.push(parts.join(' · '));

  room.day = room.night;
  room.announcement = { title: `เช้าวันที่ ${room.day}`, deaths: kill(room, deaths, 'night') };
  afterDeaths(room, 'day_announce');
}

export function hunterShoot(room: Room, actor: string, target: string | null) {
  if (room.phase !== 'hunter' || !room.hunterPending.includes(actor)) fail('ไม่ใช่ตาของนายพราน');
  room.hunterPending = room.hunterPending.filter((h) => h !== actor);
  if (target) {
    const t = alivePlayer(room, target);
    const died = kill(room, [t.id], 'hunter');
    room.announcement?.deaths.push(...died);
    room.log.push(`นายพราน ${nameOf(room, actor)} ยิง ${t.name}`);
  }
  if (room.hunterPending.length) return;
  if (!checkWin(room)) room.phase = room.afterHunter;
}

// ---------- Day ----------
export function startDiscussion(room: Room, actor: string) {
  isMod(room, actor);
  if (room.phase !== 'day_announce') fail('ยังเริ่มอภิปรายไม่ได้');
  room.phase = 'discussion';
  room.timerEnd = Date.now() + room.settings.discussSeconds * 1000;
}

function startVote(room: Room, candidates: string[]) {
  room.phase = 'vote';
  room.votes = {};
  room.voteCandidates = candidates;
  room.timerEnd = Date.now() + room.settings.voteSeconds * 1000;
}

export function openVote(room: Room, actor: string) {
  isMod(room, actor);
  if (!['day_announce', 'discussion'].includes(room.phase)) fail('ยังเปิดโหวตไม่ได้');
  room.voteResult = null;
  room.revoteDone = false;
  startVote(
    room,
    room.players.filter((p) => p.alive).map((p) => p.id),
  );
}

export function castVote(room: Room, actor: string, target: string | null) {
  if (room.phase !== 'vote') fail('ไม่ใช่ช่วงโหวต');
  const me = player(room, actor);
  if (!me.alive) fail('คนตายโหวตไม่ได้');
  if (target === null) {
    delete room.votes[actor];
    return;
  }
  if (target === actor) fail('โหวตตัวเองไม่ได้');
  if (!room.voteCandidates.includes(target)) fail('เลือกผู้เล่นในรายชื่อ');
  room.votes[actor] = target;
}

export function closeVote(room: Room, actor?: string) {
  if (actor !== undefined) isMod(room, actor);
  if (room.phase !== 'vote') fail('ไม่ใช่ช่วงโหวต');
  room.timerEnd = undefined;
  const counts = new Map<string, number>();
  for (const t of Object.values(room.votes)) counts.set(t, (counts.get(t) ?? 0) + 1);
  const tally = [...counts.entries()]
    .map(([id, count]) => ({ id, name: nameOf(room, id), count }))
    .sort((a, b) => b.count - a.count);
  const lines = room.players
    .filter((p) => p.alive)
    .map((p) => ({ voter: p.name, target: room.votes[p.id] ? nameOf(room, room.votes[p.id]) : null }));
  const top = tally.filter((t) => t.count === tally[0]?.count);

  let executed: string | undefined;
  let note: string;
  if (!tally.length) note = 'ไม่มีใครโหวต ไม่มีใครถูกประหาร';
  else if (top.length > 1) {
    if (room.settings.tie === 'revote' && !room.revoteDone) {
      room.revoteDone = true;
      room.voteResult = { lines, tally, note: 'คะแนนเสมอ โหวตใหม่เฉพาะผู้ที่คะแนนเท่ากัน' };
      startVote(
        room,
        top.map((t) => t.id),
      );
      return;
    }
    note = 'คะแนนเสมอ ไม่มีใครถูกประหาร';
  } else {
    executed = top[0].id;
    note = `${top[0].name} ถูกประหาร`;
  }
  room.voteResult = { lines, tally, executed, note };
  room.log.push(`วันที่ ${room.day}: ${note} (${lines.map((l) => `${l.voter}→${l.target ?? '-'}`).join(', ')})`);
  room.announcement = { title: `ผลโหวตวันที่ ${room.day}`, deaths: executed ? kill(room, [executed], 'day') : [] };
  afterDeaths(room, 'vote_result');
}

export function playAgain(room: Room, actor: string) {
  isMod(room, actor);
  if (room.phase !== 'gameover') fail('เกมยังไม่จบ');
  resetGame(room);
  room.phase = 'lobby';
}

export function setMark(room: Room, actor: string, pid: string, tags: string[], note: string) {
  isMod(room, actor);
  player(room, pid);
  room.marks[pid] = { tags: (tags ?? []).map(String).slice(0, 10), note: String(note ?? '').slice(0, 300) };
}

export function setNotes(room: Room, actor: string, notes: string) {
  isMod(room, actor);
  room.modNotes = String(notes ?? '').slice(0, 5000);
}

// ---------- View: ส่งเฉพาะข้อมูลที่ผู้ดูคนนั้นมีสิทธิ์เห็น ----------
export function viewFor(room: Room, viewer: string) {
  const isModView = viewer === room.modId;
  const me = room.players.find((p) => p.id === viewer);
  const over = room.phase === 'gameover';
  const myTeam = teamOf(me?.role);
  const spectator = !!me && !me.alive && room.settings.deadSeeRoles && room.phase !== 'lobby';
  const seeAll = over || spectator || (isModView && room.settings.modSeesRoles);

  const players = room.players.map((p) => {
    let role: RoleId | undefined;
    if (seeAll || p.id === viewer) role = p.role;
    else if (me && myTeam === 'wolf' && teamOf(p.role) === 'wolf') role = p.role;
    return {
      id: p.id,
      name: p.name,
      alive: p.alive,
      connected: p.connected,
      acked: p.acked,
      role,
      revealed: p.alive ? undefined : p.revealed,
      lover: seeAll ? p.lover : undefined,
    };
  });

  const view: Record<string, unknown> = {
    code: room.code,
    phase: room.phase,
    night: room.night,
    day: room.day,
    modName: room.modName,
    modConnected: room.modConnected,
    isMod: isModView,
    players,
    settings: room.settings,
    timerEnd: room.timerEnd,
    serverNow: Date.now(),
    announcement: room.announcement,
    voteResult: room.voteResult,
    winner: room.winner,
    log: over ? room.log : undefined,
    hunterActive: room.phase === 'hunter',
  };

  if (room.phase === 'vote') {
    view.vote = {
      candidates: room.voteCandidates,
      myVote: room.votes[viewer] ?? null,
      votedCount: Object.keys(room.votes).length,
      voterCount: room.players.filter((p) => p.alive).length,
    };
  }

  if (isModView) {
    view.mod = {
      steps: availableSteps(room),
      current: room.current,
      calls: room.nightData.calls,
      confirmed: room.current ? !!room.nightData.confirmed[room.current] : false,
      ackCount: room.players.filter((p) => p.acked).length,
      marks: room.marks,
      notes: room.modNotes,
    };
  }

  if (me) {
    view.me = {
      id: me.id,
      role: me.role,
      alive: me.alive,
      loverName: me.lover ? nameOf(room, me.lover) : undefined,
      seerLog: me.seerLog.map((s) => ({ night: s.night, name: nameOf(room, s.targetId), isWolf: s.isWolf })),
      hunterTurn: room.phase === 'hunter' && room.hunterPending.includes(me.id),
    };
    const step = room.current;
    if (room.phase === 'night' && step && stepRoles(step).includes(me.role!)) {
      const nd = room.nightData;
      const turn: Record<string, unknown> = { step, confirmed: !!nd.confirmed[step], dead: !me.alive };
      if (me.alive) {
        if (step === 'bodyguard') Object.assign(turn, { lastGuard: room.lastGuard, canSelf: room.settings.guardSelf, chosen: nd.guard });
        if (step === 'wolves') {
          const preys = room.players.filter((p) => p.alive && teamOf(p.role) !== 'wolf').length;
          Object.assign(turn, { need: Math.min(room.doubleKillNight ? 2 : 1, preys), targets: nd.wolfTargets });
        }
        if (step === 'cupid') Object.assign(turn, { chosen: nd.cupid ?? [] });
        if (step === 'witch')
          Object.assign(turn, {
            victims: nd.wolfTargets.map((id) => ({ id, name: nameOf(room, id) })),
            canHeal: !room.witchHealUsed || nd.witchSave !== undefined,
            canPoison: !room.witchPoisonUsed || nd.witchPoison !== undefined,
            save: nd.witchSave,
            poison: nd.witchPoison,
          });
        if (step === 'seer') {
          const last = me.seerLog.find((s) => s.night === room.night);
          if (last) Object.assign(turn, { result: { name: nameOf(room, last.targetId), isWolf: last.isWolf } });
        }
      }
      view.turn = turn;
    }
  }
  return view;
}
