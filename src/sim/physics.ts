import { clamp, type Rng } from "../core/rng";
import { isWater } from "./biomes";
import { setBiome, tileAt } from "./world";
import { addAwe, faithCap, nearestVillage } from "./village";
import { remember } from "./creature";
import type { CarryKind, GameState, Projectile, Tile } from "./types";
import balance from "../../data/balance.json";

/** มือหยิบของขึ้นมาแล้วขว้างได้จริง
 *
 *  เดิมมือของพระเจ้าทำได้อย่างเดียวคือชี้ว่าจะร่ายคาถาตรงไหน ซึ่งเป็นเมนูที่วาดเป็นมือ
 *  ใน Black & White มือคือ *กริยา* ไม่ใช่ตัวชี้ — หยิบก้อนหินขว้างใส่หมู่บ้านได้
 *  โดยไม่ต้องเสียศรัทธาสักหน่อย และหยิบอาหารไปวางให้คนที่หิวได้โดยไม่ต้องร่ายคาถา
 *
 *  ผลที่ตามมาคือผู้เล่นมีทางเลือกที่ไม่ผ่านระบบศรัทธาเลย ซึ่งเปลี่ยนเกมพอสมควร:
 *  ตอนศรัทธาหมด ยังทำอะไรได้อยู่ แค่ช้ากว่าและเหนื่อยกว่า
 *
 *  ทุกอย่างในไฟล์นี้อยู่ใน `src/sim/` จึงห้ามแตะ DOM และต้องสุ่มผ่าน `rng` ที่รับเข้ามาเท่านั้น
 */

const P = balance.physics;

export const CARRY_NAME: Record<CarryKind, string> = {
  rock: "ก้อนหิน", tree: "ต้นไม้", food: "อาหาร", folk: "ผู้คน",
};

/** ช่องนี้มีอะไรให้หยิบไหม — ดูจากสิ่งที่มีอยู่จริงบนช่อง ไม่ใช่รายการตายตัว */
export function whatIsAt(t: Tile | null): CarryKind | null {
  if (!t || isWater(t.biome)) return null;
  // คนมาก่อนของ ถ้ายืนบนหมู่บ้านก็ควรได้หยิบคน ไม่ใช่หยิบก้อนหินใต้บ้านเขา
  if (t.village && t.village.pop >= P.folkMinPop) return "folk";
  if (t.biome === "FOREST" || t.biome === "LUSH") return "tree";
  if (t.biome === "HILL" || t.biome === "MOUNT" || t.biome === "ASH") return "rock";
  if (t.fert >= P.grabFertNeeded) return "food";
  return null;
}

/** หยิบของจากช่อง — โลกเปลี่ยนจริงตอนหยิบ ไม่ใช่แค่ตัวเลขในมือ
 *  หยิบต้นไม้แล้วป่าตรงนั้นหายไปจริง หยิบอาหารแล้วดินตรงนั้นจางลงจริง */
export function grabAt(s: GameState, x: number, y: number, log: (m: string) => void): CarryKind | null {
  if (s.carrying) { log(`มือของท่านถือ${CARRY_NAME[s.carrying]}อยู่แล้ว`); return null; }
  const t = tileAt(s.tiles, x, y);
  const kind = whatIsAt(t);
  if (!t || !kind) { log("ตรงนั้นไม่มีอะไรให้หยิบ"); return null; }

  if (kind === "tree") setBiome(s, t, "GRASS");
  else if (kind === "food") t.fert = Math.max(0, t.fert - 0.35);
  else if (kind === "folk" && t.village) {
    // หยิบคนขึ้นมาคือเอาคนออกจากหมู่บ้านจริงๆ ไม่ใช่ภาพลวง
    t.village.pop = Math.max(1, t.village.pop - 1);
    addAwe(t.village, 0.12);
  }
  // หยิบคนขึ้นมาแล้วผู้ศรัทธาลด เพดานศรัทธาก็ลดตาม ต้องตัดทันที
  // ไม่งั้นจะมีช่วงที่ศรัทธาสูงกว่าเพดานจนกว่าจะถึง tick ถัดไป
  if (kind === "folk") s.faith = Math.min(s.faith, faithCap(s));
  s.carrying = kind;
  s.carryFrom = { x, y };
  log(`ท่านหยิบ${CARRY_NAME[kind]}ขึ้นมา`);
  return kind;
}

