import { clamp, gauss, lerp, pick, type Rng } from "../core/rng";
import { isHarsh, isWater } from "./biomes";
import { tileAt } from "./world";
import { nearestVillage } from "./village";
import type { ActionId, Creature, GameState, Genes, Weights } from "./types";
import balance from "../../data/balance.json";

export const ACTION_NAME: Record<ActionId, string> = {
  forage: "หาอาหาร", raid: "บุกหมู่บ้าน", help: "ช่วยผู้คน",
  worship: "ร่ายรำบูชา", wander: "เร่ร่อน",
};
export const GENE_NAME = {
  size: "ขนาดกาย", speed: "ความไว", meta: "เผาผลาญ",
  aggr: "ดุร้าย", intel: "ปัญญา", coat: "ขนกันทารุณ",
} as const;

const C = balance.creature;

export const newGenes = (rng: Rng): Genes => ({
  size: 0.4 + rng() * 0.2, speed: 0.4 + rng() * 0.2, meta: 0.4 + rng() * 0.2,
  aggr: 0.35 + rng() * 0.2, intel: 0.35 + rng() * 0.2, coat: 0.35 + rng() * 0.2,
});
export const newWeights = (): Weights =>
  ({ forage: 1.0, raid: 0.5, help: 0.6, worship: 0.6, wander: 0.5 });

export const maxAge = (c: Creature) =>
  C.baseLifeTicks + C.lifePerSize * c.genes.size - C.lifePerMeta * c.genes.meta;

export function makeCreature(s: GameState, genes: Genes, w: Weights, gen: number, rng: Rng): Creature {
  const home = s.villages[0] ?? { x: balance.world.W / 2, y: balance.world.H / 2 };
  const c: Creature = {
    x: home.x + 0.5, y: home.y + 1.5, gen, genes, w,
    energy: 0.85, age: 0, act: null, tgt: null, lastAct: null, fbTimer: 0,
    eaten: 0, served: 0, alive: true, mood: 0, blink: 0, respawnIn: 0,
  };
  const t = tileAt(s.tiles, Math.round(c.x), Math.round(c.y));
  if (!t || isWater(t.biome)) {
    const land = s.tiles.filter((x) => !isWater(x.biome));
    if (land.length) { const p = pick(land, rng); c.x = p.x; c.y = p.y; }
  }
  return c;
}

/** เลือกการกระทำด้วย softmax: น้ำหนักที่เรียนมา × แรงผลักจากยีนและความหิว
 *  ปัญญาสูง = อุณหภูมิต่ำ = ตัดสินใจเด็ดขาดขึ้น ไม่สุ่มมั่ว */
function chooseAction(s: GameState, rng: Rng): ActionId {
  const c = s.creature, g = c.genes, hunger = 1 - c.energy;
  const near = nearestVillage(s, c.x, c.y) ? 1 : 0;
  const rested = c.energy > 0.3 ? 1 : 0.2;
  const score: Record<ActionId, number> = {
    forage:  c.w.forage  * (0.5 + hunger * 1.9),
    raid:    c.w.raid    * (0.25 + g.aggr * 1.5 + hunger * 0.9) * near,
    help:    c.w.help    * (0.5 + (1 - g.aggr) * 0.9) * near * rested,
    worship: c.w.worship * (0.5 + g.intel * 0.8) * near * rested,
    wander:  c.w.wander  * 0.55,
  };
  const temp = 1.25 - 0.75 * g.intel;
  const keys = Object.keys(score) as ActionId[];
  const exps = keys.map((k) => Math.exp(Math.max(score[k], 0.001) / temp));
  const sum = exps.reduce((a, b) => a + b, 0);
  let r = rng() * sum;
  for (let i = 0; i < keys.length; i++) { r -= exps[i]; if (r <= 0) return keys[i]; }
  return "wander";
}

function randLand(s: GameState, rng: Rng) {
  const land = s.tiles.filter((t) => !isWater(t.biome));
  if (!land.length) return { x: s.creature.x, y: s.creature.y };
  const t = pick(land, rng);
  return { x: t.x, y: t.y };
}

