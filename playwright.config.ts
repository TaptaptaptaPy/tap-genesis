import { defineConfig, devices } from "@playwright/test";

/** เทสต์ภาพ — สิ่งที่เทสต์อื่นในโปรเจกต์นี้จับไม่ได้เลย
 *
 *  `npm run sim` พิสูจน์ว่า "ตรรกะถูก" แต่บั๊กที่เสียเวลาที่สุดในโปรเจกต์นี้ทุกอันเป็นภาพพังเงียบๆ
 *  ไม่มี error สักบรรทัด: เกาะซีดขาวเพราะแสงแรงเกิน · ทะเลสีเดียวกับท้องฟ้า ·
 *  ขอบโลกเป็นสี่เหลี่ยม · id ของ gradient ชนกันจนการ์ดใบหลังได้สีของใบแรก
 *  ทั้งหมดนี้เห็นได้ด้วยตาอย่างเดียว เครื่องมือนี้คือ "ตา" ที่รันได้ทุกครั้งที่ commit
 *
 *  เกมสุ่ม seed จาก Date.now() และเดินเวลาตลอด จึงต้องเปิดด้วย `?seed=&t=` (ดู src/main.ts)
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  reporter: [["list"]],
  expect: {
    // เงา WebGL กับ anti-alias ต่างกันได้นิดหน่อยระหว่างรอบ แต่ถ้าต่างเกินนี้คือของจริงเปลี่ยน
    toHaveScreenshot: { maxDiffPixelRatio: 0.012, animations: "disabled" },
  },
  use: {
    // กระจาย devices ก่อน ไม่งั้นมันจะเขียนทับ viewport ที่ตั้งไว้ข้างล่างเงียบๆ
    ...devices["Desktop Chrome"],
    baseURL: "http://localhost:5173",
    viewport: { width: 1000, height: 720 },
    deviceScaleFactor: 1,
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