/** วางคืนที่เดิมโดยไม่ขว้าง */
export function dropCarry(s: GameState, log: (m: string) => void): void {
  if (!s.carrying) return;
  log(`ท่านวาง${CARRY_NAME[s.carrying]}ลง`);
  s.carrying = null;
  s.carryFrom = null;
}

/** ขว้างของที่ถืออยู่ไปยังช่องเป้าหมาย — วิถีเป็นพาราโบลา ไม่ใช่การเทเลพอร์ต */
export function throwTo(s: GameState, tx: number, ty: number, log: (m: string) => void): boolean {
  const kind = s.carrying;
  const from = s.carryFrom;
  if (!kind || !from) { log("ยังไม่ได้ถืออะไรอยู่"); return false; }

  const dx = tx + 0.5 - (from.x + 0.5);
  const dy = ty + 0.5 - (from.y + 0.5);
  const dist = Math.hypot(dx, dy) || 0.001;
  // `arc` ยืดเวลาบินให้วิถีโค้งสูงขึ้น ไม่ได้คูณความเร็วขึ้น
  // ถ้าไปคูณ vz ของจะไม่ตกตรงเป้าอีกต่อไป เพราะสมการถูกแก้ไว้ให้ตกพอดีแล้ว
  const flight = Math.min(P.maxFlight, (0.35 + dist / P.throwSpeed) * P.arc);
  const start = tileAt(s.tiles, from.x, from.y);
  const end = tileAt(s.tiles, tx, ty);

  // `z` เป็นความสูง "สัมบูรณ์" หน่วยเดียวกับ tile.h ไม่ใช่ความสูงเหนือพื้น
  // เคยเริ่มที่ 0 แล้วเทียบกับ tile.h ที่เป็น 0.58 ผลคือของตกทันทีที่ขว้างทุกครั้ง
  const z0 = (start?.h ?? 0) + 0.35;
  const zEnd = end?.h ?? 0;

  s.thrown.push({
    kind, x: from.x + 0.5, y: from.y + 0.5, z: z0,
    vx: dx / flight, vy: dy / flight,
    vz: (zEnd - z0 + 0.5 * P.gravity * flight * flight) / flight,
    age: 0,
  });
  s.carrying = null;
  s.carryFrom = null;
  log(`ท่านขว้าง${CARRY_NAME[kind]}ออกไป`);
  return true;
}

/** เดินฟิสิกส์หนึ่ง tick — เรียกจาก stepTick() เท่านั้น */
export function stepProjectiles(s: GameState, dt: number, rng: Rng, log: (m: string) => void): void {
  for (let i = s.thrown.length - 1; i >= 0; i--) {
    const p = s.thrown[i];
    p.age += dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vz -= P.gravity * dt;
    p.z += p.vz * dt;

    const t = tileAt(s.tiles, Math.floor(p.x), Math.floor(p.y));
    const groundZ = t ? t.h : -99;
    const landed = p.z <= groundZ || p.age > P.maxFlight * 1.5;
    if (!landed) continue;

    s.thrown.splice(i, 1);
    impact(s, p, t, rng, log);
  }
}

