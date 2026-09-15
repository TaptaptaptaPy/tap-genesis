import { clamp, type Rng } from "../core/rng";
import { isWater } from "./biomes";
import { setBiome, tileAt } from "./world";
import { addAwe, foundVillage, maxVillages } from "./village";
import type { GameState, Tile } from "./types";
import balance from "../../data/balance.json";

export interface Spell {
  id: string; name: string; baseCost: number; radius: number;
  alignShift: number; dark: boolean; hint: string; helps: string;
}

/** ปาฏิหาริย์ทั้งหมดใช้ได้ตั้งแต่นาทีแรก ศรัทธาคือด่านเดียวที่กั้นอยู่
 *  เดิมล็อกตามยุคด้วย ทำให้ผู้เล่นใหม่ไม่รู้ว่ามีอะไรบ้างและต้องทำยังไงถึงจะได้ */
export const SPELLS: Spell[] = [
  { id: "rain",  name: "ฝน",             baseCost: 10, radius: 2, alignShift:  0.010, dark: false,
    hint: "ดินชุ่มน้ำ ดับไฟป่า คลายภัยแล้ง", helps: "food" },
  { id: "grove", name: "ป่าศักดิ์สิทธิ์", baseCost: 28, radius: 1, alignShift:  0.030, dark: false,
    hint: "เปลี่ยนผืนดินเป็นป่า ให้ไม้และยกเพดานความอุดม", helps: "wood" },
  { id: "bless", name: "พร",              baseCost: 40, radius: 2, alignShift:  0.045, dark: false,
    hint: "ดินอุดม ผู้คนเพิ่ม และได้ไม้ไปสร้างบ้าน", helps: "shelter" },
  { id: "heal",  name: "ชำระโรค",          baseCost: 34, radius: 2, alignShift:  0.050, dark: false,
    hint: "หยุดโรคระบาด และคืนแรงให้ผู้คน", helps: "plague" },
  { id: "seed",  name: "ก่อเผ่า",          baseCost: 65, radius: 0, alignShift:  0.010, dark: false,
    hint: "ตั้งหมู่บ้านใหม่บนแผ่นดินว่าง", helps: "" },
  { id: "bolt",  name: "สายฟ้า",          baseCost: 18, radius: 1, alignShift: -0.055, dark: true,
    hint: "เผาทุกอย่าง ผู้คนกลัวจนศรัทธา แต่ไม่ผูกใจ", helps: "" },
  { id: "quake", name: "ธรณีพิโรธ",        baseCost: 55, radius: 2, alignShift: -0.110, dark: true,
    hint: "แผ่นดินแยก ทำลายทั้งดินและคน", helps: "" },
];

/** ธรรมะลดราคาคาถาฝ่ายเดียวกัน และขึ้นราคาฝ่ายตรงข้าม — การเลือกข้างจึงมีต้นทุนจริง */
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

