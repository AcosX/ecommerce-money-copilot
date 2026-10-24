import {MODEL_NAMES,mountShowcaseNav} from './model-showcase.js?v=1';
const nav=mountShowcaseNav('hub'),picker=document.getElementById('showcase-level');
picker.innerHTML=MODEL_NAMES.map((name,level)=>`<option value="${level}">LV.${level} · ${name}</option>`).join('');
function show(level){nav.setLevel(level);picker.value=String(level);const image=document.getElementById('showcase-poster');image.src=`../assets/models/previews/showcase-level-${level}.webp`;image.alt=MODEL_NAMES[level]+'的浮岛实装预览';document.getElementById('poster-caption').textContent=`LV.0${level} / ${MODEL_NAMES[level]}`;}
picker.addEventListener('change',()=>show(Number(picker.value)));show(nav.state.level);
