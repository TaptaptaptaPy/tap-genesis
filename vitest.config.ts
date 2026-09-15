import { defineConfig } from "vitest/config";

/** เทสต์หน่วย — คนละงานกับ `npm run sim`
 *  `sim` ตอบว่า "ทั้งระบบเดินแล้วผลรวมสมเหตุสมผลไหม" ซึ่งจับบั๊กที่ซ่อนอยู่ในค่าเฉลี่ยไม่ได้
 *  ไฟล์ในนี้ตอบว่า "ฟังก์ชันนี้คืนค่าถูกไหม" ทุกอันมาจากบั๊กที่เคยเกิดขึ้นจริงแล้ว */
export default defineConfig({
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
