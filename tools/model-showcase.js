// Public, read-only showcase routes. Never read player accounts or journey saves.
export const MODEL_NAMES=['地摊起步','复古商车','日式精品店','工业旗舰店','未来商业街','未来百货地标'];
const pages={hub:['models.html','展示中心'],evolution:['building-evolution.html','完整演示'],single:['buildings-preview.html','单体与 DIY'],island:['island-buildings-preview.html','浮岛预览']};
export function readShowcaseState(url=location.href){
 const params=new URL(url).searchParams,n=Number(params.get('level'));
 return{level:Number.isFinite(n)?Math.max(0,Math.min(5,Math.trunc(n))):0,quality:['auto','detail','smooth'].includes(params.get('quality'))?params.get('quality'):'auto'};
}
export function showcaseURL(page,state,base=import.meta.url){
 if(!Object.hasOwn(pages,page))throw new RangeError('Unknown showcase page');
 const url=new URL(pages[page][0],base),clean=readShowcaseState('https://showcase.invalid/?'+new URLSearchParams(state));
 url.search=new URLSearchParams(clean).toString();return url;
}
export function mountShowcaseNav(page){
 const state=readShowcaseState(),presentation=page==='evolution'&&new URL(location.href).searchParams.get('presentation')==='1';
 document.body.dataset.modelView=page;
 const nav=document.createElement('nav');nav.id='model-showcase-nav';nav.setAttribute('aria-label','模型展示导航');
 nav.innerHTML='<a class="showcase-brand" data-showcase="hub">模型展示中心 <span>↗</span></a><div class="showcase-routes">'+['evolution','single','island'].map(key=>`<a data-showcase="${key}"${page===key?' aria-current="page"':''}>${pages[key][1]}</a>`).join('')+'</div><label class="showcase-quality">画质 <select aria-label="展示画质"><option value="auto">自动</option><option value="detail">精细</option><option value="smooth">流畅</option></select></label><button type="button" id="copy-showcase-link">复制链接</button>';
 if(!presentation){document.body.prepend(nav);document.body.classList.add('has-showcase-nav');}
 const quality=nav.querySelector('select');quality.value=state.quality;
 function links(){
  document.querySelectorAll('[data-showcase]').forEach(a=>{a.href=showcaseURL(a.dataset.showcase,state).href;});
  const url=new URL(location.href);url.searchParams.set('level',state.level);url.searchParams.set('quality',state.quality);history.replaceState(history.state,'',url);
 }
 quality.addEventListener('change',()=>location.assign(showcaseURL(page,{...state,quality:quality.value}).href));
 nav.querySelector('button').addEventListener('click',async event=>{
  const button=event.currentTarget;
  try{await navigator.clipboard.writeText(location.href);button.textContent='已复制';}
  catch{button.textContent='请复制地址栏';}
  setTimeout(()=>button.textContent='复制链接',1800);
 });
 links();
 window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
 return{state,setLevel(level){state.level=readShowcaseState('https://showcase.invalid/?level='+level).level;links();},href:target=>showcaseURL(target,state).href};
}
