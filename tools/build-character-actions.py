"""Retarget human gait and author organic NPC gesture layers on Xiaoshang.

blender --factory-startup --background --python tools/build-character-actions.py --
  character.blend RobotExpressive.glb output.glb
The facial source is preserved. Added neck/head/pelvis joints use explicit weights.
Xbot.glb is read from the same source directory; both motion sources are credited
with their own usage terms in the generated asset metadata.
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
for action in actions.values():action.name='SRC_ROBOT_'+action.name
robot=src
human_path=motion.with_name('Xbot.glb')
if not human_path.is_file():raise FileNotFoundError('Human motion source required: '+str(human_path))
before_human=set(bpy.context.scene.objects)
before_human_actions=set(bpy.data.actions)
bpy.ops.import_scene.gltf(filepath=str(human_path))
human_objects=set(bpy.context.scene.objects)-before_human
imported.update(human_objects)
human=next(o for o in human_objects if o.type=='ARMATURE')
human_actions={a.name:a for a in bpy.data.actions if a not in before_human_actions}
for action in human_actions.values():action.name='SRC_HUMAN_'+action.name
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
aliases={'Body':'Hips','Hips':'Spine','Abdomen':'Spine1','Torso':'Spine2','Neck':'Neck','Head':'Head',
 'UpperArm.L':'LeftArm','LowerArm.L':'LeftForeArm','UpperArm.R':'RightArm','LowerArm.R':'RightForeArm',
 'UpperLeg.L':'LeftUpLeg','LowerLeg.L':'LeftLeg','Foot.L':'LeftFoot',
 'UpperLeg.R':'RightUpLeg','LowerLeg.R':'RightLeg','Foot.R':'RightFoot'}
order=sorted(mapping,key=lambda n:len(rig.data.bones[n].parent_recursive))
scene=bpy.context.scene
scene.render.fps=30
library=[('idle','Idle',4.0,True),('walk','Walking',1.5,True),
         ('wave','Wave',2.8,False),('talk','Idle',4.0,True),
         ('turn','Idle',3.2,False),('window','Idle',4.0,False),
         ('lookout','Idle',4.8,False),('inspect','Idle',4.0,False),
         ('nod','Yes',1.8,False)]
made=[]
probes={}
lower_names={'Body','UpperLeg.L','LowerLeg.L','Foot.L','UpperLeg.R','LowerLeg.R','Foot.R'}
def axis_world(name,axis,angle):
    pb=rig.pose.bones[name]
    m=world@pb.matrix
    q=Quaternion(axis,angle)@m.to_quaternion()
    pb.matrix=inverse@Matrix.LocRotScale(m.translation,q,Vector((1,1,1)))
    bpy.context.view_layer.update()

def smooth(value):
    value=max(0,min(1,value))
    return value*value*(3-2*value)

def relax_hands(action,phase):
    for hand_name,side in hand_specs:
        hand=rig.pose.bones[hand_name]
        delta=(world@hand.matrix).to_quaternion()@rest[hand_name].inverted()
        along=(delta@Vector((0,side,0))).normalized()
        normal=delta@Vector((0,0,-1))
        waving=action=='wave' and side==-1
        wave_weight=smooth((phase-.08)/.22)*(1-smooth((phase-.78)/.22)) if waving else 0
        desired=Vector((0,-side,0)).lerp(Vector((1,0,0)),wave_weight).normalized()
        a=(normal-along*normal.dot(along)).normalized()
        b=(desired-along*desired.dot(along)).normalized()
        angle=math.atan2(along.dot(a.cross(b)),max(-1,min(1,a.dot(b))))
        axis_world(hand_name,along,angle)
        if waving:
            palm_axis=(world@hand.matrix).to_quaternion()@rest[hand_name].inverted()@Vector((0,0,-1))
            axis_world(hand_name,palm_axis,.16*math.sin((phase-.04)*math.pi*5)*wave_weight)
        delta=(world@hand.matrix).to_quaternion()@rest[hand_name].inverted()
        flex_axis=delta@Vector((1,0,0))
        starts=[11,14,17] if side==1 else [27,30,33]
        for finger,start in enumerate(starts):
            closed=(.18+finger*.055,.32+finger*.045,.22+finger*.035)
            curls=tuple(a*(1-wave_weight)+b*wave_weight for a,b in zip(closed,(.05,.10,.07)))
            for joint,curl in enumerate(curls):
                overlap=.016*math.sin(phase*math.pi*2-finger*.25-joint*.15)
                axis_world('bone_'+str(start+joint),flex_axis,-side*(curl+overlap))
        prefix='tripo::0_Right_Limb_' if side==1 else 'tripo::1_Left_Limb_'
        for index in (3,4,5):axis_world(prefix+str(index),flex_axis,-side*(.16-.10*wave_weight))


rest_positions={b.name:world@b.head_local for b in rig.data.bones}

def pose_world(name, position, rotation):
    rig.pose.bones[name].matrix=inverse@Matrix.LocRotScale(position,rotation,Vector((1,1,1)))
    bpy.context.view_layer.update()

def solve_limb(names, target, pole):
    # Analytic two-bone IK, baked onto the existing deform skeleton. The end
    # point and pole are controls in world metres, independent of source proportions.
    a,b,c=names
    origin=world@rig.pose.bones[a].head
    ab=rest_positions[b]-rest_positions[a]
    bc=rest_positions[c]-rest_positions[b]
    l1,l2=ab.length,bc.length
    direction=(target-origin).normalized()
    distance=min((target-origin).length,l1+l2-.001)
    bend=pole-origin
    bend=(bend-direction*bend.dot(direction)).normalized()
    along=(l1*l1-l2*l2+distance*distance)/(2*distance)
    knee=origin+direction*along+bend*math.sqrt(max(0,l1*l1-along*along))
    endpoint=origin+direction*distance
    pose_world(a,origin,ab.rotation_difference(knee-origin)@rest[a])
    pose_world(b,knee,bc.rotation_difference(endpoint-knee)@rest[b])
    is_arm=a in ('tripo::0_Right_Limb_0','tripo::1_Left_Limb_0')
    pose_world(c,endpoint,(bc.rotation_difference(endpoint-knee)@rest[c]) if is_arm else rest[c])

def curve(t,keys):
    if t<=keys[0][0]:return keys[0][1]
    for (a,x),(b,y) in zip(keys,keys[1:]):
        if t<=b:
            u=max(0,min(1,(t-a)/(b-a)))
            u=u*u*u*(u*(u*6-15)+10)
            return x+(y-x)*u
    return keys[-1][1]

def contact_legs(action,t):
    # Keep the pelvis steady. No per-frame whole-body correction from the
    # lowest moving shoe: that produced the previous eight-centimetre bob.
    root=rig.pose.bones['tripo::Root']
    m=root.matrix.copy()
    sway=.004*math.sin(t*math.pi*2) if action=='walk' else 0
    rise=.003*math.cos(t*math.pi*4) if action=='walk' else 0
    m.translation+=inverse.to_3x3()@Vector((0,sway,-.025+rise))
    root.matrix=m
    bpy.context.view_layer.update()
    for side,prefix in [(1,'tripo::0_Left_Limb_'),(-1,'tripo::1_Right_Limb_')]:
        ankle=rest_positions[prefix+'2'].copy()
        if action=='walk':
            phase=(t+(0 if side==1 else .5))%1
            # Constant-speed stance compensates forward navigation; a low,
            # eased swing returns the foot, with a short double-support interval.
            if phase<.58:
                ankle.x+=.095-.19*phase/.58
            else:
                u=(phase-.58)/.42
                ankle.x+=-.095+.19*smooth(u)
                ankle.z+=.022*math.sin(math.pi*u)**2
        solve_limb([prefix+str(i) for i in range(3)],ankle,Vector((.5,side*.14,.45)))

for name, original, duration, loop in library:
    src=human
    bone_names={n:n if src==robot else 'mixamorig:'+aliases[n] for n in set(mapping.values())}
    source_rest={n:(src.matrix_world@src.data.bones[actual].matrix_local).to_quaternion() for n,actual in bone_names.items()}
    source_action=human_actions['walk' if name=='walk' else ('agree' if name=='nod' else 'idle')]
    rig.animation_data_clear()
    for pb in rig.pose.bones:
        pb.matrix_basis=Matrix.Identity(4)
        pb.rotation_mode='QUATERNION'
    action=bpy.data.actions.new(name)
    rig.animation_data_create()
    rig.animation_data.action=action
    src.animation_data.action=source_action
    src.animation_data.action_slot=source_action.slots[0]
    src.animation_data.action=human_actions['idle']
    src.animation_data.action_slot=human_actions['idle'].slots[0]
    scene.frame_set(0)
    idle_reference={n:(src.matrix_world@src.pose.bones[bone_names[n]].matrix).to_quaternion() for n in mapping.values()}
    src.animation_data.action=source_action
    src.animation_data.action_slot=source_action.slots[0]
    start,end=source_action.frame_range
    steps=round(duration*30)
    samples=[]
    previous_quaternions={}
    for frame in range(steps+1):
        t=frame/steps
        # Set source time first, then key the target at its own frame number.
        source_phase=t if loop else smooth(t)
        source_frame=start+(end-start)*source_phase
        scene.frame_set(math.floor(source_frame),subframe=source_frame%1)
        source_rotations={n:(src.matrix_world@src.pose.bones[bone_names[n]].matrix).to_quaternion() for n in mapping.values()}
        # Forearms follow a little later than the upper arm. Head / neck lead the
        # gesture slightly, rather than every joint reversing on the same frame.
        for delay,names in [(.025,['LowerArm.L','LowerArm.R']),(-.012,['Head','Neck'])]:
            phase=source_phase-delay
            phase=phase%1 if loop else max(0,min(1,phase))
            f=start+(end-start)*phase
            scene.frame_set(math.floor(f),subframe=f%1)
            for n in names:source_rotations[n]=(src.matrix_world@src.pose.bones[bone_names[n]].matrix).to_quaternion()
        # Foot contacts are solved in target proportions, not copied from the
        # source actor's pelvis height or leg rotations.
        for n in lower_names:source_rotations[n]=source_rest[n].copy()
        for pb in rig.pose.bones:pb.matrix_basis=Matrix.Identity(4)
        bpy.context.view_layer.update()
        for target_name in order:
            source_name=mapping[target_name]
            source_now=source_rotations[source_name]
            if name=='walk' and source_name not in lower_names:
                # Retain the human resting arm pose, reduce its excursion rather
                # than blending toward the T-pose. Small stride needs small arms.
                amount=.38 if 'Arm' in source_name else .20
                source_now=idle_reference[source_name].slerp(source_now,amount)
            delta=source_now@source_rest[source_name].inverted()
            if name=='nod' and source_name in ('Head','Neck'):
                idle_delta=idle_reference[source_name]@source_rest[source_name].inverted()
                delta=idle_delta.slerp(delta,.50)
            desired=convert@delta@convert.inverted()@rest[target_name]
            pb=rig.pose.bones[target_name]
            position=(world@pb.matrix).translation
            pb.matrix=inverse@Matrix.LocRotScale(position,desired,Vector((1,1,1)))
            bpy.context.view_layer.update()
        # Deliberate blocking: look first, shift/gesture, hold, then release.
        # Independent timings stop torso, head and hands reversing together.
        if name=='walk':
            axis_world('tripo::Spine_2',(0,0,1),.012*math.sin(t*math.pi*2))
        elif name=='wave':
            head=curve(t,[(0,0),(.12,.07),(.68,.07),(1,0)])
            axis_world('Xiaoshang_Head',(1,0,0),head)
            axis_world('tripo::Spine_2',(0,1,0),curve(t,[(0,0),(.20,-.025),(.64,-.025),(1,0)]))
            lift=curve(t,[(0,0),(.08,0),(.30,1),(.70,1),(.96,0),(1,0)])
            hand_name='tripo::1_Left_Limb_2'
            baseline=world@rig.pose.bones[hand_name].head
            sway=curve(t,[(0,0),(.31,0),(.40,-.035),(.51,.035),(.61,-.028),(.70,0),(1,0)])
            target=baseline.lerp(Vector((.12,-.37+sway,1.48)),lift)
            elbow=world@rig.pose.bones['tripo::1_Left_Limb_1'].head
            pole=elbow.lerp(Vector((.22,-.42,1.06)),lift)
            solve_limb(['tripo::1_Left_Limb_'+str(i) for i in range(3)],target,pole)
        elif name=='talk':
            offer=curve(t,[(0,0),(.12,.4),(.28,1),(.43,.85),(.60,.25),(.78,0),(1,0)])
            axis_world('tripo::0_Right_Limb_1',(0,1,0),-.22*offer)
            axis_world('Xiaoshang_Head',(0,1,0),curve(t,[(0,0),(.20,0),(.32,.035),(.45,0),(1,0)]))
        elif name=='turn':
            axis_world('Xiaoshang_Head',(0,0,1),curve(t,[(0,0),(.25,.45),(.58,.45),(.92,0),(1,0)]))
            axis_world('tripo::Spine_2',(0,0,1),curve(t,[(0,0),(.12,0),(.38,.16),(.65,.16),(1,0)]))
        elif name in ('window','lookout','inspect'):
            lean=curve(t,[(0,0),(.15,0),(.40,1),(.72,1),(1,0)])
            glance=curve(t,[(0,0),(.24,1),(.65,1),(.90,0),(1,0)])
            pitch={'window':.10,'lookout':-.07,'inspect':.22}[name]
            axis_world('Xiaoshang_Head',(0,1,0),pitch*glance)
            axis_world('tripo::Spine_1',(0,1,0),(.10 if name=='inspect' else .035)*lean)
            if name=='lookout':
                axis_world('Xiaoshang_Head',(0,0,1),curve(t,[(0,0),(.26,.27),(.43,.27),(.67,-.20),(.78,-.20),(1,0)]))
            if name=='window':
                axis_world('Xiaoshang_Head',(0,0,1),curve(t,[(0,0),(.35,-.12),(.58,-.12),(.77,.10),(1,0)]))
        contact_legs(name,t)
        relax_hands(name,t)
        for pb in rig.pose.bones:
            q=pb.rotation_quaternion.copy()
            if pb.name in previous_quaternions:q.make_compatible(previous_quaternions[pb.name])
            pb.rotation_quaternion=q
            previous_quaternions[pb.name]=q.copy()
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
    'motion_revision':'merchant-v3: stable pelvis, two-bone foot contacts, small steps and staged greeting',
    'human_motion':{'url':'https://github.com/mrdoob/three.js/blob/dev/examples/models/gltf/Xbot.glb',
                    'clips':['idle','walk','wave','talk','turn','window','lookout','inspect','nod'],
                    'author':'Mixamo / Adobe; three.js sample asset',
                    'usage':'embedded in this game; not a standalone motion library',
                    'terms':'https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html',
                    'sha256':hashlib.sha256(human_path.read_bytes()).hexdigest()},
    'rig_adjustments':{'head_neck_pelvis':'dedicated joints', 'clavicle':'follows torso, never upper-arm roll',
                       'hand_scale':.82,'fingers':'relaxed flexion; open palm for wave'},
    'source_motion':{'url':'https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf/RobotExpressive',
                     'clips':[],
                     'author':'Tomás Laulhé / Quaternius; modifications Don McCurdy',
                     'license':'CC0-1.0','sha256':hashlib.sha256(motion.read_bytes()).hexdigest()},
    'joint_probes':probes},indent=2),encoding='utf-8')
