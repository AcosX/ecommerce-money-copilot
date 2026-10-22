"""Build modular, closed hard-surface replacements for the three late-stage stores.
Run: blender --background --python tools/build-modular-stores.py
Source geometry stays editable in the ignored .blend workspace; released GLBs and material images are versioned.
"""
import bpy, math, json
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'assets/models/buildings-v3'
TEX=ROOT/'assets/game/building-materials-v3'
WORK=ROOT/'assets/models/tripo/modular-buildings-v3'
for p in [OUT,TEX,WORK]:p.mkdir(parents=True,exist_ok=True)
MAT={};MODULES={};GROUP='body'
def material(name,color,rough=.5,metal=0,texture=None,emission=0):
 m=bpy.data.materials.new(name);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF') or m.node_tree.nodes.new('ShaderNodeBsdfPrincipled');out=m.node_tree.nodes.get('Material Output') or m.node_tree.nodes.new('ShaderNodeOutputMaterial');m.node_tree.links.new(p.outputs['BSDF'],out.inputs['Surface']);p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal
 if texture:
  image=bpy.data.images.load(str(TEX/(texture+'.jpg')),check_existing=True);n=m.node_tree.nodes.new('ShaderNodeTexImage');n.image=image;m.node_tree.links.new(n.outputs['Color'],p.inputs['Base Color'])
 if emission:p.inputs['Emission Color'].default_value=(*color,1);p.inputs['Emission Strength'].default_value=emission
 MAT[name]=m;return m
def finish(o,name,mat,bevel=.018):
 o.name=name;o.data.materials.append(MAT[mat]);MODULES.setdefault(GROUP,[]).append(o)
 if o.type=='MESH':
  if not o.data.uv_layers:o.data.uv_layers.new(name='UVMap')
  # Box projection at consistent physical scale; Blender bevel interpolates the UVs.
  uv=o.data.uv_layers.active.data
  for face in o.data.polygons:
   axis=max(range(3),key=lambda k:abs(face.normal[k]));axes=[k for k in range(3) if k!=axis]
   for li in face.loop_indices:
    co=o.data.vertices[o.data.loops[li].vertex_index].co;uv[li].uv=(co[axes[0]]*(1.3 if mat=='brick' else .42),co[axes[1]]*(1.3 if mat=='brick' else .42))
  if bevel:
   b=o.modifiers.new('Manufactured edge bevel','BEVEL');b.width=bevel;b.segments=3;b.limit_method='ANGLE';b.angle_limit=.35
   bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=b.name)
  for p in o.data.polygons:p.use_smooth=True
  w=o.modifiers.new('Architectural weighted normals','WEIGHTED_NORMAL');w.keep_sharp=True;w.weight=40;bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=w.name)
 return o
def cube(name,dim,loc,mat='stone',bevel=.015):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.dimensions=dim;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);return finish(o,name,mat,bevel)
def rounded(name,w,d,h,x,y,z,mat='stone',r=.3):
 r=min(r,w/2-.001,d/2-.001);pts=[]
 for cx,cy,start in [(w/2-r,d/2-r,0),(-w/2+r,d/2-r,90),(-w/2+r,-d/2+r,180),(w/2-r,-d/2+r,270)]:
  for j in range(9):
   a=math.radians(start+j*90/8);pts.append((cx+r*math.cos(a),cy+r*math.sin(a)))
 n=len(pts);verts=[(a,b,c) for c in [-h/2,h/2] for a,b in pts];faces=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
 mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update();o=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(o);o.location=(x,y,z);return finish(o,name,mat,min(.016,h*.15))
def cylinder(name,r,h,loc,mat='gold'):
 bpy.ops.mesh.primitive_cylinder_add(vertices=24,radius=r,depth=h,location=loc);return finish(bpy.context.object,name,mat,.012)
def beam(name,a,b,w,d,mat):
 mid=(Vector(a)+Vector(b))/2;v=Vector(b)-Vector(a);o=cube(name,(w,d,v.length),mid,mat,.008);o.rotation_euler=v.to_track_quat('Z','Y').to_euler();return o
