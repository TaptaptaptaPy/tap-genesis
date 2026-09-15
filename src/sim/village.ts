import { clamp, pick, type Rng } from "../core/rng";
import { isWater } from "./biomes";
import { tileAt } from "./world";
import type { GameState, Village } from "./types";
import balance from "../../data/balance.json";

const NAMES = ["อรุณ","ผาแดง","ลำธาร","ไพรใหญ่","ทุ่งทอง","หินผา","สายลม","ปลายน้ำ",
               "เนินเถ้า","ตะวันลับ","ฟากฟ้า","รากไม้","คลื่นเงียบ","ดาวเหนือ",
               "ห้วยทราย","ผาเงา","ท่าไม้","บึงบัว","ยอดเนิน","ลานหิน"];

/** ผืนดินมีจำกัด จำนวนหมู่บ้านจึงต้องมีเพดาน ไม่งั้นช่วงท้ายเกมจะบานเป็นร้อย */
export const maxVillages = (s: GameState) =>
  Math.max(3, Math.floor(s.landCount / balance.village.tilesPerVillage));

export function foundVillage(s: GameState, x: number, y: number, rng: Rng): Village | null {
  const t = tileAt(s.tiles, x, y);
  if (!t || isWater(t.biome) || t.village) return null;
  if (s.villages.length >= maxVillages(s)) return null;
  const v: Village = {
    id: s.nextId++, x, y,
    pop: balance.start.villagePop, belief: 0.35, name: pick(NAMES, rng), age: 0,
    wood: 4, shelter: balance.start.villagePop * balance.needs.shelterNeedPerPop,
    needs: { food: 1, wood: 1, shelter: 1 },
    awe: 0, devotion: 1, plague: 0,
  };
  t.village = v;
  s.villages.push(v);
  return v;
}

/** หาทำเลตั้งหมู่บ้านใหม่: ดินดี + ไม่เบียดหมู่บ้านเดิม (ระยะขั้นต่ำโตตามยุค) */
function bestSpot(s: GameState, cx: number, cy: number, rad: number, rng: Rng) {
  let bs: { x: number; y: number } | null = null, bv = -1;
  const minD = 3 + balance.village.minSpacingBonus + Math.floor(s.era * 0.8);
  const { W, H } = balance.world;
  for (let y = Math.max(0, cy - rad); y <= Math.min(H - 1, cy + rad); y++)
  for (let x = Math.max(0, cx - rad); x <= Math.min(W - 1, cx + rad); x++) {
    const t = tileAt(s.tiles, x, y);
    if (!t || isWater(t.biome) || t.village) continue;
    let score = t.fert * 3, tooClose = false;
    for (const v of s.villages) {
      const d = Math.hypot(v.x - x, v.y - y);
      if (d < minD) { tooClose = true; break; }
      if (d < minD * 1.8) score -= (minD * 1.8 - d) * 0.5;
    }
    if (tooClose) continue;
    score += rng() * 0.3;
    if (score > bv) { bv = score; bs = { x, y }; }
  }
  return bv > 0.6 ? bs : null;
}

/** ปาฏิหาริย์ทิ้งความทรงจำไว้ — นี่คือตัวที่ทำให้ศรัทธาไม่ใช่แค่จำนวนหัว */
export function addAwe(v: Village, amount: number) {
  v.awe = clamp(v.awe + amount, 0, 1);
}

export function nudgeDevotion(v: Village, amount: number) {
  v.devotion = clamp(v.devotion + amount, -1, 1);
}

