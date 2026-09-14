import type { BiomeId } from "./types";

export interface BiomeDef { color: [number, number, number]; cap: number; name: string; harsh?: boolean; }

export const BIOMES: Record<BiomeId, BiomeDef> = {
  OCEAN:   { color: [19, 48, 72],    cap: 0,    name: "ทะเลลึก" },
  SHALLOW: { color: [34, 79, 104],   cap: 0.10, name: "น้ำตื้น" },
  SAND:    { color: [206, 188, 140], cap: 0.14, name: "หาดทราย" },
  DESERT:  { color: [190, 166, 108], cap: 0.18, name: "ที่แห้งแล้ง", harsh: true },
  GRASS:   { color: [118, 150, 82],  cap: 0.48, name: "ทุ่งหญ้า" },
  LUSH:    { color: [92, 142, 68],   cap: 0.66, name: "ทุ่งอุดม" },
  FOREST:  { color: [49, 99, 60],    cap: 0.82, name: "ป่า" },
  HILL:    { color: [128, 133, 88],  cap: 0.34, name: "เนินเขา" },
  MOUNT:   { color: [132, 130, 124], cap: 0.06, name: "ภูเขา", harsh: true },
  SNOW:    { color: [221, 226, 230], cap: 0.03, name: "ยอดหิมะ", harsh: true },
  ASH:     { color: [84, 76, 72],    cap: 0.12, name: "เถ้าถ่าน", harsh: true },
};

export const isWater = (b: BiomeId) => b === "OCEAN" || b === "SHALLOW";
export const isHarsh = (b: BiomeId) => BIOMES[b].harsh === true;
