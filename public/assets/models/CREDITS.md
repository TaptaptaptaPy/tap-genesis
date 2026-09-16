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

## prop-tree.glb · prop-rock.glb · prop-hut.glb — **เอาออกแล้ว (16 ก.ย. 2026)**
- แหล่งเดิม: Kenney · Nature Kit 2.1 · <https://kenney.nl/assets/nature-kit> · CC0
- ต้นไม้ ก้อนหิน และกระท่อมถูกเปลี่ยนไปสร้างจากโค้ดใน `src/render/buildings.ts` แทน
  เพราะต้องการทรงที่คุมสัดส่วนเองได้และทาสีไล่ตามความสูงในจุดยอด
- ไฟล์ทั้งสามถูกลบออกจาก `public/assets/models/` แล้ว พร้อมกับ `props` ใน `data/models.json`
  ทะเบียนที่ชี้ไปยังไฟล์ที่ไม่มีใครเรียกคือที่ที่คนอ่านโค้ดจะเสียเวลาที่สุด
  (ของเก่ายังอยู่ในประวัติ git ถ้าวันไหนอยากเทียบกัน)

## folk.glb
- แหล่ง: Kenney · Blocky Characters 2.0 · <https://kenney.nl/assets/blocky-characters>
- ไฟล์ต้นทาง: `character-a.glb`
- ลิขสิทธิ์: **CC0**
- 72 สามเหลี่ยม · 27 ท่า · **ไม่มีโครงกระดูก** ขยับด้วยการหมุนชิ้นส่วนแต่ละชิ้น
  จึงถูกกว่าโมเดลที่ต้องคำนวณ skinning
- ไฟล์ต้นทางอ้างเท็กซ์เจอร์เป็นไฟล์แยก (`Textures/texture-a.png`) ซึ่งโหลดไม่เจอ
  แพ็กใหม่ด้วย Blender ให้ฝังเท็กซ์เจอร์มาในไฟล์เดียว เหลือ 70KB