def band_windows(w,d,x,y,z,h,mat='glass',r=.28):
 rounded('Continuous glazing',w,d,h,x,y,z,mat,r)
 for direction in [-1,1]:
  n=max(2,round((w-.7)/.43))
  for j in range(n+1):
   wx=x-(w-.7)/2+j*(w-.7)/n;cube('Vertical window mullion',(.028,.042,h+.015),(wx,y+direction*(d/2+.015),z),'frame',.004)
  n=max(2,round((d-.7)/.43))
  for j in range(n+1):cube('Side window mullion',(.042,.028,h+.015),(x+direction*(w/2+.015),y-(d-.7)/2+j*(d-.7)/n,z),'frame',.004)
def door(x,y,z,w=1.0,h=1.2):
 global GROUP
 prev=GROUP;GROUP='entrance'
 cube('Entry surround',(w+.19,.16,h+.15),(x,y,z+h/2),'gold',.025);cube('Dark entry glass',(w,.025,h),(x,y-.095,z+h/2),'glass',.006)
 cube('Double door center',(.026,.04,h),(x,y-.12,z+h/2),'gold',.003)
 for sign in [-1,1]:cube('Door pull',(.022,.045,.26),(x+sign*.08,y-.155,z+h*.48),'gold',.003)
 GROUP=prev
def sign(x,y,z,w,h):
 global GROUP
 prev=GROUP;GROUP='sign'
 cube('Blank sign frame',(w+.12,.14,h+.12),(x,y,z),'gold',.025);cube('User name panel',(w,.035,h),(x,y-.09,z),'sign',.014);GROUP=prev
def planter(w,d,x,y,z):
 rounded('Terrace planter',w,d,.12,x,y,z,'stone',.07);rounded('Clipped green hedge',w-.045,d-.045,.105,x,y,z+.10,'green',.07)
def steps(w,n,x,y,z):
 for j in range(n):cube('Entrance step',(w,.20,.07),(x,y+j*.16,z+j*.065),'plinth',.009)
def init():
 global MAT,MODULES,GROUP
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
 for m in list(bpy.data.materials):bpy.data.materials.remove(m)
 MAT={};MODULES={};GROUP='body'
 material('stone',(.78,.76,.69),.62,0,'limestone');material('brick',(.48,.18,.10),.87,0,'brick');material('gold',(.65,.48,.22),.32,.72,'metal');material('glass',(.06,.14,.20),.16,.6,'glass');material('frame',(.06,.08,.10),.32,.6);material('white',(.78,.79,.76),.42,.12);material('silver',(.45,.49,.50),.35,.65);material('roof',(.055,.073,.09),.45,.55);material('yellow',(.68,.42,.045),.43,.3);material('orange',(.75,.20,.035),.40,.4);material('plinth',(.33,.35,.34),.85);material('sign',(.81,.75,.59),.4,.2);material('green',(.10,.16,.075),.95);material('warm',(.95,.58,.20),.4,0,emission=.6);material('cyan',(.09,.56,.65),.32,.2,emission=.4);material('retail',(.25,.19,.10),.33,.1,'retail',emission=.18)
def modern_tower(x,y,w,d,floors,base=.18):
 global GROUP
 for f in range(floors):
  z=base+f*.84
  GROUP='body';rounded('Tower floor core',w-.10,d-.10,.82,x,y,z+.41,'white',.23);band_windows(w,d,x,y,z+.43,.61,mat='retail' if f==0 else 'glass',r=.25)
  GROUP='floors';rounded('Tower structural sill',w+.075,d+.075,.09,x,y,z+.04,'white',.28);rounded('Brushed floor seam',w+.08,d+.08,.025,x,y,z+.10,'silver',.28)
 GROUP='roof';rounded('Tower roof slab',w+.11,d+.11,.12,x,y,base+floors*.84+.02,'white',.29)
