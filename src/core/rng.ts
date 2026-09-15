/** ตัวสุ่มแบบกำหนด seed ได้ — จำเป็นสำหรับการทดสอบสมดุลให้ผลซ้ำเดิม
 *  `state` เปิดออกมาเพื่อให้เซฟ/โหลดแล้วโลกเดินต่อเหมือนไม่เคยปิด */
export interface Rng { (): number; state: number; }

export function mulberry32(seed: number): Rng {
  let a = seed | 0;
  const f = (() => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }) as Rng;
  Object.defineProperty(f, "state", {
    get: () => a,
    set: (v: number) => { a = v | 0; },
  });
  return f;
}

export function gauss(rng: Rng): number {
  let u = 0, v = 0;
  while (!u) u = rng();
  while (!v) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export const pick = <T,>(arr: T[], rng: Rng): T => arr[Math.floor(rng() * arr.length)];
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
