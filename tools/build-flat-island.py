"""Level the playable ground while retaining original 3D vegetation, stones and cliff.
blender --background --factory-startup --python tools/build-flat-island.py
"""
import bpy,bmesh,json,math
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
WORK=ROOT/'assets/models/tripo/island-flat-v2';WORK.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(ROOT/'assets/models/island-web.glb'))
objects=[o for o in bpy.context.scene.objects if o.type=='MESH'];stats=[]
for o in objects:
 bm=bmesh.new();bm.from_mesh(o.data);leveled=0;preserved=0
 for q in bm.verts:
  z=q.co.z;r=math.hypot(q.co.x,q.co.y)
  radial=1.0 # Level the full top to the rim; no raised annular transition.
  # A continuous deformation keeps duplicated UV seam vertices watertight.
  if .08<z<.22 and radial>0:
   # The entire central support surface is horizontal (under 3 mm relief in game units).
   if z<.10:target=.08+(z-.08)/.02*(.1708-.08)
   elif z<=.20:target=.1708+(z-.10)/.10*.0004
   else:target=.1712+(z-.20)/.02*(.22-.1712)
   q.co.z=z+(target-z)*radial;leveled+=1
  else:preserved+=1
 bm.normal_update();bm.to_mesh(o.data);bm.free();o.data.update()
 stats.append({'leveled_vertices':leveled,'preserved_vertices':preserved})
bpy.ops.object.select_all(action='DESELECT')
for o in objects:o.select_set(True)
bpy.context.view_layer.objects.active=objects[0]
bpy.ops.export_scene.gltf(filepath=str(WORK/'island-flat-source.glb'),export_format='GLB',use_selection=True,export_image_format='AUTO')
(WORK/'build.json').write_text(json.dumps({'source':'assets/models/island-web.glb','method':'continuous ground leveling; preserve volumetric details and source UV textures','stats':stats},indent=2)+'\n')
print('ISLAND_RELIEF_COMPLETE',stats)
