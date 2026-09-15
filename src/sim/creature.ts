import { clamp, gauss, lerp, pick, type Rng } from "../core/rng";
import { isHarsh, isShallow, isWater } from "./biomes";
import { idx, tileAt } from "./world";
import { addAwe, nearestVillage, nudgeDevotion } from "./village";
import type { ActionId, Command, Creature, GameState, Genes, NeedId, Weights } from "./types";
import balance from "../../data/balance.json";

export const ACTION_NAME: Record<ActionId, string> = {
  forage: "หาอาหาร", raid: "บุกหมู่บ้าน", help: "ช่วยผู้คน",
  worship: "ร่ายรำบูชา", wander: "เร่ร่อน",
};
export const GENE_NAME: Record<keyof Genes, string> = {
  size: "ขนาดกาย", speed: "ความไว", meta: "เผาผลาญ",
  aggr: "ดุร้าย", intel: "ปัญญา", coat: "ขนกันทารุณ",
};
export const NEED_NAME: Record<NeedId, string> = {
  hungry: "หิว", tired: "เหนื่อย", bored: "เบื่อ", hurt: "เจ็บ", content: "สบายดี",
};

const C = balance.creature;
const M = balance.memory;
const P = balance.pet;
const POP = balance.population;

export const newGenes = (rng: Rng): Genes => ({
  size: 0.4 + rng() * 0.2, speed: 0.4 + rng() * 0.2, meta: 0.4 + rng() * 0.2,
  aggr: 0.35 + rng() * 0.2, intel: 0.35 + rng() * 0.2, coat: 0.35 + rng() * 0.2,
});
export const newWeights = (): Weights =>
  ({ forage: 1.0, raid: 0.5, help: 0.6, worship: 0.6, wander: 0.5 });

/** ขนาดที่เห็นจริง = ยีน + สิ่งที่มันกินมาทั้งชีวิต */
export const bodySize = (c: Creature) => clamp(c.genes.size + c.grow, 0.05, 1.5);
export const maxAge = (c: Creature) =>
  C.baseLifeTicks + C.lifePerSize * c.genes.size - C.lifePerMeta * c.genes.meta;

export const petOf = (s: GameState): Creature | null =>
  s.creatures.find((c) => c.id === s.petId) ?? null;

export function makeCreature(
  s: GameState, genes: Genes, w: Weights, gen: number, rng: Rng,
  opts: { pet?: boolean; owner?: Creature["owner"]; x?: number; y?: number } = {},
): Creature {
  const home = s.villages[0] ?? { x: balance.world.W / 2, y: balance.world.H / 2 };
  const c: Creature = {
    id: s.nextId++,
    x: opts.x ?? home.x + 0.5, y: opts.y ?? home.y + 1.5,
    gen, genes, w, mem: {},
    energy: 0.85, age: 0, act: null, tgt: null, lastAct: null, lastTile: -1, fbTimer: 0,
    eaten: 0, served: 0, alive: true, mood: 0, blink: 0, respawnIn: 0,
    pet: opts.pet ?? false, owner: opts.owner ?? (opts.pet ? "player" : "wild"),
    sex: (rng() < 0.5 ? 0 : 1) as 0 | 1,
    bond: opts.pet ? 0.3 : 0, grow: 0, breedCd: POP.breedCooldownTicks,
    cmd: null, need: "content", idleTicks: 0,
  };
  const t = tileAt(s.tiles, Math.round(c.x), Math.round(c.y));
  if (!t || isWater(t.biome)) {
    const land = s.tiles.filter((x) => !isWater(x.biome));
    if (land.length) { const p = pick(land, rng); c.x = p.x; c.y = p.y; }
  }
  return c;
}

// ───────────────────────── ความจำสถานที่ ─────────────────────────

export function remember(c: Creature, tileIndex: number, value: number, weight = 1) {
  if (tileIndex < 0) return;
  const cur = c.mem[tileIndex] ?? 0;
  c.mem[tileIndex] = clamp(cur + (value - cur) * M.learnRate * weight, -1, 1);
}

export const recall = (c: Creature, tileIndex: number) => c.mem[tileIndex] ?? 0;