export function castSpell(s: GameState, id: string, cx: number, cy: number,
                          rng: Rng, log: (m: string) => void): boolean {
  const sp = SPELLS.find((x) => x.id === id);
  if (!sp) return false;
  const cost = spellCost(sp, s.align);
  if (s.faith < cost) { log("ศรัทธาไม่พอ"); return false; }
  const center = tileAt(s.tiles, cx, cy);
  if (!center) return false;

  // ตรวจเงื่อนไขก่อนหักค่าใช้จ่าย เพื่อไม่ให้ผู้เล่นเสียศรัทธาฟรี
  if (sp.id === "grove" && isWater(center.biome)) { log("ปลูกป่ากลางน้ำไม่ได้"); return false; }
  if (sp.id === "seed") {
    if (isWater(center.biome) || center.village) { log("ต้องเป็นแผ่นดินว่าง"); return false; }
    if (s.villages.length >= maxVillages(s)) { log("ผืนดินแน่นเกินกว่าจะตั้งหมู่บ้านใหม่แล้ว"); return false; }
  }

  s.faith -= cost;
  s.align = clamp(s.align + sp.alignShift, -1, 1);
  const N = balance.needs;

  switch (sp.id) {
    case "rain": {
      let quenched = 0;
      around(s, cx, cy, sp.radius, (t) => {
        t.wet = Math.min(1, t.wet + 0.6);
        if (t.burn > 0) quenched++;
        t.burn = 0;
        t.blight = Math.max(0, t.blight - 0.5);
        if (t.village) addAwe(t.village, quenched ? N.aweFromRescue : N.aweFromMiracle * 0.5);
      });
      for (let i = 0; i < 90; i++)
        s.fx.push({ kind: "rain", x: cx + 0.5 + (rng() - 0.5) * sp.radius * 2.2,
                    y: cy + 0.5 + (rng() - 0.5) * sp.radius * 2.2, t: rng() * 1.4, life: 1.6 });
      log(quenched ? "สายฝนของท่านดับไฟป่า" : "ฝนโปรยลงบนผืนดิน");
      s.terrainVersion++;
      break;
    }
    case "grove":
      around(s, cx, cy, sp.radius, (t) => {
        if (isWater(t.biome) || t.biome === "MOUNT" || t.biome === "SNOW") return;
        setBiome(s, t, "FOREST");
        t.fert = t.cap; t.burn = 0; t.blight = 0;
        if (t.village) addAwe(t.village, N.aweFromMiracle);
        s.fx.push({ kind: "spark", x: t.x + 0.5, y: t.y + 0.5, t: 0, life: 1.3, color: "#8ed49a" });
      });
      log("ป่าผุดขึ้นจากดิน"); break;

    case "bless":
      around(s, cx, cy, sp.radius, (t) => {
        t.fert = clamp(t.fert + 0.2, 0, 1);
        t.blight = Math.max(0, t.blight - 0.35);
        if (t.village) {
          t.village.pop *= 1.14;
          t.village.wood = Math.min(N.woodStoreMax, t.village.wood + 8);
          addAwe(t.village, N.aweFromMiracle);
        }
        s.fx.push({ kind: "spark", x: t.x + 0.5, y: t.y + 0.5, t: 0, life: 1.6, color: "#f0d38a" });
      });
      log("พรของท่านแผ่ปกคลุม"); break;

    case "heal": {
      let cured = 0;
      around(s, cx, cy, sp.radius, (t) => {
        if (!t.village) return;
        if (t.village.plague > 0) { t.village.plague = 0; cured++; }
        t.village.pop *= 1.05;
        addAwe(t.village, cured ? N.aweFromRescue : N.aweFromMiracle);
        s.fx.push({ kind: "heal", x: t.x + 0.5, y: t.y + 0.5, t: 0, life: 1.6 });
      });
      for (let i = s.disasters.length - 1; i >= 0; i--) {
        const d = s.disasters[i];
        if (d.kind === "plague" && Math.hypot(d.x - cx, d.y - cy) <= sp.radius + 0.5) s.disasters.splice(i, 1);
      }
      log(cured ? "ท่านชำระโรคร้ายให้ผู้คน" : "แสงชำระแผ่ออกไป แต่ไม่มีโรคให้ชำระ"); break;
    }

    case "seed": {
      const v = foundVillage(s, cx, cy, rng);
      if (v) {
        v.belief = 0.6;
        log(`หมู่บ้าน${v.name}ถือกำเนิด`);
        s.fx.push({ kind: "spark", x: cx + 0.5, y: cy + 0.5, t: 0, life: 1.8, color: "#f0d38a" });
      }
      break;
    }

    case "bolt":
      around(s, cx, cy, sp.radius, (t) => {
        if (!isWater(t.biome)) {
          t.burn = 1; t.fert *= 0.15;
          if (t.biome === "FOREST" || t.biome === "LUSH") setBiome(s, t, "ASH");
        }
        if (t.village) { t.village.pop *= 0.72; addAwe(t.village, N.aweFromMiracle * 0.8); }
      });
      s.fx.push({ kind: "bolt", x: cx + 0.5, y: cy + 0.5, t: 0, life: 0.6 });
      s.shake = Math.min(9, s.shake + 7);
      s.terrainVersion++;
      log("สายฟ้าฟาดลงกลางแผ่นดิน"); break;

    case "quake":
      around(s, cx, cy, sp.radius, (t) => {
        if (isWater(t.biome)) return;
        t.fert *= 0.2;
        if (t.biome !== "MOUNT" && t.biome !== "SNOW" && rng() < 0.5) setBiome(s, t, "HILL");
        if (t.village) { t.village.pop *= 0.45; t.village.shelter *= 0.4; addAwe(t.village, N.aweFromMiracle); }
        s.fx.push({ kind: "dust", x: t.x + 0.5, y: t.y + 0.5, t: 0, life: 1.3 });
      });
      s.shake = 14;
      s.terrainVersion++;
      log("แผ่นดินแยกด้วยพิโรธของท่าน"); break;
  }
  return true;
}

/** คาถาที่ช่วยเรื่องนี้ได้ — ใช้ชี้ทางให้ผู้เล่นตอนหมู่บ้านร้องขอ */
export const spellFor = (need: string) => SPELLS.find((sp) => sp.helps === need) ?? null;
