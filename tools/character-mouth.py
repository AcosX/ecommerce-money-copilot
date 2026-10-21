"""Replace the baked smiling mouth with skinned lip loops and a recessed oral cavity.

Called by build-character-face.py before shape keys are authored. +X is forward.
The outer loop uses the original UVs and weights; inner skin samples unpainted skin.
"""
import math

import bmesh
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.geometry import barycentric_transform


def rebuild_mouth(obj, cfg):
    world, inverse = obj.matrix_world.copy(), obj.matrix_world.inverted()
    cy, cz = cfg['center_y'], cfg['mouth_z']
    mesh = obj.data
    mesh.calc_loop_triangles()
    triangles = list(mesh.loop_triangles)
    points = [world @ v.co for v in mesh.vertices]
    bvh = BVHTree.FromPolygons(points, [t.vertices[:] for t in triangles], all_triangles=True)
    uv_data = mesh.uv_layers.active.data
    base = obj.material_slots[0].material
    bsdf = next(n for n in base.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    image = bsdf.inputs['Base Color'].links[0].from_node.image
    pixels = list(image.pixels[:])
    iw, ih = image.size
    def color(uv):
        x,y = int(uv.x*iw)%iw, int(uv.y*ih)%ih
        values=pixels[(y*iw+x)*4:(y*iw+x)*4+3]
        # Blender's byte image pixels are sRGB; vertex colors are linear values.
        return tuple(v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in values)+(1,)

    def sample(y, z):
        hit, _, index, _ = bvh.ray_cast(Vector((1, y, z)), Vector((-1, 0, 0)))
        if hit is None:
            raise ValueError('Mouth reference missed the face')
        tri = triangles[index]
        uv = barycentric_transform(hit, *[points[i] for i in tri.vertices],
                                   *[Vector((*uv_data[i].uv, 0)) for i in tri.loops])
        return hit, Vector((uv.x, uv.y))

    def material(name, color):
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Base Color'].default_value = (*color, 1)
        bsdf.inputs['Roughness'].default_value = .85
        mat.use_backface_culling = False
        obj.data.materials.append(mat)
        return len(obj.data.materials) - 1

    lip_mat = material('Soft lip edge', (.49, .205, .125))
    inner_mat = material('Recessed mouth lining', (.065, .012, .016))
    teeth_mat = material('Upper teeth ivory', (.87, .81, .65))
    tongue_mat = material('Tongue', (.38, .075, .065))
    skin_mat = material('Retopology skin', (.7,.5,.3))
    skin = obj.data.materials[skin_mat]
    color_node = skin.node_tree.nodes.new('ShaderNodeVertexColor')
    color_node.layer_name='LipSkin'
    skin.node_tree.links.new(color_node.outputs['Color'],skin.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
    bm = bmesh.new()
    bm.from_mesh(mesh)
    # glTF splits vertices at UV / normal seams. Weld positions while retaining
    # per-loop UVs before cutting, otherwise a visually continuous lip is disconnected.
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=.00001)
    bm.normal_update()
    original_normals = {f:f.normal.copy() for f in bm.faces}
    uv_layer = bm.loops.layers.uv.active
    deform = bm.verts.layers.deform.active
    region = bm.verts.layers.int.new('mouth_region')
    colors = bm.loops.layers.float_color.new('LipSkin')
    for face in bm.faces:
        for loop in face.loops:
            loop[colors]=(1,1,1,1)
    # Remove the entire texture smile, including the painted teeth and corners.
    existing_boundary = set(e for e in bm.edges if e.is_boundary)
    removed = [f for f in bm.faces if (world @ f.calc_center_median()).x > .04
               and (((world @ f.calc_center_median()).y-cy)/.046)**2
               + (((world @ f.calc_center_median()).z-cz)/.018)**2 < 1]
    bmesh.ops.delete(bm, geom=removed, context='FACES')
    edges = [e for e in bm.edges if e.is_boundary and e not in existing_boundary and all(
        (world @ v.co).x > .035 and abs((world @ v.co).y-cy)<.059
        and abs((world @ v.co).z-cz)<.034 for v in e.verts)]
    adjacency = {}
    for e in edges:
        for a, b in [(e.verts[0],e.verts[1]),(e.verts[1],e.verts[0])]:
            adjacency.setdefault(a, []).append(b)
    if not adjacency or any(len(v)!=2 for v in adjacency.values()):
        raise ValueError('Mouth cut is not a closed manifold loop: '+str([(tuple(world@v.co),len(a)) for v,a in adjacency.items() if len(a)!=2]))
    outer = [next(iter(adjacency))]
    previous = None
    while True:
        candidates = adjacency[outer[-1]]
        nxt = next(v for v in candidates if v != previous)
        if nxt == outer[0]:
            break
        previous = outer[-1]
        outer.append(nxt)
        if len(outer)>len(adjacency):
            raise ValueError('Mouth loop did not close')
    n = len(outer)
    angles = [math.atan2(((world @ v.co).z-cz)/.018, ((world @ v.co).y-cy)/.046) for v in outer]
    direction=1 if sum(math.sin(angles[(i+1)%n]-angles[i]) for i in range(n))>0 else -1
    phases=[a-direction*2*math.pi*i/n for i,a in enumerate(angles)]
    phase=math.atan2(sum(math.sin(a) for a in phases),sum(math.cos(a) for a in phases))
    # Keep the existing outer topology fixed; regular spacing is only applied to
    # the NEW loops, preventing inverted slivers around the lip contour.
    angles=[phase+direction*2*math.pi*i/n for i in range(n)]
    template_weights = dict(outer[0][deform])
    uv_by_vertex = {}
    color_by_vertex = {}
    for v in outer:
        _,uv=sample((world@v.co).y,(world@v.co).z)
        uv_by_vertex[v] = uv
        color_by_vertex[v] = color(uv)

    def vertex(position, tag, uv):
        v = bm.verts.new(inverse @ position)
        if deform:
            for group, weight in template_weights.items():
                v[deform][group] = weight
        v[region] = tag
        uv_by_vertex[v] = uv
        color_by_vertex[v] = color(uv)
        return v

    def bridge(a, b, mat):
        for i in range(n):
            j=(i+1)%n
            f=bm.faces.new((a[i],a[j],b[j],b[i]))
            f.material_index=mat
            for loop in f.loops:
                loop[uv_layer].uv=uv_by_vertex[loop.vert]
                loop[colors]=color_by_vertex[loop.vert]

    rings = []
    for ring in range(5):
        verts=[]
        for index,angle in enumerate(angles):
            c,s=math.cos(angle),math.sin(angle)
            upper=s>=0
            if ring==0:
                inner_y,inner_z=cy+.032*c,cz+.002*c*c+.0018*s
                hit,_=sample(inner_y,cz+.012)
                lip=Vector((hit.x+.001,inner_y,inner_z))
                position=(world@outer[index].co).lerp(lip,.52)
                y,z=position.y,position.z
                _,uv=sample(cy+(.044 if c>=0 else -.044),cz+(.014 if upper else -.014))
                tag=1 if upper else 2
            else:
                width=.032 if ring==1 else .031
                half_height=.0018 if ring==1 else .00065
                y=cy+width*c
                z=cz+.002*c*c+half_height*s
                hit,_=sample(y,cz+.012)
                x=hit.x+(.001 if ring==1 else .0014)
                if ring==3:x-=.010
                if ring==4:x-=.022
                position=Vector((x,y,z))
                _,uv=sample(cy+(.044 if c>=0 else -.044),cz+(.014 if upper else -.014))
                tag=(3 if upper else 4) if ring<3 else (5 if upper else 6)
            verts.append(vertex(position,tag,uv))
        rings.append(verts)
    bridge(outer,rings[0],skin_mat)
    bridge(rings[0],rings[1],skin_mat)
    bridge(rings[1],rings[2],lip_mat)
    bridge(rings[2],rings[3],inner_mat)
    bridge(rings[3],rings[4],inner_mat)
    cap=bm.faces.new(tuple(reversed(rings[4])))
    cap.material_index=inner_mat
    # Upper teeth are independent of the lower lip / jaw. Slightly recessed so
    # closed lips occlude them; never stretch a painted white patch with the skin.
    for part, width, ztop, zbottom, depth, tag, mat in [
        ('teeth',.024,cz+.005,cz-.003,.011,7,teeth_mat),
        ('tongue',.018,cz-.007,cz-.010,.024,8,tongue_mat)]:
        rows=[]
        for z in (ztop,zbottom):
            row=[]
            for i in range(17):
                y=cy-width+2*width*i/16
                hit,_=sample(y,cz+.016)
                row.append(vertex(Vector((hit.x-depth,y,z)),tag,Vector((0,0))))
            rows.append(row)
        for i in range(16):
            f=bm.faces.new((rows[0][i],rows[1][i],rows[1][i+1],rows[0][i+1]))
            f.material_index=mat
    transition=set(outer+rings[0])
    for v in outer:
        transition.update(e.other_vert(v) for e in v.link_edges if e.other_vert(v)[region]<3)
    for _ in range(6):
        bmesh.ops.smooth_vert(bm, verts=list(transition), factor=.35,
                              use_axis_x=True,use_axis_y=True,use_axis_z=True)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    # The face is separated from the body and contains open hair / ear patches.
    # Global recalculation can invert those disconnected islands. Keep their
    # original outward winding; only the newly authored mouth needs new normals.
    for face,normal in original_normals.items():
        if face.is_valid and face.normal.dot(normal)<0:
            face.normal_flip()
    bm.normal_update()
    bm.verts.index_update()
    tags={v.index:v[region] for v in bm.verts if v[region]}
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    return tags
