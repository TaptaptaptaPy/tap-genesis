import { clamp, pick, type Rng } from "../core/rng";
import { isWater } from "./biomes";
import { tileAt } from "./world";
import { stepFolk } from "./folk";
import type { GameState, NeedId, Village } from "./types";
import balance from "../../data/balance.json";

const NAMES = ["อรุณ","ผาแดง","ลำธาร","ไพรใหญ่","ทุ่งทอง","หินผา","สายลม","ปลายน้ำ",
               "เนินเถ้า","ตะวันลับ","ฟากฟ้า","รากไม้","คลื่นเงียบ","ดาวเหนือ"];

export const NEED_NAME: Record<NeedId, string> = {
  food: "อาหาร", wood: "ไม้", shelter: "ที่อยู่อาศัย",
};

/** ผืนดินมีจำกัด จำนวนหมู่บ้านจึงต้องมีเพดาน */
export const maxVillages = (s: GameState) =>
  Math.max(2, Math.floor(s.landCount / balance.village.tilesPerVillage));

export function foundVillage(s: GameState, x: number, y: number, rng: Rng): Village | null {
  const t = tileAt(s.tiles, x, y);
  if (!t || isWater(t.biome) || t.village) return null;
  if (s.villages.length >= maxVillages(s)) return null;
  const v: Village = {
    id: s.villages.length + 1 + Math.floor(rng() * 1000),
    x, y, pop: balance.start.villagePop, belief: 0.35, name: pick(NAMES, rng), age: 0,
    wood: 4, shelter: balance.start.villagePop * balance.needs.shelterNeedPerPop,
    needs: { food: 1, wood: 1, shelter: 1 },
    awe: 0, plague: 0, ask: null, askCd: 0, folk: [],
  };
  t.village = v;
  s.villages.push(v);
  return v;
}

