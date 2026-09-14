import { clamp, pick, type Rng } from "../core/rng";
import { isWater } from "./biomes";
import { tileAt } from "./world";
import type { GameState, Village } from "./types";
import balance from "../../data/balance.json";

const NAMES = ["อรุณ","ผาแดง","ลำธาร","ไพรใหญ่","ทุ่งทอง","หินผา","สายลม","ปลายน้ำ",
               "เนินเถ้า","ตะวันลับ","ฟากฟ้า","รากไม้","คลื่นเงียบ","ดาวเหนือ"];

export function foundVillage(s: GameState, x: number, y: number, rng: Rng): Village | null {
  const t = tileAt(s.tiles, x, y);
  if (!t || isWater(t.biome) || t.village) return null;
  const v: Village = { x, y, pop: balance.start.villagePop, belief: 0.35, name: pick(NAMES, rng), age: 0 };
  t.village = v;
  s.villages.push(v);
  return v;
}

/** หาทำเลตั้งหมู่บ้านใหม่: ดินดี + ไม่เบียดหมู่บ้านเดิม (ระยะขั้นต่ำโตตามยุค) */
function bestSpot(s: GameState, cx: number, cy: number, rad: number, rng: Rng) {
  let bs: { x: number; y: number } | null = null, bv = -1;
  const minD = 3 + Math.floor(s.era * 0.8);
  const { W, H } = balance.world;
  for (let y = Math.max(0, cy - rad); y <= Math.min(H - 1, cy + rad); y++)
  for (let x = Math.max(0, cx - rad); x <= Math.min(W - 1, cx + rad); x++) {
    const t = tileAt(s.tiles, x, y);
    if (!t || isWater(t.biome) || t.village) continue;
    let score = t.fert * 3;
    for (const v of s.villages) {
      const d = Math.hypot(v.x - x, v.y - y);
      if (d < minD) score -= (minD - d) * 1.8;
    }
    score += rng() * 0.3;
    if (score > bv) { bv = score; bs = { x, y }; }
  }
  return bv > 0.6 ? bs : null;
}

export function stepVillages(s: GameState, rng: Rng, log: (m: string) => void): void {
  const V = balance.village, E = balance.era;
  const cap = V.popCapByEra[s.era];
  const R = V.workRadiusByEra[s.era];
  const ym = V.yieldMultByEra[s.era];

  for (let i = s.villages.length - 1; i >= 0; i--) {
    const v = s.villages[i];
    v.age++;

    // เก็บเกี่ยวแบบสัดส่วน: ดินเข้าสู่สมดุลที่ ~30% ของเพดาน
    // ผลคือแต่ละหมู่บ้านมี "เพดานประชากรตามชีวนิเวศ" ฝนกับป่าจึงยกเพดานได้จริง
    let yieldSum = 0;
    const inten = clamp(v.pop / V.intensityDivisor, 0.25, 1.4);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const t = tileAt(s.tiles, v.x + dx, v.y + dy);
      if (!t) continue;
      const take = t.fert * V.harvestRate * inten;
      yieldSum += take * (isWater(t.biome) ? 0.5 : 1);
      t.fert = Math.max(0, t.fert - take * V.depletionFactor);
    }
    yieldSum *= ym;

    const need = v.pop * V.needPerPop;
    v.pop += yieldSum > need
      ? (yieldSum - need) * V.growthGain
      : (yieldSum - need) * V.famineGain;   // อดอยากหดช้ากว่าโต = มีเวลาให้พระเจ้าช่วย
    v.pop = clamp(v.pop, 0, cap);

    v.belief = clamp(v.belief + (V.beliefBase - v.belief) * V.beliefDrift, 0, 1);
    s.faith = Math.min(s.faith + v.pop * v.belief * V.faithPerBeliever,
                       E.faithCapBase + s.era * E.faithCapPerEra);
    s.know += v.pop * V.knowPerPop;

    if (v.pop < 1.2) {
      const t = tileAt(s.tiles, v.x, v.y);
      if (t) t.village = null;
      s.villages.splice(i, 1);
      log(`หมู่บ้าน${v.name}ร้างผู้คน`);
      continue;
    }

    if (v.pop > cap * V.splitAtCapRatio && v.age > V.splitMinAge && rng() < V.splitChance) {
      const spot = bestSpot(s, v.x, v.y, 5 + s.era, rng);
      if (spot) {
        const nv = foundVillage(s, spot.x, spot.y, rng);
        if (nv) { v.pop -= balance.start.villagePop; nv.belief = v.belief * 0.9;
                  log(`ผู้คนแยกไปตั้งหมู่บ้าน${nv.name}`); }
      }
    }
  }

  while (s.era < E.knowThresholds.length - 1 && s.know >= E.knowThresholds[s.era + 1]) {
    s.era++;
    log(`ผู้ศรัทธาก้าวเข้าสู่${E.names[s.era]}`);
  }
}

export function nearestVillage(s: GameState, x: number, y: number): Village | null {
  let best: Village | null = null, bd = Infinity;
  for (const v of s.villages) {
    const d = Math.hypot(v.x - x, v.y - y);
    if (d < bd) { bd = d; best = v; }
  }
  return best;
}

export const totalPop = (s: GameState) => s.villages.reduce((a, v) => a + v.pop, 0);
