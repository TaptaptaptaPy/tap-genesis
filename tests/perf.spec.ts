import { expect, test } from "@playwright/test";

/** วัดว่าวาดหนึ่งเฟรมใช้เวลาเท่าไร — ต้องวัดก่อนตัดสินใจ ไม่ใช่ทำไปก่อนแล้วค่อยวัด
 *
 *  เกมนี้ต้องเล่นบน iPad ด้วย ซึ่งช้ากว่าเครื่องนี้หลายเท่า
 *  ตัวเลขที่ได้จึงไม่ใช่คำตอบว่า "เร็วพอไหม" แต่เป็นฐานไว้เทียบว่า
 *  "ของที่เพิ่งใส่เข้าไปทำให้ช้าลงกี่เท่า" ซึ่งเป็นคำถามที่ตอบได้จริง
 */
test("เวลาต่อเฟรมตอนโลกเต็มไปด้วยคน", async ({ page }) => {
  // วัดหกรอบ รอบละ ~45 เฟรม บนเบราว์เซอร์ที่เรนเดอร์ด้วยซอฟต์แวร์ = เกินเวลามาตรฐาน 30 วิแน่นอน
  test.setTimeout(150_000);
  await page.goto("/?seed=20260915&t=0.3");
  await page.waitForFunction(() => (window as any).__genesis?.creatureReady === true
    && (window as any).__genesis?.propsReady === true);

  const r: { folk: number; villages: number; ms: number; msOld: number } = await page.evaluate(async () => {
    const g = (window as any).__genesis;
    const s = g.game.state;
    // ดันประชากรให้เต็มเพดานทุกหมู่บ้าน แล้วเดินเวลาให้ชาวบ้านถูกสร้างจริง
    // (โหมดทดสอบหยุดเวลาไว้ ต้องสั่งเดินเอง)
    for (let i = 0; i < 300; i++) { for (const v of s.villages) v.pop = 200; g.step(1); }
    // ยัดชาวบ้านให้เต็มเพดานที่ชั้นภาพรองรับ (96 คน) เพื่อวัดสภาพหนักสุดของตัววาดเอง
    // ไม่ต้องรอให้หมู่บ้านแตกหน่อจริง เพราะสิ่งที่อยากวัดคือ "วาดคน 96 คนแพงแค่ไหน"
    const v0 = s.villages[0];
    const seed = v0.folk[0];
    while (v0.folk.length < 96) {
      const f = { ...seed, id: 1000 + v0.folk.length };
      f.x = v0.x + (Math.random() * 6 - 3);
      f.y = v0.y + (Math.random() * 6 - 3);
      f.tx = f.x + 1; f.ty = f.y + 1; f.rest = 0;
      f.job = ["farm", "wood", "build", "pray", "idle", "sick"][v0.folk.length % 6];
      v0.folk.push(f);
    }
    // ห้ามเดินเวลาอีกหลังจากนี้! `stepFolk()` ตัดจำนวนคนกลับไปเท่าที่ประชากรรองรับทุก tick
    // ที่ยัดเข้าไปจะหายเกลี้ยงภายในหนึ่งจังหวะ
    const measure = () => new Promise<number>((done) => {
      let frames = 0, total = 0, last = performance.now();
      const tick = () => {
        const now = performance.now();
        if (frames > 5) total += now - last;    // ข้ามเฟรมแรกๆ ที่ยังอุ่นเครื่อง
        last = now;
        if (++frames < 45) requestAnimationFrame(tick);
        else done(total / (frames - 6));
      };
      requestAnimationFrame(tick);
    });

    const vg = g.villagers as any;
    const keep = vg.rigSrc;
    const useNew = () => {
      vg.rigSrc = keep;
      for (const m of [vg.body, vg.head, vg.load]) m.visible = false;
    };
    const useOld = () => {
      vg.rigSrc = null;
      for (const b of vg.bodies) b.root.visible = false;
      for (const m of [vg.body, vg.head, vg.load]) m.visible = true;
    };

    // วัดสลับกันสามรอบแล้วเอาค่าต่ำสุดของแต่ละแบบ
    // วัดแบบละครั้งเดียวได้ "โหลดของเครื่องตอนนั้น" ไม่ใช่ "ราคาของวิธีวาด" —
    // เทสต์ชุดนี้รันพร้อมกันสามงานและเรนเดอร์ด้วยซอฟต์แวร์ทั้งหมด
    // จังหวะที่งานอื่นกำลังโหลดโมเดลอยู่ทำให้อัตราส่วนกระโดดจาก 16% เป็นเกิน 100% ได้
    // ค่าต่ำสุดคือรอบที่ถูกแย่ง CPU น้อยที่สุด ซึ่งใกล้เคียง "ราคาจริง" ที่สุดเท่าที่วัดได้ที่นี่
    let nu = Infinity, old = Infinity;
    for (let round = 0; round < 3; round++) {
      useNew(); nu = Math.min(nu, await measure());
      useOld(); old = Math.min(old, await measure());
    }
    useNew();

    return {
      folk: s.villages.reduce((a: number, v: any) => a + v.folk.length, 0),
      villages: s.villages.length,
      ms: nu, msOld: old,
    };
  });

  const ratio = r.ms / r.msOld;
  console.log(`ชาวบ้าน ${r.folk} คน · แบบเดิม ${r.msOld.toFixed(1)} ms · ` +
              `แบบใหม่ ${r.ms.toFixed(1)} ms · ช้าลง ${((ratio - 1) * 100).toFixed(0)}%`);
  // เบราว์เซอร์ที่ Playwright ใช้เรนเดอร์ด้วยซอฟต์แวร์ ตัวเลขดิบจึงช้ากว่าเครื่องจริงมาก
  // เกณฑ์นี้เป็นแค่กันพัง ของจริงคือเอาเลขนี้ไปเทียบก่อน/หลังเปลี่ยนวิธีวาด
  expect(r.folk, "ไม่มีชาวบ้านเลย วัดไปก็ไม่ได้อะไร").toBeGreaterThan(10);
  expect(r.ms).toBeLessThan(200);
  // คนจริงที่มีท่าทางย่อมแพงกว่ากรวยที่วาดทีเดียวจบ แต่ต้องไม่แพงเกินสองเท่า
  // ถ้าวันไหนทะลุเกณฑ์นี้ แปลว่ามีอะไรสักอย่างหลุดออกจากงบ ไม่ใช่แค่ "คนเยอะขึ้น"
  expect(r.ms / r.msOld).toBeLessThan(2);
});
