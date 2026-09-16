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

/** ทำให้หมู่บ้านมีคนเยอะและ *เดินออกมาถึงที่หมายแล้ว*
 *  ชาวบ้านเกิดที่ใจกลางหมู่บ้านแล้วค่อยเดินออก ถ้าเดินเวลาแค่ 60 tick
 *  ทุกคนยังอยู่กลางกองกระท่อมและถูกหลังคาบังหมด (วัดได้: กระท่อมกินเฟรม 65% คนกิน 0%) */
async function crowd(page: import("@playwright/test").Page, ticks = 260) {
  await page.evaluate((n) => {
    const g = (window as any).__genesis;
    for (let i = 0; i < n; i++) {
      for (const v of g.game.state.villages) v.pop = Math.max(v.pop, 60);
      g.step(1);
    }
  }, ticks);
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

  // สัตว์เกิดตรงไหนก็ได้ รวมถึงกลางป่า — แล้วภาพนี้จะได้แต่พุ่มไม้
  // ย้ายมันไปยืนที่โล่งก่อนเสมอ เพราะเทสต์นี้ถ่าย *ตัวสัตว์* ไม่ได้ถ่ายที่ที่มันบังเอิญยืนอยู่
  const spot = await page.evaluate(() => {
    const g = (window as any).__genesis;
    const s = g.game.state;
    const tree = (t: any) => t.biome === "FOREST" || t.biome === "LUSH";
    const near = (t: any, f: (u: any) => boolean, r: number) =>
      s.tiles.some((u: any) => f(u) && Math.abs(u.x - t.x) <= r && Math.abs(u.y - t.y) <= r);
    const open = s.tiles.filter((t: any) =>
      (t.biome === "GRASS" || t.biome === "HILL") && !t.village
      && !near(t, tree, 3) && !near(t, (u: any) => !!u.village, 3));
    if (!open.length) return null;
    // เลือกช่องที่ใกล้ที่มันยืนอยู่ที่สุด ภาพจะได้ยังเป็นมุมเดิมของเกาะ
    const c = s.creature;
    open.sort((a: any, b: any) =>
      (a.x - c.x) ** 2 + (a.y - c.y) ** 2 - ((b.x - c.x) ** 2 + (b.y - c.y) ** 2));
    c.x = open[0].x; c.y = open[0].y; c.tgt = null; c.facing = 0.8;
    return { x: c.x, y: c.y };
  });
  expect(spot, "ทั้งเกาะไม่มีที่โล่งให้สัตว์ยืนเลย").not.toBeNull();
  // ท่าทางเดินต่อทุกเฟรมแม้เวลาของเกมจะหยุด ถ้าไม่ตรึงไว้ ภาพจะไม่ซ้ำกันสองรอบ
  await page.evaluate(() => (window as any).__genesis.freeze(1.7));
  await page.waitForTimeout(300);

  await page.evaluate(() => {
    const g = (window as any).__genesis, w = g.world;
    // ใช้ตำแหน่งที่ "วาดจริง" ของสัตว์ ไม่ใช่พิกัดช่องจาก state
    // เพราะความสูงของพื้นตรงนั้นอยู่ในชั้นภาพ ไม่ได้อยู่ใน state
    const p = g.creature.root.position;
    // ตั้งกล้องตรงๆ ไม่ผ่าน focusOn เพราะมันหน่วงระยะไว้ที่ 7 หน่วย
    // ซึ่งไกลเกินไปสำหรับตัวที่สูงไม่ถึงหนึ่งหน่วย
    w.center.set(p.x, p.y + 0.45, p.z);
    w.targetCenter?.set?.(p.x, p.y + 0.45, p.z);
    w.distance = w.targetDistance = 2.0;
    w.elevation = 0.42;
    w.azimuth = Math.PI * 0.3;
  });
  await page.waitForTimeout(900);

  // ตัวนับที่ขาดไปตลอด: ภาพนิ่งไม่ได้แปลว่าสัตว์อยู่ในภาพ
  // เคยเป็นภาพพุ่มไม้ล้วนอยู่หลายรอบโดยเทสต์ขึ้นเขียวทุกครั้ง
  const seen = await page.evaluate(() => {
    const g = (window as any).__genesis;
    return g.creature.body ? (g.world.coverage(g.creature.body) as number) : 0;
  });
  console.log(`สัตว์กินพื้นที่ ${(seen * 100).toFixed(2)}% ของเฟรม`);
  expect(seen, "ถ่ายภาพระยะใกล้ของสัตว์แล้วไม่มีสัตว์อยู่ในเฟรม").toBeGreaterThan(0.02);

  await expect(page).toHaveScreenshot("creature-close.png", { maxDiffPixelRatio: 0.004 });
});

