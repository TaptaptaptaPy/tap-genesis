import { expect, test } from "@playwright/test";

/** พิสูจน์ว่าสายงาน "โมเดลที่ rig มาแล้ว" ใช้ได้จริงในโปรเจกต์นี้
 *
 *  ตอนนี้สัตว์ในเกมเป็นก้อนที่สร้างจากโค้ด ถ้าจะให้มันเดินมีขามีท่าทาง
 *  ต้องโหลด glTF ที่มีโครงกระดูก คำถามที่ต้องตอบก่อนวางแผนคือ
 *  "three.js ในโปรเจกต์นี้โหลดได้ไหม · vite เสิร์ฟไฟล์ให้ไหม · ท่าทางขยับจริงไหม"
 *  เทสต์นี้ตอบทั้งสามข้อโดยไม่ต้องแตะตัวเกมสักบรรทัด
 *
 *  ต้องเรียกผ่านโมดูลของโปรเจกต์ (`/src/render/gltf.ts`) ไม่ใช่ `import("three")` ตรงๆ
 *  เพราะในหน้าเว็บดิบๆ ชื่อ "three" ไม่มีความหมาย vite แปลงให้เฉพาะไฟล์ที่มันเสิร์ฟเอง
 */
test("โหลดโมเดลมีกระดูกแล้วท่าทางขยับจริง", async ({ page }) => {
  await page.goto("/?seed=1&t=0.3");
  const info = await page.evaluate(async () => {
    const { loadRigged, clipNames } = await import("/src/render/gltf.ts");
    const r = await loadRigged("/assets/models/Fox.glb");

    type Bone = { isBone?: boolean;
      position: { x: number; y: number; z: number };
      quaternion: { x: number; y: number; z: number; w: number } };
    const bones: Bone[] = [];
    r.scene.traverse((o: Bone) => { if (o.isBone) bones.push(o); });
    // ท่าเดินหมุนข้อต่อเป็นหลัก ไม่ได้เลื่อนตำแหน่ง ต้องดูทั้ง position และ quaternion
    const snap = () => bones.flatMap((b) =>
      [b.position.x, b.position.y, b.position.z,
       b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w]);

    r.play("Walk");
    const before = snap();
    r.update(0.4);
    const after = snap();

    return {
      clips: clipNames(r),
      bones: bones.length,
      running: r.actions["Walk"].isRunning(),
      moved: before.some((v, i) => Math.abs(v - after[i]) > 1e-9),
    };
  });

  expect(info.clips).toEqual(["Survey", "Walk", "Run"]);
  expect(info.bones).toBeGreaterThan(20);
  expect(info.running, "ท่าไม่ได้ถูกสั่งเล่น").toBe(true);
  expect(info.moved, "กระดูกไม่ขยับเลย — โหลดผ่านแต่ท่าทางไม่ทำงาน").toBe(true);
});
