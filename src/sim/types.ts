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
  blight: number; // ผลค้างจากภัยแล้ง กดเพดานความอุดมชั่วคราว
  shade: number;  // ความต่างสีเล็กน้อย กันภาพแบนราบ
  village: Village | null;
}

/** ความต้องการของหมู่บ้าน 0..1 = เติมเต็มแค่ไหน ศรัทธาคำนวณจากสามค่านี้ */
export interface Needs { food: number; wood: number; shelter: number; }

export interface Village {
  id: number;
  x: number; y: number;
  pop: number;
  belief: number;
  name: string;
  age: number;
  wood: number;      // ไม้ในคลัง
  shelter: number;   // ที่อยู่อาศัยที่สร้างไว้แล้ว
  needs: Needs;
  awe: number;       // ความทรงจำถึงปาฏิหาริย์ล่าสุด ค่อยๆ จาง
  devotion: number;  // -1 ศรัทธาเทพคู่แข่ง .. +1 ศรัทธาผู้เล่น
  plague: number;    // ticks ที่เหลือของโรคระบาด
}

export type ActionId = "forage" | "raid" | "help" | "worship" | "wander";
export type GeneId = "size" | "speed" | "meta" | "aggr" | "intel" | "coat";
export type Genes = Record<GeneId, number>;
export type Weights = Record<ActionId, number>;

export type CommandId = "stay" | "eatHere" | "follow" | "goTo";
export interface Command { kind: CommandId; x: number; y: number; ticks: number; }

export type NeedId = "hungry" | "tired" | "bored" | "hurt" | "content";

export interface Creature {
  id: number;
  x: number; y: number;
  gen: number;
  genes: Genes;
  w: Weights;
  /** ความจำสถานที่: index ของช่อง -> ค่าดี/แย่ (-1..+1) */
  mem: Record<number, number>;
  energy: number;
  age: number;
  act: ActionId | null;
  tgt: { x: number; y: number } | null;
  lastAct: ActionId | null;
  lastTile: number;  // index ช่องที่ทำ lastAct — ใช้ผูกคำชม/คำด่าเข้ากับสถานที่
  fbTimer: number;   // หน้าต่างเวลาที่พระเจ้ายังสอนได้ (tick)
  eaten: number;
  served: number;
  alive: boolean;
  mood: number;
  blink: number;
  respawnIn: number; // นับถอยหลังก่อนรุ่นถัดไปเกิด (เฉพาะสัตว์ของผู้เล่น)
  /** สัตว์ของผู้เล่นเท่านั้นที่สอนได้และสั่งได้ */
  pet: boolean;
  owner: "player" | "rival" | "wild";
  sex: 0 | 1;
  bond: number;       // ความผูกพันกับเจ้าของ 0..1
  grow: number;       // ขนาดที่โตขึ้นจากการกิน สะสมแยกจากยีน
  breedCd: number;
  cmd: Command | null;
  need: NeedId;
  idleTicks: number;
}

export interface BestRecord { genes: Genes; w: Weights; fit: number; }

export interface Effect {
  kind: "rain" | "spark" | "dust" | "bolt" | "ripple";
  x: number; y: number; t: number; life: number; color?: string;
}

export type DisasterId = "drought" | "wildfire" | "plague" | "flood";
export interface Disaster {
  kind: DisasterId;
  x: number; y: number;
  ticks: number;
  radius: number;
  name: string;
}

export interface RivalState {
  name: string;
  faith: number;
  align: number;
  active: boolean;
  thinkCd: number;
}

export interface GameState {
  tiles: Tile[];
  villages: Village[];
  creatures: Creature[];
  petId: number;
  nextId: number;
  best: BestRecord | null;
  faith: number;
  align: number;   // -1 อธรรม .. +1 ธรรม
  know: number;
  era: number;
  tick: number;
  year: number;
  season: number;
  dead: boolean;
  fx: Effect[];
  log: string[];
  shake: number;
  disasters: Disaster[];
  lastDisasterTick: number;
  rival: RivalState;
  landCount: number;
  seed: number;
  rngState: number;
  /** เพิ่มขึ้นทุกครั้งที่ภูมิประเทศเปลี่ยนจนต้องวาดพื้นดินใหม่ */
  terrainVersion: number;
}