test("หมู่บ้านระยะใกล้ — กระท่อมต้องเป็นทรงที่ดูออกว่าเป็นที่อยู่", async ({ page }) => {
  // เหตุผลเดียวกับภาพสัตว์: ของเล็กต้องมีภาพของตัวเอง ไม่งั้นเปลี่ยนไปก็ไม่มีใครรู้
  await page.goto(world(20260915, 0.3));
  await ready(page);
  // เดินเวลาให้ชาวบ้านออกมาเดินก่อน ไม่งั้นหมู่บ้านจะว่างเปล่า
  await crowd(page);
  await page.evaluate(() => {
    const g = (window as any).__genesis, w = g.world;
    const v = g.game.state.villages[0];
    const e = g.villages.group.children[0];
    w.center.set(e.position.x, e.position.y + 0.5, e.position.z);
    w.targetCenter?.set?.(e.position.x, e.position.y + 0.5, e.position.z);
    w.distance = w.targetDistance = 7.5;
    w.elevation = 0.72;
    w.azimuth = Math.PI * 0.25;
    void v;
  });
  await page.waitForTimeout(900);
  await expect(page).toHaveScreenshot("village-close.png", { maxDiffPixelRatio: 0.004 });
});

test("ชาวบ้านระยะใกล้ — ต้องดูออกว่าเป็นคน และไม่ใช่คนเดียวกันทุกตัว", async ({ page }) => {
  // ภาพหมู่บ้านถ่ายจากระยะ 7.5 หน่วย ซึ่งคนสูง 0.3 หน่วยกินพื้นที่ไม่กี่สิบพิกเซล
  // เปลี่ยนสีเสื้อทั้งหมู่บ้านแล้วภาพนั้นยังขึ้นเขียวได้สบาย — ของเล็กต้องมีภาพของตัวเอง
  await page.goto(world(20260915, 0.3));
  await ready(page);
  await crowd(page);
  // ท่าทางเดินต่อทุกเฟรมแม้เวลาของเกมจะหยุด ถ้าไม่ตรึงไว้ ภาพจะไม่ซ้ำกันสองรอบ
  await page.evaluate(() => (window as any).__genesis.freeze(1.7));
  await page.waitForTimeout(400);

  const many = await page.evaluate(() => {
    const g = (window as any).__genesis, w = g.world;
    const v = g.game.state.villages[0];
    // `roots` เรียงตามลำดับเดียวกับที่วนใน `update()` คือหมู่บ้านแรกมาก่อน
    // ถ้าไม่ตัดให้เหลือเฉพาะหมู่บ้านแรก "คนที่ไกลใจกลางที่สุด" จะกลายเป็นคนของหมู่บ้านอื่น
    const mine = (g.villagers.roots as any[]).slice(0, v.folk.length);
    let best = mine[0], far = -1;
    for (const r of mine) {
      const d = (r.position.x - v.x - 0.5) ** 2 + (r.position.z - v.y - 0.5) ** 2;
      if (d > far) { far = d; best = r; }
    }
    (window as any).__shot = best;   // เทสต์วัดคนคนเดียวกับที่เล็งกล้องไว้
    const p = best.position;
    w.center.set(p.x, p.y + 0.16, p.z);
    w.targetCenter?.set?.(p.x, p.y + 0.16, p.z);
    w.distance = w.targetDistance = 2.0;
    // ระยะ × sin(มุมเงย) ต้องมากกว่า 1.1 ไม่งั้นกฎกันกล้องมุดดินจะดันกล้องขึ้น
    // แล้วมุมจริงจะชันกว่าที่ตั้งไว้มาก จนคนยืนอ่านออกมาเป็นคนนอนคว่ำ
    w.elevation = 0.62;
    return mine.length;
  });
  expect(many, "หมู่บ้านไม่มีคนให้ถ่าย").toBeGreaterThan(2);

  // กระท่อม ต้นไม้ และเนินเขาบังคนได้หมด และ "ด้านไหนโล่ง" เปลี่ยนทุกครั้งที่แก้ผังหมู่บ้าน
  // ถามภาพเองว่ามุมไหนเห็นคนมากที่สุด แทนที่จะเดามุมไว้ตายตัวแล้วมารู้ทีหลังว่าถ่ายติดหลังคา
  let bestSeen = 0;
  for (let i = 0; i < 8; i++) {
    await page.evaluate((a) => { (window as any).__genesis.world.azimuth = a; }, (i / 8) * Math.PI * 2);
    await page.waitForTimeout(60);
    const seen = await page.evaluate(() => {
      const g = (window as any).__genesis;
      return { a: g.world.azimuth, cov: g.world.coverage((window as any).__shot) as number };
    });
    if (seen.cov > bestSeen) { bestSeen = seen.cov; await page.evaluate((a) => {
      (window as any).__best = a; }, seen.a); }
  }
  await page.evaluate(() => { (window as any).__genesis.world.azimuth = (window as any).__best; });
  await page.waitForTimeout(900);

  console.log(`ชาวบ้านที่ถ่ายกินพื้นที่ ${(bestSeen * 100).toFixed(2)}% ของเฟรม`);
  // คนสูง 0.3 หน่วยที่ระยะ 2 กับ fov 42° กินพื้นที่ราว 0.7% ของเฟรม
  // ตั้งขีดไว้ครึ่งหนึ่งของนั้น — ต่ำกว่านี้แปลว่ามีอะไรมาบังไปแล้วค่อนตัว
  expect(bestSeen, "หันกล้องครบแปดทิศแล้วยังไม่เห็นชาวบ้านสักมุม").toBeGreaterThan(0.0035);

  await expect(page).toHaveScreenshot("folk-close.png", { maxDiffPixelRatio: 0.004 });
});

