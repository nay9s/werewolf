// ข้อมูล Role อ้างอิงกฎ Ultimate Werewolf (Bézier Games)
// ไฟล์นี้ต้องตรงกับ client/src/roles.ts
export type RoleId =
  | 'werewolf'
  | 'wolfcub'
  | 'villager'
  | 'seer'
  | 'bodyguard'
  | 'witch'
  | 'hunter'
  | 'cupid';
export type Team = 'wolf' | 'village';
export type NightStep = 'cupid' | 'bodyguard' | 'wolves' | 'seer' | 'witch';
export type Deck = Partial<Record<RoleId, number>>;

export interface RoleInfo {
  name: string;
  emoji: string;
  team: Team;
  unique: boolean;
  desc: string;
}

export const ROLES: Record<RoleId, RoleInfo> = {
  werewolf: { name: 'หมาป่า', emoji: '🐺', team: 'wolf', unique: false, desc: 'ทุกคืนตื่นพร้อมฝูง เลือกเหยื่อ 1 คน ชนะเมื่อหมาป่า ≥ คนที่เหลือ' },
  wolfcub: { name: 'ลูกหมาป่า', emoji: '🐺🍼', team: 'wolf', unique: true, desc: 'ตื่นพร้อมหมาป่า ถ้าลูกหมาป่าตาย คืนถัดไปหมาป่าได้กัด 2 คน' },
  villager: { name: 'ชาวบ้าน', emoji: '🏘️', team: 'village', unique: false, desc: 'ไม่มีพลังพิเศษ ใช้การอภิปรายและโหวตหาหมาป่า' },
  seer: { name: 'หมอดู', emoji: '🔮', team: 'village', unique: true, desc: 'ทุกคืนส่องผู้เล่น 1 คน รู้ว่าเป็นหมาป่าหรือไม่' },
  bodyguard: { name: 'บอดี้การ์ด', emoji: '🛡️', team: 'village', unique: true, desc: 'ทุกคืนป้องกัน 1 คนจากหมาป่า ห้ามเลือกคนเดิมสองคืนติด' },
  witch: { name: 'แม่มด', emoji: '🧙', team: 'village', unique: true, desc: 'มียาชุบชีวิตและยาพิษอย่างละ 1 ขวดต่อเกม ใช้ได้คืนละขวด' },
  hunter: { name: 'นายพราน', emoji: '🏹', team: 'village', unique: true, desc: 'เมื่อตาย ยิงพาผู้เล่นอื่นไปด้วย 1 คน' },
  cupid: { name: 'คิวปิด', emoji: '💘', team: 'village', unique: true, desc: 'คืนแรกเลือกคู่รัก 2 คน ถ้าคนหนึ่งตาย อีกคนตายตาม' },
};

export const ROLE_ORDER: RoleId[] = ['werewolf', 'wolfcub', 'seer', 'bodyguard', 'witch', 'hunter', 'cupid', 'villager'];

// ลำดับเรียกกลางคืน (เหมือนกันทุกคืน)
export const NIGHT_ORDER: NightStep[] = ['cupid', 'bodyguard', 'wolves', 'seer', 'witch'];

export const STEP_LABEL: Record<NightStep, string> = {
  cupid: '💘 คิวปิด (คืนแรก)',
  bodyguard: '🛡️ บอดี้การ์ด',
  wolves: '🐺 หมาป่า',
  seer: '🔮 หมอดู',
  witch: '🧙 แม่มด',
};

export function stepRoles(s: NightStep): RoleId[] {
  return s === 'wolves' ? ['werewolf', 'wolfcub'] : [s];
}

// ชุดแนะนำ: หมาป่า 1 (6–8 คน), 2 (9–11), 3 (12–15)
export function recommendedDeck(n: number): Deck {
  const d: Deck = { werewolf: n <= 8 ? 1 : n <= 11 ? 2 : n <= 15 ? 3 : Math.ceil(n / 5) };
  if (n >= 5) d.seer = 1;
  if (n >= 7) d.bodyguard = 1;
  if (n >= 9) d.hunter = 1;
  if (n >= 11) d.witch = 1;
  if (n >= 13) {
    d.wolfcub = 1;
    d.werewolf = Math.max(1, (d.werewolf ?? 1) - 1);
  }
  return d;
}
