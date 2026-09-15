import { clamp, type Rng } from "../core/rng";
import { isWater } from "./biomes";
import { setBiome, tileAt } from "./world";
import { nearestVillage } from "./village";
import type { Disaster, DisasterId, GameState, Tile } from "./types";
import balance from "../../data/balance.json";

const D = balance.disaster;

const LABEL: Record<DisasterId, string> = {
  drought: "ภัยแล้ง", wildfire: "ไฟป่า", plague: "โรคระบาด", flood: "อุทกภัย",
};

function landTiles(s: GameState): Tile[] {
  return s.tiles.filter((t) => !isWater(t.biome));
}

function weightedKind(_s: GameState, rng: Rng): DisasterId {
  const kinds: DisasterId[] = ["drought", "wildfire", "plague", "flood"];
  const w = kinds.map((k) => (D.weights as Record<string, number>)[k]);
  const sum = w.reduce((a, b) => a + b, 0);
  let r = rng() * sum;
  for (let i = 0; i < kinds.length; i++) { r -= w[i]; if (r <= 0) return kinds[i]; }
  return "drought";
}

/** เลือกจุดเกิดเหตุ โดยเอียงเข้าหาที่ที่มีคนอยู่ — ภัยที่ไม่มีใครเดือดร้อนไม่ใช่ภัย */
function pickSpot(s: GameState, rng: Rng, nearVillage: boolean): { x: number; y: number } | null {
  if (nearVillage && s.villages.length) {
    const v = s.villages[Math.floor(rng() * s.villages.length)];
    const r = 3;
    const x = clamp(Math.round(v.x + (rng() - 0.5) * r * 2), 0, balance.world.W - 1);
    const y = clamp(Math.round(v.y + (rng() - 0.5) * r * 2), 0, balance.world.H - 1);
    const t = tileAt(s.tiles, x, y);
    if (t && !isWater(t.biome)) return { x, y };
  }
  const land = landTiles(s);
  if (!land.length) return null;
  const t = land[Math.floor(rng() * land.length)];
  return { x: t.x, y: t.y };
}

export function maybeStartDisaster(s: GameState, rng: Rng, log: (m: string) => void): void {
  if (s.tick < D.graceTicks) return;   // ปล่อยให้อารยธรรมตั้งไข่ให้รอดก่อน
  if (s.tick % D.checkEveryTicks !== 0) return;
  if (s.tick - s.lastDisasterTick < D.minTicksBetween) return;
  if (rng() > D.baseChance) return;

  const kind = weightedKind(s, rng);
  const spot = pickSpot(s, rng, kind !== "wildfire");
  if (!spot) return;
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
