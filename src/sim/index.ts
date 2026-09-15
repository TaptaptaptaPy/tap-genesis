import { mulberry32, type Rng } from "../core/rng";
import { generateWorld, naturalWeather, stepLand } from "./world";
import { faithCap, foundVillage, stepVillages, totalPop } from "./village";
import { reachedGoal } from "./reign";
import { stepProjectiles } from "./physics";
import { reseedFolkIds } from "./folk";
import { makeCreature, newGenes, newWeights, stepCreature } from "./creature";
import { maybeStartDisaster, stepDisasters } from "./disaster";
import { isWater } from "./biomes";
import { fromPlain, looksValid, toPlain, type PlainState } from "./serialize";
import type { GameState } from "./types";
import balance from "../../data/balance.json";

export * from "./types";
export * from "./miracle";
export { ACTION_NAME, GENE_NAME, NEED_NAME as CREATURE_NEED_NAME, maxAge, teach, stroke, smack, command,
         bodySize, recall, watchMiracle, placeCreature } from "./creature";
export { totalPop, nearestVillage, neediestVillage, maxVillages, faithCap,
         influenceOf, inInfluence, NEED_NAME } from "./village";
export { computeReign, reachedGoal, goalBelievers, goalProgress } from "./reign";
export { grabAt, throwTo, dropCarry, whatIsAt, CARRY_NAME, carryLabel } from "./physics";
export { nearestFolk, folkTarget, JOB_NAME, reseedFolkIds } from "./folk";
export { advise, adviceEvery, VOICE_NAME } from "./advisor";
export type { Advice, Voice } from "./advisor";
export type { Reign } from "./reign";
export { tileAt, idx } from "./world";
export { disasterLabel } from "./disaster";
export { BIOMES, isWater, isHarsh, isShallow } from "./biomes";
export { toPlain, fromPlain, looksValid, SAVE_VERSION } from "./serialize";
export type { PlainState } from "./serialize";

export interface Game { state: GameState; rng: Rng; }

export function createGame(seed: number): Game {
  const rng = mulberry32(seed);
  const state: GameState = {
    tiles: generateWorld(rng), villages: [], creature: null as never, best: null,
    faith: balance.start.faith, align: 0, tick: 0, year: 0,
    dead: false, won: false, carrying: null, carryFrom: null, carryFolk: null, thrown: [],
    fx: [], log: [], shake: 0,
    disasters: [], lastDisasterTick: 0, landCount: 0,
    seed, rngState: 0, terrainVersion: 1, combos: 0, attention: 0, deceits: 0,
  };
  state.landCount = state.tiles.filter((t) => !isWater(t.biome)).length;

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
  const log = (m: string) => { s.log.push(m); if (s.log.length > 60) s.log.shift(); };

  s.align *= balance.align.decayPerTick;
  stepLand(s);
  naturalWeather(s, g.rng);
  maybeStartDisaster(s, g.rng, log);
  stepDisasters(s, g.rng, log);
  stepVillages(s, g.rng, log);
  stepCreature(s, g.rng, log);
  stepProjectiles(s, balance.time.tickSeconds, g.rng, log);

  // เพดานศรัทธาผูกกับจำนวนผู้ศรัทธา พอคนตายเพดานก็หดลง
  // ศรัทธาที่สะสมไว้ต้องหดตาม ไม่งั้นจะค้างอยู่เหนือเพดานตลอดไป (npm run sim จับเจอ)
  // นี่คือด่านเดียวที่บังคับเพดาน ทุกทางที่บวกศรัทธาจึงไม่ต้อง clamp เอง
  s.faith = Math.min(s.faith, faithCap(s));

  if (!s.won && reachedGoal(s)) {
    s.won = true;
    log("ผู้คนทั้งเกาะเอ่ยพระนามของท่านพร้อมกัน");
  }
  if (totalPop(s) < 1 && s.faith < balance.start.deadFaithFloor) s.dead = true;
}

export function stepEffects(s: GameState, dt: number): void {
  for (let i = s.fx.length - 1; i >= 0; i--) {
    const f = s.fx[i]; f.t += dt;
    if (f.t >= f.life) s.fx.splice(i, 1);
  }
  if (s.shake > 0) s.shake = Math.max(0, s.shake - dt * 22);
}

export function snapshot(g: Game): PlainState {
  g.state.rngState = g.rng.state;
  return toPlain(g.state);
}

export function restore(p: PlainState): Game {
  const state = fromPlain(p);
  // เซฟรุ่นก่อนยังไม่มี folk และ id ต้องไม่ชนกับคนที่จะเกิดใหม่หลังโหลด
  reseedFolkIds(state);
  const rng = mulberry32(state.seed);
  rng.state = state.rngState;
  return { state, rng };
}

export { looksValid as saveLooksValid };
