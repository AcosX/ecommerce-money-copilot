"""Retarget CC0 humanoid actions and author small NPC gesture layers on Xiaoshang.

blender --factory-startup --background --python tools/build-character-actions.py --
  character.blend RobotExpressive.glb output.glb
The facial source is preserved. Added neck/head/pelvis joints use explicit weights.
"""
import bpy
import json
import math
import sys
import hashlib
from pathlib import Path
from mathutils import Vector, Quaternion, Matrix

source, motion, output = [Path(v).resolve() for v in sys.argv[sys.argv.index('--')+1:]]
bpy.ops.wm.open_mainfile(filepath=str(source))
rig = next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
meshes = [o for o in bpy.context.scene.objects if o.type=='MESH' and o.name in ('Xiaoshang_Body','Xiaoshang_Face')]
rig.name='Xiaoshang_Rig'
original_actions=set(bpy.data.actions)
rig.animation_data_clear()
world=rig.matrix_world.copy()
inverse=world.inverted()
hand_specs=[('tripo::0_Right_Limb_2',1),('tripo::1_Left_Limb_2',-1)]
hand_centers={name:world@rig.data.bones[name].head_local for name,_ in hand_specs}
for obj in meshes:
    for vertex in obj.data.vertices:
        p=obj.matrix_world@vertex.co
        for name,side in hand_specs:
            center=hand_centers[name]
            along=(p.y-center.y)*side
            if along>-.01:
                blend=max(0,min(1,(along+.01)/.05))
                blend=blend*blend*(3-2*blend)
                p=center+(p-center)*(1-.18*blend)
                vertex.co=obj.matrix_world.inverted()@p
bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True)
bpy.context.view_layer.objects.active=rig
bpy.ops.object.mode_set(mode='EDIT')
for name,_ in hand_specs:
    center=hand_centers[name]
    for bone in rig.data.edit_bones:
        if bone.name==name or any(p.name==name for p in bone.parent_recursive):
            bone.head=inverse@(center+(world@bone.head-center)*.82)
            bone.tail=inverse@(center+(world@bone.tail-center)*.82)
for name, head, tail, parent in [
    ('Xiaoshang_Hips',(-.004,.004,.84),(-.004,.004,.9478),'tripo::Root'),
    ('Xiaoshang_Neck',(-.049,0,1.31),(-.039,0,1.405),'tripo::Spine_2'),
    ('Xiaoshang_Head',(-.039,0,1.405),(-.02,0,1.60),'Xiaoshang_Neck')]:
    bone=rig.data.edit_bones.new(name)
    bone.head=inverse@Vector(head)
    bone.tail=inverse@Vector(tail)
    bone.parent=rig.data.edit_bones[parent]
for name in ['tripo::Spine_0','tripo::0_Left_Limb_0','tripo::1_Right_Limb_0']:
    rig.data.edit_bones[name].parent=rig.data.edit_bones['Xiaoshang_Hips']
bpy.ops.object.mode_set(mode='OBJECT')
for obj in meshes:
    groups={n:obj.vertex_groups.get(n) or obj.vertex_groups.new(name=n)
            for n in ['Xiaoshang_Head','Xiaoshang_Neck','Xiaoshang_Hips']}
    root=obj.vertex_groups.get('tripo::Root')
    for v in obj.data.vertices:
        p=obj.matrix_world@v.co
        if p.z>1.34 and (p.z>1.42 or abs(p.y)<.075):
            t=max(0,min(1,(p.z-1.34)/.075))
            t=t*t*(3-2*t)
            for group in list(v.groups):
                obj.vertex_groups[group.group].remove([v.index])
            if t>0:groups['Xiaoshang_Head'].add([v.index],t,'REPLACE')
            if t<1:groups['Xiaoshang_Neck'].add([v.index],1-t,'REPLACE')
        elif root:
            weight=next((g.weight for g in v.groups if g.group==root.index),0)
            if weight:
                groups['Xiaoshang_Hips'].add([v.index],weight,'REPLACE')
                root.remove([v.index])

before=set(bpy.context.scene.objects)
bpy.ops.import_scene.gltf(filepath=str(motion))
imported=set(bpy.context.scene.objects)-before
src=next(o for o in imported if o.type=='ARMATURE')
actions={a.name:a for a in bpy.data.actions if a not in original_actions}
# Source faces -Y; Xiaoshang faces +X. Map anatomical sides by physical position,
# because the generated target's limb names are not anatomically reliable.
convert=Quaternion((0,0,1),math.pi/2)
mapping={
 'Xiaoshang_Hips':'Body','tripo::Spine_0':'Hips','tripo::Spine_1':'Abdomen',
 'tripo::Spine_2':'Torso','Xiaoshang_Neck':'Neck','Xiaoshang_Head':'Head',
 'tripo::Head_0':'Torso','tripo::0_Right_Limb_0':'UpperArm.L',
 'tripo::0_Right_Limb_1':'LowerArm.L','tripo::0_Right_Limb_2':'LowerArm.L',
 'tripo::Spine_3':'Torso','tripo::1_Left_Limb_0':'UpperArm.R',
 'tripo::1_Left_Limb_1':'LowerArm.R','tripo::1_Left_Limb_2':'LowerArm.R',
 'tripo::0_Left_Limb_0':'UpperLeg.L','tripo::0_Left_Limb_1':'LowerLeg.L',
 'tripo::0_Left_Limb_2':'Foot.L','tripo::1_Right_Limb_0':'UpperLeg.R',
 'tripo::1_Right_Limb_1':'LowerLeg.R','tripo::1_Right_Limb_2':'Foot.R'}
