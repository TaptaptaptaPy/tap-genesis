import type { PlainState } from "../sim/index";

const PREFIX = "genesis:save:v2:";
export const SLOTS = ["auto", "1", "2", "3"] as const;
export type SlotId = (typeof SLOTS)[number];

export interface SaveMeta { slot: SlotId; at: number; year: number; era: string; villages: number; pop: number; }
interface Envelope { v: number; at: number; meta: Omit<SaveMeta, "slot">; state: PlainState; }

export function writeSlot(slot: SlotId, state: PlainState, meta: Omit<SaveMeta, "slot">): boolean {
  try {
    const env: Envelope = { v: 2, at: Date.now(), meta, state };
    localStorage.setItem(PREFIX + slot, JSON.stringify(env));
    return true;
  } catch { return false; }   // โควตาเต็มหรือโหมดส่วนตัว — ไม่ใช่เหตุให้เกมพัง
}

export function readSlot(slot: SlotId): { state: PlainState; meta: SaveMeta } | null {
  try {
    const raw = localStorage.getItem(PREFIX + slot);
    if (!raw) return null;
    const env = JSON.parse(raw) as Envelope;
    if (env.v !== 2 || !env.state) return null;
    return { state: env.state, meta: { ...env.meta, slot } };
  } catch { return null; }
}

export function slotMeta(slot: SlotId): SaveMeta | null {
  const r = readSlot(slot);
  return r ? r.meta : null;
}

export function clearSlot(slot: SlotId) {
  try { localStorage.removeItem(PREFIX + slot); } catch { /* ไม่เป็นไร */ }
}
