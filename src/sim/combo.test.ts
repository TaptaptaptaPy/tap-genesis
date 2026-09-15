import { describe, expect, it } from "vitest";
import { createGame, stepTick, castSpell } from "./index";
import { grabAt, throwTo, stepProjectiles, whatIsAt } from "./physics";
import { tileAt } from "./world";
import { mulberry32 } from "../core/rng";
import balance from "../../data/balance.json";

const quiet = () => { /* เทสต์ไม่ต้องการ log */ };
const DT = balance.time.tickSeconds;
const warm = (ticks = 8) => {
  const g = createGame(4242);
  for (let i = 0; i < ticks; i++) stepTick(g);
  g.state.faith = 4000;
  return g;
};

/** คาถาเจ็ดอันเคยทำงานแยกกันหมด ผู้เล่นจึงแค่กดอันที่ขาด ไม่ได้คิดลำดับ */
describe("คาถาคุยกัน", () => {
  it("ฝนก่อนพร ได้ดินอุดมกว่าพรเปล่าๆ", () => {
    const dry = warm(), wet = warm();
    const v = dry.state.villages[0];
    const t0 = tileAt(dry.state.tiles, v.x, v.y)!;
    t0.fert = 0.2;
    castSpell(dry.state, "bless", v.x, v.y, dry.rng, quiet);

    const v2 = wet.state.villages[0];
    const t1 = tileAt(wet.state.tiles, v2.x, v2.y)!;
    t1.fert = 0.2;
    castSpell(wet.state, "rain", v2.x, v2.y, wet.rng, quiet);
    castSpell(wet.state, "bless", v2.x, v2.y, wet.rng, quiet);

    expect(t1.fert).toBeGreaterThan(t0.fert);
    expect(wet.state.combos).toBeGreaterThan(0);
  });

  it("สายฟ้าลงพื้นเปียกไม่เผาป่า แต่ไปได้ไกลกว่า", () => {
    const g = warm();
    const v = g.state.villages[0];
    castSpell(g.state, "rain", v.x, v.y, g.rng, quiet);
    const before = g.state.combos;
    castSpell(g.state, "bolt", v.x, v.y, g.rng, quiet);
    const t = tileAt(g.state.tiles, v.x, v.y)!;
    expect(t.burn, "พื้นเปียกต้องไม่ติดไฟ").toBe(0);
    expect(g.state.combos).toBeGreaterThan(before);
  });

  it("สายฟ้าลงพื้นแห้งยังเผาเหมือนเดิม", () => {
    const g = warm();
    const v = g.state.villages[0];
    const t = tileAt(g.state.tiles, v.x, v.y)!;
    t.wet = 0;
    castSpell(g.state, "bolt", v.x, v.y, g.rng, quiet);
    expect(t.burn).toBeGreaterThan(0);
  });

  it("ป่าศักดิ์สิทธิ์บนดินเสีย ดูดพิษออกไปด้วย", () => {
    const g = warm();
    const v = g.state.villages[0];
    const t = tileAt(g.state.tiles, v.x, v.y)!;
    t.blight = 0.9;
    const before = g.state.combos;
    castSpell(g.state, "grove", v.x, v.y, g.rng, quiet);
    expect(t.blight).toBeLessThan(0.9);
    expect(g.state.combos).toBeGreaterThan(before);
  });
});

/** จุดเดียวในเกมที่ "ชาวบ้านคนหนึ่ง" ต่างจาก "ชาวบ้านอีกคน" อย่างมีผลจริง */
describe("นักบวช", () => {
  const findFolkTile = (s: ReturnType<typeof createGame>["state"]) => {
    for (let y = 1; y < balance.world.H - 1; y++)
      for (let x = 1; x < balance.world.W - 1; x++)
        if (whatIsAt(tileAt(s.tiles, x, y)) === "folk") return { x, y };
    return null;
  };

  it("อุ้มขึ้นมาแล้ววางคืนถึงบ้าน คนคนนั้นกลายเป็นนักบวช", () => {
    const g = warm();
    const spot = findFolkTile(g.state)!;
    const v = g.state.villages[0];
    expect(grabAt(g.state, spot.x, spot.y, quiet)).toBe("folk");
    expect(throwTo(g.state, v.x, v.y, quiet)).toBe(true);
    for (let i = 0; i < 900 && g.state.thrown.length; i++)
      stepProjectiles(g.state, DT, mulberry32(3), quiet);
    expect(v.folk.some((f) => f.priest), "คนที่ถูกวางคืนต้องกลายเป็นนักบวช").toBe(true);
  });

  it("นักบวชต้องไม่ถูกตัดทิ้งก่อนคนธรรมดาตอนประชากรลด", () => {
    const g = warm();
    const v = g.state.villages[0];
    for (const f of v.folk) f.priest = false;
    v.folk[v.folk.length - 1].priest = true;   // คนท้ายสุด = คนที่เพิ่งถูกวางคืน
    v.pop = 8;                                  // ประชากรลด ต้องตัดคนออก
    for (let i = 0; i < 4; i++) stepTick(g);
    expect(v.folk.some((f) => f.priest),
      "putFolk() ต่อคนไว้ท้ายรายการ ถ้าตัดจากท้ายดื้อๆ นักบวชจะหายก่อนใครเพื่อน").toBe(true);
  });
});