/** ลืมสิ่งที่ไม่สำคัญทิ้ง — ไม่งั้นความจำโตไม่หยุดและเซฟบวม */
function decayMemory(c: Creature) {
  const keys = Object.keys(c.mem);
  for (const k of keys) {
    const v = c.mem[k as unknown as number] * M.decayPerTick;
    if (Math.abs(v) < 0.02) delete c.mem[k as unknown as number];
    else c.mem[k as unknown as number] = v;
  }
  if (keys.length > M.maxEntries) {
    const sorted = keys.sort((a, b) =>
      Math.abs(c.mem[a as unknown as number]) - Math.abs(c.mem[b as unknown as number]));
    for (let i = 0; i < keys.length - M.maxEntries; i++)
      delete c.mem[sorted[i] as unknown as number];
  }
}

// ───────────────────────── การตัดสินใจ ─────────────────────────

/** เลือกการกระทำด้วย softmax: น้ำหนักที่เรียนมา × แรงผลักจากยีนและความหิว
 *  ปัญญาสูง = อุณหภูมิต่ำ = ตัดสินใจเด็ดขาดขึ้น ไม่สุ่มมั่ว */
function chooseAction(s: GameState, c: Creature, rng: Rng, mate: Creature | null): ActionId {
  const g = c.genes, hunger = 1 - c.energy;
  const near = nearestVillage(s, c.x, c.y) ? 1 : 0;
  const rested = c.energy > 0.3 ? 1 : 0.2;
  const score: Record<ActionId, number> = {
    forage:  c.w.forage  * (0.5 + hunger * 1.9),
    // สัตว์ป่าไม่ได้ถูกใครสอนให้บุก และจะไม่แตะหมู่บ้านเลยจนกว่าอารยธรรมจะตั้งหลักได้
    raid:    c.w.raid    * (0.25 + g.aggr * 1.5 + hunger * 0.9) * near
             * (c.pet ? 1 : s.era >= POP.wildRaidFromEra ? POP.wildRaidBias : 0),
    help:    c.w.help    * (0.5 + (1 - g.aggr) * 0.9) * near * rested,
    worship: c.w.worship * (0.5 + g.intel * 0.8) * near * rested,
    // มีคู่ที่พร้อมอยู่ในระยะ = ออกเดินไปหาเลย ไม่งั้นบนแผนที่ใหญ่มันจะไม่มีวันเจอกัน
    wander:  c.w.wander  * (mate ? POP.mateUrge : 0.55),
  };
  const temp = 1.25 - 0.75 * g.intel;
  const keys = Object.keys(score) as ActionId[];
  const exps = keys.map((k) => Math.exp(Math.max(score[k], 0.001) / temp));
  const sum = exps.reduce((a, b) => a + b, 0);
  let r = rng() * sum;
  for (let i = 0; i < keys.length; i++) { r -= exps[i]; if (r <= 0) return keys[i]; }
  return "wander";
}

/** พร้อมสืบพันธุ์ไหม — ใช้ทั้งตอนมองหาคู่และตอนผสมจริง */
function fertile(c: Creature) {
  return c.alive && c.breedCd <= 0 && c.age >= POP.minAgeToBreed && c.energy >= POP.breedEnergy;
}

