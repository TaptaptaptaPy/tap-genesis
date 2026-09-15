import { villageFootprint, villageGrow } from "../sim/village";

/** ตัวเลขผังหมู่บ้าน — ย้ายไปอยู่ในชั้นตรรกะแล้ว เพราะ *ตรรกะ* ต้องรู้ด้วย
 *  ว่าตรงกลางหมู่บ้านไม่ใช่ไร่นา (ของเดิมรู้แค่ชั้นภาพ หมู่บ้านเลยยืนทับไร่ตัวเองเงียบๆ)
 *  ไฟล์นี้เหลือไว้เป็นทางเข้าเดิมของ `actors3d.ts` กับ `terrain3d.ts` เท่านั้น
 *  (ถ้าให้ทั้งสองไฟล์เรียก village.ts ตรงๆ จะกลายเป็น import วนกัน)
 */
export { villageFootprint, villageGrow };
export const HUT_R = 0.42;
export const HUT_SPREAD = 1.06;
