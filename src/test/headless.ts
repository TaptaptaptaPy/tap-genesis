/** ทดสอบสมดุลโดยไม่ต้องเปิดเบราว์เซอร์ — รันด้วย `npm run sim`
 *  ขอบเขตตอนนี้เหลือแกน Black & White แล้ว ตัวเลขที่ต้องจับตาจึงเหลือน้อยลงมาก */
import { createGame, stepTick, totalPop, maxVillages, snapshot, restore, tileAt,
         bodySize, faithCap, GENE_NAME, NEED_NAME,
         type GeneId, type Genes, type NeedId } from "../sim/index";
import balance from "../../data/balance.json";

const MINUTES = Number(process.argv[2] ?? 20);
const RUNS = Number(process.argv[3] ?? 3);
const ticks = Math.round((MINUTES * 60) / balance.time.tickSeconds);
const GENES = Object.keys(GENE_NAME) as GeneId[];
const NEEDS: NeedId[] = ["food", "wood", "shelter"];

console.log(`จำลอง ${RUNS} โลก × ${MINUTES} นาทีเกม (${ticks} ticks ต่อโลก) ` +
            `บนเกาะ ${balance.world.W}×${balance.world.H}\n`);

let died = 0, alignExtreme = 0, starved = 0;

for (let run = 1; run <= RUNS; run++) {
  const g = createGame(1000 + run * 7919);
  const s = g.state;
  const gen0: Genes = { ...s.creature.genes };
  const seen: Record<string, number> = {};
  let peakPop = 0, worstAlign = 0, villageSum = 0, askTicks = 0, generations = 1;

  for (let i = 0; i < ticks; i++) {
    const before = s.disasters.length;
    stepTick(g);
    if (s.disasters.length > before)
      for (const d of s.disasters.slice(before)) seen[d.name] = (seen[d.name] ?? 0) + 1;
    peakPop = Math.max(peakPop, totalPop(s));
    villageSum += s.villages.length;
    if (s.villages.some((v) => v.ask)) askTicks++;
    if (Math.abs(s.align) > Math.abs(worstAlign)) worstAlign = s.align;
    if (s.creature.gen !== generations) generations = s.creature.gen;
  }

  const needAvg = NEEDS.map((k) =>
    `${NEED_NAME[k]} ${(s.villages.reduce((a, v) => a + v.needs[k], 0) /
      Math.max(1, s.villages.length) * 100).toFixed(0)}%`).join("  ");
  const drift = GENES.map((k) =>
    `${GENE_NAME[k]} ${gen0[k].toFixed(2)}→${s.creature.genes[k].toFixed(2)}`).join("  ");
  const dis = Object.entries(seen).map(([k, n]) => `${k}×${n}`).join(" ") || "ไม่มี";
  const askPct = ((askTicks / ticks) * 100).toFixed(0);

  if (s.dead) died++;
  if (Math.abs(worstAlign) > 0.95) alignExtreme++;
  if (s.villages.some((v) => v.needs.food < 0.5)) starved++;

  console.log(`โลกที่ ${run}`);
  console.log(`  ปีที่ ${s.year} | ${s.dead ? "*** ล่มสลาย ***" : "ยังอยู่"}`);
  console.log(`  หมู่บ้าน ${s.villages.length}/${maxVillages(s)} (เฉลี่ย ${(villageSum / ticks).toFixed(1)}) | ประชากร ${totalPop(s).toFixed(0)} | สูงสุดเคยถึง ${peakPop.toFixed(0)}`);
  console.log(`  ศรัทธา ${s.faith.toFixed(0)}/${faithCap(s).toFixed(0)} | ธรรม ${s.align.toFixed(2)} (สุดขั้ว ${worstAlign.toFixed(2)})`);
  console.log(`  ความต้องการที่เติมเต็ม: ${needAvg}`);
  console.log(`  มีหมู่บ้านร้องขอความช่วยเหลืออยู่ ${askPct}% ของเวลา`);
  console.log(`  สัตว์รุ่นที่ ${s.creature.gen} ขนาด ${bodySize(s.creature).toFixed(2)} ผูกพัน ${(s.creature.bond * 100).toFixed(0)}% | สถิติ ${s.best?.fit.toFixed(0) ?? "-"}`);
  console.log(`  ยีน: ${drift}`);
  console.log(`  ภัยพิบัติ: ${dis}\n`);
}

// ───────── ทดสอบเซฟ/โหลด ─────────
{
  const g = createGame(424242);
  for (let i = 0; i < 700; i++) stepTick(g);
  const snap = snapshot(g);
  const fingerprint = (x: typeof g) => {
    const s = x.state;
    return JSON.stringify({
      tick: s.tick, faith: s.faith.toFixed(6), align: s.align.toFixed(6),
      villages: s.villages.map((v) => [v.id, v.pop.toFixed(6), v.belief.toFixed(6)]),
      creature: [s.creature.x.toFixed(6), s.creature.y.toFixed(6), s.creature.energy.toFixed(6)],
    });
  };
  for (let i = 0; i < 300; i++) stepTick(g);
  const afterDirect = fingerprint(g);
  const g2 = restore(snap);
  const linked = g2.state.villages.every((v) => tileAt(g2.state.tiles, v.x, v.y)?.village === v);
  for (let i = 0; i < 300; i++) stepTick(g2);
  const afterLoad = fingerprint(g2);
  console.log("ทดสอบเซฟ/โหลด");
  console.log(`  หมู่บ้านผูกกับช่องถูกต้องหลังโหลด: ${linked ? "ใช่" : "ไม่ใช่ ← พัง"}`);
  console.log(`  โลกเดินต่อหลังโหลดได้ผลเหมือนไม่เคยเซฟ: ${afterDirect === afterLoad ? "ใช่" : "ไม่ใช่ ← พัง"}`);
  if (!linked || afterDirect !== afterLoad) process.exitCode = 1;
}

console.log("\n" + "─".repeat(52));
console.log(`สรุป: ล่มสลาย ${died}/${RUNS} | ธรรมติดขอบ ${alignExtreme}/${RUNS} | มีหมู่บ้านอดอยากตอนจบ ${starved}/${RUNS}`);
if (died > RUNS / 2) console.log("เตือน: อารยธรรมล่มเกินครึ่ง สมดุลโหดเกินไป");
if (alignExtreme > 0) console.log("เตือน: แกนธรรมอิ่มตัวเอง แปลว่ามีอะไรดันทางเดียวอยู่");
