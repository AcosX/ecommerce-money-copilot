"""Remove broad ground slopes without collapsing grass, stones or the cliff rim.
blender --background --factory-startup --python tools/build-flat-island.py
"""
import bpy,json,numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
WORK=ROOT/'assets/models/tripo/island-flat-v2';WORK.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(ROOT/'assets/models/island-web.glb'))
objects=[o for o in bpy.context.scene.objects if o.type=='MESH'];stats=[]

def smooth_ground(mesh,size=129):
 """A low-frequency ground reference, excluding tall plants and small stones."""
 points=[v.co.copy() for v in mesh.vertices]
 tree=BVHTree.FromPolygons(points,[list(p.vertices) for p in mesh.polygons])
 lo=np.array([min(v[a] for v in points) for a in range(2)])
 hi=np.array([max(v[a] for v in points) for a in range(2)])
 step=(hi-lo)/(size-1);grid=np.full((size,size),np.nan)
 for y in range(size):
  for x in range(size):
   start=Vector((lo[0]+x*step[0],lo[1]+y*step[1],.205))
   for _ in range(12):
    hit,normal,face,_=tree.ray_cast(start,Vector((0,0,-1)))
    if hit is None or hit.z<.10:break
    if normal.z>.65 and .15<hit.z<.20:
     grid[y,x]=hit.z;break
    start=hit-Vector((0,0,.00001))
 # A local lower quantile rejects raised plant/pebble surfaces. Fill only the
 # missing reference outside the island; the source silhouette stays intact.
 windows=np.lib.stride_tricks.sliding_window_view(np.pad(grid,3,constant_values=np.nan),(7,7))
 import warnings
 with warnings.catch_warnings():
  warnings.simplefilter('ignore',RuntimeWarning)
  field=np.nanpercentile(windows,30,axis=(-2,-1))
 for _ in range(size):
  if np.isfinite(field).all():break
  pad=np.pad(field,1,constant_values=np.nan)
  neighbors=np.stack([pad[dy:dy+size,dx:dx+size] for dy,dx in [(0,1),(2,1),(1,0),(1,2)]])
  counts=np.isfinite(neighbors).sum(axis=0)
  mean=np.nansum(neighbors,axis=0)/np.maximum(counts,1)
  field=np.where(~np.isfinite(field)&(counts>0),mean,field)
 if not np.isfinite(field).all():raise RuntimeError('Cannot derive island ground reference')
 # Gaussian-like blur removes sample noise without inventing a raised rim.
 for _ in range(6):
  pad=np.pad(field,1,mode='edge')
  field=(pad[:-2,:-2]+2*pad[:-2,1:-1]+pad[:-2,2:]+2*pad[1:-1,:-2]+4*pad[1:-1,1:-1]+2*pad[1:-1,2:]+pad[2:,:-2]+2*pad[2:,1:-1]+pad[2:,2:])/16
 gy,gx=np.gradient(field,step[1],step[0])
 def sample(p):
  pos=np.clip((np.array(p[:2])-lo)/step,0,size-1.000001)
  x,y=int(pos[0]),int(pos[1]);tx,ty=pos[0]-x,pos[1]-y
  def lerp(a):return (a[y,x]*(1-tx)+a[y,x+1]*tx)*(1-ty)+(a[y+1,x]*(1-tx)+a[y+1,x+1]*tx)*ty
  return float(lerp(field)),float(lerp(gx)),float(lerp(gy))
 return sample

for o in objects:
 mesh=o.data;mesh.calc_loop_triangles()
 source_normals=[n.vector.copy() for n in mesh.corner_normals]
 sample=smooth_ground(mesh);jacobians=[];moved=0;preserved=0;offsets=[]
 for v in mesh.vertices:
  reference,rx,ry=sample(v.co);delta=.171-reference
  # Translate each ground column (including its ornaments) together. Fade the
  # displacement into the lower cliff over a deep band, not a thin stretched lip.
  t=max(0,min(1,(v.co.z-reference+.14)/.12));w=t*t*(3-2*t);dw=6*t*(1-t)/.12
  v.co.z+=delta*w
  jacobians.append((-rx*(w+delta*dw),-ry*(w+delta*dw),1+delta*dw))
  offsets.append(delta*w)
  if w:moved+=1
  else:preserved+=1
 normals=[]
 for loop,n in zip(mesh.loops,source_normals):
  dx,dy,dz=jacobians[loop.vertex_index];nz=n.z/dz
  normals.append(Vector((n.x-dx*nz,n.y-dy*nz,nz)).normalized())
 mesh.normals_split_custom_set(normals);mesh.update()
 stats.append({'moved_vertices':moved,'preserved_vertices':preserved,'offset_range':[min(offsets),max(offsets)]})
bpy.ops.object.select_all(action='DESELECT')
for o in objects:o.select_set(True)
bpy.context.view_layer.objects.active=objects[0]
bpy.ops.export_scene.gltf(filepath=str(WORK/'island-flat-source.glb'),export_format='GLB',use_selection=True,export_image_format='AUTO')
bottom=min((o.matrix_world@v.co).z for o in objects for v in o.data.vertices)
top=max((o.matrix_world@v.co).z for o in objects for v in o.data.vertices)
ground=(objects[0].matrix_world@Vector((0,0,.171))).z
surface_ratio=(ground-bottom)/(top-bottom)
(WORK/'build.json').write_text(json.dumps({'source':'assets/models/island-web.glb','method':'smoothed ground reference, vertical column translation, deep cliff blend and inverse-transpose split normals','stats':stats,'surface_ratio':surface_ratio},indent=2)+'\n')
print('ISLAND_RELIEF_COMPLETE',stats)