function impact(s: GameState, p: Projectile, t: Tile | null, rng: Rng, log: (m: string) => void): void {
  if (!t) return;
  const v = nearestVillage(s, p.x, p.y);
  const near = v && Math.hypot(v.x + 0.5 - p.x, v.y + 0.5 - p.y) < 1.2 ? v : null;
  const water = isWater(t.biome);

  if (water) {
    s.fx.push({ kind: "ripple", x: p.x, y: p.y, t: 0, life: 1.2 });
    if (p.kind === "folk") {
      // ทิ้งคนลงทะเลมีราคาของมัน และทุกหมู่บ้านรู้
      s.align = clamp(s.align + P.folkDrownAlign, -1, 1);
      for (const v of s.villages) addAwe(v, P.folkDrownAwe * 0.5);
      log("ท่านทิ้งผู้คนลงทะเล");
    } else log(`${CARRY_NAME[p.kind]}ตกลงกลางน้ำ`);
    return;
  }

  switch (p.kind) {
    case "rock":
      t.fert *= P.rockFertMult;
      s.fx.push({ kind: "dust", x: p.x, y: p.y, t: 0, life: 1.1 });
      s.shake = Math.min(9, s.shake + 3);
      if (near) {
        near.pop *= P.rockPopMult;
        addAwe(near, 0.25);
        s.align = clamp(s.align + P.rockAlign, -1, 1);
        log(`ก้อนหินตกใส่หมู่บ้าน${near.name}`);
      } else log("ก้อนหินกระแทกพื้น");
      // สัตว์ที่อยู่ใกล้จำได้ว่าตรงนี้อันตราย
      if (Math.hypot(s.creature.x - p.x, s.creature.y - p.y) < 2.5)
        remember(s.creature, Math.floor(p.y) * balance.world.W + Math.floor(p.x), P.rockScare, 1.4);
      break;

    case "tree":
      if (t.biome !== "MOUNT" && t.biome !== "SNOW") {
        setBiome(s, t, "FOREST");
        t.fert = t.cap;
        s.align = clamp(s.align + P.treeAlign, -1, 1);
        s.fx.push({ kind: "spark", x: p.x, y: p.y, t: 0, life: 1.3, color: "#8ed49a" });
        log("ต้นไม้ลงหลักปักฐานที่ใหม่");
      } else log("ต้นไม้ขึ้นบนหินไม่ได้");
      break;

    case "folk": {
      const home = nearestVillage(s, p.x, p.y);
      const d = home ? Math.hypot(home.x + 0.5 - p.x, home.y + 0.5 - p.y) : 99;
      if (home && d <= P.folkLandRadius) {
        home.pop += 1;
        addAwe(home, 0.15);
        s.align = clamp(s.align + P.folkMoveAlign, -1, 1);
        s.fx.push({ kind: "spark", x: p.x, y: p.y, t: 0, life: 1.1, color: "#f0d38a" });
        log(`ผู้คนเข้าไปอยู่กับหมู่บ้าน${home.name}`);
      } else {
        // ตกกลางที่ไม่มีใคร คนคนนั้นก็เดินหายไปในป่า
        s.fx.push({ kind: "dust", x: p.x, y: p.y, t: 0, life: 1 });
        log("ผู้คนหายเข้าไปในป่า");
      }
      break;
    }

    case "food":
      t.fert = clamp(t.fert + 0.3, 0, 1);
      s.fx.push({ kind: "spark", x: p.x, y: p.y, t: 0, life: 1.1, color: "#f0d38a" });
      if (near) {
        near.needs.food = clamp(near.needs.food + P.foodNeed, 0, 1);
        addAwe(near, P.foodAwe);
        s.align = clamp(s.align + P.foodAlign, -1, 1);
        log(`ผู้คนหมู่บ้าน${near.name}ได้อาหารจากมือของท่าน`);
      } else {
        // ตกไกลบ้าน สัตว์อาจมาเจอเอง
        if (Math.hypot(s.creature.x - p.x, s.creature.y - p.y) < 3)
          remember(s.creature, Math.floor(p.y) * balance.world.W + Math.floor(p.x), 0.6, 1.2);
        log("อาหารตกลงบนผืนดิน");
      }
      break;
  }
  void rng;
}
