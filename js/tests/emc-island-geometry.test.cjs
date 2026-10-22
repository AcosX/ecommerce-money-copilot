const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');

function triangles(file){
  const bytes=fs.readFileSync(file),jsonSize=bytes.readUInt32LE(12);
  const doc=JSON.parse(bytes.subarray(20,20+jsonSize)),binary=20+jsonSize+8;
  function accessor(id){
    const a=doc.accessors[id],v=doc.bufferViews[a.bufferView];
    const components={SCALAR:1,VEC2:2,VEC3:3}[a.type];
    const [read,width]=({5126:['readFloatLE',4],5125:['readUInt32LE',4],5123:['readUInt16LE',2]})[a.componentType];
    const start=binary+(v.byteOffset||0)+(a.byteOffset||0),stride=v.byteStride||components*width;
    return Array.from({length:a.count},(_,i)=>Array.from({length:components},(_,j)=>bytes[read](start+i*stride+j*width)));
  }
  const result=new Map();
  for(const mesh of doc.meshes)for(const p of mesh.primitives){
    const position=accessor(p.attributes.POSITION),uv=accessor(p.attributes.TEXCOORD_0),indices=accessor(p.indices).flat();
    for(let i=0;i<indices.length;i+=3){
      const ids=indices.slice(i,i+3);
      // X/Z and UV are unchanged: identify the same source triangle even if
      // export changes index ordering or splits a vertex at a normal seam.
      const key=ids.map(j=>[position[j][0],position[j][2],...uv[j]].map(n=>n.toFixed(5)).join(',')).sort().join('|');
      const [a,b,c]=ids.map(j=>position[j]),u=b.map((n,k)=>n-a[k]),v=c.map((n,k)=>n-a[k]);
      const area=Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2;
      result.set(key,area);
    }
  }
  return result;
}

test('整平保留每个源三角面，草石和岛沿不再压成薄片',()=>{
  const root=path.resolve(__dirname,'../../assets/models');
  const source=triangles(path.join(root,'island-web.glb'));
  const flat=triangles(path.join(root,'island-flat-v2-web.glb'));
  assert.equal(flat.size,source.size);
  const ratios=[];
  for(const [key,area]of source){
    assert.ok(flat.has(key),'源网格和 UV 必须保留');
    if(area>1e-8)ratios.push(flat.get(key)/area);
  }
  ratios.sort((a,b)=>a-b);
  assert.ok(ratios[0]>.35,'任意三角面都不能塌成不足原面积 35% 的薄片');
  assert.ok(ratios[Math.floor(ratios.length*.01)]>.7,'至少 99% 的源三角面保留其立体面积');
});
