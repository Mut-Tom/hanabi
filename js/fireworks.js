// v0.9.16 演出修正: 玉種ごとの構造を維持した閃光・星先・残光
let bloomFlashes=[];
let starSerial=0;
let active=false,t=0,lastTime=0,particles=[],trails=[],flashes=[],burstDone=false,paused=false;
const canvas=$('sky'),displayCtx=canvas.getContext('2d');
const effectCanvas=document.createElement('canvas'),ctx=effectCanvas.getContext('2d');
const starCanvas=document.createElement('canvas'),starCtx=starCanvas.getContext('2d');
// 菊専用の残光レイヤー。軌跡の折れ線を保存せず、星の移動に合わせて光を蓄積する。
const kikuAfterglowCanvas=document.createElement('canvas'),kikuAfterglowCtx=kikuAfterglowCanvas.getContext('2d');
// 引きが燃え尽きた後だけ残る、非常に淡い煙の軌跡。花火終了時には消去。
const kikuSmokeCanvas=document.createElement('canvas'),kikuSmokeCtx=kikuSmokeCanvas.getContext('2d');
const peakCanvas=document.createElement('canvas'),peakCtx=peakCanvas.getContext('2d');
// 共有写真は単に花火の外径が最大の瞬間ではなく、光の密度と広がりで選ぶ。
// 撮影候補を複数保存して、ユーザーも好みの瞬間を選べるようにする。
const peakAnalysisCanvas=document.createElement('canvas'),peakAnalysisCtx=peakAnalysisCanvas.getContext('2d',{willReadFrequently:true});
peakAnalysisCanvas.width=144;peakAnalysisCanvas.height=108;
let photoCandidates=[],selectedPhotoIndex=0,peakScore=0,peakCount=0,peakTime=0;
let peakReady=false,photoRequested=false,peakName='',lastPeakSample=-1,photoGeneration=0;
function resetPeakPhoto(){
 photoCandidates=[];selectedPhotoIndex=0;peakScore=0;peakCount=0;peakTime=0;
 peakReady=false;photoRequested=false;peakName='';lastPeakSample=-1;
 photoGeneration++;photoFile=null;
 if(photoURL){URL.revokeObjectURL(photoURL);photoURL=null}
 $('snapshot').disabled=true;$('snapshot').textContent='↗ 写真を共有';
}
// v1.0.35: 写真の採点は光量だけでなく、色のある光・対称的な広がり・形の充実度を重視。
// 3つの開花段階ごとに最高の1枚を確保し、似た瞬間ばかりを並べない。
const PHOTO_WINDOWS=[.30,1.45,2.65,4.35];
function scorePhotoFrame(){
 const sw=peakAnalysisCanvas.width,sh=peakAnalysisCanvas.height;
 peakAnalysisCtx.clearRect(0,0,sw,sh);
 peakAnalysisCtx.drawImage(effectCanvas,0,0,sw,sh);
 const data=peakAnalysisCtx.getImageData(0,0,sw,sh).data;
 let glow=0,coloredGlow=0,outerGlow=0,innerGlow=0,visible=0;
 let minX=sw,maxX=0,minY=sh,maxY=0;
 const sectors=new Float32Array(16),cells=new Uint8Array(12*9);
 // 白く飽和した中心の一瞬の閃光に引っ張られないよう明度を頭打ちにする。
 for(let y=0;y<sh;y+=2)for(let x=0;x<sw;x+=2){
   const i=(y*sw+x)*4,alpha=data[i+3]/255;
   if(alpha<.16)continue;
   const r=data[i]/255,g=data[i+1]/255,b=data[i+2]/255;
   const maximum=Math.max(r,g,b),minimum=Math.min(r,g,b);
   const brightness=maximum*alpha;
   if(brightness<.16)continue;
   const dx=x/sw-.5,dy=y/sh-.42;
   const radius=Math.hypot(dx,dy);
   // 彩度が低い白い光も残すが、色のある花火をやや優先する。
   const saturation=maximum>0?(maximum-minimum)/maximum:0;
   const weight=Math.min(.72,brightness)*(.72+.28*saturation);
   glow+=weight;coloredGlow+=weight*saturation;
   if(radius>.125)outerGlow+=weight;
   else innerGlow+=weight;
   visible++;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
   cells[Math.min(8,Math.floor(y/sh*9))*12+Math.min(11,Math.floor(x/sw*12))]=1;
   if(radius>.11)sectors[Math.floor((Math.atan2(dy,dx)+Math.PI)/(Math.PI*2)*16)%16]+=weight;
 }
 if(visible<20||glow<8)return 0;
 const occupied=cells.reduce((n,v)=>n+v,0);
 const spanX=(maxX-minX)/sw,spanY=(maxY-minY)/sh;
 const spread=Math.sqrt(Math.max(0,spanX*spanY));
 const directional=sectors.filter(v=>v>1.1).length/16;
 const coverage=occupied/108;
 const outerRatio=outerGlow/(glow+1);
 // 広がる前の閃光、白い塊、消え際の煙を避ける。
 const shape=(.24+.76*Math.min(1,spread/.35))*(.45+.55*directional);
 const density=Math.min(1,glow/110);
 const fullness=Math.min(1,coverage/.27);
 const centralPenalty=outerRatio<.26?.25:outerRatio<.43?.65:1;
 const washPenalty=innerGlow>outerGlow*1.6?.6:1;
 return 100*shape*(.36+.64*density)*(.35+.65*fullness)*centralPenalty*washPenalty
   *(.86+.14*Math.min(1,coloredGlow/(glow+.01)/.35));
}
function capturePeakPhoto(){
 if(!active||!burstDone||peakReady)return;
 const elapsed=t-BURST_AUDIO_OFFSET;
 if(elapsed<PHOTO_WINDOWS[0])return;
 if(t-lastPeakSample>=.10&&elapsed<=PHOTO_WINDOWS[3]){
   lastPeakSample=t;
   const score=scorePhotoFrame();
   if(score>0){
     const phase=Math.min(2,PHOTO_WINDOWS.findIndex((edge,i)=>i<3&&elapsed<PHOTO_WINDOWS[i+1]));
     const bucket=phase<0?2:phase;
     const existing=photoCandidates.findIndex(c=>c.phase===bucket);
     if(existing<0||score>photoCandidates[existing].score){
       const photo=document.createElement('canvas');photo.width=canvas.width;photo.height=canvas.height;
       photo.getContext('2d').drawImage(canvas,0,0);
       const candidate={phase:bucket,time:t,score,canvas:photo};
       if(existing<0)photoCandidates.push(candidate);else photoCandidates[existing]=candidate;
     }
   }
 }
 if(elapsed>PHOTO_WINDOWS[3]+.05){
   if(!photoCandidates.length){
     const fallback=document.createElement('canvas');fallback.width=canvas.width;fallback.height=canvas.height;
     fallback.getContext('2d').drawImage(canvas,0,0);
     photoCandidates.push({phase:2,time:t,score:1,canvas:fallback});
   }
   photoCandidates.sort((a,b)=>b.score-a.score);
   peakReady=true;selectPhotoCandidate(0);
   if(photoRequested){photoRequested=false;$('snapshot').disabled=false;$('snapshot').textContent='↗ 写真を共有';showPeakPhoto()}
 }
}
function selectPhotoCandidate(index){
 const chosen=photoCandidates[index];if(!chosen)return;
 selectedPhotoIndex=index;peakScore=chosen.score;peakTime=chosen.time;
 peakCanvas.width=chosen.canvas.width;peakCanvas.height=chosen.canvas.height;
 peakCtx.drawImage(chosen.canvas,0,0);
 photoGeneration++;photoFile=null;
 if(photoURL){URL.revokeObjectURL(photoURL);photoURL=null}
 preparePeakFile();
 if($('photoDialog').open){
   $('photoImage').src=peakCanvas.toDataURL('image/png');
   $('downloadPhoto').href=$('photoImage').src;
   $('sharePhoto').disabled=true;
   renderPhotoChoices();
 }
}
function renderPhotoChoices(){
 const area=$('photoChoices');area.replaceChildren();
 if(photoCandidates.length<2){area.hidden=true;return}
 area.hidden=false;
 photoCandidates.forEach((candidate,index)=>{
   const button=document.createElement('button');button.type='button';button.className='photo-choice';
   button.setAttribute('aria-label','撮影候補 '+(index+1));
   button.setAttribute('aria-pressed',String(index===selectedPhotoIndex));
   const img=document.createElement('img');img.src=candidate.canvas.toDataURL('image/jpeg',.78);img.alt='開花の瞬間 '+(index+1);
   button.appendChild(img);
   const label=document.createElement('span');label.textContent=index===0?'おすすめ':('候補 '+(index+1));button.appendChild(label);
   button.onclick=()=>selectPhotoCandidate(index);
   area.appendChild(button);
 });
}
let W=600,H=450,DPR=1;
const starSeeds=Array.from({length:110},()=>({x:Math.random(),y:Math.random()*.8,size:rand(.65,1.3),alpha:rand(.45,.75)}));
function paintStarBackground(){
 starCtx.globalAlpha=1;starCtx.fillStyle='#03050c';starCtx.fillRect(0,0,W,H);
 for(const s of starSeeds){starCtx.globalAlpha=s.alpha;starCtx.fillStyle='#cbd9fa';starCtx.fillRect(s.x*W,s.y*H,s.size,s.size)}
 starCtx.globalAlpha=1;
}
function presentSky(){
 displayCtx.globalAlpha=1;displayCtx.globalCompositeOperation='source-over';
 displayCtx.drawImage(starCanvas,0,0,starCanvas.width,starCanvas.height,0,0,W,H);
 displayCtx.drawImage(effectCanvas,0,0,effectCanvas.width,effectCanvas.height,0,0,W,H);
}
function resize(){
 const rect=canvas.getBoundingClientRect();DPR=Math.min(window.devicePixelRatio||1,1.5);W=rect.width;H=rect.height;
 for(const layer of [canvas,effectCanvas,starCanvas,kikuAfterglowCanvas,kikuSmokeCanvas]){layer.width=Math.round(W*DPR);layer.height=Math.round(H*DPR)}
 for(const context of [displayCtx,ctx,starCtx,kikuAfterglowCtx,kikuSmokeCtx])context.setTransform(DPR,0,0,DPR,0,0);
 paintStarBackground();presentSky();
}
window.addEventListener('resize',resize);resize();
// 発光は粒子ごとのshadowBlurではなく、色別に一度だけ作る光のスプライトで表現。
const glowCache=new Map();
function glowSprite(color,size){
  const key=color+'_'+size;
  if(glowCache.has(key))return glowCache.get(key);
  // 旧式の発光粒キャッシュ（現在の星描画には使用しない）。
  const radius=Math.ceil(size*1.65+2),cv=document.createElement('canvas');
  cv.width=cv.height=radius*2;
  const c=cv.getContext('2d');
  const g=c.createRadialGradient(radius,radius,0,radius,radius,radius);
  g.addColorStop(0,'#ffffff');g.addColorStop(.24,'#ffffff');
  g.addColorStop(.42,color);g.addColorStop(.68,color+'9c');g.addColorStop(1,color+'00');
  c.fillStyle=g;c.fillRect(0,0,cv.width,cv.height);
  const result={canvas:cv,radius};glowCache.set(key,result);return result;
}
function rgb(hex){return [parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16)]}
// 星先の燃焼色は短時間で切り替わる。描画用に軽量なRGB補間だけを行う。
function mixFireworkColor(a,b,amount){
 const k=Math.max(0,Math.min(1,amount));if(k<=0)return a;if(k>=1)return b;
 const aa=rgb(a),bb=rgb(b);
 return '#'+aa.map((v,i)=>Math.round(v+(bb[i]-v)*k).toString(16).padStart(2,'0')).join('');
}
function dimKikuTrailColor(color,nishiki=false){
 // 菊の開花直後は「暗い引き」が先に見え、後から星先の色が立ち上がる。
 // 色味は残しつつ、彩度と明るさを落とした引き色へ寄せる。
 if(nishiki)return mixFireworkColor(color,'#6d4416',.58);
 return mixFireworkColor(color,'#160d10',.72);
}
function cColor(ch){return ch==='炭'?'#ed853b':COLORS[ch]||'#ed853b'}
function particle(x,y,vx,vy,color,life=2.8,opt={}){const scale=Math.min(1.12,Math.max(.5,Math.min(W/690,H/485)));particles.push({twinkleSeed:++starSerial,x,y,vx:vx*scale,vy:vy*scale,color,life,ttl:life,trail:opt.trail??.8,drag:opt.drag??.988,grav:opt.grav??13,seq:opt.seq||[],seqMode:opt.seqMode||'なし',flicker:opt.flicker||false,kind:opt.kind||'regular',size:opt.size||3.1,delay:opt.delay||0})}
// Independent flash timings: no particle index or angular order enters the phase.
function twinkleHash(value){
 let n=value|0;n=Math.imul(n^(n>>>16),0x7feb352d);n=Math.imul(n^(n>>>15),0x846ca68b);return ((n^(n>>>16))>>>0)/4294967296;
}
function starTwinkle(star,time,speed=1){
 const seed=star.twinkleSeed??(star.twinkleSeed=++starSerial);
 const rate=3.0+twinkleHash(seed^0x125cd)*2.5;
 const clock=time*rate*speed+twinkleHash(seed^0x32f91);
 const interval=Math.floor(clock),phase=clock-interval;
 const enabled=twinkleHash(seed^Math.imul(interval+1,0x9e3779b1))>.18;
 const pulse=enabled?Math.pow(Math.max(0,Math.sin(phase*Math.PI)),5):0;
 return .08+.92*pulse;
}
function sparks(x,y,number,radius,color,opts={}){for(let i=0;i<number;i++){let theta=opts.angleFn?opts.angleFn(i,number):i*Math.PI*2/number+rand(-.05,.05);let speed=radius*rand(.8,1.18);particle(x,y,Math.cos(theta)*speed,Math.sin(theta)*speed,color,opts.life||2.3,opts)}}

