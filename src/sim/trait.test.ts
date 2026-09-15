import { describe, expect, it } from "vitest";
import { createGame, stepTick } from "./index";
import { TRAITS, TRAIT_IDS, traitOf, addAwe, villageFootprint, workRadiusOf } from "./village";
import balance from "../../data/balance.json";

const world = (ticks = 0) => {
  const g = createGame(9911);
  for (let i = 0; i < ticks; i++) stepTick(g);
  return g;
};

/** คำวิจารณ์ที่ B&W โดนหนักที่สุดคือ "ไม่ได้มีปฏิสัมพันธ์กับชาวบ้านจริง"
 *  หมู่บ้านที่เหมือนกันหมดทำให้ "จะช่วยที่ไหนก่อน" เป็นการไล่เติมตัวเลข ไม่ใช่การเลือก */
describe("บุคลิกของหมู่บ้าน", () => {
  it("ทุกหมู่บ้านมีบุคลิกที่รู้จัก", () => {
    const g = world(40);
    for (const v of g.state.villages) expect(TRAIT_IDS).toContain(v.trait);
  });

  it("บุคลิกไม่เปลี่ยนตลอดชีวิตของหมู่บ้าน", () => {
    const g = world(5);
    const before = g.state.villages.map((v) => v.trait);
    for (let i = 0; i < 200; i++) stepTick(g);
    expect(g.state.villages.slice(0, before.length).map((v) => v.trait)).toEqual(before);
  });

  it("บุคลิกมาจาก id ที่สุ่มไว้แล้ว ไม่ได้กิน rng เพิ่ม — seed เดิมต้องได้โลกเดิม", () => {
    const a = createGame(31337), b = createGame(31337);
    for (let i = 0; i < 120; i++) { stepTick(a); stepTick(b); }
    expect(a.state.rngState).toBe(b.state.rngState);
    expect(a.state.villages.map((v) => v.trait)).toEqual(b.state.villages.map((v) => v.trait));
  });

  it("หมู่บ้านขี้กลัวรับปาฏิหาริย์แรงกว่าหมู่บ้านที่ขยันทำกิน", () => {
    const g = world(20);
    const v = g.state.villages[0];
    const fearful = { ...v, trait: "fearful" as const, awe: 0 };
    const hardy = { ...v, trait: "hardy" as const, awe: 0 };
    addAwe(fearful, 0.2);
    addAwe(hardy, 0.2);
    expect(fearful.awe).toBeGreaterThan(hardy.awe);
  });

  it("หมู่บ้านศรัทธาแรงมีพื้นความเชื่อสูงกว่า หมู่บ้านขยันทำกินต่ำกว่า", () => {
    expect(TRAITS.devout.faithFloor).toBeGreaterThan(TRAITS.hardy.faithFloor);
  });

  it("หมู่บ้านดื้อขยับความเชื่อช้าที่สุด", () => {
    const slowest = TRAIT_IDS.reduce((a, b) => TRAITS[a].driftMult <= TRAITS[b].driftMult ? a : b);
    expect(slowest).toBe("stubborn");
  });

  it("ตัวคูณของบุคลิกห้ามแตะอาหาร เพราะอาหารตัดสินว่ารอดไหมในโลกที่ไม่มีเทพ", () => {
    // ค่าเฉลี่ยต้องต่ำกว่า 1 ไม่งั้นเส้นฐาน "ปล่อยทิ้ง" จะถูกดันขึ้นโดยไม่มีใครตั้งใจ
    const mean = TRAIT_IDS.reduce((a, t) => a + TRAITS[t].needMult, 0) / TRAIT_IDS.length;
    expect(mean).toBeLessThanOrEqual(1);
  });

  it("บุคลิกทั้งสี่ถูกแจกจริงเมื่อมีหมู่บ้านมากพอ", () => {
    const seen = new Set<string>();
    for (let i = 0; i < TRAIT_IDS.length * 3; i++) seen.add(TRAIT_IDS[i % TRAIT_IDS.length]);
    expect(seen.size).toBe(TRAIT_IDS.length);
    expect(Object.keys(balance.village.traits)).toHaveLength(TRAIT_IDS.length);
  });

  it("traitOf คืนค่าเสมอ ไม่ว่าหมู่บ้านนั้นมาจากเซฟรุ่นไหน", () => {
    const v = { ...world(10).state.villages[0], trait: "ไม่รู้จัก" as never };
    expect(traitOf(v).name).toBeTruthy();
  });
});

/** ข้อสังเกตที่จดไว้ใน CLAUDE.md ว่า "ยังไม่ได้แก้" มาตั้งแต่ต้น:
 *  workRadius มีแค่ 2 แต่กลุ่มกระท่อมกินรัศมีถึง ~1.92 ตอนหมู่บ้านใหญ่
 *  แปลว่าหมู่บ้านยืนทับไร่ของตัวเองเกือบหมดโดยที่ไม่มีอะไรบอก */
describe("หมู่บ้านต้องไม่ยืนทับไร่ของตัวเอง", () => {
  it("รัศมีทำกินกว้างกว่ากลุ่มกระท่อมเสมอ ไม่ว่าหมู่บ้านจะใหญ่แค่ไหน", () => {
    const g = world(60);
    const v = g.state.villages[0];
    for (const pop of [5, 20, 60, 120, 400]) {
      const probe = { ...v, pop };
      expect(workRadiusOf(probe)).toBeGreaterThan(villageFootprint(probe) + 0.8);
    }
  });

  it("หมู่บ้านใหญ่ทั้งกินที่ตัวเองมากขึ้นและออกไปทำกินไกลขึ้น", () => {
    const g = world(60);
    const v = g.state.villages[0];
    const small = { ...v, pop: 5 }, big = { ...v, pop: 200 };
    expect(villageFootprint(big)).toBeGreaterThan(villageFootprint(small));
    expect(workRadiusOf(big)).toBeGreaterThan(workRadiusOf(small));
  });

  it("ชั้นภาพกับชั้นตรรกะใช้ตัวเลขชุดเดียวกัน", async () => {
    const layout = await import("../render/layout");
    const g = world(20);
    const v = g.state.villages[0];
    expect(layout.villageFootprint(v)).toBe(villageFootprint(v));
  });
});