rest={b.name:(world@b.matrix_local).to_quaternion() for b in rig.data.bones}
source_rest={b.name:(src.matrix_world@b.matrix_local).to_quaternion() for b in src.data.bones}
order=sorted(mapping,key=lambda n:len(rig.data.bones[n].parent_recursive))
scene=bpy.context.scene
scene.render.fps=30
source_clips={name:tuple(a.frame_range) for name,a in actions.items()}
library=[('idle','Idle',4.0,True),('walk','Walking',1.2,True),
         ('wave','Wave',2.2,False),('talk','Idle',3.2,True),
         ('turn','Idle',3.2,False),('window','Idle',4.0,False),
         ('lookout','Idle',4.8,False),('inspect','Idle',4.0,False),
         ('nod','Yes',1.8,False)]
made=[]
probes={}
sole_samples=[(o,[v.index for v in o.data.vertices if (o.matrix_world@v.co).z<.055]) for o in meshes]
lower_names={'Body','UpperLeg.L','LowerLeg.L','Foot.L','UpperLeg.R','LowerLeg.R','Foot.R'}
def axis_world(name,axis,angle):
    pb=rig.pose.bones[name]
    m=world@pb.matrix
    q=Quaternion(axis,angle)@m.to_quaternion()
    pb.matrix=inverse@Matrix.LocRotScale(m.translation,q,Vector((1,1,1)))
    bpy.context.view_layer.update()

def relax_hands(action,phase):
    for hand_name,side in hand_specs:
        hand=rig.pose.bones[hand_name]
        delta=(world@hand.matrix).to_quaternion()@rest[hand_name].inverted()
        along=(delta@Vector((0,side,0))).normalized()
        normal=delta@Vector((0,0,-1))
        waving=action=='wave' and side==-1
        desired=Vector((1,0,0)) if waving else Vector((0,-side,0))
        a=(normal-along*normal.dot(along)).normalized()
        b=(desired-along*desired.dot(along)).normalized()
        angle=math.atan2(along.dot(a.cross(b)),max(-1,min(1,a.dot(b))))
        axis_world(hand_name,along,angle)
        if waving:axis_world(hand_name,along,.10*math.sin(phase*math.pi*6))
        delta=(world@hand.matrix).to_quaternion()@rest[hand_name].inverted()
        flex_axis=delta@Vector((1,0,0))
        starts=[11,14,17] if side==1 else [27,30,33]
        for finger,start in enumerate(starts):
            curls=(.05,.10,.07) if waving else (.18+finger*.055,.32+finger*.045,.22+finger*.035)
            for joint,curl in enumerate(curls):
                axis_world('bone_'+str(start+joint),flex_axis,-side*curl)
        prefix='tripo::0_Right_Limb_' if side==1 else 'tripo::1_Left_Limb_'
        for index in (3,4,5):axis_world(prefix+str(index),flex_axis,-side*(.06 if waving else .16))

