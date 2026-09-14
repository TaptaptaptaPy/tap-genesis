import { defineConfig } from "vite";

export default defineConfig({
  // host: true = ผูกกับ 0.0.0.0 ทำให้ iPad ในวง Wi-Fi เดียวกันเปิดได้
  // นี่คือบรรทัดเดียวที่ทำให้ "พัฒนาบน Mac เล่นบน iPad" ทำงาน อย่าลบ
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
  build: { target: "es2022" },
});
