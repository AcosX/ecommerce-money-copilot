import * as THREE from 'three';
import {batchDecoration} from './emc-model-performance.js';

// 小型装饰采用真实立体几何；底面统一归零，兼容已有存档的摆放坐标。
export function createDecoration(scene,id){
  const root=new THREE.Group();root.userData.decorationId=id;
  const mat=(color,extra={})=>Object.assign(scene.mat(color),extra);
  const metal=mat('#59646a',{metalness:.35,roughness:.55}),silver=mat('#a7b6b4',{metalness:.45,roughness:.5});
  const wood=mat('#986744'),darkWood=mat('#5c3d2c'),gold=mat('#d7ae62',{metalness:.3,roughness:.55});
  const cream=mat('#f3e4b8'),green=mat('#4d794d'),leafLight=mat('#87aa57');
  const add=(parent,geometry,material,pos=[0,0,0])=>{const mesh=new THREE.Mesh(geometry,material);mesh.position.set(...pos);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;};
  const box=(parent,size,pos,material)=>scene.box(parent,size,pos,material);
  const cylinder=(parent,top,bottom,height,pos,material,sides=12)=>scene.cylinder(parent,top,bottom,height,sides,pos,material);
  const sphere=(parent,radius,pos,material,scale=[1,1,1])=>{const mesh=add(parent,new THREE.SphereGeometry(radius,12,8),material,pos);mesh.scale.set(...scale);return mesh;};
  const ring=(parent,radius,tube,pos,material,arc=Math.PI*2)=>add(parent,new THREE.TorusGeometry(radius,tube,5,24,arc),material,pos);
  const beam=(parent,a,b,radius,material)=>{const from=new THREE.Vector3(...a),to=new THREE.Vector3(...b),delta=to.clone().sub(from);const mesh=cylinder(parent,radius,radius,delta.length(),from.clone().add(to).multiplyScalar(.5).toArray(),material,6);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());return mesh;};
  const tube=(parent,points,radius,material)=>add(parent,new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p))),12,radius,5,false),material);
  const rounded=(parent,w,h,d,pos,material,r=.035)=>{
    const shape=new THREE.Shape(),x=-w/2,y=-h/2;r=Math.min(r,w/4,h/4);
    shape.moveTo(x+r,y);shape.lineTo(x+w-r,y);shape.quadraticCurveTo(x+w,y,x+w,y+r);shape.lineTo(x+w,y+h-r);shape.quadraticCurveTo(x+w,y+h,x+w-r,y+h);shape.lineTo(x+r,y+h);shape.quadraticCurveTo(x,y+h,x,y+h-r);shape.lineTo(x,y+r);shape.quadraticCurveTo(x,y,x+r,y);
    const geometry=new THREE.ExtrudeGeometry(shape,{depth:d,bevelEnabled:true,bevelSegments:1,steps:1,bevelSize:.012,bevelThickness:.012,curveSegments:3});geometry.translate(0,0,-d/2);return add(parent,geometry,material,pos);
  };
  // 轻微木纹保留小比例下的质感，不需要额外图片请求。
  const grain=document.createElement('canvas');grain.width=256;grain.height=64;const ctx=grain.getContext('2d');ctx.fillStyle='#e8ddc9';ctx.fillRect(0,0,256,64);
  for(let n=0;n<17;n++){ctx.strokeStyle=n%3?'#876b4b26':'#fff6df66';ctx.lineWidth=n%4===0?2:1;ctx.beginPath();ctx.moveTo(0,n*4);ctx.bezierCurveTo(65,n*4+Math.sin(n)*5,180,n*4-3,256,n*4+2);ctx.stroke();}
  wood.map=new THREE.CanvasTexture(grain);wood.map.colorSpace=THREE.SRGBColorSpace;

  if(id==='ufo'){
    const hull=mat('#a6ada0',{metalness:.5,roughness:.5}),glass=mat('#64c8c0',{transparent:true,opacity:.78,depthWrite:false,metalness:.1,roughness:.25});
    const glow=mat('#ffe49b',{emissive:new THREE.Color('#efb947'),emissiveIntensity:.65});
    cylinder(root,.26,.17,.08,[0,.04,0],metal);cylinder(root,.48,.28,.12,[0,.13,0],darkWood,24);
    const profile=[[.14,.10],[.38,.13],[.60,.20],[.74,.26],[.68,.32],[.45,.39],[.30,.41]].map(p=>new THREE.Vector2(...p));
    add(root,new THREE.LatheGeometry(profile,24),hull);ring(root,.705,.026,[0,.267,0],gold).rotation.x=Math.PI/2;
    ring(root,.40,.035,[0,.383,0],metal).rotation.x=Math.PI/2;
    add(root,new THREE.SphereGeometry(.36,18,9,0,Math.PI*2,0,Math.PI/2),glass,[0,.40,0]);
    cylinder(root,.32,.32,.035,[0,.405,0],mat('#254f54'));sphere(root,.11,[0,.48,0],mat('#466769'),[1,.8,1]);
    for(let i=0;i<10;i++){const a=i*Math.PI/5,x=Math.cos(a)*.58,z=Math.sin(a)*.58;const bezel=box(root,[.11,.035,.075],[x,.335,z],metal);bezel.rotation.y=-a;const lamp=box(root,[.075,.018,.045],[x,.362,z],glow);lamp.rotation.y=-a;}
    for(let i=0;i<3;i++){const a=i*Math.PI*2/3;beam(root,[Math.cos(a)*.36,.16,Math.sin(a)*.36],[Math.cos(a)*.45,.03,Math.sin(a)*.45],.025,metal);sphere(root,.055,[Math.cos(a)*.45,.03,Math.sin(a)*.45],metal,[1,.5,1]);}
    beam(root,[.19,.56,-.17],[.24,.78,-.20],.012,gold);sphere(root,.035,[.24,.79,-.20],glow);
  }else if(id==='ramen'){
    const red=mat('#7f302d'),neon=mat('#ffd18a',{emissive:new THREE.Color('#ff8b39'),emissiveIntensity:.8}),bowl=mat('#ed7250',{emissive:new THREE.Color('#a52c19'),emissiveIntensity:.25});
    for(const x of [-.36,.36]){box(root,[.09,.16,.10],[x,.08,0],metal);rounded(root,.24,.05,.30,[x,.025,0],metal,.02);}
    rounded(root,1.08,.74,.16,[0,.49,0],darkWood);rounded(root,.99,.65,.03,[0,.49,.105],gold);rounded(root,.94,.60,.025,[0,.49,.13],metal);
    rounded(root,.84,.50,.015,[0,.49,.151],red);
    for(const x of [-.47,.47])for(const y of [.19,.79])sphere(root,.023,[x,y,.14],gold,[1,1,.5]);
    // 面碗、面条、筷子与蒸汽都是真实几何，侧面观看也有厚度。
    const bowlShape=new THREE.Shape();bowlShape.moveTo(-.25,.05);bowlShape.quadraticCurveTo(-.20,-.14,-.10,-.16);bowlShape.lineTo(.10,-.16);bowlShape.quadraticCurveTo(.20,-.14,.25,.05);bowlShape.closePath();
    add(root,new THREE.ExtrudeGeometry(bowlShape,{depth:.035,bevelEnabled:true,bevelSize:.008,bevelThickness:.008,bevelSegments:1,steps:1,curveSegments:4}),bowl,[0,.47,.18]);
    beam(root,[-.26,.53,.225],[.26,.53,.225],.017,neon);beam(root,[-.10,.29,.22],[.10,.29,.22],.015,gold);
    for(let i=0;i<3;i++)tube(root,[[-.17,.55+i*.019,.22],[-.06,.58+i*.019,.23],[.04,.54+i*.019,.23],[.16,.57+i*.019,.22]],.009,neon);
    for(const x of [-.13,0,.13])tube(root,[[x,.62,.205],[x-.025,.67,.205],[x+.02,.71,.205],[x,.75,.205]],.01,neon);
    for(const y of [.60,.65])beam(root,[.10,y,.23],[.39,y+.12,.23],.012,cream);
    beam(root,[.51,.76,-.035],[.72,.76,-.035],.025,metal);beam(root,[.72,.28,-.035],[.72,.88,-.035],.028,metal);box(root,[.10,.65,.045],[.74,.58,-.05],darkWood);
  }else if(id==='flowers'){
    rounded(root,1.12,.30,.43,[0,.17,0],wood);box(root,[1.02,.025,.34],[0,.33,0],mat('#4c3828'));
    for(const z of [-.23,.23]){box(root,[1.17,.055,.05],[0,.32,z],darkWood);for(const y of [.09,.18])box(root,[1.09,.012,.018],[0,y,z],darkWood);}
    for(const x of [-.52,.52]){box(root,[.07,.32,.48],[x,.17,0],gold);for(const z of [-.25,.25])for(const y of [.08,.27])sphere(root,.014,[x,y,z],metal);}
    const yellow=mat('#e5b940'),white=mat('#fff0c8'),orange=mat('#db8150');
    for(let i=0;i<7;i++){
      const x=-.43+i*.14,z=i%2?.09:-.06,h=.57+(i%3)*.09;
      beam(root,[x,.33,z],[x+.025,h,z],.012,green);
      for(const side of [-1,1]){const leaf=sphere(root,.09,[x+side*.055,.43+(i%2)*.04,z],i%2?leafLight:green,[1.2,.32,.5]);leaf.rotation.z=side*.5;}
      const flower=new THREE.Group();flower.position.set(x+.025,h,z+.03);flower.rotation.x=-.25;root.add(flower);
      for(let j=0;j<6;j++){const a=j*Math.PI/3;const petal=sphere(flower,.056,[Math.cos(a)*.073,Math.sin(a)*.073,0],i%3===0?orange:white,[1.15,.7,.4]);petal.rotation.z=a;}
      sphere(flower,.041,[0,0,.025],yellow,[1,1,.55]);
    }
  }else if(id==='telescope'){
    const brass=mat('#b18b54',{metalness:.4,roughness:.5}),lens=mat('#6eb6c1',{metalness:.5,roughness:.2});
    for(let i=0;i<3;i++){const a=i*Math.PI*2/3,foot=[Math.cos(a)*.36,.035,Math.sin(a)*.36];beam(root,[0,.65,0],foot,.035,wood);cylinder(root,.065,.065,.04,foot,metal,8);}
    cylinder(root,.09,.09,.17,[0,.62,0],metal);cylinder(root,.055,.055,.21,[0,.78,0],gold);
    const scope=new THREE.Group();scope.position.set(0,.91,0);scope.rotation.z=-.95;root.add(scope);
    cylinder(scope,.125,.125,.79,[0,0,0],brass,16);for(const y of [-.35,.14,.35])cylinder(scope,.145,.145,.07,[0,y,0],metal,16);
    cylinder(scope,.16,.16,.12,[0,.43,0],gold,16);cylinder(scope,.13,.13,.014,[0,.50,0],lens,16);cylinder(scope,.09,.09,.02,[0,.51,0],mat('#183b4e'),16);
    cylinder(scope,.07,.07,.16,[0,-.46,0],metal);cylinder(scope,.09,.09,.05,[0,-.55,0],darkWood);
    const knob=cylinder(root,.07,.07,.08,[.12,.78,0],gold);knob.rotation.z=Math.PI/2;
    beam(root,[-.20,.25,.12],[.2,.25,.12],.015,gold);
  }else if(id==='windmill'){
    const stone=mat('#bfb29a'),roof=mat('#827258');
    cylinder(root,.27,.40,.82,[0,.43,0],stone,12);cylinder(root,0,.33,.31,[0,.98,0],roof,12);
    for(let row=0;row<4;row++)for(let i=0;i<8;i++){const a=(i+(row%2)*.5)*Math.PI/4,r=.39-row*.033;const brick=box(root,[.16,.055,.025],[Math.cos(a)*r,.13+row*.17,Math.sin(a)*r],row%2?cream:stone);brick.rotation.y=-a+Math.PI/2;}
    rounded(root,.18,.31,.045,[0,.18,.365],darkWood,.06);box(root,[.12,.11,.025],[0,.65,.30],mat('#597f88'));box(root,[.018,.12,.03],[0,.65,.32],cream);
    const rotor=new THREE.Group();rotor.position.set(0,.84,.38);rotor.rotation.z=Math.PI/4;root.add(rotor);
    for(let i=0;i<4;i++){const sail=new THREE.Group();sail.rotation.z=i*Math.PI/2;rotor.add(sail);box(sail,[.045,.68,.045],[0,.28,0],darkWood);for(const x of [-.085,.085])box(sail,[.025,.43,.025],[x,.38,0],wood);for(let n=0;n<6;n++)box(sail,[.19,.022,.025],[0,.18+n*.075,0],cream);}
    cylinder(root,.42,.44,.05,[0,.025,0],mat('#889272'),12);sphere(rotor,.073,[0,0,.025],gold,[1,1,.5]);
  }else if(id==='cat'){
    const orange=mat('#d99c58'),stripe=mat('#98613c'),pink=mat('#cc8f82'),cushion=mat('#6f98a4');
    const pillow=rounded(root,.93,.14,.68,[0,.10,0],cushion,.07);pillow.rotation.y=.1;
    for(const z of [-.30,.30])beam(root,[-.35,.11,z],[.35,.11,z],.013,cream);
    sphere(root,.29,[-.07,.30,-.02],orange,[1.15,.65,.9]);sphere(root,.18,[.23,.31,.10],orange,[1,.83,1]);
    for(const x of [.12,.33]){const ear=add(root,new THREE.ConeGeometry(.085,.16,3),orange,[x,.49,.10]);ear.rotation.z=x<.2?.15:-.15;const inside=add(root,new THREE.ConeGeometry(.046,.10,3),pink,[x,.49,.14]);inside.rotation.z=ear.rotation.z;}
    sphere(root,.12,[.25,.25,.23],cream,[1,.6,.55]);sphere(root,.024,[.25,.28,.30],pink,[1,.65,.5]);
    for(const x of [.16,.32])tube(root,[[x-.035,.34,.25],[x,.325,.27],[x+.035,.34,.25]],.008,darkWood);
    for(const x of [-.22,-.08,.06])tube(root,[[x,.36,-.24],[x-.02,.46,-.08],[x,.44,.08]],.018,stripe);
    const tail=ring(root,.25,.052,[-.07,.25,.03],orange,Math.PI*1.55);tail.rotation.x=Math.PI/2;tail.rotation.z=.15;
    sphere(root,.07,[.15,.23,.25],orange,[1,.55,1]);
  }
  // 每件装饰的最低可见点都是锚点，放到地面/屋顶时不穿插或悬空。
  root.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(root);
  if(!bounds.isEmpty()){const offset=-bounds.min.y;root.children.forEach(child=>{child.position.y+=offset;});}
  root.userData.modelRevision=2;
  return batchDecoration(root);
}
