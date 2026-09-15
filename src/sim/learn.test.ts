import { describe, expect, it } from "vitest";
import { createGame, stepTick } from "./index";
import { teach } from "./creature";
import { mulberry32 } from "../core/rng";
import balance from "../../data/balance.json";

const quiet = () => { /* เทสต์ไม่ต้องการ log */ };
const rng = () => mulberry32(11);
const warm = (ticks = 10) => {
  const g = createGame(2024);
  for (let i = 0; i < ticks; i++) stepTick(g);
  return g;
};

/** ใน B&W สัตว์เรียนจากการดูทั้งพระเจ้า *และชาวบ้าน*
 *  ของเดิมที่นี่เรียนจากคาถาของเราได้อย่างเดียว ซึ่งแปลว่าตลอดเวลาที่เหลือมันอยู่
 *  ท่ามกลางคนที่กำลังทำอะไรอยู่เต็มไปหมด โดยไม่ได้อะไรจากตรงนั้นเลย */
describe("เรียนจากการดูชาวบ้าน", () => {
  it("ยืนอยู่กลางหมู่บ้านที่คนกำลังสวด แล้วอยากสวดตาม", () => {
    const g = warm(30);
    const v = g.state.villages[0];
    const c = g.state.creature;
    c.x = v.x; c.y = v.y;
    for (const f of v.folk) f.job = "pray";
    if (!v.folk.length) return;
    const before = c.w.worship;
    for (let i = 0; i < 60; i++) { c.x = v.x; c.y = v.y; stepTick(g); for (const f of v.folk) f.job = "pray"; }
    expect(c.w.worship).toBeGreaterThan(before);
  });

  it("อยู่ไกลหมู่บ้านก็ไม่เห็นใครทำอะไร", () => {
    const g = warm(30);
    const c = g.state.creature;
    const before = { ...c.w };
    // ย้ายหมู่บ้านทั้งหมดออกไปให้พ้นรัศมีมอง
    for (const v of g.state.villages) { v.x = 0; v.y = 0; for (const f of v.folk) f.job = "pray"; }
    c.x = 40; c.y = 28;
    for (let i = 0; i < 40; i++) { c.x = 40; c.y = 28; c.act = null; c.tgt = null; stepTick(g); }
    expect(c.w.worship).toBeLessThanOrEqual(before.worship + 0.001);
  });

  it("การดูชาวบ้านช้ากว่าการดูคาถาของพระเจ้ามาก — มันคือการซึมซับ ไม่ใช่การสอน", () => {
    expect(balance.imitate.folkRate).toBeLessThan(balance.imitate.learnRate);
  });
});

/** ท่าหลายขั้น ("ปลูกป่าแล้วรดน้ำ") เป็นของที่ B&W โชว์บ่อยที่สุด
 *  และเป็นสิ่งที่แยกการฝึกจริงออกจากการกดปุ่มชม/ดุ */
describe("ท่าหลายขั้น", () => {
  const praisePair = (g: ReturnType<typeof createGame>, from: string, then: string) => {
    const c = g.state.creature;
    const r = rng();
    for (let i = 0; i < balance.pet.chainPraises; i++) {
      c.pairFrom = from as never;
      c.lastAct = then as never;
      c.fbTimer = 5;
      teach(g.state, 1, r, quiet);
    }
  };

  it("ชมสองครั้งติดที่คู่เดิม แล้วมันเรียนว่าให้ทำต่อกัน", () => {
    const g = warm();
    praisePair(g, "help", "worship");
    expect(g.state.creature.chain["help"]).toBe("worship");
  });

  it("ชมไม่ครบเกณฑ์ยังไม่พอ — ไม่งั้นบังเอิญได้", () => {
    const g = warm();
    const c = g.state.creature;
    c.pairFrom = "help"; c.lastAct = "worship"; c.fbTimer = 5;
    teach(g.state, 1, rng(), quiet);
    expect(c.chain["help"]).toBeUndefined();
  });

  it("ชมคนละคู่สลับไปด้วยก็ยังนับสะสมได้ — คนสอนจริงไม่ได้ชมแต่คู่เดียว", () => {
    const g = warm();
    const c = g.state.creature;
    const r = rng();
    for (let i = 0; i < balance.pet.chainPraises; i++) {
      c.pairFrom = "help"; c.lastAct = "worship"; c.fbTimer = 5; teach(g.state, 1, r, quiet);
      c.pairFrom = "forage"; c.lastAct = "wander"; c.fbTimer = 5; teach(g.state, 1, r, quiet);
    }
    expect(c.chain["help"]).toBe("worship");
  });

  it("แต่ละคู่นับแยกกัน ชมคู่อื่นไม่ได้ช่วยคู่นี้", () => {
    const g = warm();
    const c = g.state.creature;
    const r = rng();
    for (let i = 0; i < balance.pet.chainPraises; i++) {
      c.pairFrom = "forage"; c.lastAct = "wander"; c.fbTimer = 5; teach(g.state, 1, r, quiet);
    }
    expect(c.chain["help"]).toBeUndefined();
  });

  it("ดุไม่ได้สอนท่าต่อเนื่อง", () => {
    const g = warm();
    const c = g.state.creature;
    const r = rng();
    for (let i = 0; i < 5; i++) { c.pairFrom = "help"; c.lastAct = "raid"; c.fbTimer = 5; teach(g.state, -1, r, quiet); }
    expect(c.chain["help"]).toBeUndefined();
  });

  it("เรียนแล้วมันทำต่อจริง ไม่ใช่แค่จดไว้", () => {
    const g = warm(30);
    const c = g.state.creature;
    c.chain["help"] = "worship";
    c.lastAct = "help";
    c.act = null; c.tgt = null; c.chainDone = null;
    c.intent = null; c.intentTicks = 0;
    stepTick(g);
    expect(c.act).toBe("worship");
  });

  it("ต่อได้ครั้งเดียวต่อหนึ่งรอบ ไม่วนเป็นลูปไม่รู้จบ", () => {
    const g = warm(30);
    const c = g.state.creature;
    c.chain["help"] = "help";
    c.lastAct = "help"; c.chainDone = "help";
    c.act = null; c.tgt = null;
    stepTick(g);
    // ต้องไปเข้าทางตัดสินใจปกติ ไม่ใช่ต่อซ้ำทันที
    expect(c.chainDone).toBe("help");
  });
});
