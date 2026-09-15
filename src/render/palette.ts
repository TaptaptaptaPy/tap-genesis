import { lerp } from "../core/rng";
import type { BiomeId, GameState } from "../sim/types";
import balance from "../../data/balance.json";

export type RGB = [number, number, number];

export const mix = (a: RGB, b: RGB, t: number): RGB =>
  [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const css = (c: RGB, alpha = 1) =>
  alpha >= 1 ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`
             : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${alpha})`;
export const shade = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];

/** สุ่มแบบคงที่จากพิกัด — ช่องเดิมได้ลายเดิมทุกครั้งที่วาดใหม่ ไม่กระพริบ */
export function hash2(x: number, y: number, salt = 0): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2246822519) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** สีของชีวนิเวศ แยกเป็นโทนสว่าง/เข้ม เพื่อไล่เฉดตามความสูงและความอุดม */
interface Skin { base: RGB; light: RGB; dark: RGB; detail: RGB; }

export const SKIN: Record<BiomeId, Skin> = {
  OCEAN:   { base: [19, 48, 72],    light: [30, 68, 96],    dark: [11, 30, 48],   detail: [60, 110, 140] },
  SHALLOW: { base: [36, 86, 112],   light: [58, 116, 142],  dark: [24, 62, 86],   detail: [120, 180, 200] },
  SAND:    { base: [206, 188, 140], light: [224, 210, 168], dark: [176, 156, 112],detail: [166, 146, 104] },
  DESERT:  { base: [190, 166, 108], light: [212, 190, 134], dark: [158, 134, 84], detail: [148, 124, 78] },
  GRASS:   { base: [114, 154, 76],  light: [142, 182, 94],  dark: [84, 118, 56],  detail: [74, 108, 48] },
  LUSH:    { base: [84, 146, 62],   light: [110, 174, 80],  dark: [60, 110, 46],  detail: [50, 98, 40] },
  FOREST:  { base: [49, 99, 60],    light: [66, 120, 74],   dark: [32, 72, 44],   detail: [22, 58, 34] },
  HILL:    { base: [128, 133, 88],  light: [150, 154, 104], dark: [102, 106, 70], detail: [92, 96, 62] },
  MOUNT:   { base: [132, 130, 124], light: [162, 160, 154], dark: [96, 94, 90],   detail: [74, 72, 70] },
  SNOW:    { base: [196, 206, 216], light: [224, 232, 240], dark: [158, 170, 186], detail: [180, 194, 210] },
  ASH:     { base: [84, 76, 72],    light: [102, 92, 86],   dark: [60, 54, 50],   detail: [44, 38, 36] },
};

/** ฤดูกาลไม่ควรเป็นแค่แผ่นสีทับ มันควรเปลี่ยนสีของพืชจริงๆ */
export interface SeasonGrade { veg: RGB; vegMix: number; warm: number; }
export const SEASON_GRADE: SeasonGrade[] = [
  { veg: [150, 200, 110], vegMix: 0.26, warm: 0.04 },   // ฤดูผลิ — เขียวสด
  { veg: [96, 150, 120],  vegMix: 0.18, warm: -0.03 },  // ฤดูฝน — เขียวอมฟ้า ชุ่มน้ำ
  { veg: [206, 176, 88],  vegMix: 0.30, warm: 0.10 },   // ฤดูเก็บเกี่ยว — เหลืองทอง
  { veg: [198, 150, 86],  vegMix: 0.34, warm: 0.14 },   // ฤดูแล้ง — น้ำตาลแห้ง
];

export const isPlant = (b: BiomeId) =>
  b === "GRASS" || b === "LUSH" || b === "FOREST" || b === "HILL";

/** สีฟ้าของขอบฟ้าสะท้อนแกนธรรม ใช้ทั้งกับน้ำและกับหมอกขอบจอ */
export function moodColor(s: GameState): RGB {
  return s.align >= 0 ? [255, 236, 186] : [104, 26, 34];
}

export const seasonName = (s: GameState) => balance.season.names[s.season];