// Project stars on a spherical shell, giving a dense edge and scattered interior.
function sphericalBloom(x,y,number,radius,color,opts={},split=null){
 for(let i=0;i<number;i++){
  const depth=1-2*(i+.5)/number,angle=i*2.3999632297,plane=Math.sqrt(1-depth*depth),speed=radius*rand(.97,1.03);
  const vx=Math.cos(angle)*plane*speed,vy=Math.sin(angle)*plane*speed;
  const tint=split?(vx<0?split[0]:split[1]):color;
  particle(x,y,vx,vy,tint,opts.life||3.95,opts);
  const star=particles[particles.length-1];star.originX=x;star.originY=y;star.depth=depth;
 }
}

// Uploaded recording by 効果音ラボ; split at the burst in the decoded buffer.
let audioCtx=null,masterGain=null,whistle=null,soundSources=new Set(),audioRun=0;
const BURST_AUDIO_OFFSET=1.97;
let fireworkBuffer=null,decodePromise=null,launchRequest=0,groupRoarPlayed=false;
const recordingPromise=fetch('./audio/firework-launch.mp3').then(r=>{if(!r.ok)throw Error('audio download');return r.arrayBuffer()}).catch(()=>null);
let soundPrefs={enabled:true,volume:.5};
try{const saved=JSON.parse(localStorage.getItem('hanabi-sound')||'null');if(saved){soundPrefs.enabled=saved.enabled!==false;const v=Number(saved.volume);if(Number.isFinite(v))soundPrefs.volume=Math.max(0,Math.min(1,v))}}catch(e){}
function updateSound(){
 $('soundEnabled').checked=soundPrefs.enabled;$('soundVolume').value=Math.round(soundPrefs.volume*100);$('soundVolumeValue').textContent=Math.round(soundPrefs.volume*100)+'%';
 if(masterGain){masterGain.gain.cancelScheduledValues(audioCtx.currentTime);masterGain.gain.setTargetAtTime(soundPrefs.enabled?soundPrefs.volume:0,audioCtx.currentTime,.015)}
 try{localStorage.setItem('hanabi-sound',JSON.stringify(soundPrefs))}catch(e){}
}
function stopSounds(){for(const node of soundSources){try{node.stop()}catch(e){}}soundSources.clear();whistle=null}
function ensureAudio(){
 try{const AC=window.AudioContext||window.webkitAudioContext;if(!AC){$('soundNote').textContent='このブラウザでは音を利用できません。';return null}
 if(!audioCtx){audioCtx=new AC();masterGain=audioCtx.createGain();masterGain.gain.value=soundPrefs.enabled?soundPrefs.volume:0;masterGain.connect(audioCtx.destination)}
 const resumed=audioCtx.state!=='running'?audioCtx.resume():Promise.resolve();
 if(!decodePromise)decodePromise=recordingPromise.then(data=>{if(!data)throw Error('audio unavailable');return audioCtx.decodeAudioData(data.slice(0))}).then(buffer=>{fireworkBuffer=buffer});
 return Promise.all([resumed,decodePromise]);
 }catch(e){$('soundNote').textContent='音を開始できませんでした。もう一度打ち上げてください。';return null}
}
function trackSound(node){soundSources.add(node);node.onended=()=>{soundSources.delete(node);try{node.disconnect()}catch(e){}};return node}
function startWhistle(){
 if(!soundPrefs.enabled||!fireworkBuffer||!audioCtx||audioCtx.state!=='running'||t>=BURST_AUDIO_OFFSET||!active)return;
 const source=trackSound(audioCtx.createBufferSource());source.buffer=fireworkBuffer;
 source.playbackRate.value=(1)*(Number($('speed').value)/100);
 source.connect(masterGain);whistle=source;source.start(0,Math.min(t/BURST_AUDIO_OFFSET,1)*BURST_AUDIO_OFFSET,BURST_AUDIO_OFFSET*(1-Math.min(t/BURST_AUDIO_OFFSET,1)));
}
function launchSound(){++audioRun;stopSounds();startWhistle()}
function updateWhistle(){if(whistle&&audioCtx)whistle.playbackRate.setTargetAtTime((1)*(Number($('speed').value)/100),audioCtx.currentTime,.01)}
function boomSound(){
 if(whistle){try{whistle.stop()}catch(e){}whistle=null}
 if(!soundPrefs.enabled||!fireworkBuffer||!audioCtx||audioCtx.state!=='running')return;
 const source=trackSound(audioCtx.createBufferSource());source.buffer=fireworkBuffer;source.connect(masterGain);source.start(0,BURST_AUDIO_OFFSET);
}
// A synthesized rushing sound for 群声, separate from the uploaded launch recording.
function groupRoarSound(){
 if(!soundPrefs.enabled||!audioCtx||audioCtx.state!=='running')return;
 const now=audioCtx.currentTime,duration=2.2,buffer=audioCtx.createBuffer(1,Math.ceil(audioCtx.sampleRate*duration),audioCtx.sampleRate),data=buffer.getChannelData(0);
 let smooth=0;for(let i=0;i<data.length;i++){const white=Math.random()*2-1;smooth=.97*smooth+.03*white;data[i]=white*.38+smooth*2.6}
 const source=trackSound(audioCtx.createBufferSource()),filter=audioCtx.createBiquadFilter(),gain=audioCtx.createGain();source.buffer=buffer;
 filter.type='lowpass';filter.frequency.setValueAtTime(1100,now);filter.frequency.linearRampToValueAtTime(2300,now+.45);filter.frequency.linearRampToValueAtTime(550,now+duration);
 gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(.46,now+.20);gain.gain.linearRampToValueAtTime(.28,now+.85);gain.gain.linearRampToValueAtTime(.12,now+1.5);gain.gain.linearRampToValueAtTime(0,now+duration);
 source.connect(filter);filter.connect(gain);gain.connect(masterGain);source.start();source.stop(now+duration);
}
$('settings').onclick=()=>$('soundDialog').showModal();$('closeSound').onclick=()=>$('soundDialog').close();
$('soundEnabled').onchange=()=>{soundPrefs.enabled=$('soundEnabled').checked;if(!soundPrefs.enabled){++audioRun;stopSounds()}else{const ready=ensureAudio();if(ready)ready.catch(()=>{})}updateSound()};
$('soundVolume').oninput=()=>{soundPrefs.volume=Number($('soundVolume').value)/100;updateSound()};
document.addEventListener('visibilitychange',()=>{if(document.hidden){++audioRun;stopSounds()}});
updateSound();

