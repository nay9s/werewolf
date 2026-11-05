import http from 'http';
import { Server, Socket } from 'socket.io';
import Redis from 'ioredis';
import { randomInt } from 'crypto';
import * as G from './game';
import { recommendedDeck } from './roles';

const PORT = Number(process.env.PORT || 3000);
const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL) : null;
const rooms = new Map<string, G.Room>();
const timers = new Map<string, NodeJS.Timeout[]>();

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.end('ok');
    return;
  }
  res.statusCode = 404;
  res.end();
});
const io = new Server(server, { cors: { origin: '*' } });

// ---------- persistence ----------
function persist(room: G.Room) {
  redis?.set(`room:${room.code}`, JSON.stringify(room), 'EX', 60 * 60 * 24).catch((e) => console.error('redis', e));
}
async function loadRooms() {
  if (!redis) return;
  const keys = await redis.keys('room:*');
  for (const k of keys) {
    const raw = await redis.get(k);
    if (!raw) continue;
    const room = JSON.parse(raw) as G.Room;
    room.modConnected = false;
    room.players.forEach((p) => (p.connected = false));
    rooms.set(room.code, room);
    syncTimers(room);
  }
  console.log(`loaded ${keys.length} room(s) from redis`);
}

// ---------- broadcast & timers ----------
function broadcast(room: G.Room) {
  persist(room);
  for (const s of io.sockets.sockets.values()) {
    if (s.data.code === room.code) s.emit('state', G.viewFor(room, s.data.pid));
  }
}

function syncTimers(room: G.Room) {
  timers.get(room.code)?.forEach(clearTimeout);
  const list: NodeJS.Timeout[] = [];
  const now = Date.now();
  const later = (at: number, fn: () => void) =>
    list.push(
      setTimeout(() => {
        try {
          fn();
        } catch (e) {
          console.error(e);
        }
        after(room);
      }, Math.max(0, at - now)),
    );
  if (room.phase === 'night' && room.current && room.timerEnd) {
    later(room.timerEnd, () => G.endStep(room));
    const fake = room.nightData.fakeAt;
    const step = room.current;
    if (fake)
      later(fake, () => {
        room.nightData.fakeAt = undefined;
        room.nightData.confirmed[step] = true;
      });
  }
  if (room.phase === 'vote' && room.timerEnd) later(room.timerEnd, () => G.closeVote(room));
  timers.set(room.code, list);
}

function after(room: G.Room) {
  syncTimers(room);
  broadcast(room);
}

function newCode(): string {
  for (;;) {
    const c = String(randomInt(1000, 10000));
    if (!rooms.has(c)) return c;
  }
}

function attach(socket: Socket, room: G.Room, pid: string) {
  socket.data.code = room.code;
  socket.data.pid = pid;
  if (pid === room.modId) room.modConnected = true;
  const p = room.players.find((x) => x.id === pid);
  if (p) p.connected = true;
}

type Ack = (r: Record<string, unknown>) => void;
const safeAck = (ack: unknown): Ack => (typeof ack === 'function' ? (ack as Ack) : () => {});

io.on('connection', (socket) => {
  const run = (ack: unknown, fn: () => Record<string, unknown> | void) => {
    const reply = safeAck(ack);
    try {
      reply({ ok: true, ...(fn() ?? {}) });
    } catch (e) {
      if (e instanceof G.GameError) reply({ ok: false, error: e.message });
      else {
        console.error(e);
        reply({ ok: false, error: 'เกิดข้อผิดพลาด' });
      }
    }
  };

  socket.on('create_room', (d, ack) =>
    run(ack, () => {
      const room = G.newRoom(newCode(), d?.name);
      rooms.set(room.code, room);
      attach(socket, room, room.modId);
      after(room);
      return { code: room.code, pid: room.modId };
    }),
  );

  socket.on('join_room', (d, ack) =>
    run(ack, () => {
      const room = rooms.get(String(d?.code ?? '').trim());
      if (!room) throw new G.GameError('ไม่พบห้องนี้');
      const pid = G.joinRoom(room, d?.name);
      attach(socket, room, pid);
      after(room);
      return { code: room.code, pid };
    }),
  );

  socket.on('resume', (d, ack) =>
    run(ack, () => {
      const room = rooms.get(String(d?.code ?? ''));
      const pid = String(d?.pid ?? '');
      if (!room || (pid !== room.modId && !room.players.some((p) => p.id === pid)))
        throw new G.GameError('เซสชันหมดอายุ');
      attach(socket, room, pid);
      after(room);
    }),
  );

  socket.on('leave', (_d, ack) =>
    run(ack, () => {
      const room = rooms.get(socket.data.code);
      if (room && room.phase === 'lobby') room.players = room.players.filter((p) => p.id !== socket.data.pid);
      socket.data.code = undefined;
      socket.data.pid = undefined;
      if (room) after(room);
    }),
  );

  socket.on('act', (d, ack) =>
    run(ack, () => {
      const room = rooms.get(socket.data.code);
      if (!room) throw new G.GameError('ไม่ได้อยู่ในห้อง');
      const me: string = socket.data.pid;
      switch (d?.type) {
        case 'settings': G.updateSettings(room, me, d.settings ?? {}); break;
        case 'recommend': G.updateSettings(room, me, { deck: recommendedDeck(room.players.length) }); break;
        case 'kick': G.kick(room, me, d.pid); break;
        case 'start': G.startGame(room, me); break;
        case 'ack': G.ackRole(room, me); break;
        case 'start_night': G.startNight(room, me); break;
        case 'call_step': G.callStep(room, me, d.step); break;
        case 'end_step': if (me !== room.modId) throw new G.GameError('เฉพาะ Moderator'); G.endStep(room); break;
        case 'add_time': G.addTime(room, me, d.seconds ?? 10); break;
        case 'end_night': G.endNight(room, me); break;
        case 'night_action': G.nightAction(room, me, d.action ?? {}); break;
        case 'start_discussion': G.startDiscussion(room, me); break;
        case 'open_vote': G.openVote(room, me); break;
        case 'vote': G.castVote(room, me, d.target ?? null); break;
        case 'close_vote': G.closeVote(room, me); break;
        case 'hunter_shoot': G.hunterShoot(room, me, d.target ?? null); break;
        case 'play_again': G.playAgain(room, me); break;
        case 'mark': G.setMark(room, me, d.pid, d.tags, d.note); break;
        case 'notes': G.setNotes(room, me, d.notes); break;
        default: throw new G.GameError('คำสั่งไม่ถูกต้อง');
      }
      after(room);
    }),
  );

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.code);
    if (!room) return;
    const stillHere = [...io.sockets.sockets.values()].some(
      (s) => s.id !== socket.id && s.data.code === room.code && s.data.pid === socket.data.pid,
    );
    if (stillHere) return;
    if (socket.data.pid === room.modId) room.modConnected = false;
    const p = room.players.find((x) => x.id === socket.data.pid);
    if (p) p.connected = false;
    broadcast(room);
  });
});

loadRooms()
  .catch((e) => console.error('load failed', e))
  .finally(() => server.listen(PORT, () => console.log(`werewolf server on :${PORT}`)));
