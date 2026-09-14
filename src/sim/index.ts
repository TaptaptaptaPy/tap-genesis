import { mulberry32, type Rng } from "../core/rng";
import { generateWorld, stepLand } from "./world";
import { foundVillage, stepVillages, totalPop } from "./village";
import { makeCreature, newGenes, newWeights, stepCreature } from "./creature";
import { isWater } from "./biomes";
import type { GameState } from "./types";
import balance from "../../data/balance.json";

export * from "./types";
export * from "./miracle";
export { ACTION_NAME, GENE_NAME, maxAge, teach } from "./creature";
export { totalPop, nearestVillage } from "./village";
export { tileAt } from "./world";
export { BIOMES, isWater, isHarsh } from "./biomes";

export interface Game { state: GameState; rng: Rng; }

export function createGame(seed: number): Game {
  const rng = mulberry32(seed);
  const state: GameState = {
    tiles: generateWorld(rng), villages: [], creature: null as never, best: null,
    faith: balance.start.faith, align: 0, know: 0, era: 0, tick: 0, year: 0,
    dead: false, fx: [], log: [], shake: 0,
  };
  // หมู่บ้านแรกวางบนช่องที่อุดมที่สุด
  let bestTile = null;
  for (const t of state.tiles)
    if (!isWater(t.biome) && (!bestTile || t.fert > bestTile.fert)) bestTile = t;
  if (bestTile) foundVillage(state, bestTile.x, bestTile.y, rng);
  state.creature = makeCreature(state, newGenes(rng), newWeights(), 1, rng);
  return { state, rng };
}

/** หนึ่ง tick ของโลก — ฟังก์ชันนี้ห้ามแตะ DOM เด็ดขาด เพื่อให้ทดสอบ headless ได้ */
export function stepTick(g: Game): void {
  const s = g.state;
  if (s.dead) return;
  s.tick++;
  if (s.tick % balance.time.ticksPerYear === 0) s.year++;
  const log = (m: string) => { s.log.push(m); if (s.log.length > 40) s.log.shift(); };
  s.align *= balance.align.decayPerTick;   // โลกค่อยๆ ลืม — ถ้าไม่ทำอะไรเลย ท่านจะกลับสู่กลาง
  stepLand(s.tiles);
  stepVillages(s, g.rng, log);
  stepCreature(s, g.rng, log);
  if (totalPop(s) < 1 && s.faith < balance.start.deadFaithFloor) s.dead = true;
}

export function stepEffects(s: GameState, dt: number): void {
  for (let i = s.fx.length - 1; i >= 0; i--) {
    const f = s.fx[i]; f.t += dt;
    if (f.t >= f.life) s.fx.splice(i, 1);
  }
  if (s.shake > 0) s.shake = Math.max(0, s.shake - dt * 22);
}
