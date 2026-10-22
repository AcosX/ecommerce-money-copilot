"""Rebuild one planar island cap while preserving the source cliff and its textures.
blender --background --factory-startup --python tools/build-flat-island.py
"""
import bpy,bmesh,math,json
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1];WORK=ROOT/'assets/models/tripo/island-flat-v2';WORK.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(ROOT/'assets/models/island-web.glb'))
objects=[o for o in bpy.context.scene.objects if o.type=='MESH']
for o in objects:
 bpy.context.view_layer.objects.active=o;o.select_set(True);bpy.ops.object.transform_apply(location=True,rotation=True,scale=True);o.select_set(False)
pts=[o.matrix_world@v.co for o in objects for v in o.data.vertices];lo=Vector([min(p[k] for p in pts) for k in range(3)]);hi=Vector([max(p[k] for p in pts) for k in range(3)]);center=(lo+hi)/2;span=max(hi.x-lo.x,hi.y-lo.y)
# The old GLB has a uniform 5.038985729 source-node scale.
cut=.10*5.038985729217529;plane=.115*5.038985729217529
# Capture the source ground's base color from directly above, without baked shadows or normal-map lumps.
original_links=[]
for m in bpy.data.materials:
 if not m.use_nodes:continue
 p=next((n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None);output=next((n for n in m.node_tree.nodes if n.type=='OUTPUT_MATERIAL'),None)
 if not p or not output:continue
 source=p.inputs['Base Color'];em=m.node_tree.nodes.new('ShaderNodeEmission')
 if source.is_linked:m.node_tree.links.new(source.links[0].from_socket,em.inputs['Color'])
 else:em.inputs['Color'].default_value=source.default_value
 previous=[l.from_socket for l in output.inputs['Surface'].links];original_links.append((m,output,previous,em));m.node_tree.links.new(em.outputs[0],output.inputs['Surface'])
bpy.ops.object.camera_add(location=(center.x,center.y,hi.z+8));camera=bpy.context.object;camera.rotation_euler=(0,0,0);camera.data.type='ORTHO';camera.data.ortho_scale=span*1.01;bpy.context.scene.camera=camera
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=1;scene.cycles.use_denoising=False;scene.render.resolution_x=2048;scene.render.resolution_y=2048;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG';scene.render.film_transparent=False;scene.world.color=(.12,.2,.08);scene.view_settings.view_transform='Standard';scene.view_settings.look='None';scene.render.filepath=str(WORK/'ground-albedo.png');bpy.ops.render.render(write_still=True)
for m,output,previous,em in original_links:
 if previous:m.node_tree.links.new(previous[0],output.inputs['Surface'])
 m.node_tree.nodes.remove(em)
image=bpy.data.images.load(str(WORK/'ground-albedo.png'));ground=bpy.data.materials.new('flat_ground');ground.use_nodes=True;p=ground.node_tree.nodes.get('Principled BSDF') or ground.node_tree.nodes.new('ShaderNodeBsdfPrincipled');out=ground.node_tree.nodes.get('Material Output') or ground.node_tree.nodes.new('ShaderNodeOutputMaterial');ground.node_tree.links.new(p.outputs[0],out.inputs['Surface']);p.inputs['Roughness'].default_value=.95;n=ground.node_tree.nodes.new('ShaderNodeTexImage');n.image=image;ground.node_tree.links.new(n.outputs['Color'],p.inputs['Base Color'])
cut_stats=[]
for o in objects:
 bm=bmesh.new();bm.from_mesh(o.data);uv=bm.loops.layers.uv.active or bm.loops.layers.uv.new('UVMap');bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),dist=1e-6,plane_co=(0,0,cut),plane_no=(0,0,1),clear_outer=True,clear_inner=False)
 # One continuous outer cap; source consists of many disconnected rock shells.
 border=[v for v in bm.verts if abs(v.co.z-cut)<1e-4]
 if not border:raise RuntimeError('No island cut boundary found')
 from mathutils.geometry import convex_hull_2d
 points=[v.co.copy() for v in border]
 hull=convex_hull_2d([v.to_2d() for v in points])
 ring=[bm.verts.new((points[k].x,points[k].y,plane)) for k in hull]
 lower=[bm.verts.new((v.co.x,v.co.y,cut-.03)) for v in ring]
 o.data.materials.append(ground);slot=len(o.data.materials)-1
 faces=[bm.faces.new(ring)]
 faces[0].normal_update()
 if faces[0].normal.z<0:faces[0].normal_flip()
 for i in range(len(ring)):
  j=(i+1)%len(ring);f=bm.faces.new([lower[i],lower[j],ring[j],ring[i]]);f.material_index=slot
  for loop in f.loops:loop[uv].uv=((loop.vert.co.x-center.x)/camera.data.ortho_scale+.5,(loop.vert.co.y-center.y)/camera.data.ortho_scale+.5)
 for f in faces:
  f.material_index=slot;f.smooth=False
  for loop in f.loops:loop[uv].uv=((loop.vert.co.x-center.x)/camera.data.ortho_scale+.5,(loop.vert.co.y-center.y)/camera.data.ortho_scale+.5)
 bmesh.ops.triangulate(bm,faces=faces);bm.to_mesh(o.data);bm.free();o.data.update();cut_stats.append({'name':o.name,'outline_vertices':len(ring)})
bpy.ops.object.select_all(action='DESELECT')
for o in objects:o.select_set(True)
bpy.context.view_layer.objects.active=objects[0]
bpy.ops.export_scene.gltf(filepath=str(WORK/'island-flat-source.glb'),export_format='GLB',use_selection=True,export_image_format='JPEG',export_jpeg_quality=95)
bpy.ops.wm.save_as_mainfile(filepath=str(WORK/'island-flat.blend'))
(WORK/'build.json').write_text(json.dumps({'source':'assets/models/island-web.glb','cut_height':cut,'plane_height':plane,'ground_texture_size':2048,'cut':cut_stats},indent=2)+'\n')
print('FLAT_ISLAND_COMPLETE',plane,flush=True)


