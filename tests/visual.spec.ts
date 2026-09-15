import { expect, test } from "@playwright/test";

/** โลกเดิมทุกครั้ง เวลาหยุดนิ่ง — ไม่งั้นเทียบภาพไม่ได้เลย */
const world = (seed: number, t: number) => `/?seed=${seed}&t=${t}`;

/** รอจนฉากแรกถูกวาดจริง ไม่ใช่แค่ DOM พร้อม
 *  canvas ว่างเปล่ากับ canvas ที่มีเกาะอยู่ ทั้งคู่ผ่าน load event เหมือนกัน */
async function ready(page: import("@playwright/test").Page) {
  await page.waitForFunction(() => {
    const g = (window as any).__genesis;
    return !!g && g.game.state.villages.length > 0;
  });
  // โมเดลสัตว์โหลดแบบ async ถ้าไม่รอ ภาพจะจับตอนที่ยังไม่มีสัตว์บนเกาะ
  await page.waitForFunction(() => (window as any).__genesis?.creatureReady === true
    && (window as any).__genesis?.propsReady === true);
  await page.waitForTimeout(400);
}

test("เกาะตอนสาย — แสงต้องไม่ไล่ทุ่งหญ้าขึ้นขาว", async ({ page }) => {
  await page.goto(world(20260915, 0.3));
  await ready(page);
  await expect(page).toHaveScreenshot("island-morning.png");
});

test("เกาะตอนเที่ยง — จุดที่แสงแรงที่สุดของทั้งวัน", async ({ page }) => {
  await page.goto(world(20260915, 0.25));
  await ready(page);
  await expect(page).toHaveScreenshot("island-noon.png");
});

test("เกาะตอนกลางคืน — ต้องยังมองออกว่าอะไรอยู่ตรงไหน", async ({ page }) => {
  await page.goto(world(20260915, 0.75));
  await ready(page);
  await expect(page).toHaveScreenshot("island-night.png");
});

test("โลกคนละ seed ต้องหน้าตาไม่เหมือนกัน", async ({ page }) => {
  await page.goto(world(7, 0.3));
  await ready(page);
  await expect(page).toHaveScreenshot("island-seed7.png");
});

test("เปิดเกมแล้วต้องไม่มี error ใน console", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(world(20260915, 0.3));
  await ready(page);
  expect(errors).toEqual([]);
});

test("สัตว์ระยะใกล้ — ต้องเป็นตัวที่มีรูปร่างจริง ไม่ใช่ก้อน", async ({ page }) => {
  // ภาพเกาะทั้งใบจับการเปลี่ยนแปลงของสัตว์ไม่ได้ มันเล็กกว่าเกณฑ์ความต่างที่ยอมให้
  // ต้องซูมลงไปหาตัวมันโดยเฉพาะ ไม่งั้นเปลี่ยนโมเดลทั้งตัวแล้วเทสต์ยังขึ้นเขียว
  await page.goto(world(20260915, 0.3));
  await ready(page);
  await page.evaluate(() => {
    const g = (window as any).__genesis, w = g.world;
    // ใช้ตำแหน่งที่ "วาดจริง" ของสัตว์ ไม่ใช่พิกัดช่องจาก state
    // เพราะความสูงของพื้นตรงนั้นอยู่ในชั้นภาพ ไม่ได้อยู่ใน state
    const p = g.creature.root.position;
    // ตั้งกล้องตรงๆ ไม่ผ่าน focusOn เพราะมันหน่วงระยะไว้ที่ 7 หน่วย
    // ซึ่งไกลเกินไปสำหรับตัวที่สูงไม่ถึงหนึ่งหน่วย
    w.center.set(p.x, p.y + 0.45, p.z);
    w.targetCenter?.set?.(p.x, p.y + 0.45, p.z);
    w.distance = w.targetDistance = 2.6;
    w.elevation = 0.42;
    w.azimuth = Math.PI * 0.3;
  });
  await page.waitForTimeout(900);
  await expect(page).toHaveScreenshot("creature-close.png", { maxDiffPixelRatio: 0.004 });
});

test("หมู่บ้านระยะใกล้ — กระท่อมต้องเป็นทรงที่ดูออกว่าเป็นที่อยู่", async ({ page }) => {
  // เหตุผลเดียวกับภาพสัตว์: ของเล็กต้องมีภาพของตัวเอง ไม่งั้นเปลี่ยนไปก็ไม่มีใครรู้
  await page.goto(world(20260915, 0.3));
  await ready(page);
  await page.evaluate(() => {
    const g = (window as any).__genesis, w = g.world;
    const v = g.game.state.villages[0];
    const e = g.villages.group.children[0];
    w.center.set(e.position.x, e.position.y + 0.5, e.position.z);
    w.targetCenter?.set?.(e.position.x, e.position.y + 0.5, e.position.z);
    w.distance = w.targetDistance = 4.2;
    w.elevation = 0.5;
    w.azimuth = Math.PI * 0.25;
    void v;
  });
  await page.waitForTimeout(900);
  await expect(page).toHaveScreenshot("village-close.png", { maxDiffPixelRatio: 0.004 });
});