function launch(){const request=++launchRequest;stopSounds();const ready=soundPrefs.enabled?ensureAudio():null;const begin=()=>{if(request===launchRequest)beginLaunch()};if(ready)ready.then(begin).catch(()=>{$('soundNote').textContent='音源を読み込めませんでした。再読み込みしてお試しください。';begin()});else begin()}
function clearSky(){ctx.globalAlpha=1;ctx.globalCompositeOperation="source-over";ctx.clearRect(0,0,W,H)}
function beginLaunch(){prepareAscentPattern();groupRoarPlayed=false;clearSky();kikuAfterglowCtx.clearRect(0,0,W,H);kikuSmokeCtx.clearRect(0,0,W,H);if(!current&&!generate(false))return;resetPeakPhoto();peakName=current.name;$('snapshot').disabled=false;t=0;particles=[];trails=[];flashes=[];bloomFlashes=[];active=true;burstDone=false;paused=false;$('status').textContent='ASCENT — 打ち上げ中';lastTime=performance.now();launchSound()}
function burst(x,y){const mainStart=particles.length;const v=current, sh=v.shape, clr=cColor(v.baseColor), seq=v.sequence.map(cColor), end=v.ending;
const flicker=end==='点滅'; // 先点滅は末端のみ点滅（下の p.ending 判定）
// 開花直後の一瞬の閃光。星の種類を変えずに「玉が割れた」瞬間を強調する。
// 菊は星の筋そのものを見せる。中心に大きな白い閃光を重ねない。
if(sh!=='kiku')bloomFlashes.push({x,y,color:clr,age:0,life:sh==='thunder'?.62:sh==='palm'?.32:.47,ring:sh!=='fly'&&sh!=='bee'&&sh!=='palm'&&sh!=='crown'&&sh!=='senrin',strength:sh==='thunder'?1.35:['botan','heart','saturn'].includes(sh)?.68:sh==='senrin'?.16:1});
let count=sh==='kiku'?230:sh==='botan'?210:sh==='crown'?195:sh==='senrin'?0:132;
const splitCols=(v.mode==='染分' && seq.length>=2)?[seq[0],seq[1]]:null;
const opts={life:3.95,trail:sh==='kiku'?1.0:sh==='botan'?.2:sh==='crown'?1.95:.5,seq:splitCols?[]:seq,seqMode:v.mode,grav:sh==='crown'?36:sh==='willow'?44:sh==='botan'?6.5:14,flicker,size:sh==='botan'?5.4:4.7};
if(sh==='senrin'){
 // Small shells travel out from the parent, then each opens into its own sphere.
 const shells=21;
 for(let i=0;i<shells;i++){
   const depth=1-2*(i+.5)/shells,angle=i*2.3999632297,plane=Math.sqrt(1-depth*depth);
   const speed=rand(165,185),color=v.originalType.includes('彩色')?cColor(pick(['紅','緑','青','黄','紫','銀'])):clr;
   particle(x,y,Math.cos(angle)*plane*speed,Math.sin(angle)*plane*speed,color,rand(.78,1.02),{kind:'senrin-shell',drag:.998,grav:5,trail:0,size:1,flicker:false});
   const shell=particles[particles.length-1];shell.depth=depth;shell.bloomFlicker=flicker;shell.hasCore=Boolean(v.core);
 }
}else if(sh==='willow'){
  if(v.originalType==='糸柳'){
    // Project a full sphere so slow inner stars fill the center, with long fine threads.
    const start=particles.length;
    sphericalBloom(x,y,210,145,clr,{...opts,kind:'thread-willow',grav:25,drag:.989,life:5.8,trail:0,size:3.2});
    for(const star of particles.slice(start))star.path=[{x,y,time:t}];
  }else{
    // v1.0.53の単発柳の枝垂れ方を維持し、開花初速のみ横向きに回す。
    // 重力は画面下方向のままなので、横に張り出した後は自然に垂れ下がる。
    const turn=68*Math.PI/180, turnCos=Math.cos(turn),turnSin=Math.sin(turn);
    const toSideways=(vx,vy)=>({vx:(vx*turnCos-vy*turnSin)*.78,vy:(vx*turnSin+vy*turnCos)*.92});
    const branchCount=80;
    for(let j=0;j<branchCount;j++){
      // 横方向の広がり。中心寄りほど高く上がり、外側ほど横へ張る。
      const sideSpread=(j+.5)/branchCount*2-1; // -1..1
      const lateral=Math.sign(sideSpread)*Math.pow(Math.abs(sideSpread),.78);
      const lift=1-Math.abs(lateral)*.55;
      const sourceVx=lateral*rand(60,122);
      const sourceVy=-rand(150,205)*(0.84+.22*lift);
      const {vx,vy}=toSideways(sourceVx,sourceVy);
      const life=rand(4.95,5.65);
      const tint=splitCols?(lateral<0?splitCols[0]:splitCols[1]):clr;
      particle(x+rand(-4,4),y+rand(-2,2),vx,vy,tint,life,{kind:'willow-branch',grav:rand(68,78),drag:.99755,
        trail:0,size:2.34,seq:splitCols?[]:seq,seqMode:v.mode,flicker:false,delay:rand(0,.03)});
      const star=particles[particles.length-1];
      star.path=[{x,y,time:t}];star.willowPathTime=t;
      star.willowFadeOffset=rand(-.16,.18);star.willowLineWidth=rand(.72,1.16);
      star.willowBranchLength=rand(3.15,3.85);
    }
    // 少量の内側枝を足し、上部の密度を整える。
    for(let j=0;j<12;j++){
      const {vx,vy}=toSideways(rand(-26,26),-rand(146,188));
      particle(x,y,vx,vy,clr,rand(4.85,5.35),{kind:'willow-branch',grav:rand(70,78),drag:.9976,
        trail:0,size:2.18,seq:splitCols?[]:seq,seqMode:v.mode,flicker:false,delay:rand(0,.02)});
      const star=particles[particles.length-1];
      star.path=[{x,y,time:t}];star.willowPathTime=t;
      star.willowFadeOffset=rand(-.12,.12);star.willowLineWidth=rand(.64,.96);
      star.willowBranchLength=rand(2.95,3.45);
    }
  }
}else if(sh==='crown'){
  // 冠菊：開花と枝垂れを少し速く。光筋は一括パスで描いて負荷を抑える。
  const start=particles.length;
  sphericalBloom(x,y,205,158,clr,{...opts,kind:'crown-star',grav:rand(57,67),drag:.994,life:rand(3.75,4.30),trail:0,size:3.5},splitCols);
  for(const star of particles.slice(start)){
    star.vx*=1.14;star.vy*=1.14;
    star.path=[{x,y,time:t}];
    star.crownSparkSeed=rand(0,6.283);
    star.crownFall=rand(.91,1.14);
    star.grav=62*star.crownFall;
    star.emberAt=rand(.36,.92);star.emberDone=false;
  }
}
else if(sh==='bee'){
 // 蜂：一つの球形に並ばず、個々の蜂星が噴射しながら方向を変えて走り回る。
 // 少数の明るい星を時間差で放ち、短い曲線と不規則な速度差を作る。
 const beeColors=v.originalType.includes('彩色')?['紅','緑','青','黄','紫'].map(cColor):
   v.originalType.includes('銀')?['#eaf3ff','#c7e8ff']:v.originalType.includes('紅')?[cColor('紅'),'#ff9d8b']:[clr];
 for(let i=0;i<30;i++){
   const angle=rand(0,Math.PI*2),speed=rand(72,151),life=rand(2.1,3.0);
   const tint=pick(beeColors);
   particle(x,y,Math.cos(angle)*speed,Math.sin(angle)*speed,tint,life,
     {kind:'bee',trail:0,grav:rand(0,9),drag:rand(.991,.997),size:3.8,delay:rand(0,.22)});
   const star=particles[particles.length-1];
   star.beePhase=rand(0,Math.PI*2);
   star.beeTurn=rand(-2.4,2.4);
   star.beePulse=rand(6.5,12);
   star.beeThrust=rand(12,38);
   star.beeTrail=[];
   star.beeTrailTime=t;
 }
}
else if(sh==='fly'){
 const scale=Math.min(1.12,Math.max(.5,Math.min(W/690,H/485)));
 for(let i=0;i<42;i++){
   const angle=rand(0,Math.PI*2),speed=rand(18,145),life=rand(2.5,3.8);
   const px=x+rand(-90,90)*scale,py=y+rand(-75,75)*scale;
   particle(px,py,Math.cos(angle)*speed,Math.sin(angle)*speed,clr,life,{kind:'fly',trail:0,grav:14,drag:.995,delay:rand(0,.18),size:2.7});
   const star=particles[particles.length-1];star.turn=rand(-.38,.38);star.path=[];
 }
}
else if(sh==='thunder'){
 // 花雷は単発の白い閃光ではなく、時間差で小花が弾ける連続破裂として描写。
 // 各小花に明るい中心と細かな外周星を置き、暗い背景でも形が見えるようにする。
 const scale=Math.min(1.05,Math.max(.52,Math.min(W/690,H/500)));
 for(let g=0;g<11;g++){
   const a=g*2.39996, r=g===0?0:38+Math.sqrt(g/11)*156;
   const cx=x+Math.cos(a)*r*scale,cy=y+Math.sin(a)*r*.73*scale;
   const delay=g*.20;
   const tint=clr;
   // 発光する核を長めに残す。
   particle(cx,cy,0,0,'#ffffff',1.05,{delay,trail:0,grav:0,drag:1,size:7.0,kind:'thunder-core'});
   for(let j=0;j<32;j++){
     const q=j*Math.PI*2/32+rand(-.08,.08),speed=rand(28,105);
     particle(cx,cy,Math.cos(q)*speed,Math.sin(q)*speed,tint,1.75,{delay,trail:.52,grav:5,drag:.991,size:4.5,kind:'thunder-spark'});
   }
 }
 // 主玉の大輪も維持し、破裂の広がりが一目で分かるようにする。
 sparks(x,y,95,160,'#ffffff',{life:1.85,trail:.48,grav:3,size:4.8,kind:'thunder-spark'});
}
else if(sh==='palm'){
 // 単発の椰子：密な球ではなく、長さと方向が不揃いの太い葉脈が一斉に開く。
 // 参考動画のように上・左右へ強く伸び、先端が重力で下がる。
 const branches=21,rotation=rand(-.14,.14);
 for(let i=0;i<branches;i++){
  const a=rotation+(i+.45)*Math.PI*2/branches+rand(-.13,.13);
  const speed=rand(177,252)*(Math.sin(a)> .60?.82:1);
  const tint=splitCols?(Math.cos(a)<0?splitCols[0]:splitCols[1]):clr;
  particle(x,y,Math.cos(a)*speed,Math.sin(a)*speed*.88,tint,rand(3.65,4.65),
   {...opts,kind:'palm-frond',trail:0,grav:rand(43,59),drag:rand(.993,.997),size:5.8});
  const star=particles[particles.length-1];
  star.path=[{x,y,time:t}];
  star.palmCurve=rand(-13,13);
  star.palmGlow=rand(.82,1.12);
  star.palmSparkSeed=rand(0,6.28);
 }
}
else if(sh==='heart'){
 // 輪郭を構成する星を、牡丹と同じ丸い発光点で見せる。
 for(let i=0;i<66;i++){
   const a=i*Math.PI*2/66,px=16*Math.pow(Math.sin(a),3)/17,py=-(13*Math.cos(a)-5*Math.cos(2*a)-2*Math.cos(3*a)-Math.cos(4*a))/17;
   particle(x,y,px*145,py*145,clr,3.35,{kind:'shape-star',trail:0,grav:3.5,drag:.987,size:4.2});
   const star=particles[particles.length-1];star.botanRadius=rand(.98,1.52);star.botanGlow=rand(.7,1.1);
 }
}
else if(sh==='saturn'){
 // Project a sphere of stars inside a wider, tilted equatorial ring.
 const tilt=-.20,cos=Math.cos(tilt),sin=Math.sin(tilt);
 for(let i=0;i<112;i++){
   const z=1-2*(i+.5)/112,a=i*2.3999632297,r=Math.sqrt(1-z*z);
   particle(x,y,Math.cos(a)*r*86,z*86,clr,3.8,{trail:.04,grav:1,drag:.988,size:4.0,kind:'shape-star'});
   const star=particles[particles.length-1];star.botanRadius=rand(.92,1.50);star.botanGlow=rand(.70,1.1);
 }
 for(let i=0;i<76;i++){
   const a=i*Math.PI*2/76,px=Math.cos(a)*174,py=Math.sin(a)*49;
   particle(x,y,px*cos-py*sin,px*sin+py*cos,clr,3.8,{trail:.06,grav:1,drag:.988,size:4.2,kind:'shape-star'});
   const star=particles[particles.length-1];star.botanRadius=rand(1.02,1.58);star.botanGlow=rand(.75,1.12);
 }
}
else if(sh==='cluster'){
 // Several close, nearly parallel stars form each petal of a single bloom.
 const rotation=rand(0,Math.PI*2),bundles=9;
 for(let group=0;group<bundles;group++){
   const direction=rotation+group*Math.PI*2/bundles+rand(-.09,.09),baseSpeed=rand(135,190),life=rand(3.1,3.7);
   for(let j=0;j<7;j++){
     const angle=direction+(j-3)*.013+rand(-.006,.006),speed=baseSpeed*rand(.94,1.06);
     particle(x,y,Math.cos(angle)*speed,Math.sin(angle)*speed,clr,life,{kind:'cluster-bundle',trail:0,grav:16,drag:.992,size:2.8});
     const star=particles[particles.length-1];star.bundle=group;star.path=[];
   }
 }
 // Brief white stars scatter through the gaps between the long petal bundles.
 for(let gap=0;gap<bundles;gap++)for(let j=0;j<6;j++){
   const angle=rotation+(gap+.5)*Math.PI*2/bundles+rand(-.20,.20),speed=rand(65,210);
   particle(x,y,Math.cos(angle)*speed,Math.sin(angle)*speed,'#f2f7ff',rand(1.15,1.65),{kind:'cluster-white',delay:rand(.06,.16),trail:0,grav:11,drag:.986,size:4.8});
 }
}
else {
 if(sh==='kiku'||sh==='botan'){
   const start=particles.length;
   if(sh==='kiku'){
     // 菊の花形・星数・開花速度・消え方は牡丹と完全に共通。
     // 相違は星の通過地点に残る、時間とともに消える尾だけ。
     // 参考録画：密集した510本の直線ではなく、各星が軌跡を引く放射花弁。
     // 牡丹と同等の開花半径を保ちつつ、初動を少し速める。
     sphericalBloom(x,y,310,210,clr,
       {...opts,grav:12,drag:.988,life:3.35,kind:'kiku-star'},splitCols);
     for(const star of particles.slice(start)){
       // 菊先は渋い橙色の控えめな尾、錦先は輝度の高い金色の尾。
       // 染分は左右を縦に二分割し、星先と引きの尾を同じ色にする。
       star.botanRadius=rand(.92,1.55);
       star.botanGlow=rand(.65,1.1);
       star.kikuNishiki=v.baseColor==='錦';
       const rawTrailColor=star.kikuNishiki?'#efbc62':'#dce7f2';
       star.trailColor=dimKikuTrailColor(rawTrailColor,star.kikuNishiki);
       // ⑥が星先。染分の場合は左右それぞれの⑥の色、その他は先頭の⑥の色。
       star.kikuHeadColor=splitCols?star.color:(seq[0]||clr);
       // 菊は牡丹と違って「引き先行」。星本体の発色は少し遅らせる。
       star.kikuHeadDelay=.11+twinkleHash(star.twinkleSeed^0x54aa)*.04;
       star.kikuHeadFadeIn=.16+twinkleHash(star.twinkleSeed^0x21bd)*.06;
       star.kikuTailBrightness=star.kikuNishiki?1.18:.86;
       // 星ごとに先端の変色開始をわずかにずらし、外周が一斉に塗り替わらないようにする。
       star.kikuTipOffset=(twinkleHash(star.twinkleSeed^0x7c35)-.5)*.055;
       star.kikuTrail=[{x,y,time:t}];star.kikuTrailTime=t;star.kikuOriginX=x;star.kikuOriginY=y;
       star.kikuTailVariation=.78+twinkleHash(star.twinkleSeed^0x9d27)*.43;
       star.kikuTailLife=.94+twinkleHash(star.twinkleSeed^0x723a)*.27;
       // ひとつひとつの尾の減光開始をずらし、輪郭が一斉に消えないようにする。
       star.kikuBurnOffset=(twinkleHash(star.twinkleSeed^0x3f31)-.5)*.22;
     }
   }else{
     sphericalBloom(x,y,510,194,clr,
       {...opts,grav:3.5,drag:.987,life:3.35,kind:'botan-star'},splitCols);
     for(const star of particles.slice(start)){
       star.botanRadius=rand(.92,1.55);
       star.botanGlow=rand(.65,1.1);
     }
   }
 }else{
   sparks(x,y,count,188,clr,opts);
 }
}

// 菊・牡丹・冠菊の開花時だけ、親星と同色の短命な火花を少量追加。
// 形状を変えないため、型物・千輪・飛遊星などには加えない。
if(['botan','crown','heart','saturn'].includes(sh)){
 const accents=sh==='botan'?24:sh==='crown'?36:18;
 for(let i=0;i<accents;i++){
  const a=i*2.3999632297+rand(-.16,.16),sp=rand(48,112);
  particle(x,y,Math.cos(a)*sp,Math.sin(a)*sp,splitCols?(Math.cos(a)<0?splitCols[0]:splitCols[1]):clr,rand(.48,.78),
   {kind:'bloom-glint',size:2.1,trail:sh==='crown'?.3:0,grav:4,drag:.982});
 }
}
const mainStars=particles.slice(mainStart);
mainStars.forEach((star,index)=>{
 star.ending=end;star.endingIndex=index;
 star.keepRing=Number.isFinite(star.depth)?Math.abs(star.depth)<.14:index%3===0;
 // 開花直後の中心光（bloom-glint）は後の曲の発生元にしない。
 // 親花の星だけを起点にすることで、中心に白い輪が現れるのを防ぐ。
 star.smallBloomSeed=star.kind!=='bloom-glint'&&index%Math.max(1,Math.floor(mainStars.length/11))===0;
 star.endingAccentSeed=index%Math.max(1,Math.floor(mainStars.length/48))===0;
});
// 芯は親星とは独立した「同心の小さな球」。親星と同時に割れ、同じ時間で消える。
// 画面上の円周を描くのではなく、球面上の星を3D投影して内側にも星を配置する。
if(v.core&&sh!=='senrin'){
 const coreName=v.core;
 const coreLayers=coreName.includes('五重')?5:coreName.includes('四重')?4:
   coreName.includes('三重')?3:coreName.includes('八重')?2:1;
 const parentRadius=sh==='kiku'?188:sh==='botan'?194:188;
 const parentLife=(sh==='botan'||sh==='kiku')?3.35:opts.life;
 const parentGrav=(sh==='botan'||sh==='kiku')?3.5:opts.grav;
 const parentDrag=(sh==='botan'||sh==='kiku')?.987:.988;
 const colors=['紅','緑','青','黄','紫','銀','金'].map(cColor);
 // 参考映像：八重芯変化菊では内側が黄→緑、外側が橙→紅へ変わる。
 // その他の芯・通常の菊の色指定は従来どおり。
 const referenceYae=sh==='kiku'&&coreName.includes('八重')&&v.mode==='変化';
 // 親星・隣接する芯が同色にならないように色を決める。
 const used=[clr];
 const nextCoreColor=()=>{
   const options=colors.filter(c=>!used.includes(c));
   const pool=options.length?options:colors.filter(c=>c!==used[used.length-1]);
   const chosen=pick(pool);used.push(chosen);return chosen;
 };
 const emitCore=(ratio,color,n,layer,twinkle=false,mixed=false)=>{
   const radius=parentRadius*ratio;
   const phase=rand(0,Math.PI*2);
   for(let i=0;i<n;i++){
     // 球面を黄金角で均等に散らし、正面から見ても平面の輪にならないようにする。
     // 約75%の星を球面の外縁寄りに投影し、内側にも奥行きの星を残す。
     // 平面的な円周線ではなく、動画のように芯の層が独立して見える密度。
     const depth0=1-2*(i+.5)/n;
     const depth=i%5===0?depth0:Math.sign(depth0)*Math.pow(Math.abs(depth0),3.0);
     const angle=i*2.3999632297+phase;
     const plane=Math.sqrt(1-depth*depth);
     // 芯を輪郭の一本線に見せないよう、奥行き方向にも不規則に散らす。
     const velocity=radius*rand(.88,1.04);
     const tint=mixed?colors[(i*3+layer)%colors.length]:color;
     particle(x,y,Math.cos(angle)*plane*velocity,Math.sin(angle)*plane*velocity,tint,parentLife,
       {kind:'core-star',trail:0,drag:parentDrag,grav:parentGrav,seq:[],flicker:twinkle,size:3.2});
     const star=particles[particles.length-1];
     star.coreDepth=depth;star.coreLayer=layer;star.coreRadius=ratio;
     star.coreGlow=rand(.95,1.19);
     if(referenceYae){
       star.coreStartColor=i===-1?color:(layer===0?cColor('黄'):'#ef8b39');
       star.coreEndColor=layer===0?cColor('緑'):cColor('紅');
       star.coreReferenceYae=true;
     }
   }
 };
 if(coreName.includes('雌雄芯')){
   // 参考写真：中心の青紫の細い放射光と、太い錦色の椰子状の光彩。
   // 通常の芯の円環・球殻は生成しない。色は親玉の色や変化指定と無関係に固定。
   // 放射状の細い光だけは開花ごとに色を変える。錦色の太い枝は固定。
   const blue=cColor(pick(['紅','緑','青','黄','紫','銀','金']));
   const gold='#f7a44b',goldTip='#f9b66c';
   const blueCount=128,bluePhase=rand(0,Math.PI*2);
   for(let i=0;i<blueCount;i++){
     const theta=bluePhase+i*2.3999632297+rand(-.09,.09);
     const speed=parentRadius*rand(.28,.49);
     particle(x,y,Math.cos(theta)*speed,Math.sin(theta)*speed,blue,rand(1.40,1.88),
       {kind:'core-shiyu-blue',trail:0,drag:.985,grav:1.4,seq:[],size:1.2});
   }
   // 花のしべのように不均等な6〜8本の太い錦色の枝。
   // 各枝を複数の近接した火花に分け、先端がほぐれる椰子状にする。
   const armCount=7,phase=rand(0,Math.PI*2);
   for(let i=0;i<armCount;i++){
     const theta=phase+i*Math.PI*2/armCount+rand(-.22,.22);
     const baseSpeed=parentRadius*rand(.32,.47);
     for(let j=0;j<4;j++){
       const spread=j===0?0:(j-2)*rand(.035,.10);
       const angle=theta+spread;
       const speed=baseSpeed*(j===0?1:rand(.78,1.10));
       particle(x,y,Math.cos(angle)*speed,Math.sin(angle)*speed,
         j===0?gold:goldTip,rand(1.70,2.20),
         {kind:'core-stamen',trail:0,drag:.987,grav:2.7,seq:[],size:2.0});
       const star=particles[particles.length-1];
       star.stamenStartX=x;star.stamenStartY=y;
       star.stamenStrength=j===0?1:rand(.38,.72);
       star.stamenCurve=rand(-1,1)*(j===0?.09:.21);
       star.stamenBranch=j!==0;
     }
   }
 }else if(coreName.includes('彩色芯')){
   // 彩色芯は一つの小さな球に複数の色が混ざる。
   emitCore(.34,null,60,0,false,true);
 }else{
   const ratios=coreLayers===1?[.35]:
     Array.from({length:coreLayers},(_,i)=>
       (coreLayers>=4?.115:.17)+i*((coreLayers>=4?.535:.48)/Math.max(1,coreLayers-1)));
   ratios.forEach((ratio,i)=>{
     let color=referenceYae?(i===0?cColor('緑'):cColor('紅')):nextCoreColor();
     if(coreName.includes('輝光緑'))color=cColor('緑');
     if(coreName.includes('紅輝光'))color=cColor('紅');
     // 内側から外側へ。各芯の層は親星より小さく、星の重なりを防ぐ。
     emitCore(ratio,color,i===0?58:Math.max(64,92-i*6),i,
       coreName.includes('点滅')||coreName.includes('キラ'));
   });
 }
}
if(splitCols){particles.slice(mainStart).forEach(p=>{
 // 染分の親星・付随火花は左半分／右半分の色に統一。芯星などの独立演出は除外。
 if(['core-star','core-shiyu-blue','core-stamen','senrin-shell'].includes(p.kind))return;
 const tint=p.vx<0?splitCols[0]:splitCols[1];
 p.color=tint;p.seq=[];if(p.kind==='kiku-star'){p.trailColor=tint;p.kikuNishiki=false}
 })}
$('status').textContent='BLOOM — '+v.originalType;
}
// End effects change the existing stars; they never relocate them.
function retainEndingStar(star){
 if(star.ending!=='かすみ草'&&!(star.ending==='残輪'&&star.keepRing))return false;
 const mist=star.ending==='かすみ草';
 star.ending='なし';star.kind='ending-residue';star.color='#e9f4ff';star.seq=[];
 star.life=star.ttl=mist?.95:1.3;star.flicker=false;
 if(mist){star.vx=0;star.vy=0;star.grav=0;star.drag=1}
 return true;
}
function openSmallBloom(star){
 star.smallBloomDone=true;
 // Anchor to the last visible star, without inheriting its outward drift.
 const x=star.lastVisibleX??star.x,y=star.lastVisibleY??star.y;
 // 均等な10点の円環は白い輪に見えるため、半径と角度にゆらぎを付けた小花にする。
 const petals=7+Math.floor(rand(0,3));
 const rotation=rand(0,Math.PI*2);
 const color=star.color;
 for(let j=0;j<petals;j++){
  const angle=rotation+(j+rand(-.27,.27))*Math.PI*2/petals;
  const speed=rand(15,34);
  particle(x,y,Math.cos(angle)*speed,Math.sin(angle)*speed,
   j%4===0?'#f7f4e7':color,rand(.86,1.17),
   {kind:'ending-small-flower',trail:0,grav:5,size:rand(1.7,2.7),delay:rand(0,.075)});
  const child=particles[particles.length-1];child.originX=x;child.originY=y;child.newSmallBloom=true;
 }
}
function releaseEndingAccent(star){
 // 玉名の消え際だけに対応した小さな追加星。大輪の再爆発はさせない。
 star.endingAccentDone=true;
 const kind=star.ending;
 const x=star.lastVisibleX??star.x,y=star.lastVisibleY??star.y;
 const count=kind==='銀乱'?5:kind==='先割'?4:3;
 for(let i=0;i<count;i++){
  const a=(i/count)*Math.PI*2+rand(-.32,.32),speed=kind==='降雪'?rand(5,18):rand(15,43);
  const color=kind==='先割'?'#fff4d7':'#eaf5ff';
  particle(x,y,Math.cos(a)*speed,Math.sin(a)*speed,color,kind==='降雪'?1.25:rand(.46,.8),
   {kind:kind==='降雪'?'ending-snow':'ending-crackle',trail:0,grav:kind==='降雪'?32:6,drag:.985,size:kind==='降雪'?1.8:2.4,flicker:kind==='銀乱'});
 }
}
function drawBloomFlashes(dt){
 for(let i=bloomFlashes.length-1;i>=0;i--){
  const f=bloomFlashes[i];f.age+=dt;
  const p=f.age/f.life;if(p>=1){bloomFlashes.splice(i,1);continue}
  const fade=(1-p)*(1-p),scale=Math.min(W/600,H/430,1.1);
  ctx.save();ctx.globalCompositeOperation='lighter';
  const radius=(18+72*Math.sqrt(p))*scale;
  const g=ctx.createRadialGradient(f.x,f.y,0,f.x,f.y,radius);
  g.addColorStop(0,'rgba(255,255,255,'+(fade*.21*f.strength)+')');
  g.addColorStop(.19,hexAlpha(f.color,fade*.22*f.strength));
  g.addColorStop(.6,hexAlpha(f.color,fade*.065*f.strength));
  g.addColorStop(1,hexAlpha(f.color,0));
  ctx.fillStyle=g;ctx.beginPath();ctx.arc(f.x,f.y,radius,0,Math.PI*2);ctx.fill();
  if(f.ring&&p<.76){
   ctx.globalAlpha=fade*.38*f.strength;ctx.strokeStyle=f.color;ctx.lineWidth=1.6;
   ctx.beginPath();ctx.arc(f.x,f.y,(8+93*p)*scale,0,Math.PI*2);ctx.stroke();
  }
  ctx.restore();
 }
}
function hexAlpha(hex,alpha){
 const [r,g,b]=rgb(hex);return `rgba(${r},${g},${b},${Math.max(0,Math.min(1,alpha))})`;
}
function openSenrinBloom(shell){
 // 千輪菊は「小さな菊がたくさん咲く」見た目を優先する。
 // 通常の菊と同じ尾→星先の描き方を使い、各小花だけ軽量化する。
 const start=particles.length;
 const radius=rand(48,60);
 const life=2.02;
 sphericalBloom(shell.x,shell.y,15,radius,shell.color,
   {kind:'senrin-kiku-star',life,trail:0,grav:7.5,drag:.991,size:2.55,flicker:shell.bloomFlicker});
 if(shell.hasCore){
   const coreColor=shell.color===cColor('銀')?cColor('金'):cColor('銀');
   sphericalBloom(shell.x,shell.y,5,radius*.36,coreColor,
     {kind:'senrin-kiku-star',life,trail:0,grav:7.5,drag:.991,size:2.15,flicker:shell.bloomFlicker});
 }
 for(const star of particles.slice(start)){
   star.vx+=shell.vx*.11;star.vy+=shell.vy*.11;
   star.flowerDepth=shell.depth;
   star.trailColor=star.color;
   star.kikuTailBrightness=.84;
   star.kikuTailVariation=.96+twinkleHash(star.twinkleSeed^0x9312)*.27;
   star.kikuTailLife=.74+twinkleHash(star.twinkleSeed^0x1d2b)*.16;
   star.kikuBurnOffset=(twinkleHash(star.twinkleSeed^0x4f03)-.5)*.16;
   star.kikuOriginX=shell.x;star.kikuOriginY=shell.y;
   star.kikuHeadDelay=.07+twinkleHash(star.twinkleSeed^0x54aa)*.03;
   star.kikuHeadFadeIn=.11+twinkleHash(star.twinkleSeed^0x21bd)*.04;
   star.botanRadius=rand(1.04,1.35);
   star.botanGlow=rand(.84,1.12);
   star.senrinMini=true;
  }
}

