import { describe, expect, it } from "vitest";
import { createGame, stepTick } from "./index";
import { learnRate, smack, stroke, teach } from "./creature";
import { mulberry32 } from "../core/rng";
import balance from "../../data/balance.json";

const quiet = () => { /* เทสต์ไม่ต้องการ log */ };
const rng = () => mulberry32(7);
const warm = (ticks = 5) => {
  const g = createGame(4242);
  for (let i = 0; i < ticks; i++) stepTick(g);
  return g;
};
/** เคลียร์ความลังเลก่อน ไม่งั้นการลูบ/ตีจะไปเข้ากิ่ง "อนุญาต/ห้าม" แทน */
const idle = (g: ReturnType<typeof createGame>) => {
  g.state.creature.intent = null;
  g.state.creature.intentTicks = 0;
  g.state.creature.petCd = 0;
  return g.state.creature;
};

const P = balance.pet;

/** ใน B&W ความกลัวขวางการเรียนรู้ ความอยากรู้เร่งมัน และการลงโทษหนักเกิน
 *  ไม่ได้สอนให้เลิกทำ แต่สอนให้รอจนพระเจ้าละสายตาก่อนค่อยทำ */
describe("ใจของสัตว์", () => {
  it("ตีทั้งที่มันไม่ได้ทำอะไร กลัวหนักกว่าตีตอนที่มันทำผิดจริง", () => {
    const a = warm(); const ca = idle(a);
    ca.lastAct = "raid"; ca.fbTimer = 5;
    teach(a.state, -1, rng(), quiet);
    const justified = ca.fear;

    const b = warm(); const cb = idle(b);
    cb.lastAct = null; cb.fbTimer = 0;
    smack(b.state, rng(), quiet);
    expect(cb.fear).toBeGreaterThan(justified);
  });

  it("ยิ่งกลัวยิ่งสอนไม่เข้า", () => {
    const g = warm(); const c = idle(g);
    const calm = learnRate(c);
    c.fear = 1;
    expect(learnRate(c)).toBeLessThan(calm);
    expect(learnRate(c)).toBeGreaterThan(0);
  });

  it("ยิ่งอยากรู้ยิ่งสอนเข้าเร็ว", () => {
    const g = warm(); const c = idle(g);
    const plain = learnRate(c);
    c.curious = 1;
    expect(learnRate(c)).toBeGreaterThan(plain);
  });

  it("คำชมให้ความอยากรู้ คำดุให้ความกลัว", () => {
    const g = warm(); const c = idle(g);
    c.lastAct = "help"; c.fbTimer = 5;
    teach(g.state, 1, rng(), quiet);
    expect(c.curious).toBeGreaterThan(0);
    expect(c.fear).toBe(0);
  });

  it("ลูบเปล่าๆ ปลอบให้หายกลัวได้ — ทางเดียวที่จะกู้สัตว์ที่ถูกตีมาเกินกลับมา", () => {
    const g = warm(); const c = idle(g);
    c.fear = 0.8;
    stroke(g.state, rng(), quiet);
    expect(c.fear).toBeLessThan(0.8);
  });

  it("กลัวมากพอแล้วจะเก็บสิ่งที่อยากทำไว้ ตอนที่รู้ว่าพระเจ้ามองอยู่", () => {
    const g = warm(20); const c = idle(g);
    c.fear = 1;
    c.w.raid = 3; c.w.forage = 0.05; c.w.help = 0.05; c.w.worship = 0.05; c.w.wander = 0.05;
    g.state.attention = 50;
    let hid = false;
    for (let i = 0; i < 200 && !hid; i++) { stepTick(g); g.state.attention = 50; hid = !!c.hiding; }
    expect(hid).toBe(true);
  });

  it("พอไม่มีใครมอง มันถึงค่อยไปทำสิ่งนั้นจริง และเกมนับไว้ให้", () => {
    const g = warm(20); const c = idle(g);
    c.fear = 1;
    c.w.raid = 3; c.w.forage = 0.05; c.w.help = 0.05; c.w.worship = 0.05; c.w.wander = 0.05;
    for (let i = 0; i < 400 && g.state.deceits === 0; i++) {
      // สลับมองกับไม่มอง เหมือนคนจริงที่ไม่ได้จ้องทั้งวัน
      g.state.attention = i % 40 < 20 ? 30 : 0;
      stepTick(g);
    }
    expect(g.state.deceits).toBeGreaterThan(0);
  });

  it("สัตว์ที่ไม่กลัวไม่แอบทำอะไรเลย", () => {
    const g = warm(20); const c = idle(g);
    c.fear = 0;
    c.w.raid = 3;
    for (let i = 0; i < 400; i++) { g.state.attention = i % 40 < 20 ? 30 : 0; stepTick(g); }
    expect(g.state.deceits).toBe(0);
    expect(c.hiding).toBeNull();
  });

  it("เกณฑ์การแอบทำต้องอยู่ในช่วงที่ไปถึงได้จริง", () => {
    // ถ้าตั้งไว้เกิน 1 ระบบทั้งระบบจะไม่มีวันทำงาน และไม่มี error ให้เห็นเลย
    expect(P.deceitFearAt).toBeGreaterThan(0);
    expect(P.deceitFearAt).toBeLessThan(1);
    // ช่วงที่พระเจ้ามองต้องสั้นกว่าจังหวะที่ผู้เล่นลงมือ ไม่งั้นไม่มีช่วงว่างให้แอบทำ
    expect(P.attentionTicks).toBeLessThan(20);
  });

  it("ความกลัวจางเองตามเวลา สัตว์ที่ถูกทิ้งไว้เฉยๆ ไม่ได้กลัวไปตลอดกาล", () => {
    const g = warm(); const c = idle(g);
    c.fear = 0.9;
    for (let i = 0; i < 300; i++) stepTick(g);
    expect(c.fear).toBeLessThan(0.9);
  });
});
