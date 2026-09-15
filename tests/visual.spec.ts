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