for name, original, duration, loop in library:
    rig.animation_data_clear()
    for pb in rig.pose.bones:
        pb.matrix_basis=Matrix.Identity(4)
        pb.rotation_mode='QUATERNION'
    action=bpy.data.actions.new(name)
    rig.animation_data_create()
    rig.animation_data.action=action
    src.animation_data.action=actions[original]
    if src.animation_data.action_slot is None and actions[original].slots:
        src.animation_data.action_slot=actions[original].slots[0]
    start,end=source_clips[original]
    steps=round(duration*30)
    samples=[]
    for frame in range(steps+1):
        t=frame/steps
        # Set source time first, then key the target at its own frame number.
        source_frame=start+(end-start)*t
        scene.frame_set(math.floor(source_frame),subframe=source_frame%1)
        source_rotations={n:(src.matrix_world@src.pose.bones[n].matrix).to_quaternion() for n in mapping.values()}
        if name!='walk':
            # The source robot bounces on its toes even in Idle / Wave. A human
            # shopkeeper keeps a stable stance while gesturing, with torso motion above.
            for n in lower_names:source_rotations[n]=source_rest[n].copy()
        for pb in rig.pose.bones:pb.matrix_basis=Matrix.Identity(4)
        bpy.context.view_layer.update()
        for target_name in order:
            source_name=mapping[target_name]
            source_now=source_rotations[source_name]
            delta=source_now@source_rest[source_name].inverted()
            desired=convert@delta@convert.inverted()@rest[target_name]
            pb=rig.pose.bones[target_name]
            position=(world@pb.matrix).translation
            pb.matrix=inverse@Matrix.LocRotScale(position,desired,Vector((1,1,1)))
            bpy.context.view_layer.update()
        envelope=math.sin(math.pi*t)**2
        if name=='idle':
            axis_world('tripo::Spine_2',(0,1,0),.008*math.sin(t*math.pi*2))
            axis_world('Xiaoshang_Head',(0,0,1),.035*math.sin(t*math.pi*2))
        elif name=='talk':
            axis_world('tripo::0_Right_Limb_1',(0,1,0),.24*math.sin(t*math.pi*4))
            axis_world('Xiaoshang_Head',(0,1,0),.045*math.sin(t*math.pi*4))
        elif name=='turn':
            axis_world('Xiaoshang_Hips',(0,0,1),.25*math.sin(t*math.pi*2))
            axis_world('tripo::Spine_2',(0,0,1),.18*math.sin(t*math.pi*2))
            axis_world('Xiaoshang_Head',(0,0,1),.40*math.sin(t*math.pi*2))
        elif name=='window':
            axis_world('tripo::Spine_1',(0,1,0),.12*envelope)
            axis_world('Xiaoshang_Head',(0,1,0),.12*envelope)
            axis_world('Xiaoshang_Head',(0,0,1),.14*math.sin(t*math.pi*3)*envelope)
        elif name=='lookout':
            axis_world('Xiaoshang_Head',(0,1,0),-.12*envelope)
            axis_world('Xiaoshang_Head',(0,0,1),.50*math.sin(t*math.pi*2)*envelope)
        elif name=='inspect':
            axis_world('tripo::Spine_1',(0,1,0),.20*envelope)
            axis_world('Xiaoshang_Head',(0,1,0),.25*envelope)
            axis_world('tripo::0_Right_Limb_0',(0,1,0),-.24*envelope)
        relax_hands(name,t)
        # Exclude hidden armature display widgets (the native file contains an
        # Icosphere) from contact measurement. Only actual character soles count.
        bpy.context.view_layer.update()
        deps=bpy.context.evaluated_depsgraph_get()
        lowest=10
        for obj,indices in sole_samples:
            if indices:
                evaluated=obj.evaluated_get(deps)
                mesh=evaluated.to_mesh()
                lowest=min(lowest,min((evaluated.matrix_world@mesh.vertices[i].co).z for i in indices))
                evaluated.to_mesh_clear()
        root=rig.pose.bones['tripo::Root']
        mat=root.matrix.copy()
        mat.translation+=inverse.to_3x3()@Vector((0,0,-lowest))
        root.matrix=mat
        bpy.context.view_layer.update()
        for pb in rig.pose.bones:
            pb.keyframe_insert('rotation_quaternion',frame=frame)
            pb.keyframe_insert('location',frame=frame)
        if frame in (0,steps//4,steps//2,steps*3//4,steps):
            samples.append({n:list(world@rig.pose.bones[n].head) for n in
                ['Xiaoshang_Head','tripo::0_Right_Limb_2','tripo::1_Left_Limb_2',
                 'tripo::0_Left_Limb_2','tripo::1_Right_Limb_2']})
    action.use_fake_user=True
    made.append(action)
    probes[name]=samples
    print('BAKED',name,duration,flush=True)

for obj in imported:
    bpy.data.objects.remove(obj,do_unlink=True)
for action in list(bpy.data.actions):
    if action not in made:bpy.data.actions.remove(action)
rig.animation_data_clear()
rig.animation_data_create()
for action in made:
    track=rig.animation_data.nla_tracks.new()
    track.name=action.name
    strip=track.strips.new(action.name,0,action)
    strip.action_frame_start=0
    strip.action_frame_end=round(next(d for n,_,d,_ in library if n==action.name)*30)
    track.mute=True
scene.frame_set(0)
for pb in rig.pose.bones:pb.matrix_basis=Matrix.Identity(4)
output.parent.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(output.with_suffix('.blend')),compress=True)
# Export actions by slots; facial keys are not animated and remain user driven.
bpy.ops.export_scene.gltf(filepath=str(output),export_format='GLB',export_morph=True,
                          export_animations=True,export_animation_mode='ACTIONS',
                          export_force_sampling=True,export_frame_range=False)
output.with_suffix('.json').write_text(json.dumps({
    'clips':[{'name':n,'duration':d,'loop':loop} for n,_,d,loop in library],
    'bones':len(rig.data.bones),'morphs':26,'forward':'+X','in_place':True,
    'character_source':source.name,
    'rig_adjustments':{'head_neck_pelvis':'dedicated joints', 'clavicle':'follows torso, never upper-arm roll',
                       'hand_scale':.82,'fingers':'relaxed flexion; open palm for wave'},
    'source_motion':{'url':'https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf/RobotExpressive',
                     'author':'Tomás Laulhé / Quaternius; modifications Don McCurdy',
                     'license':'CC0-1.0','sha256':hashlib.sha256(motion.read_bytes()).hexdigest()},
    'joint_probes':probes},indent=2),encoding='utf-8')
