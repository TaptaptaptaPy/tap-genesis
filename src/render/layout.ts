import type { Village } from "../sim/types";

/** ขนาดของกลุ่มกระท่อม — ที่เดียวที่ตัดสินว่าหมู่บ้านกินพื้นที่แค่ไหน
 *
 *  แยกออกมาจาก `actors3d.ts` เพราะมีสามคนต้องใช้ตัวเลขชุดเดียวกัน:
 *  วาดกระท่อม · วางชาวบ้านให้อยู่นอกหลังคา · และไม่ปลูกต้นไม้ทับหมู่บ้าน
 *  ถ้าปล่อยให้ต่างคนต่างคิดเลขเอง วันหนึ่งจะไม่ตรงกันแล้วหาไม่เจอว่าใครผิด
 *  (ถ้าอยู่ใน actors3d.ts แล้ว terrain3d.ts มาเรียก จะกลายเป็น import วนกัน)
 */
export const villageGrow = (v: Village) => 0.75 + Math.min(0.55, v.pop / 120);

const HUT_R = 0.42;
export const HUT_SPREAD = 1.06;
export { HUT_R };

/** ขอบนอกสุดที่กลุ่มกระท่อมกินจริง */
export const villageFootprint = (v: Village) => (HUT_SPREAD + HUT_R) * villageGrow(v);
