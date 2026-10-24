const {test}=require('node:test'),assert=require('node:assert/strict');
const load=()=>import('../emc-playback-clock.js');

test('低帧率下播放时间保留完整间隔，不按帧数限速',async()=>{
 const {createPlaybackClock}=await load();let time=0;
 const clock=createPlaybackClock(()=>time);clock.setRunning(true);
 time=1200;assert.equal(clock.now(),1200);
 time=5400;assert.equal(clock.now(),5400);
 assert.equal(clock.now(),5400,'同一帧多次读取不会重复累计');
});
test('暂停与隐藏期间不计时，恢复和重播不追赶停留时间',async()=>{
 const {createPlaybackClock}=await load();let time=0;
 const clock=createPlaybackClock(()=>time);
 time=10000;assert.equal(clock.now(),0,'加载期间不计入播放');
 clock.setRunning(true);time+=600;clock.setRunning(false);
 time+=60000;assert.equal(clock.now(),600);
 clock.setRunning(true);time+=300;assert.equal(clock.now(),900);
 clock.setRunning(false);time+=100000;clock.setRunning(false);
 clock.setRunning(true);time+=100;assert.equal(clock.now(),1000);
 clock.reset();assert.equal(clock.now(),0);time+=200;assert.equal(clock.now(),200);
});
