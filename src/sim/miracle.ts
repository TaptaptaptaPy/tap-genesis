import { clamp, type Rng } from "../core/rng";
import { isWater } from "./biomes";
import { setBiome, tileAt } from "./world";
import { addAwe, foundVillage, maxVillages, nudgeDevotion } from "./village";
import type { GameState, Tile, Village } from "./types";
import balance from "../../data/balance.json";

export type Caster = "player" | "rival";

export interface Spell {
  id: string; name: string; baseCost: number; radius: number;
  minEra: number; alignShift: number; dark: boolean; hint: string;
}

export const SPELLS: Spell[] = [
  { id: "rain",  name: "ฝน",             baseCost: 8,  radius: 2, minEra: 0, alignShift:  0.010, dark: false,
    hint: "เพิ่มความชุ่มน้ำ ดับไฟ คลายภัยแล้ง" },
  { id: "grove", name: "ป่าศักดิ์สิทธิ์", baseCost: 24, radius: 1, minEra: 0, alignShift:  0.030, dark: false,
    hint: "เปลี่ยนผืนดินเป็นป่า ยกเพดานความอุดมและให้ไม้" },
  { id: "bolt",  name: "สายฟ้า",          baseCost: 15, radius: 1, minEra: 0, alignShift: -0.055, dark: true,
    hint: "เผาผลาญทุกอย่าง ผู้คนกลัวจนศรัทธา" },
  { id: "bless", name: "พร",              baseCost: 34, radius: 2, minEra: 1, alignShift:  0.045, dark: false,
    hint: "ดินอุดม ผู้คนเพิ่ม และดึงใจหมู่บ้านมาที่ท่าน" },
  { id: "seed",  name: "ก่อเผ่า",          baseCost: 55, radius: 0, minEra: 1, alignShift:  0.010, dark: false,
    hint: "ตั้งหมู่บ้านใหม่บนแผ่นดินว่าง" },
  { id: "heal",  name: "ชำระโรค",          baseCost: 30, radius: 2, minEra: 1, alignShift:  0.050, dark: false,
    hint: "หยุดโรคระบาด และคืนแรงให้ผู้คน" },
  { id: "quake", name: "ธรณีพิโรธ",        baseCost: 48, radius: 2, minEra: 2, alignShift: -0.110, dark: true,
    hint: "แผ่นดินแยก ทำลายทั้งดินและคน" },
];

/** ธรรมะลดราคาคาถาฝ่ายเดียวกัน และขึ้นราคาฝ่ายตรงข้าม — ทำให้การเลือกข้างมีต้นทุนจริง */
export function spellCost(sp: Spell, align: number): number {
  const k = sp.dark ? (align < 0 ? 0.78 : 1.25) : (align > 0 ? 0.78 : 1.25);
  return Math.round(sp.baseCost * k);
}

function around(s: GameState, cx: number, cy: number, r: number, fn: (t: Tile, d: number) => void) {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const d = Math.hypot(dx, dy);
    if (d > r + 0.35) continue;
    const t = tileAt(s.tiles, cx + dx, cy + dy);
    if (t) fn(t, d);
  }
}

/** ทุกปาฏิหาริย์ทิ้งความประทับใจไว้กับหมู่บ้านที่เห็น และดึงใจไปหาผู้ร่าย */
function impress(s: GameState, v: Village, caster: Caster, awe: number, devotion: number) {
  addAwe(v, awe);
  nudgeDevotion(v, caster === "player" ? devotion : -devotion);
}

