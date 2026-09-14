/** ทดสอบสมดุลโดยไม่ต้องเปิดเบราว์เซอร์ — รันด้วย `npm run sim`
 *  พอเกมใหญ่ขึ้น การนั่งเล่นเพื่อจับบั๊กสมดุลจะทำไม่ไหว เครื่องมือนี้คือทางออก */
import { createGame, stepTick, totalPop, GENE_NAME } from "../sim/index";
import balance from "../../data/balance.json";

const MINUTES = Number(process.argv[2] ?? 20);
const RUNS = Number(process.argv[3] ?? 3);
const ticks = Math.round((MINUTES * 60) / balance.time.tickSeconds);

console.log(`จำลอง ${RUNS} โลก × ${MINUTES} นาทีเกม (${ticks} ticks ต่อโลก)\n`);

for (let run = 1; run <= RUNS; run++) {
  const g = createGame(1000 + run * 7919);
  const gen0 = { ...g.state.creature.genes };
  let generations = 1;
  let lastGen = 1;

  for (let i = 0; i < ticks; i++) {
    stepTick(g);
    if (g.state.creature.gen !== lastGen) { lastGen = g.state.creature.gen; generations++; }
  }

  const s = g.state;
  const drift = (Object.keys(gen0) as (keyof typeof gen0)[])
    .map((k) => `${GENE_NAME[k]} ${gen0[k].toFixed(2)}→${s.creature.genes[k].toFixed(2)}`)
    .join("  ");

  console.log(`โลกที่ ${run}`);
  console.log(`  ปีที่ ${s.year} | ยุค ${balance.era.names[s.era]} | ${s.dead ? "*** ล่มสลาย ***" : "ยังอยู่"}`);
  console.log(`  หมู่บ้าน ${s.villages.length} | ประชากร ${totalPop(s).toFixed(0)} | ศรัทธา ${s.faith.toFixed(0)} | ธรรม ${s.align.toFixed(2)}`);
  console.log(`  สัตว์รุ่นที่ ${s.creature.gen} | สถิติสูงสุด ${s.best?.fit.toFixed(0) ?? "-"}`);
  console.log(`  ยีน: ${drift}\n`);
}
