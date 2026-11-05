// ทดสอบกฎเกม: npm test
import assert from 'assert';
import * as G from './game';
import { RoleId } from './roles';

function setup(roles: RoleId[]) {
  const room = G.newRoom('1234', 'Mod');
  const ids = roles.map((_, i) => G.joinRoom(room, `P${i}`));
  room.settings.deck = { werewolf: 1 };
  room.settings.nightSeconds = 25;
  G.startGame(room, room.modId);
  room.players.forEach((p, i) => (p.role = roles[i])); // กำหนด Role ให้แน่นอนเพื่อทดสอบ
  ids.forEach((id) => G.ackRole(room, id));
  return { room, ids, mod: room.modId };
}
const by = (room: G.Room, r: RoleId) => room.players.filter((p) => p.role === r).map((p) => p.id);
const alive = (room: G.Room, id: string) => room.players.find((p) => p.id === id)!.alive;

// 1) บอดี้การ์ดกันได้ + ห้ามซ้ำคนเดิม
{
  const { room, mod, ids } = setup(['werewolf', 'bodyguard', 'seer', 'villager', 'villager', 'villager', 'villager']);
  const [wolf] = by(room, 'werewolf'), [bg] = by(room, 'bodyguard'), [seer] = by(room, 'seer');
  G.startNight(room, mod);
  assert.deepStrictEqual(G.availableSteps(room), ['bodyguard', 'wolves', 'seer']);
  G.callStep(room, mod, 'bodyguard');
  assert.throws(() => G.nightAction(room, bg, { targets: [bg] }), /ตัวเอง/);
  G.nightAction(room, bg, { targets: [ids[3]] });
  G.callStep(room, mod, 'wolves');
  assert.throws(() => G.nightAction(room, seer, { targets: [ids[3]] }), /ตาคุณ/);
  G.nightAction(room, wolf, { targets: [ids[3]], confirm: true });
  G.callStep(room, mod, 'seer');
  G.nightAction(room, seer, { targets: [wolf] });
  assert.strictEqual(room.players.find((p) => p.id === seer)!.seerLog[0].isWolf, true);
  G.endNight(room, mod);
  assert.strictEqual(alive(room, ids[3]), true, 'ป้องกันสำเร็จ');
  assert.strictEqual(room.announcement!.deaths.length, 0);
  // โหวตประหารหมาป่า → ชาวบ้านชนะ
  G.openVote(room, mod);
  for (const id of ids) if (id !== wolf) G.castVote(room, id, wolf);
  G.closeVote(room, mod);
  assert.strictEqual(room.phase, 'gameover');
  assert.strictEqual(room.winner, 'village');
  console.log('✓ bodyguard + seer + vote');
}

// 2) ลูกหมาป่าตาย → คืนถัดไปกัด 2 คน
{
  const { room, mod, ids } = setup(['werewolf', 'wolfcub', 'villager', 'villager', 'villager', 'villager', 'villager', 'villager', 'villager']);
  const [wolf] = by(room, 'werewolf'), [cub] = by(room, 'wolfcub');
  G.startNight(room, mod);
  G.callStep(room, mod, 'wolves');
  assert.throws(() => G.nightAction(room, wolf, { targets: [cub], confirm: true }), /หมาป่าด้วยกัน/);
  G.nightAction(room, cub, { targets: [ids[2]] }); // ลูกหมาป่าชี้
  G.nightAction(room, wolf, { targets: [ids[2]], confirm: true }); // หมาป่ายืนยัน
  G.endNight(room, mod);
  assert.strictEqual(alive(room, ids[2]), false);
  G.openVote(room, mod);
  for (const id of ids) if (id !== cub && alive(room, id)) G.castVote(room, id, cub);
  G.closeVote(room, mod);
  assert.strictEqual(alive(room, cub), false);
  assert.strictEqual(room.doubleKillPending, true);
  G.startNight(room, mod);
  G.callStep(room, mod, 'wolves');
  assert.throws(() => G.nightAction(room, wolf, { targets: [ids[3]], confirm: true }), /2 คน/);
  G.nightAction(room, wolf, { targets: [ids[3], ids[4]], confirm: true });
  G.endNight(room, mod);
  assert.strictEqual(room.announcement!.deaths.length, 2);
  assert.strictEqual(room.doubleKillNight, true);
  G.openVote(room, mod);
  G.closeVote(room, mod); // ไม่มีใครโหวต
  G.startNight(room, mod);
  assert.strictEqual(room.doubleKillNight, false, 'กัด 2 คนแค่คืนเดียว');
  console.log('✓ wolf cub double kill');
}

