import { expect, test } from "@playwright/test";

/** ท่าทางของสัตว์ต้องมาจากสิ่งที่มันกำลังทำจริง ไม่ใช่ภาพประกอบ
 *
 *  นี่คือข้อที่สำคัญกว่าภาพนิ่ง ภาพบอกได้แค่ว่า "ตอนนี้หน้าตาแบบนี้"
 *  แต่ไม่ได้บอกว่าพอสัตว์เปลี่ยนไปทำอย่างอื่นแล้วภาพเปลี่ยนตามไหม
 *  ถ้าตารางท่าใน data/models.json สะกดผิดสักชื่อ มันจะเงียบสนิท — ข้อนี้จะจับได้
 */
test("เปลี่ยนสิ่งที่สัตว์ทำ แล้วท่าต้องเปลี่ยนตาม", async ({ page }) => {
  await page.goto("/?seed=20260915&t=0.3");
  await page.waitForFunction(() => (window as any).__genesis?.creatureReady === true);

  const seen = await page.evaluate(async () => {
    const g = (window as any).__genesis;
    const s = g.game.state, c = s.creature, cr = g.creature;
    const out: Record<string, string> = {};
    const step = (label: string, set: () => void) => {
      set();
      cr.update(s, c, performance.now(), 1 / 60);
      out[label] = cr.playing;
    };
    step("ยืนเฉยๆ",    () => { c.alive = true; c.tgt = null; c.act = null; c.need = "content"; });
    step("เหนื่อย",     () => { c.need = "tired"; });
    step("เดินไปหาของ", () => { c.need = "content"; c.tgt = { x: 5, y: 5 }; });
    step("กินอาหาร",    () => { c.tgt = null; c.act = "forage"; });
    step("บุกหมู่บ้าน",  () => { c.act = "raid"; });
    step("ร่ายรำบูชา",   () => { c.act = "worship"; });
    step("ตาย",         () => { c.alive = false; });
    return out;
  });

  expect(seen["ยืนเฉยๆ"]).toBe("Idle");
  expect(seen["เหนื่อย"]).toBe("Idle_Headlow");
  expect(seen["เดินไปหาของ"]).toBe("Gallop");
  expect(seen["กินอาหาร"]).toBe("Eating");
  expect(seen["บุกหมู่บ้าน"]).toBe("Attack_Headbutt");
  expect(seen["ร่ายรำบูชา"]).toBe("Idle_2");
  expect(seen["ตาย"]).toBe("Death");

  // ทุกท่าที่ตารางอ้างถึงต้องมีอยู่จริงในไฟล์โมเดล
  const missing = await page.evaluate(async () => {
    const g = (window as any).__genesis;
    const models = await import("/data/models.json");
    const have = new Set(Object.keys((g.creature as any).rig?.actions ?? {}));
    return Object.values(models.default.creature.clips).filter((n) => !have.has(n as string));
  });
  expect(missing, "ตารางท่าอ้างถึงท่าที่ไม่มีในไฟล์").toEqual([]);
});