def build5():
 global GROUP
 GROUP='foundation';rounded('Closed stone foundation',6.5,4.8,.20,0,0,.10,'plinth',.3)
 # Staggered terraces are physical floor modules; glazing sits OUTSIDE the backing, never hidden by it.
 for f in range(6):
  z=.20+f*.82;w=6.10-f*.55;d=4.30-f*.32;x=f*.08;y=f*.045
  GROUP='body';rounded('Level backing',w-.14,d-.14,.74,x,y,z+.40,'stone',.42);band_windows(w,d,x,y,z+.43,.58,mat='retail' if f==0 else 'glass',r=.45)
  GROUP='floors';rounded('Stone terrace fascia',w+.18,d+.18,.13,x,y,z+.79,'stone',.48);rounded('Satin gold reveal',w+.20,d+.20,.035,x,y,z+.71,'gold',.49)
  # Cornice shadow gap and recessed soffit give depth without faceted sculpting.
  rounded('Soffit shadow line',w+.07,d+.07,.025,x,y,z+.68,'frame',.44)
  GROUP='details'
  for sx in [-1,1]:
   cube('Continuous recessed warm light',(max(.4,w-.7),.025,.018),(x,y+sx*(d/2+.065),z+.69),'warm',.003)
  if f in [1,3,5]:planter(w-.85,.16,x,y-d/2+.19,z+.91)
 GROUP='roof';rounded('Penthouse cap',2.25,2.15,.18,.5,.22,5.27,'stone',.35)
 GROUP='body';rounded('Central portal tower',1.20,1.05,5.50,.15,-1.55,2.98,'stone',.14);cube('Portal vertical glass',(.78,.045,4.68),(.15,-2.10,2.95),'glass',.01)
 for x in [-.49,.79]:cube('Tower gold fin',(.105,.16,5.38),(x,-2.14,2.96),'gold',.018)
 for f in range(6):cube('Portal floor transom',(.83,.07,.027),(.15,-2.145,.64+f*.76),'gold',.004)
 GROUP='entrance';rounded('Grand entrance canopy',3.60,1.45,.20,.15,-2.03,1.60,'stone',.40);rounded('Canopy gold trim',3.64,1.49,.045,.15,-2.03,1.49,'gold',.42)
 for x in [-1.12,1.42]:
  cylinder('Entry bronze column',.115,1.25,(x,-2.37,.90));cylinder('Column foot',.145,.10,(x,-2.37,.30));cylinder('Column capital',.145,.09,(x,-2.37,1.47))
 for x in [-.7,0,.7]:cube('Recessed soffit light',(.16,.30,.012),(x,-2.25,1.485),'warm',.005)
 door(.15,-2.18,.23,.94,1.15);steps(2.70,3,.15,-2.67,.035)
 sign(.15,-2.16,5.12,.88,.87)
 GROUP='roof';cube('Crown vertical plinth',(.11,.15,.27),(.15,-1.55,5.86),'gold');o=cube('Geometric shop emblem',(.34,.17,.34),(.15,-1.55,6.10),'gold',.018);o.rotation_euler.y=math.pi/4
 # Real facade panel joints on the back and side maintain a finished all-around model.
 GROUP='details'
 for f in range(6):
  w=6.1-f*.55;d=4.3-f*.32;x=f*.08;y=f*.045;z=.2+f*.82
  for k in [-1,1]:
   for j in range(3):cube('Stone panel joint',(.012,.012,.14),(x+(j-1)*w*.22,y+k*(d/2+.11),z+.78),'frame',.001)