function ascentTone(as){
 for(const ch of ['紅','緑','青','黄','紫','銀','金','錦','輝'])if(as.includes(ch))return ch;
 return '銀';
}
function ascentRenderColor(tone){
 if(tone==='錦')return '#d99324'; // 琥珀寄りの錦色。白飛びしないよう彩度を保つ
 if(tone==='金')return '#e8a52d';
 if(tone==='輝')return '#f3f6ff';
 return cColor(tone);
}
function rocketYAt(progress,targetY){return H-30-(H-30-targetY)*progress}
function drawGlowDot(x,y,color,size,alpha=1){
 ctx.save();ctx.globalAlpha=alpha*.22;ctx.fillStyle=color;ctx.beginPath();ctx.arc(x,y,size*2.2,0,Math.PI*2);ctx.fill();
 ctx.globalAlpha=alpha;ctx.beginPath();ctx.arc(x,y,size,0,Math.PI*2);ctx.fill();ctx.restore();
}
function drawGlowLine(x1,y1,x2,y2,color,width,alpha=1){
 ctx.save();ctx.lineCap='round';ctx.strokeStyle=color;
 ctx.globalAlpha=alpha*.18;ctx.lineWidth=width*2.2;ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();
 ctx.globalAlpha=alpha;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();ctx.restore();
}
function drawMiniBurst(cx,cy,color,age,opt={}){
 const duration=opt.duration||.38;if(age<0||age>duration)return;
 const p=age/duration,alpha=(1-p)*(opt.alpha||.95),count=opt.count||10,inner=opt.inner||4,outer=(opt.outer||24)*(0.25+0.9*p);
 for(let i=0;i<count;i++){
   const a=(i/count)*Math.PI*2+(opt.twist||0)+p*.4;
   const x1=cx+Math.cos(a)*inner*p*.7,y1=cy+Math.sin(a)*inner*p*.7;
   const x2=cx+Math.cos(a)*outer,y2=cy+Math.sin(a)*outer;
   drawGlowLine(x1,y1,x2,y2,color,opt.width||1.1,alpha*.8);
 }
 drawGlowDot(cx,cy,'#fff8eb',opt.core||1.5,alpha);
}
function drawBurstFan(cx,cy,color,age,opt={}){
 const duration=opt.duration||.42;if(age<0||age>duration)return;
 const p=age/duration,alpha=(1-p)*(opt.alpha||.85),count=opt.count||7,spread=opt.spread||1.0;
 const base=opt.baseAngle||0,length=(opt.length||34)*(0.35+p*.9);
 for(let i=0;i<count;i++){
   const offset=(i-(count-1)/2)*spread/(count-1||1),a=base+offset;
   drawGlowLine(cx,cy,cx+Math.cos(a)*length,cy+Math.sin(a)*length,color,opt.width||1.15,alpha);
 }
}
function drawThunderPop(cx,cy,color,age){
 const duration=.28;if(age<0||age>duration)return;
 const p=age/duration,alpha=(1-p)*.95;
 drawGlowDot(cx,cy,'#ffffff',2.1+2.4*p,alpha);
 for(let i=0;i<8;i++){
   const a=i*Math.PI*2/8+p*.5,len=8+18*p;
   drawGlowLine(cx,cy,cx+Math.cos(a)*len,cy+Math.sin(a)*len,'#f7fbff',1.1,alpha*.8);
 }
 drawMiniBurst(cx,cy,color,age,{duration:.32,count:9,outer:18,width:.95,core:1.3,alpha:.7});
}
function drawHangingLight(cx,cy,color,age){
 const duration=.82;if(age<0||age>duration)return;
 const p=age/duration,hang=18+36*p;
 drawGlowLine(cx,cy,cx,cy+hang*.7,color,1.1,(1-p)*.42);
 drawGlowDot(cx,cy+hang,color,2.0,(1-p)*.95);
 drawGlowDot(cx,cy+hang+5,'#fffdf4',1.1,(1-p)*.8);
}
// 昇曲導は主玉の開花前だけ描画する。各小花の位置は打ち上げごとに固定する。
let ascentPattern=[];
function prepareAscentPattern(){
 ascentPattern=Array.from({length:5},(_,i)=>({
   side:i%2===0?-1:1,
   shift:rand(9,23),
   twist:rand(-.4,.4),
   scale:rand(.82,1.16),
   color:pick(['#f8d477','#e7f2ff','#f7b85b']),
   // 分包の小さな飛翔体は打上げごとに方向を固定する。
   fragments:Array.from({length:5},(_,j)=>({
     angle:j*Math.PI*2/5+rand(-.30,.30),
     speed:rand(24,61),
     turn:rand(-.85,.85),
     phase:rand(0,6.283)
   }))
 }));
}
function drawAscentEffects(x,targetY,as,time,dt){
 const progress=Math.min(time/BURST_AUDIO_OFFSET,1),yy=rocketYAt(progress,targetY);
 const tone=ascentTone(as),color=ascentRenderColor(tone);
 const isNone=!as||as==='なし',isRyu=as.includes('竜'),isBoku=as.includes('朴');
 const isKobana=as.includes('小花'),isBunpo=as.includes('分包')||as.includes('分砲'),isBunka=as.includes('分花');
 const goldenTail=tone==='錦'||tone==='金',headColor=goldenTail?'#f6bb53':'#fff9ef';
 const pulse=as.includes('点滅')?.55+.45*Math.max(0,Math.sin(time*24)):1;
 if(isNone){
   drawGlowLine(x,yy+8,x,yy,'rgba(226,232,244,.92)',.7,.15);
   drawGlowDot(x,yy,'#f6f8ff',1,.5);return;
 }
 if(isRyu){
   const tailLen=68;
   for(let k=0;k<3;k++){
     const sway=Math.sin(time*12+k*.9)*1.6;
     drawGlowLine(x+sway*.18,yy+tailLen*(.22*k),x-sway,yy+tailLen*(.35+.24*k),color,4-k*.75,.23*pulse);
   }
   drawGlowLine(x,yy+tailLen,x,yy+6,color,4.3,.98*pulse);
   // 銀竜：銀白の先端と、上昇方向に細く減光する火の粉。
   if(tone==='銀'){
     drawGlowLine(x,yy+tailLen*.55,x,yy+3,'#eaf5ff',1.05,.48*pulse);
     drawGlowDot(x,yy,'#ffffff',2.65,.95*pulse);
   }
   if(goldenTail)drawGlowLine(x,yy+tailLen*.86,x,yy+7,'#f1b348',1.5,.78*pulse);
   for(let k=0;k<10;k++){
     const q=k/10,dy=yy+12+q*tailLen,offset=Math.sin(time*31+k*2.6)*(1+q*4);
     drawGlowDot(x+offset,dy,color,1.1+1.5*(1-q),(.82-q*.55)*pulse);
   }
   drawGlowDot(x,yy,headColor,2.3,pulse);
   drawGlowDot(x,yy+10,color,1.8,.7*pulse);
 }else if(isBoku){
   // 朴：長い連続尾ではなく、上昇する明るい火点と短い断続的な火花。
   drawGlowDot(x,yy,headColor,2.45,pulse);
   for(let k=0;k<6;k++){
     const age=k*.115,offset=(time*37+k*9)%30;
     const spread=Math.sin(time*10+k*2.4)*(1.2+k*.22);
     const flicker=.35+.65*Math.abs(Math.sin(time*13+k*3.1));
     drawGlowDot(x+spread,yy+5+offset,color,1.35-k*.11,pulse*flicker*(.82-k*.09));
   }
 }else{
   // 小花・分包は本体の昇る火点を細く抑え、付加演出を見せる。
   const shortTail=isKobana||isBunpo||isBunka;
   drawGlowLine(x,yy+(shortTail?23:48),x,yy+4,color,shortTail?1.35:2.8,(shortTail?.45:.93)*pulse);
   for(let k=0;k<(shortTail?3:6);k++){
     const q=k/6;
     drawGlowDot(x+Math.sin(time*17+k*3)*2.4,yy+12+q*34,color,1.4-q*.65,.60-q*.37);
   }
   drawGlowDot(x,yy,headColor,2.3,pulse);
 }
 if(isKobana){
   // 小花：途中で「独立した丸い小花」が一つずつ開き、最後に主玉が開く。
   const timings=[.34,.58,.80];
   timings.forEach((pt,idx)=>{
     const age=time-BURST_AUDIO_OFFSET*pt;
     if(age<0||age>.57)return;
     const cfg=ascentPattern[idx],ey=rocketYAt(pt,targetY)+8;
     const ex=x+cfg.side*cfg.shift;
     drawMiniBurst(ex,ey,cfg.color,age,{
       duration:.57,count:12,inner:2.2,outer:24*cfg.scale,
       core:1.3,twist:cfg.twist,alpha:.95,width:1.35
     });
   });
 }
 if(isBunpo||isBunka){
   // 昇分包：上昇途中で複数の小さな飛翔体に分かれ、それぞれが
   // 違う方向へ進みながら小さな光跡を残す。単なる放射状の線にはしない。
   // 昇分花はこれより短く小さい開花にして区別する。
   const timings=isBunpo?[.30,.53,.76]:[.43,.70];
   timings.forEach((pt,idx)=>{
     const age=time-BURST_AUDIO_OFFSET*pt;
     const duration=isBunpo?.52:.40;
     if(age<0||age>duration)return;
     const cfg=ascentPattern[idx],ey=rocketYAt(pt,targetY)+5;
     const ex=x+cfg.side*cfg.shift*.42;
     const fade=Math.pow(1-age/duration,1.3);
     drawGlowDot(ex,ey,'#fff5d6',isBunpo?2.25:1.8,fade*.55);
     const fragments=cfg.fragments.slice(0,isBunpo?5:3);
     fragments.forEach((part,j)=>{
       const travel=age;
       const speed=part.speed*(isBunpo?1:.65)*cfg.scale;
       const curve=part.turn*travel*1.25;
       const ang=part.angle+curve;
       const px=ex+Math.cos(ang)*speed*travel;
       const py=ey+Math.sin(ang)*speed*travel+15*travel*travel;
       // 飛翔体ごとに少し湾曲した短い尾を描き、群れが枝分かれする印象に。
       const prev=Math.max(0,travel-.13);
       const oldAng=part.angle+part.turn*prev*1.25;
       const ox=ex+Math.cos(oldAng)*speed*prev;
       const oy=ey+Math.sin(oldAng)*speed*prev+15*prev*prev;
       const tint=j%3===0?'#fff0ca':cfg.color;
       drawGlowLine(ox,oy,px,py,tint,isBunpo?1.3:.95,fade*.70);
       drawGlowDot(px,py,tint,isBunpo?1.8:1.35,fade*.90);
     });
   });
 }
 if(as.includes('電光')){
   [.44,.66,.84].forEach((pt,idx)=>{
     const age=time-BURST_AUDIO_OFFSET*pt;if(age<0||age>.30)return;
     drawThunderPop(x+(idx-1)*18,rocketYAt(pt,targetY),color,age);
   });
 }
 if(as.includes('置光月')){
   [.48,.66,.82].forEach((pt,idx)=>{
     const age=time-BURST_AUDIO_OFFSET*pt;if(age<0||age>.82)return;
     drawHangingLight(x+(idx-1)*18,rocketYAt(pt,targetY)+4,'#f6e19a',age);
   });
 }
 if(as.includes('木葉')){
   [.42,.58,.74].forEach((pt,idx)=>{
     const age=time-BURST_AUDIO_OFFSET*pt;if(age<0||age>.36)return;
     const ey=rocketYAt(pt,targetY)+2;
     drawBurstFan(x-2,ey,color,age,{baseAngle:-2.55,spread:.90,length:22+idx*4,count:6,width:1});
     drawBurstFan(x+2,ey,color,age,{baseAngle:-.58,spread:.90,length:22+idx*4,count:6,width:1});
   });
 }
 if(as.includes('笛')){
   for(let r=0;r<2;r++){
     const radius=7+((time*84+r*8)%18);
     ctx.save();ctx.globalAlpha=.09;ctx.strokeStyle='#dcecff';ctx.lineWidth=1;
     ctx.beginPath();ctx.arc(x,yy,radius,0,Math.PI*2);ctx.stroke();ctx.restore();
   }
 }
 if(as.includes('点滅'))drawGlowDot(x,yy,color,3.1,.30*Math.max(0,Math.sin(time*24)));
}
function render(now){let dt=Math.min((now-lastTime)/1000,.045)*(Number($('speed').value)/100);lastTime=now;ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';if(active&&current.originalType!=='糸柳'&&!['kiku','botan','heart','saturn','fly','cluster','senrin','palm','crown'].includes(current.shape)){ctx.globalCompositeOperation='destination-out';ctx.fillStyle='rgba(0,0,0,.10)';ctx.fillRect(0,0,W,H);ctx.globalCompositeOperation='source-over'}else{clearSky()}ctx.globalAlpha=1;
// 菊だけ独立した残光。実時間に基づき滑らかに薄くなり、他の玉種には影響しない。
if(active&&current?.shape==='kiku'){
 // 先変化の開始前に、既に引いた尾の残光も消し切る。
 // 尾を発生させないだけでは蓄積レイヤーの古い色が残るため、後半は減衰を速める。
 const tipStars=particles.filter(p=>p.kind==='kiku-star'&&p.seqMode==='先'&&p.seq.length&&p.delay<=0);
 const tipProgress=tipStars.length?1-tipStars[0].ttl/tipStars[0].life:0;
 // 先色が現れる前に蓄積した引き色を確実に消す。
 const tipAfterglowFade=tipProgress>.26?Math.min(1,(tipProgress-.26)/.18):0;
 const afterglowRetention=.89-(.89-.10)*tipAfterglowFade;
 const fade=1-Math.pow(afterglowRetention,dt*60);
 // 先色が出始める時点では、以前の引き色の残光を一切重ねない。
 // 煙は別レイヤーなので、このクリア処理で消えない。
 // 先色より前、尾が燃え尽きる時点で旧引き色の残光を完全消去。
 // modeは表示側のcurrentではなく実際の星のseqModeで判定する。
 const tailExtinguished=tipStars[0]?.seq?.length>1?.43:.46;
 if(tipStars.length&&tipProgress>=tailExtinguished){
   kikuAfterglowCtx.save();
   kikuAfterglowCtx.setTransform(1,0,0,1,0,0);
   kikuAfterglowCtx.clearRect(0,0,kikuAfterglowCanvas.width,kikuAfterglowCanvas.height);
   kikuAfterglowCtx.restore();
 }
 kikuAfterglowCtx.save();kikuAfterglowCtx.setTransform(1,0,0,1,0,0);
 kikuAfterglowCtx.globalCompositeOperation='destination-out';
 kikuAfterglowCtx.fillStyle=`rgba(0,0,0,${fade})`;
 kikuAfterglowCtx.fillRect(0,0,kikuAfterglowCanvas.width,kikuAfterglowCanvas.height);
 kikuAfterglowCtx.restore();
 ctx.save();ctx.globalAlpha=.68;ctx.globalCompositeOperation='source-over';
 ctx.drawImage(kikuAfterglowCanvas,0,0,kikuAfterglowCanvas.width,kikuAfterglowCanvas.height,0,0,W,H);
 ctx.restore();
 // 煙は引きの残光と別レイヤーで管理。明るい尾が消えた後にだけ薄く残す。
 kikuSmokeCtx.save();kikuSmokeCtx.setTransform(1,0,0,1,0,0);
 kikuSmokeCtx.globalCompositeOperation='destination-out';
 kikuSmokeCtx.fillStyle=`rgba(0,0,0,${1-Math.pow(.975,dt*60)})`;
 kikuSmokeCtx.fillRect(0,0,kikuSmokeCanvas.width,kikuSmokeCanvas.height);
 kikuSmokeCtx.restore();
 ctx.save();ctx.globalCompositeOperation='source-over';ctx.globalAlpha=.24;
 ctx.drawImage(kikuSmokeCanvas,0,0,kikuSmokeCanvas.width,kikuSmokeCanvas.height,0,0,W,H);
 ctx.restore();
}
if(active){t+=dt;updateWhistle();if(current.ending==='群声'&&!groupRoarPlayed&&t>=BURST_AUDIO_OFFSET+2.6){groupRoarPlayed=true;groupRoarSound()}const x=W*.5,y=H*.42;
 if(t<BURST_AUDIO_OFFSET){
  drawAscentEffects(x,y,current.ascent,t,dt);
 }else if(!burstDone){burstDone=true;boomSound();burst(x,y)}
 for(let i=particles.length-1;i>=0;i--){
 let p=particles[i];if(p.delay>0){p.delay-=dt;continue}p.ttl-=dt;
 if(p.ttl<=0&&p.kind==='senrin-shell'){openSenrinBloom(p);particles.splice(i,1);continue}
 if(p.ttl<=0&&!retainEndingStar(p)){particles.splice(i,1);continue}
 if(p.kind==='bee'){
   // 速度ベクトルを連続的に曲げ、短い噴射の強弱で蛇行させる。
   const elapsed=p.life-p.ttl;
   const angular=p.beeTurn+Math.sin(elapsed*p.beePulse+p.beePhase)*1.05;
   const turn=angular*dt,c=Math.cos(turn),sn=Math.sin(turn);
   const vx=p.vx,vy=p.vy;
   p.vx=vx*c-vy*sn;p.vy=vx*sn+vy*c;
   const speed=Math.max(1,Math.hypot(p.vx,p.vy));
   const thrust=(.35+.65*Math.max(0,Math.sin(elapsed*p.beePulse+p.beePhase)))*p.beeThrust*dt;
   p.vx+=p.vx/speed*thrust;p.vy+=p.vy/speed*thrust;
 }
 if(p.kind==='fly'){const angle=p.turn*dt,c=Math.cos(angle),s=Math.sin(angle),vx=p.vx;p.vx=vx*c-p.vy*s;p.vy=vx*s+p.vy*c}
 if(p.kind==='palm-frond')p.vx+=p.palmCurve*dt;
 // 消え際の冠菊は細かな火の粉へほぐれて落ちる（白い輪や一斉消灯を作らない）。
 if(p.kind==='crown-star'&&!p.emberDone&&p.ttl>0&&p.ttl<p.emberAt){
   p.emberDone=true;
   if(Math.random()<.72){
     particle(p.x,p.y,rand(-13,13),rand(-7,20),p.color,rand(.42,.96),
       {kind:'crown-ember',grav:rand(17,32),drag:.986,trail:0,size:1.3});
   }
 }
 const oldX=p.x,oldY=p.y;
 if(p.newSmallBloom){p.newSmallBloom=false}else{p.x+=p.vx*dt;p.y+=p.vy*dt;}
 p.vx*=Math.pow(p.drag,dt*60);p.vy=p.vy*Math.pow(p.drag,dt*60)+p.grav*dt;
 // 菊の尾は星が通った位置を少数だけ記録する。時間で古い点を削除し、重い残像バッファは使わない。
 if(p.kind==='bee'){
   if(t-p.beeTrailTime>.045){p.beeTrail.push({x:p.x,y:p.y,time:t});p.beeTrailTime=t}
   while(p.beeTrail.length>8||p.beeTrail.length>1&&t-p.beeTrail[0].time>.30)p.beeTrail.shift();
 }
 if(p.kind==='kiku-star'||p.kind==='senrin-kiku-star'){
   if(!p.kikuTrail){
     p.kikuTrail=[{x:oldX,y:oldY,time:t-dt}];
     p.kikuOriginX=oldX;p.kikuOriginY=oldY;
   }
   if(t-(p.kikuTrailTime||0)>=(p.kind==='senrin-kiku-star'?.060:.045)){
     p.kikuTrail.push({x:p.x,y:p.y,time:t});p.kikuTrailTime=t;
   }
   while(p.kikuTrail.length>2&&(p.kikuTrail.length>(p.kind==='senrin-kiku-star'?24:80)||t-p.kikuTrail[1].time>(p.kind==='senrin-kiku-star'?1.35:1.75*(p.kikuTailLife||1))))p.kikuTrail.shift();
 }
 const lifeFrac=1-p.ttl/p.life,seq=p.seq;
 let co=p.color;
 if(seq.length){
   if(p.seqMode==='先'&&p.kind!=='kiku-star'){
     const start=0.52;
     if(lifeFrac>=start){
       const local=(lifeFrac-start)/(1-start);
       const ix=Math.min(seq.length-1,Math.floor(local*seq.length));
       if(ix>=0)co=seq[ix];
     }
   }else{
     const phase=(lifeFrac-.35)/.65;
     if(phase>=0){const ix=Math.min(seq.length-1,Math.floor(phase*seq.length));co=seq[ix]}
   }
 }
 // 菊の「変化」でも③の引き色を星に混ぜない。星の色は⑥だけで構成する。
 if(p.kind==='kiku-star'&&p.seqMode==='変化'&&seq.length){
   co=seq[0];
   if(seq.length>1){
     const v=Math.max(0,Math.min(1,(lifeFrac-.48)/.19));
     co=mixFireworkColor(seq[0],seq[1],v);
   }
 }
 // 参考映像の八重芯変化菊：開花直後の暖色→指定した変化色→
 // 消え際の淡い金色。星の位置を変えず、燃焼段階だけを変える。
 const referenceChangingKiku=p.kind==='kiku-star'&&current.core.includes('八重')&&p.seqMode==='変化';
 if(referenceChangingKiku){
   const f=lifeFrac;
   const warm='#e68c42',first=seq[0]||p.color,second=seq[1]||first;
   if(f<.17)co=mixFireworkColor(warm,first,Math.min(1,f/.17));
   else if(f<.45)co=first;
   else if(f<.67)co=mixFireworkColor(first,second,(f-.45)/.22);
   else if(f<.80)co=second;
   else co=mixFireworkColor(second,'#cba565',Math.min(1,(f-.80)/.18));
 }
 // 菊先〇：最初は引き色の菊が開き、外周に達する頃だけ先端の火色が変わる。
 // ⑥が2色なら外周で一色目、そのさらに先で二色目に変化。
 // 親星の尾はこの色変化に巻き込まず、元の引き色を保つ。
 let kikuTipIntensity=0;
 if(p.kind==='kiku-star'&&p.seqMode==='先'&&seq.length){
   // ③の銀・錦は尾専用。星先は最初の発光から⑥の色になる。
   // 引きが先に出る時間差は kikuHeadAppear が担当する。
   co=seq[0];
   kikuTipIntensity=1;
   if(seq.length>1){
     const secondMix=Math.max(0,Math.min(1,(lifeFrac-.79)/.065));
     if(secondMix>0)co=mixFireworkColor(seq[0],seq[seq.length-1],secondMix);
   }
 }
 let alpha=Math.min(1,p.ttl/(p.kind==='thunder-core'?.5:.95))*(p.flicker?starTwinkle(p,t):1);
 if(p.ending==='光露'&&lifeFrac>=.84){co='#f2f7ff';if(lifeFrac<.91)alpha=Math.max(alpha,.95)}
 if(p.ending==='紅輝'&&lifeFrac>=.84){co=cColor('紅');if(lifeFrac<.91)alpha=Math.max(alpha,.95)}
 if(p.ending==='先点滅'&&lifeFrac>=.72)alpha*=starTwinkle(p,t);
 if(p.ending==='銀乱'&&lifeFrac>=(p.kind==='kiku-star'&&p.seqMode==='先'?.84:.72)){
   co='#e9f4ff';alpha*=starTwinkle(p,t,1.45);
 }
 if(p.ending==='降雪'&&lifeFrac>=.72){co='#e9f4ff';alpha*=.70}
 if(p.ending==='かすみ草'&&lifeFrac>=.84){co='#e9f4ff';alpha*=.65}
 if(p.ending==='残輪'&&p.keepRing&&lifeFrac>=.82)co='#e9f4ff';
 if(['銀乱','降雪','先割'].includes(p.ending)&&p.endingAccentSeed&&!p.endingAccentDone&&lifeFrac>=(p.ending==='銀乱'&&p.kind==='kiku-star'&&p.seqMode==='先'?.85:.78)){
   releaseEndingAccent(p);
 }
 if(p.ending==='小割浮模様'&&p.smallBloomSeed&&!p.smallBloomDone&&lifeFrac>=.80){
   openSmallBloom(p);particles.splice(i,1);continue;
 }
 // 菊先はマジック牡丹ではない。星先を消灯せず、引きの尾だけ先に薄くする。
 // 引き色の先端は小さく残し、変化時に混色せず変化色へ直接切り替える。
 let kikuHeadAppear=1;
 if(p.kind==='kiku-star'||p.kind==='senrin-kiku-star'){
   const start=p.kikuHeadDelay??.11,end=start+(p.kikuHeadFadeIn??.18);
   kikuHeadAppear=lifeFrac<=start?0:Math.min(1,(lifeFrac-start)/Math.max(.04,end-start));
 }
 if(alpha<.012&&p.kind!=='palm-frond')continue;
 if(alpha>=.08){p.lastVisibleX=p.x;p.lastVisibleY=p.y;}
 if(p.kind==='ending-residue'||p.kind==='ending-small-flower'||p.kind==='ending-snow'||p.kind==='ending-crackle'||p.kind==='bloom-glint'||p.kind==='crown-ember'){
   const radius=p.kind==='crown-ember'?.7:p.kind==='ending-snow'?.85:p.kind==='ending-crackle'?1.2:p.kind==='bloom-glint'?1.0:p.kind==='ending-residue'?1.1:1.0;
   ctx.fillStyle=co;ctx.globalAlpha=alpha*.18;ctx.beginPath();ctx.arc(p.x,p.y,radius*2.1,0,Math.PI*2);ctx.fill();
   ctx.globalAlpha=alpha*.85;ctx.beginPath();ctx.arc(p.x,p.y,radius,0,Math.PI*2);ctx.fill();continue;
 }

 if(p.kind==='willow-branch'){
   // 柳の色を主役に保ちながら、ごく薄い加算合成でだけ輝きを足す。
   // ベースはsource-over、重なりの強調は細いハイライトに限定する。
   if(t-(p.willowPathTime||0)>.075){p.path.push({x:p.x,y:p.y,time:t});p.willowPathTime=t;}
   while(p.path.length>2&&(p.path.length>54||t-p.path[1].time>(p.willowBranchLength||3.2)))p.path.shift();
   if(p.path.length>1){
     const start=p.path[0];
     const remaining=Math.max(0,Math.min(1,(p.ttl-(.25+p.willowFadeOffset))/.92));
     const grow=Math.max(0,Math.min(1,lifeFrac/.13));
     const strength=alpha*remaining*grow;
     if(strength>.008){
       const width=(p.willowLineWidth||.85)*Math.min(1.13,Math.max(.72,W/690));
       const hot=mixFireworkColor(co,'#fff6ce',.28);
       const ember=mixFireworkColor(co,'#a05b1d',.40);
       const grad=ctx.createLinearGradient(start.x,start.y,p.x,p.y);
       grad.addColorStop(0,hexAlpha(ember,.06));
       grad.addColorStop(.19,hexAlpha(co,.48));
       grad.addColorStop(.48,hexAlpha(co,.84));
       grad.addColorStop(.73,hexAlpha(co,.90));
       grad.addColorStop(.93,hexAlpha(hot,.91));
       grad.addColorStop(1,hexAlpha(hot,.78));
       ctx.save();ctx.lineCap='round';
       ctx.beginPath();ctx.moveTo(start.x,start.y);
       for(let j=1;j<p.path.length;j++)ctx.lineTo(p.path[j].x,p.path[j].y);
       ctx.lineTo(p.x,p.y);
       ctx.globalCompositeOperation='source-over';
       ctx.strokeStyle=co;ctx.lineWidth=width*1.9;ctx.globalAlpha=strength*.05;ctx.stroke();
       ctx.globalCompositeOperation='source-over';
       ctx.strokeStyle=grad;ctx.lineWidth=Math.max(.72,width*1.03);
       ctx.globalAlpha=strength*.80;ctx.stroke();
       // ごく薄い加算ハイライト。白飛びではなく、重なりの輝きを補う程度。
       ctx.globalCompositeOperation='lighter';
       ctx.strokeStyle=hot;ctx.lineWidth=Math.max(.48,width*.48);
       ctx.globalAlpha=strength*.21;ctx.stroke();
       const flicker=.91+.09*Math.sin(t*9+(p.twinkleSeed||0)*.018);
       ctx.globalCompositeOperation='source-over';
       ctx.fillStyle=hot;ctx.globalAlpha=strength*.48*flicker;
       ctx.beginPath();ctx.arc(p.x,p.y,.78,0,Math.PI*2);ctx.fill();
       ctx.restore();
     }
   }
   continue;
 }
 if(p.kind==='thread-willow'){
   if(t-p.path[p.path.length-1].time>=.032)p.path.push({x:p.x,y:p.y,time:t});
   while(p.path.length&&t-p.path[0].time>3.2)p.path.shift();
   if(p.path.length>1){
     const first=p.path[0],gradient=ctx.createLinearGradient(first.x,first.y,p.x,p.y);
     gradient.addColorStop(0,co+'00');gradient.addColorStop(.23,co+'70');gradient.addColorStop(1,co);
     ctx.strokeStyle=gradient;
     for(const [width,opacity] of [[2.0,.16],[.80,.90]]){
       ctx.globalAlpha=alpha*opacity;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(first.x,first.y);
       for(const point of p.path.slice(1))ctx.lineTo(point.x,point.y);ctx.lineTo(p.x,p.y);ctx.stroke();
     }
   }
   ctx.fillStyle=co;ctx.globalAlpha=alpha;ctx.beginPath();ctx.arc(p.x,p.y,.9,0,Math.PI*2);ctx.fill();continue;
 }
 // 冠菊：長く垂れ下がる星の線を「燃えた時刻」で部分ごとに減光する。
 // 開花は球形、星先は徐々に下向き、終盤は線が細かく途切れながら燃え尽きる。
 if(p.kind==='crown-star'){
   // 1星につき軌跡を1本のパスで描画。白飛びを防ぐため加算光は極細・低濃度。
   if(t-p.path[p.path.length-1].time>.055)p.path.push({x:p.x,y:p.y,time:t});
   const maxTrailAge=1.65;
   while(p.path.length>2&&(p.path.length>36||t-p.path[1].time>maxTrailAge))p.path.shift();
   const scale=Math.min(1.15,Math.max(.65,W/690));
   const endFade=Math.min(1,Math.max(0,p.ttl/1.0));
   if(p.path.length>1){
     const oldest=p.path[0];
     const glow=Math.min(1,(t-oldest.time)/.5)*endFade;
     const shimmer=.89+.11*Math.sin(p.crownSparkSeed+t*9.5);
     const tint=mixFireworkColor(co,'#fff1d3',.23);
     const grad=ctx.createLinearGradient(oldest.x,oldest.y,p.x,p.y);
     grad.addColorStop(0,hexAlpha(co,.02));
     grad.addColorStop(.30,hexAlpha(co,.27));
     grad.addColorStop(.73,hexAlpha(co,.77));
     grad.addColorStop(1,hexAlpha(tint,.96));
     ctx.save();ctx.lineCap='round';
     ctx.beginPath();ctx.moveTo(oldest.x,oldest.y);
     for(let j=1;j<p.path.length;j++)ctx.lineTo(p.path[j].x,p.path[j].y);
     ctx.lineTo(p.x,p.y);
     ctx.globalCompositeOperation='source-over';
     ctx.strokeStyle=grad;ctx.lineWidth=1.18*scale;
     ctx.globalAlpha=glow*.86*shimmer;ctx.stroke();
     ctx.globalCompositeOperation='lighter';
     ctx.strokeStyle=tint;ctx.lineWidth=.58*scale;
     ctx.globalAlpha=glow*.16*shimmer;ctx.stroke();
     ctx.restore();
   }
   // 光の先端は小さな発光点。残光の消え方とは別に減光する。
   const head=Math.pow(endFade,1.25);
   ctx.fillStyle=co;ctx.globalAlpha=head*.14;
   ctx.beginPath();ctx.arc(p.x,p.y,2.35*scale,0,Math.PI*2);ctx.fill();
   ctx.fillStyle=mixFireworkColor(co,'#fff4df',.18);
   ctx.globalAlpha=head*.86;ctx.beginPath();ctx.arc(p.x,p.y,.92*scale,0,Math.PI*2);ctx.fill();
   continue;
 }
 // 椰子：軌跡の各部分が発光後に順次燃え尽きる。枝全体を一斉に透明化しない。
 if(p.kind==='palm-frond'){
   if(!p.path.length||t-p.path[p.path.length-1].time>=.026)p.path.push({x:p.x,y:p.y,time:t});
   // 軌跡の古い部分から消えていく。時間制限で線を突然切らないよう
   // 個々の線分の明るさを連続的に下げ、十分暗くなった点だけ破棄。
   const trailTime=1.55;
   while(p.path.length>2&&t-p.path[1].time>trailTime)p.path.shift();
   const scale=Math.min(1.14,Math.max(.72,W/690));
   const burn=Math.min(1,Math.max(0,(p.ttl-.05)/1.8));
   ctx.lineCap='round';
   for(let j=1;j<p.path.length;j++){
     const a=p.path[j-1],b=p.path[j];
     const age=t-(a.time+b.time)*.5;
     const ember=Math.max(0,1-age/trailTime);
     const fade=ember*ember*(.35+.65*burn);
     if(fade<.006)continue;
     // 根元は徐々に暗く、先端ほど明るい。各区間で独立して燃え尽きる。
     const dx=b.x-a.x,dy=b.y-a.y;
     const length=Math.hypot(dx,dy);
     if(length<.15)continue;
     const taper=.70+.30*Math.min(1,j/Math.max(1,p.path.length-1));
     ctx.strokeStyle=co;
     ctx.globalAlpha=fade*.16*p.palmGlow;
     ctx.lineWidth=6.5*scale*taper;
     ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
     ctx.globalAlpha=fade*.79;
     ctx.lineWidth=2.5*scale*taper;
     ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
     // 不規則な光の切れ目で、最後まで均一な蛍光線に見えないようにする。
     const flicker=.75+.25*Math.sin(j*3.8+p.palmSparkSeed+t*16);
     ctx.globalAlpha=fade*.50*flicker;
     ctx.lineWidth=.75*scale;
     ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
   }
   ctx.lineCap='butt';
   // 先端の光も枝ごとに緩やかに減衰し、突然消えない。
   const headFade=Math.pow(Math.max(0,Math.min(1,p.ttl/1.65)),1.8);
   ctx.fillStyle=co;
   ctx.globalAlpha=headFade*.20;ctx.beginPath();ctx.arc(p.x,p.y,3.0*scale,0,Math.PI*2);ctx.fill();
   ctx.globalAlpha=headFade*.85;ctx.beginPath();ctx.arc(p.x,p.y,1.25*scale,0,Math.PI*2);ctx.fill();
   continue;
 }
 // 蜂：短い曲線の噴射跡と明るい火点。菊の放射線・牡丹の球形とは異なる。
 if(p.kind==='bee'){
   const path=p.beeTrail,scale=Math.min(1.12,Math.max(.65,W/690));
   ctx.lineCap='round';ctx.strokeStyle=co;
   for(let j=1;j<path.length;j++){
     const a=path[j-1],b=path[j],fresh=Math.max(0,1-(t-(a.time+b.time)*.5)/.30);
     if(fresh<.02)continue;
     ctx.globalAlpha=alpha*fresh*.34;ctx.lineWidth=1.35*scale;
     ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
   }
   ctx.lineCap='butt';ctx.fillStyle=co;
   ctx.globalAlpha=alpha*.18;ctx.beginPath();ctx.arc(p.x,p.y,3.3*scale,0,Math.PI*2);ctx.fill();
   ctx.globalAlpha=alpha;ctx.beginPath();ctx.arc(p.x,p.y,1.45*scale,0,Math.PI*2);ctx.fill();
   continue;
 }
 // Flying stars leave individual, slender curved tracks rather than a spherical bloom.
 if(p.kind==='fly'||p.kind==='cluster-bundle'){
   const trailDuration=p.kind==='cluster-bundle'?1.05:.60;
   p.path.push({x:p.x,y:p.y,time:t});while(p.path.length&&t-p.path[0].time>trailDuration)p.path.shift();
   if(p.path.length>1){
     const first=p.path[0],gradient=ctx.createLinearGradient(first.x,first.y,p.x,p.y);
     gradient.addColorStop(0,co+'00');gradient.addColorStop(.5,co+'80');gradient.addColorStop(1,co);
     ctx.globalAlpha=alpha*(p.kind==='fly'?1:.85);ctx.strokeStyle=gradient;ctx.lineWidth=p.kind==='cluster-bundle'?.75:1.35;ctx.beginPath();ctx.moveTo(first.x,first.y);for(const point of p.path.slice(1))ctx.lineTo(point.x,point.y);ctx.stroke();
   }
   ctx.fillStyle=co===cColor('炭')?'#ffb368':co;
   if(p.kind==='fly'){
     // 蜂に比べて薄かった飛遊星の光点を強調。広がるフラッシュは足さない。
     ctx.globalAlpha=alpha*.20;ctx.beginPath();ctx.arc(p.x,p.y,3.2,0,Math.PI*2);ctx.fill();
     ctx.globalAlpha=alpha;ctx.beginPath();ctx.arc(p.x,p.y,1.5,0,Math.PI*2);ctx.fill();
   }else{
     ctx.globalAlpha=alpha;ctx.beginPath();ctx.arc(p.x,p.y,.95,0,Math.PI*2);ctx.fill();
   }
   continue;
 }
 if(p.kind==='senrin-shell')continue;
 if(p.kind==='cluster-white'){
   const radius=1.5;
   ctx.fillStyle=co;ctx.globalAlpha=alpha*.20;ctx.beginPath();ctx.arc(p.x,p.y,radius*2.2,0,Math.PI*2);ctx.fill();
   ctx.globalAlpha=alpha;ctx.beginPath();ctx.arc(p.x,p.y,radius,0,Math.PI*2);ctx.fill();continue;
 }
 // 雌雄芯の青紫の放射光。円形の芯輪は描かず、中心から伸びる細い火花だけ。
 if(p.kind==='core-shiyu-blue'){
   const scale=Math.min(1.15,Math.max(.68,W/690));
   const speed=Math.hypot(p.vx,p.vy)||1;
   const reach=Math.min(20*scale,Math.max(4*scale,speed*.16));
   const ux=p.vx/speed,uy=p.vy/speed;
   ctx.save();ctx.globalCompositeOperation='source-over';ctx.lineCap='round';
   ctx.strokeStyle=p.color;ctx.globalAlpha=alpha*.52;ctx.lineWidth=.9*scale;
   ctx.beginPath();ctx.moveTo(p.x-ux*reach,p.y-uy*reach);ctx.lineTo(p.x,p.y);ctx.stroke();
   ctx.restore();
   continue;
 }
 // 雌雄芯の錦色の椰子状光彩。少数の太い枝が曲がりながら外へ伸びる。
 if(p.kind==='core-stamen'){
   const scale=Math.min(1.15,Math.max(.68,W/690));
   const dx=p.x-p.stamenStartX,dy=p.y-p.stamenStartY;
   const distance=Math.hypot(dx,dy);
   if(distance>3&&alpha>.008){
     const curve=p.stamenCurve||0;
     const mx=(p.stamenStartX+p.x)*.5-dy*curve;
     const my=(p.stamenStartY+p.y)*.5+dx*curve;
     const grad=ctx.createLinearGradient(p.stamenStartX,p.stamenStartY,p.x,p.y);
     grad.addColorStop(0,'rgba(247,164,75,0)');
     grad.addColorStop(.36,p.color);
     grad.addColorStop(1,p.color);
     ctx.save();ctx.globalCompositeOperation='source-over';ctx.lineCap='round';
     ctx.strokeStyle=grad;
     ctx.beginPath();ctx.moveTo(p.stamenStartX,p.stamenStartY);
     ctx.quadraticCurveTo(mx,my,p.x,p.y);
     ctx.globalAlpha=alpha*(p.stamenStrength||1)*.26;
     ctx.lineWidth=(p.stamenBranch?2.6:5.2)*scale;ctx.stroke();
     ctx.globalAlpha=alpha*(p.stamenStrength||1)*.87;
     ctx.lineWidth=(p.stamenBranch?1.05:2.0)*scale;ctx.stroke();
     ctx.fillStyle=p.color;ctx.globalAlpha=alpha*(p.stamenStrength||1)*.7;
     ctx.beginPath();ctx.arc(p.x,p.y,(p.stamenBranch?.85:1.4)*scale,0,Math.PI*2);ctx.fill();
     ctx.restore();
   }
   continue;
 }
 // 芯星：親星と同じ時刻に小さな球として開く。輪郭線や白い中心円は描かない。
 if(p.kind==='core-star'){
   const scale=Math.min(1.15,Math.max(.68,W/690));
   const radius=(1.06+.18*(1-Math.abs(p.coreDepth||0)))*scale;
   const intensity=(p.coreGlow||1)*alpha;
   const elapsed=Math.max(0,1-p.ttl/p.life);
   // 映像の八重芯：内芯・外芯それぞれ独立して、温かい初期色から緑／紅に移る。
   const coreMix=Math.min(1,Math.max(0,(elapsed-(p.coreLayer===0?.09:.14))/.23));
   const coreColor=p.coreReferenceYae
     ?mixFireworkColor(p.coreStartColor,p.coreEndColor,coreMix):co;
   // 芯は独立した光点だけで球状に開く。放射線は描かない。
   // 最内芯の星を間引き、点が連なって一本の線に見える現象を抑える。
   const innermost=(p.coreLayer||0)===0;
   const pointRadius=radius*(innermost?1.32:1.18);
   ctx.fillStyle=coreColor;
   ctx.globalAlpha=Math.min(.22,intensity*.16);
   ctx.beginPath();ctx.arc(p.x,p.y,pointRadius*2.2,0,Math.PI*2);ctx.fill();
   ctx.globalAlpha=Math.min(1,intensity*(innermost?.95:.88));
   ctx.beginPath();ctx.arc(p.x,p.y,pointRadius,0,Math.PI*2);ctx.fill();
   continue;
 }
 // 菊：参考サイトと同じ「星の速度に沿う短い光条＋時間減衰する残光」。
 // 履歴点をつなぐ長いポリラインは描かないため、開花直後のギザギザが出ない。
 if(p.kind==='kiku-star'||p.kind==='senrin-kiku-star'){
   const scale=Math.min(1.15,Math.max(.68,W/690));
   const nishiki=!!p.kikuNishiki;
   const burnOffset=p.kikuBurnOffset||0;
   const tailStart=Math.min(1,Math.max(0,(lifeFrac-.003)/.035));
   const mini=p.kind==='senrin-kiku-star';
   const lateFade=Math.max(0,Math.min(1,(1.04-lifeFrac-burnOffset)/(mini?.20:.27)));
   // 先色の引きは光量を控えめにし、長めの一本の光条として伸ばす。
   const strength=(mini?1.10:(p.seqMode==='先'?.53:(nishiki?1:.83)))*(p.kikuTailVariation||1);
   // 菊先は引きの尾を自然に減光し、先端が変化する前に消し切る。
   // 星先そのものは消灯しない（無光の間を作るのはマジック牡丹のみ）。
   const tipFadeStart=seq.length>1?.27:.30;
   const tipFadeEnd=seq.length>1?.43:.46;
   const tipFade=p.seqMode==='先'&&seq.length
     ?1-Math.min(1,Math.max(0,(lifeFrac-tipFadeStart)/(tipFadeEnd-tipFadeStart)))
     :1;
   // 光る尾が完全に消えた時点で、記録済みの軌跡を淡い灰色の煙に置き換える。
   // 星先は消灯させず、先色への切替えもそのまま。
   if(p.seqMode==='先'&&seq.length&&tipFade<=0&&!p.kikuSmokeDrawn){
     p.kikuSmokeDrawn=true;
     // 引きの色を持つ線はここで終了。煙は固定された灰色の軌跡のみ。
     const path=(p.kikuTrail||[]).filter(pt=>Number.isFinite(pt.x)&&Number.isFinite(pt.y));
     if(path.length>2){
       kikuSmokeCtx.save();
       kikuSmokeCtx.globalCompositeOperation='source-over';
       kikuSmokeCtx.strokeStyle='#9298a1';
       kikuSmokeCtx.globalAlpha=.17;
       kikuSmokeCtx.lineWidth=1.65*scale;
       kikuSmokeCtx.lineCap='round';
       // 花火の中心から煙を描くと、数百本が重なり白い円形のもやになる。
       // 内側の軌跡を省き、外側に残る引きの部分だけを煙にする。
       const startIndex=Math.max(1,Math.floor(path.length*.42));
       kikuSmokeCtx.beginPath();
       kikuSmokeCtx.moveTo(path[startIndex].x,path[startIndex].y);
       for(let k=startIndex+1;k<path.length;k++)kikuSmokeCtx.lineTo(path[k].x,path[k].y);
       kikuSmokeCtx.stroke();
       kikuSmokeCtx.restore();
     }
   }
   const earlyBoost=p.kind==='kiku-star'&&kikuHeadAppear<.65?1.16:1;
   const opacity=Math.max(0,Math.min(1,alpha*tailStart*lateFade*strength*tipFade*earlyBoost));
   if(opacity>.012){
     // velocity は px/s。描画フレーム長に依存しない短い光条に換算する。
     // 動きの速い開花直後は長く、減速すると短くなる。
     const vx=p.vx,vy=p.vy;
     const speed=Math.hypot(vx,vy);
     // 菊先の尾は従来より長く伸ばす。先色点灯時にはこの発光尾を描かない。
     const reach=p.seqMode==='先'
       ?Math.min((mini?24:38)*scale,Math.max((mini?3.2:5)*scale,speed*(mini?.145:.18)))
       :Math.min((mini?19:23)*scale,Math.max((mini?2.8:2.4)*scale,speed*(mini?.16:.115)));
     const ux=speed>.001?vx/speed:0,uy=speed>.001?vy/speed:0;
     const fromX=p.x-ux*reach,fromY=p.y-uy*reach;
     // 菊先の変化は新しい光条にだけ反映。すでに残った尾は元の色を保つ。
     // 紅・緑・青などの色菊は加算合成による白っぽい重なりを避ける。
     // 錦・金の菊だけ従来の強い加算発光を残す。
     const colorKiku=!nishiki;
     const trailColor=p.seqMode==='先'?(p.trailColor||p.color):(referenceChangingKiku?co:(p.trailColor||p.color));
     // 菊先は残光キャンバスに引き色を焼き付けない。
     // 古い金色の尾が先色の背後に残る問題を根本的に防ぐ。
     for(const c of (mini||p.seqMode==='先'?[ctx]:[kikuAfterglowCtx,ctx])){
       c.save();c.globalCompositeOperation=p.seqMode==='先'?'source-over':(colorKiku?'source-over':'lighter');c.lineCap='round';
       c.strokeStyle=trailColor;
       const afterLayer=c===kikuAfterglowCtx;
       c.globalAlpha=opacity*(mini?.33:(p.seqMode==='先'?.13:(colorKiku?(afterLayer?.14:.20):(afterLayer?.27:.21))));
       c.lineWidth=(mini?2.65:(nishiki?3.5:3.0))*scale;
       c.beginPath();c.moveTo(fromX,fromY);c.lineTo(p.x,p.y);c.stroke();
       c.globalAlpha=opacity*(mini?.98:(p.seqMode==='先'?.68:(colorKiku?(afterLayer?.62:.94):(afterLayer?.95:.82))));
       c.lineWidth=(mini?1.18:(p.seqMode==='先'?1.18:(nishiki?1.55:1.28)))*scale;
       c.beginPath();c.moveTo(fromX,fromY);c.lineTo(p.x,p.y);c.stroke();
       c.restore();
     }
   }
 }
 // 牡丹：星一粒ずつが球状に広がり、軌跡を残さず独立して消える。
 // 菊も同じ丸い星を描く。違いは上で描いた尾だけ。
 if(p.kind==='botan-star'||p.kind==='kiku-star'||p.kind==='senrin-kiku-star'||p.kind==='shape-star'||(current.shape==='botan'&&p.kind==='regular')){
   const radius=(p.botanRadius||1.18)*Math.min(1.15,Math.max(.68,W/690));
   const glow=p.botanGlow||.9;
   // 白い芯を描かず、親星の色（染分や先変化を含む）をそのまま見せる。
   ctx.fillStyle=co;
   const kikuLike=p.kind==='kiku-star'||p.kind==='senrin-kiku-star';
   const miniKiku=p.kind==='senrin-kiku-star'||p.senrinMini;
   const headLight=kikuLike?Math.min(miniKiku?1.18:1.25,(miniKiku?1.06:1.10)+Math.max(0,.25-lifeFrac)*(miniKiku?.42:.55)):1;
   const colorKikuHead=kikuLike&&!p.kikuNishiki;
   const headAlpha=(kikuLike?kikuHeadAppear:1);
   const outerMul=miniKiku?(colorKikuHead?2.8:2.9):(colorKikuHead?2.65:3.1);
   const midMul=miniKiku?1.75:1.65;
   ctx.globalAlpha=Math.min(1,alpha*(miniKiku?.18:(colorKikuHead?.11:.19))*glow*headLight*headAlpha);
   ctx.beginPath();ctx.arc(p.x,p.y,radius*outerMul,0,Math.PI*2);ctx.fill();
   ctx.globalAlpha=Math.min(1,alpha*(miniKiku?.43:(colorKikuHead?.31:.43))*glow*headLight*headAlpha);
   ctx.beginPath();ctx.arc(p.x,p.y,radius*midMul,0,Math.PI*2);ctx.fill();
   ctx.globalAlpha=Math.min(1,alpha*headLight*headAlpha);
   ctx.beginPath();ctx.arc(p.x,p.y,miniKiku?radius*.92:radius,0,Math.PI*2);ctx.fill();
   continue;
 }
 // 菊：星の先端は牡丹と同じ「丸い発光点」として残し、
 // 尾だけを時間経過で薄く消す。錦菊のみ金のきらめきを追加。
 // 花火の星は丸い光球ではなく、燃えながら伸びる細い軌跡として描く。
 // 短い星は針のような輝点にする。
 const dx=p.x-oldX,dy=p.y-oldY;
 const dist=Math.hypot(dx,dy),speed=Math.hypot(p.vx,p.vy);
 let len=Math.max(1.5,Math.min(15.5,dist*1.65+speed*.022*Math.max(.3,p.trail)));
 if(p.kind==='thunder-core')len=Math.min(len,3.2);
 if(p.kind==='thunder-spark')len=Math.min(11,len*1.25);
 const ux=dist>.01?dx/dist:Math.cos(i*2.4),uy=dist>.01?dy/dist:Math.sin(i*2.4);
 const tailX=p.x-ux*len,tailY=p.y-uy*len;
 ctx.globalAlpha=alpha*.30;ctx.lineWidth=p.kind==='thunder-core'?2.2:Math.max(.65,Math.min(1.4,p.size*.29));
 ctx.strokeStyle=co;ctx.beginPath();ctx.moveTo(tailX,tailY);ctx.lineTo(p.x,p.y);ctx.stroke();
 ctx.globalAlpha=alpha*.88;ctx.lineWidth=p.kind==='thunder-core'?1.55:Math.max(.55,Math.min(1.05,p.size*.20));
 ctx.beginPath();ctx.moveTo(p.x-ux*len*.53,p.y-uy*len*.53);ctx.lineTo(p.x,p.y);ctx.stroke();
 // 白い大きな円は描かず、ごく短い火花の先端だけを明るくする。
 if(true){
   ctx.globalAlpha=alpha*.55;ctx.strokeStyle=current.originalType.includes('牡丹')?co:co===cColor('炭')?'#ffb368':'#fff8e9';ctx.lineWidth=.6;
   ctx.beginPath();ctx.moveTo(p.x-ux*1.15,p.y-uy*1.15);ctx.lineTo(p.x,p.y);ctx.stroke();
 }
 }
 drawBloomFlashes(dt);ctx.globalAlpha=1;if(t>9.6 && particles.length===0){active=false;kikuSmokeCtx.clearRect(0,0,W,H);kikuAfterglowCtx.clearRect(0,0,W,H);$('status').textContent='FINISHED — 花火が消えました'}
}presentSky();capturePeakPhoto();if(active){requestAnimationFrame(render)}else{lastTime=now;requestAnimationFrame(render)}}requestAnimationFrame(render);
let photoFile=null,photoURL=null;
function preparePeakFile(){
 if(photoFile||!peakScore)return;
 const name='花火工房_'+(peakName||'花火')+'.png';
 const generation=photoGeneration;
 peakCanvas.toBlob(blob=>{
  if(!blob||generation!==photoGeneration)return;
  photoFile=new File([blob],name,{type:'image/png'});
  if(photoURL)URL.revokeObjectURL(photoURL);
  photoURL=URL.createObjectURL(blob);
  $('downloadPhoto').href=photoURL;$('downloadPhoto').download=name;
  $('sharePhoto').disabled=false;
 },'image/png');
}
resetPeakPhoto();
async function sharePhotoDirect(){
 if(!photoFile||!navigator.share||!navigator.canShare?.({files:[photoFile]}))return false;
 try{await navigator.share({files:[photoFile],title:'花火工房の写真'});return true}
 catch(e){if(e.name==='AbortError')return true;return false}
}
$('snapshot').onclick=async()=>{
 if(!peakReady&&active){photoRequested=true;$('snapshot').disabled=true;$('snapshot').textContent='開花を撮影中…';return}
 if(peakScore<=0)return;
 // 共有前に写真を確認・選択できるよう、端末の共有画面へ直接飛ばさない。
 showPeakPhoto();
};
function showPeakPhoto(){
 const filename='花火工房_'+(peakName||'花火')+'.png';
 $('photoImage').src=peakCanvas.toDataURL('image/png');
 $('downloadPhoto').href=photoURL||$('photoImage').src;
 $('downloadPhoto').download=filename;
 $('photoNote').textContent='';
 renderPhotoChoices();
 $('sharePhoto').disabled=!photoFile;
 if(!$('photoDialog').open)$('photoDialog').showModal();
 preparePeakFile();
}
$('sharePhoto').onclick=async()=>{
 const ok=await sharePhotoDirect();
 if(!ok)$('photoNote').textContent='この環境では直接共有できません。PNGを保存してから投稿してください。';
};
$('closePhoto').onclick=()=>$('photoDialog').close();

loadSharedFirework();
if(!current)generate(false,true);
