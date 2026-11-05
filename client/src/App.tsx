import { useEffect, useRef, useState } from 'react';
import { socket, emit, act, loadSession, saveSession } from './net';
import type { View, PView, Turn } from './types';
import { ROLES, ROLE_ORDER, STEP_LABEL, recommendedDeck, type RoleId, type NightStep } from './roles';

// ---------- helpers ----------
let clockOffset = 0; // serverNow - Date.now()
const now = () => Date.now() + clockOffset;

function useTick(ms = 250) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((x) => x + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

let audio: AudioContext | null = null;
function beep(freq = 880) {
  try {
    audio ??= new AudioContext();
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.15, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.15);
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + 0.15);
  } catch {
    /* no audio */
  }
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const roleLabel = (r?: RoleId) => (r ? `${ROLES[r].emoji} ${ROLES[r].name}` : '');

function Timer({ end, tick }: { end?: number; tick?: boolean }) {
  useTick();
  const last = useRef(-1);
  if (!end) return null;
  const left = Math.max(0, Math.ceil((end - now()) / 1000));
  if (tick && left <= 5 && left > 0 && left !== last.current) {
    last.current = left;
    beep(left === 1 ? 1320 : 880);
  }
  return <div className={`timer ${left <= 5 ? 'urgent' : ''}`}>⏱ {fmt(left)}</div>;
}

type Toast = (msg: string) => void;
async function run(toast: Toast, p: Promise<{ ok: boolean; error?: string }>) {
  const r = await p;
  if (!r.ok) toast(r.error || 'ผิดพลาด');
  return r.ok;
}

