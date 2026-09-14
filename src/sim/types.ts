export type BiomeId =
  | "OCEAN" | "SHALLOW" | "SAND" | "DESERT" | "GRASS"
  | "LUSH" | "FOREST" | "HILL" | "MOUNT" | "SNOW" | "ASH";

export interface Tile {
  x: number; y: number; h: number;
  biome: BiomeId;
  cap: number;    // ความอุดมสูงสุดของช่องนี้
  fert: number;   // ความอุดมปัจจุบัน
  wet: number;    // ความชุ่มน้ำ (ฝนเพิ่ม แล้วค่อยๆ แห้ง)
  burn: number;
  shade: number;  // ความต่างสีเล็กน้อย กันภาพแบนราบ
  village: Village | null;
}

export interface Village {
  x: number; y: number;
  pop: number;
  belief: number;
  name: string;
  age: number;
}

export type ActionId = "forage" | "raid" | "help" | "worship" | "wander";
export type GeneId = "size" | "speed" | "meta" | "aggr" | "intel" | "coat";
export type Genes = Record<GeneId, number>;
export type Weights = Record<ActionId, number>;

export interface Creature {
  x: number; y: number;
  gen: number;
  genes: Genes;
  w: Weights;
  energy: number;
  age: number;
  act: ActionId | null;
  tgt: { x: number; y: number } | null;
  lastAct: ActionId | null;
  fbTimer: number;   // หน้าต่างเวลาที่พระเจ้ายังสอนได้ (tick)
  eaten: number;
  served: number;
  alive: boolean;
  mood: number;
  blink: number;
  respawnIn: number; // นับถอยหลังก่อนรุ่นถัดไปเกิด
}

export interface BestRecord { genes: Genes; w: Weights; fit: number; }

export interface Effect {
  kind: "rain" | "spark" | "dust" | "bolt";
  x: number; y: number; t: number; life: number; color?: string;
}

export interface GameState {
  tiles: Tile[];
  villages: Village[];
  creature: Creature;
  best: BestRecord | null;
  faith: number;
  align: number;   // -1 อธรรม .. +1 ธรรม
  know: number;
  era: number;
  tick: number;
  year: number;
  dead: boolean;
  fx: Effect[];
  log: string[];
  shake: number;
}
