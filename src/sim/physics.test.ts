import { describe, expect, it } from "vitest";
import { createGame, faithCap, stepTick, totalPop } from "./index";
import { grabAt, throwTo, whatIsAt, stepProjectiles } from "./physics";
import { tileAt } from "./world";
import { mulberry32 } from "../core/rng";
import balance from "../../data/balance.json";

type S = ReturnType<typeof createGame>["state"];
const quiet = () => { /* เทสต์ไม่ต้องการ log */ };
const DT = balance.time.tickSeconds;

/** เดินโลกไปสองสามจังหวะให้ชาวบ้านรายคนถูกสร้างขึ้นมาก่อน
 *  (ตอน tick 0 หมู่บ้านมี pop แต่ยังไม่มี folk สักคน — `stepFolk()` เป็นคนสร้าง) */
function warmed(seed: number, ticks = 5) {
  const g = createGame(seed);
  for (let i = 0; i < ticks; i++) stepTick(g);
  return g;
}

function findGrabbable(s: S, want: string) {
  for (let y = 1; y < balance.world.H - 1; y++)
    for (let x = 1; x < balance.world.W - 1; x++)
      if (whatIsAt(tileAt(s.tiles, x, y)) === want) return { x, y };
  return null;
}

/** บั๊กที่เสียเวลามากที่สุดของไฟล์นี้: `z` ของกระสุนเป็นความสูง "สัมบูรณ์"
 *  หน่วยเดียวกับ `tile.h` (0-1.5) ไม่ใช่เมตร และไม่ใช่ความสูงเหนือพื้น
 *  ตอนเริ่มที่ 0 แล้วเทียบกับ tile.h ที่ 0.58 ของเลยตกทันทีที่ขว้างทุกครั้ง
 *  แต่ยังมี log ว่า "ตกใส่หมู่บ้าน" ทุกครั้ง เลยดูเหมือนใช้งานได้
 *  สามข้อแรกจะล้มทันทีถ้าหน่วยหรือแรงโน้มถ่วงถูกแก้กลับไปแบบเดิม */
describe("หยิบและขว้าง", () => {
  it("ของต้องอยู่ในอากาศหลายจังหวะ ไม่ใช่ตกทันทีที่ขว้าง", () => {
    const g = warmed(4242);
    const rng = mulberry32(1);
    const from = findGrabbable(g.state, "rock") ?? findGrabbable(g.state, "tree")!;
    expect(grabAt(g.state, from.x, from.y, quiet)).not.toBeNull();
    expect(throwTo(g.state, from.x + 6, from.y + 4, quiet)).toBe(true);

    let ticks = 0;
    while (g.state.thrown.length > 0 && ticks < 900) {
      stepProjectiles(g.state, DT, rng, quiet);
      ticks++;
    }
    expect(ticks).toBeGreaterThanOrEqual(2);
    expect(ticks).toBeLessThan(900);
  });

  it("สมการวิถีโค้งต้องพาของไปตกตรงเป้า", () => {
    // เดินด้วยก้าวละเอียดกว่าเกมจริง เพื่อวัด "สมการถูกไหม" ไม่ใช่ "ก้าวหยาบแค่ไหน"
    const g = warmed(4242);
    const rng = mulberry32(1);
    const from = findGrabbable(g.state, "rock") ?? findGrabbable(g.state, "tree")!;
    const tx = from.x + 6, ty = from.y + 4;
    grabAt(g.state, from.x, from.y, quiet);
    throwTo(g.state, tx, ty, quiet);

    let last = { x: from.x, y: from.y };
    for (let i = 0; i < 4000 && g.state.thrown.length > 0; i++) {
      last = { x: g.state.thrown[0].x, y: g.state.thrown[0].y };
      stepProjectiles(g.state, DT / 16, rng, quiet);
    }
    expect(Math.hypot(last.x - (tx + 0.5), last.y - (ty + 0.5))).toBeLessThan(1);
  });

  it("ก้อนหินที่ขว้างใส่หมู่บ้านต้องไปถึงหมู่บ้านจริง", () => {
    const g = warmed(4242);
    const rng = mulberry32(1);
    const v = g.state.villages[0];
    const from = findGrabbable(g.state, "rock") ?? findGrabbable(g.state, "tree")!;
    const before = v.pop;
    grabAt(g.state, from.x, from.y, quiet);
    throwTo(g.state, v.x, v.y, quiet);
    for (let i = 0; i < 900 && g.state.thrown.length > 0; i++) stepProjectiles(g.state, DT, rng, quiet);
    expect(v.pop).toBeLessThan(before);
  });

  it("หยิบคนแล้วประชากรต้องลดทันที ไม่ใช่รอตอนขว้าง", () => {
    const g = warmed(4242);
    const spot = findGrabbable(g.state, "folk");
    expect(spot).not.toBeNull();
    const before = totalPop(g.state);
    expect(grabAt(g.state, spot!.x, spot!.y, quiet)).toBe("folk");
    expect(totalPop(g.state)).toBe(before - 1);
  });

  it("whatIsAt กับ grabAt ต้องเห็นตรงกันเสมอ", () => {
    // เคยไม่ตรงกัน: whatIsAt ดู `pop` ส่วน grabAt ดู `folk` ตอน tick 0 จึงบอกว่าหยิบคนได้
    // แต่พอหยิบจริงกลับตอบว่า "ไม่มีใครอยู่ตรงนั้น" ทุกหมู่บ้าน
    const g = createGame(4242);
    for (const v of g.state.villages) {
      const t = tileAt(g.state.tiles, v.x, v.y);
      const says = whatIsAt(t);
      const got = grabAt(g.state, v.x, v.y, quiet);
      expect(got).toBe(says);
      g.state.carrying = null; g.state.carryFrom = null; g.state.carryFolk = null;
    }
  });

  it("มือถือของได้ทีละชิ้น หยิบซ้ำต้องถูกปฏิเสธ", () => {
    const g = warmed(4242);
    const a = findGrabbable(g.state, "rock") ?? findGrabbable(g.state, "tree")!;
    grabAt(g.state, a.x, a.y, quiet);
    expect(grabAt(g.state, a.x, a.y, quiet)).toBeNull();
  });
});

/** เพดานศรัทธาหดลงได้เมื่อประชากรลด ศรัทธาที่สะสมไว้จึงค้างเหนือเพดานได้ถ้าไม่บังคับ
 *  เคยไล่แก้ผิดจุดมาแล้วเพราะคิดว่าเป็นเพราะการร่ายรำบูชาบวกเกิน */
describe("เพดานศรัทธา", () => {
  it("เดินโลกยาวๆ แล้วศรัทธาต้องไม่เคยทะลุเพดานสักจังหวะ", () => {
    const g = createGame(99);
    let worst = 0;
    for (let i = 0; i < 4000; i++) {
      stepTick(g);
      worst = Math.max(worst, g.state.faith - faithCap(g.state));
    }
    expect(worst).toBeLessThanOrEqual(1e-9);
  });
});
