import { clamp, gauss, lerp, pick, type Rng } from "../core/rng";
import { isHarsh, isShallow, isWater } from "./biomes";
import { idx, tileAt } from "./world";
import { addAwe, nearestVillage } from "./village";
import type { ActionId, Command, Creature, CreatureNeed, GameState, Genes, Weights } from "./types";
import balance from "../../data/balance.json";

export const ACTION_NAME: Record<ActionId, string> = {
  forage: "หาอาหาร", raid: "บุกหมู่บ้าน", help: "ช่วยผู้คน",
  worship: "ร่ายรำบูชา", wander: "เดินเล่น",
};
export const GENE_NAME: Record<keyof Genes, string> = {
  size: "ขนาดกาย", speed: "ความไว", meta: "เผาผลาญ",
  aggr: "ดุร้าย", intel: "ปัญญา", coat: "ขนกันทารุณ",
};
export const NEED_NAME: Record<CreatureNeed, string> = {
  hungry: "หิว", tired: "เหนื่อย", bored: "เบื่อ", content: "สบายดี",
};

const C = balance.creature;
const M = balance.memory;
const P = balance.pet;

export const newGenes = (rng: Rng): Genes => ({
  size: 0.4 + rng() * 0.2, speed: 0.4 + rng() * 0.2, meta: 0.4 + rng() * 0.2,
  aggr: 0.35 + rng() * 0.2, intel: 0.35 + rng() * 0.2, coat: 0.35 + rng() * 0.2,
});
export const newWeights = (): Weights =>
  ({ forage: 1.0, raid: 0.4, help: 0.7, worship: 0.7, wander: 0.5 });

export const bodySize = (c: Creature) => clamp(c.genes.size + c.grow, 0.05, 1.5);
export const maxAge = (c: Creature) =>
  C.baseLifeTicks + C.lifePerSize * c.genes.size - C.lifePerMeta * c.genes.meta;

