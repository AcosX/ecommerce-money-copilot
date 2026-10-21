"""Add independently controllable facial morphs to a reviewed humanoid GLB in Blender.

blender --background --python tools/build-character-face.py -- input.glb output.glb landmarks.json
Landmarks are measured in world space from an orthographic face render, never inferred from names.
"""
import json
import math
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector
from mathutils.kdtree import KDTree


def smooth(value):
    value = max(0, min(1, value))
    return value * value * (3 - 2 * value)


def box(value, center, radius):
    return smooth((1 - abs(value - center) / radius) / .35)


def main():
    source, target, landmarks = [Path(s).resolve() for s in sys.argv[sys.argv.index('--') + 1:]]
    cfg = json.loads(landmarks.read_text(encoding='utf-8'))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(source))
    body = next(o for o in bpy.context.scene.objects if o.type == 'MESH' and len(o.data.polygons) > 100)
    rigs = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE']
    for rig in rigs:
        rig.data.pose_position = 'REST'
    world = body.matrix_world.copy()
    bpy.ops.object.select_all(action='DESELECT')
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.context.tool_settings.mesh_select_mode = (False, False, True)
    bpy.ops.object.mode_set(mode='EDIT')
    bm = bmesh.from_edit_mesh(body.data)
    selected = 0
    for face in bm.faces:
        p = world @ face.calc_center_median()
        include = (p.x > cfg['front_min_x'] and abs(p.y - cfg.get('center_y', 0)) < cfg['face_half_width']
                   and cfg['face_min_z'] < p.z < cfg['face_max_z'])
        face.select_set(include)
        selected += include
    if selected < 60:
        raise ValueError(f'Too little facial topology selected: {selected}')
    bmesh.update_edit_mesh(body.data)
    bpy.ops.mesh.separate(type='SELECTED')
    bpy.ops.object.mode_set(mode='OBJECT')
    face_obj = next(o for o in bpy.context.selected_objects if o.type == 'MESH' and o != body)
    face_obj.name = 'Xiaoshang_Face'
    body.name = 'Xiaoshang_Body'
    # Facial density is added locally; the outfit's mesh and textures are untouched.
    bm = bmesh.new()
    bm.from_mesh(face_obj.data)
    bmesh.ops.subdivide_edges(bm, edges=list(bm.edges), cuts=1, use_grid_fill=True)
    bm.verts.ensure_lookup_table()
    boundary = []
    for vertex in bm.verts:
        p = world @ vertex.co
        outer = (p.x < cfg['front_min_x'] + .008
                 or abs(p.y - cfg.get('center_y', 0)) > cfg['face_half_width'] - .012
                 or p.z < cfg['face_min_z'] + .012 or p.z > cfg['face_max_z'] - .012)
        if outer and any(edge.is_boundary for edge in vertex.link_edges):
            boundary.append(vertex.co.copy())
    bm.to_mesh(face_obj.data)
    bm.free()
    face_obj.data.update()
    for polygon in face_obj.data.polygons:
        polygon.use_smooth = True
    if face_obj.data.has_custom_normals:
        face_obj.data.normals_split_custom_set([(0, 0, 0)] * len(face_obj.data.loops))
    basis = face_obj.shape_key_add(name='Basis', from_mix=False)
    basis.value = 0
    world = face_obj.matrix_world.copy()
    inverse = world.inverted().to_3x3()
    positions = [world @ v.co for v in face_obj.data.vertices]
    bind_positions = [v.co.copy() for v in face_obj.data.vertices]
    tree = KDTree(len(boundary))
    for i, position in enumerate(boundary):
        tree.insert(world @ position, i)
    tree.balance()
    boundary_fade = [smooth(tree.find(p)[2] / .012) for p in positions]
    # The outfit keeps its detailed normal maps. A softer face normal map avoids
    # baking open-eye creases into the closed-eye pose.
    for slot in face_obj.material_slots:
        material = slot.material.copy()
        slot.material = material
        if material.use_nodes:
            for node in material.node_tree.nodes:
                if node.type == 'NORMAL_MAP':
                    node.inputs['Strength'].default_value = 0
    eye_z, eye_y = cfg['eye_z'], cfg['eye_y']
    mouth_z = cfg['mouth_z']
    mx, mz = cfg['mouth_half_width'], cfg['mouth_half_height']
    scale = cfg.get('height', 1.75) / 1.75

    def primitive(name, p):
        p = p.copy()
        p.y -= cfg.get('center_y', 0)
        left_y = cfg.get('eye_left_y', -eye_y) - cfg.get('center_y', 0)
        right_y = cfg.get('eye_right_y', eye_y) - cfg.get('center_y', 0)
        front = smooth((p.x - cfg.get('deform_min_x', cfg['front_min_x'])) / (.02 * scale))
        eye_left = box(p.y, left_y, cfg['eye_half_width']) * box(p.z, eye_z, cfg['eye_half_height']) * front
        eye_right = box(p.y, right_y, cfg['eye_half_width']) * box(p.z, eye_z, cfg['eye_half_height']) * front
        mouth = box(p.y, 0, mx * 1.5) * box(p.z, mouth_z, mz * 2.2) * front
        jaw = box(p.y, 0, mx * 2.5) * box(p.z, mouth_z - .028 * scale, .066 * scale) * front
        brow_left = box(p.y, left_y, cfg['eye_half_width'] * 1.3) * box(p.z, cfg['brow_z'], .020 * scale) * front
        brow_right = box(p.y, right_y, cfg['eye_half_width'] * 1.3) * box(p.z, cfg['brow_z'], .020 * scale) * front
        d = Vector((0, 0, 0))
        if name in ('eyeBlinkLeft', 'eyeBlinkRight'):
            mask = eye_left if name.endswith('Left') else eye_right
            d.z = (eye_z - p.z) * .98 * mask
            d.x = -.0008 * scale * mask
        elif name in ('eyeWideLeft', 'eyeWideRight'):
            mask = eye_left if name.endswith('Left') else eye_right
            d.z = (p.z - eye_z) * .30 * mask
        elif name == 'browInnerUp':
            d.z = .012 * scale * (brow_left + brow_right) * box(p.y, 0, eye_y)
        elif name == 'browOuterUp':
            d.z = .010 * scale * (brow_left + brow_right)
        elif name == 'browDown':
            d.z = -.008 * scale * (brow_left + brow_right)
            d.y = -p.y * .10 * (brow_left + brow_right)
        elif name == 'mouthSmile':
            corners = box(p.y, -mx * .8, mx * .55) + box(p.y, mx * .8, mx * .55)
            mask = corners * box(p.z, mouth_z, mz * 1.8) * front
            d.z = .009 * scale * mask
            d.y = math.copysign(.0035 * scale * mask, p.y)
        elif name == 'mouthFrown':
            corners = box(p.y, -mx * .8, mx * .6) + box(p.y, mx * .8, mx * .6)
            d.z = -.008 * scale * corners * box(p.z, mouth_z, mz * 1.8) * front
        elif name == 'cheekRaise':
            d.z = .005 * scale * (eye_left + eye_right) * smooth((eye_z - p.z) / cfg['eye_half_height'])
        elif name == 'jawOpen':
            weight = smooth((mouth_z + .002 * scale - p.z) / (.020 * scale)) * jaw
            d.z = -.019 * scale * weight
            d.x = .003 * scale * weight
        elif name == 'mouthClose':
            close = box(p.y, 0, mx * 1.4) * box(p.z, mouth_z, mz * 1.8) * front
            d.z = (mouth_z - p.z) * .98 * close
            d.x = -.001 * scale * close
        elif name == 'mouthFunnel':
            d.y = -p.y * .32 * mouth
            d.x = .008 * scale * mouth
        elif name == 'mouthPucker':
            d.y = -p.y * .45 * mouth
            d.x = .012 * scale * mouth
        elif name == 'mouthStretch':
            d.y = p.y * .23 * mouth
        elif name == 'lowerLipUp':
            d.z = .008 * scale * mouth * smooth((mouth_z - p.z) / mz)
        return d

    definitions = {name: {name: 1} for name in [
        'eyeBlinkLeft', 'eyeBlinkRight', 'eyeWideLeft', 'eyeWideRight', 'browInnerUp',
        'browOuterUp', 'browDown', 'mouthSmile', 'mouthFrown', 'cheekRaise', 'jawOpen',
        'mouthClose', 'mouthFunnel', 'mouthPucker', 'mouthStretch', 'lowerLipUp']}
    definitions.update({
        'viseme_aa': {'jawOpen': 1},
        'viseme_ih': {'jawOpen': .18, 'mouthStretch': .55},
        'viseme_ou': {'jawOpen': .30, 'mouthPucker': .8},
        'viseme_ee': {'jawOpen': .32, 'mouthStretch': .85},
        'viseme_oh': {'jawOpen': .72, 'mouthFunnel': .9},
        'viseme_mbp': {'mouthClose': 1},
        'viseme_fv': {'mouthClose': .40, 'lowerLipUp': .8},
    })
    report = {'landmarks': cfg, 'face_vertices': len(positions), 'morphs': {}}
    for name, combination in definitions.items():
        key = face_obj.shape_key_add(name=name, from_mix=False)
        key.value = 0
        moved, maximum = 0, 0
        for i, position in enumerate(positions):
            delta = sum((primitive(part, position) * weight for part, weight in combination.items()), Vector())
            delta *= boundary_fade[i]
            key.data[i].co = bind_positions[i] + inverse @ delta
            if delta.length > .000001:
                moved += 1
                maximum = max(maximum, delta.length)
        if moved < 3:
            raise ValueError(f'Morph {name} has no useful deformation; recheck landmarks')
        report['morphs'][name] = {'moved_vertices': moved, 'max_displacement': maximum}
    for rig in rigs:
        rig.data.pose_position = 'POSE'
    target.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(target), export_format='GLB', export_materials='EXPORT', export_morph=True)
    blend = target.with_suffix('.blend')
    bpy.ops.wm.save_as_mainfile(filepath=str(blend), compress=True)
    target.with_suffix('.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print('FACIAL_REPORT ' + json.dumps(report), flush=True)


if __name__ == '__main__':
    main()