/** หาแหล่งอาหาร โดยหลีกเลี่ยงไร่นาของผู้ศรัทธา (ไม่งั้นมันแทะจนอารยธรรมล่ม) */
function bestFood(s: GameState, x: number, y: number, r: number) {
  let best = null, bv = 0.05;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const t = tileAt(s.tiles, Math.round(x) + dx, Math.round(y) + dy);
    if (!t || isWater(t.biome)) continue;
    let val = t.fert / (1 + 0.22 * Math.hypot(dx, dy));
    const nv = nearestVillage(s, t.x, t.y);
    if (nv && Math.hypot(nv.x - t.x, nv.y - t.y) < C.farmAvoidRadius) val *= C.farmAvoidFactor;
    if (val > bv) { bv = val; best = t; }
  }
  return best;
}

function startAction(s: GameState, rng: Rng) {
  const c = s.creature;
  const a = chooseAction(s, rng);
  c.act = a;
  if (a === "forage") {
    const t = bestFood(s, c.x, c.y, 3 + Math.round(c.genes.intel * 4));
    c.tgt = t ? { x: t.x, y: t.y } : randLand(s, rng);
  } else if (a === "wander") {
    c.tgt = randLand(s, rng);
  } else {
    const v = nearestVillage(s, c.x, c.y);
    c.tgt = v ? { x: v.x, y: v.y } : randLand(s, rng);
  }
}

function resolveAction(s: GameState, log: (m: string) => void) {
  const c = s.creature, g = c.genes, a = c.act;
  const t = tileAt(s.tiles, Math.round(c.x), Math.round(c.y));
  const v = t?.village ?? nearestVillage(s, c.x, c.y);
  const atVillage = v && Math.hypot(v.x - c.x, v.y - c.y) < 1.6;

  if (a === "forage" && t && !isWater(t.biome)) {
    const eat = Math.min(t.fert * C.eatFraction, C.eatBase + C.eatPerSize * g.size);
    t.fert -= eat * C.eatDepletion;
    c.energy = clamp(c.energy + eat * (C.energyPerFood - C.energyPerFoodSizePenalty * g.size), 0, 1);
    c.eaten += eat;
  } else if (a === "raid" && v && atVillage) {
    const dmg = (C.raidBase + C.raidPerAggr * g.aggr) * (0.5 + g.size) + v.pop * C.raidPerPop;
    v.pop = Math.max(C.raidFloorPop, v.pop - dmg);   // ปล้นได้ แต่ไม่ล้างเผ่าพันธุ์
    v.belief = clamp(v.belief + 0.16, 0, 1);          // ศรัทธาจากความกลัว
    s.align = clamp(s.align + balance.align.creatureRaid, -1, 1);
    c.energy = clamp(c.energy + 0.22, 0, 1);
    burst(s, v.x, v.y, "#b34a3a");
    log(`สัตว์ของท่านบุกหมู่บ้าน${v.name}`);
  } else if (a === "help" && v && atVillage) {
    v.pop += 0.9 + g.size;
    v.belief = clamp(v.belief + 0.06, 0, 1);
    s.align = clamp(s.align + balance.align.creatureHelp, -1, 1);
    c.energy = clamp(c.energy - 0.06, 0, 1); c.served++;
    burst(s, v.x, v.y, "#77c08a");
  } else if (a === "worship" && v && Math.hypot(v.x - c.x, v.y - c.y) < 1.8) {
    v.belief = clamp(v.belief + 0.10, 0, 1);
    s.faith += 5 + 9 * g.intel;
    s.align = clamp(s.align + balance.align.creatureWorship, -1, 1);
    c.energy = clamp(c.energy - 0.04, 0, 1); c.served++;
    burst(s, v.x, v.y, "#d9a437");
  }

  c.lastAct = a;
  c.fbTimer = C.feedbackWindowSeconds / balance.time.tickSeconds;
  c.act = null; c.tgt = null;
}

export function burst(s: GameState, x: number, y: number, color: string) {
  for (let i = 0; i < 9; i++)
    s.fx.push({ kind: "spark", x: x + 0.5 + (Math.random() - 0.5),
                y: y + 0.5 + (Math.random() - 0.5), t: 0, life: 0.8, color });
}

