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

/** ท่าของชาวบ้านต้องมาจากงานที่เขาทำ เหมือนกับสัตว์
 *  `src/sim/folk.ts` ตัดสินใจงานให้แล้วจากสภาพหมู่บ้าน ชั้นภาพแค่เล่าออกมา */
test("เปลี่ยนงานของชาวบ้าน แล้วท่าต้องเปลี่ยนตาม", async ({ page }) => {
  await page.goto("/?seed=20260915&t=0.3");
  await page.waitForFunction(() => (window as any).__genesis?.propsReady === true);

  const seen = await page.evaluate(() => {
    const g = (window as any).__genesis;
    const s = g.game.state, vg = g.villagers as any;
    for (const v of s.villages) v.pop = 60;
    g.step(40);
    const v = s.villages[0], f = v.folk[0];
    const out: Record<string, string> = {};
    const step = (label: string, job: string, moving: boolean) => {
      f.job = job;
      f.rest = moving ? 0 : 99;
      f.tx = moving ? f.x + 3 : f.x;
      f.ty = moving ? f.y + 3 : f.y;
      vg.update(s, 1 / 60);
      out[label] = vg.bodies[0]?.clip ?? "ไม่มีร่าง";
    };
    step("เดินไปทำงาน", "farm", true);
    step("ทำไร่",       "farm", false);
    step("หาไม้",       "wood", false);
    step("ซ่อมบ้าน",    "build", false);
    step("บูชา",        "pray", false);
    step("นอนซม",       "sick", false);
    step("ยืนเฉยๆ",     "idle", false);
    return out;
  });

  expect(seen["เดินไปทำงาน"]).toBe("walk");
  expect(seen["ทำไร่"]).toBe("pick-up");
  expect(seen["หาไม้"]).toBe("pick-up");
  expect(seen["ซ่อมบ้าน"]).toBe("interact-right");
  expect(seen["บูชา"]).toBe("emote-yes");
  expect(seen["นอนซม"]).toBe("sit");
  expect(seen["ยืนเฉยๆ"]).toBe("idle");
});

/** ของทุกชิ้นต้องเอียงตามความชันของพื้น
 *  เคยหมุนแค่แกน Y อย่างเดียว บนที่ราบไม่มีใครสังเกต แต่บนไหล่เขามันลอย */
test("สัตว์กับชาวบ้านต้องเอียงตามพื้น ไม่ใช่ยืนตรงบนที่ลาด", async ({ page }) => {
  await page.goto("/?seed=20260915&t=0.3");
  await page.waitForFunction(() => (window as any).__genesis?.propsReady === true);

  const r = await page.evaluate(async () => {
    const g = (window as any).__genesis;
    const t = await import("/src/render/terrain3d.ts");
    const s = g.game.state;

    // หาจุดที่ชันที่สุดบนเกาะ แล้วดูว่าเวกเตอร์ตั้งฉากเอียงจริงไหม
    let steep = { x: 0, z: 0, tilt: 0 };
    for (let z = 2; z < 22; z++) for (let x = 2; x < 22; x++) {
      const n = t.groundNormal(s, x + 0.5, z + 0.5);
      const tilt = 1 - n.y;                 // 0 = ราบ, มากขึ้น = ชันขึ้น
      if (tilt > steep.tilt) steep = { x: x + 0.5, z: z + 0.5, tilt };
    }

    const obj = g.creature.root.clone();
    t.standOn(obj, s, steep.x, steep.z, 0, 1);
    // แกน Y ของวัตถุหลังหมุนแล้ว ต้องไม่ชี้ขึ้นตรงๆ อีกต่อไป
    const up = { x: 0, y: 1, z: 0 };
    const q = obj.quaternion;
    // หมุนเวกเตอร์ (0,1,0) ด้วย quaternion
    const ix = q.w * up.x + q.y * up.z - q.z * up.y;
    const iy = q.w * up.y + q.z * up.x - q.x * up.z;
    const iz = q.w * up.z + q.x * up.y - q.y * up.x;
    const iw = -q.x * up.x - q.y * up.y - q.z * up.z;
    const ly = iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z;
    return { tilt: steep.tilt, localUpY: ly };
  });

  expect(r.tilt, "เกาะนี้ราบไปหมด ทดสอบไม่ได้").toBeGreaterThan(0.02);
  expect(r.localUpY, "หมุนแล้วแกนขึ้นยังชี้ตรงเป๊ะ แปลว่าไม่ได้เอียงตามพื้น").toBeLessThan(0.999);
});
