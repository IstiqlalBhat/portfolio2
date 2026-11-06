"""Headless Blender generator for the light-show quadcopter used by every drone in the swarm.

Run:  /usr/bin/python3 blender/make_drone.py          (needs `pip install bpy`)
Then: npx gltfpack -i blender/out/drone.glb -o public/assets/drone.glb -cc -kn

Three named meshes are exported so the shader can treat them differently:
  drone_frame  - body, arms, motors (lit by the moon, dark carbon colour)
  drone_rotor  - four two-blade props (flat quads, drawn double-sided) (spun in the vertex shader around their hubs)
  drone_led    - the LED pod under the body (emissive, coloured per drone)
Hub positions must match ROTOR_R in src/swarm.js.
"""
import math
import os

import bpy

ROTOR_R = 0.25          # arm-tip offset on x and z
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out", "drone.glb")


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def join(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = bpy.context.active_object
    ob.name = name
    ob.data.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.shade_flat()
    return ob


def box(size, loc, rot_y=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=(0, rot_y, 0))
    ob = bpy.context.active_object
    ob.scale = size
    return ob


def frame():
    parts = []
    # body: low octagonal puck with a bevelled lid
    bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=0.13, depth=0.07, location=(0, 0, 0))
    parts.append(bpy.context.active_object)
    bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=0.08, depth=0.035, location=(0, 0, 0.05))
    parts.append(bpy.context.active_object)
    # four arms on the diagonals
    arm_len = math.hypot(ROTOR_R, ROTOR_R)
    for sx, sy in ((1, 1), (-1, 1), (-1, -1), (1, -1)):
        ang = math.atan2(sy, sx)
        bpy.ops.mesh.primitive_cube_add(size=1, location=(sx * ROTOR_R / 2, sy * ROTOR_R / 2, 0))
        arm = bpy.context.active_object
        arm.scale = (arm_len, 0.034, 0.026)
        arm.rotation_euler = (0, 0, ang)
        parts.append(arm)
        # motor bell
        bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=0.042, depth=0.05,
                                            location=(sx * ROTOR_R, sy * ROTOR_R, 0.02))
        parts.append(bpy.context.active_object)
    return join(parts, "drone_frame")


def rotors():
    parts = []
    for sx, sy in ((1, 1), (-1, 1), (-1, -1), (1, -1)):
        for k in range(2):
            ang = math.pi / 4 * (1 if sx * sy > 0 else -1) + k * math.pi
            cx = sx * ROTOR_R + math.cos(ang) * 0.065
            cy = sy * ROTOR_R + math.sin(ang) * 0.065
            bpy.ops.mesh.primitive_plane_add(size=1, location=(cx, cy, 0.052))
            blade = bpy.context.active_object
            blade.scale = (0.13, 0.026, 1)
            blade.rotation_euler = (0.18 if k == 0 else -0.18, 0, ang)
            parts.append(blade)
    return join(parts, "drone_rotor")


def led():
    bpy.ops.mesh.primitive_uv_sphere_add(segments=8, ring_count=5, radius=0.075, location=(0, 0, -0.06))
    ob = bpy.context.active_object
    ob.scale = (1, 1, 0.8)
    ob.name = "drone_led"
    ob.data.name = "drone_led"
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.shade_smooth()
    return ob


def main():
    reset()
    objs = [frame(), rotors(), led()]
    tris = 0
    for o in objs:
        o.data.calc_loop_triangles()
        tris += len(o.data.loop_triangles)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=True,
                              export_yup=True, export_apply=True, export_materials="NONE",
                              export_texcoords=False, export_normals=True)
    print(f"drone: {tris} triangles -> {OUT} ({os.path.getsize(OUT)} bytes)")


if __name__ == "__main__":
    main()