def build4():
 global GROUP
 GROUP='foundation';rounded('Closed arcade foundation',6.45,3.85,.18,0,0,.09,'plinth',.16)
 modern_tower(-1.93,.15,1.95,2.60,5);modern_tower(1.62,.15,2.30,2.60,4)
 GROUP='roof';rounded('Offset upper penthouse',1.45,1.85,.85,1.98,.38,4.04,'white',.18);band_windows(1.48,1.88,1.98,.38,4.04,.64,r=.19);rounded('Penthouse roof',1.60,2.0,.1,1.98,.38,4.52,'white',.22)
 GROUP='bridge';cube('Bridge slab',(2.05,1.02,.15),(-.12,.12,2.74),'silver');cube('Bridge canopy',(2.05,1.02,.13),(-.12,.12,3.52),'white');cube('Bridge glass body',(2.03,.94,.62),(-.12,.12,3.13),'glass')
 for j in range(6):
  for side in [-1,1]:cube('Bridge vertical mullion',(.026,.038,.65),(-1.12+j*.40,.12+side*.48,3.13),'frame',.004)
 for side in [-1,1]:cube('Bridge light ribbon',(2.04,.028,.024),(-.12,.12+side*.53,3.46),'cyan',.004)
 GROUP='details';cube('Cyan tower recess',(.36,.10,3.24),(-1.18,-1.24,2.34),'frame');cube('Tower identity light',(.26,.03,3.10),(-1.18,-1.31,2.34),'cyan')
 for x,y,z,w in [(-1.93,-1.01,4.52,1.5),(1.62,-1.02,3.68,1.8)]:planter(w,.18,x,y,z)
 GROUP='entrance';rounded('Orange arcade canopy',4.5,1.50,.19,.12,-1.63,1.20,'orange',.25);rounded('Canopy top',4.43,1.43,.04,.12,-1.63,1.315,'silver',.24)
 for x in [-1.65,1.80]:cylinder('Canopy support',.09,.93,(x,-2.13,.64),'orange')
 cube('Entrance canopy warm strip',(4.05,.035,.025),(.12,-2.40,1.105),'warm')
 cube('Arcade recessed entry',(1.5,.12,.92),(-.05,-1.05,.67),'frame');door(-.05,-1.14,.20,1.05,.86);steps(1.8,3,-.05,-2.2,.035)
 sign(1.62,-1.24,2.52,1.70,.65)
def build3():
 global GROUP
 GROUP='foundation';cube('Closed factory foundation',(4.9,3.9,.19),(-.15,0,.095),'plinth')
 GROUP='body';cube('Brick factory structure',(3.8,3.0,3.27),(0,0,1.82),'brick',.025)
 # Brick piers remain visible between deep industrial windows.
 for f in range(3):
  z=.22+f*1.05
  for side in [-1,1]:
   for j in range(4):
    x=-1.39+j*.93;cube('Black window reveal',(.73,.12,.82),(x,side*1.51,z+.52),'frame',.012);cube('Factory window glass',(.63,.026,.71),(x,side*1.58,z+.52),'retail' if f==0 else 'glass',.004)
    cube('Window cross mullion',(.64,.035,.025),(x,side*1.61,z+.52),'frame',.003);cube('Window center mullion',(.025,.035,.72),(x,side*1.61,z+.52),'frame',.003)
  for side in [-1,1]:
   for j in range(3):
    y=-.98+j*.98;cube('Side black reveal',(.12,.73,.82),(side*1.91,y,z+.52),'frame',.012);cube('Side factory glass',(.026,.63,.71),(side*1.98,y,z+.52),'retail' if f==0 else 'glass',.004)
  GROUP='floors';cube('Concrete sill course',(3.91,3.1,.085),(0,0,z),'silver',.009);GROUP='body'
 GROUP='roof'
 # Sawtooth roof: closed wedge solids with bevelled sloping metal plates.
 for j in range(3):
  x=-1.27+j*1.27;verts=[(x-.635,-1.54,3.48),(x+.635,-1.54,3.48),(x+.635,-1.54,4.05),(x-.635,1.54,3.48),(x+.635,1.54,3.48),(x+.635,1.54,4.05)]
  faces=[(0,2,1),(3,4,5),(0,1,4,3),(1,2,5,4),(2,0,3,5)];m=bpy.data.meshes.new('Sawtooth');m.from_pydata(verts,[],faces);m.update();o=bpy.data.objects.new('Closed sawtooth roof',m);bpy.context.collection.objects.link(o);finish(o,'Closed sawtooth roof','roof',.012);o.data.materials.append(MAT['glass']);
  for poly in o.data.polygons:
   if abs(poly.normal.y)>.98:poly.material_index=1
  slope=cube('Standing seam roof plate',(1.42,3.18,.045),(x,0,3.77),'roof',.008);slope.rotation_euler.y=-math.atan(.57/1.27)
  for k in range(9):beam('Roof standing seam',(x-.64,-1.52+k*.38,3.50),(x+.64,-1.52+k*.38,4.07),.018,.02,'silver')
 cube('Brick chimney',(.39,.42,.83),(-1.22,.76,4.09),'brick');cube('Chimney cap',(.49,.52,.075),(-1.22,.76,4.54),'roof')
 GROUP='floors'
 for z in [1.30,2.36]:cube('Cantilevered gallery fascia',(4.05,.60,.17),(0,-1.62,z),'silver',.015)
 for x in [-1.94,1.94]:cube('Gallery edge post',(.08,.08,1.0),(x,-1.91,1.86),'frame')
 GROUP='entrance'
 for i in range(13):cube('Stair tread',(.74,.23,.085),(-2.24,-1.50+i*.18,.27+i*.085),'plinth',.008)
 for x in [-2.65,-1.83]:beam('Yellow stair solid parapet',(x,-1.61,.73),(x,.81,1.80),.09,.40,'yellow')
 cube('Yellow landing',(.92,.70,.14),(-2.24,.97,1.38),'yellow');door(0,-1.62,.23,.85,.91)
 sign(0,-1.64,2.92,2.66,.46)