/** หาทำเลตั้งหมู่บ้านใหม่: ดินดี + ห่างจากหมู่บ้านเดิมพอ */
function bestSpot(s: GameState, cx: number, cy: number, rad: number, rng: Rng) {
  let bs: { x: number; y: number } | null = null, bv = -1;
  const minD = balance.village.minSpacing;
  const { W, H } = balance.world;
  for (let y = Math.max(0, cy - rad); y <= Math.min(H - 1, cy + rad); y++)
  for (let x = Math.max(0, cx - rad); x <= Math.min(W - 1, cx + rad); x++) {
    const t = tileAt(s.tiles, x, y);
    if (!t || isWater(t.biome) || t.village) continue;
    let tooClose = false, score = t.fert * 3;
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

export function addAwe(v: Village, amount: number) { v.awe = clamp(v.awe + amount, 0, 1); }

/** รัศมีที่หมู่บ้านนี้แผ่ความศรัทธาออกไป = เขตที่พระเจ้าลงมือได้
 *  ยิ่งคนเชื่อมากและมีคนมาก เขตยิ่งกว้าง — อำนาจจึงมาจากการดูแลคน ไม่ใช่มีมาแต่แรก */
export const influenceOf = (v: Village) =>
  Math.min(balance.influence.max,
    balance.influence.base +
    balance.influence.perBelief * v.belief +
    balance.influence.perPopRoot * Math.sqrt(Math.max(0, v.pop)));

/** จุดนี้อยู่ในเขตที่ผู้คนศรัทธาท่านไหม */
export function inInfluence(s: GameState, x: number, y: number): boolean {
  for (const v of s.villages)
    if (Math.hypot(v.x - x, v.y - y) <= influenceOf(v)) return true;
  return false;
}

/** เพดานศรัทธาโตตามจำนวนผู้ศรัทธา ไม่ใช่ตามยุค */
export const faithCap = (s: GameState) =>
  balance.faith.capBase + balance.faith.capPerBeliever * totalPop(s);

/** จำนวนนักบวชในหมู่บ้านนี้ */
export const priestsOf = (v: Village) => v.folk.reduce((n, f) => n + (f.priest ? 1 : 0), 0);

export function stepVillages(s: GameState, rng: Rng, log: (m: string) => void): void {
  const V = balance.village, N = balance.needs;
  const cap = V.popCap, R = V.workRadius;

  for (let i = s.villages.length - 1; i >= 0; i--) {
    const v = s.villages[i];
    v.age++;
    if (v.askCd > 0) v.askCd--;

    // เก็บเกี่ยวแบบสัดส่วน ดินเข้าสู่สมดุล = แต่ละหมู่บ้านมีเพดานประชากรตามผืนดินรอบตัว
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

    const need = v.pop * V.needPerPop;
    const foodNow = need > 0 ? clamp((yieldSum / need) * N.foodScale, 0, 1) : 1;
    v.needs.food += (foodNow - v.needs.food) * N.smoothing;

    const woodNeed = v.pop * N.woodNeedPerPop;
    v.wood = Math.min(N.woodStoreMax, v.wood + woodSum);
    const woodTaken = Math.min(v.wood, woodNeed);
    v.wood -= woodTaken;
    const woodNow = woodNeed > 0 ? clamp(woodTaken / woodNeed, 0, 1) : 1;
    v.needs.wood += (woodNow - v.needs.wood) * N.smoothing;

    const shelterNeed = v.pop * N.shelterNeedPerPop;
    if (v.shelter < shelterNeed && v.wood > 1) {
      const build = Math.min(v.wood * 0.25, shelterNeed - v.shelter);
      v.wood -= build / N.shelterPerWood;
      v.shelter += build;
    }
    v.shelter = Math.max(0, v.shelter - v.shelter * N.shelterDecayPerTick);
    const shelterNow = shelterNeed > 0 ? clamp(v.shelter / shelterNeed, 0, 1) : 1;
    v.needs.shelter += (shelterNow - v.needs.shelter) * N.smoothing;

    const unmet = (1 - v.needs.wood) * 0.5 + (1 - v.needs.shelter) * 0.5;
    let growth = yieldSum > need
      ? (yieldSum - need) * V.growthGain * (1 - unmet * N.unmetPopPenalty)
      : (yieldSum - need) * V.famineGain;
    if (v.plague > 0) {
      v.plague--;
      v.pop *= balance.disaster.plague.popMultPerTick;
      v.awe = Math.max(0, v.awe - balance.disaster.plague.beliefDrain);
      growth = Math.min(growth, 0);
    }
    v.pop = clamp(v.pop + growth, 0, cap);

    // ศรัทธา = ความต้องการที่ถูกเติมเต็ม + ความทรงจำถึงปาฏิหาริย์
    v.awe *= N.aweDecayPerTick;
    const target = clamp(
      N.beliefFloor + v.needs.food * N.beliefFromFood + v.needs.wood * N.beliefFromWood +
      v.needs.shelter * N.beliefFromShelter + v.awe * N.beliefFromAwe +
      // คนที่พระเจ้าเคยอุ้มแล้ววางคืน เล่าสิ่งที่เห็นให้คนทั้งหมู่บ้านฟัง
      priestsOf(v) * balance.folk.priestBelief, 0, 1);
    v.belief += (target - v.belief) * V.beliefDrift;

    s.faith = Math.min(s.faith + v.pop * v.belief * V.faithPerBeliever, faithCap(s));

    stepFolk(s, v, rng);

    // หมู่บ้านร้องขอสิ่งที่ขาดที่สุด — ผู้เล่นจะได้รู้ว่าตอนนี้ควรทำอะไร
    updateAsk(v, log);

    if (v.pop < 1.2) {
      const t = tileAt(s.tiles, v.x, v.y);
      if (t) t.village = null;
      s.villages.splice(i, 1);
      log(`หมู่บ้าน${v.name}ร้างผู้คน`);
      continue;
    }

    if (s.villages.length < maxVillages(s) &&
        v.pop > cap * V.splitAtCapRatio && v.age > V.splitMinAge &&
        v.needs.food > 0.9 && v.needs.wood > 0.5 && rng() < V.splitChance) {
      const spot = bestSpot(s, v.x, v.y, 6, rng);
      if (spot) {
        const nv = foundVillage(s, spot.x, spot.y, rng);
        if (nv) { v.pop -= balance.start.villagePop; nv.belief = v.belief * 0.9;
                  log(`ผู้คนแยกไปตั้งหมู่บ้าน${nv.name}`); }
      }
    }
  }
}

function updateAsk(v: Village, log: (m: string) => void) {
  const N = balance.needs;
  const worst = (Object.keys(v.needs) as NeedId[])
    .reduce((a, b) => (v.needs[a] <= v.needs[b] ? a : b));
  if (v.needs[worst] < N.askThreshold) {
    if (v.ask !== worst && v.askCd <= 0) {
      v.ask = worst;
      v.askCd = N.askCooldownTicks;
      log(`หมู่บ้าน${v.name}ขาด${NEED_NAME[worst]}`);
    }
  } else if (v.ask && v.needs[v.ask] > N.askThreshold + 0.18) {
    v.ask = null;
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
/** หมู่บ้านที่กำลังเดือดร้อนที่สุด — ใช้ชี้เป้าให้ผู้เล่น */
export function neediestVillage(s: GameState): Village | null {
  let worst: Village | null = null, wv = 2;
  for (const v of s.villages) {
    const score = Math.min(v.needs.food, v.needs.wood, v.needs.shelter) - (v.plague > 0 ? 0.5 : 0);
    if (score < wv) { wv = score; worst = v; }
  }
  return wv < 0.72 ? worst : null;
}