export function stepVillages(s: GameState, rng: Rng, log: (m: string) => void): void {
  const V = balance.village, E = balance.era, N = balance.needs, S = balance.season;
  const cap = V.popCapByEra[s.era];
  const R = V.workRadiusByEra[s.era];
  const ym = V.yieldMultByEra[s.era] * S.yieldMult[s.season];

  for (let i = s.villages.length - 1; i >= 0; i--) {
    const v = s.villages[i];
    v.age++;

    // เก็บเกี่ยวแบบสัดส่วน: ดินเข้าสู่สมดุลที่ ~30% ของเพดาน
    // ผลคือแต่ละหมู่บ้านมี "เพดานประชากรตามชีวนิเวศ" ฝนกับป่าจึงยกเพดานได้จริง
    let yieldSum = 0, woodSum = 0;
    const inten = clamp(v.pop / V.intensityDivisor, 0.25, 1.4);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const t = tileAt(s.tiles, v.x + dx, v.y + dy);
      if (!t) continue;
      const take = t.fert * V.harvestRate * inten;
      yieldSum += take * (isWater(t.biome) ? 0.5 : 1);
      t.fert = Math.max(0, t.fert - take * V.depletionFactor);
      if (t.biome === "FOREST") woodSum += N.woodPerForestTile * inten;
      else if (t.biome === "LUSH") woodSum += N.woodPerLushTile * inten;
    }
    yieldSum *= ym;

    // ---- อาหาร ----
    const need = v.pop * V.needPerPop;
    const foodNow = need > 0 ? clamp((yieldSum / need) * N.foodScale, 0, 1) : 1;
    v.needs.food += (foodNow - v.needs.food) * N.smoothing;

    // ---- ไม้ ----
    const woodNeed = v.pop * N.woodNeedPerPop;
    v.wood = Math.min(N.woodStoreMax, v.wood + woodSum);
    const woodTaken = Math.min(v.wood, woodNeed);
    v.wood -= woodTaken;
    const woodNow = woodNeed > 0 ? clamp(woodTaken / woodNeed, 0, 1) : 1;
    v.needs.wood += (woodNow - v.needs.wood) * N.smoothing;

    // ---- ที่อยู่อาศัย: ไม้ที่เหลือถูกเอาไปสร้าง แล้วบ้านค่อยๆ ผุ ----
    const shelterNeed = v.pop * N.shelterNeedPerPop;
    if (v.shelter < shelterNeed && v.wood > 1) {
      const build = Math.min(v.wood * 0.25, shelterNeed - v.shelter);
      v.wood -= build / N.shelterPerWood;
      v.shelter += build;
    }
    v.shelter = Math.max(0, v.shelter - v.shelter * N.shelterDecayPerTick);
    const shelterNow = shelterNeed > 0 ? clamp(v.shelter / shelterNeed, 0, 1) : 1;
    v.needs.shelter += (shelterNow - v.needs.shelter) * N.smoothing;

    // ---- ประชากร ----
    const unmet = (1 - v.needs.wood) * 0.5 + (1 - v.needs.shelter) * 0.5;
    let growth = yieldSum > need
      ? (yieldSum - need) * V.growthGain * (1 - unmet * N.unmetPopPenalty)
      : (yieldSum - need) * V.famineGain;   // อดอยากหดช้ากว่าโต = มีเวลาให้พระเจ้าช่วย
    if (v.plague > 0) {
      v.plague--;
      v.pop *= balance.disaster.plague.popMultPerTick;
      v.awe = Math.max(0, v.awe - balance.disaster.plague.beliefDrain);
      growth = Math.min(growth, 0);
    }
    v.pop = clamp(v.pop + growth, 0, cap);

    // ---- ศรัทธา: ผลรวมของความต้องการที่ถูกเติมเต็ม + ความทรงจำถึงปาฏิหาริย์ ----
    v.awe *= N.aweDecayPerTick;
    const target = clamp(
      N.beliefFloor +
      v.needs.food * N.beliefFromFood +
      v.needs.wood * N.beliefFromWood +
      v.needs.shelter * N.beliefFromShelter +
      v.awe * N.beliefFromAwe, 0, 1);
    v.belief += (target - v.belief) * V.beliefDrift;

    // ---- แบ่งศรัทธาระหว่างสองเทพตามใจของหมู่บ้าน ----
    const playerShare = (v.devotion + 1) / 2;
    const income = v.pop * v.belief * V.faithPerBeliever;
    s.faith = Math.min(s.faith + income * playerShare,
                       E.faithCapBase + s.era * E.faithCapPerEra);
    if (s.rival.active) {
      const RV = balance.rival;
      s.rival.faith = Math.min(s.rival.faith + income * (1 - playerShare),
                               RV.faithCapBase + s.era * RV.faithCapPerEra);
    }
    s.know += v.pop * V.knowPerPop;

    if (v.pop < 1.2) {
      const t = tileAt(s.tiles, v.x, v.y);
      if (t) t.village = null;
      s.villages.splice(i, 1);
      log(`หมู่บ้าน${v.name}ร้างผู้คน`);
      continue;
    }

    if (s.villages.length < maxVillages(s) &&
        v.pop > cap * V.splitAtCapRatio && v.age > V.splitMinAge &&
        v.needs.food > V.splitNeedsFood && v.needs.wood > V.splitNeedsWood &&
        rng() < V.splitChance / (1 + s.villages.length / V.crowdingDivisor)) {
      const spot = bestSpot(s, v.x, v.y, 5 + s.era, rng);
      if (spot) {
        const nv = foundVillage(s, spot.x, spot.y, rng);
        if (nv) { v.pop -= balance.start.villagePop; nv.belief = v.belief * 0.9;
                  nv.devotion = v.devotion;
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
export const loyalPop = (s: GameState) =>
  s.villages.reduce((a, v) => a + v.pop * ((v.devotion + 1) / 2), 0);
