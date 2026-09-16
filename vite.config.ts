import { defineConfig } from "vite";

export default defineConfig({
  // ./ = เส้นทางทุกอย่างอิงตำแหน่งของหน้าเว็บเอง ไม่ใช่อิงรากของโดเมน
  // จำเป็นตอนเอาไปวางไว้ใต้โฟลเดอร์ย่อยของโฮสต์อื่น (เช่นเผยแพร่ให้เล่นบน iPad)
  base: "./",
  // host: true = ผูกกับ 0.0.0.0 ทำให้ iPad ในวง Wi-Fi เดียวกันเปิดได้
  // นี่คือบรรทัดเดียวที่ทำให้ "พัฒนาบน Mac เล่นบน iPad" ทำงาน อย่าลบ
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
  build: { target: "es2022" },
});
