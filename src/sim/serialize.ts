import type { GameState, Tile, Village } from "./types";

/** กับดักที่ต้องระวัง: `tile.village` กับ `state.villages[]` ชี้ไปที่ object ก้อนเดียวกัน
 *  ถ้า JSON.stringify ตรงๆ แล้วโหลดกลับ มันจะกลายเป็นคนละก้อนและค่าจะเริ่มไม่ตรงกันเงียบๆ
 *  เราจึงเก็บเป็น id แล้วผูกกลับตอนโหลด */
type PlainTile = Omit<Tile, "village"> & { vid: number };
export interface PlainState extends Omit<GameState, "tiles"> { tiles: PlainTile[]; }

export const SAVE_VERSION = 2;

/** ต้องก๊อปลึกจริง ไม่ใช่แค่ spread ชั้นเดียว
 *  ถ้าแชร์ object เดิม "สแนปช็อต" จะเดินหน้าไปพร้อมกับโลกที่ยังรันอยู่ แล้วโหลดกลับมาได้คนละโลก
 *  (structuredClone เร็วกว่า JSON แต่ก็ยังรับประกันว่าตัดขาดจากของเดิม) */
const deepCopy = <T,>(v: T): T =>
  typeof structuredClone === "function" ? structuredClone(v) : (JSON.parse(JSON.stringify(v)) as T);

export function toPlain(s: GameState): PlainState {
  const tiles: PlainTile[] = s.tiles.map((t) => {
    const { village, ...rest } = t;
    return { ...rest, vid: village ? village.id : -1 };
  });
  return deepCopy({ ...s, tiles, fx: [] });   // เอฟเฟกต์ภาพไม่ต้องเก็บ
}

export function fromPlain(input: PlainState): GameState {
  const p = deepCopy(input);
  const byId = new Map<number, Village>();
  for (const v of p.villages) byId.set(v.id, v);
  const tiles: Tile[] = p.tiles.map((t) => {
    const { vid, ...rest } = t;
    return { ...rest, village: vid >= 0 ? byId.get(vid) ?? null : null };
  });
  return { ...p, tiles, fx: [], shake: 0 };
}

/** ตรวจว่าไฟล์เซฟยังเข้ากับโครงปัจจุบันไหม ก่อนจะเอาไปใช้ */
export function looksValid(p: unknown, expectTiles: number): p is PlainState {
  if (!p || typeof p !== "object") return false;
  const o = p as Record<string, unknown>;
  return Array.isArray(o.tiles) && o.tiles.length === expectTiles &&
         Array.isArray(o.villages) && Array.isArray(o.creatures) &&
         typeof o.faith === "number" && typeof o.tick === "number";
}
