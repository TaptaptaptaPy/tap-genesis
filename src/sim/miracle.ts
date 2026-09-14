import { clamp, type Rng } from "../core/rng";
import { BIOMES, isWater } from "./biomes";
import { tileAt } from "./world";
import { foundVillage } from "./village";
import type { GameState, Tile } from "./types";

export interface Spell {
  id: string; name: string; baseCost: number; radius: number;
  minEra: number; alignShift: number; dark: boolean;
}

export const SPELLS: Spell[] = [
  { id: "rain",  name: "ฝน",            baseCost: 8,  radius: 2, minEra: 0, alignShift:  0.010, dark: false },
  { id: "grove", name: "ป่าศักดิ์สิทธิ์", baseCost: 24, radius: 1, minEra: 0, alignShift:  0.030, dark: false },
  { id: "bolt",  name: "สายฟ้า",         baseCost: 15, radius: 1, minEra: 0, alignShift: -0.055, dark: true  },
  { id: "bless", name: "พร",            baseCost: 34, radius: 2, minEra: 1, alignShift:  0.045, dark: false },
  { id: "seed",  name: "ก่อเผ่า",        baseCost: 55, radius: 0, minEra: 1, alignShift:  0.010, dark: false },
  { id: "quake", name: "ธรณีพิโรธ",      baseCost: 48, radius: 2, minEra: 2, alignShift: -0.110, dark: true  },
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

export function castSpell(
  s: GameState, id: string, cx: number, cy: number, rng: Rng, log: (m: string) => void,
): boolean {
  const sp = SPELLS.find((x) => x.id === id);
  if (!sp) return false;
  const cost = spellCost(sp, s.align);
  if (s.faith < cost) { log("ศรัทธาไม่พอ"); return false; }
  const center = tileAt(s.tiles, cx, cy);
  if (!center) return false;

  // ตรวจเงื่อนไขก่อนหักค่าใช้จ่าย เพื่อไม่ให้ผู้เล่นเสียศรัทธาฟรี
  if (sp.id === "grove" && isWater(center.biome)) { log("ปลูกป่ากลางน้ำไม่ได้"); return false; }
  if (sp.id === "seed" && (isWater(center.biome) || center.village)) { log("ต้องเป็นแผ่นดินว่าง"); return false; }

  s.faith -= cost;
  s.align = clamp(s.align + sp.alignShift, -1, 1);

  switch (sp.id) {
    case "rain":
      around(s, cx, cy, sp.radius, (t) => {
        t.wet = Math.min(1, t.wet + 0.6); t.burn = 0;
        if (t.village) t.village.belief = clamp(t.village.belief + 0.05, 0, 1);
      });
      for (let i = 0; i < 70; i++)
        s.fx.push({ kind: "rain", x: cx + 0.5 + (rng() - 0.5) * sp.radius * 2.2,
                    y: cy + 0.5 + (rng() - 0.5) * sp.radius * 2.2, t: rng() * 1.4, life: 1.4 });
      log("ฝนโปรยลงบนผืนดิน"); break;

    case "grove":
      around(s, cx, cy, sp.radius, (t) => {
        if (isWater(t.biome) || t.biome === "MOUNT" || t.biome === "SNOW") return;
        t.biome = "FOREST"; t.cap = BIOMES.FOREST.cap; t.fert = t.cap; t.burn = 0;
        if (t.village) t.village.belief = clamp(t.village.belief + 0.09, 0, 1);
        s.fx.push({ kind: "spark", x: t.x + 0.5, y: t.y + 0.5, t: 0, life: 1.1, color: "#8ed49a" });
      });
      log("ป่าผุดขึ้นจากดิน"); break;

    case "bolt":
      around(s, cx, cy, sp.radius, (t) => {
        if (!isWater(t.biome)) {
          t.burn = 1; t.fert *= 0.15;
          if (t.biome === "FOREST" || t.biome === "LUSH") { t.biome = "ASH"; t.cap = BIOMES.ASH.cap; }
        }
        if (t.village) { t.village.pop *= 0.72; t.village.belief = clamp(t.village.belief + 0.24, 0, 1); }
      });
      s.fx.push({ kind: "bolt", x: cx + 0.5, y: cy + 0.5, t: 0, life: 0.55 });
      s.shake = Math.min(9, s.shake + 7);
      log("สายฟ้าฟาดลงกลางแผ่นดิน"); break;

    case "bless":
      around(s, cx, cy, sp.radius, (t) => {
        t.fert = clamp(t.fert + 0.18, 0, 1);
        if (t.village) { t.village.pop *= 1.14; t.village.belief = clamp(t.village.belief + 0.17, 0, 1); }
        s.fx.push({ kind: "spark", x: t.x + 0.5, y: t.y + 0.5, t: 0, life: 1.5, color: "#f0d38a" });
      });
      log("พรของท่านแผ่ปกคลุม"); break;

    case "seed": {
      const v = foundVillage(s, cx, cy, rng);
      if (v) { v.belief = 0.6; log(`หมู่บ้าน${v.name}ถือกำเนิด`);
               s.fx.push({ kind: "spark", x: cx + 0.5, y: cy + 0.5, t: 0, life: 1.6, color: "#f0d38a" }); }
      break;
    }

    case "quake":
      around(s, cx, cy, sp.radius, (t) => {
        if (isWater(t.biome)) return;
        t.fert *= 0.2;
        if (t.biome !== "MOUNT" && t.biome !== "SNOW" && rng() < 0.5) { t.biome = "HILL"; t.cap = BIOMES.HILL.cap; }
        if (t.village) { t.village.pop *= 0.45; t.village.belief = clamp(t.village.belief + 0.30, 0, 1); }
        s.fx.push({ kind: "dust", x: t.x + 0.5, y: t.y + 0.5, t: 0, life: 1.2 });
      });
      s.shake = 14;
      log("แผ่นดินแยกด้วยพิโรธของท่าน"); break;
  }
  return true;
}
