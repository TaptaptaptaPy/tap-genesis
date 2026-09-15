/** ทดสอบสมดุลโดยไม่ต้องเปิดเบราว์เซอร์ — รันด้วย `npm run sim`
 *  พอเกมใหญ่ขึ้น การนั่งเล่นเพื่อจับบั๊กสมดุลจะทำไม่ไหว เครื่องมือนี้คือทางออก */
import { createGame, stepTick, totalPop, loyalPop, GENE_NAME, petOf, bodySize, maxVillages,
         snapshot, restore, tileAt, type GeneId, type Genes } from "../sim/index";
import balance from "../../data/balance.json";

const MINUTES = Number(process.argv[2] ?? 20);
const RUNS = Number(process.argv[3] ?? 3);
const ticks = Math.round((MINUTES * 60) / balance.time.tickSeconds);
const GENES = Object.keys(GENE_NAME) as GeneId[];

console.log(`จำลอง ${RUNS} โลก × ${MINUTES} นาทีเกม (${ticks} ticks ต่อโลก) ` +
            `บนแผนที่ ${balance.world.W}×${balance.world.H}\n`);

let died = 0, alignExtreme = 0;

for (let run = 1; run <= RUNS; run++) {
  const g = createGame(1000 + run * 7919);
  const s = g.state;
  const gen0: Genes = { ...s.creatures[0].genes };
  const seenDisasters: Record<string, number> = {};
  let peakPop = 0, minPop = Infinity, peakCreatures = 0, worstAlign = 0;
  let creatureSum = 0, villageSum = 0;

  for (let i = 0; i < ticks; i++) {
    const before = s.disasters.length;
    stepTick(g);
    if (s.disasters.length > before)
      for (const d of s.disasters.slice(before)) seenDisasters[d.name] = (seenDisasters[d.name] ?? 0) + 1;
    const p = totalPop(s);
    peakPop = Math.max(peakPop, p);
    if (i > 200) minPop = Math.min(minPop, p);
    peakCreatures = Math.max(peakCreatures, s.creatures.length);
    creatureSum += s.creatures.length; villageSum += s.villages.length;
    worstAlign = Math.abs(s.align) > Math.abs(worstAlign) ? s.align : worstAlign;
  }

  // ยีนเฉลี่ยของ "ประชากรทั้งหมด" ไม่ใช่ของตัวเดียว — นี่คือการคัดเลือกจริง
  const avg = {} as Genes;
  for (const k of GENES)
    avg[k] = s.creatures.reduce((a, c) => a + c.genes[k], 0) / Math.max(1, s.creatures.length);
  const drift = GENES.map((k) => `${GENE_NAME[k]} ${gen0[k].toFixed(2)}→${avg[k].toFixed(2)}`).join("  ");

  const needs = s.villages.length
    ? (["food", "wood", "shelter"] as const).map((k) =>
        `${k === "food" ? "อาหาร" : k === "wood" ? "ไม้" : "ที่อยู่"} ` +
        (s.villages.reduce((a, v) => a + v.needs[k], 0) / s.villages.length * 100).toFixed(0) + "%").join("  ")
    : "—";
  const pet = petOf(s);
  const dis = Object.entries(seenDisasters).map(([k, n]) => `${k}×${n}`).join(" ") || "ไม่มี";

  if (s.dead) died++;
  if (Math.abs(worstAlign) > 0.95) alignExtreme++;

  console.log(`โลกที่ ${run}`);
  console.log(`  ปีที่ ${s.year} | ${balance.season.names[s.season]} | ยุค ${balance.era.names[s.era]} | ${s.dead ? "*** ล่มสลาย ***" : "ยังอยู่"}`);
  console.log(`  หมู่บ้าน ${s.villages.length}/${maxVillages(s)} (เฉลี่ย ${(villageSum / ticks).toFixed(1)}) | ประชากร ${totalPop(s).toFixed(0)} (ภักดีต่อท่าน ${loyalPop(s).toFixed(0)}) | สูงสุดเคยถึง ${peakPop.toFixed(0)}`);
  console.log(`  ศรัทธา ${s.faith.toFixed(0)} | ธรรม ${s.align.toFixed(2)} (สุดขั้วที่เคยไป ${worstAlign.toFixed(2)})`);
  console.log(`  ความต้องการที่เติมเต็ม: ${needs}`);
  console.log(`  สัตว์ ${s.creatures.length} ตัว (เฉลี่ยตลอดเกม ${(creatureSum / ticks).toFixed(1)} สูงสุด ${peakCreatures}) | ของท่านรุ่นที่ ${pet?.gen ?? "-"} ขนาด ${pet ? bodySize(pet).toFixed(2) : "-"} | สถิติสูงสุด ${s.best?.fit.toFixed(0) ?? "-"}`);
  console.log(`  ยีนเฉลี่ยทั้งประชากร: ${drift}`);
  console.log(`  ภัยพิบัติ: ${dis}`);
  console.log(`  คู่แข่ง: ${s.rival.active ? `${s.rival.name} ศรัทธา ${s.rival.faith.toFixed(0)} | หมู่บ้านที่เอนไปทางเขา ${s.villages.filter((v) => v.devotion < 0).length}` : "ยังไม่ตื่น"}\n`);
}

