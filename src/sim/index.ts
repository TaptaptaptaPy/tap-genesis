import { mulberry32, type Rng } from "../core/rng";
import { generateWorld, naturalWeather, stepLand } from "./world";
import { foundVillage, stepVillages, totalPop } from "./village";
import { makeCreature, maxAge, newGenes, newWeights, stepCreatures } from "./creature";
import { maybeStartDisaster, stepDisasters } from "./disaster";
import { checkConversions, stepRival } from "./rival";
import { isWater } from "./biomes";
import { fromPlain, looksValid, toPlain, type PlainState } from "./serialize";
import type { GameState } from "./types";
import balance from "../../data/balance.json";

export * from "./types";
export * from "./miracle";
export { ACTION_NAME, GENE_NAME, NEED_NAME, maxAge, teach, command, bodySize, petOf, recall }
  from "./creature";
export { totalPop, loyalPop, nearestVillage, maxVillages } from "./village";
export { tileAt, idx } from "./world";
export { disasterLabel } from "./disaster";
export { BIOMES, isWater, isHarsh } from "./biomes";
export { toPlain, fromPlain, looksValid, SAVE_VERSION } from "./serialize";
export type { PlainState } from "./serialize";

export interface Game { state: GameState; rng: Rng; }

export const seasonName = (s: GameState) => balance.season.names[s.season];
export const seasonTint = (s: GameState) => balance.season.tint[s.season];

export function createGame(seed: number): Game {
  const rng = mulberry32(seed);
  const state: GameState = {
    tiles: generateWorld(rng), villages: [], creatures: [], petId: -1, nextId: 1, best: null,
    faith: balance.start.faith, align: 0, know: 0, era: 0, tick: 0, year: 0, season: 0,
    dead: false, fx: [], log: [], shake: 0,
    disasters: [], lastDisasterTick: 0,
    rival: { name: balance.rival.names[0], faith: 0, align: 0, active: false, thinkCd: 1 },
    landCount: 0, seed, rngState: 0, terrainVersion: 1,
  };
  state.landCount = state.tiles.filter((t) => !isWater(t.biome)).length;
  // หมู่บ้านแรกวางบนช่องที่อุดมที่สุด
  let bestTile = null;
  for (const t of state.tiles)
    if (!isWater(t.biome) && (!bestTile || t.fert > bestTile.fert)) bestTile = t;
  if (bestTile) foundVillage(state, bestTile.x, bestTile.y, rng);

  const pet = makeCreature(state, newGenes(rng), newWeights(), 1, rng, { pet: true, owner: "player" });
  state.creatures.push(pet);
  state.petId = pet.id;

  const land = state.tiles.filter((t) => !isWater(t.biome));
  for (let i = 0; i < balance.population.startWild && land.length; i++) {
    const p = land[Math.floor(rng() * land.length)];
    const c = makeCreature(state, newGenes(rng), newWeights(), 1, rng,
                           { owner: "wild", x: p.x, y: p.y });
    // กระจายอายุตั้งต้น ไม่งั้นรุ่นก่อตั้งจะตายพร้อมกันหมดแล้วประชากรคอหัก
    c.age = Math.floor(rng() * maxAge(c) * 0.6);
    c.breedCd = Math.floor(rng() * balance.population.breedCooldownTicks);
    state.creatures.push(c);
  }
  return { state, rng };
}

/** หนึ่ง tick ของโลก — ฟังก์ชันนี้ห้ามแตะ DOM เด็ดขาด เพื่อให้ทดสอบ headless ได้ */
export function stepTick(g: Game): void {
  const s = g.state;
  if (s.dead) return;
  s.tick++;
  if (s.tick % balance.time.ticksPerYear === 0) s.year++;
  const season = Math.floor(s.tick / balance.time.ticksPerSeason) % balance.season.names.length;
  const log = (m: string) => { s.log.push(m); if (s.log.length > 60) s.log.shift(); };
  if (season !== s.season) { s.season = season; s.terrainVersion++; log(`${balance.season.names[season]}มาถึง`); }

  s.align *= balance.align.decayPerTick;   // โลกค่อยๆ ลืม — ถ้าไม่ทำอะไรเลย ท่านจะกลับสู่กลาง
  stepLand(s);
  naturalWeather(s, g.rng);
  maybeStartDisaster(s, g.rng, log);
  stepDisasters(s, g.rng, log);
  stepVillages(s, g.rng, log);
  stepCreatures(s, g.rng, log);
  stepRival(s, g.rng, log);
  checkConversions(s, log);
  if (totalPop(s) < 1 && s.faith < balance.start.deadFaithFloor) s.dead = true;
}

export function stepEffects(s: GameState, dt: number): void {
  for (let i = s.fx.length - 1; i >= 0; i--) {
    const f = s.fx[i]; f.t += dt;
    if (f.t >= f.life) s.fx.splice(i, 1);
  }
  if (s.shake > 0) s.shake = Math.max(0, s.shake - dt * 22);
}

/** เตรียม state ให้พร้อมเซฟ (เก็บสถานะตัวสุ่มไปด้วย โลกจะได้เดินต่อเหมือนเดิม) */
export function snapshot(g: Game): PlainState {
  g.state.rngState = g.rng.state;
  return toPlain(g.state);
}

export function restore(p: PlainState): Game {
  const state = fromPlain(p);
  const rng = mulberry32(state.seed);
  rng.state = state.rngState;
  return { state, rng };
}

export { looksValid as saveLooksValid };
