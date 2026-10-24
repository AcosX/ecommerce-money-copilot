const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
function check({worker=true,unit=true}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'emc-deploy-test-'));
 try{fs.mkdirSync(path.join(dir,'release/backend/emc_api/services'),{recursive:true});fs.writeFileSync(path.join(dir,'release/backend/pyproject.toml'),'');if(worker)fs.writeFileSync(path.join(dir,'release/backend/emc_api/services/review_queue.py'),'');
 const script=`source "$1"
 systemctl(){ echo "$*" >> "$EMC_BASE/calls"; if [[ $1 == cat && $TEST_UNIT == 0 ]]; then return 1; fi; return 0; }
 emc_wait_url(){ return 0; }
 emc_start_and_check release`;
 const result=spawnSync('bash',['-c',script,'bash',path.resolve(__dirname,'../../deploy/scripts/lib.sh')],{env:{...process.env,EMC_BASE:dir,TEST_UNIT:unit?'1':'0'},encoding:'utf8'});
 return {status:result.status,calls:fs.readFileSync(path.join(dir,'calls'),'utf8')};
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test('审核版本启动已安装的 worker 并检查存活',()=>{const r=check({});assert.equal(r.status,0);assert.match(r.calls,/restart ecommerce-money-copilot-review.service/);assert.match(r.calls,/is-active --quiet ecommerce-money-copilot-review.service/);});
test('回滚旧版本停用 worker，保留数据库队列',()=>{const r=check({worker:false});assert.equal(r.status,0);assert.match(r.calls,/stop ecommerce-money-copilot-review.service/);assert.match(r.calls,/disable --quiet ecommerce-money-copilot-review.service/);assert.doesNotMatch(r.calls,/restart ecommerce-money-copilot-review.service/);});
test('缺少 worker 单元时发布检查失败',()=>{assert.equal(check({unit:false}).status,1);});
