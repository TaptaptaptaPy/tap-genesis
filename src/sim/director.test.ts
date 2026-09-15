import { describe, expect, it } from "vitest";
import { createGame, stepTick } from "./index";
import { planDisaster, pressure } from "./director";
import { mulberry32 } from "../core/rng";
import balance from "../../data/balance.json";

const world = (ticks = 400) => {
  const g = createGame(5150);
  for (let i = 0; i < ticks; i++) stepTick(g);
  return g;
};
const rng = () => mulberry32(3);
/** Rng ต้องมี state ด้วย ไม่ใช่แค่ฟังก์ชันคืนตัวเลข */
const fixed = (v: number) => Object.assign(() => v, { state: 0 });

/** เดิมภัยพิบัติสุ่มล้วน บางรอบเทพกำลังลำบากอยู่แล้วโดนซ้ำ
 *  บางรอบทุกอย่างเรียบร้อยเป็นร้อย tick โดยไม่มีอะไรให้ทำ ทั้งสองแบบไม่ใช่จังหวะที่ดี */
describe("ผู้กำกับ", () => {
  it("โลกที่ทุกอย่างเรียบร้อยมีแรงกดดันต่ำ", () => {
    const g = world();
    for (const v of g.state.villages) { v.needs.food = 1; v.needs.shelter = 1; v.plague = 0; }
    g.state.disasters = [];
    g.state.faith = 9999;
    expect(pressure(g.state)).toBeLessThan(balance.director.holdAbove);
  });

  it("โลกที่หมู่บ้านอดอยากและมีโรค แรงกดดันสูงจนผู้กำกับหยุดส่ง", () => {
    const g = world();
    for (const v of g.state.villages) { v.needs.food = 0; v.needs.shelter = 0; v.plague = 20; }
    g.state.faith = 0;
    expect(pressure(g.state)).toBeGreaterThan(balance.director.holdAbove);
    expect(planDisaster(g.state, fixed(0))).toBeNull();
  });

  it("โลกที่สบายแล้วผู้กำกับส่งของมาให้ทำ", () => {
    const g = world();
    for (const v of g.state.villages) { v.needs.food = 1; v.needs.shelter = 1; v.plague = 0; }
    g.state.disasters = [];
    g.state.faith = 9999;
    expect(planDisaster(g.state, fixed(0))).not.toBeNull();
  });

  it("ภัยลงที่หมู่บ้าน ไม่ใช่กลางทะเลที่ไม่มีใครเดือดร้อน", () => {
    const g = world();
    for (const v of g.state.villages) { v.needs.food = 1; v.plague = 0; }
    g.state.faith = 9999;
    const r = rng();
    for (let i = 0; i < 20; i++) {
      const p = planDisaster(g.state, r);
      if (!p) continue;
      const near = g.state.villages.some((v) => Math.hypot(v.x - p.x, v.y - p.y) <= 5);
      expect(near).toBe(true);
    }
  });

  it("ที่ที่มีคนเยอะมีโอกาสเจอโรคระบาดมากกว่าที่ที่คนน้อย", () => {
    const g = world();
    for (const v of g.state.villages) { v.needs.food = 1; v.plague = 0; }
    g.state.faith = 9999;
    const count = (pop: number) => {
      for (const v of g.state.villages) v.pop = pop;
      const r = rng();
      let n = 0;
      for (let i = 0; i < 200; i++) if (planDisaster(g.state, r)?.kind === "plague") n++;
      return n;
    };
    expect(count(60)).toBeGreaterThan(count(3));
  });

  it("ไม่มีหมู่บ้านเลยก็ไม่มีอะไรให้กำกับ", () => {
    const g = world(5);
    g.state.villages = [];
    expect(planDisaster(g.state, fixed(0))).toBeNull();
    expect(pressure(g.state)).toBe(1);
  });

  it("ค่าที่ตั้งไว้ต้องอยู่ในช่วงที่ระบบทำงานได้จริง", () => {
    // holdAbove ที่ 0 หรือ 1 แปลว่าหยุดส่งตลอดหรือไม่เคยหยุดเลย ทั้งคู่ทำให้ผู้กำกับหายไป
    expect(balance.director.holdAbove).toBeGreaterThan(0.1);
    expect(balance.director.holdAbove).toBeLessThan(0.95);
  });
});