// ---------- App ----------
export default function App() {
  const [view, setView] = useState<View | null>(null);
  const [toastMsg, setToastMsg] = useState('');
  const [connected, setConnected] = useState(socket.connected);
  const toast: Toast = (m) => {
    setToastMsg(m);
    setTimeout(() => setToastMsg(''), 3000);
  };

  useEffect(() => {
    const onState = (v: View) => {
      clockOffset = v.serverNow - Date.now();
      setView(v);
    };
    const onConnect = async () => {
      setConnected(true);
      const s = loadSession();
      if (s) {
        const r = await emit('resume', s);
        if (!r.ok) {
          saveSession(null);
          setView(null);
        }
      }
    };
    const onDisconnect = () => setConnected(false);
    socket.on('state', onState);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    if (socket.connected) onConnect();
    return () => {
      socket.off('state', onState);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  const leave = async () => {
    if (!confirm('ออกจากห้อง?')) return;
    await emit('leave');
    saveSession(null);
    setView(null);
  };

  return (
    <div className={`app ${view?.phase === 'night' ? 'is-night' : ''}`}>
      {!connected && <div className="banner">กำลังเชื่อมต่อใหม่…</div>}
      {view ? <Game v={view} toast={toast} leave={leave} /> : <Home toast={toast} />}
      {toastMsg && <div className="toast">{toastMsg}</div>}
    </div>
  );
}

// ---------- Home ----------
function Home({ toast }: { toast: Toast }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const go = async (event: string, data: object) => {
    const r = await emit(event, data);
    if (r.ok && r.code && r.pid) saveSession({ code: r.code, pid: r.pid });
    else toast(r.error || 'ผิดพลาด');
  };
  return (
    <div className="screen center">
      <h1 className="logo">🐺 Werewolf</h1>
      <p className="muted">หมู่บ้านนี้มีหมาป่าซ่อนอยู่</p>
      <div className="card stack">
        <label>ชื่อของคุณ</label>
        <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="เช่น สมชาย" />
        <label>รหัสห้อง</label>
        <input value={code} inputMode="numeric" maxLength={4} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="4 หลัก" />
        <button className="primary" disabled={!name.trim() || code.length !== 4} onClick={() => go('join_room', { name, code })}>
          เข้าร่วมห้อง
        </button>
        <div className="divider">หรือ</div>
        <button disabled={!name.trim()} onClick={() => go('create_room', { name })}>
          🎙️ สร้างห้อง (เป็น Moderator)
        </button>
      </div>
    </div>
  );
}

// ---------- Game shell ----------
function Game({ v, toast, leave }: { v: View; toast: Toast; leave: () => void }) {
  const [marksOpen, setMarksOpen] = useState(false);
  return (
    <div className="screen">
      <header className="top">
        <div>
          <b>ห้อง {v.code}</b>
          <span className="muted"> · {phaseLabel(v)}</span>
        </div>
        <div className="row">
          {v.isMod && v.phase !== 'lobby' && (
            <button className="small" onClick={() => setMarksOpen((x) => !x)}>📝 มาร์ค</button>
          )}
          <button className="small ghost" onClick={leave}>ออก</button>
        </div>
      </header>
      {!v.isMod && v.me && v.phase !== 'lobby' && <MyRoleBar v={v} />}
      {v.isMod && marksOpen && <MarksPanel v={v} toast={toast} />}
      {v.phase === 'lobby' && <Lobby v={v} toast={toast} />}
      {v.phase === 'reveal' && <Reveal v={v} toast={toast} />}
      {v.phase === 'night' && (v.isMod ? <ModNight v={v} toast={toast} /> : <PlayerNight v={v} toast={toast} />)}
      {['day_announce', 'discussion', 'vote', 'vote_result', 'hunter'].includes(v.phase) && <Day v={v} toast={toast} />}
      {v.phase === 'gameover' && <GameOver v={v} toast={toast} />}
    </div>
  );
}

function phaseLabel(v: View) {
  switch (v.phase) {
    case 'lobby': return 'รอผู้เล่น';
    case 'reveal': return 'ดู Role';
    case 'night': return `🌙 คืนที่ ${v.night}`;
    case 'gameover': return 'จบเกม';
    default: return `☀️ วันที่ ${v.day}`;
  }
}

// แถบ Role ส่วนตัว: กดค้างเพื่อดู
function MyRoleBar({ v }: { v: View }) {
  const [show, setShow] = useState(false);
  const me = v.me!;
  const mates = v.players.filter((p) => p.id !== me.id && p.role && ROLES[p.role].team === 'wolf');
  return (
    <div
      className={`rolebar ${me.alive ? '' : 'dead'}`}
      onPointerDown={() => setShow(true)}
      onPointerUp={() => setShow(false)}
      onPointerLeave={() => setShow(false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {show ? (
        <>
          <b>{roleLabel(me.role)}</b>
          {ROLES[me.role!]?.team === 'wolf' && mates.length > 0 && <span> · ฝูง: {mates.map((m) => m.name).join(', ')}</span>}
          {me.loverName && <span> · 💘 คู่รัก: {me.loverName}</span>}
        </>
      ) : (
        <span>{me.alive ? '👆 กดค้างเพื่อดู Role ของคุณ' : '💀 คุณตายแล้ว (ห้ามพูด)'}</span>
      )}
    </div>
  );
}

// ---------- Lobby ----------
function Lobby({ v, toast }: { v: View; toast: Toast }) {
  const n = v.players.length;
  const deck = v.settings.deck;
  const special = Object.values(deck).reduce((a, b) => a + (b ?? 0), 0);
  const villagers = n - special;
  const wolves = (deck.werewolf ?? 0) + (deck.wolfcub ?? 0);
  const setDeck = (r: RoleId, d: number) => {
    const next = { ...deck, [r]: Math.max(0, (deck[r] ?? 0) + d) };
    run(toast, act('settings', { settings: { deck: next } }));
  };
  const set = (s: object) => run(toast, act('settings', { settings: s }));

  const warnings: string[] = [];
  if (n < 7) warnings.push('กฎแนะนำอย่างน้อย 7 คน');
  if ((deck.werewolf ?? 0) < 1) warnings.push('ต้องมีหมาป่าอย่างน้อย 1 ตัว');
  if (villagers < 0) warnings.push(`Role เกินจำนวนผู้เล่น ${-villagers} ใบ`);
  if (wolves * 2 >= n && n > 0) warnings.push('หมาป่าต้องน้อยกว่าครึ่งของผู้เล่น');
  else if (wolves > Math.ceil(n / 4) && n > 0) warnings.push('หมาป่าเยอะ อาจได้เปรียบมาก');
  const rec = recommendedDeck(n);
  const canStart = n >= 3 && villagers >= 0 && (deck.werewolf ?? 0) >= 1 && wolves * 2 < n;

  return (
    <div className="stack">
      <div className="card center">
        <div className="muted">รหัสห้อง</div>
        <div className="code">{v.code}</div>
        <div className="muted">🎙️ Moderator: {v.modName}</div>
      </div>

      <div className="card">
        <h3>ผู้เล่น ({n})</h3>
        <div className="chips">
          {v.players.map((p) => (
            <span key={p.id} className={`chip ${p.connected ? '' : 'off'}`}>
              {p.name}
              {v.isMod && (
                <button className="x" onClick={() => run(toast, act('kick', { pid: p.id }))}>✕</button>
              )}
            </span>
          ))}
          {!n && <span className="muted">รอผู้เล่นเข้าห้อง…</span>}
        </div>
      </div>

      <div className="card">
        <div className="row between">
          <h3>ชุด Role</h3>
          {v.isMod && <button className="small" onClick={() => run(toast, act('recommend'))}>✨ ชุดแนะนำ</button>}
        </div>
        {ROLE_ORDER.map((r) => {
          const count = r === 'villager' ? villagers : deck[r] ?? 0;
          if (!v.isMod && !count) return null;
          return (
            <div key={r} className="deckrow">
              <div>
                <b>{roleLabel(r)}</b>
                <div className="muted small">{ROLES[r].desc}</div>
              </div>
              {v.isMod && r !== 'villager' ? (
                <div className="stepper">
                  <button onClick={() => setDeck(r, -1)} disabled={!count}>−</button>
                  <span>{count}</span>
                  <button onClick={() => setDeck(r, 1)} disabled={ROLES[r].unique && count >= 1}>+</button>
                </div>
              ) : (
                <span className="count">{Math.max(0, count)}{r === 'villager' && v.isMod ? ' (อัตโนมัติ)' : ''}</span>
              )}
            </div>
          );
        })}
        {v.isMod && n > 0 && (
          <div className="muted small">
            แนะนำสำหรับ {n} คน: {Object.entries(rec).map(([r, c]) => `${ROLES[r as RoleId].name} ${c}`).join(', ')}
          </div>
        )}
      </div>

      {v.isMod && (
        <div className="card stack">
          <h3>ตั้งค่า</h3>
          <Select label="ตายแล้วเปิด Role" value={v.settings.reveal} onChange={(x) => set({ reveal: x })} options={[
            ['full', 'เปิดทั้งใบ (กฎพื้นฐาน)'],
            ['team', 'เปิดแค่ฝ่าย'],
            ['day_only', 'เปิดเฉพาะคนที่ถูกโหวตตาย'],
            ['none', 'ไม่เปิดเลย'],
          ]} />
          <Select label="โหวตเสมอ" value={v.settings.tie} onChange={(x) => set({ tie: x })} options={[
            ['none', 'ไม่มีใครตาย'],
            ['revote', 'โหวตใหม่เฉพาะคนที่เสมอ'],
          ]} />
          <Num label="เวลาต่อ Role กลางคืน (วิ)" value={v.settings.nightSeconds} onChange={(x) => set({ nightSeconds: x })} />
          <Num label="เวลาอภิปราย (วิ)" value={v.settings.discussSeconds} onChange={(x) => set({ discussSeconds: x })} />
          <Num label="เวลาโหวต (วิ)" value={v.settings.voteSeconds} onChange={(x) => set({ voteSeconds: x })} />
          <Check label="บอดี้การ์ดป้องกันตัวเองได้" value={v.settings.guardSelf} onChange={(x) => set({ guardSelf: x })} />
          <Check label="คนตายดู Role ทุกคนได้" value={v.settings.deadSeeRoles} onChange={(x) => set({ deadSeeRoles: x })} />
          <Check label="Moderator เห็น Role ทุกคน" value={v.settings.modSeesRoles} onChange={(x) => set({ modSeesRoles: x })} />
        </div>
      )}

      {v.isMod ? (
        <div className="card stack">
          {warnings.map((w) => <div key={w} className="warn">⚠️ {w}</div>)}
          <button className="primary big" disabled={!canStart} onClick={() => run(toast, act('start'))}>
            🎲 สุ่ม Role และเริ่มเกม
          </button>
        </div>
      ) : (
        <div className="card center muted">รอ Moderator เริ่มเกม…</div>
      )}
    </div>
  );
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
      </select>
    </label>
  );
}
function Num({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const [val, setVal] = useState(String(value));
  useEffect(() => setVal(String(value)), [value]);
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" value={val} onChange={(e) => setVal(e.target.value)} onBlur={() => onChange(Number(val))} />
    </label>
  );
}
function Check({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="field check">
      <span>{label}</span>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

// ---------- Reveal ----------
function Reveal({ v, toast }: { v: View; toast: Toast }) {
  const [show, setShow] = useState(false);
  if (v.isMod) {
    const acked = v.mod!.ackCount;
    return (
      <div className="stack">
        <div className="card center">
          <h2>ผู้เล่นกำลังดู Role</h2>
          <div className="big-num">{acked}/{v.players.length}</div>
          <div className="chips">
            {v.players.map((p) => <span key={p.id} className={`chip ${p.acked ? 'ok' : ''}`}>{p.acked ? '✓ ' : ''}{p.name}</span>)}
          </div>
        </div>
        <button className="primary big" onClick={() => run(toast, act('start_night'))}>
          🌙 "ทุกคนหลับตา" เริ่มคืนแรก
        </button>
      </div>
    );
  }
  const me = v.me!;
  const r = ROLES[me.role!];
  const mates = v.players.filter((p) => p.id !== me.id && p.role && ROLES[p.role].team === 'wolf');
  const myAck = v.players.find((p) => p.id === me.id)?.acked;
  return (
    <div className="stack center">
      <div
        className={`rolecard ${show ? 'open' : ''} ${r.team}`}
        onPointerDown={() => setShow(true)}
        onPointerUp={() => setShow(false)}
        onPointerLeave={() => setShow(false)}
        onContextMenu={(e) => e.preventDefault()}
      >
        {show ? (
          <>
            <div className="emoji">{r.emoji}</div>
            <h2>{r.name}</h2>
            <p>{r.desc}</p>
            {mates.length > 0 && <p>🐺 ฝูงของคุณ: <b>{mates.map((m) => `${m.name} (${ROLES[m.role!].name})`).join(', ')}</b></p>}
          </>
        ) : (
          <>
            <div className="emoji">🂠</div>
            <p>กดค้างเพื่อดู Role<br />ปล่อยแล้วจะซ่อน</p>
          </>
        )}
      </div>
      <button className="primary big" disabled={myAck} onClick={() => run(toast, act('ack'))}>
        {myAck ? '✓ รับทราบแล้ว รอคนอื่น…' : 'รับทราบ'}
      </button>
    </div>
  );
}

// ---------- Night: Moderator ----------
function ModNight({ v, toast }: { v: View; toast: Toast }) {
  const m = v.mod!;
  const uncalled = m.steps.filter((s) => m.calls[s] !== 'done' && m.calls[s] !== 'active');
  const endNight = () => {
    if (uncalled.length && !confirm(`ยังไม่ได้เรียก: ${uncalled.map((s) => STEP_LABEL[s]).join(', ')}\nจบคืนเลยไหม?`)) return;
    run(toast, act('end_night'));
  };
  return (
    <div className="stack">
      <div className="card">
        <h3>ลำดับการเรียก (เรียกตามลำดับเดิมทุกคืน)</h3>
        {m.steps.map((s, i) => {
          const st = m.calls[s];
          const active = m.current === s;
          return (
            <div key={s} className={`steprow ${active ? 'active' : ''} ${st === 'done' ? 'done' : ''}`}>
              <div>
                <b>{i + 1}. {STEP_LABEL[s]}</b>
                <div className="muted small">
                  {active ? (m.confirmed ? '✅ ยืนยันแล้ว' : '⏳ กำลังเลือก…') : st === 'done' ? '✓ เสร็จแล้ว' : 'ยังไม่เรียก'}
                </div>
              </div>
              {active ? (
                <button className="small" onClick={() => run(toast, act('end_step'))}>"หลับตา"</button>
              ) : (
                <button className="small primary" onClick={() => run(toast, act('call_step', { step: s }))}>
                  {st === 'done' ? 'เรียกซ้ำ' : 'เรียก'}
                </button>
              )}
            </div>
          );
        })}
        {m.current && (
          <div className="row between">
            <Timer end={v.timerEnd} tick />
            <button className="small" onClick={() => run(toast, act('add_time', { seconds: 10 }))}>+10 วิ</button>
          </div>
        )}
        {m.current && <p className="script">🎙️ "{STEP_LABEL[m.current].replace(/^\S+ /, '')} ลืมตาขึ้นมา…"</p>}
      </div>
      <button className="primary big" onClick={endNight}>☀️ จบคืน → "ทุกคนลืมตา"</button>
    </div>
  );
}

// ---------- Night: Player ----------
function PlayerNight({ v, toast }: { v: View; toast: Toast }) {
  const t = v.turn;
  if (!t || t.dead || t.confirmed) {
    return (
      <div className="sleep">
        <div className="moon">🌙</div>
        <h2>หลับตา</h2>
        <p className="muted">{t?.confirmed ? 'บันทึกแล้ว หลับตาได้' : 'รอจนกว่า Moderator จะเรียก'}</p>
        {t?.step === 'seer' && t.result && (
          <div className={`result ${t.result.isWolf ? 'bad' : 'good'}`}>
            {t.result.name}: {t.result.isWolf ? '🐺 เป็นหมาป่า!' : '🏘️ ไม่ใช่หมาป่า'}
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="stack turn">
      <h2 className="center">{STEP_LABEL[t.step]} ตื่นได้</h2>
      <Timer end={v.timerEnd} tick />
      <TurnAction v={v} t={t} toast={toast} />
    </div>
  );
}

function Picker({ players, selected, onPick, disabled }: {
  players: PView[];
  selected: string[];
  onPick: (id: string) => void;
  disabled?: (p: PView) => string | false;
}) {
  return (
    <div className="grid">
      {players.map((p) => {
        const why = disabled?.(p) || false;
        return (
          <button key={p.id} className={`pick ${selected.includes(p.id) ? 'sel' : ''}`} disabled={!!why} onClick={() => onPick(p.id)}>
            {p.name}
            {why && <small>{why}</small>}
          </button>
        );
      })}
    </div>
  );
}

function TurnAction({ v, t, toast }: { v: View; t: Turn; toast: Toast }) {
  const me = v.me!;
  const alive = v.players.filter((p) => p.alive);
  const [sel, setSel] = useState<string[]>([]);
  const send = (action: object) => run(toast, act('night_action', { action }));
  const one = (id: string) => setSel([id]);

  switch (t.step) {
    case 'cupid':
      return (
        <>
          <p className="center">เลือกคู่รัก 2 คน</p>
          <Picker players={alive} selected={sel} onPick={(id) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id].slice(-2)))} />
          <button className="primary big" disabled={sel.length !== 2} onClick={() => send({ targets: sel })}>💘 ยืนยัน</button>
        </>
      );
    case 'bodyguard':
      return (
        <>
          <p className="center">เลือกคนที่จะป้องกันคืนนี้</p>
          <Picker players={alive} selected={sel} onPick={one} disabled={(p) =>
            p.id === t.lastGuard ? 'ป้องกันเมื่อคืนแล้ว' : p.id === me.id && !t.canSelf ? 'ตัวเอง' : false} />
          <button className="primary big" disabled={sel.length !== 1} onClick={() => send({ targets: sel })}>🛡️ ป้องกัน</button>
        </>
      );
    case 'wolves': {
      const need = t.need ?? 1;
      const targets = t.targets ?? [];
      const toggle = (id: string) => {
        const next = targets.includes(id) ? targets.filter((x) => x !== id) : [...targets, id].slice(-need);
        send({ targets: next });
      };
      return (
        <>
          <p className="center">
            {need > 1 ? <b className="bad">🩸 ลูกหมาป่าตาย! คืนนี้กัดได้ {need} คน</b> : 'ฝูงเลือกเหยื่อร่วมกัน'}
            <br /><span className="muted small">เพื่อนหมาป่าเห็นสิ่งที่คุณชี้ทันที</span>
          </p>
          <Picker players={alive} selected={targets} onPick={toggle} disabled={(p) => (p.role && ROLES[p.role].team === 'wolf' ? '🐺' : false)} />
          <button className="primary big" disabled={targets.length !== need} onClick={() => send({ targets, confirm: true })}>🐺 ยืนยันเหยื่อ</button>
        </>
      );
    }
    case 'seer':
      return (
        <>
          <p className="center">เลือกคนที่จะส่อง</p>
          <Picker players={alive.filter((p) => p.id !== me.id)} selected={sel} onPick={one} />
          <button className="primary big" disabled={sel.length !== 1} onClick={() => send({ targets: sel })}>🔮 ส่อง</button>
          {me.seerLog.length > 0 && (
            <div className="card small">
              {me.seerLog.map((s, i) => <div key={i}>คืน {s.night}: {s.name} → {s.isWolf ? '🐺 หมาป่า' : '🏘️ ไม่ใช่'}</div>)}
            </div>
          )}
        </>
      );
    case 'witch':
      return <WitchAction v={v} t={t} send={send} />;
  }
}

function WitchAction({ v, t, send }: { v: View; t: Turn; send: (a: object) => void }) {
  const [poison, setPoison] = useState<string[]>([]);
  const victims = t.victims ?? [];
  return (
    <>
      <div className="card">
        <b>คืนนี้หมาป่ากัด:</b> {victims.length ? victims.map((x) => x.name).join(', ') : 'ยังไม่มี'}
      </div>
      {t.canHeal && victims.map((x) => (
        <button key={x.id} className="big" onClick={() => send({ save: x.id })}>💚 ใช้ยาชุบชีวิต {x.name}</button>
      ))}
      {!t.canHeal && <p className="muted center">ยาชุบชีวิตใช้ไปแล้ว</p>}
      {t.canPoison ? (
        <>
          <p className="center">หรือเลือกคนที่จะวางยาพิษ</p>
          <Picker players={v.players.filter((p) => p.alive && p.id !== v.me!.id)} selected={poison} onPick={(id) => setPoison([id])} />
          <button className="big danger" disabled={!poison.length} onClick={() => send({ poison: poison[0] })}>☠️ วางยาพิษ</button>
        </>
      ) : (
        <p className="muted center">ยาพิษใช้ไปแล้ว</p>
      )}
      <button className="big ghost" onClick={() => send({})}>ไม่ใช้ยาคืนนี้</button>
    </>
  );
}

// ---------- Day ----------
function Day({ v, toast }: { v: View; toast: Toast }) {
  const a = v.announcement;
  const alive = v.players.filter((p) => p.alive);
  return (
    <div className="stack">
      {a && (
        <div className="card">
          <h2>{a.title}</h2>
          {a.deaths.length === 0 ? (
            <p>🌅 ไม่มีใครตาย</p>
          ) : (
            a.deaths.map((d) => (
              <p key={d.id} className="death">
                💀 <b>{d.name}</b> {d.cause === 'lover' ? 'ตรอมใจตายตามคู่รัก' : d.cause === 'hunter' ? 'ถูกนายพรานยิง' : 'ตาย'}
                {d.revealed ? <> — {d.revealed}</> : <span className="muted"> (ไม่เปิด Role)</span>}
              </p>
            ))
          )}
        </div>
      )}

      {v.voteResult && v.phase !== 'day_announce' && v.phase !== 'discussion' && <VoteResultCard r={v.voteResult} />}

      {v.phase === 'hunter' && <HunterCard v={v} toast={toast} />}

      {v.phase === 'discussion' && (
        <div className="card center">
          <h3>🗣️ อภิปราย</h3>
          <Timer end={v.timerEnd} />
          <p className="muted small">คนตายห้ามพูด</p>
        </div>
      )}

      {v.phase === 'vote' && v.vote && (
        <div className="card">
          <div className="row between">
            <h3>🗳️ โหวตประหาร</h3>
            <Timer end={v.timerEnd} tick />
          </div>
          <p className="muted small">โหวตลับ เปิดผลพร้อมกันเมื่อหมดเวลา · โหวตแล้ว {v.vote.votedCount}/{v.vote.voterCount}</p>
          {v.me?.alive ? (
            <Picker
              players={v.players.filter((p) => v.vote!.candidates.includes(p.id))}
              selected={v.vote.myVote ? [v.vote.myVote] : []}
              onPick={(id) => run(toast, act('vote', { target: v.vote!.myVote === id ? null : id }))}
              disabled={(p) => (p.id === v.me!.id ? 'ตัวเอง' : false)}
            />
          ) : (
            !v.isMod && <p className="muted">คุณตายแล้ว โหวตไม่ได้</p>
          )}
        </div>
      )}

      {v.isMod && (
        <div className="stack">
          {v.phase === 'day_announce' && (
            <>
              <button className="primary big" onClick={() => run(toast, act('start_discussion'))}>🗣️ เริ่มอภิปราย ({fmt(v.settings.discussSeconds)})</button>
              <button className="big" onClick={() => run(toast, act('open_vote'))}>🗳️ ข้ามไปโหวต</button>
            </>
          )}
          {v.phase === 'discussion' && (
            <>
              <button className="small" onClick={() => run(toast, act('add_time', { seconds: 60 }))}>+60 วิ</button>
              <button className="primary big" onClick={() => run(toast, act('open_vote'))}>🗳️ เปิดโหวต</button>
            </>
          )}
          {v.phase === 'vote' && <button className="primary big" onClick={() => run(toast, act('close_vote'))}>⏹ ปิดโหวตและเปิดผล</button>}
          {v.phase === 'vote_result' && <button className="primary big" onClick={() => run(toast, act('start_night'))}>🌙 เข้าสู่กลางคืน</button>}
          {['day_announce', 'discussion'].includes(v.phase) && (
            <button className="ghost" onClick={() => confirm('ข้ามวันนี้ไปกลางคืนเลย?') && run(toast, act('start_night'))}>ข้ามไปกลางคืน</button>
          )}
        </div>
      )}

      <div className="card">
        <h3>ยังมีชีวิต ({alive.length})</h3>
        <div className="chips">
          {v.players.map((p) => (
            <span key={p.id} className={`chip ${p.alive ? '' : 'deadchip'} ${p.connected ? '' : 'off'}`}>
              {p.alive ? '' : '💀 '}{p.name}
              {p.revealed && <small> {p.revealed}</small>}
              {!p.revealed && p.role && (v.isMod || !p.alive || !v.me?.alive) && <small> {ROLES[p.role].emoji}</small>}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function VoteResultCard({ r }: { r: NonNullable<View['voteResult']> }) {
  return (
    <div className="card">
      <h3>ผลโหวต</h3>
      <p><b>{r.note}</b></p>
      {r.tally.map((t) => <div key={t.id} className="bar"><span>{t.name}</span><b>{t.count}</b></div>)}
      <details>
        <summary className="muted small">ใครโหวตใคร</summary>
        {r.lines.map((l, i) => <div key={i} className="small">{l.voter} → {l.target ?? '(ไม่โหวต)'}</div>)}
      </details>
    </div>
  );
}

function HunterCard({ v, toast }: { v: View; toast: Toast }) {
  const [sel, setSel] = useState<string[]>([]);
  if (!v.me?.hunterTurn) return <div className="card center">🏹 นายพรานกำลังเล็งปืน…</div>;
  return (
    <div className="card stack">
      <h3>🏹 คุณคือนายพราน ยิงพาใครไปด้วย?</h3>
      <Picker players={v.players.filter((p) => p.alive)} selected={sel} onPick={(id) => setSel([id])} />
      <button className="danger big" disabled={!sel.length} onClick={() => run(toast, act('hunter_shoot', { target: sel[0] }))}>ยิง</button>
      <button className="ghost" onClick={() => run(toast, act('hunter_shoot', { target: null }))}>ไม่ยิง</button>
    </div>
  );
}

// ---------- Game over ----------
function GameOver({ v, toast }: { v: View; toast: Toast }) {
  return (
    <div className="stack">
      <div className={`card center win ${v.winner}`}>
        <div className="emoji">{v.winner === 'wolf' ? '🐺' : '🏘️'}</div>
        <h1>{v.winner === 'wolf' ? 'ฝ่ายหมาป่าชนะ!' : 'ฝ่ายชาวบ้านชนะ!'}</h1>
      </div>
      <div className="card">
        <h3>Role ทุกคน</h3>
        {v.players.map((p) => (
          <div key={p.id} className="deckrow">
            <span>{p.alive ? '' : '💀 '}{p.name}{p.lover ? ' 💘' : ''}</span>
            <b>{roleLabel(p.role)}</b>
          </div>
        ))}
      </div>
      {v.log && (
        <div className="card">
          <h3>ไทม์ไลน์</h3>
          {v.log.map((l, i) => <p key={i} className="small">{l}</p>)}
        </div>
      )}
      {v.isMod && <button className="primary big" onClick={() => run(toast, act('play_again'))}>🔁 เล่นอีกรอบ</button>}
    </div>
  );
}

// ---------- Moderator marks ----------
const TAGS = ['⚠️ น่าสงสัย', '🎯 ถูกเลือก', '🛡️ ถูกป้อง', '🔮 ถูกส่อง', '💀 ตาย', '🔇 ห้ามพูด', '⭐ ไฮไลต์'];

function MarksPanel({ v, toast }: { v: View; toast: Toast }) {
  const marks = v.mod!.marks;
  const [notes, setNotes] = useState(v.mod!.notes);
  return (
    <div className="card marks">
      <h3>📝 แผงมาร์ค (ผู้เล่นไม่เห็น)</h3>
      {v.players.map((p) => {
        const m = marks[p.id] ?? { tags: [], note: '' };
        const save = (tags: string[], note: string) => run(toast, act('mark', { pid: p.id, tags, note }));
        return (
          <div key={p.id} className="markrow">
            <b className={p.alive ? '' : 'muted'}>{p.name}{p.role ? ` ${ROLES[p.role].emoji}` : ''}</b>
            <div className="tags">
              {TAGS.map((t) => (
                <button key={t} className={`tag ${m.tags.includes(t) ? 'on' : ''}`}
                  onClick={() => save(m.tags.includes(t) ? m.tags.filter((x) => x !== t) : [...m.tags, t], m.note)}>
                  {t.split(' ')[0]}
                </button>
              ))}
            </div>
            <input defaultValue={m.note} placeholder="โน้ต…" onBlur={(e) => e.target.value !== m.note && save(m.tags, e.target.value)} />
          </div>
        );
      })}
      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => run(toast, act('notes', { notes }))} placeholder="โน้ตรวม เช่น คืน 2: …" />
    </div>
  );
}

export type { NightStep };
