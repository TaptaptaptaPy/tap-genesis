import { describe, expect, it } from "vitest";
import { createGame, stepTick } from "./index";
import { stroke, smack, teach } from "./creature";
import { mulberry32 } from "../core/rng";
import balance from "../../data/balance.json";

const quiet = () => { /* เทสต์ไม่ต้องการ log */ };
const rng = () => mulberry32(7);
const warm = (ticks = 5) => {
  const g = createGame(4242);
  for (let i = 0; i < ticks; i++) stepTick(g);
  return g;
};
/** ล้างทั้งความลังเลและช่วงเวลาที่ตัดสินได้ ให้เหลือแค่ "ลูบเปล่าๆ"
 *  ตอนนี้สัตว์ลังเลก่อนลงมือทุกครั้ง ถ้าไม่ล้าง `intent` ด้วย
 *  การลูบจะกลายเป็นการ "อนุญาต" ไม่ใช่การลูบเฉยๆ */
const idle = (g: ReturnType<typeof createGame>) => {
  g.state.creature.lastAct = null;
  g.state.creature.fbTimer = 0;
  g.state.creature.petCd = 0;
  g.state.creature.intent = null;
  g.state.creature.intentTicks = 0;
};

/** ก่อนหน้านี้ความผูกพันขยับได้ทางเดียวคือผ่าน teach() ซึ่งใช้ได้เฉพาะตอนมีอะไรให้ตัดสิน
 *  แปลว่าตลอดเวลาที่เหลือไม่มีทางแสดงความรักกับมันเลย */
describe("ลูบและตี", () => {
  it("ลูบตอนมันไม่ได้ทำอะไร เพิ่มความผูกพันโดยไม่สอนอะไร", () => {
    const g = warm(); idle(g);
    const c = g.state.creature;
    const before = c.bond;
    const w = { ...c.w };
    expect(stroke(g.state, rng(), quiet)).toBe(true);
    expect(c.bond).toBeGreaterThan(before);
    expect(c.w, "ลูบเปล่าๆ ต้องไม่ไปขยับน้ำหนักของการกระทำใด").toEqual(w);
  });

  it("ลูบตอนมันเพิ่งทำอะไร นับเป็นคำชม — ความรักกับการสอนไม่ได้แยกกันเสมอ", () => {
    const g = warm();
    const c = g.state.creature;
    c.intent = null;
    c.lastAct = "raid";
    c.fbTimer = 10;
    c.petCd = 0;
    const before = c.w.raid;
    stroke(g.state, rng(), quiet);
    expect(c.w.raid, "ลูบตอนมันเพิ่งบุกหมู่บ้าน = บอกว่าที่ทำนั้นดีแล้ว")
      .toBeGreaterThan(before);
  });

  it("ยิ่งผูกพันแล้ว ลูบเพิ่มได้น้อยลง — ซื้อความไว้ใจด้วยการลูบรัวๆ ไม่ได้", () => {
    const g = warm(); idle(g);
    const c = g.state.creature;
    c.bond = 0.1;
    stroke(g.state, rng(), quiet);
    const low = c.bond - 0.1;
    c.bond = 0.9; c.petCd = 0;
    stroke(g.state, rng(), quiet);
    const high = c.bond - 0.9;
    expect(high).toBeLessThan(low);
  });

  it("ตีตอนมันไม่ได้ทำอะไร มันจำได้แค่ว่าตรงนี้เจ็บ — เป็นการสอนที่ผิด", () => {
    const g = warm(); idle(g);
    const c = g.state.creature;
    const tile = Math.floor(c.y) * balance.world.W + Math.floor(c.x);
    const before = c.bond;
    expect(smack(g.state, rng(), quiet)).toBe(true);
    expect(c.bond).toBeLessThan(before);
    expect(c.mem?.[tile] ?? 0, "ต้องจำว่าตรงนี้ไม่ปลอดภัย").toBeLessThan(0);
  });

  it("ลูบรัวๆ ไม่ได้ ต้องรอจังหวะ", () => {
    const g = warm(); idle(g);
    expect(stroke(g.state, rng(), quiet)).toBe(true);
    expect(stroke(g.state, rng(), quiet), "ยังติดคูลดาวน์").toBe(false);
    for (let i = 0; i < balance.pet.strokeCooldownTicks + 1; i++) stepTick(g);
    g.state.creature.lastAct = null; g.state.creature.fbTimer = 0;
    expect(stroke(g.state, rng(), quiet)).toBe(true);
  });

  it("สัตว์ที่ตายแล้วลูบไม่ได้ ตีไม่ได้", () => {
    const g = warm();
    g.state.creature.alive = false;
    expect(stroke(g.state, rng(), quiet)).toBe(false);
    expect(smack(g.state, rng(), quiet)).toBe(false);
    void teach;
  });
});

/** ความลังเลคือช่วงที่ผู้เล่นยังห้ามได้ทัน — ต่างจากการดุทีหลังโดยสิ้นเชิง */
describe("ห้ามไว้ก่อน", () => {
  it("ตีตอนมันกำลังจะทำ = ห้ามไว้ทัน มันเลิกคิดและเรียนว่าอย่าทำอีก", () => {
    const g = warm(); idle(g);
    const c = g.state.creature;
    c.intent = "raid"; c.intentTicks = 3; c.act = "raid";
    const before = c.w.raid;
    expect(smack(g.state, rng(), quiet)).toBe(true);
    expect(c.w.raid, "น้ำหนักของสิ่งที่ถูกห้ามต้องลด").toBeLessThan(before);
    expect(c.intent, "ห้ามแล้วต้องเลิกคิด").toBeNull();
    expect(c.act).toBeNull();
  });

  it("ลูบตอนมันกำลังจะทำ = อนุญาต มันมั่นใจขึ้น", () => {
    const g = warm(); idle(g);
    const c = g.state.creature;
    c.intent = "help"; c.intentTicks = 3;
    const before = c.w.help;
    expect(stroke(g.state, rng(), quiet)).toBe(true);
    expect(c.w.help).toBeGreaterThan(before);
    expect(c.intentTicks, "อนุญาตแล้วต้องลงมือได้เลย").toBe(0);
  });

  it("ยิ่งผูกพันยิ่งลังเลนาน — มันแคร์ว่าเราจะว่ายังไง", () => {
    const shy = createGame(4242), bold = createGame(4242);
    for (let i = 0; i < 3; i++) { stepTick(shy); stepTick(bold); }
    shy.state.creature.bond = 0.95;
    bold.state.creature.bond = 0.05;
    shy.state.creature.intent = null; bold.state.creature.intent = null;
    shy.state.creature.act = null; bold.state.creature.act = null;
    for (let i = 0; i < 2; i++) { stepTick(shy); stepTick(bold); }
    expect(shy.state.creature.intentTicks)
      .toBeGreaterThanOrEqual(bold.state.creature.intentTicks);
  });
});
