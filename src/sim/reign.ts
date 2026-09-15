import type { GameState } from "./types";
import { totalPop } from "./village";
import balance from "../../data/balance.json";

/** เป้าหมายและฉากจบ
 *
 *  เดิมเกมนี้ไม่มีเงื่อนไขชนะเลยสักข้อ มีแต่ `s.dead` ตอนคนหมดเกาะ
 *  และ `npm run sim` ก็พิสูจน์แล้วว่าเทพเมตตาไม่มีโลกไหนล่มเลย
 *  แปลว่าเล่นไปเรื่อยๆ โดยไม่มีอะไรบอกว่าจบแล้ว และแพ้ก็ไม่ได้
 *
 *  ฉากจบไม่ได้ตัดสินว่าเล่นดีหรือไม่ดี แต่เล่าว่า "รัชสมัยของท่านเป็นแบบไหน"
 *  ธรรมกับอธรรมจึงไม่มีฝั่งไหนถูก มีแต่คนละเรื่อง */

const G = balance.goal;

export interface Reign {
  title: string; tone: string; score: number;
  years: number; believers: number; villages: number; generation: number;
  lines: string[];
}

export const goalBelievers = () => G.believers;
export const goalProgress = (s: GameState) => Math.min(1, totalPop(s) / G.believers);

/** ถึงเวลาจบหรือยัง — ต้องทั้งมีคนพอและอยู่มานานพอ กันจบตั้งแต่โลกยังไม่ทันตั้งตัว */
export const reachedGoal = (s: GameState) =>
  totalPop(s) >= G.believers && s.year >= G.minYears;

export function computeReign(s: GameState): Reign {
  const pop = Math.round(totalPop(s));
  const a = s.align;
  const title =
    s.dead ? "เกาะร้าง"
    : a > 0.6 ? "รัชสมัยแห่งความเมตตา"
    : a < -0.6 ? "รัชสมัยแห่งความยำเกรง"
    : a > 0.2 ? "รัชสมัยแห่งผู้ปกปัก"
    : a < -0.2 ? "รัชสมัยแห่งผู้ทดสอบ"
    : "รัชสมัยแห่งผู้เฝ้ามอง";

  const tone =
    s.dead ? "ไม่มีใครเหลือให้จดจำว่าท่านเคยอยู่"
    : a > 0.6 ? "ผู้คนเอ่ยพระนามท่านด้วยน้ำเสียงที่ใช้เรียกพ่อแม่"
    : a < -0.6 ? "ผู้คนเอ่ยพระนามท่านเบาๆ และมองฟ้าก่อนพูดเสมอ"
    : "ผู้คนรู้ว่าท่านมีอยู่ และไม่แน่ใจว่าควรรู้สึกอย่างไร";

  const lines: string[] = [];
  lines.push(`ผ่านไป ${s.year} ปี บนเกาะมีผู้ศรัทธา ${pop} คน ใน ${s.villages.length} หมู่บ้าน`);
  if (s.creature.gen > 1)
    lines.push(`สัตว์ของท่านสืบมาถึงรุ่นที่ ${s.creature.gen} จำสิ่งที่ท่านสอนไว้ได้ครึ่งหนึ่งทุกครั้งที่เกิดใหม่`);
  if (s.creature.bond > 0.6) lines.push("มันไม่เคยห่างจากท่านเลยตลอดชีวิตของมัน");
  else if (s.creature.bond < 0.2) lines.push("มันใช้ชีวิตของมันไปตามลำพัง ท่านแทบไม่เคยสนใจ");
  if (a > 0.6) lines.push("ท่านไม่เคยฟาดสายฟ้าลงใส่ผู้ใด และผู้คนก็ไม่เคยรู้ว่าท่านทำได้");
  if (a < -0.6) lines.push("แผ่นดินยังจำรอยแยกที่ท่านทิ้งไว้ได้ทุกรอย");

  // คะแนนไว้เทียบรอบต่อรอบ ไม่ใช่ตัวตัดสินว่าเล่นถูกหรือผิด
  const score = Math.round(pop + s.year * 4 + s.villages.length * 12 + s.creature.bond * 40);
  return { title, tone, score, years: s.year, believers: pop,
           villages: s.villages.length, generation: s.creature.gen, lines };
}
