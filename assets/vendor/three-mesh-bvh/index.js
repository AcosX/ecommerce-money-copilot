/*! three-mesh-bvh 0.9.16 | MIT | github.com/gkjohnson/three-mesh-bvh | see LICENSE */
var xs=Object.defineProperty;var gs=(o,t)=>{for(var e in t)xs(o,e,{get:t[e],enumerable:!0})};import{Box3 as Ss}from"three";var vi=0,bi=1,Ti=2,Z=0,ot=1,mn=2;var Et=Math.pow(2,-24),ct=Symbol("SKIP_GENERATION"),Te={strategy:0,maxDepth:40,targetLeafSize:10,useSharedArrayBuffer:!1,setBoundingBox:!0,onProgress:null,indirect:!1,verbose:!0,range:null,[ct]:!1};function F(o,t,e){return e.min.x=t[o],e.min.y=t[o+1],e.min.z=t[o+2],e.max.x=t[o+3],e.max.y=t[o+4],e.max.z=t[o+5],e}function Zt(o){let t=-1,e=-1/0;for(let n=0;n<3;n++){let i=o[n+3]-o[n];i>e&&(e=i,t=n)}return t}function hn(o,t){t.set(o)}function yn(o,t,e){let n,i;for(let r=0;r<3;r++){let s=r+3;n=o[r],i=t[r],e[r]=n<i?n:i,n=o[s],i=t[s],e[s]=n>i?n:i}}function Kt(o,t,e){for(let n=0;n<3;n++){let i=t[o+2*n],r=t[o+2*n+1],s=i-r,l=i+r;s<e[n]&&(e[n]=s),l>e[n+3]&&(e[n+3]=l)}}function Mt(o){let t=o[3]-o[0],e=o[4]-o[1],n=o[5]-o[2];return 2*(t*e+e*n+n*t)}function N(o,t){return t[o+15]===65535}function C(o,t){return t[o+6]}function z(o,t){return t[o+14]}function O(o){return o+8}function L(o,t){let e=t[o+6];return o+e*8}function dt(o,t){return t[o+7]}function we(o,t,e,n,i){let r=1/0,s=1/0,l=1/0,c=-1/0,u=-1/0,f=-1/0,a=1/0,d=1/0,p=1/0,y=-1/0,g=-1/0,b=-1/0,T=o.offset||0;for(let m=(t-T)*6,h=(t+e-T)*6;m<h;m+=6){let x=o[m+0],v=o[m+1],A=x-v,w=x+v;A<r&&(r=A),w>c&&(c=w),x<a&&(a=x),x>y&&(y=x);let _=o[m+2],I=o[m+3],B=_-I,P=_+I;B<s&&(s=B),P>u&&(u=P),_<d&&(d=_),_>g&&(g=_);let S=o[m+4],E=o[m+5],M=S-E,D=S+E;M<l&&(l=M),D>f&&(f=D),S<p&&(p=S),S>b&&(b=S)}n[0]=r,n[1]=s,n[2]=l,n[3]=c,n[4]=u,n[5]=f,i[0]=a,i[1]=d,i[2]=p,i[3]=y,i[4]=g,i[5]=b}var at=32,bs=(o,t)=>o.candidate-t.candidate,pt=new Array(at).fill().map(()=>({count:0,bounds:new Float32Array(6),rightCacheBounds:new Float32Array(6),leftCacheBounds:new Float32Array(6),candidate:0})),Ae=new Float32Array(6);function Ai(o,t,e,n,i,r){let s=-1,l=0;if(r===0)s=Zt(t),s!==-1&&(l=(t[s]+t[s+3])/2);else if(r===1)s=Zt(o),s!==-1&&(l=Ts(e,n,i,s));else if(r===2){let c=Mt(o),u=1.25*i,f=e.offset||0,a=(n-f)*6,d=(n+i-f)*6;for(let p=0;p<3;p++){let y=t[p],T=(t[p+3]-y)/at;if(i<at/4){let m=[...pt];m.length=i;let h=0;for(let v=a;v<d;v+=6,h++){let A=m[h];A.candidate=e[v+2*p],A.count=0;let{bounds:w,leftCacheBounds:_,rightCacheBounds:I}=A;for(let B=0;B<3;B++)I[B]=1/0,I[B+3]=-1/0,_[B]=1/0,_[B+3]=-1/0,w[B]=1/0,w[B+3]=-1/0;Kt(v,e,w)}m.sort(bs);let x=i;for(let v=0;v<x;v++){let A=m[v];for(;v+1<x&&m[v+1].candidate===A.candidate;)m.splice(v+1,1),x--}for(let v=a;v<d;v+=6){let A=e[v+2*p];for(let w=0;w<x;w++){let _=m[w];A>=_.candidate?Kt(v,e,_.rightCacheBounds):(Kt(v,e,_.leftCacheBounds),_.count++)}}for(let v=0;v<x;v++){let A=m[v],w=A.count,_=i-A.count,I=A.leftCacheBounds,B=A.rightCacheBounds,P=0;w!==0&&(P=Mt(I)/c);let S=0;_!==0&&(S=Mt(B)/c);let E=1+1.25*(P*w+S*_);E<u&&(s=p,u=E,l=A.candidate)}}else{for(let x=0;x<at;x++){let v=pt[x];v.count=0,v.candidate=y+T+x*T;let A=v.bounds;for(let w=0;w<3;w++)A[w]=1/0,A[w+3]=-1/0}for(let x=a;x<d;x+=6){let w=~~((e[x+2*p]-y)/T);w>=at&&(w=at-1);let _=pt[w];_.count++,Kt(x,e,_.bounds)}let m=pt[at-1];hn(m.bounds,m.rightCacheBounds);for(let x=at-2;x>=0;x--){let v=pt[x],A=pt[x+1];yn(v.bounds,A.rightCacheBounds,v.rightCacheBounds)}let h=0;for(let x=0;x<at-1;x++){let v=pt[x],A=v.count,w=v.bounds,I=pt[x+1].rightCacheBounds;A!==0&&(h===0?hn(w,Ae):yn(w,Ae,Ae)),h+=A;let B=0,P=0;h!==0&&(B=Mt(Ae)/c);let S=i-h;S!==0&&(P=Mt(I)/c);let E=1+1.25*(B*h+P*S);E<u&&(s=p,u=E,l=v.candidate)}}}}else console.warn(`BVH: Invalid build strategy value ${r} used.`);return{axis:s,pos:l}}function Ts(o,t,e,n){let i=0,r=o.offset;for(let s=t,l=t+e;s<l;s++)i+=o[(s-r)*6+n*2];return i/e}var Dt=class{constructor(){this.boundingData=new Float32Array(6)}};function Bi(o,t,e,n,i,r){let s=n,l=n+i-1,c=r.pos,u=r.axis*2,f=e.offset||0;for(;;){for(;s<=l&&e[(s-f)*6+u]<c;)s++;for(;s<=l&&e[(l-f)*6+u]>=c;)l--;if(s<l){for(let a=0;a<t;a++){let d=o[s*t+a];o[s*t+a]=o[l*t+a],o[l*t+a]=d}for(let a=0;a<6;a++){let d=s-f,p=l-f,y=e[d*6+a];e[d*6+a]=e[p*6+a],e[p*6+a]=y}s++,l--}else return s}}var _i,Be,gn,Si,ws=Math.pow(2,32);function _e(o){return"count"in o?1:1+_e(o.left)+_e(o.right)}function Ii(o,t,e){return _i=new Float32Array(e),Be=new Uint32Array(e),gn=new Uint16Array(e),Si=new Uint8Array(e),vn(o,t)}function vn(o,t){let e=o/4,n=o/2,i="count"in t,r=t.boundingData;for(let s=0;s<6;s++)_i[e+s]=r[s];if(i)return t.buffer?(Si.set(new Uint8Array(t.buffer),o),o+t.buffer.byteLength):(Be[e+6]=t.offset,gn[n+14]=t.count,gn[n+15]=65535,o+32);{let{left:s,right:l,splitAxis:c}=t,u=o+32,f=vn(u,s),a=o/32,p=f/32-a;if(p>ws)throw new Error("MeshBVH: Cannot store relative child node offset greater than 32 bits.");return Be[e+6]=p,Be[e+7]=c,vn(f,l)}}function As(o,t,e,n,i,r){let{maxDepth:s,verbose:l,targetLeafSize:c,_strictLeafSize:u=1/0,strategy:f,onProgress:a}=i,d=o.primitiveBuffer,p=o.primitiveBufferStride,y=new Float32Array(6),g=!1,b=new Dt;return we(t,e,n,b.boundingData,y),m(b,e,n,y),b;function T(h){a&&a((h-r.offset)/r.count)}function m(h,x,v,A=null,w=0){!g&&w>=s&&(g=!0,l&&console.warn(`BVH: Max depth of ${s} reached when generating BVH. Consider increasing maxDepth.`));let _=v>u;if(v<=c&&!_||w>=s)return T(x+v),h.offset=x,h.count=v,h;let I=Ai(h.boundingData,A,t,x,v,f),B=I.axis===-1?-1:Bi(d,p,t,x,v,I);if(I.axis===-1||B===x||B===x+v){if(!_)return T(x+v),h.offset=x,h.count=v,h;I.axis=Math.max(0,Zt(h.boundingData)),B=x+Math.max(1,Math.floor(v/2))}h.splitAxis=I.axis;let P=new Dt,S=x,E=B-x;h.left=P,we(t,S,E,P.boundingData,y),m(P,S,E,y,w+1);let M=new Dt,D=B,U=v-E;return h.right=M,we(t,D,U,M.boundingData,y),m(M,D,U,y,w+1),h}}function Pi(o,t){let e=t.useSharedArrayBuffer?SharedArrayBuffer:ArrayBuffer,n=o.getRootRanges(t.range),i=n[0],r=n[n.length-1],s={offset:i.offset,count:r.offset+r.count-i.offset},l=new Float32Array(6*s.count);l.offset=s.offset,o.computePrimitiveBounds(s.offset,s.count,l),o._roots=n.map(c=>{let u=As(o,l,c.offset,c.count,t,s),f=_e(u),a=new e(32*f);return Ii(0,u,a),a})}import{Box3 as Bs}from"three";var $=class{constructor(t){this._getNewPrimitive=t,this._primitives=[]}getPrimitive(){let t=this._primitives;return t.length===0?this._getNewPrimitive():t.pop()}releasePrimitive(t){this._primitives.push(t)}};var bn=class{constructor(){this.float32Array=null,this.uint16Array=null,this.uint32Array=null;let t=[],e=null;this.setBuffer=n=>{e&&t.push(e),e=n,this.float32Array=new Float32Array(n),this.uint16Array=new Uint16Array(n),this.uint32Array=new Uint32Array(n)},this.clearBuffer=()=>{e=null,this.float32Array=null,this.uint16Array=null,this.uint32Array=null,t.length!==0&&this.setBuffer(t.pop())}}},R=new bn;var mt,Ft,Nt=[],Se=new $(()=>new Bs);function Ei(o,t,e,n,i,r){mt=Se.getPrimitive(),Ft=Se.getPrimitive(),Nt.push(mt,Ft),R.setBuffer(o._roots[t]);let s=Tn(0,o.geometry,e,n,i,r);R.clearBuffer(),Se.releasePrimitive(mt),Se.releasePrimitive(Ft),Nt.pop(),Nt.pop();let l=Nt.length;return l>0&&(Ft=Nt[l-1],mt=Nt[l-2]),s}function Tn(o,t,e,n,i=null,r=0,s=0){let{float32Array:l,uint16Array:c,uint32Array:u}=R,f=o*2;if(N(f,c)){let d=C(o,u),p=z(f,c);return F(o,l,mt),n(d,p,!1,s,r+o/8,mt)}else{let B=function(S){let{uint16Array:E,uint32Array:M}=R,D=S*2;for(;!N(D,E);)S=O(S),D=S*2;return C(S,M)},P=function(S){let{uint16Array:E,uint32Array:M}=R,D=S*2;for(;!N(D,E);)S=L(S,M),D=S*2;return C(S,M)+z(D,E)},d=O(o),p=L(o,u),y=d,g=p,b,T,m,h;if(i&&(m=mt,h=Ft,F(y,l,m),F(g,l,h),b=i(m),T=i(h),T<b)){y=p,g=d;let S=b;b=T,T=S,m=h}m||(m=mt,F(y,l,m));let x=N(y*2,c),v=e(m,x,b,s+1,r+y/8),A;if(v===2){let S=B(y),M=P(y)-S;A=n(S,M,!0,s+1,r+y/8,m)}else A=v&&Tn(y,t,e,n,i,r,s+1);if(A)return!0;h=Ft,F(g,l,h);let w=N(g*2,c),_=e(h,w,T,s+1,r+g/8),I;if(_===2){let S=B(g),M=P(g)-S;I=n(S,M,!0,s+1,r+g/8,h)}else I=_&&Tn(g,t,e,n,i,r,s+1);return!!I}}import{Box3 as Jt,Matrix4 as _s}from"three";var $t=new R.constructor,Pe=new R.constructor,ht=new $(()=>new Jt),Rt=new Jt,Ct=new Jt,wn=new Jt,An=new Jt,Bn=!1;function Mi(o,t,e,n){if(Bn)throw new Error("MeshBVH: Recursive calls to bvhcast not supported.");Bn=!0;let i=o._roots,r=t._roots,s,l=0,c=0,u=new _s().copy(e).invert();for(let f=0,a=i.length;f<a;f++){$t.setBuffer(i[f]),c=0;let d=ht.getPrimitive();F(0,$t.float32Array,d),d.applyMatrix4(u);for(let p=0,y=r.length;p<y&&(Pe.setBuffer(r[p]),s=et(0,0,e,u,n,l,c,0,0,d),Pe.clearBuffer(),c+=r[p].byteLength/32,!s);p++);if(ht.releasePrimitive(d),$t.clearBuffer(),l+=i[f].byteLength/32,s)break}return Bn=!1,s}function et(o,t,e,n,i,r=0,s=0,l=0,c=0,u=null,f=!1){let a,d;f?(a=Pe,d=$t):(a=$t,d=Pe);let p=a.float32Array,y=a.uint32Array,g=a.uint16Array,b=d.float32Array,T=d.uint32Array,m=d.uint16Array,h=o*2,x=t*2,v=N(h,g),A=N(x,m),w=!1;if(A&&v)f?w=i(C(t,T),z(t*2,m),C(o,y),z(o*2,g),c,s+t/8,l,r+o/8):w=i(C(o,y),z(o*2,g),C(t,T),z(t*2,m),l,r+o/8,c,s+t/8);else if(A){let _=ht.getPrimitive();F(t,b,_),_.applyMatrix4(e);let I=O(o),B=L(o,y);F(I,p,Rt),F(B,p,Ct);let P=_.intersectsBox(Rt),S=_.intersectsBox(Ct);w=P&&et(t,I,n,e,i,s,r,c,l+1,_,!f)||S&&et(t,B,n,e,i,s,r,c,l+1,_,!f),ht.releasePrimitive(_)}else{let _=O(t),I=L(t,T);F(_,b,wn),F(I,b,An);let B=u.intersectsBox(wn),P=u.intersectsBox(An);if(B&&P)w=et(o,_,e,n,i,r,s,l,c+1,u,f)||et(o,I,e,n,i,r,s,l,c+1,u,f);else if(B)if(v)w=et(o,_,e,n,i,r,s,l,c+1,u,f);else{let S=ht.getPrimitive();S.copy(wn).applyMatrix4(e);let E=O(o),M=L(o,y);F(E,p,Rt),F(M,p,Ct);let D=S.intersectsBox(Rt),U=S.intersectsBox(Ct);w=D&&et(_,E,n,e,i,s,r,c,l+1,S,!f)||U&&et(_,M,n,e,i,s,r,c,l+1,S,!f),ht.releasePrimitive(S)}else if(P)if(v)w=et(o,I,e,n,i,r,s,l,c+1,u,f);else{let S=ht.getPrimitive();S.copy(An).applyMatrix4(e);let E=O(o),M=L(o,y);F(E,p,Rt),F(M,p,Ct);let D=S.intersectsBox(Rt),U=S.intersectsBox(Ct);w=D&&et(I,E,n,e,i,s,r,c,l+1,S,!f)||U&&et(I,M,n,e,i,s,r,c,l+1,S,!f),ht.releasePrimitive(S)}}return w}var Ee=new class{constructor(){let o=null,t=null,e=null,n=!1;this.root=null,this.buffer=null,this.uint32Array=null,this.uint16Array=null,this.setBVH=(r,s)=>{if(n)throw new Error("BVHTraversalHelper: cannot call setBVH during an active traversal.");this.root=s,this.buffer=o=r._roots[s],this.uint16Array=e=new Uint16Array(o),this.uint32Array=t=new Uint32Array(o)},this.reset=()=>{this.root=null,this.buffer=o=null,this.uint16Array=e=null,this.uint32Array=t=null},this.getRangeStart=r=>{let s=r*2;for(;!N(s,e);)r=O(r),s=r*2;return C(r,t)},this.getRangeEnd=r=>{let s=r*2;for(;!N(s,e);)r=L(r,t),s=r*2;return C(r,t)+z(s,e)};let i=(r,s,l)=>{let c=s*2,u=N(c,e);if(!r(l,u,s)&&!u){let a=O(s),d=L(s,t);i(r,a,l+1),i(r,d,l+1)}};this.traverseBuffer=r=>{if(n)throw new Error("BVHTraversalHelper: cannot start a traversal during an active traversal.");n=!0;try{i(r,0,0)}finally{n=!1}},this.traverse=r=>{this.traverseBuffer((s,l,c)=>{if(l){let u=c*2,f=t[c+6],a=e[u+14];return r(s,l,new Float32Array(o,c*4,6),f,a)}else{let u=dt(c,t);return r(s,l,new Float32Array(o,c*4,6),u)}})}}};var Di=new Ss,Ot=new Float32Array(6),Lt=class{constructor(){this._roots=null,this.primitiveBuffer=null,this.primitiveBufferStride=null}init(t){t={...Te,...t},"maxLeafSize"in t&&(console.warn('BVH: "maxLeafSize" option has been deprecated. Use "targetLeafSize", instead.'),t={...t,targetLeafSize:t.maxLeafSize}),Pi(this,t)}getRootRanges(){throw new Error("BVH: getRootRanges() not implemented")}writePrimitiveBounds(){throw new Error("BVH: writePrimitiveBounds() not implemented")}writePrimitiveRangeBounds(t,e,n,i){let r=1/0,s=1/0,l=1/0,c=-1/0,u=-1/0,f=-1/0;for(let a=t,d=t+e;a<d;a++){this.writePrimitiveBounds(a,Ot,0);let[p,y,g,b,T,m]=Ot;p<r&&(r=p),b>c&&(c=b),y<s&&(s=y),T>u&&(u=T),g<l&&(l=g),m>f&&(f=m)}return n[i+0]=r,n[i+1]=s,n[i+2]=l,n[i+3]=c,n[i+4]=u,n[i+5]=f,n}computePrimitiveBounds(t,e,n){let i=n.offset||0;for(let r=t,s=t+e;r<s;r++){this.writePrimitiveBounds(r,Ot,0);let[l,c,u,f,a,d]=Ot,p=(l+f)/2,y=(c+a)/2,g=(u+d)/2,b=(f-l)/2,T=(a-c)/2,m=(d-u)/2,h=(r-i)*6;n[h+0]=p,n[h+1]=b+(Math.abs(p)+b)*Et,n[h+2]=y,n[h+3]=T+(Math.abs(y)+T)*Et,n[h+4]=g,n[h+5]=m+(Math.abs(g)+m)*Et}return n}shiftPrimitiveOffsets(t){let e=this._indirectBuffer;if(e)for(let n=0,i=e.length;n<i;n++)e[n]+=t;else{let n=this._roots;for(let i=0;i<n.length;i++){let r=n[i],s=new Uint32Array(r),l=new Uint16Array(r),c=r.byteLength/32;for(let u=0;u<c;u++){let f=8*u,a=2*f;N(a,l)&&(s[f+6]+=t)}}}}traverse(t,e=0){Ee.setBVH(this,e),Ee.traverse(t),Ee.reset()}refit(){let t=this._roots;for(let e=0,n=t.length;e<n;e++){let i=t[e],r=new Uint32Array(i),s=new Uint16Array(i),l=new Float32Array(i),c=i.byteLength/32;for(let u=c-1;u>=0;u--){let f=u*8,a=f*2;if(N(a,s)){let p=C(f,r),y=z(a,s);this.writePrimitiveRangeBounds(p,y,Ot,0),l.set(Ot,f)}else{let p=O(f),y=L(f,r);for(let g=0;g<3;g++){let b=l[p+g],T=l[p+g+3],m=l[y+g],h=l[y+g+3];l[f+g]=b<m?b:m,l[f+g+3]=T>h?T:h}}}}}getBoundingBox(t){return t.makeEmpty(),this._roots.forEach(n=>{F(0,new Float32Array(n),Di),t.union(Di)}),t}shapecast(t){let{boundsTraverseOrder:e,intersectsBounds:n,intersectsRange:i,intersectsPrimitive:r,scratchPrimitive:s,iterate:l}=t;if(i&&r){let a=i;i=(d,p,y,g,b)=>a(d,p,y,g,b)?!0:l(d,p,this,r,y,g,s)}else i||(r?i=(a,d,p,y)=>l(a,d,this,r,p,y,s):i=(a,d,p)=>p);let c=!1,u=0,f=this._roots;for(let a=0,d=f.length;a<d;a++){let p=f[a];if(c=Ei(this,a,n,i,e,u),c)break;u+=p.byteLength/32}return c}bvhcast(t,e,n){let{intersectsRanges:i}=n;return Mi(this,t,e,i)}};import{Box3 as Ms}from"three";function Me(){return typeof SharedArrayBuffer<"u"}import{BufferAttribute as Is}from"three";function jt(o){return o.index?o.index.count:o.attributes.position.count}function yt(o){return jt(o)/3}function _n(o,t=ArrayBuffer){return o>65535?new Uint32Array(new t(4*o)):new Uint16Array(new t(2*o))}function Ni(o,t){if(!o.index){let e=o.attributes.position.count,n=t.useSharedArrayBuffer?SharedArrayBuffer:ArrayBuffer,i=_n(e,n);o.setIndex(new Is(i,1));for(let r=0;r<e;r++)i[r]=r}}function Ps(o,t,e){let n=jt(o)/e,i=t||o.drawRange,r=i.start/e,s=(i.start+i.count)/e,l=Math.max(0,r),c=Math.min(n,s)-l;return{offset:Math.floor(l),count:Math.floor(c)}}function Es(o,t){return o.groups.map(e=>({offset:e.start/t,count:e.count/t}))}function Sn(o,t,e){let n=Ps(o,t,e),i=Es(o,e);if(!i.length)return[n];let r=[],s=n.offset,l=n.offset+n.count,c=jt(o)/e,u=[];for(let d of i){let{offset:p,count:y}=d,g=p,b=isFinite(y)?y:c-p,T=p+b;g<l&&T>s&&(u.push({pos:Math.max(s,g),isStart:!0}),u.push({pos:Math.min(l,T),isStart:!1}))}u.sort((d,p)=>d.pos!==p.pos?d.pos-p.pos:d.type==="end"?-1:1);let f=0,a=null;for(let d of u){let p=d.pos;f!==0&&p!==a&&r.push({offset:a,count:p-a}),f+=d.isStart?1:-1,a=p}return r}function Ds(o,t){let e=o[o.length-1],n=e.offset+e.count>2**16,i=o.reduce((u,f)=>u+f.count,0),r=n?4:2,s=t?new SharedArrayBuffer(i*r):new ArrayBuffer(i*r),l=n?new Uint32Array(s):new Uint16Array(s),c=0;for(let u=0;u<o.length;u++){let{offset:f,count:a}=o[u];for(let d=0;d<a;d++)l[c+d]=f+d;c+=a}return l}var st=class extends Lt{get indirect(){return!!this._indirectBuffer}get primitiveStride(){return null}get primitiveBufferStride(){return this.indirect?1:this.primitiveStride}set primitiveBufferStride(t){}get primitiveBuffer(){return this.indirect?this._indirectBuffer:this.geometry.index.array}set primitiveBuffer(t){}constructor(t,e={}){if(t.isBufferGeometry){if(t.index&&t.index.isInterleavedBufferAttribute)throw new Error("BVH: InterleavedBufferAttribute is not supported for the index attribute.")}else throw new Error("BVH: Only BufferGeometries are supported.");if(e.useSharedArrayBuffer&&!Me())throw new Error("BVH: SharedArrayBuffer is not available.");super(),this.geometry=t,this.resolvePrimitiveIndex=e.indirect?n=>this._indirectBuffer[n]:n=>n,this.primitiveBuffer=null,this.primitiveBufferStride=null,this._indirectBuffer=null,e={...Te,...e},e[ct]||this.init(e)}init(t){let{geometry:e,primitiveStride:n}=this;if(t.indirect){let i=Sn(e,t.range,n),r=Ds(i,t.useSharedArrayBuffer);this._indirectBuffer=r}else Ni(e,t);super.init(t),!e.boundingBox&&t.setBoundingBox&&(e.boundingBox=this.getBoundingBox(new Ms))}getRootRanges(t){return this.indirect?[{offset:0,count:this._indirectBuffer.length}]:Sn(this.geometry,t,this.primitiveStride)}raycastObject3D(){throw new Error("BVH: raycastObject3D() not implemented")}};import{BufferAttribute as cr,FrontSide as mo,Ray as ar,Vector3 as go,Matrix4 as lr}from"three";import{Vector3 as xt,Matrix4 as Oi,Line3 as Li}from"three";import{Vector3 as Ns}from"three";var K=class{constructor(){this.min=1/0,this.max=-1/0}setFromPointsField(t,e){let n=1/0,i=-1/0;for(let r=0,s=t.length;r<s;r++){let c=t[r][e];n=c<n?c:n,i=c>i?c:i}this.min=n,this.max=i}setFromPoints(t,e){let n=1/0,i=-1/0;for(let r=0,s=e.length;r<s;r++){let l=e[r],c=t.dot(l);n=c<n?c:n,i=c>i?c:i}this.min=n,this.max=i}isSeparated(t){return this.min>t.max||t.min>this.max}};K.prototype.setFromBox=(function(){let o=new Ns;return function(e,n){let i=n.min,r=n.max,s=1/0,l=-1/0;for(let c=0;c<=1;c++)for(let u=0;u<=1;u++)for(let f=0;f<=1;f++){o.x=i.x*c+r.x*(1-c),o.y=i.y*u+r.y*(1-u),o.z=i.z*f+r.z*(1-f);let a=e.dot(o);s=Math.min(a,s),l=Math.max(a,l)}this.min=s,this.max=l}})();import{Triangle as Ls,Vector3 as nt,Vector2 as Ri,Line3 as zt,Plane as zs}from"three";import{Vector3 as vt,Vector2 as Fs,Plane as Rs,Line3 as Cs}from"three";var Os=(function(){let o=new vt,t=new vt,e=new vt;return function(i,r,s){let l=i.start,c=o,u=r.start,f=t;e.subVectors(l,u),o.subVectors(i.end,i.start),t.subVectors(r.end,r.start);let a=e.dot(f),d=f.dot(c),p=f.dot(f),y=e.dot(c),b=c.dot(c)*p-d*d,T,m;b!==0?T=(a*d-y*p)/b:T=0,m=(a+T*d)/p,s.x=T,s.y=m}})(),Qt=(function(){let o=new Fs,t=new vt,e=new vt;return function(i,r,s,l){Os(i,r,o);let c=o.x,u=o.y;if(c>=0&&c<=1&&u>=0&&u<=1){i.at(c,s),r.at(u,l);return}else if(c>=0&&c<=1){u<0?r.at(0,l):r.at(1,l),i.closestPointToPoint(l,!0,s);return}else if(u>=0&&u<=1){c<0?i.at(0,s):i.at(1,s),r.closestPointToPoint(s,!0,l);return}else{let f;c<0?f=i.start:f=i.end;let a;u<0?a=r.start:a=r.end;let d=t,p=e;if(i.closestPointToPoint(a,!0,t),r.closestPointToPoint(f,!0,e),d.distanceToSquared(a)<=p.distanceToSquared(f)){s.copy(d),l.copy(a);return}else{s.copy(f),l.copy(p);return}}}})(),Fi=(function(){let o=new vt,t=new vt,e=new Rs,n=new Cs;return function(r,s){let{radius:l,center:c}=r,{a:u,b:f,c:a}=s;if(n.start=u,n.end=f,n.closestPointToPoint(c,!0,o).distanceTo(c)<=l||(n.start=u,n.end=a,n.closestPointToPoint(c,!0,o).distanceTo(c)<=l)||(n.start=f,n.end=a,n.closestPointToPoint(c,!0,o).distanceTo(c)<=l))return!0;let g=s.getPlane(e);if(Math.abs(g.distanceToPoint(c))<=l){let T=g.projectPoint(c,t);if(s.containsPoint(T))return!0}return!1}})();var Vs=["x","y","z"],lt=1e-15,Ci=lt*lt;function J(o){return Math.abs(o)<lt}var q=class extends Ls{constructor(...t){super(...t),this.isExtendedTriangle=!0,this.satAxes=new Array(4).fill().map(()=>new nt),this.satBounds=new Array(4).fill().map(()=>new K),this.points=[this.a,this.b,this.c],this.plane=new zs,this.isDegenerateIntoSegment=!1,this.isDegenerateIntoPoint=!1,this.degenerateSegment=new zt,this.needsUpdate=!0}intersectsSphere(t){return Fi(t,this)}update(){let t=this.a,e=this.b,n=this.c,i=this.points,r=this.satAxes,s=this.satBounds,l=r[0],c=s[0];this.getNormal(l),c.setFromPoints(l,i);let u=r[1],f=s[1];u.subVectors(t,e),f.setFromPoints(u,i);let a=r[2],d=s[2];a.subVectors(e,n),d.setFromPoints(a,i);let p=r[3],y=s[3];p.subVectors(n,t),y.setFromPoints(p,i);let g=u.length(),b=a.length(),T=p.length();this.isDegenerateIntoPoint=!1,this.isDegenerateIntoSegment=!1,g<lt?b<lt||T<lt?this.isDegenerateIntoPoint=!0:(this.isDegenerateIntoSegment=!0,this.degenerateSegment.start.copy(t),this.degenerateSegment.end.copy(n)):b<lt?T<lt?this.isDegenerateIntoPoint=!0:(this.isDegenerateIntoSegment=!0,this.degenerateSegment.start.copy(e),this.degenerateSegment.end.copy(t)):T<lt&&(this.isDegenerateIntoSegment=!0,this.degenerateSegment.start.copy(n),this.degenerateSegment.end.copy(e)),this.plane.setFromNormalAndCoplanarPoint(l,t),this.needsUpdate=!1}};q.prototype.closestPointToSegment=(function(){let o=new nt,t=new nt,e=new zt;return function(i,r=null,s=null){let{start:l,end:c}=i,u=this.points,f,a=1/0;for(let d=0;d<3;d++){let p=(d+1)%3;e.start.copy(u[d]),e.end.copy(u[p]),Qt(e,i,o,t),f=o.distanceToSquared(t),f<a&&(a=f,r&&r.copy(o),s&&s.copy(t))}return this.closestPointToPoint(l,o),f=l.distanceToSquared(o),f<a&&(a=f,r&&r.copy(o),s&&s.copy(l)),this.closestPointToPoint(c,o),f=c.distanceToSquared(o),f<a&&(a=f,r&&r.copy(o),s&&s.copy(c)),Math.sqrt(a)}})();q.prototype.intersectsTriangle=(function(){let o=new q,t=new K,e=new K,n=new nt,i=new nt,r=new nt,s=new nt,l=new zt,c=new zt,u=new nt,f=new Ri,a=new Ri;function d(h,x,v,A){let w=n;!h.isDegenerateIntoPoint&&!h.isDegenerateIntoSegment?w.copy(h.plane.normal):w.copy(x.plane.normal);let _=h.satBounds,I=h.satAxes;for(let S=1;S<4;S++){let E=_[S],M=I[S];if(t.setFromPoints(M,x.points),E.isSeparated(t)||(s.copy(w).cross(M),t.setFromPoints(s,h.points),e.setFromPoints(s,x.points),t.isSeparated(e)))return!1}let B=x.satBounds,P=x.satAxes;for(let S=1;S<4;S++){let E=B[S],M=P[S];if(t.setFromPoints(M,h.points),E.isSeparated(t)||(s.crossVectors(w,M),t.setFromPoints(s,h.points),e.setFromPoints(s,x.points),t.isSeparated(e)))return!1}return v&&(A||console.warn("ExtendedTriangle.intersectsTriangle: Triangles are coplanar which does not support an output edge. Setting edge to 0, 0, 0."),v.start.set(0,0,0),v.end.set(0,0,0)),!0}function p(h,x,v,A,w,_,I,B,P,S,E){let M=I/(I-B);S.x=A+(w-A)*M,E.start.subVectors(x,h).multiplyScalar(M).add(h),M=I/(I-P),S.y=A+(_-A)*M,E.end.subVectors(v,h).multiplyScalar(M).add(h)}function y(h,x,v,A,w,_,I,B,P,S,E){if(w>0)p(h.c,h.a,h.b,A,x,v,P,I,B,S,E);else if(_>0)p(h.b,h.a,h.c,v,x,A,B,I,P,S,E);else if(B*P>0||I!=0)p(h.a,h.b,h.c,x,v,A,I,B,P,S,E);else if(B!=0)p(h.b,h.a,h.c,v,x,A,B,I,P,S,E);else if(P!=0)p(h.c,h.a,h.b,A,x,v,P,I,B,S,E);else return!0;return!1}function g(h,x,v,A){let w=x.degenerateSegment,_=h.plane.distanceToPoint(w.start),I=h.plane.distanceToPoint(w.end);return J(_)?J(I)?d(h,x,v,A):(v&&(v.start.copy(w.start),v.end.copy(w.start)),h.containsPoint(w.start)):J(I)?(v&&(v.start.copy(w.end),v.end.copy(w.end)),h.containsPoint(w.end)):h.plane.intersectLine(w,n)!=null?(v&&(v.start.copy(n),v.end.copy(n)),h.containsPoint(n)):!1}function b(h,x,v){let A=x.a;return J(h.plane.distanceToPoint(A))&&h.containsPoint(A)?(v&&(v.start.copy(A),v.end.copy(A)),!0):!1}function T(h,x,v){let A=h.degenerateSegment,w=x.a;return A.closestPointToPoint(w,!0,n),w.distanceToSquared(n)<Ci?(v&&(v.start.copy(w),v.end.copy(w)),!0):!1}function m(h,x,v,A){if(h.isDegenerateIntoSegment)if(x.isDegenerateIntoSegment){let w=h.degenerateSegment,_=x.degenerateSegment,I=i,B=r;w.delta(I),_.delta(B);let P=n.subVectors(_.start,w.start),S=I.x*B.y-I.y*B.x;if(J(S))return!1;let E=(P.x*B.y-P.y*B.x)/S,M=-(I.x*P.y-I.y*P.x)/S;if(E<0||E>1||M<0||M>1)return!1;let D=w.start.z+I.z*E,U=_.start.z+B.z*M;return J(D-U)?(v&&(v.start.copy(w.start).addScaledVector(I,E),v.end.copy(w.start).addScaledVector(I,E)),!0):!1}else return x.isDegenerateIntoPoint?T(h,x,v):g(x,h,v,A);else{if(h.isDegenerateIntoPoint)return x.isDegenerateIntoPoint?x.a.distanceToSquared(h.a)<Ci?(v&&(v.start.copy(h.a),v.end.copy(h.a)),!0):!1:x.isDegenerateIntoSegment?T(x,h,v):b(x,h,v);if(x.isDegenerateIntoPoint)return b(h,x,v);if(x.isDegenerateIntoSegment)return g(h,x,v,A)}}return function(x,v=null,A=!1){this.needsUpdate&&this.update(),x.isExtendedTriangle?x.needsUpdate&&x.update():(o.copy(x),o.update(),x=o);let w=m(this,x,v,A);if(w!==void 0)return w;let _=this.plane,I=x.plane,B=I.distanceToPoint(this.a),P=I.distanceToPoint(this.b),S=I.distanceToPoint(this.c);J(B)&&(B=0),J(P)&&(P=0),J(S)&&(S=0);let E=B*P,M=B*S;if(E>0&&M>0)return!1;let D=_.distanceToPoint(x.a),U=_.distanceToPoint(x.b),be=_.distanceToPoint(x.c);J(D)&&(D=0),J(U)&&(U=0),J(be)&&(be=0);let yi=D*U,xi=D*be;if(yi>0&&xi>0)return!1;i.copy(_.normal),r.copy(I.normal);let un=i.cross(r),fn=0,dn=Math.abs(un.x),gi=Math.abs(un.y);gi>dn&&(dn=gi,fn=1),Math.abs(un.z)>dn&&(fn=2);let Pt=Vs[fn],fs=this.a[Pt],ds=this.b[Pt],ps=this.c[Pt],ms=x.a[Pt],hs=x.b[Pt],ys=x.c[Pt];if(y(this,fs,ds,ps,E,M,B,P,S,f,l))return d(this,x,v,A);if(y(x,ms,hs,ys,yi,xi,D,U,be,a,c))return d(this,x,v,A);if(f.y<f.x){let pn=f.y;f.y=f.x,f.x=pn,u.copy(l.start),l.start.copy(l.end),l.end.copy(u)}if(a.y<a.x){let pn=a.y;a.y=a.x,a.x=pn,u.copy(c.start),c.start.copy(c.end),c.end.copy(u)}return f.y<a.x||a.y<f.x?!1:(v&&(a.x>f.x?v.start.copy(c.start):v.start.copy(l.start),a.y<f.y?v.end.copy(c.end):v.end.copy(l.end)),!0)}})();q.prototype.distanceToPoint=(function(){let o=new nt;return function(e){return this.closestPointToPoint(e,o),e.distanceTo(o)}})();q.prototype.distanceToTriangle=(function(){let o=new nt,t=new nt,e=["a","b","c"],n=new zt,i=new zt;return function(s,l=null,c=null){let u=l||c?n:null;if(this.intersectsTriangle(s,u,!0))return(l||c)&&(l&&u.getCenter(l),c&&u.getCenter(c)),0;let f=1/0;for(let a=0;a<3;a++){let d,p=e[a],y=s[p];this.closestPointToPoint(y,o),d=y.distanceToSquared(o),d<f&&(f=d,l&&l.copy(o),c&&c.copy(y));let g=this[p];s.closestPointToPoint(g,o),d=g.distanceToSquared(o),d<f&&(f=d,l&&l.copy(g),c&&c.copy(o))}for(let a=0;a<3;a++){let d=e[a],p=e[(a+1)%3];n.set(this[d],this[p]);for(let y=0;y<3;y++){let g=e[y],b=e[(y+1)%3];i.set(s[g],s[b]),Qt(n,i,o,t);let T=o.distanceToSquared(t);T<f&&(f=T,l&&l.copy(o),c&&c.copy(t))}}return Math.sqrt(f)}})();var H=class{constructor(t,e,n){this.isOrientedBox=!0,this.min=new xt,this.max=new xt,this.matrix=new Oi,this.invMatrix=new Oi,this.points=new Array(8).fill().map(()=>new xt),this.satAxes=new Array(3).fill().map(()=>new xt),this.satBounds=new Array(3).fill().map(()=>new K),this.alignedSatBounds=new Array(3).fill().map(()=>new K),this.needsUpdate=!1,t&&this.min.copy(t),e&&this.max.copy(e),n&&this.matrix.copy(n)}set(t,e,n){this.min.copy(t),this.max.copy(e),this.matrix.copy(n),this.needsUpdate=!0}copy(t){this.min.copy(t.min),this.max.copy(t.max),this.matrix.copy(t.matrix),this.needsUpdate=!0}};H.prototype.update=(function(){return function(){let t=this.matrix,e=this.min,n=this.max,i=this.points;for(let u=0;u<=1;u++)for(let f=0;f<=1;f++)for(let a=0;a<=1;a++){let d=1*u|2*f|4*a,p=i[d];p.x=u?n.x:e.x,p.y=f?n.y:e.y,p.z=a?n.z:e.z,p.applyMatrix4(t)}let r=this.satBounds,s=this.satAxes,l=i[0];for(let u=0;u<3;u++){let f=s[u],a=r[u],d=1<<u,p=i[d];f.subVectors(l,p),a.setFromPoints(f,i)}let c=this.alignedSatBounds;c[0].setFromPointsField(i,"x"),c[1].setFromPointsField(i,"y"),c[2].setFromPointsField(i,"z"),this.invMatrix.copy(this.matrix).invert(),this.needsUpdate=!1}})();H.prototype.intersectsBox=(function(){let o=new K;return function(e){this.needsUpdate&&this.update();let n=e.min,i=e.max,r=this.satBounds,s=this.satAxes,l=this.alignedSatBounds;if(o.min=n.x,o.max=i.x,l[0].isSeparated(o)||(o.min=n.y,o.max=i.y,l[1].isSeparated(o))||(o.min=n.z,o.max=i.z,l[2].isSeparated(o)))return!1;for(let c=0;c<3;c++){let u=s[c],f=r[c];if(o.setFromBox(u,e),f.isSeparated(o))return!1}return!0}})();H.prototype.intersectsTriangle=(function(){let o=new q,t=new Array(3),e=new K,n=new K,i=new xt;return function(s){this.needsUpdate&&this.update(),s.isExtendedTriangle?s.needsUpdate&&s.update():(o.copy(s),o.update(),s=o);let l=this.satBounds,c=this.satAxes;t[0]=s.a,t[1]=s.b,t[2]=s.c;for(let d=0;d<3;d++){let p=l[d],y=c[d];if(e.setFromPoints(y,t),p.isSeparated(e))return!1}let u=s.satBounds,f=s.satAxes,a=this.points;for(let d=0;d<3;d++){let p=u[d],y=f[d];if(e.setFromPoints(y,a),p.isSeparated(e))return!1}for(let d=0;d<3;d++){let p=c[d];for(let y=0;y<4;y++){let g=f[y];if(i.crossVectors(p,g),e.setFromPoints(i,t),n.setFromPoints(i,a),e.isSeparated(n))return!1}}return!0}})();H.prototype.closestPointToPoint=(function(){return function(t,e){return this.needsUpdate&&this.update(),e.copy(t).applyMatrix4(this.invMatrix).clamp(this.min,this.max).applyMatrix4(this.matrix),e}})();H.prototype.distanceToPoint=(function(){let o=new xt;return function(e){return this.closestPointToPoint(e,o),e.distanceTo(o)}})();H.prototype.distanceToBox=(function(){let o=["x","y","z"],t=new Array(12).fill().map(()=>new Li),e=new Array(12).fill().map(()=>new Li),n=new xt,i=new xt;return function(s,l=0,c=null,u=null){if(this.needsUpdate&&this.update(),this.intersectsBox(s))return(c||u)&&(s.getCenter(i),this.closestPointToPoint(i,n),s.closestPointToPoint(n,i),c&&c.copy(n),u&&u.copy(i)),0;let f=l*l,a=s.min,d=s.max,p=this.points,y=1/0;for(let b=0;b<8;b++){let T=p[b];i.copy(T).clamp(a,d);let m=T.distanceToSquared(i);if(m<y&&(y=m,c&&c.copy(T),u&&u.copy(i),m<f))return Math.sqrt(m)}let g=0;for(let b=0;b<3;b++)for(let T=0;T<=1;T++)for(let m=0;m<=1;m++){let h=(b+1)%3,x=(b+2)%3,v=T<<h|m<<x,A=1<<b|T<<h|m<<x,w=p[v],_=p[A];t[g].set(w,_);let B=o[b],P=o[h],S=o[x],E=e[g],M=E.start,D=E.end;M[B]=a[B],M[P]=T?a[P]:d[P],M[S]=m?a[S]:d[P],D[B]=d[B],D[P]=T?a[P]:d[P],D[S]=m?a[S]:d[P],g++}for(let b=0;b<=1;b++)for(let T=0;T<=1;T++)for(let m=0;m<=1;m++){i.x=b?d.x:a.x,i.y=T?d.y:a.y,i.z=m?d.z:a.z,this.closestPointToPoint(i,n);let h=i.distanceToSquared(n);if(h<y&&(y=h,c&&c.copy(n),u&&u.copy(i),h<f))return Math.sqrt(h)}for(let b=0;b<12;b++){let T=t[b];for(let m=0;m<12;m++){let h=e[m];Qt(T,h,n,i);let x=n.distanceToSquared(i);if(x<y&&(y=x,c&&c.copy(n),u&&u.copy(i),x<f))return Math.sqrt(x)}}return Math.sqrt(y)}})();var In=class extends ${constructor(){super(()=>new q)}},Y=new In;import{Vector3 as zi}from"three";var te=new zi,Pn=new zi;function Vi(o,t,e={},n=0,i=1/0){let r=n*n,s=i*i,l=1/0,c=null;if(o.shapecast({boundsTraverseOrder:f=>(te.copy(t).clamp(f.min,f.max),te.distanceToSquared(t)),intersectsBounds:(f,a,d)=>d<l&&d<s,intersectsTriangle:(f,a)=>{f.closestPointToPoint(t,te);let d=t.distanceToSquared(te);return d<l&&(Pn.copy(te),l=d,c=a),d<r}}),l===1/0)return null;let u=Math.sqrt(l);return e.point?e.point.copy(Pn):e.point=Pn.clone(),e.distance=u,e.faceIndex=c,e}import{Vector3 as rt,Vector2 as ie,Triangle as ee,DoubleSide as Us,BackSide as Hs,REVISION as Xi}from"three";var De=parseInt(Xi)>=169,ks=parseInt(Xi)<=161,bt=new rt,Tt=new rt,wt=new rt,Ne=new ie,Fe=new ie,Re=new ie,Ui=new rt,Hi=new rt,ki=new rt,ne=new rt;function qs(o,t,e,n,i,r,s,l){let c;if(r===Hs?c=o.intersectTriangle(n,e,t,!0,i):c=o.intersectTriangle(t,e,n,r!==Us,i),c===null)return null;let u=o.origin.distanceTo(i);return u<s||u>l?null:{distance:u,point:i.clone()}}function qi(o,t,e,n,i,r,s,l,c,u,f){bt.fromBufferAttribute(t,r),Tt.fromBufferAttribute(t,s),wt.fromBufferAttribute(t,l);let a=qs(o,bt,Tt,wt,ne,c,u,f);if(a){if(n){Ne.fromBufferAttribute(n,r),Fe.fromBufferAttribute(n,s),Re.fromBufferAttribute(n,l),a.uv=new ie;let p=ee.getInterpolation(ne,bt,Tt,wt,Ne,Fe,Re,a.uv);De||(a.uv=p)}if(i){Ne.fromBufferAttribute(i,r),Fe.fromBufferAttribute(i,s),Re.fromBufferAttribute(i,l),a.uv1=new ie;let p=ee.getInterpolation(ne,bt,Tt,wt,Ne,Fe,Re,a.uv1);De||(a.uv1=p),ks&&(a.uv2=a.uv1)}if(e){Ui.fromBufferAttribute(e,r),Hi.fromBufferAttribute(e,s),ki.fromBufferAttribute(e,l),a.normal=new rt;let p=ee.getInterpolation(ne,bt,Tt,wt,Ui,Hi,ki,a.normal);a.normal.dot(o.direction)>0&&a.normal.multiplyScalar(-1),De||(a.normal=p)}let d={a:r,b:s,c:l,normal:new rt,materialIndex:0};if(ee.getNormal(bt,Tt,wt,d.normal),a.face=d,a.faceIndex=r,De){let p=new rt;ee.getBarycoord(ne,bt,Tt,wt,p),a.barycoord=p}}return a}function Wi(o){return o&&o.isMaterial?o.side:o}function Vt(o,t,e,n,i,r,s){let l=n*3,c=l+0,u=l+1,f=l+2,{index:a,groups:d}=o;o.index&&(c=a.getX(c),u=a.getX(u),f=a.getX(f));let{position:p,normal:y,uv:g,uv1:b}=o.attributes;if(Array.isArray(t)){let T=n*3;for(let m=0,h=d.length;m<h;m++){let{start:x,count:v,materialIndex:A}=d[m];if(T>=x&&T<x+v){let w=Wi(t[A]),_=qi(e,p,y,g,b,c,u,f,w,r,s);if(_)if(_.faceIndex=n,_.face.materialIndex=A,i)i.push(_);else return _}}}else{let T=Wi(t),m=qi(e,p,y,g,b,c,u,f,T,r,s);if(m)if(m.faceIndex=n,m.face.materialIndex=0,i)i.push(m);else return m}return null}import{Vector2 as Oe,Vector3 as Ut,Triangle as Ce}from"three";function V(o,t,e,n){let i=o.a,r=o.b,s=o.c,l=t,c=t+1,u=t+2;e&&(l=e.getX(l),c=e.getX(c),u=e.getX(u)),i.x=n.getX(l),i.y=n.getY(l),i.z=n.getZ(l),r.x=n.getX(c),r.y=n.getY(c),r.z=n.getZ(c),s.x=n.getX(u),s.y=n.getY(u),s.z=n.getZ(u)}var oe=new Ut,se=new Ut,re=new Ut,Gi=new Oe,Yi=new Oe,Zi=new Oe;function Ws(o,t,e,n){let i=t.getIndex().array,r=t.getAttribute("position"),s=t.getAttribute("uv"),l=i[e*3],c=i[e*3+1],u=i[e*3+2];oe.fromBufferAttribute(r,l),se.fromBufferAttribute(r,c),re.fromBufferAttribute(r,u);let f=0,a=t.groups,d=e*3;for(let g=0,b=a.length;g<b;g++){let T=a[g],{start:m,count:h}=T;if(d>=m&&d<m+h){f=T.materialIndex;break}}let p=n&&n.barycoord?n.barycoord:new Ut;Ce.getBarycoord(o,oe,se,re,p);let y=null;return s&&(Gi.fromBufferAttribute(s,l),Yi.fromBufferAttribute(s,c),Zi.fromBufferAttribute(s,u),n&&n.uv?y=n.uv:y=new Oe,Ce.getInterpolation(o,oe,se,re,Gi,Yi,Zi,y)),n?(n.face||(n.face={}),n.face.a=l,n.face.b=c,n.face.c=u,n.face.materialIndex=f,n.face.normal||(n.face.normal=new Ut),Ce.getNormal(oe,se,re,n.face.normal),y&&(n.uv=y),n.barycoord=p,n):{face:{a:l,b:c,c:u,materialIndex:f,normal:Ce.getNormal(oe,se,re,new Ut)},uv:y,barycoord:p}}function Ki(o,t,e,n,i,r,s,l){let{geometry:c,_indirectBuffer:u}=o;for(let f=n,a=n+i;f<a;f++)Vt(c,t,e,f,r,s,l)}function $i(o,t,e,n,i,r,s){let{geometry:l,_indirectBuffer:c}=o,u=1/0,f=null;for(let a=n,d=n+i;a<d;a++){let p;p=Vt(l,t,e,a,null,r,s),p&&p.distance<u&&(f=p,u=p.distance)}return f}function Ji(o,t,e,n,i,r,s){let{geometry:l}=e,{index:c}=l,u=l.attributes.position;for(let f=o,a=t+o;f<a;f++){let d;if(d=f,V(s,d*3,c,u),s.needsUpdate=!0,n(s,d,i,r))return!0}return!1}function ji(o,t=null){t&&Array.isArray(t)&&(t=new Set(t));let e=o.geometry,n=e.index?e.index.array:null,i=e.attributes.position,r,s,l,c,u=0,f=o._roots;for(let d=0,p=f.length;d<p;d++)r=f[d],s=new Uint32Array(r),l=new Uint16Array(r),c=new Float32Array(r),a(0,u),u+=r.byteLength;function a(d,p,y=!1){let g=d*2;if(N(g,l)){let b=C(d,s),T=z(g,l),m=1/0,h=1/0,x=1/0,v=-1/0,A=-1/0,w=-1/0;for(let _=3*b,I=3*(b+T);_<I;_++){let B=n[_],P=i.getX(B),S=i.getY(B),E=i.getZ(B);P<m&&(m=P),P>v&&(v=P),S<h&&(h=S),S>A&&(A=S),E<x&&(x=E),E>w&&(w=E)}return c[d+0]!==m||c[d+1]!==h||c[d+2]!==x||c[d+3]!==v||c[d+4]!==A||c[d+5]!==w?(c[d+0]=m,c[d+1]=h,c[d+2]=x,c[d+3]=v,c[d+4]=A,c[d+5]=w,!0):!1}else{let b=O(d),T=L(d,s),m=y,h=!1,x=!1;if(t){if(!m){let B=b/8+p/32,P=T/8+p/32;h=t.has(B),x=t.has(P),m=!h&&!x}}else h=!0,x=!0;let v=m||h,A=m||x,w=!1;v&&(w=a(b,p,m));let _=!1;A&&(_=a(T,p,m));let I=w||_;if(I)for(let B=0;B<3;B++){let P=b+B,S=T+B,E=c[P],M=c[P+3],D=c[S],U=c[S+3];c[d+B]=E<D?E:D,c[d+B+3]=M>U?M:U}return I}}}function j(o,t,e,n,i){let r,s,l,c,u,f,a=1/e.direction.x,d=1/e.direction.y,p=1/e.direction.z,y=e.origin.x,g=e.origin.y,b=e.origin.z,T=t[o],m=t[o+3],h=t[o+1],x=t[o+3+1],v=t[o+2],A=t[o+3+2];return a>=0?(r=(T-y)*a,s=(m-y)*a):(r=(m-y)*a,s=(T-y)*a),d>=0?(l=(h-g)*d,c=(x-g)*d):(l=(x-g)*d,c=(h-g)*d),r>c||l>s||((l>r||isNaN(r))&&(r=l),(c<s||isNaN(s))&&(s=c),p>=0?(u=(v-b)*p,f=(A-b)*p):(u=(A-b)*p,f=(v-b)*p),r>f||u>s)?!1:((u>r||r!==r)&&(r=u),(f<s||s!==s)&&(s=f),r<=i&&s>=n)}function Qi(o,t,e,n,i,r,s,l){let{geometry:c,_indirectBuffer:u}=o;for(let f=n,a=n+i;f<a;f++){let d=u?u[f]:f;Vt(c,t,e,d,r,s,l)}}function to(o,t,e,n,i,r,s){let{geometry:l,_indirectBuffer:c}=o,u=1/0,f=null;for(let a=n,d=n+i;a<d;a++){let p;p=Vt(l,t,e,c?c[a]:a,null,r,s),p&&p.distance<u&&(f=p,u=p.distance)}return f}function eo(o,t,e,n,i,r,s){let{geometry:l}=e,{index:c}=l,u=l.attributes.position;for(let f=o,a=t+o;f<a;f++){let d;if(d=e.resolveTriangleIndex(f),V(s,d*3,c,u),s.needsUpdate=!0,n(s,d,i,r))return!0}return!1}function no(o,t,e,n,i,r,s){R.setBuffer(o._roots[t]),En(0,o,e,n,i,r,s),R.clearBuffer()}function En(o,t,e,n,i,r,s){let{float32Array:l,uint16Array:c,uint32Array:u}=R,f=o*2;if(N(f,c)){let d=C(o,u),p=z(f,c);Ki(t,e,n,d,p,i,r,s)}else{let d=O(o);j(d,l,n,r,s)&&En(d,t,e,n,i,r,s);let p=L(o,u);j(p,l,n,r,s)&&En(p,t,e,n,i,r,s)}}var Xs=["x","y","z"];function io(o,t,e,n,i,r){R.setBuffer(o._roots[t]);let s=Mn(0,o,e,n,i,r);return R.clearBuffer(),s}function Mn(o,t,e,n,i,r){let{float32Array:s,uint16Array:l,uint32Array:c}=R,u=o*2;if(N(u,l)){let a=C(o,c),d=z(u,l);return $i(t,e,n,a,d,i,r)}else{let a=dt(o,c),d=Xs[a],y=n.direction[d]>=0,g,b;y?(g=O(o),b=L(o,c)):(g=L(o,c),b=O(o));let m=j(g,s,n,i,r)?Mn(g,t,e,n,i,r):null;if(m){let v=m.point[d];if(y?v<=s[b+a]:v>=s[b+a+3])return m}let x=j(b,s,n,i,r)?Mn(b,t,e,n,i,r):null;return m&&x?m.distance<=x.distance?m:x:m||x||null}}import{Box3 as Gs,Matrix4 as Ys}from"three";var Le=new Gs,Ht=new q,kt=new q,ce=new Ys,oo=new H,ze=new H;function so(o,t,e,n){R.setBuffer(o._roots[t]);let i=Dn(0,o,e,n);return R.clearBuffer(),i}function Dn(o,t,e,n,i=null){let{float32Array:r,uint16Array:s,uint32Array:l}=R,c=o*2;if(i===null&&(e.boundingBox||e.computeBoundingBox(),oo.set(e.boundingBox.min,e.boundingBox.max,n),i=oo),N(c,s)){let f=t.geometry,a=f.index,d=f.attributes.position,p=e.index,y=e.attributes.position,g=C(o,l),b=z(c,s);if(ce.copy(n).invert(),e.boundsTree)return F(o,r,ze),ze.matrix.copy(ce),ze.needsUpdate=!0,e.boundsTree.shapecast({intersectsBounds:m=>ze.intersectsBox(m),intersectsTriangle:m=>{m.a.applyMatrix4(n),m.b.applyMatrix4(n),m.c.applyMatrix4(n),m.needsUpdate=!0;for(let h=g*3,x=(b+g)*3;h<x;h+=3)if(V(kt,h,a,d),kt.needsUpdate=!0,m.intersectsTriangle(kt))return!0;return!1}});{let T=yt(e);for(let m=g*3,h=(b+g)*3;m<h;m+=3){V(Ht,m,a,d),Ht.a.applyMatrix4(ce),Ht.b.applyMatrix4(ce),Ht.c.applyMatrix4(ce),Ht.needsUpdate=!0;for(let x=0,v=T*3;x<v;x+=3)if(V(kt,x,p,y),kt.needsUpdate=!0,Ht.intersectsTriangle(kt))return!0}}}else{let f=O(o),a=L(o,l);return F(f,r,Le),!!(i.intersectsBox(Le)&&Dn(f,t,e,n,i)||(F(a,r,Le),i.intersectsBox(Le)&&Dn(a,t,e,n,i)))}}import{Matrix4 as Zs,Vector3 as Ue}from"three";var Ve=new Zs,Nn=new H,ae=new H,Ks=new Ue,$s=new Ue,Js=new Ue,js=new Ue;function ro(o,t,e,n={},i={},r=0,s=1/0){t.boundingBox||t.computeBoundingBox(),Nn.set(t.boundingBox.min,t.boundingBox.max,e),Nn.needsUpdate=!0;let l=o.geometry,c=l.attributes.position,u=l.index,f=t.attributes.position,a=t.index,d=Y.getPrimitive(),p=Y.getPrimitive(),y=Ks,g=$s,b=null,T=null;i&&(b=Js,T=js);let m=1/0,h=null,x=null;return Ve.copy(e).invert(),ae.matrix.copy(Ve),o.shapecast({boundsTraverseOrder:v=>Nn.distanceToBox(v),intersectsBounds:(v,A,w)=>w<m&&w<s?(A&&(ae.min.copy(v.min),ae.max.copy(v.max),ae.needsUpdate=!0),!0):!1,intersectsRange:(v,A)=>{if(t.boundsTree)return t.boundsTree.shapecast({boundsTraverseOrder:_=>ae.distanceToBox(_),intersectsBounds:(_,I,B)=>B<m&&B<s,intersectsRange:(_,I)=>{for(let B=_,P=_+I;B<P;B++){V(p,3*B,a,f),p.a.applyMatrix4(e),p.b.applyMatrix4(e),p.c.applyMatrix4(e),p.needsUpdate=!0;for(let S=v,E=v+A;S<E;S++){V(d,3*S,u,c),d.needsUpdate=!0;let M=d.distanceToTriangle(p,y,b);if(M<m&&(g.copy(y),T&&T.copy(b),m=M,h=S,x=B),M<r)return!0}}}});{let w=yt(t);for(let _=0,I=w;_<I;_++){V(p,3*_,a,f),p.a.applyMatrix4(e),p.b.applyMatrix4(e),p.c.applyMatrix4(e),p.needsUpdate=!0;for(let B=v,P=v+A;B<P;B++){V(d,3*B,u,c),d.needsUpdate=!0;let S=d.distanceToTriangle(p,y,b);if(S<m&&(g.copy(y),T&&T.copy(b),m=S,h=B,x=_),S<r)return!0}}}}}),Y.releasePrimitive(d),Y.releasePrimitive(p),m===1/0?null:(n.point?n.point.copy(g):n.point=g.clone(),n.distance=m,n.faceIndex=h,i&&(i.point?i.point.copy(T):i.point=T.clone(),i.point.applyMatrix4(Ve),g.applyMatrix4(Ve),i.distance=g.sub(i.point).length(),i.faceIndex=x),n)}function co(o,t=null){t&&Array.isArray(t)&&(t=new Set(t));let e=o.geometry,n=e.index?e.index.array:null,i=e.attributes.position,r,s,l,c,u=0,f=o._roots;for(let d=0,p=f.length;d<p;d++)r=f[d],s=new Uint32Array(r),l=new Uint16Array(r),c=new Float32Array(r),a(0,u),u+=r.byteLength;function a(d,p,y=!1){let g=d*2;if(N(g,l)){let b=C(d,s),T=z(g,l),m=1/0,h=1/0,x=1/0,v=-1/0,A=-1/0,w=-1/0;for(let _=b,I=b+T;_<I;_++){let B=3*o.resolveTriangleIndex(_);for(let P=0;P<3;P++){let S=B+P;S=n?n[S]:S;let E=i.getX(S),M=i.getY(S),D=i.getZ(S);E<m&&(m=E),E>v&&(v=E),M<h&&(h=M),M>A&&(A=M),D<x&&(x=D),D>w&&(w=D)}}return c[d+0]!==m||c[d+1]!==h||c[d+2]!==x||c[d+3]!==v||c[d+4]!==A||c[d+5]!==w?(c[d+0]=m,c[d+1]=h,c[d+2]=x,c[d+3]=v,c[d+4]=A,c[d+5]=w,!0):!1}else{let b=O(d),T=L(d,s),m=y,h=!1,x=!1;if(t){if(!m){let B=b/8+p/32,P=T/8+p/32;h=t.has(B),x=t.has(P),m=!h&&!x}}else h=!0,x=!0;let v=m||h,A=m||x,w=!1;v&&(w=a(b,p,m));let _=!1;A&&(_=a(T,p,m));let I=w||_;if(I)for(let B=0;B<3;B++){let P=b+B,S=T+B,E=c[P],M=c[P+3],D=c[S],U=c[S+3];c[d+B]=E<D?E:D,c[d+B+3]=M>U?M:U}return I}}}function ao(o,t,e,n,i,r,s){R.setBuffer(o._roots[t]),Fn(0,o,e,n,i,r,s),R.clearBuffer()}function Fn(o,t,e,n,i,r,s){let{float32Array:l,uint16Array:c,uint32Array:u}=R,f=o*2;if(N(f,c)){let d=C(o,u),p=z(f,c);Qi(t,e,n,d,p,i,r,s)}else{let d=O(o);j(d,l,n,r,s)&&Fn(d,t,e,n,i,r,s);let p=L(o,u);j(p,l,n,r,s)&&Fn(p,t,e,n,i,r,s)}}var Qs=["x","y","z"];function lo(o,t,e,n,i,r){R.setBuffer(o._roots[t]);let s=Rn(0,o,e,n,i,r);return R.clearBuffer(),s}function Rn(o,t,e,n,i,r){let{float32Array:s,uint16Array:l,uint32Array:c}=R,u=o*2;if(N(u,l)){let a=C(o,c),d=z(u,l);return to(t,e,n,a,d,i,r)}else{let a=dt(o,c),d=Qs[a],y=n.direction[d]>=0,g,b;y?(g=O(o),b=L(o,c)):(g=L(o,c),b=O(o));let m=j(g,s,n,i,r)?Rn(g,t,e,n,i,r):null;if(m){let v=m.point[d];if(y?v<=s[b+a]:v>=s[b+a+3])return m}let x=j(b,s,n,i,r)?Rn(b,t,e,n,i,r):null;return m&&x?m.distance<=x.distance?m:x:m||x||null}}import{Box3 as tr,Matrix4 as er}from"three";var He=new tr,qt=new q,Wt=new q,le=new er,uo=new H,ke=new H;function fo(o,t,e,n){R.setBuffer(o._roots[t]);let i=Cn(0,o,e,n);return R.clearBuffer(),i}function Cn(o,t,e,n,i=null){let{float32Array:r,uint16Array:s,uint32Array:l}=R,c=o*2;if(i===null&&(e.boundingBox||e.computeBoundingBox(),uo.set(e.boundingBox.min,e.boundingBox.max,n),i=uo),N(c,s)){let f=t.geometry,a=f.index,d=f.attributes.position,p=e.index,y=e.attributes.position,g=C(o,l),b=z(c,s);if(le.copy(n).invert(),e.boundsTree)return F(o,r,ke),ke.matrix.copy(le),ke.needsUpdate=!0,e.boundsTree.shapecast({intersectsBounds:m=>ke.intersectsBox(m),intersectsTriangle:m=>{m.a.applyMatrix4(n),m.b.applyMatrix4(n),m.c.applyMatrix4(n),m.needsUpdate=!0;for(let h=g,x=b+g;h<x;h++)if(V(Wt,3*t.resolveTriangleIndex(h),a,d),Wt.needsUpdate=!0,m.intersectsTriangle(Wt))return!0;return!1}});{let T=yt(e);for(let m=g,h=b+g;m<h;m++){let x=t.resolveTriangleIndex(m);V(qt,3*x,a,d),qt.a.applyMatrix4(le),qt.b.applyMatrix4(le),qt.c.applyMatrix4(le),qt.needsUpdate=!0;for(let v=0,A=T*3;v<A;v+=3)if(V(Wt,v,p,y),Wt.needsUpdate=!0,qt.intersectsTriangle(Wt))return!0}}}else{let f=O(o),a=L(o,l);return F(f,r,He),!!(i.intersectsBox(He)&&Cn(f,t,e,n,i)||(F(a,r,He),i.intersectsBox(He)&&Cn(a,t,e,n,i)))}}import{Matrix4 as nr,Vector3 as We}from"three";var qe=new nr,On=new H,ue=new H,ir=new We,or=new We,sr=new We,rr=new We;function po(o,t,e,n={},i={},r=0,s=1/0){t.boundingBox||t.computeBoundingBox(),On.set(t.boundingBox.min,t.boundingBox.max,e),On.needsUpdate=!0;let l=o.geometry,c=l.attributes.position,u=l.index,f=t.attributes.position,a=t.index,d=Y.getPrimitive(),p=Y.getPrimitive(),y=ir,g=or,b=null,T=null;i&&(b=sr,T=rr);let m=1/0,h=null,x=null;return qe.copy(e).invert(),ue.matrix.copy(qe),o.shapecast({boundsTraverseOrder:v=>On.distanceToBox(v),intersectsBounds:(v,A,w)=>w<m&&w<s?(A&&(ue.min.copy(v.min),ue.max.copy(v.max),ue.needsUpdate=!0),!0):!1,intersectsRange:(v,A)=>{if(t.boundsTree){let w=t.boundsTree;return w.shapecast({boundsTraverseOrder:_=>ue.distanceToBox(_),intersectsBounds:(_,I,B)=>B<m&&B<s,intersectsRange:(_,I)=>{for(let B=_,P=_+I;B<P;B++){let S=w.resolveTriangleIndex(B);V(p,3*S,a,f),p.a.applyMatrix4(e),p.b.applyMatrix4(e),p.c.applyMatrix4(e),p.needsUpdate=!0;for(let E=v,M=v+A;E<M;E++){let D=o.resolveTriangleIndex(E);V(d,3*D,u,c),d.needsUpdate=!0;let U=d.distanceToTriangle(p,y,b);if(U<m&&(g.copy(y),T&&T.copy(b),m=U,h=E,x=B),U<r)return!0}}}})}else{let w=yt(t);for(let _=0,I=w;_<I;_++){V(p,3*_,a,f),p.a.applyMatrix4(e),p.b.applyMatrix4(e),p.c.applyMatrix4(e),p.needsUpdate=!0;for(let B=v,P=v+A;B<P;B++){let S=o.resolveTriangleIndex(B);V(d,3*S,u,c),d.needsUpdate=!0;let E=d.distanceToTriangle(p,y,b);if(E<m&&(g.copy(y),T&&T.copy(b),m=E,h=B,x=_),E<r)return!0}}}}}),Y.releasePrimitive(d),Y.releasePrimitive(p),m===1/0?null:(n.point?n.point.copy(g):n.point=g.clone(),n.distance=m,n.faceIndex=h,i&&(i.point?i.point.copy(T):i.point=T.clone(),i.point.applyMatrix4(qe),g.applyMatrix4(qe),i.distance=g.sub(i.point).length(),i.faceIndex=x),n)}function Ln(o,t,e){return o===null?null:(o.point.applyMatrix4(t.matrixWorld),o.distance=o.point.distanceTo(e.ray.origin),o.object=t,o)}var Xe=new H,Ge=new ar,ho=new go,yo=new lr,xo=new go,zn=["getX","getY","getZ"],gt=class o extends st{static serialize(t,e={}){e={cloneBuffers:!0,...e};let n=t.geometry,i=t._roots,r=t._indirectBuffer,s=n.getIndex(),l={version:1,roots:null,index:null,indirectBuffer:null};return e.cloneBuffers?(l.roots=i.map(c=>c.slice()),l.index=s?s.array.slice():null,l.indirectBuffer=r?r.slice():null):(l.roots=i,l.index=s?s.array:null,l.indirectBuffer=r),l}static deserialize(t,e,n={}){n={setIndex:!0,indirect:!!t.indirectBuffer,...n};let{index:i,roots:r,indirectBuffer:s}=t;t.version||(console.warn("MeshBVH.deserialize: Serialization format has been changed and will be fixed up. It is recommended to regenerate any stored serialized data."),c(r));let l=new o(e,{...n,[ct]:!0});if(l._roots=r,l._indirectBuffer=s||null,n.setIndex){let u=e.getIndex();if(u===null){let f=new cr(t.index,1,!1);e.setIndex(f)}else u.array!==i&&(u.array.set(i),u.needsUpdate=!0)}return l;function c(u){for(let f=0;f<u.length;f++){let a=u[f],d=new Uint32Array(a),p=new Uint16Array(a);for(let y=0,g=a.byteLength/32;y<g;y++){let b=8*y,T=2*b;N(T,p)||(d[b+6]=d[b+6]/8-y)}}}}get primitiveStride(){return 3}get resolveTriangleIndex(){return this.resolvePrimitiveIndex}constructor(t,e={}){e.maxLeafTris&&(console.warn('MeshBVH: "maxLeafTris" option has been deprecated. Use "targetLeafSize", instead.'),e={...e,targetLeafSize:e.maxLeafTris}),super(t,e)}shiftTriangleOffsets(t){return super.shiftPrimitiveOffsets(t)}writePrimitiveBounds(t,e,n){let i=this.geometry,r=this._indirectBuffer,s=i.attributes.position,l=i.index?i.index.array:null,u=(r?r[t]:t)*3,f=u+0,a=u+1,d=u+2;l&&(f=l[f],a=l[a],d=l[d]);for(let p=0;p<3;p++){let y=s[zn[p]](f),g=s[zn[p]](a),b=s[zn[p]](d),T=y;g<T&&(T=g),b<T&&(T=b);let m=y;g>m&&(m=g),b>m&&(m=b),e[n+p]=T,e[n+p+3]=m}return e}computePrimitiveBounds(t,e,n){let i=this.geometry,r=this._indirectBuffer,s=i.attributes.position,l=i.index?i.index.array:null,c=s.normalized;if(t<0||e+t-n.offset>n.length/6)throw new Error("MeshBVH: compute triangle bounds range is invalid.");let u=s.array,f=s.offset||0,a=3;s.isInterleavedBufferAttribute&&(a=s.data.stride);let d=["getX","getY","getZ"],p=n.offset;for(let y=t,g=t+e;y<g;y++){let T=(r?r[y]:y)*3,m=(y-p)*6,h=T+0,x=T+1,v=T+2;l&&(h=l[h],x=l[x],v=l[v]),c||(h=h*a+f,x=x*a+f,v=v*a+f);for(let A=0;A<3;A++){let w,_,I;c?(w=s[d[A]](h),_=s[d[A]](x),I=s[d[A]](v)):(w=u[h+A],_=u[x+A],I=u[v+A]);let B=w;_<B&&(B=_),I<B&&(B=I);let P=w;_>P&&(P=_),I>P&&(P=I);let S=(P-B)/2,E=A*2;n[m+E+0]=B+S,n[m+E+1]=S+(Math.abs(B)+S)*Et}}return n}raycastObject3D(t,e,n=[]){let{material:i}=t;if(i===void 0)return;yo.copy(t.matrixWorld).invert(),Ge.copy(e.ray).applyMatrix4(yo),xo.setFromMatrixScale(t.matrixWorld),ho.copy(Ge.direction).multiply(xo);let r=ho.length(),s=e.near/r,l=e.far/r;if(e.firstHitOnly===!0){let c=this.raycastFirst(Ge,i,s,l);c=Ln(c,t,e),c&&n.push(c)}else{let c=this.raycast(Ge,i,s,l);for(let u=0,f=c.length;u<f;u++){let a=Ln(c[u],t,e);a&&n.push(a)}}return n}refit(t=null){return(this.indirect?co:ji)(this,t)}raycast(t,e=mo,n=0,i=1/0){let r=this._roots,s=[],l=this.indirect?ao:no;for(let c=0,u=r.length;c<u;c++)l(this,c,e,t,s,n,i);return s}raycastFirst(t,e=mo,n=0,i=1/0){let r=this._roots,s=null,l=this.indirect?lo:io;for(let c=0,u=r.length;c<u;c++){let f=l(this,c,e,t,n,i);f!=null&&(s==null||f.distance<s.distance)&&(s=f)}return s}intersectsGeometry(t,e){let n=!1,i=this._roots,r=this.indirect?fo:so;for(let s=0,l=i.length;s<l&&(n=r(this,s,t,e),!n);s++);return n}shapecast(t){let e=Y.getPrimitive(),n=super.shapecast({...t,intersectsPrimitive:t.intersectsTriangle,scratchPrimitive:e,iterate:this.indirect?eo:Ji});return Y.releasePrimitive(e),n}bvhcast(t,e,n){let{intersectsRanges:i,intersectsTriangles:r}=n,s=Y.getPrimitive(),l=this.geometry.index,c=this.geometry.attributes.position,u=this.indirect?y=>{let g=this.resolveTriangleIndex(y);V(s,g*3,l,c)}:y=>{V(s,y*3,l,c)},f=Y.getPrimitive(),a=t.geometry.index,d=t.geometry.attributes.position,p=t.indirect?y=>{let g=t.resolveTriangleIndex(y);V(f,g*3,a,d)}:y=>{V(f,y*3,a,d)};if(r){if(!(t instanceof o))throw new Error('MeshBVH: "intersectsTriangles" callback can only be used with another MeshBVH.');let y=(g,b,T,m,h,x,v,A)=>{for(let w=T,_=T+m;w<_;w++){p(w),f.a.applyMatrix4(e),f.b.applyMatrix4(e),f.c.applyMatrix4(e),f.needsUpdate=!0;for(let I=g,B=g+b;I<B;I++)if(u(I),s.needsUpdate=!0,r(s,f,I,w,h,x,v,A))return!0}return!1};if(i){let g=i;i=function(b,T,m,h,x,v,A,w){return g(b,T,m,h,x,v,A,w)?!0:y(b,T,m,h,x,v,A,w)}}else i=y}return super.bvhcast(t,e,{intersectsRanges:i})}intersectsBox(t,e){return Xe.set(t.min,t.max,e),Xe.needsUpdate=!0,this.shapecast({intersectsBounds:n=>Xe.intersectsBox(n),intersectsTriangle:n=>Xe.intersectsTriangle(n)})}intersectsSphere(t){return this.shapecast({intersectsBounds:e=>t.intersectsBox(e),intersectsTriangle:e=>e.intersectsSphere(t)})}closestPointToGeometry(t,e,n={},i={},r=0,s=1/0){return(this.indirect?po:ro)(this,t,e,n,i,r,s)}closestPointToPoint(t,e={},n=0,i=1/0){return Vi(this,t,e,n,i)}};import{Matrix4 as ur,Line3 as fr,Vector3 as qn,Ray as dr,Box3 as pr}from"three";var vo=new ur,Xt=new dr,bo=new $(()=>new fr),Vn=new qn,To=new qn,Ye=new pr,Un=new qn,wo=["getX","getY","getZ"],Hn=class extends st{get primitiveStride(){return 2}writePrimitiveBounds(t,e,n){let i=this._indirectBuffer,{geometry:r,primitiveStride:s}=this,l=r.attributes.position,c=r.index,u=c?c.count:l.count,a=(i?i[t]:t)*s,d=(a+1)%u;c&&(a=c.getX(a),d=c.getX(d));for(let p=0;p<3;p++){let y=l[wo[p]](a),g=l[wo[p]](d),b=y<g?y:g,T=y>g?y:g;e[n+p]=b,e[n+p+3]=T}return e}shapecast(t){let e=bo.getPrimitive(),n=super.shapecast({...t,intersectsPrimitive:t.intersectsLine,scratchPrimitive:e,iterate:mr});return bo.releasePrimitive(e),n}raycastObject3D(t,e,n=[]){let{matrixWorld:i}=t,{firstHitOnly:r}=e;vo.copy(i).invert(),Xt.copy(e.ray).applyMatrix4(vo);let l=e.params.Line.threshold/((t.scale.x+t.scale.y+t.scale.z)/3),c=l*l,u=null,f=1/0;return this.shapecast({boundsTraverseOrder:a=>a.distanceToPoint(Xt.origin),intersectsBounds:a=>{if(Ye.copy(a).expandByScalar(l),r){if(!Xt.intersectBox(Ye,Un))return 0;let d;return Ye.containsPoint(Xt.origin)?d=0:(Un.applyMatrix4(i),d=e.ray.origin.distanceTo(Un)),d<f?1:0}else return Xt.intersectsBox(Ye)?1:0},intersectsLine:(a,d)=>{if(Xt.distanceSqToSegment(a.start,a.end,Vn,To)>c)return;Vn.applyMatrix4(t.matrixWorld);let y=e.ray.origin.distanceTo(Vn);y<e.near||y>e.far||r&&y>=f||(f=y,d=this.resolvePrimitiveIndex(d),u={distance:y,point:To.clone().applyMatrix4(i),index:d*this.primitiveStride,face:null,faceIndex:null,barycoord:null,object:t},r||n.push(u))}}),r&&u&&n.push(u),n}},kn=class extends Hn{get primitiveStride(){return 1}constructor(t,e={}){e={...e,indirect:!0},super(t,e)}},Ao=class extends kn{getRootRanges(...t){let e=super.getRootRanges(...t);return e.forEach(n=>n.count--),e}};function mr(o,t,e,n,i,r,s){let{geometry:l,primitiveStride:c}=e,{index:u}=l,f=l.attributes.position,a=u?u.count:f.count;for(let d=o,p=t+o;d<p;d++){let g=e.resolvePrimitiveIndex(d)*c,b=(g+1)%a;if(u&&(g=u.getX(g),b=u.getX(b)),s.start.fromBufferAttribute(f,g),s.end.fromBufferAttribute(f,b),n(s,d,i,r))return!0}return!1}import{Vector3 as Xn,Matrix4 as hr,Ray as yr,Box3 as xr}from"three";var Bo=new hr,At=new yr,_o=new $(()=>new Xn),Ze=new xr,Wn=new Xn,So=class extends st{get primitiveStride(){return 1}writePrimitiveBounds(t,e,n){let i=this._indirectBuffer,{geometry:r}=this,s=r.attributes.position,l=r.index,c=i?i[t]:t;l&&(c=l.getX(c));let u=s.getX(c),f=s.getY(c),a=s.getZ(c);return e[n+0]=u,e[n+1]=f,e[n+2]=a,e[n+3]=u,e[n+4]=f,e[n+5]=a,e}shapecast(t){let e=_o.getPrimitive(),n=super.shapecast({...t,intersectsPrimitive:t.intersectsPoint,scratchPrimitive:e,iterate:gr});return _o.releasePrimitive(e),n}raycastObject3D(t,e,n=[]){let{geometry:i}=this,{matrixWorld:r}=t,{firstHitOnly:s}=e;Bo.copy(r).invert(),At.copy(e.ray).applyMatrix4(Bo);let c=e.params.Points.threshold/((t.scale.x+t.scale.y+t.scale.z)/3),u=c*c,f=null,a=1/0;return this.shapecast({boundsTraverseOrder:d=>d.distanceToPoint(At.origin),intersectsBounds:d=>{if(Ze.copy(d).expandByScalar(c),s){if(!At.intersectBox(Ze,Wn))return 0;let p;return Ze.containsPoint(At.origin)?p=0:(Wn.applyMatrix4(r),p=e.ray.origin.distanceTo(Wn)),p<a?1:0}else return At.intersectsBox(Ze)?1:0},intersectsPoint:(d,p)=>{let y=At.distanceSqToPoint(d);if(y<u){let g=new Xn;At.closestPointToPoint(d,g),g.applyMatrix4(r);let b=e.ray.origin.distanceTo(g);if(b<e.near||b>e.far||s&&b>=a)return;a=b,p=this.resolvePrimitiveIndex(p),f={distance:b,distanceToRay:Math.sqrt(y),point:g,index:i.index?i.index.getX(p):p,face:null,faceIndex:null,barycoord:null,object:t},s||n.push(f)}}}),s&&f&&n.push(f),n}};function gr(o,t,e,n,i,r,s){let{geometry:l}=e,{index:c}=l,u=l.attributes.position;for(let f=o,a=t+o;f<a;f++){let d=e.resolvePrimitiveIndex(f),p=c?c.array[d]:d;if(s.fromBufferAttribute(u,p),n(s,f,i,r))return!0}return!1}import{Box3 as vr,BufferGeometry as br,Matrix4 as Kn,Mesh as Tr,Vector3 as wr,Ray as Ar,Sphere as Br}from"three";var Q=new br,X=new Kn,fe=new Kn,Io=new vr,Gt=new Br,ut=new wr,de=new Ar,tt=new Tr,Po={},Eo=class extends Lt{constructor(t,e={}){e={precise:!1,includeInstances:!0,matrixWorld:Array.isArray(t)?new Kn:t.matrixWorld,targetLeafSize:1,...e},super();let n=new Set;Do(t,n);let i=Array.from(n),r=Math.ceil(Math.log2(i.length)),s=(1<<r)-1;this.objects=i,this.idBits=r,this.idMask=s,this.primitiveBuffer=null,this.primitiveBufferStride=1,this.precise=e.precise,this.includeInstances=e.includeInstances,this.matrixWorld=e.matrixWorld,this.init(e)}getObjectFromId(t){let{idMask:e,objects:n}=this,i=Yn(t,e);return n[i]}getInstanceFromId(t){let{idMask:e,idBits:n}=this;return Zn(t,n,e)}init(t){let{objects:e,idBits:n,matrixWorld:i}=this;fe.copy(i).invert(),this.primitiveBuffer=new Uint32Array(this._countPrimitives(e)),this._fillPrimitiveBuffer(e,n,this.primitiveBuffer),super.init(t)}refit(...t){fe.copy(this.matrixWorld).invert(),super.refit(...t)}writePrimitiveBounds(t,e,n){let{primitiveBuffer:i}=this;this._getPrimitiveBoundingBox(i[t],fe,Io);let{min:r,max:s}=Io;e[n+0]=r.x,e[n+1]=r.y,e[n+2]=r.z,e[n+3]=s.x,e[n+4]=s.y,e[n+5]=s.z}getRootRanges(){return[{offset:0,count:this.primitiveBuffer.length}]}shapecast(t){return super.shapecast({...t,intersectsPrimitive:t.intersectsObject,scratchPrimitive:null,iterate:_r})}raycast(t,e=[]){let{matrixWorld:n,includeInstances:i}=this,{firstHitOnly:r}=t,s=[];fe.copy(n).invert(),de.copy(t.ray).applyMatrix4(fe);let l=1/0,c=null;return this.shapecast({boundsTraverseOrder:u=>u.distanceToPoint(de.origin),intersectsBounds:u=>{if(r){if(!de.intersectBox(u,ut))return 0;let f;return u.containsPoint(de.origin)?f=0:(ut.applyMatrix4(n),f=t.ray.origin.distanceTo(ut)),f<l?1:0}else return de.intersectsBox(u)?1:0},intersectsObject(u,f){if(u.visible){if(s.length=0,u.isInstancedMesh&&i)tt.geometry=u.geometry,tt.material=u.material,u.getMatrixAt(f,tt.matrixWorld),tt.matrixWorld.premultiply(u.matrixWorld),tt.raycast(t,s),s.forEach(a=>{a.object=u,a.instanceId=f}),tt.material=null;else if(u.isBatchedMesh&&i){if(!u.getVisibleAt(f))return;let a=u.getGeometryIdAt(f),d=u.getGeometryRangeAt(a,Po);Q.index=u.geometry.index,Q.attributes=u.geometry.attributes,Q.setDrawRange(d.start,d.count),tt.geometry=Q,tt.material=u.material,u.getMatrixAt(f,tt.matrixWorld),tt.matrixWorld.premultiply(u.matrixWorld),tt.raycast(t,s),s.forEach(p=>{p.object=u,p.batchId=f}),tt.material=null,Q.index=null,Q.attributes=null,Q.setDrawRange(0,1/0)}else u.raycast(t,s);r?s.forEach(a=>{a.distance<l&&(l=a.distance,c=a)}):e.push(...s)}}}),r&&c&&e.push(c),e}_getPrimitiveBoundingBox(t,e,n){let{objects:i,idMask:r,idBits:s,precise:l,includeInstances:c}=this,u=Yn(t,r),f=Zn(t,s,r),a=i[u];if(!c&&(a.isInstancedMesh||a.isBatchedMesh))a.boundingBox||a.computeBoundingBox(),a.boundingSphere||a.computeBoundingSphere(),X.copy(a.matrixWorld).premultiply(e),Gt.copy(a.boundingSphere).applyMatrix4(X),n.copy(a.boundingBox).applyMatrix4(X),Gn(n,Gt);else if(l)if(a.isInstancedMesh)a.getMatrixAt(f,X),X.premultiply(a.matrixWorld).premultiply(e),Mo(a.geometry,X,n);else if(a.isBatchedMesh){let d=a.getGeometryIdAt(f),p=a.getGeometryRangeAt(d,Po);Q.index=a.geometry.index,Q.attributes=a.geometry.attributes,Q.setDrawRange(p.start,p.count),a.getMatrixAt(f,X),X.premultiply(a.matrixWorld).premultiply(e),Mo(Q,X,n),Q.attributes=null}else X.copy(a.matrixWorld).premultiply(e),n.setFromObject(a,!0).applyMatrix4(e);else if(a.isInstancedMesh)a.geometry.boundingBox||a.geometry.computeBoundingBox(),a.geometry.boundingSphere||a.geometry.computeBoundingSphere(),a.getMatrixAt(f,X),X.premultiply(a.matrixWorld).premultiply(e),Gt.copy(a.geometry.boundingSphere).applyMatrix4(X),n.copy(a.geometry.boundingBox).applyMatrix4(X),Gn(n,Gt);else if(a.isBatchedMesh){let d=a.getGeometryIdAt(f);a.getMatrixAt(f,X),X.premultiply(a.matrixWorld).premultiply(e),a.getBoundingSphereAt(d,Gt).applyMatrix4(X),a.getBoundingBoxAt(d,n).applyMatrix4(X),Gn(n,Gt)}else n.setFromObject(a,!1).applyMatrix4(e)}_countPrimitives(t){let{includeInstances:e}=this,n=0;return t.forEach(i=>{if(i.isInstancedMesh&&e)n+=i.count;else if(i.isBatchedMesh&&e){if(!("instanceCount"in i))throw new Error("ObjectBVH: Three.js revision >= r169 is required to use BatchedMesh.");n+=i.instanceCount}else n++}),n}_fillPrimitiveBuffer(t,e,n){let{includeInstances:i}=this,r=0;t.forEach((s,l)=>{if(s.isInstancedMesh&&i){let c=s.count;for(let u=0;u<c;u++)n[r]=u<<e|l,r++}else if(s.isBatchedMesh&&i){let{instanceCount:c,maxInstanceCount:u}=s,f=0,a=0;for(;f<c&&a<u;){try{s.getVisibleAt(a),n[r]=a<<e|l,f++,r++}catch{}a++}}else n[r]=l,r++})}};function Yn(o,t){return o&t}function Zn(o,t,e){return(o&~e)>>>t}function Do(o,t=new Set){Array.isArray(o)?o.forEach(e=>Do(e,t)):o.traverse(e=>{(e.isMesh||e.isLine||e.isPoints)&&t.add(e)})}function Mo(o,t,e){e.makeEmpty();let n=o.drawRange,i=o.index,r=o.attributes.position,s=n.start,l=i?i.count:r.count,c=Math.min(l-s,n.count);for(let u=s,f=s+c;u<f;u++){let a=u;i&&(a=i.getX(a)),ut.fromBufferAttribute(r,a).applyMatrix4(t),e.expandByPoint(ut)}return e}function _r(o,t,e,n,i,r){let{primitiveBuffer:s,objects:l,idMask:c,idBits:u}=e;for(let f=o,a=t+o;f<a;f++){let d=s[f],p=Yn(d,c),y=Zn(d,u,c),g=l[p];if(n(g,y,i,r))return!0}return!1}function Gn(o,t){ut.copy(t.center).addScalar(-t.radius),o.min.max(ut),ut.copy(t.center).addScalar(t.radius),o.max.min(ut)}import{Vector3 as it,Vector2 as me,Ray as Sr,Matrix4 as Ir,FrontSide as Pr,BackSide as Er,Triangle as pe,REVISION as Uo}from"three";var No=new it,Fo=new it,Ro=new it,ft=new Sr,Co=new Ir,Bt=new it,$n=new it,Mr=["x","y","z"],Ke=parseInt(Uo)>=169,Dr=parseInt(Uo)<=161,$e=new me,Je=new me,je=new me,Oo=new it,Lo=new it,zo=new it,Vo=class extends st{get primitiveStride(){return 3}constructor(t,e={}){if(!t.isMesh)throw new Error("SkinnedMeshBVH: First argument must be a Mesh.");super(t.geometry,{...e,[ct]:!0}),this.mesh=t,e[ct]||this.init(e)}writePrimitiveBounds(t,e,n){let{mesh:i,geometry:r}=this,s=this._indirectBuffer,l=r.index?r.index.array:null,u=(s?s[t]:t)*3,f=u+0,a=u+1,d=u+2;l&&(f=l[f],a=l[a],d=l[d]),i.getVertexPosition(f,No),i.getVertexPosition(a,Fo),i.getVertexPosition(d,Ro);for(let p=0;p<3;p++){let y=Mr[p],g=No[y],b=Fo[y],T=Ro[y],m=g;b<m&&(m=b),T<m&&(m=T);let h=g;b>h&&(h=b),T>h&&(h=T),e[n+p]=m,e[n+p+3]=h}return e}shapecast(t){let e=new q;return super.shapecast({...t,intersectsPrimitive:t.intersectsTriangle,scratchPrimitive:e,iterate:Nr})}raycastObject3D(t,e,n=[]){let{material:i}=t;if(i===void 0)return;let{matrixWorld:r}=t,{firstHitOnly:s}=e;Co.copy(r).invert(),ft.copy(e.ray).applyMatrix4(Co);let l=null,c=1/0;return this.shapecast({boundsTraverseOrder:u=>u.distanceToPoint(ft.origin),intersectsBounds:u=>{if(s){if(!ft.intersectBox(u,$n))return 0;let f;return u.containsPoint(ft.origin)?f=0:($n.applyMatrix4(r),f=e.ray.origin.distanceTo($n)),f<c?1:0}else return ft.intersectsBox(u)?1:0},intersectsTriangle:(u,f)=>{let a=null;if(i.side===Pr?a=ft.intersectTriangle(u.a,u.b,u.c,!0,Bt):i.side===Er?a=ft.intersectTriangle(u.c,u.b,u.a,!0,Bt):a=ft.intersectTriangle(u.a,u.b,u.c,!1,Bt),!a)return;a=a.clone().applyMatrix4(r);let d=e.ray.origin.distanceTo(a);if(d>=e.near&&d<=e.far){if(s&&d>=c)return;let{geometry:p}=this,{index:y}=p,g=this.resolvePrimitiveIndex(f),b=g*3,T=b+0,m=b+1,h=b+2;y&&(T=y.array[T],m=y.array[m],h=y.array[h]);let x={distance:d,point:a.clone(),object:t,uv:null,uv1:null,normal:null,face:{a:T,b:m,c:h,normal:pe.getNormal(u.a,u.b,u.c,new it),materialIndex:0},faceIndex:g};if(Ke){let _=new it;pe.getBarycoord(Bt,u.a,u.b,u.c,_),x.barycoord=_}let v=p.attributes.uv,A=p.attributes.uv1,w=p.attributes.normal;if(v){$e.fromBufferAttribute(v,T),Je.fromBufferAttribute(v,m),je.fromBufferAttribute(v,h),x.uv=new me;let _=pe.getInterpolation(Bt,u.a,u.b,u.c,$e,Je,je,x.uv);Ke||(x.uv=_)}if(A){$e.fromBufferAttribute(A,T),Je.fromBufferAttribute(A,m),je.fromBufferAttribute(A,h),x.uv1=new me;let _=pe.getInterpolation(Bt,u.a,u.b,u.c,$e,Je,je,x.uv1);Ke||(x.uv1=_),Dr&&(x.uv2=x.uv1)}if(w){Oo.fromBufferAttribute(w,T),Lo.fromBufferAttribute(w,m),zo.fromBufferAttribute(w,h),x.normal=new it;let _=pe.getInterpolation(Bt,u.a,u.b,u.c,Oo,Lo,zo,x.normal);x.normal.dot(ft.direction)>0&&x.normal.multiplyScalar(-1),Ke||(x.normal=_)}c=x.distance,l=x,s||n.push(x)}}}),s&&l&&n.push(l),n}};function Nr(o,t,e,n,i,r,s){let{mesh:l,geometry:c}=e,u=c.index?c.index.array:null;for(let f=o,a=t+o;f<a;f++){let d=e.resolvePrimitiveIndex(f),p=3*d+0,y=3*d+1,g=3*d+2;if(u&&(p=u[p],y=u[y],g=u[g]),l.getVertexPosition(p,s.a),l.getVertexPosition(y,s.b),l.getVertexPosition(g,s.c),s.needsUpdate=!0,n(s,f,i,r))return!0}return!1}import{LineBasicMaterial as Fr,BufferAttribute as Ho,Box3 as Rr,Group as Cr,MeshBasicMaterial as Or,Object3D as Lr,BufferGeometry as ko,Mesh as zr,Matrix4 as Vr,Vector3 as Ur}from"three";var qo=new Rr,Wo=new Vr,Jn=new Ur,jn=class extends Lr{get isMesh(){return!this.displayEdges}get isLineSegments(){return this.displayEdges}get isLine(){return this.displayEdges}getVertexPosition(...t){return zr.prototype.getVertexPosition.call(this,...t)}constructor(t,e,n=10,i=0){super(),this.material=e,this.geometry=new ko,this.name="BVHRootHelper",this.depth=n,this.displayParents=!1,this.bvh=t,this.displayEdges=!0,this._group=i}raycast(){}intersectsFrustum(t){return t.intersectsObject(this)}update(){let t=this.bvh;this.geometry.dispose(),this.visible=!1,t&&(this.geometry=this.getGeometry(t),this.visible=!0)}getGeometry(t){let e=this._group,n=null;if(e!==-1)n=this.getBVHBoundPositions(t,e);else{let s=t._roots.map((u,f)=>this.getBVHBoundPositions(t,f)),l=s.reduce((u,f)=>u+f.length,0);n=new Float32Array(l);let c=0;s.forEach(u=>{n.set(u,c),c+=u.length})}let i=this.getBVHBoundIndices(n),r=new ko;return r.setIndex(new Ho(i,1,!1)),r.setAttribute("position",new Ho(n,3,!1)),r}getBVHBoundIndices(t){let e=t.length/24,n,i;this.displayEdges?i=new Uint8Array([0,4,1,5,2,6,3,7,0,2,1,3,4,6,5,7,0,1,2,3,4,5,6,7]):i=new Uint8Array([0,1,2,2,1,3,4,6,5,6,7,5,1,4,5,0,4,1,2,3,6,3,7,6,0,2,4,2,6,4,1,5,3,3,5,7]),t.length>65535?n=new Uint32Array(i.length*e):n=new Uint16Array(i.length*e);let r=i.length;for(let s=0;s<e;s++){let l=s*8,c=s*r;for(let u=0;u<r;u++)n[c+u]=l+i[u]}return n}getBVHBoundPositions(t,e=0,n=null){let i=this.depth-1,r=this.displayParents,s=0;t.traverse((u,f)=>{if(u>=i||f)return s++,!0;r&&s++},e);let l=0,c=new Float32Array(24*s);return t.traverse((u,f,a)=>{let d=u>=i||f;if(d||r){F(0,a,qo);let{min:p,max:y}=qo;for(let g=-1;g<=1;g+=2){let b=g<0?p.x:y.x;for(let T=-1;T<=1;T+=2){let m=T<0?p.y:y.y;for(let h=-1;h<=1;h+=2){let x=h<0?p.z:y.z;Jn.set(b,m,x),n&&Jn.applyMatrix4(n),Jn.toArray(c,l),l+=3}}}return d}},e),c}},Qn=class o extends Cr{get color(){return this.edgeMaterial.color}get opacity(){return this.edgeMaterial.opacity}set opacity(t){this.edgeMaterial.opacity=t,this.meshMaterial.opacity=t}get objectIndex(){return console.warn('BVHHelper: "objectIndex" has been renamed "instanceId".'),this.instanceId}set objectIndex(t){console.warn('BVHHelper: "objectIndex" has been renamed "instanceId".'),this.instanceId=t}constructor(t=null,e=null,n=10){t instanceof gt&&(n=e||10,e=t,t=null),typeof e=="number"&&(n=e,e=null),super(),this.name="BVHHelper",this.depth=n,this.mesh=t,this.bvh=e,this.displayParents=!1,this.displayEdges=!0,this.instanceId=0,this._roots=[];let i=new Fr({color:65416,transparent:!0,opacity:.3,depthWrite:!1}),r=new Or({color:65416,transparent:!0,opacity:.3,depthWrite:!1});r.color=i.color,this.edgeMaterial=i,this.meshMaterial=r,this.update()}update(){let t=this.mesh,e=this.instanceId,n=this.bvh||t.boundsTree||t.geometry&&t.geometry.boundsTree||null;if(t&&t.isBatchedMesh&&t.boundsTrees&&!n&&e>=0){let r=t._drawInfo[e];r&&(n=t.boundsTrees[r.geometryIndex]||n)}let i=n?n._roots.length:0;for(;this._roots.length>i;){let r=this._roots.pop();r.geometry.dispose(),this.remove(r)}for(let r=0;r<i;r++){let{depth:s,edgeMaterial:l,meshMaterial:c,displayParents:u,displayEdges:f}=this;if(r>=this._roots.length){let d=new jn(n,l,s,r);this.add(d),this._roots.push(d)}let a=this._roots[r];a.bvh=n,a.depth=s,a.displayParents=u,a.displayEdges=f,a.material=f?l:c,a.update()}}updateMatrixWorld(...t){let e=this.mesh,n=this.parent,i=this.instanceId;e!==null&&(e.updateWorldMatrix(!0,!1),n?this.matrix.copy(n.matrixWorld).invert().multiply(e.matrixWorld):this.matrix.copy(e.matrixWorld),(e.isInstancedMesh||e.isBatchedMesh)&&i>=0&&(e.getMatrixAt(i,Wo),this.matrix.multiply(Wo)),this.matrix.decompose(this.position,this.quaternion,this.scale)),super.updateMatrixWorld(...t)}copy(t){this.depth=t.depth,this.mesh=t.mesh,this.bvh=t.bvh,this.opacity=t.opacity,this.color.copy(t.color)}clone(){return new o().copy(this)}dispose(){this.edgeMaterial.dispose(),this.meshMaterial.dispose();let t=this.children;for(let e=0,n=t.length;e<n;e++)t[e].geometry.dispose()}},Xo=class extends Qn{constructor(...t){console.warn("MeshBVHHelper: Class has been deprecated. Use BVHHelper instead."),super(...t)}};import{Box3 as ei}from"three";var ti=new ei,he=new ei;function Go(o){switch(typeof o){case"number":return 8;case"string":return o.length*2;case"boolean":return 4;default:return 0}}function Hr(o){return/(Uint|Int|Float)(8|16|32)Array/.test(o.constructor.name)}function kr(o,t){let e={nodeCount:0,leafNodeCount:0,depth:{min:1/0,max:-1/0},primitives:{min:1/0,max:-1/0},splits:[0,0,0],surfaceAreaScore:0};return o.traverse((n,i,r,s,l)=>{let c=r[3]-r[0],u=r[4]-r[1],f=r[5]-r[2],a=2*(c*u+u*f+f*c);e.nodeCount++,i?(e.leafNodeCount++,e.depth.min=Math.min(n,e.depth.min),e.depth.max=Math.max(n,e.depth.max),e.primitives.min=Math.min(l,e.primitives.min),e.primitives.max=Math.max(l,e.primitives.max),e.surfaceAreaScore+=a*1.25*l):(e.splits[s]++,e.surfaceAreaScore+=a*1)},t),e.primitives.min===1/0&&(e.primitives.min=0,e.primitives.max=0),e.depth.min===1/0&&(e.depth.min=0,e.depth.max=0),e}function qr(o){return o._roots.map((t,e)=>kr(o,e))}function Wr(o){let t=new Set,e=[o],n=0;for(;e.length;){let i=e.pop();if(!t.has(i)){t.add(i);for(let r in i){if(!Object.hasOwn(i,r))continue;n+=Go(r);let s=i[r];s&&(typeof s=="object"||typeof s=="function")?Hr(s)||Me()&&s instanceof SharedArrayBuffer||s instanceof ArrayBuffer?n+=s.byteLength:e.push(s):n+=Go(s)}}}return n}function Xr(o){let t=[],e=new Float32Array(6),n=!0;return o.traverse((i,r,s,l,c)=>{let u={depth:i,isLeaf:r,boundingData:s,offset:l,count:c};t[i]=u,F(0,s,ti);let f=t[i-1];if(r){o.writePrimitiveRangeBounds(l,c,e,0),he.min.set(e[0],e[1],e[2]),he.max.set(e[3],e[4],e[5]);let a=ti.containsBox(he);console.assert(a,"Leaf bounds does not fully contain primitives."),n=n&&a}if(f){F(0,f.boundingData,he);let a=he.containsBox(ti);console.assert(a,"Parent bounds does not fully contain child."),n=n&&a}}),n}function Gr(o){let t=[];return o.traverse((e,n,i,r,s)=>{let l={bounds:F(0,i,new ei)};n?(l.count=s,l.offset=r):(l.left=null,l.right=null),t[e]=l;let c=t[e-1];c&&(c.left===null?c.left=l:c.right=l)}),t[0]}import{Mesh as ni,Points as Yo,Line as Zo,LineLoop as Ko,LineSegments as $o,Sphere as Yr,BatchedMesh as Zr,REVISION as Kr}from"three";var $r=parseInt(Kr)>=166,Yt={Mesh:ni.prototype.raycast,Line:Zo.prototype.raycast,LineSegments:$o.prototype.raycast,LineLoop:Ko.prototype.raycast,Points:Yo.prototype.raycast,BatchedMesh:Zr.prototype.raycast},G=new ni,Qe=[];function ku(o,t){if(this.isBatchedMesh)Jr.call(this,o,t);else{let{geometry:e}=this;if(e.boundsTree)e.boundsTree.raycastObject3D(this,o,t);else{let n;if(this instanceof ni)n=Yt.Mesh;else if(this instanceof $o)n=Yt.LineSegments;else if(this instanceof Ko)n=Yt.LineLoop;else if(this instanceof Zo)n=Yt.Line;else if(this instanceof Yo)n=Yt.Points;else throw new Error("BVH: Fallback raycast function not found.");n.call(this,o,t)}}}function Jr(o,t){if(this.boundsTrees){let e=this.boundsTrees,n=this._drawInfo||this._instanceInfo,i=this._drawRanges||this._geometryInfo,r=this.matrixWorld;G.material=this.material,G.geometry=this.geometry;let s=G.geometry.boundsTree,l=G.geometry.drawRange;G.geometry.boundingSphere===null&&(G.geometry.boundingSphere=new Yr);for(let c=0,u=n.length;c<u;c++){if(!this.getVisibleAt(c))continue;let f=n[c].geometryIndex;if(G.geometry.boundsTree=e[f],this.getMatrixAt(c,G.matrixWorld).premultiply(r),!G.geometry.boundsTree){this.getBoundingBoxAt(f,G.geometry.boundingBox),this.getBoundingSphereAt(f,G.geometry.boundingSphere);let a=i[f];G.geometry.setDrawRange(a.start,a.count)}G.raycast(o,Qe);for(let a=0,d=Qe.length;a<d;a++){let p=Qe[a];p.object=this,p.batchId=c,t.push(p)}Qe.length=0}G.geometry.boundsTree=s,G.geometry.drawRange=l,G.material=null,G.geometry=null}else Yt.BatchedMesh.call(this,o,t)}function qu(o={}){let{type:t=gt}=o;return this.boundsTree=new t(this,o),this.boundsTree}function Wu(){this.boundsTree=null}function Xu(o=-1,t={}){if(!$r)throw new Error("BatchedMesh: Three r166+ is required to compute bounds trees.");t={...t,range:null};let e=this._drawRanges||this._geometryInfo,n=this._geometryCount;this.boundsTrees||(this.boundsTrees=new Array(n).fill(null));let i=this.boundsTrees;for(;i.length<n;)i.push(null);if(o<0){for(let r=0;r<n;r++)t.range=e[r],i[r]=new gt(this.geometry,t);return i}else return o<e.length&&(t.range=e[o],i[o]=new gt(this.geometry,t)),i[o]||null}function Gu(o=-1){o<0?this.boundsTrees.fill(null):o<this.boundsTrees.length&&(this.boundsTrees[o]=null)}import{DataTexture as ns,FloatType as cc,UnsignedIntType as ac,RGBAFormat as lc,RGIntegerFormat as uc,NearestFilter as rn,BufferAttribute as fc}from"three";import{DataTexture as jr,FloatType as tn,IntType as en,UnsignedIntType as nn,ByteType as Jo,UnsignedByteType as jo,ShortType as Qr,UnsignedShortType as tc,RedFormat as ec,RGFormat as nc,RGBAFormat as ii,RedIntegerFormat as ic,RGIntegerFormat as oc,RGBAIntegerFormat as oi,NearestFilter as Qo}from"three";function sc(o){switch(o){case 1:return"R";case 2:return"RG";case 3:return"RGBA";case 4:return"RGBA"}throw new Error}function rc(o){switch(o){case 1:return ec;case 2:return nc;case 3:return ii;case 4:return ii}}function ts(o){switch(o){case 1:return ic;case 2:return oc;case 3:return oi;case 4:return oi}}var ye=class extends jr{constructor(){super(),this.minFilter=Qo,this.magFilter=Qo,this.generateMipmaps=!1,this.overrideItemSize=null,this._forcedType=null}updateFrom(t){let e=this.overrideItemSize,n=t.itemSize,i=t.count;if(e!==null){if(n*i%e!==0)throw new Error("VertexAttributeTexture: overrideItemSize must divide evenly into buffer length.");t.itemSize=e,t.count=i*n/e}let r=t.itemSize,s=t.count,l=t.normalized,c=t.array.constructor,u=c.BYTES_PER_ELEMENT,f=this._forcedType,a=r;if(f===null)switch(c){case Float32Array:f=tn;break;case Uint8Array:case Uint16Array:case Uint32Array:f=nn;break;case Int8Array:case Int16Array:case Int32Array:f=en;break}let d,p,y,g,b=sc(r);switch(f){case tn:y=1,p=rc(r),l&&u===1?(g=c,b+="8",c===Uint8Array?d=jo:(d=Jo,b+="_SNORM")):(g=Float32Array,b+="32F",d=tn);break;case en:b+=u*8+"I",y=l?Math.pow(2,c.BYTES_PER_ELEMENT*8-1):1,p=ts(r),u===1?(g=Int8Array,d=Jo):u===2?(g=Int16Array,d=Qr):(g=Int32Array,d=en);break;case nn:b+=u*8+"UI",y=l?Math.pow(2,c.BYTES_PER_ELEMENT*8-1):1,p=ts(r),u===1?(g=Uint8Array,d=jo):u===2?(g=Uint16Array,d=tc):(g=Uint32Array,d=nn);break}a===3&&(p===ii||p===oi)&&(a=4);let T=Math.ceil(Math.sqrt(s))||1,m=a*T*T,h=new g(m),x=t.normalized;t.normalized=!1;for(let v=0;v<s;v++){let A=a*v;h[A]=t.getX(v)/y,r>=2&&(h[A+1]=t.getY(v)/y),r>=3&&(h[A+2]=t.getZ(v)/y,a===4&&(h[A+3]=1)),r>=4&&(h[A+3]=t.getW(v)/y)}t.normalized=x,this.internalFormat=b,this.format=p,this.type=d,this.image.width=T,this.image.height=T,this.image.data=h,this.needsUpdate=!0,this.dispose(),t.itemSize=n,t.count=i}},on=class extends ye{constructor(){super(),this._forcedType=nn}},es=class extends ye{constructor(){super(),this._forcedType=en}},sn=class extends ye{constructor(){super(),this._forcedType=tn}};var is=class{constructor(){this.index=new on,this.position=new sn,this.bvhBounds=new ns,this.bvhContents=new ns,this._cachedIndexAttr=null,this.index.overrideItemSize=3}updateFrom(t){let{geometry:e}=t;if(pc(t,this.bvhBounds,this.bvhContents),this.position.updateFrom(e.attributes.position),t.indirect){let n=t._indirectBuffer;if(this._cachedIndexAttr===null||this._cachedIndexAttr.count!==n.length)if(e.index)this._cachedIndexAttr=e.index.clone();else{let i=_n(jt(e));this._cachedIndexAttr=new fc(i,1,!1)}dc(e,n,this._cachedIndexAttr),this.index.updateFrom(this._cachedIndexAttr)}else this.index.updateFrom(e.index)}dispose(){let{index:t,position:e,bvhBounds:n,bvhContents:i}=this;t&&t.dispose(),e&&e.dispose(),n&&n.dispose(),i&&i.dispose()}};function dc(o,t,e){let n=e.array,i=o.index?o.index.array:null;for(let r=0,s=t.length;r<s;r++){let l=3*r,c=3*t[r];for(let u=0;u<3;u++)n[l+u]=i?i[c+u]:c+u}}function pc(o,t,e){let n=o._roots;if(n.length!==1)throw new Error("MeshBVHUniformStruct: Multi-root BVHs not supported.");let i=n[0],r=new Uint16Array(i),s=new Uint32Array(i),l=new Float32Array(i),c=i.byteLength/32,u=2*Math.ceil(Math.sqrt(c/2)),f=new Float32Array(4*u*u),a=Math.ceil(Math.sqrt(c)),d=new Uint32Array(2*a*a);for(let p=0;p<c;p++){let y=p*32/4,g=y*2,b=y;for(let T=0;T<3;T++)f[8*p+0+T]=l[b+0+T],f[8*p+4+T]=l[b+3+T];if(N(g,r)){let T=z(g,r),m=C(y,s),h=-65536|T;d[p*2+0]=h,d[p*2+1]=m}else{let T=s[y+6],m=dt(y,s);d[p*2+0]=m,d[p*2+1]=T}}t.image.data=f,t.image.width=u,t.image.height=u,t.format=lc,t.type=cc,t.internalFormat="RGBA32F",t.minFilter=rn,t.magFilter=rn,t.generateMipmaps=!1,t.needsUpdate=!0,t.dispose(),e.image.data=d,e.image.width=a,e.image.height=a,e.format=uc,e.type=ac,e.internalFormat="RG32UI",e.minFilter=rn,e.magFilter=rn,e.generateMipmaps=!1,e.needsUpdate=!0,e.dispose()}import{BufferAttribute as ai,BufferGeometry as ln,Vector3 as ve,Vector4 as li,Matrix4 as ui,Matrix3 as mc}from"three";var _t=new ve,St=new ve,It=new ve,os=new li,cn=new ve,si=new ve,ss=new li,rs=new li,an=new ui,cs=new ui;function xe(o,t){if(!o&&!t)return;let e=o.count===t.count,n=o.normalized===t.normalized,i=o.array.constructor===t.array.constructor,r=o.itemSize===t.itemSize;if(!e||!n||!i||!r)throw new Error}function ge(o,t=null){let e=o.array.constructor,n=o.normalized,i=o.itemSize,r=t===null?o.count:t;return new ai(new e(i*r),i,n)}function us(o,t,e=0){if(o.isInterleavedBufferAttribute){let n=o.itemSize;for(let i=0,r=o.count;i<r;i++){let s=i+e;t.setX(s,o.getX(i)),n>=2&&t.setY(s,o.getY(i)),n>=3&&t.setZ(s,o.getZ(i)),n>=4&&t.setW(s,o.getW(i))}}else{let n=t.array,i=n.constructor,r=n.BYTES_PER_ELEMENT*o.itemSize*e;new i(n.buffer,r,o.array.length).set(o.array)}}function hc(o,t,e){let n=o.elements,i=t.elements;for(let r=0,s=i.length;r<s;r++)n[r]+=i[r]*e}function as(o,t,e){let n=o.skeleton,i=o.geometry,r=n.bones,s=n.boneInverses;ss.fromBufferAttribute(i.attributes.skinIndex,t),rs.fromBufferAttribute(i.attributes.skinWeight,t),an.elements.fill(0);for(let l=0;l<4;l++){let c=rs.getComponent(l);if(c!==0){let u=ss.getComponent(l);cs.multiplyMatrices(r[u].matrixWorld,s[u]),hc(an,cs,c)}}return an.multiply(o.bindMatrix).premultiply(o.bindMatrixInverse),e.transformDirection(an),e}function ri(o,t,e,n,i){cn.set(0,0,0);for(let r=0,s=o.length;r<s;r++){let l=t[r],c=o[r];l!==0&&(si.fromBufferAttribute(c,n),e?cn.addScaledVector(si,l):cn.addScaledVector(si.sub(i),l))}i.add(cn)}function yc(o,t={useGroups:!1,updateIndex:!1,skipAttributes:[]},e=new ln){let n=o[0].index!==null,{useGroups:i=!1,updateIndex:r=!1,skipAttributes:s=[]}=t,l=new Set(Object.keys(o[0].attributes)),c={},u=0;e.clearGroups();for(let f=0;f<o.length;++f){let a=o[f],d=0;if(n!==(a.index!==null))throw new Error("StaticGeometryGenerator: All geometries must have compatible attributes; make sure index attribute exists among all geometries, or in none of them.");for(let p in a.attributes){if(!l.has(p))throw new Error('StaticGeometryGenerator: All geometries must have compatible attributes; make sure "'+p+'" attribute exists among all geometries, or in none of them.');c[p]===void 0&&(c[p]=[]),c[p].push(a.attributes[p]),d++}if(d!==l.size)throw new Error("StaticGeometryGenerator: Make sure all geometries have the same number of attributes.");if(i){let p;if(n)p=a.index.count;else if(a.attributes.position!==void 0)p=a.attributes.position.count;else throw new Error("StaticGeometryGenerator: The geometry must have either an index or a position attribute");e.addGroup(u,p,f),u+=p}}if(n){let f=!1;if(!e.index){let a=0;for(let d=0;d<o.length;++d)a+=o[d].index.count;e.setIndex(new ai(new Uint32Array(a),1,!1)),f=!0}if(r||f){let a=e.index,d=0,p=0;for(let y=0;y<o.length;++y){let g=o[y],b=g.index;if(s[y]!==!0)for(let T=0;T<b.count;++T)a.setX(d,b.getX(T)+p),d++;p+=g.attributes.position.count}}}for(let f in c){let a=c[f];if(!(f in e.attributes)){let y=0;for(let g in a)y+=a[g].count;e.setAttribute(f,ge(c[f][0],y))}let d=e.attributes[f],p=0;for(let y=0,g=a.length;y<g;y++){let b=a[y];s[y]!==!0&&us(b,d,p),p+=b.count}}return e}function xc(o,t){if(o===null||t===null)return o===t;if(o.length!==t.length)return!1;for(let e=0,n=o.length;e<n;e++)if(o[e]!==t[e])return!1;return!0}function gc(o){let{index:t,attributes:e}=o;if(t)for(let n=0,i=t.count;n<i;n+=3){let r=t.getX(n),s=t.getX(n+2);t.setX(n,s),t.setX(n+2,r)}else for(let n in e){let i=e[n],r=i.itemSize;for(let s=0,l=i.count;s<l;s+=3)for(let c=0;c<r;c++){let u=i.getComponent(s,c),f=i.getComponent(s+2,c);i.setComponent(s,c,f),i.setComponent(s+2,c,u)}}return o}var ci=class{constructor(t){this.matrixWorld=new ui,this.geometryHash=null,this.boneMatrices=null,this.primitiveCount=-1,this.mesh=t,this.update()}update(){let t=this.mesh,e=t.geometry,n=t.skeleton,i=(e.index?e.index.count:e.attributes.position.count)/3;if(this.matrixWorld.copy(t.matrixWorld),this.geometryHash=e.attributes.position.version,this.primitiveCount=i,n){n.boneTexture||n.computeBoneTexture(),n.update();let r=n.boneMatrices;!this.boneMatrices||this.boneMatrices.length!==r.length?this.boneMatrices=r.slice():this.boneMatrices.set(r)}else this.boneMatrices=null}didChange(){let t=this.mesh,e=t.geometry,n=(e.index?e.index.count:e.attributes.position.count)/3;return!(this.matrixWorld.equals(t.matrixWorld)&&this.geometryHash===e.attributes.position.version&&xc(t.skeleton&&t.skeleton.boneMatrices||null,this.boneMatrices)&&this.primitiveCount===n)}},ls=class{constructor(t){Array.isArray(t)||(t=[t]);let e=[];t.forEach(n=>{n.traverseVisible(i=>{i.isMesh&&e.push(i)})}),this.meshes=e,this.useGroups=!0,this.applyWorldTransforms=!0,this.attributes=["position","normal","color","tangent","uv","uv2"],this._intermediateGeometry=new Array(e.length).fill().map(()=>new ln),this._diffMap=new WeakMap}getMaterials(){let t=[];return this.meshes.forEach(e=>{Array.isArray(e.material)?t.push(...e.material):t.push(e.material)}),t}generate(t=new ln){let e=[],{meshes:n,useGroups:i,_intermediateGeometry:r,_diffMap:s}=this;for(let l=0,c=n.length;l<c;l++){let u=n[l],f=r[l],a=s.get(u);!a||a.didChange(u)?(this._convertToStaticGeometry(u,f),e.push(!1),a?a.update():s.set(u,new ci(u))):e.push(!0)}if(r.length===0){t.setIndex(null);let l=t.attributes;for(let c in l)t.deleteAttribute(c);for(let c in this.attributes)t.setAttribute(this.attributes[c],new ai(new Float32Array(0),4,!1))}else yc(r,{useGroups:i,skipAttributes:e},t);for(let l in t.attributes)t.attributes[l].needsUpdate=!0;return t}_convertToStaticGeometry(t,e=new ln){let n=t.geometry,i=this.applyWorldTransforms,r=this.attributes.includes("normal"),s=this.attributes.includes("tangent"),l=n.attributes,c=e.attributes;!e.index&&n.index&&(e.index=n.index.clone()),c.position||e.setAttribute("position",ge(l.position)),r&&!c.normal&&l.normal&&e.setAttribute("normal",ge(l.normal)),s&&!c.tangent&&l.tangent&&e.setAttribute("tangent",ge(l.tangent)),xe(n.index,e.index),xe(l.position,c.position),r&&xe(l.normal,c.normal),s&&xe(l.tangent,c.tangent);let u=l.position,f=r?l.normal:null,a=s?l.tangent:null,d=n.morphAttributes.position,p=n.morphAttributes.normal,y=n.morphAttributes.tangent,g=n.morphTargetsRelative,b=t.morphTargetInfluences,T=new mc;T.getNormalMatrix(t.matrixWorld),n.index&&e.index.array.set(n.index.array);for(let m=0,h=l.position.count;m<h;m++)_t.fromBufferAttribute(u,m),f&&St.fromBufferAttribute(f,m),a&&(os.fromBufferAttribute(a,m),It.fromBufferAttribute(a,m)),b&&(d&&ri(d,b,g,m,_t),p&&ri(p,b,g,m,St),y&&ri(y,b,g,m,It)),t.isSkinnedMesh&&(t.applyBoneTransform(m,_t),f&&as(t,m,St),a&&as(t,m,It)),i&&_t.applyMatrix4(t.matrixWorld),c.position.setXYZ(m,_t.x,_t.y,_t.z),f&&(i&&St.applyNormalMatrix(T),c.normal.setXYZ(m,St.x,St.y,St.z)),a&&(i&&It.transformDirection(t.matrixWorld),c.tangent.setXYZW(m,It.x,It.y,It.z,os.w));for(let m in this.attributes){let h=this.attributes[m];h==="position"||h==="tangent"||h==="normal"||!(h in l)||(c[h]||e.setAttribute(h,ge(l[h])),xe(l[h],c[h]),us(l[h],c[h]))}return t.matrixWorld.determinant()<0&&gc(e),e}};var hi={};gs(hi,{bvh_distance_functions:()=>di,bvh_ray_functions:()=>pi,bvh_struct_definitions:()=>mi,common_functions:()=>fi});var fi=`

// A stack of uint32 indices can can store the indices for
// a perfectly balanced tree with a depth up to 31. Lower stack
// depth gets higher performance.
//
// However not all trees are balanced. Best value to set this to
// is the trees max depth.
#ifndef BVH_STACK_DEPTH
#define BVH_STACK_DEPTH 60
#endif

#ifndef INFINITY
#define INFINITY 1e20
#endif

// Utilities
uvec4 uTexelFetch1D( usampler2D tex, uint index ) {

	uint width = uint( textureSize( tex, 0 ).x );
	uvec2 uv;
	uv.x = index % width;
	uv.y = index / width;

	return texelFetch( tex, ivec2( uv ), 0 );

}

ivec4 iTexelFetch1D( isampler2D tex, uint index ) {

	uint width = uint( textureSize( tex, 0 ).x );
	uvec2 uv;
	uv.x = index % width;
	uv.y = index / width;

	return texelFetch( tex, ivec2( uv ), 0 );

}

vec4 texelFetch1D( sampler2D tex, uint index ) {

	uint width = uint( textureSize( tex, 0 ).x );
	uvec2 uv;
	uv.x = index % width;
	uv.y = index / width;

	return texelFetch( tex, ivec2( uv ), 0 );

}

vec4 textureSampleBarycoord( sampler2D tex, vec3 barycoord, uvec3 faceIndices ) {

	return
		barycoord.x * texelFetch1D( tex, faceIndices.x ) +
		barycoord.y * texelFetch1D( tex, faceIndices.y ) +
		barycoord.z * texelFetch1D( tex, faceIndices.z );

}

void ndcToCameraRay(
	vec2 coord, mat4 cameraWorld, mat4 invProjectionMatrix,
	out vec3 rayOrigin, out vec3 rayDirection
) {

	// get camera look direction and near plane for camera clipping
	vec4 lookDirection = cameraWorld * vec4( 0.0, 0.0, - 1.0, 0.0 );
	vec4 nearVector = invProjectionMatrix * vec4( 0.0, 0.0, - 1.0, 1.0 );
	float near = abs( nearVector.z / nearVector.w );

	// get the camera direction and position from camera matrices
	vec4 origin = cameraWorld * vec4( 0.0, 0.0, 0.0, 1.0 );
	vec4 direction = invProjectionMatrix * vec4( coord, 0.5, 1.0 );
	direction /= direction.w;
	direction = cameraWorld * direction - origin;

	// slide the origin along the ray until it sits at the near clip plane position
	origin.xyz += direction.xyz * near / dot( direction, lookDirection );

	rayOrigin = origin.xyz;
	rayDirection = direction.xyz;

}
`;var di=`

float dot2( vec3 v ) {

	return dot( v, v );

}

// implementation from https://www.shadertoy.com/view/ttfGWl, though method 2 has been removed
// and is now available at this fork: https://www.shadertoy.com/view/WlB3zW
vec3 closestPointToTriangle( vec3 p, vec3 v0, vec3 v1, vec3 v2, out vec3 barycoord ) {

    vec3 v10 = v1 - v0;
    vec3 v21 = v2 - v1;
    vec3 v02 = v0 - v2;

	vec3 p0 = p - v0;
	vec3 p1 = p - v1;
	vec3 p2 = p - v2;

    vec3 nor = cross( v10, v02 );

    // method 2, in barycentric space
    vec3  q = cross( nor, p0 );
    float d = 1.0 / dot2( nor );
    float u = d * dot( q, v02 );
    float v = d * dot( q, v10 );
    float w = 1.0 - u - v;

	if( u < 0.0 ) {

		w = clamp( dot( p2, v02 ) / dot2( v02 ), 0.0, 1.0 );
		u = 0.0;
		v = 1.0 - w;

	} else if( v < 0.0 ) {

		u = clamp( dot( p0, v10 ) / dot2( v10 ), 0.0, 1.0 );
		v = 0.0;
		w = 1.0 - u;

	} else if( w < 0.0 ) {

		v = clamp( dot( p1, v21 ) / dot2( v21 ), 0.0, 1.0 );
		w = 0.0;
		u = 1.0 - v;

	}

	// output the barycoord in v0, v1, v2 weight order
	barycoord = vec3( w, u, v );
    return u * v1 + v * v2 + w * v0;

}

float distanceToTriangles(
	// geometry info and triangle range
	sampler2D positionAttr, usampler2D indexAttr, uint offset, uint count,

	// point and cut off range
	vec3 point, float closestDistanceSquared,

	// outputs
	inout uvec4 faceIndices, inout vec3 faceNormal, inout vec3 barycoord, inout float side, inout vec3 outPoint
) {

	bool found = false;
	vec3 localBarycoord;
	for ( uint i = offset, l = offset + count; i < l; i ++ ) {

		uvec3 indices = uTexelFetch1D( indexAttr, i ).xyz;
		vec3 a = texelFetch1D( positionAttr, indices.x ).rgb;
		vec3 b = texelFetch1D( positionAttr, indices.y ).rgb;
		vec3 c = texelFetch1D( positionAttr, indices.z ).rgb;

		// get the closest point and barycoord
		vec3 closestPoint = closestPointToTriangle( point, a, b, c, localBarycoord );
		vec3 delta = point - closestPoint;
		float sqDist = dot2( delta );
		if ( sqDist < closestDistanceSquared ) {

			// set the output results
			closestDistanceSquared = sqDist;
			faceIndices = uvec4( indices.xyz, i );
			faceNormal = normalize( cross( a - b, b - c ) );
			barycoord = localBarycoord;
			outPoint = closestPoint;
			side = sign( dot( faceNormal, delta ) );

		}

	}

	return closestDistanceSquared;

}

float distanceSqToBounds( vec3 point, vec3 boundsMin, vec3 boundsMax ) {

	vec3 clampedPoint = clamp( point, boundsMin, boundsMax );
	vec3 delta = point - clampedPoint;
	return dot( delta, delta );

}

float distanceSqToBVHNodeBoundsPoint( vec3 point, sampler2D bvhBounds, uint currNodeIndex ) {

	uint cni2 = currNodeIndex * 2u;
	vec3 boundsMin = texelFetch1D( bvhBounds, cni2 ).xyz;
	vec3 boundsMax = texelFetch1D( bvhBounds, cni2 + 1u ).xyz;
	return distanceSqToBounds( point, boundsMin, boundsMax );

}

// use a macro to hide the fact that we need to expand the struct into separate fields
#define	bvhClosestPointToPoint(		bvh,		point, maxDistance, faceIndices, faceNormal, barycoord, side, outPoint	)	_bvhClosestPointToPoint(		bvh.position, bvh.index, bvh.bvhBounds, bvh.bvhContents,		point, maxDistance, faceIndices, faceNormal, barycoord, side, outPoint	)

float _bvhClosestPointToPoint(
	// bvh info
	sampler2D bvh_position, usampler2D bvh_index, sampler2D bvh_bvhBounds, usampler2D bvh_bvhContents,

	// point to check
	vec3 point, float maxDistance,

	// output variables
	inout uvec4 faceIndices, inout vec3 faceNormal, inout vec3 barycoord,
	inout float side, inout vec3 outPoint
 ) {

	// stack needs to be twice as long as the deepest tree we expect because
	// we push both the left and right child onto the stack every traversal
	int pointer = 0;
	uint stack[ BVH_STACK_DEPTH ];
	stack[ 0 ] = 0u;

	float closestDistanceSquared = maxDistance * maxDistance;
	bool found = false;
	while ( pointer > - 1 && pointer < BVH_STACK_DEPTH ) {

		uint currNodeIndex = stack[ pointer ];
		pointer --;

		// check if we intersect the current bounds
		float boundsHitDistance = distanceSqToBVHNodeBoundsPoint( point, bvh_bvhBounds, currNodeIndex );
		if ( boundsHitDistance > closestDistanceSquared ) {

			continue;

		}

		uvec2 boundsInfo = uTexelFetch1D( bvh_bvhContents, currNodeIndex ).xy;
		bool isLeaf = bool( boundsInfo.x & 0xffff0000u );
		if ( isLeaf ) {

			uint count = boundsInfo.x & 0x0000ffffu;
			uint offset = boundsInfo.y;
			closestDistanceSquared = distanceToTriangles(
				bvh_position, bvh_index, offset, count, point, closestDistanceSquared,

				// outputs
				faceIndices, faceNormal, barycoord, side, outPoint
			);

		} else {

			uint leftIndex = currNodeIndex + 1u;
			uint splitAxis = boundsInfo.x & 0x0000ffffu;
			uint rightIndex = currNodeIndex + boundsInfo.y;
			bool leftToRight = distanceSqToBVHNodeBoundsPoint( point, bvh_bvhBounds, leftIndex ) < distanceSqToBVHNodeBoundsPoint( point, bvh_bvhBounds, rightIndex );//rayDirection[ splitAxis ] >= 0.0;
			uint c1 = leftToRight ? leftIndex : rightIndex;
			uint c2 = leftToRight ? rightIndex : leftIndex;

			// set c2 in the stack so we traverse it later. We need to keep track of a pointer in
			// the stack while we traverse. The second pointer added is the one that will be
			// traversed first
			pointer ++;
			stack[ pointer ] = c2;
			pointer ++;
			stack[ pointer ] = c1;

		}

	}

	return sqrt( closestDistanceSquared );

}
`;var pi=`

#ifndef TRI_INTERSECT_EPSILON
#define TRI_INTERSECT_EPSILON 1e-5
#endif

// Raycasting
bool intersectsBounds( vec3 rayOrigin, vec3 rayDirection, vec3 boundsMin, vec3 boundsMax, out float dist ) {

	// https://www.reddit.com/r/opengl/comments/8ntzz5/fast_glsl_ray_box_intersection/
	// https://tavianator.com/2011/ray_box.html
	vec3 invDir = 1.0 / rayDirection;

	// find intersection distances for each plane
	vec3 tMinPlane = invDir * ( boundsMin - rayOrigin );
	vec3 tMaxPlane = invDir * ( boundsMax - rayOrigin );

	// get the min and max distances from each intersection
	vec3 tMinHit = min( tMaxPlane, tMinPlane );
	vec3 tMaxHit = max( tMaxPlane, tMinPlane );

	// get the furthest hit distance
	vec2 t = max( tMinHit.xx, tMinHit.yz );
	float t0 = max( t.x, t.y );

	// get the minimum hit distance
	t = min( tMaxHit.xx, tMaxHit.yz );
	float t1 = min( t.x, t.y );

	// set distance to 0.0 if the ray starts inside the box
	dist = max( t0, 0.0 );

	return t1 >= dist;

}

bool intersectsTriangle(
	vec3 rayOrigin, vec3 rayDirection, vec3 a, vec3 b, vec3 c,
	out vec3 barycoord, out vec3 norm, out float dist, out float side
) {

	// https://stackoverflow.com/questions/42740765/intersection-between-line-and-triangle-in-3d
	vec3 edge1 = b - a;
	vec3 edge2 = c - a;
	norm = cross( edge1, edge2 );

	float det = - dot( rayDirection, norm );
	float invdet = 1.0 / det;

	vec3 AO = rayOrigin - a;
	vec3 DAO = cross( AO, rayDirection );

	vec4 uvt;
	uvt.x = dot( edge2, DAO ) * invdet;
	uvt.y = - dot( edge1, DAO ) * invdet;
	uvt.z = dot( AO, norm ) * invdet;
	uvt.w = 1.0 - uvt.x - uvt.y;

	// set the hit information
	barycoord = uvt.wxy; // arranged in A, B, C order
	dist = uvt.z;
	side = sign( det );
	norm = side * normalize( norm );

	// add an epsilon to avoid misses between triangles
	uvt += vec4( TRI_INTERSECT_EPSILON );

	return all( greaterThanEqual( uvt, vec4( 0.0 ) ) );

}

bool intersectTriangles(
	// geometry info and triangle range
	sampler2D positionAttr, usampler2D indexAttr, uint offset, uint count,

	// ray
	vec3 rayOrigin, vec3 rayDirection,

	// outputs
	inout float minDistance, inout uvec4 faceIndices, inout vec3 faceNormal, inout vec3 barycoord,
	inout float side, inout float dist
) {

	bool found = false;
	vec3 localBarycoord, localNormal;
	float localDist, localSide;
	for ( uint i = offset, l = offset + count; i < l; i ++ ) {

		uvec3 indices = uTexelFetch1D( indexAttr, i ).xyz;
		vec3 a = texelFetch1D( positionAttr, indices.x ).rgb;
		vec3 b = texelFetch1D( positionAttr, indices.y ).rgb;
		vec3 c = texelFetch1D( positionAttr, indices.z ).rgb;

		if (
			intersectsTriangle( rayOrigin, rayDirection, a, b, c, localBarycoord, localNormal, localDist, localSide )
			&& localDist < minDistance
		) {

			found = true;
			minDistance = localDist;

			faceIndices = uvec4( indices.xyz, i );
			faceNormal = localNormal;

			side = localSide;
			barycoord = localBarycoord;
			dist = localDist;

		}

	}

	return found;

}

bool intersectsBVHNodeBounds( vec3 rayOrigin, vec3 rayDirection, sampler2D bvhBounds, uint currNodeIndex, out float dist ) {

	uint cni2 = currNodeIndex * 2u;
	vec3 boundsMin = texelFetch1D( bvhBounds, cni2 ).xyz;
	vec3 boundsMax = texelFetch1D( bvhBounds, cni2 + 1u ).xyz;
	return intersectsBounds( rayOrigin, rayDirection, boundsMin, boundsMax, dist );

}

// use a macro to hide the fact that we need to expand the struct into separate fields
#define	bvhIntersectFirstHit(		bvh,		rayOrigin, rayDirection, faceIndices, faceNormal, barycoord, side, dist	)	_bvhIntersectFirstHit(		bvh.position, bvh.index, bvh.bvhBounds, bvh.bvhContents,		rayOrigin, rayDirection, faceIndices, faceNormal, barycoord, side, dist	)

bool _bvhIntersectFirstHit(
	// bvh info
	sampler2D bvh_position, usampler2D bvh_index, sampler2D bvh_bvhBounds, usampler2D bvh_bvhContents,

	// ray
	vec3 rayOrigin, vec3 rayDirection,

	// output variables split into separate variables due to output precision
	inout uvec4 faceIndices, inout vec3 faceNormal, inout vec3 barycoord,
	inout float side, inout float dist
) {

	// stack needs to be twice as long as the deepest tree we expect because
	// we push both the left and right child onto the stack every traversal
	int pointer = 0;
	uint stack[ BVH_STACK_DEPTH ];
	stack[ 0 ] = 0u;

	float triangleDistance = INFINITY;
	bool found = false;
	while ( pointer > - 1 && pointer < BVH_STACK_DEPTH ) {

		uint currNodeIndex = stack[ pointer ];
		pointer --;

		// check if we intersect the current bounds
		float boundsHitDistance;
		if (
			! intersectsBVHNodeBounds( rayOrigin, rayDirection, bvh_bvhBounds, currNodeIndex, boundsHitDistance )
			|| boundsHitDistance > triangleDistance
		) {

			continue;

		}

		uvec2 boundsInfo = uTexelFetch1D( bvh_bvhContents, currNodeIndex ).xy;
		bool isLeaf = bool( boundsInfo.x & 0xffff0000u );

		if ( isLeaf ) {

			uint count = boundsInfo.x & 0x0000ffffu;
			uint offset = boundsInfo.y;

			found = intersectTriangles(
				bvh_position, bvh_index, offset, count,
				rayOrigin, rayDirection, triangleDistance,
				faceIndices, faceNormal, barycoord, side, dist
			) || found;

		} else {

			uint leftIndex = currNodeIndex + 1u;
			uint splitAxis = boundsInfo.x & 0x0000ffffu;
			uint rightIndex = currNodeIndex + boundsInfo.y;

			bool leftToRight = rayDirection[ splitAxis ] >= 0.0;
			uint c1 = leftToRight ? leftIndex : rightIndex;
			uint c2 = leftToRight ? rightIndex : leftIndex;

			// set c2 in the stack so we traverse it later. We need to keep track of a pointer in
			// the stack while we traverse. The second pointer added is the one that will be
			// traversed first
			pointer ++;
			stack[ pointer ] = c2;

			pointer ++;
			stack[ pointer ] = c1;

		}

	}

	return found;

}
`;var mi=`
struct BVH {

	usampler2D index;
	sampler2D position;

	sampler2D bvhBounds;
	usampler2D bvhContents;

};
`;var pf=mi,mf=di,hf=`
	${fi}
	${pi}
`;export{bi as AVERAGE,Lt as BVH,Qn as BVHHelper,hi as BVHShaderGLSL,vi as CENTER,mn as CONTAINED,q as ExtendedTriangle,sn as FloatVertexAttributeTexture,st as GeometryBVH,ot as INTERSECTED,es as IntVertexAttributeTexture,Ao as LineBVH,kn as LineLoopBVH,Hn as LineSegmentsBVH,gt as MeshBVH,Xo as MeshBVHHelper,is as MeshBVHUniformStruct,Z as NOT_INTERSECTED,Eo as ObjectBVH,H as OrientedBox,So as PointsBVH,Ti as SAH,ct as SKIP_GENERATION,Vo as SkinnedMeshBVH,ls as StaticGeometryGenerator,on as UIntVertexAttributeTexture,ye as VertexAttributeTexture,ku as acceleratedRaycast,Xu as computeBatchedBoundsTree,qu as computeBoundsTree,Gu as disposeBatchedBoundsTree,Wu as disposeBoundsTree,Wr as estimateMemoryInBytes,Ds as generateIndirectBuffer,qr as getBVHExtremes,Gr as getJSONStructure,Ws as getTriangleHitPointInfo,mf as shaderDistanceFunction,hf as shaderIntersectFunction,pf as shaderStructs,Xr as validateBounds};
