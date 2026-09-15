# ที่มาของโมเดล

## Fox.glb
- แหล่ง: KhronosGroup/glTF-Sample-Assets — https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Fox
- ตัวโมเดล: PixelMannen — CC0 1.0 (ไม่ต้องให้เครดิต)
- โครงกระดูกและท่าทาง: tomkranis — **CC BY 4.0 (ต้องให้เครดิต)**
- แปลงเป็น glTF: @AsoboStudio และ @scurest — **CC BY 4.0 (ต้องให้เครดิต)**
- ข้อมูล: 1 mesh · 1 skin · 26 กระดูก · ท่า Survey / Walk / Run

ไฟล์นี้อยู่ที่นี่เพื่อ**พิสูจน์ว่าสายงานโมเดลใช้ได้จริง** (ดู `tests/gltf.spec.ts`)
ยังไม่ได้ถูกใช้ในเกม ถ้าวันไหนเอาขึ้นจอจริง ต้องขึ้นเครดิตสองบรรทัดข้างบนในเกมด้วย

## creature-ox.glb
- แหล่ง: Quaternius · Ultimate Animated Animals (กรกฎาคม 2021) · ไฟล์ `Cow.gltf`
- <https://quaternius.com/packs/ultimateanimatedanimals.html>
- ลิขสิทธิ์: **CC0** — ใช้ได้ทุกอย่าง ไม่ต้องให้เครดิต (แต่ให้ก็ดี)
- 42 กระดูก · 2,530 สามเหลี่ยม · 13 ท่า
- แปลงจาก `.gltf` (ฝัง base64) เป็น `.glb` ด้วย `tools/gltf_report.py` เหลือ 823KB

หมายเหตุ: ไฟล์เดียวกันบน poly.pizza มี 26 ท่าเพราะชื่อซ้ำสองชุด
ไฟล์จากต้นทางมี 13 ท่าตามจริง ใช้ของต้นทางดีกว่า

## prop-tree.glb · prop-rock.glb · prop-hut.glb
- แหล่ง: Kenney · Nature Kit 2.1 · <https://kenney.nl/assets/nature-kit>
- ไฟล์ต้นทาง: `tree_pineRoundA` · `stone_smallB` · `tent_detailedClosed`
- ลิขสิทธิ์: **CC0** — ใช้ได้ทุกอย่าง ไม่ต้องให้เครดิต (แต่ให้ก็ดี)
- สีในไฟล์ออกมาเป็นฟ้าอมเขียวกับส้มอ่อน ไม่เข้ากับจานสีของเกาะ
  จึงทับสีตามชื่อวัสดุตอนอบลงจุดยอด (`props.tint` ใน `data/models.json`)
  ไฟล์ต้นฉบับไม่ถูกแก้
