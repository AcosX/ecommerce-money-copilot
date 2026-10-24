'use strict';
const {execFileSync,spawnSync}=require('node:child_process');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const files=execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(file=>/\.(?:js|cjs|mjs)$/.test(file));
let failures=0;
for(const file of files){
 const result=spawnSync(process.execPath,['--check',path.join(root,file)],{cwd:root,encoding:'utf8'});
 if(result.status!==0){failures++;console.error(file+'\n'+(result.error?.message||result.stderr||result.stdout));}
}
console.log(`Syntax checked ${files.length} JavaScript files; ${failures} failed.`);
process.exitCode=failures?1:0;
