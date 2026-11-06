"""Headless Blender generator for the light-show quadcopter used by every drone in the swarm.

Run:  python3.11 blender/make_drone.py          (needs `pip install bpy==4.5.4`, Python 3.11)
Then: npx -y gltfpack -i blender/out/drone.glb -o public/assets/drone.glb -cc -kn

Four named meshes are exported so the shader can treat them differently:
  drone_frame  - arms, motor pods, landing gear (dark carbon, lit by the moon)
  drone_trim   - the white shell, canopy and prop guards (light plastic with a specular glint)
  drone_rotor  - four two-blade props (thin, drawn double-sided; spun in the vertex shader around their hubs)
  drone_led    - the diffuser dome under the body (emissive, coloured per drone)
Hub positions must match the rotor hubs in src/swarm.js (+-ROTOR_R on both horizontal axes).
"""
import math
import os

import bpy
import bmesh

ROTOR_R = 0.25          # arm-tip offset on x and y (Blender z-up; glTF x and z after export)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out", "drone.glb")
CORNERS = ((1, 1), (-1, 1), (-1, -1), (1, -1))


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def join(objs, name, smooth=False):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    ob = bpy.context.active_object
    ob.name = name
    ob.data.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if smooth:
        bpy.ops.object.shade_smooth()
    else:
        bpy.ops.object.shade_flat()
    return ob


def active():
    return bpy.context.active_object


def bevel(ob, width, segments=2):
    m = ob.modifiers.new("bevel", "BEVEL")
    m.width = width
    m.segments = segments
    m.limit_method = "ANGLE"
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=m.name)


def cylinder(verts, radius, depth, loc, rot=(0, 0, 0), caps=True):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=depth, location=loc, rotation=rot,
                                        end_fill_type="NGON" if caps else "NOTHING")
    return active()


def rod(a, b, radius, verts=6):
    """A cylinder from point a to point b."""
    ax, ay, az = a
    bx, by, bz = b
    dx, dy, dz = bx - ax, by - ay, bz - az
    length = math.sqrt(dx * dx + dy * dy + dz * dz)
    ob = cylinder(verts, radius, length, ((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), caps=False)
    # rotate +z onto the rod direction
    yaw = math.atan2(dy, dx)
    pitch = math.acos(max(-1.0, min(1.0, dz / length)))
    ob.rotation_euler = (0, pitch, yaw)
    return ob


def taper_arm(sx, sy):
    """Tapered arm from the shell to a motor pod: a stretched 6-gon, thicker at the body."""
    ang = math.atan2(sy, sx)
    r0, r1 = 0.07, math.hypot(ROTOR_R, ROTOR_R) - 0.035
    bm = bmesh.new()
    rings = []
    for r, w, h in ((r0, 0.03, 0.022), (r1, 0.018, 0.014)):
        ring = []
        for k in range(6):
            a = k / 6 * math.tau
            ring.append(bm.verts.new((r, math.cos(a) * w, math.sin(a) * h)))
        rings.append(ring)
    for k in range(6):
        a0, a1 = rings[0][k], rings[0][(k + 1) % 6]
        b0, b1 = rings[1][k], rings[1][(k + 1) % 6]
        bm.faces.new((a0, a1, b1, b0))
    me = bpy.data.meshes.new("arm")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("arm", me)
    bpy.context.collection.objects.link(ob)
    ob.rotation_euler = (0, 0, ang)
    ob.location = (0, 0, 0.004)
    bpy.context.view_layer.objects.active = ob
    return ob


def frame():
    parts = []
    for sx, sy in CORNERS:
        parts.append(taper_arm(sx, sy))
        # motor pod: a short 8-gon can with a domed cap
        x, y = sx * ROTOR_R, sy * ROTOR_R
        parts.append(cylinder(8, 0.03, 0.045, (x, y, 0.012)))
        parts.append(cylinder(8, 0.021, 0.012, (x, y, 0.04)))
    # landing gear: two skids on four struts
    for sy in (1, -1):
        y = sy * 0.085
        parts.append(rod((-0.11, y, -0.115), (0.11, y, -0.115), 0.007))
        for sx in (1, -1):
            parts.append(rod((sx * 0.06, sy * 0.05, -0.02), (sx * 0.075, y, -0.115), 0.006))
    # GPS mast
    parts.append(rod((-0.03, -0.035, 0.05), (-0.03, -0.035, 0.1), 0.004, verts=4))
    parts.append(cylinder(8, 0.016, 0.008, (-0.03, -0.035, 0.104)))
    return join(parts, "drone_frame")


def trim():
    parts = []
    # shell: a bevelled rounded box
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.004))
    shell = active()
    shell.scale = (0.2, 0.16, 0.05)
    bpy.ops.object.transform_apply(scale=True)
    bevel(shell, 0.018, 2)
    parts.append(shell)
    # canopy: a flattened half dome on top
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=6, radius=0.075, location=(0.012, 0, 0.03))
    can = active()
    can.scale = (1.1, 0.9, 0.42)
    bpy.ops.object.transform_apply(scale=True)
    bm = bmesh.new()
    bm.from_mesh(can.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -0.002], context="VERTS")
    bm.to_mesh(can.data)
    bm.free()
    parts.append(can)
    # prop guards: thin open bands around each rotor
    for sx, sy in CORNERS:
        parts.append(cylinder(18, 0.15, 0.018, (sx * ROTOR_R, sy * ROTOR_R, 0.05), caps=False))
    return join(parts, "drone_trim")


def rotors():
    parts = []
    for sx, sy in CORNERS:
        for k in range(2):
            ang = math.pi / 4 * (1 if sx * sy > 0 else -1) + k * math.pi
            cx = sx * ROTOR_R + math.cos(ang) * 0.068
            cy = sy * ROTOR_R + math.sin(ang) * 0.068
            bpy.ops.mesh.primitive_plane_add(size=1, location=(cx, cy, 0.052))
            blade = active()
            blade.scale = (0.12, 0.024, 1)
            blade.rotation_euler = (0.2 if k == 0 else -0.2, 0, ang)
            parts.append(blade)
    return join(parts, "drone_rotor")


def led():
    bpy.ops.mesh.primitive_uv_sphere_add(segments=14, ring_count=7, radius=0.07, location=(0, 0, -0.022))
    ob = active()
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z > 0.004], context="VERTS")
    bm.to_mesh(ob.data)
    bm.free()
    ob.scale = (1, 1, 0.85)
    return join([ob], "drone_led", smooth=True)


def main():
    reset()
    objs = [frame(), trim(), rotors(), led()]
    tris = 0
    for o in objs:
        o.data.calc_loop_triangles()
        tris += len(o.data.loop_triangles)
        print(f"  {o.name}: {len(o.data.loop_triangles)} triangles")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=True,
                              export_yup=True, export_apply=True, export_materials="NONE",
                              export_texcoords=False, export_normals=True)
    print(f"drone: {tris} triangles -> {OUT} ({os.path.getsize(OUT)} bytes)")


if __name__ == "__main__":
    main()
