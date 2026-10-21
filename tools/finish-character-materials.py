"""Matte art direction for the Xiaoshang native Blender / GLB asset.

blender --factory-startup --background --python tools/finish-character-materials.py -- model.blend
Material-only pass: never changes topology, skin weights, UVs or facial shape keys.
"""
import sys
from pathlib import Path

import bpy


def finish_materials():
    for material in bpy.data.materials:
        if not material.use_nodes:
            continue
        face = '.001' in material.name and material.name.startswith('tripo_material')
        generated = material.name.startswith('tripo_material')
        for node in material.node_tree.nodes:
            if node.type == 'NORMAL_MAP':
                node.inputs['Strength'].default_value = 0 if face else .22
            if node.type != 'BSDF_PRINCIPLED':
                continue
            # The generated atlas includes isolated near-glossy roughness values.
            # Use a deliberate matte finish, without multiplying those values back in.
            for socket in ('Metallic', 'Roughness', 'Specular IOR Level', 'Coat Weight'):
                if socket in node.inputs:
                    for link in list(node.inputs[socket].links):
                        material.node_tree.links.remove(link)
            node.inputs['Metallic'].default_value = 0
            node.inputs['Roughness'].default_value = .88 if face else (.94 if generated else .90)
            node.inputs['Specular IOR Level'].default_value = .18 if face else .12
            node.inputs['Coat Weight'].default_value = 0
        material['art_finish'] = 'matte-v1'


if __name__ == '__main__':
    source = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
    bpy.ops.wm.open_mainfile(filepath=str(source))
    finish_materials()
    bpy.ops.wm.save_as_mainfile(filepath=str(source), compress=True)
    bpy.ops.export_scene.gltf(filepath=str(source.with_suffix('.glb')), export_format='GLB',
                              export_materials='EXPORT', export_morph=True)
    print('MATTE_FINISH_SAVED ' + str(source), flush=True)