/** สอนสัตว์: ปรับน้ำหนักของ "การกระทำล่าสุด" เท่านั้น และต้องอยู่ในหน้าต่างเวลา */
export function teach(s: GameState, sign: 1 | -1, log: (m: string) => void): boolean {
  const c = s.creature;
  if (!c.alive || !c.lastAct || c.fbTimer <= 0) { log("ยังไม่มีสิ่งใดให้ตัดสิน"); return false; }
  const lr = C.learnBase + C.learnPerIntel * c.genes.intel;
  const k = c.lastAct;
  c.w[k] = clamp(c.w[k] + sign * lr, 0.05, 3);
  c.mood = sign; c.fbTimer = 0;
  burst(s, c.x, c.y, sign > 0 ? "#d9a437" : "#9a3030");
  log(sign > 0 ? `ท่านพอใจที่มัน${ACTION_NAME[k]}` : `ท่านลงโทษที่มัน${ACTION_NAME[k]}`);
  return true;
}

function die(s: GameState, rng: Rng, log: (m: string) => void) {
  const c = s.creature;
  c.alive = false;
  const fit = c.age + c.eaten * 26 + c.served * 9;
  if (!s.best || fit > s.best.fit) s.best = { genes: { ...c.genes }, w: { ...c.w }, fit };
  log(`สัตว์รุ่นที่ ${c.gen} สิ้นชีพ (คะแนนอยู่รอด ${Math.round(fit)})`);
  c.respawnIn = 2;
}

function reproduce(s: GameState, rng: Rng, log: (m: string) => void) {
  const c = s.creature, best = s.best!;
  const genes = {} as Genes;
  for (const k of Object.keys(c.genes) as (keyof Genes)[])
    genes[k] = clamp(lerp(c.genes[k], best.genes[k], C.inheritToBest) + gauss(rng) * C.mutation, 0.02, 1);
  const w = {} as Weights;
  for (const k of Object.keys(c.w) as (keyof Weights)[])
    w[k] = clamp(lerp(0.6, lerp(c.w[k], best.w[k], 0.4), 0.75), 0.05, 3);

  const deltas: string[] = [];
  for (const k of Object.keys(genes) as (keyof Genes)[]) {
    const d = genes[k] - c.genes[k];
    if (Math.abs(d) > 0.05) deltas.push((d > 0 ? "+" : "−") + GENE_NAME[k]);
  }
  const gen = c.gen + 1;
  s.creature = makeCreature(s, genes, w, gen, rng);
  log(`รุ่นที่ ${gen} ลืมตา${deltas.length ? " · " + deltas.slice(0, 2).join(" ") : ""}`);
}

export function stepCreature(s: GameState, rng: Rng, log: (m: string) => void): void {
  const c = s.creature;
  if (!c.alive) {
    if (--c.respawnIn <= 0) reproduce(s, rng, log);
    return;
  }
  const g = c.genes;
  c.age++;
  if (c.fbTimer > 0) c.fbTimer--;
  if (c.mood) c.mood *= 0.94;

  const t = tileAt(s.tiles, Math.round(c.x), Math.round(c.y));
  let drain = C.drainBase * (0.55 + g.meta) * (0.65 + g.size * 0.9);
  if (t && isHarsh(t.biome)) drain *= 1 + C.harshPenalty * (1 - g.coat);
  if (t && isWater(t.biome)) drain *= C.waterPenalty;
  c.energy -= drain;

  if (c.energy <= 0 || c.age > maxAge(c)) { die(s, rng, log); return; }
  if (!c.act) startAction(s, rng);

  if (c.tgt) {
    const dx = c.tgt.x - c.x, dy = c.tgt.y - c.y, d = Math.hypot(dx, dy);
    const sp = (0.32 + 0.55 * g.speed) * (0.55 + 0.45 * c.energy);
    if (d < 0.25) resolveAction(s, log);
    else { c.x += (dx / d) * sp; c.y += (dy / d) * sp; }
  }
  c.blink = c.blink > 0 ? c.blink - 1 : rng() < 0.06 ? 2 : 0;
}
