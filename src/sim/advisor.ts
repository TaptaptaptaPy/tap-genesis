import { totalPop, neediestVillage, faithCap, NEED_NAME } from "./village";
import { spellFor, spellCost, SPELLS } from "./miracle";
import { goalBelievers } from "./reign";
import type { GameState } from "./types";
import balance from "../../data/balance.json";

/** ที่ปรึกษาสองฝ่าย
 *
 *  เกมนี้เคยไม่มี "เสียง" เลย มีแต่แถบข้อความกลางจอที่บอกว่าควรทำอะไร
 *  ใน Black & White สิ่งที่ทำให้เกมมีบุคลิกคือที่ปรึกษาสองตนที่เถียงกันตลอดเวลา
 *  ฝ่ายหนึ่งบอกให้เมตตา อีกฝ่ายบอกให้ใช้ความกลัว และทั้งคู่พูดถูกคนละแบบ
 *
 *  ที่นี่มันทำสองหน้าที่พร้อมกัน: ให้บุคลิกกับเกม และเป็นระบบคำใบ้ไปในตัว
 *  ซึ่งตรงกับเหตุผลที่ต้องตัดขอบเขตรอบก่อน — ผู้เล่นไม่รู้ว่าตอนนี้ควรทำอะไร
 *
 *  ไฟล์นี้อยู่ใน `src/sim/` จึงห้ามแตะ DOM และห้ามสุ่มด้วย Math.random()
 *  คำพูดเลือกจาก state ล้วน คนละสถานการณ์ได้คนละคำ ไม่ใช่สุ่มขึ้นมาลอยๆ
 */

export type Voice = "kind" | "cruel";

export interface Advice { voice: Voice; text: string; tick: number; }

export const VOICE_NAME: Record<Voice, string> = { kind: "เสียงแห่งเมตตา", cruel: "เสียงแห่งพิโรธ" };

/** เลือกคำพูดของทั้งสองฝ่ายจากสถานการณ์เดียวกัน — เถียงกันเรื่องเดียวกันเสมอ */
export function advise(s: GameState): [Advice, Advice] | null {
  const t = s.tick;
  const pop = totalPop(s);
  const cap = faithCap(s);
  const sick = s.villages.find((v) => v.plague > 0);
  const needy = neediestVillage(s);
  const rain = SPELLS.find((x) => x.id === "rain")!;
  const poor = s.faith < spellCost(rain, s.align);

  let kind: string, cruel: string;

  if (s.dead) {
    kind = "ไม่เหลือใครให้ช่วยแล้ว";
    cruel = "ท่านได้ความเงียบที่ท่านต้องการแล้ว";
  } else if (sick) {
    kind = `หมู่บ้าน${sick.name}มีโรคระบาด ชำระโรคให้พวกเขาเถิด`;
    cruel = "โรคคัดคนอ่อนแอออกไปเอง ท่านไม่ต้องเปลืองศรัทธา";
  } else if (needy && needy.ask) {
    const sp = spellFor(needy.ask);
    kind = `${needy.name}ขาด${NEED_NAME[needy.ask]} ` +
           (sp ? `ร่าย${sp.name}ลงไปสิ` : "ไปดูพวกเขาหน่อย");
    cruel = "ปล่อยให้เขาขอไปก่อน คนที่หิวจะสวดดังกว่าคนที่อิ่ม";
  } else if (poor) {
    kind = "ศรัทธาไม่พอร่ายคาถาแล้ว หยิบอาหารไปวางให้เขาด้วยมือก็ได้";
    cruel = "ศรัทธาหมดก็หยิบก้อนหินสิ มือของท่านไม่เคยขออนุญาตใคร";
  } else if (s.faith >= cap * 0.98) {
    kind = "ศรัทธาเต็มแล้ว ใช้มันก่อนที่มันจะไม่มีที่ไป";
    cruel = "ศรัทธาเต็มแล้ว ลองดูสิว่าธรณีพิโรธรู้สึกยังไง";
  } else if (s.creature.alive && s.creature.fear >= balance.pet.deceitFearAt) {
    // ผู้เล่นต้องได้รู้ว่าเกิดอะไรขึ้นกับมัน ไม่งั้นระบบนี้เป็นแค่ตัวเลขที่ไม่มีใครเห็น
    kind = s.deceits > 0
      ? "สัตว์ของท่านทำตัวเรียบร้อยตอนท่านมอง แล้วไปทำอีกอย่างตอนท่านหันหลัง"
      : "มันกลัวท่านจนสอนอะไรไม่เข้าแล้ว ลูบมันบ้างเถิด";
    cruel = s.deceits > 0
      ? "มันเรียนรู้ที่จะไม่ให้ท่านเห็น นั่นคือความฉลาดอย่างหนึ่ง"
      : "ความกลัวคือสิ่งเดียวที่มันเข้าใจ อย่าเพิ่งใจอ่อน";
  } else if (s.creature.alive && s.creature.bond < 0.2) {
    kind = "สัตว์ของท่านยังไม่รู้จักท่านเลย ชมมันบ้างตอนมันทำดี";
    cruel = "มันจะเชื่อฟังเร็วกว่าถ้าท่านดุมันบ้าง";
  } else if (pop >= goalBelievers() * 0.7 && !s.won) {
    kind = `อีกไม่ไกลแล้ว ${Math.ceil(goalBelievers() - pop)} คนก็ถึงที่ท่านตั้งใจไว้`;
    cruel = "จำนวนคนไม่สำคัญเท่าที่พวกเขากลัวท่านแค่ไหน";
  } else if (s.align > 0.75) {
    kind = "ผู้คนรักท่านโดยไม่มีเงื่อนไข อย่าให้เขาต้องเสียใจ";
    cruel = "คนที่รักอย่างเดียวจะลืมว่าท่านทำอะไรได้บ้าง";
  } else if (s.align < -0.75) {
    kind = "พวกเขาเริ่มไม่กล้าเงยหน้ามองฟ้าแล้ว";
    cruel = "ดีแล้ว ความยำเกรงอยู่ได้นานกว่าความรัก";
  } else {
    kind = "วันนี้ยังไม่มีใครเดือดร้อน ปลูกป่าไว้เผื่อวันข้างหน้าก็ได้";
    cruel = "โลกที่ไม่มีอะไรเกิดขึ้นคือโลกที่ไม่มีใครจำท่าน";
  }

  return [{ voice: "kind", text: kind, tick: t }, { voice: "cruel", text: cruel, tick: t }];
}

/** ที่ปรึกษาพูดทุกกี่ tick — บ่อยเกินไปก็กลายเป็นเสียงรบกวน */
export const adviceEvery = balance.time.adviceEveryTicks;