def export(level):
 global GROUP
 folder=OUT/f'level-{level}';folder.mkdir(parents=True,exist_ok=True);parts=[];audit=[]
 for group,objects in MODULES.items():
  if not objects:continue
  bpy.ops.object.select_all(action='DESELECT')
  for o in objects:o.select_set(True)
  bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join();obj=bpy.context.object;obj.name=group;parts.append(obj)
  import bmesh
  bm=bmesh.new();bm.from_mesh(obj.data);boundary=sum(1 for e in bm.edges if e.is_boundary);nonmanifold=sum(1 for e in bm.edges if not e.is_manifold);bm.free()
  if boundary or nonmanifold:raise RuntimeError(f'Open module: {level}/{group}: {boundary}/{nonmanifold}')
  obj.data.calc_loop_triangles();audit.append({'name':group,'file':f'level-{level}/{group}.glb','triangles':len(obj.data.loop_triangles),'boundary_edges':boundary,'nonmanifold_edges':nonmanifold,'materials':[m.name for m in obj.data.materials]})
  bpy.ops.export_scene.gltf(filepath=str(folder/(group+'.glb')),export_format='GLB',use_selection=True,export_image_format='JPEG',export_jpeg_quality=94,export_extras=True)
 bpy.ops.object.select_all(action='DESELECT')
 for o in parts:o.select_set(True)
 bpy.context.view_layer.objects.active=parts[0]
 bpy.ops.export_scene.gltf(filepath=str(OUT/f'level-{level}-web.glb'),export_format='GLB',use_selection=True,export_image_format='JPEG',export_jpeg_quality=94,export_extras=True)
 bpy.ops.wm.save_as_mainfile(filepath=str(WORK/f'level-{level}.blend'))
 (folder/'audit.json').write_text(json.dumps({'level':level,'modules':audit,'triangles':sum(x['triangles'] for x in audit),'bytes':(OUT/f'level-{level}-web.glb').stat().st_size},indent=2),encoding='utf-8')
 print('MODULAR_COMPLETE',level,len(parts),flush=True)
for level,builder in [(5,build5),(4,build4),(3,build3)]:init();builder();export(level)

entries=[]
for level in [3,4,5]:
 audit=json.loads((OUT/f'level-{level}/audit.json').read_text());audit.update(model_url=f'assets/models/buildings-v3/level-{level}-web.glb',separate_editable_modules=True,status='modular_candidate_for_visual_review');entries.append(audit)
(OUT/'manifest.json').write_text(json.dumps({'version':3,'source':'Blender hard-surface modules with generated material textures','integration_status':'preview_only_not_connected_to_game','buildings':entries},indent=2)+'\n',encoding='utf-8')
