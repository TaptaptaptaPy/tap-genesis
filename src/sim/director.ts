import { clamp, type Rng } from "../core/rng";
import { isWater } from "./biomes";
import { tileAt } from "./world";
import type { DisasterId, GameState, Village } from "./types";
import balance from "../../data/balance.json";

/** ผู้กำกับ
 *
 *  เดิมภัยพิบัติสุ่มล้วน: สุ่มชนิดตามน้ำหนักคงที่ สุ่มจุดใกล้หมู่บ้านสักแห่ง
 *  ผลคือบางรอบเทพกำลังลำบากอยู่แล้วโดนซ้ำ บางรอบทุกอย่างเรียบร้อยเป็นร้อย tick
 *  โดยไม่มีอะไรให้ทำ ซึ่งทั้งสองแบบไม่ใช่จังหวะที่ดี
 *
 *  แนวคิดนี้มาจาก AI director แบบ RimWorld ที่ผู้ทำ spiritual successor ของ B&W
 *  ทั้งสองเจ้าใส่ไว้ตรงกัน: อย่าส่งเหตุการณ์ตามนาฬิกา ส่งตามว่าตอนนี้ผู้เล่นอยู่ตรงไหน
 *
 *  สามอย่างที่ต่างจากการสุ่ม:
 *  1. ดูว่าตอนนี้เขากำลังลำบากอยู่ไหม — ลำบากอยู่แล้วก็รอก่อน
 *  2. เล็งไปที่หมู่บ้านที่เขา *ลงแรงไว้มากที่สุด* ไม่ใช่หมู่บ้านไหนก็ได้
 *     การถูกทดสอบตรงที่เจ็บคือทั้งหมดของเรื่อง
 *  3. เลือกชนิดที่ที่นั่น *รู้สึกได้จริง* — โรคระบาดที่ที่มีคนเยอะ ไฟป่าที่ที่มีป่า
 */

const D = balance.disaster;
const DIR = balance.director;

/** ตอนนี้ผู้เล่นลำบากแค่ไหน 0..1 — ประกอบจากสิ่งที่เห็นได้ในโลกล้วน */
export function pressure(s: GameState): number {
  if (!s.villages.length) return 1;
  const hungry = s.villages.filter((v) => v.needs.food < DIR.hungryAt).length / s.villages.length;
  const sick = s.villages.some((v) => v.plague > 0) ? DIR.sickWeight : 0;
  const running = Math.min(1, s.disasters.length / 2) * DIR.runningWeight;
  // เดิมใช้ "ศรัทธาในกระเป๋าเทพ" เป็นตัวชี้ความลำบาก ซึ่งกลับหัวกลับหาง:
  // เทพที่ปล่อยทิ้งไม่ได้ใช้ศรัทธาเลย กระเป๋าจึงเต็มตลอดและอ่านออกมาว่า "สบายมาก"
  // ผู้กำกับเลยถล่มโลกที่ไม่มีใครดูแลหนักกว่าโลกที่มีคนดูแล (วัดได้ 51 ครั้ง vs 12)
  // สิ่งที่บอกได้จริงว่าโลกนี้มีคนดูแลอยู่ไหม คือ *ศรัทธาของผู้คน* ไม่ใช่ยอดในกระเป๋า
  const unfaithful = 1 - clamp(
    s.villages.reduce((a, v) => a + v.belief, 0) / s.villages.length, 0, 1);
  const noPet = s.creature.alive ? 0 : DIR.noPetWeight;
  return clamp(hungry * DIR.hungryWeight + sick + running + unfaithful * DIR.faithlessWeight + noPet, 0, 1);
}

/** หมู่บ้านที่ผู้เล่นลงแรงไว้มากที่สุด — วัดจากศรัทธาคูณจำนวนคน บวกนักบวชที่เกิดจากมือเขาเอง */
function showpiece(s: GameState): Village | null {
  let best: Village | null = null, bv = -1;
  for (const v of s.villages) {
    const priests = v.folk.reduce((n, f) => n + (f.priest ? 1 : 0), 0);
    const val = v.belief * v.pop + priests * DIR.priestValue;
    if (val > bv) { bv = val; best = v; }
  }
  return best;
}

/** หมู่บ้านที่เปราะที่สุด */
function weakest(s: GameState): Village | null {
  let w: Village | null = null, wv = Infinity;
  for (const v of s.villages) {
    const val = v.needs.food + v.needs.shelter + v.belief;
    if (val < wv) { wv = val; w = v; }
  }
  return w;
}

/** ชนิดที่ตรงนั้นรู้สึกได้จริง — ภัยที่ไม่มีอะไรให้เสียไม่ใช่ภัย */
function kindFor(s: GameState, v: Village, rng: Rng): DisasterId {
  const around = (f: (bx: number, by: number) => boolean) => {
    let n = 0;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++)
      if (f(v.x + dx, v.y + dy)) n++;
    return n;
  };
  const forest = around((x, y) => tileAt(s.tiles, x, y)?.biome === "FOREST");
  const water = around((x, y) => { const t = tileAt(s.tiles, x, y); return !!t && isWater(t.biome); });
  const fert = around((x, y) => (tileAt(s.tiles, x, y)?.fert ?? 0) > 0.6);

  const w: [DisasterId, number][] = [
    ["plague", v.pop >= DIR.plaguePop ? 1.4 : 0.35],
    ["wildfire", forest >= DIR.forestTiles ? 1.5 : 0.2],
    ["flood", water >= DIR.waterTiles ? 1.2 : 0.15],
    ["drought", fert >= DIR.fertTiles ? 1.4 : 0.4],
  ];
  const sum = w.reduce((a, [, x]) => a + x, 0);
  let r = rng() * sum;
  for (const [k, x] of w) { r -= x; if (r <= 0) return k; }
  return "drought";
}

export interface Plan { kind: DisasterId; x: number; y: number; target: string }

/** วันนี้ควรเกิดอะไรไหม และควรเกิดที่ไหน — คืน null แปลว่ายังไม่ถึงเวลา */
export function planDisaster(s: GameState, rng: Rng): Plan | null {
  if (!s.villages.length) return null;
  // เขากำลังลำบากอยู่แล้ว ซ้ำเข้าไปตอนนี้ไม่ได้สร้างเรื่อง มันแค่ทำให้เลิกเล่น
  const p = pressure(s);
  if (p > DIR.holdAbove) return null;
  // ยิ่งสบายยิ่งมีโอกาสโดน — นี่คือส่วนที่ทำให้มันเป็นผู้กำกับ ไม่ใช่นาฬิกา
  if (rng() > D.baseChance * (1 + (DIR.holdAbove - p) * DIR.slackGain)) return null;

  const v = (rng() < DIR.aimAtWeakest ? weakest(s) : showpiece(s)) ?? s.villages[0];
  const kind = kindFor(s, v, rng);
  // ไฟป่าเกิดในป่า ไม่ใช่กลางหมู่บ้าน ที่เหลือเกิดใกล้ตัวหมู่บ้าน
  const spread = kind === "wildfire" ? DIR.fireSpread : DIR.nearSpread;
  const x = Math.round(clamp(v.x + (rng() - 0.5) * spread * 2, 0, balance.world.W - 1));
  const y = Math.round(clamp(v.y + (rng() - 0.5) * spread * 2, 0, balance.world.H - 1));
  const t = tileAt(s.tiles, x, y);
  if (!t || isWater(t.biome)) return { kind, x: v.x, y: v.y, target: v.name };
  return { kind, x, y, target: v.name };
}
