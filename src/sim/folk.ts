import { clamp, pick, type Rng } from "../core/rng";
import { isWater } from "./biomes";
import { tileAt } from "./world";
import type { Folk, FolkJob, GameState, Village } from "./types";
import balance from "../../data/balance.json";

/** ชาวบ้านรายคน
 *
 *  เดิมชาวบ้านเป็นภาพที่ `villagers3d.ts` คำนวณจาก `v.pop` ด้วยแฮช
 *  แปลว่าคนที่เห็นบนจอไม่มีตัวตนใน `src/sim/` เลย และ "หยิบคน" ก็หมายถึง
 *  หยิบคนนิรนามออกจากตัวเลข ไม่ใช่หยิบคนที่เราเพิ่งมองอยู่
 *
 *  พอเขามีชื่อ ประโยค "ท่านทิ้งสมรลงทะเล" ก็หนักกว่า "ท่านทิ้งผู้คนลงทะเล" มาก
 *  ซึ่งคือทั้งหมดที่ระบบนี้พยายามทำ
 *
 *  ราคาที่จ่าย: state ใหญ่ขึ้นและ tick หนักขึ้นเล็กน้อย จึงคุมจำนวนไว้ที่
 *  `folk.maxPerVillage` ต่อหมู่บ้าน และเดินด้วยเลขคณิตธรรมดาไม่มีการหาเส้นทาง
 */

const F = balance.folk;

const FIRST = ["สมร", "บัว", "แก้ว", "จัน", "พุด", "คำ", "อ้อย", "เพ็ญ", "มั่น", "เที่ยง",
               "หว่าง", "ผล", "เขียว", "ทอง", "แดง", "สาย", "ปั่น", "ริน"];

let nextId = 1;

export const JOB_NAME: Record<FolkJob, string> = {
  farm: "ออกไปทำไร่", wood: "ไปหาไม้", build: "ซ่อมบ้าน",
  pray: "บูชาท่าน", idle: "ยืนรออยู่เฉยๆ", sick: "นอนซม",
};

function makeFolk(v: Village, rng: Rng): Folk {
  const a = rng() * Math.PI * 2;
  const r = 0.4 + rng() * 0.8;
  return {
    id: nextId++,
    name: pick(FIRST, rng),
    x: v.x + 0.5 + Math.cos(a) * r,
    y: v.y + 0.5 + Math.sin(a) * r,
    tx: v.x + 0.5, ty: v.y + 0.5,
    job: "idle",
    rest: Math.floor(rng() * F.restTicks),
  };
}

/** จำนวนคนที่ควรมีในหมู่บ้านนี้ */
export const folkTarget = (v: Village) =>
  Math.min(F.maxPerVillage, Math.max(1, Math.round(v.pop / F.perPop)));

/** งานของคนคนนี้ตอนนี้ — มาจากสภาพหมู่บ้านล้วน ไม่ได้สุ่ม */
function jobFor(v: Village, i: number): FolkJob {
  if (v.plague > 0) return "sick";
  if (v.awe > 0.35) return "pray";
  const worst = Math.min(v.needs.food, v.needs.wood, v.needs.shelter);
  if (worst > 0.72) return i % 3 === 0 ? "wood" : "farm";
  if (v.needs.food <= worst) return "farm";
  if (v.needs.wood <= worst) return "wood";
  if (v.needs.shelter <= worst) return "build";
  return "idle";
}

/** ที่ที่งานนั้นพาไป */
function targetFor(s: GameState, v: Village, f: Folk, rng: Rng) {
  const cx = v.x + 0.5, cy = v.y + 0.5;
  if (f.job === "sick" || f.job === "build") {
    const a = rng() * Math.PI * 2;
    return { x: cx + Math.cos(a) * 0.9, y: cy + Math.sin(a) * 0.9 };
  }
  if (f.job === "pray") {
    const a = rng() * Math.PI * 2;
    return { x: cx + Math.cos(a) * 1.3, y: cy + Math.sin(a) * 1.3 };
  }
  if (f.job === "idle") {
    const a = rng() * Math.PI * 2;
    return { x: cx + Math.cos(a) * (1.2 + rng()), y: cy + Math.sin(a) * (1.2 + rng()) };
  }
  // ทำไร่หรือหาไม้ — เดินออกไปช่องที่มีของจริงถ้าหาเจอ
  const want = f.job === "wood" ? "FOREST" : null;
  let best: { x: number; y: number } | null = null, bv = -1;
  const R = Math.ceil(F.workRadius);
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const t = tileAt(s.tiles, v.x + dx, v.y + dy);
    if (!t || isWater(t.biome)) continue;
    const score = want ? (t.biome === want ? 1 : 0) + t.fert * 0.2 : t.fert;
    const jitter = score + rng() * 0.25;
    if (jitter > bv) { bv = jitter; best = { x: t.x + 0.5, y: t.y + 0.5 }; }
  }
  return best ?? { x: cx, y: cy };
}

/** เดินคนในหมู่บ้านหนึ่ง tick — เรียกจาก `stepVillages()` เท่านั้น */
export function stepFolk(s: GameState, v: Village, rng: Rng): void {
  const want = folkTarget(v);
  while (v.folk.length < want) v.folk.push(makeFolk(v, rng));
  if (v.folk.length > want) v.folk.length = want;

  for (let i = 0; i < v.folk.length; i++) {
    const f = v.folk[i];
    if (f.rest > 0) { f.rest--; continue; }

    const dx = f.tx - f.x, dy = f.ty - f.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.12) {
      // ถึงที่แล้ว พักแป๊บนึงแล้วค่อยหางานใหม่
      f.rest = 6 + Math.floor(rng() * F.restTicks);
      f.job = jobFor(v, i);
      const t = targetFor(s, v, f, rng);
      f.tx = t.x; f.ty = t.y;
      continue;
    }
    const step = Math.min(d, F.walkSpeed);
    f.x += (dx / d) * step;
    f.y += (dy / d) * step;
  }
}

/** คนที่อยู่ใกล้จุดนี้ที่สุดในหมู่บ้าน — ใช้ตอนมือลงไปหยิบ */
export function nearestFolk(v: Village, x: number, y: number): Folk | null {
  let best: Folk | null = null, bd = Infinity;
  for (const f of v.folk) {
    const d = Math.hypot(f.x - x, f.y - y);
    if (d < bd) { bd = d; best = f; }
  }
  return best;
}

/** เอาคนออกจากหมู่บ้าน คืนตัวคนนั้นไป */
export function takeFolk(v: Village, f: Folk): Folk | null {
  const i = v.folk.indexOf(f);
  if (i < 0) return null;
  v.folk.splice(i, 1);
  v.pop = Math.max(1, v.pop - 1);
  return f;
}

/** วางคนลงในหมู่บ้าน — คนเดิม ชื่อเดิม */
export function putFolk(v: Village, f: Folk): void {
  f.x = clamp(v.x + 0.5, 0, 999);
  f.y = clamp(v.y + 0.5, 0, 999);
  f.tx = f.x; f.ty = f.y;
  f.job = "idle";
  f.rest = 4;
  if (v.folk.length < F.maxPerVillage) v.folk.push(f);
  v.pop += 1;
}

/** โหลดเซฟเก่าที่ยังไม่มี `folk` — กัน id ชนกับของใหม่ */
export function reseedFolkIds(s: GameState): void {
  let max = 0;
  for (const v of s.villages) {
    if (!Array.isArray(v.folk)) v.folk = [];
    for (const f of v.folk) if (f.id > max) max = f.id;
  }
  nextId = Math.max(nextId, max + 1);
}