console.log("─".repeat(52));
console.log(`สรุป: ล่มสลาย ${died}/${RUNS} โลก | ธรรมวิ่งไปติดขอบ ${alignExtreme}/${RUNS} โลก`);
if (died > RUNS / 2) console.log("เตือน: อารยธรรมล่มเกินครึ่ง สมดุลโหดเกินไป");
if (alignExtreme > 0) console.log("เตือน: แกนธรรมอิ่มตัวเอง แปลว่ามีอะไรดันทางเดียวอยู่");

// ───────── ทดสอบเซฟ/โหลด ─────────
// กับดัก: tile.village กับ state.villages[] ชี้ object ก้อนเดียวกัน ถ้า serialize ผิด
// มันจะกลายเป็นคนละก้อนแล้วค่าเริ่มเพี้ยนเงียบๆ วิธีจับคือ เซฟ → เดินต่อ → เทียบกับ
// โหลดกลับ → เดินต่อ ถ้าผูก reference และสถานะตัวสุ่มถูกต้อง ผลต้องเท่ากันเป๊ะ
{
  const g = createGame(424242);
  for (let i = 0; i < 700; i++) stepTick(g);
  const snap = snapshot(g);

  const fingerprint = (x: typeof g) => {
    const s = x.state;
    const linked = s.villages.every((v) => tileAt(s.tiles, v.x, v.y)?.village === v);
    return JSON.stringify({
      tick: s.tick, faith: s.faith.toFixed(6), align: s.align.toFixed(6),
      know: s.know.toFixed(6), era: s.era,
      villages: s.villages.map((v) => [v.id, v.pop.toFixed(6), v.belief.toFixed(6), v.devotion.toFixed(6)]),
      creatures: s.creatures.map((c) => [c.id, c.x.toFixed(6), c.y.toFixed(6), c.energy.toFixed(6)]),
      rival: [s.rival.active, s.rival.faith.toFixed(6)],
      linked,
    });
  };

  for (let i = 0; i < 300; i++) stepTick(g);
  const afterDirect = fingerprint(g);

  const g2 = restore(snap);
  const linkedOnLoad = g2.state.villages.every((v) => tileAt(g2.state.tiles, v.x, v.y)?.village === v);
  for (let i = 0; i < 300; i++) stepTick(g2);
  const afterLoad = fingerprint(g2);

  console.log("\nทดสอบเซฟ/โหลด");
  console.log(`  หมู่บ้านผูกกับช่องถูกต้องหลังโหลด: ${linkedOnLoad ? "ใช่" : "ไม่ใช่ ← พัง"}`);
  console.log(`  โลกเดินต่อหลังโหลดได้ผลเหมือนไม่เคยเซฟ: ${afterDirect === afterLoad ? "ใช่" : "ไม่ใช่ ← พัง"}`);
  if (!linkedOnLoad || afterDirect !== afterLoad) process.exitCode = 1;
}
