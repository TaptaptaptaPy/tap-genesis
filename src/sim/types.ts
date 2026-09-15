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
  shade: number;  // ความต่างเล็กน้อย กันภาพแบนราบ
  village: Village | null;
}

/** ความต้องการของหมู่บ้าน 0..1 = เติมเต็มแค่ไหน ศรัทธาคำนวณจากสามค่านี้ */
export interface Needs { food: number; wood: number; shelter: number; }
export type NeedId = keyof Needs;

export type FolkJob = "farm" | "wood" | "build" | "pray" | "idle" | "sick";

/** ชาวบ้านหนึ่งคน — มีชื่อ มีตำแหน่ง และหยิบขึ้นมาได้ทีละคน
 *  เดิมชาวบ้านเป็นแค่ภาพที่คำนวณจาก `pop` ทำให้ "หยิบคน" หมายถึงหยิบคนนิรนามจากหมู่บ้าน */
export interface Folk {
  id: number;
  name: string;
  x: number; y: number;
  /** จุดที่กำลังเดินไป */
  tx: number; ty: number;
  job: FolkJob;
  /** นับถอยหลังก่อนเปลี่ยนเป้าหมายใหม่ */
  rest: number;
}

export interface Village {
  id: number;
  x: number; y: number;
  pop: number;
  belief: number;
  name: string;
  age: number;
  wood: number;
  shelter: number;
  needs: Needs;
  awe: number;       // ความทรงจำถึงปาฏิหาริย์ล่าสุด ค่อยๆ จาง
  plague: number;    // ticks ที่เหลือของโรคระบาด
  /** สิ่งที่หมู่บ้านกำลังร้องขอ — ตัวที่ทำให้ผู้เล่นรู้ว่าตอนนี้ควรทำอะไร */
  ask: NeedId | null;
  askCd: number;
  /** คนในหมู่บ้านที่มีตัวตนจริง จำนวนไล่ตาม `pop` แต่ไม่เท่ากันเป๊ะ */
  folk: Folk[];
}

export type ActionId = "forage" | "raid" | "help" | "worship" | "wander";
export type GeneId = "size" | "speed" | "meta" | "aggr" | "intel" | "coat";
export type Genes = Record<GeneId, number>;
export type Weights = Record<ActionId, number>;

export type CommandId = "stay" | "eatHere" | "goTo";
export interface Command { kind: CommandId; x: number; y: number; ticks: number; }

export type CreatureNeed = "hungry" | "tired" | "bored" | "content";

export interface Creature {
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
  lastTile: number;
  fbTimer: number;   // หน้าต่างเวลาที่พระเจ้ายังสอนได้ (tick)
  eaten: number;
  served: number;
  alive: boolean;
  mood: number;
  blink: number;
  respawnIn: number;
  bond: number;      // ความผูกพันกับผู้เล่น 0..1
  grow: number;      // ขนาดที่โตขึ้นจากการกิน
  cmd: Command | null;
  need: CreatureNeed;
  idleTicks: number;
  facing: number;    // ทิศที่หันหน้า (เรเดียน) ใช้ตอนวาด 3 มิติ
}

export interface BestRecord { genes: Genes; w: Weights; fit: number; }

export type FxKind = "rain" | "spark" | "dust" | "bolt" | "ripple" | "heal";
export interface Effect {
  kind: FxKind;
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

export type CarryKind = "rock" | "tree" | "food" | "folk";
export interface Projectile {
  kind: CarryKind;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  age: number;
  /** ถ้าสิ่งที่ขว้างคือคน ก็ต้องเป็น *คนคนนั้น* ที่ไปตกอีกฝั่ง */
  folk?: Folk | null;
}

export interface GameState {
  tiles: Tile[];
  villages: Village[];
  creature: Creature;
  best: BestRecord | null;
  faith: number;
  align: number;   // -1 อธรรม .. +1 ธรรม
  tick: number;
  year: number;
  dead: boolean;
  /** ถึงเป้าหมายแล้ว — เกมไม่จบทันที แต่ฉากจบถูกปลดให้ดูได้ และเล่นต่อได้ถ้าอยาก */
  won: boolean;
  /** มือกำลังถืออะไรอยู่ และหยิบมาจากช่องไหน */
  carrying: CarryKind | null;
  carryFrom: { x: number; y: number } | null;
  /** คนที่อยู่ในมือตอนนี้ — เก็บทั้งคนไว้ ไม่ใช่แค่จำนวน */
  carryFolk: Folk | null;
  /** ของที่กำลังลอยอยู่กลางอากาศ */
  thrown: Projectile[];
  fx: Effect[];
  log: string[];
  shake: number;
  disasters: Disaster[];
  lastDisasterTick: number;
  landCount: number;
  seed: number;
  rngState: number;
  /** เพิ่มขึ้นทุกครั้งที่ภูมิประเทศเปลี่ยนจนต้องสร้าง mesh ใหม่ */
  terrainVersion: number;
}
