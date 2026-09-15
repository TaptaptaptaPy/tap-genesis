"""เรนเดอร์รูปตัวอย่างของโมเดลหนึ่งไฟล์ — รันผ่าน Blender แบบไม่มีหน้าต่าง

    Blender --background --python tools/model_sheet.py -- <ไฟล์.glb> <รูปออก.png> [ขนาด]

ใช้ตอนได้ชุดโมเดลมาแล้วแต่ไม่รู้ว่าไฟล์ไหนเป็นตัวอะไร
(ชุดของ Quaternius ตั้งชื่อ node ว่า "Body" หมดทุกตัว)
"""
import sys, math, bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
src, dst = argv[0], argv[1]
size = int(argv[2]) if len(argv) > 2 else 300

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

meshes = [o for o in bpy.data.objects if o.type == "MESH"]
if not meshes:
    print("ไม่มี mesh ในไฟล์นี้"); sys.exit(1)

# กล่องครอบรวมของทุกชิ้น เพื่อให้กล้องถอยพอดีกับตัวจริงไม่ว่าตัวใหญ่แค่ไหน
lo = Vector(( 1e9,  1e9,  1e9))
hi = Vector((-1e9, -1e9, -1e9))
for o in meshes:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        lo = Vector((min(lo[i], w[i]) for i in range(3)))
        hi = Vector((max(hi[i], w[i]) for i in range(3)))
mid = (lo + hi) / 2
span = max(hi - lo)

cam_data = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_data)
bpy.context.scene.collection.objects.link(cam)
d = span * 2.1
cam.location = mid + Vector((d * 0.72, -d * 0.86, d * 0.44))
direction = (mid - cam.location).normalized()
cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
bpy.context.scene.camera = cam

sun_data = bpy.data.lights.new("sun", type="SUN")
sun_data.energy = 3.2
sun = bpy.data.objects.new("sun", sun_data)
sun.rotation_euler = (math.radians(52), 0, math.radians(38))
bpy.context.scene.collection.objects.link(sun)

w = bpy.context.scene.world = bpy.data.worlds.new("w")
w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.09, 0.13, 0.18, 1)

sc = bpy.context.scene
# ชื่อเอนจินเปลี่ยนไปตามรุ่นของ Blender เลือกอันที่มีอยู่จริงแทนที่จะเดา
avail = {e.identifier for e in
         bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items}
for name in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "BLENDER_WORKBENCH"):
    if name in avail:
        sc.render.engine = name
        break
sc.render.resolution_x = sc.render.resolution_y = size
sc.render.film_transparent = False
sc.render.filepath = dst
sc.frame_set(1)
bpy.ops.render.render(write_still=True)
print(f"เรนเดอร์แล้ว: {dst}  (กว้างสุด {span:.2f} หน่วย)")