export function castSpell(
  s: GameState, id: string, cx: number, cy: number, rng: Rng, log: (m: string) => void,
  caster: Caster = "player",
): boolean {
  const sp = SPELLS.find((x) => x.id === id);
  if (!sp) return false;
  const align = caster === "player" ? s.align : s.rival.align;
  const cost = spellCost(sp, align);
  const purse = caster === "player" ? s.faith : s.rival.faith;
  if (purse < cost) { if (caster === "player") log("ศรัทธาไม่พอ"); return false; }
  const center = tileAt(s.tiles, cx, cy);
  if (!center) return false;

  // ตรวจเงื่อนไขก่อนหักค่าใช้จ่าย เพื่อไม่ให้ผู้เล่นเสียศรัทธาฟรี
  if (sp.id === "grove" && isWater(center.biome)) { if (caster === "player") log("ปลูกป่ากลางน้ำไม่ได้"); return false; }
  if (sp.id === "seed" && (isWater(center.biome) || center.village)) { if (caster === "player") log("ต้องเป็นแผ่นดินว่าง"); return false; }
  if (sp.id === "seed" && s.villages.length >= maxVillages(s)) {
    if (caster === "player") log("ผืนดินแน่นเกินกว่าจะตั้งหมู่บ้านใหม่แล้ว"); return false;
  }

  if (caster === "player") { s.faith -= cost; s.align = clamp(s.align + sp.alignShift, -1, 1); }
  else { s.rival.faith -= cost; s.rival.align = clamp(s.rival.align + sp.alignShift, -1, 1); }

  const N = balance.needs, RV = balance.rival;
  const who = caster === "player" ? "ท่าน" : s.rival.name;

  switch (sp.id) {
    case "rain": {
      let quenched = 0;
      around(s, cx, cy, sp.radius, (t) => {
        t.wet = Math.min(1, t.wet + 0.6);
        if (t.burn > 0) quenched++;
        t.burn = 0;
        t.blight = Math.max(0, t.blight - 0.5);
        if (t.village) impress(s, t.village, caster,
          quenched ? N.aweFromRescue : N.aweFromMiracle * 0.5, RV.devotionFromMiracle * 0.5);
      });
      for (let i = 0; i < 70; i++)
        s.fx.push({ kind: "rain", x: cx + 0.5 + (rng() - 0.5) * sp.radius * 2.2,
                    y: cy + 0.5 + (rng() - 0.5) * sp.radius * 2.2, t: rng() * 1.4, life: 1.4 });
      log(quenched ? `${who}ดับไฟด้วยสายฝน` : "ฝนโปรยลงบนผืนดิน");
      s.terrainVersion++;
      break;
    }

    case "grove":
      around(s, cx, cy, sp.radius, (t) => {
        if (isWater(t.biome) || t.biome === "MOUNT" || t.biome === "SNOW") return;
        setBiome(s, t, "FOREST");
        t.fert = t.cap; t.burn = 0; t.blight = 0;
        if (t.village) impress(s, t.village, caster, N.aweFromMiracle, RV.devotionFromMiracle);
        s.fx.push({ kind: "spark", x: t.x + 0.5, y: t.y + 0.5, t: 0, life: 1.1, color: "#8ed49a" });
      });
      log("ป่าผุดขึ้นจากดิน"); break;

    case "bolt":
      around(s, cx, cy, sp.radius, (t) => {
        if (!isWater(t.biome)) {
          t.burn = 1; t.fert *= 0.15;
          if (t.biome === "FOREST" || t.biome === "LUSH") setBiome(s, t, "ASH");
        }
        if (t.village) {
          t.village.pop *= 0.72;
          // ความกลัวก็คือศรัทธาแบบหนึ่ง — แต่มันไม่ผูกใจ
          impress(s, t.village, caster, N.aweFromMiracle * 0.8, RV.devotionFromMiracle * 0.4);
        }
      });
      s.fx.push({ kind: "bolt", x: cx + 0.5, y: cy + 0.5, t: 0, life: 0.55 });
      s.shake = Math.min(9, s.shake + 7);
      s.terrainVersion++;
      log(`สายฟ้าของ${who}ฟาดลงกลางแผ่นดิน`); break;

    case "bless":
      around(s, cx, cy, sp.radius, (t) => {
        t.fert = clamp(t.fert + 0.18, 0, 1);
        t.blight = Math.max(0, t.blight - 0.35);
        if (t.village) {
          t.village.pop *= 1.14;
          t.village.wood = Math.min(balance.needs.woodStoreMax, t.village.wood + 6);
          impress(s, t.village, caster, N.aweFromMiracle, RV.devotionFromMiracle);
        }
        s.fx.push({ kind: "spark", x: t.x + 0.5, y: t.y + 0.5, t: 0, life: 1.5, color: "#f0d38a" });
      });
      log(`พรของ${who}แผ่ปกคลุม`); break;

    case "heal": {
      let cured = 0;
      around(s, cx, cy, sp.radius, (t) => {
        if (!t.village) return;
        if (t.village.plague > 0) { t.village.plague = 0; cured++; }
        t.village.pop *= 1.05;
        impress(s, t.village, caster, cured ? N.aweFromRescue : N.aweFromMiracle, RV.devotionFromMiracle);
        s.fx.push({ kind: "spark", x: t.x + 0.5, y: t.y + 0.5, t: 0, life: 1.4, color: "#9fe0c8" });
      });
      for (let i = s.disasters.length - 1; i >= 0; i--) {
        const d = s.disasters[i];
        if (d.kind === "plague" && Math.hypot(d.x - cx, d.y - cy) <= sp.radius + 0.5) s.disasters.splice(i, 1);
      }
      log(cured ? `${who}ชำระโรคร้ายให้ผู้คน` : "แสงชำระแผ่ออกไป แต่ไม่มีโรคให้ชำระ"); break;
    }

    case "seed": {
      const v = foundVillage(s, cx, cy, rng);
      if (v) {
        v.belief = 0.6;
        v.devotion = caster === "player" ? 1 : -1;
        log(`หมู่บ้าน${v.name}ถือกำเนิด`);
        s.fx.push({ kind: "spark", x: cx + 0.5, y: cy + 0.5, t: 0, life: 1.6, color: "#f0d38a" });
      }
      break;
    }

    case "quake":
      around(s, cx, cy, sp.radius, (t) => {
        if (isWater(t.biome)) return;
        t.fert *= 0.2;
        if (t.biome !== "MOUNT" && t.biome !== "SNOW" && rng() < 0.5) setBiome(s, t, "HILL");
        if (t.village) {
          t.village.pop *= 0.45;
          t.village.shelter *= 0.4;
          impress(s, t.village, caster, N.aweFromMiracle, RV.devotionFromMiracle * 0.3);
        }
        s.fx.push({ kind: "dust", x: t.x + 0.5, y: t.y + 0.5, t: 0, life: 1.2 });
      });
      s.shake = 14;
      s.terrainVersion++;
      log(`แผ่นดินแยกด้วยพิโรธของ${who}`); break;
  }
  return true;
}