// 3) คิวปิด + คู่รักตายตาม + นายพรานยิง + แม่มด
{
  const { room, mod, ids } = setup(['werewolf', 'werewolf', 'cupid', 'hunter', 'witch', 'villager', 'villager', 'villager', 'villager']);
  const [w1, w2] = by(room, 'werewolf'), [cupid] = by(room, 'cupid'), [hunter] = by(room, 'hunter'), [witch] = by(room, 'witch');
  G.startNight(room, mod);
  assert.ok(G.availableSteps(room).includes('cupid'));
  G.callStep(room, mod, 'cupid');
  G.nightAction(room, cupid, { targets: [hunter, ids[5]] });
  G.callStep(room, mod, 'wolves');
  G.nightAction(room, w1, { targets: [hunter], confirm: true });
  G.callStep(room, mod, 'witch');
  assert.throws(() => G.nightAction(room, witch, { save: hunter, poison: ids[6] }), /คืนละขวด/);
  G.nightAction(room, witch, { poison: ids[6] });
  G.endNight(room, mod);
  // นายพรานตาย + คู่รัก (P5) ตายตาม + P6 โดนยาพิษ
  assert.deepStrictEqual(room.announcement!.deaths.map((d) => d.id).sort(), [hunter, ids[5], ids[6]].sort());
  assert.strictEqual(room.phase, 'hunter');
  G.hunterShoot(room, hunter, w2);
  assert.strictEqual(alive(room, w2), false);
  assert.strictEqual(room.phase, 'day_announce');
  G.startNight(room, mod);
  assert.ok(!G.availableSteps(room).includes('cupid'), 'คิวปิดเฉพาะคืนแรก');
  console.log('✓ cupid + lovers + hunter + witch');
}

// 4) โหวตเสมอ + revote และโหมดเปิด Role
{
  const { room, mod, ids } = setup(['werewolf', 'villager', 'villager', 'villager', 'villager', 'villager', 'villager']);
  room.settings.tie = 'revote';
  room.settings.reveal = 'team';
  G.startNight(room, mod);
  G.endNight(room, mod);
  G.openVote(room, mod);
  G.castVote(room, ids[0], ids[1]);
  G.castVote(room, ids[1], ids[0]);
  G.closeVote(room, mod);
  assert.strictEqual(room.phase, 'vote', 'revote');
  assert.deepStrictEqual(room.voteCandidates.sort(), [ids[0], ids[1]].sort());
  G.castVote(room, ids[2], ids[1]);
  G.closeVote(room, mod);
  assert.strictEqual(alive(room, ids[1]), false);
  assert.strictEqual(room.players[1].revealed, '🏘️ ฝ่ายชาวบ้าน');
  console.log('✓ tie revote + team reveal');
}

// 5) View ไม่รั่ว Role
{
  const { room, mod, ids } = setup(['werewolf', 'werewolf', 'seer', 'villager', 'villager', 'villager', 'villager']);
  const vVillager = G.viewFor(room, ids[3]) as any;
  assert.strictEqual(vVillager.players.filter((p: any) => p.role).length, 1, 'ชาวบ้านเห็นแค่ตัวเอง');
  const vWolf = G.viewFor(room, ids[0]) as any;
  assert.strictEqual(vWolf.players.filter((p: any) => p.role).length, 2, 'หมาป่าเห็นเพื่อน');
  const vMod = G.viewFor(room, mod) as any;
  assert.strictEqual(vMod.players.filter((p: any) => p.role).length, 0, 'Mod ไม่เห็น Role');
  console.log('✓ no role leaks');
}
console.log('ALL TESTS PASSED');