export function makeCreature(s: GameState, genes: Genes, w: Weights, gen: number, rng: Rng): Creature {
  const home = s.villages[0] ?? { x: balance.world.W / 2, y: balance.world.H / 2 };
  const c: Creature = {
    x: home.x + 1.5, y: home.y + 1.5, gen, genes, w, mem: {}, vmem: {},
    energy: 0.85, age: 0, act: null, tgt: null, lastAct: null, lastTile: -1, fbTimer: 0,
    eaten: 0, served: 0, alive: true, mood: 0, blink: 0, fear: 0, curious: 0, hiding: null, respawnIn: 0, petCd: 0, lastVillage: -1, intent: null, intentTicks: 0,
    bond: 0.3, grow: 0, cmd: null, need: "content", idleTicks: 0, facing: 0,
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

/** จำได้ว่าเคยทำอะไรกับหมู่บ้านนี้แล้วพระเจ้าว่ายังไง
 *  ความทรงจำเรื่องช่องบอกว่า "ตรงนั้นมีของกิน" ความทรงจำเรื่องหมู่บ้านบอกว่า "คนกลุ่มนั้นสำคัญ"
 *  ซึ่งเป็นคนละเรื่องกันโดยสิ้นเชิง และเป็นเหตุผลที่สัตว์ควรมีทั้งสองอย่าง */
export function rememberVillage(c: Creature, villageId: number, value: number, weight = 1) {
  const cur = c.vmem[villageId] ?? 0;
  c.vmem[villageId] = clamp(cur + (value - cur) * M.villageLearn * weight, -1, 1);
}
export const recallVillage = (c: Creature, villageId: number) => c.vmem[villageId] ?? 0;

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

function chooseAction(s: GameState, c: Creature, rng: Rng): ActionId {
  const g = c.genes, hunger = 1 - c.energy;
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

function randLand(s: GameState, c: Creature, rng: Rng) {
  const land = s.tiles.filter((t) => !isWater(t.biome));
  if (!land.length) return { x: c.x, y: c.y };
  const t = pick(land, rng);
  return { x: t.x, y: t.y };
}

/** หาแหล่งอาหาร: ความอุดมที่เห็น + สิ่งที่มันจำได้ว่าเคยดี/เคยแย่ที่ตรงนั้น */
function bestFood(s: GameState, c: Creature, r: number, rng: Rng) {
  let best = null, bv = 0.02;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const t = tileAt(s.tiles, Math.round(c.x) + dx, Math.round(c.y) + dy);
    if (!t) continue;
    const water = isWater(t.biome);
    if (water && !isShallow(t.biome)) continue;
    const i = idx(t.x, t.y);
    const known = recall(c, i);
    let val = t.fert / (1 + 0.22 * Math.hypot(dx, dy));
    if (water) val *= C.shallowFoodFactor;
    val *= 1 + M.recallWeight * known;
    if (known === 0) val *= 1 + M.curiosity * rng();
    const nv = nearestVillage(s, t.x, t.y);
    if (nv && Math.hypot(nv.x - t.x, nv.y - t.y) < C.farmAvoidRadius) val *= C.farmAvoidFactor;
    // ลำเอียงไปทางหมู่บ้านที่เคยทำแล้วพระเจ้าพอใจ และเลี่ยงหมู่บ้านที่เคยโดนดุ
    if (nv) val *= 1 + M.villageWeight * recallVillage(c, nv.id);
    if (val > bv) { bv = val; best = t; }
  }
  return best;
}

function startAction(s: GameState, c: Creature, rng: Rng) {
  if (c.cmd && c.cmd.ticks > 0) {
    const obey = P.obedienceBase + P.obediencePerIntel * c.genes.intel + P.obedienceFromBond * c.bond;
    if (rng() < obey) {
      c.act = c.cmd.kind === "eatHere" ? "forage" : "wander";
      c.tgt = { x: c.cmd.x, y: c.cmd.y };
      return;
    }
  }
  const a = chooseAction(s, c, rng);

  // การหลอกลวง — ปลายทางของการลงโทษหนักเกินไป
  //
  // ใน B&W การตีซ้ำๆ ไม่ได้สอนให้เลิกทำ มันสอนให้ *รอ* ให้พระเจ้าละสายตาก่อน
  // สัตว์ที่กลัวมากพอจะเก็บสิ่งที่อยากทำไว้ใน `hiding` แล้วเดินไปทำอย่างอื่นให้ดู
  // พอพระเจ้าเลิกมอง มันถึงค่อยไปทำสิ่งนั้นจริง
  //
  // นี่คือกลไกเดียวในเกมที่ทำให้ "เลี้ยงด้วยความกลัว" มีราคาที่จับต้องได้
  // ไม่ใช่แค่ตัวเลข align ที่ลดลง — มันแปลว่าท่านไม่รู้อีกต่อไปว่าสัตว์ของท่านทำอะไรอยู่
  if (c.fear >= P.deceitFearAt) {
    const watched = s.attention > 0;
    if (watched && a !== "wander" && rng() < P.deceitChance * c.fear) {
      c.hiding = a;
      c.intent = null; c.intentTicks = 0;
      c.act = "wander";
      c.tgt = randLand(s, c, rng);
      return;
    }
    if (!watched && c.hiding) {
      const k = c.hiding;
      c.hiding = null;
      s.deceits++;
      c.intent = null; c.intentTicks = 0;
      c.act = k;
      const v = nearestVillage(s, c.x, c.y);
      c.tgt = k === "forage" ? (bestFood(s, c, 3, rng) ?? randLand(s, c, rng))
            : v ? { x: v.x, y: v.y } : randLand(s, c, rng);
      return;
    }
  }

  // ลังเลก่อนลงมือ — ผู้เล่นได้เห็นว่ามันกำลังจะทำอะไร แล้วเข้าไปห้ามทัน
  // เดิมระบบสอนทั้งระบบขึ้นกับหน้าต่าง 3 วินาที *หลัง* มันทำไปแล้ว
  // แปลว่าเราสอนได้แค่ "ตัดสินย้อนหลัง" ไม่เคยได้ "เข้าไปห้าม" ซึ่งคนละเรื่องกัน
  // สัตว์ที่กลัวลังเลนานกว่า เพราะมันไม่แน่ใจว่าจะโดนอะไรอีก
  if (c.intent !== a) {
    c.intent = a;
    c.intentTicks = Math.round((P.intentTicks + P.intentPerBond * c.bond) * (1 + c.fear));
    return;
  }
  if (c.intentTicks > 0) { c.intentTicks--; return; }
  c.intent = null;
  c.act = a;
  if (a === "forage") {
    const t = bestFood(s, c, 3 + Math.round(c.genes.intel * 4), rng);
    c.tgt = t ? { x: t.x, y: t.y } : randLand(s, c, rng);
  } else if (a === "wander") {
    c.tgt = randLand(s, c, rng);
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
    let fromTile = Math.min(t.fert * C.eatFraction, room);
    if (isShallow(t.biome)) fromTile *= C.shallowFoodFactor;
    const eat = Math.max(C.eatFloor, fromTile);
    t.fert = Math.max(0, t.fert - fromTile * C.eatDepletion);
    c.energy = clamp(c.energy + eat * (C.energyPerFood - C.energyPerFoodSizePenalty * g.size), 0, 1);
    c.eaten += eat;
    c.grow = Math.min(C.growthMax, c.grow + eat * C.growthPerFood);
    remember(c, here, clamp(eat * 5 - 0.35, -1, 1));
  } else if (a === "raid" && v && atVillage) {
    const raw = (C.raidBase + C.raidPerAggr * g.aggr) * (0.5 + bodySize(c)) + v.pop * C.raidPerPop;
    const defence = 1 + v.pop * C.raidDefencePerPop;
    const dmg = Math.min(raw / defence, v.pop * C.raidMaxFraction);
    v.pop = Math.max(C.raidFloorPop, v.pop - dmg);
    v.belief = clamp(v.belief + 0.16, 0, 1);   // ศรัทธาจากความกลัว
    s.align = clamp(s.align + balance.align.creatureRaid, -1, 1);
    const injury = Math.min(C.raidInjuryMax, C.raidInjuryBase + v.pop * C.raidInjuryPerPop);
    c.energy = clamp(c.energy + 0.22 - injury, 0, 1);
    burst(s, v.x, v.y, "#b34a3a", rng);
    remember(c, here, 0.5);
    log(`สัตว์ของท่านบุกหมู่บ้าน${v.name}`);
  } else if (a === "help" && v && atVillage) {
    v.pop += 0.9 + bodySize(c);
    v.belief = clamp(v.belief + 0.06, 0, 1);
    addAwe(v, 0.05);
    s.align = clamp(s.align + balance.align.creatureHelp, -1, 1);
    c.energy = clamp(c.energy - 0.06, 0, 1); c.served++;
    burst(s, v.x, v.y, "#77c08a", rng);
    remember(c, here, 0.3);
    log(`สัตว์ของท่านช่วยงานที่หมู่บ้าน${v.name}`);
  } else if (a === "worship" && v && Math.hypot(v.x - c.x, v.y - c.y) < 1.8) {
    v.belief = clamp(v.belief + 0.10, 0, 1);
    addAwe(v, 0.04);
    s.faith += balance.faith.worshipBase + balance.faith.worshipPerIntel * g.intel;
    s.align = clamp(s.align + balance.align.creatureWorship, -1, 1);
    c.energy = clamp(c.energy - 0.04, 0, 1); c.served++;
    burst(s, v.x, v.y, "#d9a437", rng);
    remember(c, here, 0.35);
  } else if (a === "wander") {
    remember(c, here, t && !isWater(t.biome) ? t.fert * 1.2 - 0.3 : -0.4, 0.4);
  }

  c.lastAct = a;
  c.lastTile = here;
  // หมู่บ้านที่เกี่ยวข้องกับสิ่งที่เพิ่งทำ — บุก ช่วย หรือบูชา ล้วนผูกกับหมู่บ้านใดหมู่บ้านหนึ่ง
  // ส่วนหาอาหารกับเดินเล่นไม่เกี่ยวกับใคร จึงเป็น -1
  c.lastVillage = (a === "raid" || a === "help" || a === "worship")
    ? (t?.village?.id ?? nearestVillage(s, c.x, c.y)?.id ?? -1) : -1;
  c.fbTimer = C.feedbackWindowSeconds / balance.time.tickSeconds;
  c.act = null; c.tgt = null;
}

export function burst(s: GameState, x: number, y: number, color: string, rng: Rng) {
  for (let i = 0; i < 10; i++)
    s.fx.push({ kind: "spark", x: x + 0.5 + (rng() - 0.5), y: y + 0.5 + (rng() - 0.5),
                t: 0, life: 0.9, color });
}

// ───────────────────────── การสอน ─────────────────────────

/** สอนสัตว์: ปรับน้ำหนักของ "การกระทำล่าสุด" และผูกคำตัดสินเข้ากับ "สถานที่" ที่มันทำด้วย */
/** เรียนรู้ได้เร็วแค่ไหนในตอนนี้
 *
 *  ปัญญาเป็นฐาน แต่สภาพจิตใจเป็นตัวคูณ — ใน B&W ความกลัวขวางการเรียนรู้
 *  และความอยากรู้อยากเห็นเร่งมัน สัตว์ที่โดนตีจนกลัวจะสอนอะไรไม่เข้าอีกเลย
 *  ซึ่งเป็นเหตุผลว่าทำไม "ลงโทษอย่างเดียว" ถึงไม่ใช่วิธีเล่นที่ได้ผล ไม่ใช่แค่ใจร้าย */
export function learnRate(c: Creature): number {
  const base = C.learnBase + C.learnPerIntel * c.genes.intel;
  const fearMul = 1 - (1 - P.fearLearnFloor) * c.fear;
  const curiousMul = 1 + P.curiousLearnBonus * c.curious;
  return base * fearMul * curiousMul;
}

export function teach(s: GameState, sign: 1 | -1, rng: Rng, log: (m: string) => void): boolean {
  const c = s.creature;
  if (!c.alive || !c.lastAct || c.fbTimer <= 0) { log("ยังไม่มีสิ่งใดให้ตัดสิน"); return false; }
  const lr = learnRate(c);
  const k = c.lastAct;
  c.w[k] = clamp(c.w[k] + sign * lr, 0.05, 3);
  remember(c, c.lastTile, sign, M.teachPlaceWeight);
  // ถ้าสิ่งที่มันเพิ่งทำเกี่ยวกับหมู่บ้านใดหมู่บ้านหนึ่ง มันจะจำหมู่บ้านนั้นไปด้วย
  // ไม่ใช่จำแค่พิกัด — ชมตอนช่วยหมู่บ้าน ก. แล้วมันจะลำเอียงไปช่วย ก. อีก
  if (c.lastVillage >= 0) rememberVillage(c, c.lastVillage, sign);
  c.bond = clamp(c.bond + (sign > 0 ? P.bondPerPraise : P.bondPerScold), 0, 1);
  if (sign > 0) {
    c.curious = clamp(c.curious + P.curiousPerPraise, 0, 1);
    c.fear = clamp(c.fear + P.fearPerStroke, 0, 1);
  } else {
    c.fear = clamp(c.fear + P.fearPerSmack, 0, 1);
  }
  c.mood = sign; c.fbTimer = 0;
  burst(s, c.x, c.y, sign > 0 ? "#d9a437" : "#9a3030", rng);
  log(sign > 0 ? `ท่านพอใจที่มัน${ACTION_NAME[k]}` : `ท่านลงโทษที่มัน${ACTION_NAME[k]}`);
  return true;
}

/** ลูบหัวมัน
 *
 *  เดิมความผูกพันขยับได้ทางเดียวคือผ่าน `teach()` ซึ่งใช้ได้เฉพาะตอนมีอะไรให้ตัดสิน
 *  แปลว่าตลอดเวลาที่เหลือไม่มีทาง "แค่แสดงความรัก" กับมันเลย ทั้งที่นั่นคือครึ่งหนึ่ง
 *  ของความสัมพันธ์ระหว่างคนกับสัตว์ และเป็นแกนกลางของ Black & White
 *
 *  ถ้าลูบตอนที่มันเพิ่งทำอะไรลงไป จะนับเป็นคำชมด้วย — ซึ่งมีราคาของมัน
 *  ลูบตอนที่มันเพิ่งบุกหมู่บ้าน เท่ากับบอกว่าที่ทำนั้นดีแล้ว
 *  ความรักกับการสอนจึงไม่ได้แยกจากกันเสมอไป และนั่นคือความตั้งใจ */
export function stroke(s: GameState, rng: Rng, log: (m: string) => void): boolean {
  const c = s.creature;
  if (!c.alive) return false;
  if (c.petCd > 0) return false;
  c.petCd = P.strokeCooldownTicks;

  // ลูบตอนมันกำลังลังเล = อนุญาตให้ทำ มันจะมั่นใจขึ้นและทำเร็วขึ้นครั้งหน้า
  if (c.intent) {
    const k = c.intent;
    c.w[k] = clamp(c.w[k] + learnRate(c) * 0.8, 0.05, 3);
    c.intentTicks = 0;
    c.curious = clamp(c.curious + P.curiousPerPraise * 0.6, 0, 1);
    c.fear = clamp(c.fear + P.fearPerStroke, 0, 1);
    c.bond = clamp(c.bond + P.strokeBond * (1 - c.bond), 0, 1);
    c.mood = 1;
    burst(s, c.x, c.y, "#e8c98a", rng);
    log(`ท่านปล่อยให้มัน${ACTION_NAME[k]}`);
    return true;
  }

  // อยู่ในช่วงที่ตัดสินได้ = เป็นคำชมเต็มรูปแบบ ไม่ใช่แค่ลูบ
  if (c.lastAct && c.fbTimer > 0) return teach(s, 1, rng, log);

  // ยิ่งผูกพันแล้ว การลูบเพิ่มได้น้อยลง — ความไว้ใจซื้อด้วยการลูบรัวๆ ไม่ได้
  c.bond = clamp(c.bond + P.strokeBond * (1 - c.bond), 0, 1);
  // การลูบเปล่าๆ ปลอบให้หายกลัวได้ ซึ่งเป็นทางเดียวที่จะกู้สัตว์ที่ถูกตีมาเกินกลับมา
  c.fear = clamp(c.fear + P.fearPerStroke, 0, 1);
  c.mood = 1; c.fbTimer = 0;
  burst(s, c.x, c.y, "#e8c98a", rng);
  log("ท่านลูบหัวมัน");
  return true;
}

/** ตีมัน
 *
 *  ตีตอนที่มันเพิ่งทำอะไร = ลงโทษเรื่องนั้น
 *  ตีตอนที่มันไม่ได้ทำอะไร = มันไม่รู้ว่าโดนเพราะอะไร ได้แต่จำว่า "ตรงนี้เจ็บ"
 *  ซึ่งเป็นการสอนที่ผิด และเกมปล่อยให้ผิดได้จริง */
export function smack(s: GameState, rng: Rng, log: (m: string) => void): boolean {
  const c = s.creature;
  if (!c.alive) return false;
  if (c.petCd > 0) return false;
  c.petCd = P.strokeCooldownTicks;

  // ตีตอนมันกำลังจะทำอะไร = ห้ามไว้ทัน มันเลิกคิดและเรียนว่าอย่าทำอีก
  // นี่คือความต่างระหว่าง "ดุทีหลัง" กับ "ห้ามไว้ก่อน" ซึ่งอย่างหลังสอนได้ตรงกว่ามาก
  if (c.intent) {
    const k = c.intent;
    c.w[k] = clamp(c.w[k] - learnRate(c) * 1.4, 0.05, 3);
    c.fear = clamp(c.fear + P.fearPerSmack, 0, 1);
    if (c.lastVillage >= 0) rememberVillage(c, c.lastVillage, -0.6);
    c.intent = null; c.intentTicks = 0; c.act = null; c.tgt = null;
    c.bond = clamp(c.bond + P.smackBond * 0.5, 0, 1);
    c.mood = -1;
    burst(s, c.x, c.y, "#c8a04a", rng);
    log(`ท่านห้ามไว้ทันก่อนที่มันจะ${ACTION_NAME[k]}`);
    return true;
  }

  if (c.lastAct && c.fbTimer > 0) return teach(s, -1, rng, log);

  c.bond = clamp(c.bond + P.smackBond, 0, 1);
  // ตีทั้งที่มันไม่ได้ทำอะไร กลัวหนักกว่าตีตอนทำผิดจริง เพราะมันไม่รู้ว่าโดนเพราะอะไร
  // นี่คือทางที่เร็วที่สุดที่จะได้สัตว์ที่กลัวเราจนสอนไม่ได้ และเกมปล่อยให้ทำได้จริง
  c.fear = clamp(c.fear + P.fearPerSmack * P.fearBlindMult, 0, 1);
  // ไม่รู้ว่าโดนเพราะอะไร จำได้แค่ว่าตรงนี้ไม่ปลอดภัย
  remember(c, Math.floor(c.y) * balance.world.W + Math.floor(c.x), -1, P.smackFearWeight);
  c.mood = -1; c.fbTimer = 0;
  burst(s, c.x, c.y, "#9a3030", rng);
  log("ท่านตีมันทั้งที่มันไม่ได้ทำอะไร");
  return true;
}

/** สัตว์ที่อยู่ใกล้พอจะเห็นว่าท่านเพิ่งทำอะไร แล้วเลียนแบบ
 *  นี่คือการเรียนรู้แบบ Black & White ของจริง — เดิมมันเรียนได้จากคำชม/ดุหลังทำเองเท่านั้น
 *  แปลว่าท่านสอนมันได้แค่ "หลังจาก" มันเลือกเอง ไม่ใช่สอนด้วยการทำให้ดู */
export function watchMiracle(s: GameState, dark: boolean, cx: number, cy: number,
                             log: (m: string) => void): boolean {
  const c = s.creature;
  if (!c.alive) return false;
  const I = balance.imitate;
  if (Math.hypot(c.x - cx, c.y - cy) > I.watchRadius) return false;
  const lr = I.learnRate * (learnRate(c) / (C.learnBase + C.learnPerIntel * c.genes.intel));
  const nudge = (k: keyof Weights, amt: number) => { c.w[k] = clamp(c.w[k] + amt, 0.05, 3); };
  if (dark) { nudge("raid", lr); nudge("help", -lr * 0.5); }
  else { nudge("help", lr); nudge("worship", lr * 0.5); nudge("raid", -lr * 0.5); }
  c.mem[c.lastTile] = c.mem[c.lastTile] ?? 0;
  log(dark ? "สัตว์ของท่านเฝ้าดูสิ่งที่ท่านทำ" : "สัตว์ของท่านเฝ้าดูและจดจำ");
  return true;
}

/** พระเจ้ายกสัตว์ขึ้นมาแล้ววางลงที่อื่น — ไม่ใช่การ "สั่งให้เดินไป" แต่คือการหยิบมันไปวาง
 *  ใน B&W นี่คือสิ่งที่มือทำได้ตั้งแต่นาทีแรก และเป็นวิธีสอนที่ตรงที่สุดว่า "ไปอยู่ตรงนี้" */
export function placeCreature(s: GameState, x: number, y: number, log: (m: string) => void): boolean {
  const c = s.creature;
  if (!c.alive) { log("ยังไม่มีสัตว์ให้ยก"); return false; }
  const t = tileAt(s.tiles, x, y);
  if (!t || isWater(t.biome)) { log("วางลงกลางน้ำไม่ได้"); return false; }
  c.x = x + 0.5; c.y = y + 0.5;
  c.cmd = null; c.act = null; c.tgt = null;
  c.idleTicks = 0;
  log("ท่านยกมันไปวางไว้ที่ใหม่");
  return true;
}

export function command(s: GameState, kind: Command["kind"], x: number, y: number): boolean {
  const c = s.creature;
  if (!c.alive) return false;
  c.cmd = { kind, x, y, ticks: P.commandHoldTicks };
  c.act = null; c.tgt = null;
  return true;
}

// ───────────────────────── เกิด แก่ ตาย ─────────────────────────

function die(s: GameState, log: (m: string) => void) {
  const c = s.creature;
  c.alive = false;
  const fit = c.age + c.eaten * 26 + c.served * 9;
  if (!s.best || fit > s.best.fit) s.best = { genes: { ...c.genes }, w: { ...c.w }, fit };
  log(`สัตว์ของท่านสิ้นชีพเมื่ออายุ ${Math.round(c.age)} (คะแนนชีวิต ${Math.round(fit)})`);
  c.respawnIn = 4;
}

/** สัตว์ของผู้เล่นกลับชาติมาเกิด สืบสิ่งที่เรียนมาและความจำครึ่งหนึ่ง */
function reincarnate(s: GameState, rng: Rng, log: (m: string) => void) {
  const dead = s.creature;
  const best = s.best ?? { genes: dead.genes, w: dead.w, fit: 0 };
  const genes = {} as Genes;
  for (const k of Object.keys(dead.genes) as (keyof Genes)[])
    genes[k] = clamp(lerp(dead.genes[k], best.genes[k], C.inheritToBest) + gauss(rng) * C.mutation, 0.02, 1);
  const w = {} as Weights;
  for (const k of Object.keys(dead.w) as (keyof Weights)[])
    w[k] = clamp(lerp(0.6, lerp(dead.w[k], best.w[k], 0.4), 0.75), 0.05, 3);

  const nc = makeCreature(s, genes, w, dead.gen + 1, rng);

  // สืบทอดได้มากแค่ไหนขึ้นกับปัญญาของรุ่นที่ตายไป ไม่ใช่ค่าคงที่
  // สายพันธุ์ที่ฉลาดส่งต่อสิ่งที่เรียนมาได้มากกว่า — การเพาะปัญญาจึงมีความหมายจริง
  // (เดิมเป็น 0.5 ตายตัว ปัญญาจึงมีผลแค่กับความเร็วในการเรียนของตัวมันเอง)
  const keep = clamp(C.inheritBase + C.inheritPerIntel * dead.genes.intel, 0, 0.95);
  for (const [k, v] of Object.entries(dead.mem)) nc.mem[k as unknown as number] = v * keep;
  // ความทรงจำเรื่องหมู่บ้านก็ต้องส่งต่อ ไม่งั้นรุ่นใหม่ลืมว่าเคยช่วยใครมา
  for (const [k, v] of Object.entries(dead.vmem)) nc.vmem[k as unknown as number] = v * keep;
  nc.bond = dead.bond * (0.4 + keep * 0.4);
  s.creature = nc;
  log(`สัตว์รุ่นที่ ${nc.gen} ลืมตาขึ้นมา จำสิ่งที่รุ่นก่อนเรียนไว้ได้ ${Math.round(keep * 100)}%`);
}

function updateNeed(c: Creature) {
  if (c.energy < P.tiredAt) c.need = "tired";
  else if (c.energy < P.hungerAt) c.need = "hungry";
  else if (c.idleTicks > P.boredAfterTicks) c.need = "bored";
  else c.need = "content";
}

export function stepCreature(s: GameState, rng: Rng, log: (m: string) => void): void {
  const c = s.creature;
  if (!c.alive) {
    if (--c.respawnIn <= 0) reincarnate(s, rng, log);
    return;
  }
  const g = c.genes;
  c.age++;
  if (c.fbTimer > 0) c.fbTimer--;
  if (c.petCd > 0) c.petCd--;
  if (c.mood) c.mood *= 0.94;
  if (c.cmd) { c.cmd.ticks--; if (c.cmd.ticks <= 0) c.cmd = null; }
  c.bond *= P.bondDecayPerTick;
  c.fear *= P.fearDecayPerTick;
  c.curious *= P.curiousDecayPerTick;
  if (s.attention > 0) s.attention--;
  decayMemory(c);

  const t = tileAt(s.tiles, Math.round(c.x), Math.round(c.y));
  let drain = C.drainBase * (0.55 + g.meta) * (0.65 + bodySize(c) * 0.9);
  if (t && isHarsh(t.biome)) drain *= 1 + C.harshPenalty * (1 - g.coat);
  if (t && isWater(t.biome))
    drain *= isShallow(t.biome) ? 1 + (C.waterPenalty - 1) * C.shallowDrainRelief : C.waterPenalty;
  c.energy -= drain;

  if (c.energy <= 0 || c.age > maxAge(c)) { die(s, log); return; }
  updateNeed(c);
  if (!c.act) { startAction(s, c, rng); c.idleTicks = 0; } else c.idleTicks++;

  if (c.tgt) {
    const dx = c.tgt.x - c.x, dy = c.tgt.y - c.y, d = Math.hypot(dx, dy);
    const sp = (0.28 + 0.5 * g.speed) * (0.55 + 0.45 * c.energy);
    if (d < 0.25) resolveAction(s, c, rng, log);
    else {
      c.x += (dx / d) * sp; c.y += (dy / d) * sp;
      c.facing = Math.atan2(dx, dy);
    }
  }
  c.blink = c.blink > 0 ? c.blink - 1 : rng() < 0.05 ? 2 : 0;
}
