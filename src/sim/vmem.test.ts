import { describe, expect, it } from "vitest";
import { createGame, stepTick } from "./index";
import { teach, recallVillage, rememberVillage } from "./creature";
import { mulberry32 } from "../core/rng";

const quiet = () => { /* เทสต์ไม่ต้องการ log */ };
const rng = () => mulberry32(5);
const warm = (n = 6) => { const g = createGame(4242); for (let i = 0; i < n; i++) stepTick(g); return g; };

/** ความทรงจำเรื่อง "ช่อง" บอกว่าตรงไหนมีของกิน
 *  ความทรงจำเรื่อง "หมู่บ้าน" บอกว่าคนกลุ่มไหนสำคัญ — คนละเรื่องกันโดยสิ้นเชิง */
describe("สัตว์จำหมู่บ้านได้", () => {
  it("ชมตอนมันช่วยหมู่บ้านไหน มันจำหมู่บ้านนั้นไว้", () => {
    const g = warm();
    const c = g.state.creature;
    const v = g.state.villages[0];
    c.lastAct = "help"; c.lastTile = 0; c.lastVillage = v.id; c.fbTimer = 10;
    expect(recallVillage(c, v.id)).toBe(0);
    teach(g.state, 1, rng(), quiet);
    expect(recallVillage(c, v.id), "ชมแล้วต้องจำหมู่บ้านนั้นในทางบวก").toBeGreaterThan(0);
  });

  it("ดุตอนมันบุกหมู่บ้านไหน มันจำหมู่บ้านนั้นในทางลบ", () => {
    const g = warm();
    const c = g.state.creature;
    const v = g.state.villages[0];
    c.lastAct = "raid"; c.lastTile = 0; c.lastVillage = v.id; c.fbTimer = 10;
    teach(g.state, -1, rng(), quiet);
    expect(recallVillage(c, v.id)).toBeLessThan(0);
  });

  it("หาอาหารกับเดินเล่นไม่เกี่ยวกับใคร จึงไม่ผูกกับหมู่บ้าน", () => {
    const g = warm();
    const c = g.state.creature;
    c.lastAct = "forage"; c.lastTile = 0; c.lastVillage = -1; c.fbTimer = 10;
    teach(g.state, 1, rng(), quiet);
    expect(Object.keys(c.vmem).length, "ไม่ควรมีหมู่บ้านไหนถูกจำจากการหาอาหาร").toBe(0);
  });

  it("ความทรงจำเรื่องหมู่บ้านแยกจากความทรงจำเรื่องช่องจริงๆ", () => {
    const g = warm();
    const c = g.state.creature;
    rememberVillage(c, 0, 1);
    expect(Object.keys(c.mem).length, "แตะ vmem ต้องไม่ไปแตะ mem").toBe(
      Object.keys(c.mem).length);
    expect(recallVillage(c, 0)).toBeGreaterThan(0);
    expect(recallVillage(c, 99), "หมู่บ้านที่ไม่เคยเจอต้องเป็นศูนย์").toBe(0);
  });

  it("ความทรงจำไม่ทะลุช่วง -1 ถึง 1", () => {
    const g = warm();
    const c = g.state.creature;
    for (let i = 0; i < 80; i++) rememberVillage(c, 3, 1);
    expect(recallVillage(c, 3)).toBeLessThanOrEqual(1);
    for (let i = 0; i < 160; i++) rememberVillage(c, 3, -1);
    expect(recallVillage(c, 3)).toBeGreaterThanOrEqual(-1);
  });
});

/** สืบทอดมีอยู่แล้วแต่เป็นค่าคงที่ ปัญญาจึงมีผลแค่กับความเร็วเรียนของตัวมันเอง
 *  ตอนนี้ปัญญาเป็นตัวกำหนดว่าส่งต่อได้เท่าไร — การเพาะปัญญาจึงมีความหมายข้ามรุ่น */
describe("สืบทอดข้ามรุ่น", () => {
  const killAndRevive = (intel: number) => {
    const g = createGame(4242);
    for (let i = 0; i < 6; i++) stepTick(g);
    const c = g.state.creature;
    c.genes.intel = intel;
    rememberVillage(c, 0, 1);
    c.mem[5] = 1;
    c.alive = false;
    c.respawnIn = 1;
    for (let i = 0; i < 3; i++) stepTick(g);
    return g.state.creature;
  };

  it("สัตว์ฉลาดส่งต่อความทรงจำได้มากกว่าสัตว์ทึ่ม", () => {
    const dull = killAndRevive(0.05);
    const smart = killAndRevive(0.95);
    expect(smart.mem[5]).toBeGreaterThan(dull.mem[5]);
    expect(smart.vmem[0]).toBeGreaterThan(dull.vmem[0]);
  });

  it("ความทรงจำเรื่องหมู่บ้านต้องข้ามรุ่นมาด้วย ไม่ใช่หายไปเฉยๆ", () => {
    const nc = killAndRevive(0.8);
    expect(nc.vmem[0], "รุ่นใหม่ต้องยังจำได้ว่าเคยช่วยหมู่บ้านนั้น").toBeGreaterThan(0);
  });

  it("รุ่นใหม่ต้องเป็นรุ่นถัดไป ไม่ใช่ตัวเดิม", () => {
    const nc = killAndRevive(0.5);
    expect(nc.gen).toBeGreaterThan(1);
    expect(nc.alive).toBe(true);
  });
});
