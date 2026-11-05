import { io } from 'socket.io-client';

// Docker/dev: ใช้โดเมนเดียวกัน · Vercel: ตั้ง VITE_SERVER_URL เป็น URL ของ game server
const SERVER_URL: string | undefined = import.meta.env.VITE_SERVER_URL || undefined;
export const socket = io(SERVER_URL as string, { transports: ['websocket', 'polling'] });

export type Reply = { ok: boolean; error?: string; code?: string; pid?: string };

export function emit(event: string, data?: unknown): Promise<Reply> {
  return new Promise((resolve) => {
    socket.timeout(8000).emit(event, data, (err: Error | null, r: Reply) =>
      resolve(err ? { ok: false, error: 'การเชื่อมต่อขัดข้อง' } : r),
    );
  });
}

export const act = (type: string, data: Record<string, unknown> = {}) => emit('act', { type, ...data });

const KEY = 'werewolf-session';
export interface Session { code: string; pid: string }
export const loadSession = (): Session | null => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    return null;
  }
};
export const saveSession = (s: Session | null) => {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
};