/** แกนธรรม/อธรรมเคยเปลี่ยนแค่ตัวเลขในแถบบน — เล่นเป็นเทพเมตตากับเทพพิโรธจนจบ
 *  เกาะหน้าตาเหมือนกันเป๊ะ ทั้งที่วิกิของ B&W บอกว่านี่คือสิ่งที่มองเห็นชัดที่สุดของเกม
 *  สองเทสต์นี้คือหลักฐานว่ามันเปลี่ยนจริง และเทสต์ที่สามคือหลักฐานว่ามันเปลี่ยน *ต่างกัน* */
const reign = (seed: number, t: number, align: number) => `/?seed=${seed}&t=${t}&align=${align}`;

test("เกาะของเทพพิโรธ — ฟ้า แสง และผืนดินต้องบอกเองว่าเกิดอะไรขึ้นที่นี่", async ({ page }) => {
  await page.goto(reign(20260915, 0.3, -1));
  await ready(page);
  await expect(page).toHaveScreenshot("island-wrath.png");
});

test("เกาะของเทพเมตตา", async ({ page }) => {
  await page.goto(reign(20260915, 0.3, 1));
  await ready(page);
  await expect(page).toHaveScreenshot("island-mercy.png");
});

test("สองรัชสมัยต้องไม่ได้ภาพเดียวกัน", async ({ page }) => {
  // ภาพเกาะทั้งใบมีเกณฑ์ยอมต่าง 1.2% ซึ่งใหญ่พอจะกลืนการเปลี่ยนสีทั้งเกาะไปได้
  // จึงวัดเป็นตัวเลขตรงๆ แทน: ค่าเฉลี่ยสีของเฟรมต้องต่างกันอย่างมีนัย
  const mean = async (align: number) => {
    await page.goto(reign(20260915, 0.3, align));
    await ready(page);
    // ต้องอ่านผ่าน world.sampleAverage() ซึ่งวาดแล้วอ่านพิกเซลทันที
    // drawImage/toDataURL จาก canvas ของ WebGL ได้ภาพดำสนิท เพราะบัฟเฟอร์ถูกล้างหลัง composite
    return page.evaluate(() =>
      (window as any).__genesis.world.sampleAverage() as [number, number, number]);
  };
  const dark = await mean(-1);
  const holy = await mean(1);
  const gap = Math.abs(dark[0] - holy[0]) + Math.abs(dark[1] - holy[1]) + Math.abs(dark[2] - holy[2]);
  console.log(`รัชสมัยพิโรธ rgb(${dark.map(Math.round)}) · เมตตา rgb(${holy.map(Math.round)}) · ต่างรวม ${gap.toFixed(1)}`);
  expect(gap).toBeGreaterThan(12);
  // อธรรมต้องอุ่นกว่าและเขียวน้อยกว่า ไม่ใช่แค่ "ต่างกัน" เฉยๆ
  expect(dark[0] - dark[1]).toBeGreaterThan(holy[0] - holy[1]);
});