/** คู่ที่ใกล้ที่สุดที่พร้อมเหมือนกัน — สัตว์จะเดินเข้าหากันเองแทนที่จะสุ่มทั่วแผนที่ */
function findMate(s: GameState, c: Creature): Creature | null {
  if (!fertile(c)) return null;
  let best: Creature | null = null, bd = POP.seekMateRadius;
  for (const o of s.creatures) {
    if (o === c || o.sex === c.sex || !fertile(o)) continue;
    const d = Math.hypot(o.x - c.x, o.y - c.y);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

function randLand(s: GameState, c: Creature, rng: Rng) {
  const land = s.tiles.filter((t) => !isWater(t.biome));
  if (!land.length) return { x: c.x, y: c.y };
  const t = pick(land, rng);
  return { x: t.x, y: t.y };
}

/** หาแหล่งอาหาร: ความอุดมที่เห็น + สิ่งที่มันจำได้ว่าเคยดี/เคยแย่ที่ตรงนั้น
 *  โดยหลีกเลี่ยงไร่นาของผู้ศรัทธา (ไม่งั้นมันแทะจนอารยธรรมล่ม) */
function bestFood(s: GameState, c: Creature, r: number, rng: Rng) {
  let best = null, bv = 0.02;
  const x = c.x, y = c.y;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const t = tileAt(s.tiles, Math.round(x) + dx, Math.round(y) + dy);
    if (!t) continue;
    const water = isWater(t.biome);
    if (water && !isShallow(t.biome)) continue;
    const i = idx(t.x, t.y);
    const known = recall(c, i);
    let val = t.fert / (1 + 0.22 * Math.hypot(dx, dy));
    if (water) val *= C.shallowFoodFactor;
    val *= 1 + M.recallWeight * known;
    if (known === 0) val *= 1 + M.curiosity * rng();   // ที่ที่ยังไม่เคยไป มีเสน่ห์นิดหน่อย
    const nv = nearestVillage(s, t.x, t.y);
    if (nv && Math.hypot(nv.x - t.x, nv.y - t.y) < C.farmAvoidRadius) val *= C.farmAvoidFactor;
    if (val > bv) { bv = val; best = t; }
  }
  return best;
}

function startAction(s: GameState, c: Creature, rng: Rng) {
  // คำสั่งของพระเจ้ามาก่อน ถ้ามันยอมเชื่อฟัง
  if (c.cmd && c.cmd.ticks > 0) {
    const obey = P.obedienceBase + P.obediencePerIntel * c.genes.intel + P.obedienceFromBond * c.bond;
    if (rng() < obey) {
      if (c.cmd.kind === "eatHere") { c.act = "forage"; c.tgt = { x: c.cmd.x, y: c.cmd.y }; return; }
      if (c.cmd.kind === "goTo" || c.cmd.kind === "follow") {
        c.act = "wander"; c.tgt = { x: c.cmd.x, y: c.cmd.y }; return;
      }
      if (c.cmd.kind === "stay") {
        c.act = "wander"; c.tgt = { x: c.cmd.x, y: c.cmd.y }; return;
      }
    }
  }
  const mate = findMate(s, c);
  const a = chooseAction(s, c, rng, mate);
  c.act = a;
  if (a === "forage") {
    const t = bestFood(s, c, 3 + Math.round(c.genes.intel * 4), rng);
    c.tgt = t ? { x: t.x, y: t.y } : randLand(s, c, rng);
  } else if (a === "wander") {
    c.tgt = mate ? { x: mate.x, y: mate.y } : randLand(s, c, rng);
  } else {
    const v = nearestVillage(s, c.x, c.y);
    c.tgt = v ? { x: v.x, y: v.y } : randLand(s, c, rng);
  }
}

function resolveAction(s: GameState, c: Creature, rng: Rng, log: (m: string) => void) {
  const g = c.genes, a = c.act;
  const t = tileAt(s.tiles, Math.round(c.x), Math.round(c.y));
  const here = t ? idx(t.x, t.y) : -1;
  const v = t?.village ?? nearestVillage(s, c.x, c.y);
  const atVillage = v && Math.hypot(v.x - c.x, v.y - c.y) < 1.6;

  if (a === "forage" && t && (!isWater(t.biome) || isShallow(t.biome))) {
    const room = C.eatBase + C.eatPerSize * bodySize(c);
    // สิ่งที่ดึงจากผืนดินจริง — ส่วนนี้เท่านั้นที่ทำให้ดินเสื่อม
    let fromTile = Math.min(t.fert * C.eatFraction, room);
    if (isShallow(t.biome)) fromTile *= C.shallowFoodFactor;
    // พื้นขั้นต่ำ: แม้บนดินที่ถูกกวาดจนโล่ง ก็ยังมีรากมีแมลงให้ประทังชีวิต
    // เป็นพลังงาน "ฟรี" ที่ไม่ไปแย่งไร่นาของผู้คน ไม่งั้นสัตว์ป่าจะฆ่าอารยธรรมทางอ้อม
    const eat = Math.max(C.eatFloor, fromTile);
    t.fert = Math.max(0, t.fert - fromTile * C.eatDepletion);
    c.energy = clamp(c.energy + eat * (C.energyPerFood - C.energyPerFoodSizePenalty * g.size), 0, 1);
    c.eaten += eat;
    c.grow = Math.min(C.growthMax, c.grow + eat * C.growthPerFood);
    // ที่นี่ให้อาหารได้แค่ไหน จำไว้
    remember(c, here, clamp(eat * 5 - 0.35, -1, 1));
  } else if (a === "raid" && v && atVillage) {
    const raw = (C.raidBase + C.raidPerAggr * g.aggr) * (0.5 + bodySize(c)) + v.pop * C.raidPerPop;
    const defence = 1 + v.pop * C.raidDefencePerPop + s.era * C.raidDefencePerEra;
    // เพดานต่อครั้ง: หมู่บ้านบอบช้ำได้ แต่สัตว์ฝูงเดียวต้องไม่ล้างอารยธรรมทั้งโลก
    const dmg = Math.min(raw / defence, v.pop * C.raidMaxFraction);
    v.pop = Math.max(C.raidFloorPop, v.pop - dmg);   // ปล้นได้ แต่ไม่ล้างเผ่าพันธุ์
    // บุกแล้วเจ็บตัว — ยิ่งหมู่บ้านใหญ่ยิ่งเจ็บ เป็นแรงคัดเลือกที่ต้านยีนดุร้าย
    const injury = Math.min(C.raidInjuryMax,
      C.raidInjuryBase + s.era * C.raidInjuryPerEra + v.pop * C.raidInjuryPerPop);
    c.energy = clamp(c.energy - injury, 0, 1);
    v.belief = clamp(v.belief + 0.16, 0, 1);          // ศรัทธาจากความกลัว
    if (c.owner === "player") s.align = clamp(s.align + balance.align.creatureRaid, -1, 1);
    if (c.owner === "rival") nudgeDevotion(v, -balance.rival.devotionFromHarm);
    else nudgeDevotion(v, balance.rival.devotionFromHarm);
    c.energy = clamp(c.energy + 0.22, 0, 1);
    burst(s, v.x, v.y, "#b34a3a", rng);
    remember(c, here, 0.5);
    if (c.pet) log(`สัตว์ของท่านบุกหมู่บ้าน${v.name}`);
  } else if (a === "help" && v && atVillage) {
    v.pop += 0.9 + bodySize(c);
    v.belief = clamp(v.belief + 0.06, 0, 1);
    addAwe(v, 0.05);
    if (c.owner === "player") s.align = clamp(s.align + balance.align.creatureHelp, -1, 1);
    c.energy = clamp(c.energy - 0.06, 0, 1); c.served++;
    burst(s, v.x, v.y, "#77c08a", rng);
    remember(c, here, 0.3);
  } else if (a === "worship" && v && Math.hypot(v.x - c.x, v.y - c.y) < 1.8) {
    v.belief = clamp(v.belief + 0.10, 0, 1);
    addAwe(v, 0.04);
    if (c.owner === "player") {
      s.faith += 5 + 9 * g.intel;
      s.align = clamp(s.align + balance.align.creatureWorship, -1, 1);
    } else if (c.owner === "rival") {
      s.rival.faith += 5 + 9 * g.intel;
      nudgeDevotion(v, -0.02);
    }
    c.energy = clamp(c.energy - 0.04, 0, 1); c.served++;
    burst(s, v.x, v.y, "#d9a437", rng);
    remember(c, here, 0.35);
  } else if (a === "wander") {
    remember(c, here, t && !isWater(t.biome) ? t.fert * 1.2 - 0.3 : -0.4, 0.4);
  }

  c.lastAct = a;
  c.lastTile = here;
  c.fbTimer = C.feedbackWindowSeconds / balance.time.tickSeconds;
  c.act = null; c.tgt = null;
}

export function burst(s: GameState, x: number, y: number, color: string, rng: Rng) {
  for (let i = 0; i < 9; i++)
    s.fx.push({ kind: "spark", x: x + 0.5 + (rng() - 0.5),
                y: y + 0.5 + (rng() - 0.5), t: 0, life: 0.8, color });
}

// ───────────────────────── การสอน ─────────────────────────

/** สอนสัตว์: ปรับน้ำหนักของ "การกระทำล่าสุด" และผูกคำตัดสินเข้ากับ "สถานที่" ที่มันทำด้วย */
export function teach(s: GameState, sign: 1 | -1, rng: Rng, log: (m: string) => void): boolean {
  const c = petOf(s);
  if (!c || !c.alive || !c.lastAct || c.fbTimer <= 0) { log("ยังไม่มีสิ่งใดให้ตัดสิน"); return false; }
  const lr = C.learnBase + C.learnPerIntel * c.genes.intel;
  const k = c.lastAct;
  c.w[k] = clamp(c.w[k] + sign * lr, 0.05, 3);
  remember(c, c.lastTile, sign, M.teachPlaceWeight);
  c.bond = clamp(c.bond + (sign > 0 ? P.bondPerPraise : P.bondPerScold), 0, 1);
  c.mood = sign; c.fbTimer = 0;
  burst(s, c.x, c.y, sign > 0 ? "#d9a437" : "#9a3030", rng);
  const t = tileAt(s.tiles, Math.round(c.x), Math.round(c.y));
  const where = t ? ` ที่${t.biome === "OCEAN" || t.biome === "SHALLOW" ? "ผืนน้ำ" : "ตรงนั้น"}` : "";
  log(sign > 0 ? `ท่านพอใจที่มัน${ACTION_NAME[k]}${where}` : `ท่านลงโทษที่มัน${ACTION_NAME[k]}${where}`);
  return true;
}

export function command(s: GameState, kind: Command["kind"], x: number, y: number): boolean {
  const c = petOf(s);
  if (!c || !c.alive) return false;
  c.cmd = { kind, x, y, ticks: P.commandHoldTicks };
  c.act = null; c.tgt = null;
  return true;
}

// ───────────────────────── เกิด แก่ ตาย สืบพันธุ์ ─────────────────────────

function fitnessOf(c: Creature) { return c.age + c.eaten * 26 + c.served * 9; }

function die(s: GameState, c: Creature, log: (m: string) => void) {
  c.alive = false;
  const fit = fitnessOf(c);
  if (!s.best || fit > s.best.fit) s.best = { genes: { ...c.genes }, w: { ...c.w }, fit };
  if (c.pet) {
    log(`สัตว์ของท่านรุ่นที่ ${c.gen} สิ้นชีพ (คะแนนอยู่รอด ${Math.round(fit)})`);
    c.respawnIn = 2;
  }
}

/** ทายาทของสัตว์ผู้เล่น — สืบจากตัวเดิมโน้มเข้าหาสายที่เก่งที่สุดเท่าที่เคยมี */
function reincarnatePet(s: GameState, dead: Creature, rng: Rng, log: (m: string) => void) {
  const best = s.best ?? { genes: dead.genes, w: dead.w, fit: 0 };
  const genes = {} as Genes;
  for (const k of Object.keys(dead.genes) as (keyof Genes)[])
    genes[k] = clamp(lerp(dead.genes[k], best.genes[k], C.inheritToBest) + gauss(rng) * C.mutation, 0.02, 1);
  const w = {} as Weights;
  for (const k of Object.keys(dead.w) as (keyof Weights)[])
    w[k] = clamp(lerp(0.6, lerp(dead.w[k], best.w[k], 0.4), 0.75), 0.05, 3);

  const deltas: string[] = [];
  for (const k of Object.keys(genes) as (keyof Genes)[]) {
    const d = genes[k] - dead.genes[k];
    if (Math.abs(d) > 0.05) deltas.push((d > 0 ? "+" : "−") + GENE_NAME[k]);
  }
  const nc = makeCreature(s, genes, w, dead.gen + 1, rng, { pet: true, owner: "player" });
  // ทายาทได้ความจำสถานที่ครึ่งหนึ่งจากพ่อแม่ — ความรู้ไม่ได้เริ่มจากศูนย์ทุกรุ่น
  for (const [k, v] of Object.entries(dead.mem)) nc.mem[k as unknown as number] = v * 0.5;
  nc.bond = dead.bond * 0.6;
  s.creatures.push(nc);
  s.petId = nc.id;
  log(`รุ่นที่ ${nc.gen} ลืมตา${deltas.length ? " · " + deltas.slice(0, 2).join(" ") : ""}`);
}

/** ผสมพันธุ์จริงระหว่างสัตว์สองตัวในประชากร — ยีนไขว้กัน ไม่ใช่สายเดี่ยว */
function tryBreed(s: GameState, a: Creature, rng: Rng, log: (m: string) => void) {
  if (s.creatures.length >= POP.maxCreatures) return;
  if (!fertile(a)) return;
  for (const b of s.creatures) {
    if (b === a || b.sex === a.sex || !fertile(b)) continue;
    if (Math.hypot(b.x - a.x, b.y - a.y) > POP.breedRadius) continue;
    if (rng() > POP.breedChance) continue;

    const genes = {} as Genes;
    for (const k of Object.keys(a.genes) as (keyof Genes)[]) {
      const base = rng() < POP.crossover ? a.genes[k] : b.genes[k];
      genes[k] = clamp(base + gauss(rng) * POP.wildMutation, 0.02, 1);
    }
    const w = {} as Weights;
    for (const k of Object.keys(a.w) as (keyof Weights)[])
      w[k] = clamp((a.w[k] + b.w[k]) / 2 + gauss(rng) * 0.08, 0.05, 3);

    const child = makeCreature(s, genes, w, Math.max(a.gen, b.gen) + 1, rng,
                               { x: a.x, y: a.y, owner: "wild" });
    child.energy = 0.6;
    a.energy -= 0.2; b.energy -= 0.2;
    a.breedCd = b.breedCd = POP.breedCooldownTicks;
    s.creatures.push(child);
    if (s.creatures.length <= 6) log(`สัตว์ป่ารุ่นที่ ${child.gen} ลืมตาในที่ห่างไกล`);
    return;
  }
}

// ───────────────────────── หนึ่งจังหวะของสัตว์หนึ่งตัว ─────────────────────────

function updateNeed(c: Creature) {
  if (c.energy < P.tiredAt) c.need = "tired";
  else if (c.energy < P.hungerAt) c.need = "hungry";
  else if (c.idleTicks > P.boredAfterTicks) c.need = "bored";
  else c.need = "content";
}

function stepOne(s: GameState, c: Creature, rng: Rng, log: (m: string) => void): void {
  const g = c.genes;
  c.age++;
  if (c.fbTimer > 0) c.fbTimer--;
  if (c.breedCd > 0) c.breedCd--;
  if (c.mood) c.mood *= 0.94;
  if (c.cmd) { c.cmd.ticks--; if (c.cmd.ticks <= 0) c.cmd = null; }
  c.bond *= P.bondDecayPerTick;
  decayMemory(c);

  const t = tileAt(s.tiles, Math.round(c.x), Math.round(c.y));
  let drain = C.drainBase * (0.55 + g.meta) * (0.65 + bodySize(c) * 0.9);
  if (t && isHarsh(t.biome)) drain *= 1 + C.harshPenalty * (1 - g.coat);
  if (t && isWater(t.biome))
    drain *= isShallow(t.biome) ? 1 + (C.waterPenalty - 1) * C.shallowDrainRelief : C.waterPenalty;
  c.energy -= drain;

  if (c.energy <= 0 || c.age > maxAge(c)) { die(s, c, log); return; }
  updateNeed(c);
  if (!c.act) { startAction(s, c, rng); c.idleTicks = 0; } else c.idleTicks++;

  if (c.tgt) {
    const dx = c.tgt.x - c.x, dy = c.tgt.y - c.y, d = Math.hypot(dx, dy);
    const sp = (0.32 + 0.55 * g.speed) * (0.55 + 0.45 * c.energy);
    if (d < 0.25) resolveAction(s, c, rng, log);
    else { c.x += (dx / d) * sp; c.y += (dy / d) * sp; }
  }
  c.blink = c.blink > 0 ? c.blink - 1 : rng() < 0.06 ? 2 : 0;
  tryBreed(s, c, rng, log);
}

export function stepCreatures(s: GameState, rng: Rng, log: (m: string) => void): void {
  for (const c of s.creatures) if (c.alive) stepOne(s, c, rng, log);

  // เก็บซาก และให้สัตว์ของผู้เล่นกลับชาติมาเกิด
  for (let i = s.creatures.length - 1; i >= 0; i--) {
    const c = s.creatures[i];
    if (c.alive) continue;
    if (c.pet) {
      if (--c.respawnIn <= 0) { s.creatures.splice(i, 1); reincarnatePet(s, c, rng, log); }
    } else s.creatures.splice(i, 1);
  }

  // โลกมีสัตว์ป่าของมันเองเสมอ ไม่ได้มีแค่ลูกหลานของตัวที่รอด
  // ถ้าปล่อยให้ประชากรคอหักจนสูญพันธุ์ ระบบคัดเลือกจะหยุดเดินทั้งเกม
  const wild = s.creatures.filter((c) => !c.pet).length;
  if (wild < POP.minWild && s.creatures.length < POP.maxCreatures && s.best &&
      rng() < POP.wildSpawnChance) {
    const genes = {} as Genes;
    for (const k of Object.keys(s.best.genes) as (keyof Genes)[])
      genes[k] = clamp(s.best.genes[k] + gauss(rng) * POP.wildMutation * 2, 0.02, 1);
    const nc = makeCreature(s, genes, newWeights(), 1, rng, { owner: "wild" });
    nc.age = Math.floor(rng() * maxAge(nc) * 0.35);   // อายุกระจาย ไม่ตายพร้อมกัน
    s.creatures.push(nc);
  }
}
