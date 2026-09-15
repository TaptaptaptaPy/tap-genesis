"""อ่านไฟล์โมเดลแล้วรายงานว่าข้างในมีอะไร — รันผ่าน Blender แบบไม่มีหน้าต่าง

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/gltf_report.py -- <ไฟล์เข้า> [ไฟล์ออก] [สัดส่วนที่เหลือ]

ถ้าใส่ไฟล์ออกมาด้วย จะลดจำนวนเหลี่ยมแล้วส่งออกเป็น .glb ให้
เกมเปิดบน iPad ด้วย โมเดลจากชุดสำเร็จมักหนักเกินไปสำหรับเครื่องนั้น
"""
import sys, bpy

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if not argv:
    print("ต้องบอกไฟล์เข้ามาด้วย"); sys.exit(1)
src = argv[0]
dst = argv[1] if len(argv) > 1 else None
ratio = float(argv[2]) if len(argv) > 2 else 1.0

bpy.ops.wm.read_factory_settings(use_empty=True)
if src.lower().endswith((".glb", ".gltf")):
    bpy.ops.import_scene.gltf(filepath=src)
elif src.lower().endswith(".fbx"):
    bpy.ops.import_scene.fbx(filepath=src)
elif src.lower().endswith(".obj"):
    bpy.ops.wm.obj_import(filepath=src)
else:
    print("ยังไม่รองรับนามสกุลนี้"); sys.exit(1)

meshes = [o for o in bpy.data.objects if o.type == "MESH"]
arms   = [o for o in bpy.data.objects if o.type == "ARMATURE"]
tris   = sum(len(o.data.loop_triangles) for o in meshes
             if (o.data.calc_loop_triangles() or True))
bones  = sum(len(a.data.bones) for a in arms)

print("=== รายงาน ===")
print(f"mesh {len(meshes)} · armature {len(arms)} · กระดูก {bones} · สามเหลี่ยม {tris}")
print(f"ท่าทาง {len(bpy.data.actions)}: " + ", ".join(a.name for a in bpy.data.actions))
print(f"วัสดุ {len(bpy.data.materials)} · รูป {len(bpy.data.images)}")

if dst:
    if ratio < 1.0:
        for o in meshes:
            m = o.modifiers.new("ลดเหลี่ยม", "DECIMATE")
            m.ratio = ratio
        print(f"ลดเหลี่ยมเหลือ {ratio:.0%}")
    bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB",
                              export_animations=True, export_skins=True)
    print(f"เขียนออกแล้ว: {dst}")
