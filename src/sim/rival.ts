import { clamp, pick, type Rng } from "../core/rng";
import { isWater } from "./biomes";
import { castSpell } from "./miracle";
import { makeCreature, newGenes, newWeights } from "./creature";
import { tileAt } from "./world";
import type { GameState, Village } from "./types";
import balance from "../../data/balance.json";

const R = balance.rival;

/** เทพคู่แข่งโผล่มาเมื่ออารยธรรมโตพอจะมีอะไรให้แย่ง */
export function maybeAwakenRival(s: GameState, rng: Rng, log: (m: string) => void): void {
  if (!R.enabled || s.rival.active) return;
  if (s.era < R.appearsAtEra) return;
  s.rival.active = true;
  s.rival.name = pick(R.names, rng);
  s.rival.faith = R.startFaith;
  // สัตว์ของคู่แข่ง — สายเลือดคนละสายกับของผู้เล่น
  const land = s.tiles.filter((t) => !isWater(t.biome));
  if (land.length) {
    const p = pick(land, rng);
    s.creatures.push(makeCreature(s, newGenes(rng), newWeights(), 1, rng,
                                  { owner: "rival", x: p.x, y: p.y }));
  }
  log(`${s.rival.name}ตื่นขึ้นจากอีกฟากของโลก`);
}

/** หมู่บ้านที่เอนไปทางไหน + เดือดร้อนแค่ไหน = เป้าหมายที่คุ้มที่สุดของแต่ละฝ่าย */
function neediest(list: Village[]): Village | null {
  let best: Village | null = null, bv = Infinity;
  for (const v of list) {
    const score = v.needs.food + v.needs.wood + v.needs.shelter;
    if (score < bv) { bv = score; best = v; }
  }
  return best;
}
function richest(list: Village[]): Village | null {
  let best: Village | null = null, bv = -1;
  for (const v of list) if (v.pop > bv) { bv = v.pop; best = v; }
  return best;
}

export function stepRival(s: GameState, rng: Rng, log: (m: string) => void): void {
  maybeAwakenRival(s, rng, log);
  if (!s.rival.active) return;
  s.rival.align *= balance.align.decayPerTick;

  // ใจของหมู่บ้านค่อยๆ ไหลกลับสู่กลาง ถ้าไม่มีใครมาดูแล
  for (const v of s.villages) {
    const pull = R.devotionDriftPerTick;
    v.devotion += v.devotion > 0 ? -pull : pull;
    v.devotion = clamp(v.devotion, -1, 1);
  }

  if (--s.rival.thinkCd > 0) return;
  s.rival.thinkCd = R.thinkEveryTicks;

  const mine = s.villages.filter((v) => v.devotion < 0);
  const theirs = s.villages.filter((v) => v.devotion >= 0);

  // 1) ดูแลของตัวเองก่อน ถ้ามีหมู่บ้านที่กำลังจะตาย
  const hurt = neediest(mine);
  if (hurt && (hurt.needs.food < 0.6 || hurt.plague > 0)) {
    if (hurt.plague > 0 && castSpell(s, "heal", hurt.x, hurt.y, rng, log, "rival")) return;
    if (castSpell(s, "bless", hurt.x, hurt.y, rng, log, "rival")) return;
    if (castSpell(s, "rain", hurt.x, hurt.y, rng, log, "rival")) return;
  }

  // 2) แย่งใจหมู่บ้านของผู้เล่น — ด้วยพระคุณหรือด้วยความกลัว แล้วแต่นิสัย
  const target = rng() < 0.5 ? neediest(theirs) : richest(theirs);
  if (target) {
    const harsh = rng() < R.aggression;
    if (harsh) {
      if (s.era >= 2 && rng() < 0.35 && castSpell(s, "quake", target.x, target.y, rng, log, "rival")) return;
      if (castSpell(s, "bolt", target.x, target.y, rng, log, "rival")) return;
    } else {
      if (castSpell(s, "bless", target.x, target.y, rng, log, "rival")) return;
      if (castSpell(s, "rain", target.x, target.y, rng, log, "rival")) return;
    }
  }

  // 3) ไม่มีอะไรให้ทำก็ขยายเผ่าของตัวเอง
  if (s.rival.faith > 80) {
    const land = s.tiles.filter((t) => !isWater(t.biome) && !t.village && t.fert > 0.4);
    if (land.length) {
      const t = pick(land, rng);
      castSpell(s, "seed", t.x, t.y, rng, log, "rival");
    }
  }
}

/** หมู่บ้านที่ใจไหลไปหาคู่แข่งจนเกินเกณฑ์ ถือว่าเปลี่ยนศาสนาแล้ว */
export function checkConversions(s: GameState, log: (m: string) => void): void {
  if (!s.rival.active) return;
  for (const v of s.villages) {
    const t = tileAt(s.tiles, v.x, v.y);
    if (!t) continue;
    if (v.devotion < -R.convertThreshold && v.belief > 0.3 && v.age % 40 === 0)
      log(`หมู่บ้าน${v.name}หันไปบูชา${s.rival.name}`);
  }
}
