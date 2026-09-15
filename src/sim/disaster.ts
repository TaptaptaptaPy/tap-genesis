import type { Rng } from "../core/rng";
import { isWater } from "./biomes";
import { setBiome, tileAt } from "./world";
import { nearestVillage } from "./village";
import type { Disaster, DisasterId, GameState } from "./types";
import { planDisaster } from "./director";
import balance from "../../data/balance.json";

const D = balance.disaster;

const LABEL: Record<DisasterId, string> = {
  drought: "ภัยแล้ง", wildfire: "ไฟป่า", plague: "โรคระบาด", flood: "อุทกภัย",
};


/** ชนิดกับจุดเกิดเหตุถูกย้ายไปอยู่ใน `src/sim/director.ts` ทั้งคู่
 *  ของเดิมคือ `weightedKind()` + `pickSpot()` ที่สุ่มล้วน ลบทิ้งแล้วเพราะไม่มีใครเรียก
 *  และโค้ดที่ตายแล้วอันตรายกว่าโค้ดที่หายไป — วันหนึ่งจะมีคนเรียกมันโดยไม่รู้ว่ามันไม่ใช่ทางหลัก */

export function maybeStartDisaster(s: GameState, rng: Rng, log: (m: string) => void): void {
  if (s.tick < D.graceTicks) return;   // ปล่อยให้อารยธรรมตั้งไข่ให้รอดก่อน
  if (s.tick % D.checkEveryTicks !== 0) return;
  if (s.tick - s.lastDisasterTick < D.minTicksBetween) return;

  // ผู้กำกับตัดสินว่าควรเกิดอะไรที่ไหน — ไม่ใช่สุ่มชนิดแล้วสุ่มจุด ดู src/sim/director.ts
  const plan = planDisaster(s, rng);
  if (!plan) return;
  const kind = plan.kind;
  const spot = { x: plan.x, y: plan.y };
  s.lastDisasterTick = s.tick;

  if (kind === "plague") {
    const v = nearestVillage(s, spot.x, spot.y);
    if (!v) return;
    v.plague = D.plague.durationTicks;
    s.disasters.push({ kind, x: v.x, y: v.y, ticks: D.plague.durationTicks, radius: 1, name: LABEL.plague });
    log(`โรคระบาดลงที่หมู่บ้าน${v.name}`);
    return;
  }

  if (kind === "drought") {
    const r = D.drought.radius;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.hypot(dx, dy) > r) continue;
      const t = tileAt(s.tiles, spot.x + dx, spot.y + dy);
      if (!t || isWater(t.biome)) continue;
      t.wet = 0; t.blight = 1; t.fert *= D.drought.fertMult;
    }
    s.disasters.push({ kind, x: spot.x, y: spot.y, ticks: D.drought.durationTicks, radius: r, name: LABEL.drought });
    log("แผ่นดินแตกระแหง ภัยแล้งมาเยือน");
    s.terrainVersion++;
    return;
  }

  if (kind === "wildfire") {
    const t = tileAt(s.tiles, spot.x, spot.y);
    if (!t || isWater(t.biome) || t.wet > balance.land.fireNeedsDryness) return;
    t.burn = 1;
    s.disasters.push({ kind, x: spot.x, y: spot.y, ticks: D.wildfire.durationTicks, radius: 1, name: LABEL.wildfire });
    log("ไฟป่าตั้งเค้าขึ้นกลางผืนป่า");
    return;
  }

  // น้ำท่วม: ต้องอยู่ติดน้ำถึงจะเกิด
  const near = [[1,0],[-1,0],[0,1],[0,-1]].some(([dx, dy]) => {
    const t = tileAt(s.tiles, spot.x + dx, spot.y + dy);
    return t ? isWater(t.biome) : false;
  });
  if (!near) return;
  const r = D.flood.radius;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.hypot(dx, dy) > r) continue;
    const t = tileAt(s.tiles, spot.x + dx, spot.y + dy);
    if (!t || isWater(t.biome)) continue;
    t.wet = 1; t.burn = 0;
    if (t.village) t.village.pop *= D.flood.popMult;
    s.fx.push({ kind: "ripple", x: t.x + 0.5, y: t.y + 0.5, t: 0, life: 1.6 });
  }
  s.disasters.push({ kind, x: spot.x, y: spot.y, ticks: D.flood.durationTicks, radius: r, name: LABEL.flood });
  log("น้ำหลากท่วมที่ราบ");
}

export function stepDisasters(s: GameState, rng: Rng, log: (m: string) => void): void {
  for (let i = s.disasters.length - 1; i >= 0; i--) {
    const d = s.disasters[i];
    d.ticks--;

    if (d.kind === "wildfire") spreadFire(s, d, rng);

    if (d.kind === "flood" && d.ticks === 1) {
      // น้ำลดแล้วดินดีขึ้น — ภัยพิบัติไม่ได้มีแต่ด้านร้าย
      const r = d.radius;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const t = tileAt(s.tiles, d.x + dx, d.y + dy);
        if (t && !isWater(t.biome)) t.fert = Math.min(1, t.fert + D.flood.fertAfter);
      }
      log("น้ำลดแล้ว ตะกอนทิ้งความอุดมไว้บนผืนดิน");
    }

    if (d.ticks <= 0) {
      s.disasters.splice(i, 1);
      if (d.kind === "drought") log("ภัยแล้งคลี่คลาย");
      if (d.kind === "plague") log("โรคระบาดสงบลง");
    }
  }
}

function spreadFire(s: GameState, d: Disaster, rng: Rng) {
  const L = balance.land;
  const burning = s.tiles.filter((t) => t.burn > 0.35);
  if (!burning.length) { d.ticks = Math.min(d.ticks, 1); return; }
  for (const t of burning) {
    if (t.biome === "FOREST" || t.biome === "LUSH") setBiome(s, t, "ASH");
    t.fert *= 0.9;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]] as const) {
      const n = tileAt(s.tiles, t.x + dx, t.y + dy);
      if (!n || isWater(n.biome) || n.burn > 0) continue;
      if (n.wet > L.fireNeedsDryness) continue;
      if (n.fert < 0.12) continue;
      if (rng() < L.fireSpreadChance) {
        n.burn = 1;
        s.fx.push({ kind: "dust", x: n.x + 0.5, y: n.y + 0.5, t: 0, life: 0.9 });
      }
    }
  }
}

export const disasterLabel = (k: DisasterId) => LABEL[k];
