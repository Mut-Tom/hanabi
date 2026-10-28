const KEYS=['昇曲導','芯部','基本色・光跡','玉の種類','開花後の変化','変化する色','消え際'];const IDs=['ascent','core','base','type','change','colors','ending'];const COLORS={'紅':'#ff6888','緑':'#77f5aa','青':'#68b8ff','黄':'#ffce54','紫':'#dab5ff','銀':'#e7f2ff','金':'#efbd65','錦':'#ffd08a','輝':'#fff5d5'};
const $=id=>document.getElementById(id);const rand=(a,b)=>a+Math.random()*(b-a),pick=a=>a[Math.floor(Math.random()*a.length)];const fields={};let current=null;let autoAscent=false,autoColors=false,userColorPicked=false;
function uniqueNames(i){const a=new Map();TABLES[i].forEach(e=>{if(!a.has(e.name))a.set(e.name,e)});return [...a.values()]}
const COLOR_MARKS={'紅':'🔴','緑':'🟢','青':'🔵','黄':'🟡','紫':'🟣','銀':'⚪','金':'🟠','錦':'🟠'};
function colorOptionLabel(i,name){if(i===0){const m=name.match(/^昇([紅緑青黄紫銀金錦])/);return m?COLOR_MARKS[m[1]]+' '+name:name;}return (i===2||i===5)&&name!=='なし'?[...name].map(ch=>COLOR_MARKS[ch]||'').join('')+' '+name:name;}
KEYS.forEach((k,i)=>{const field=document.createElement('div');field.className='field';const label=document.createElement('label');label.textContent='0'+(i+1)+' '+k+(i===0?'（上昇中の演出）':i===1?'（花火の内側の輪）':'');label.htmlFor=IDs[i];const select=document.createElement('select');select.id=IDs[i];select.setAttribute('aria-label',k);const option=document.createElement('option');option.value='';option.textContent='ランダム';select.appendChild(option);const noneOption=document.createElement('option');noneOption.value='なし';noneOption.textContent='なし';select.appendChild(noneOption);uniqueNames(i).filter(v=>v.name!=='なし').forEach(v=>{const o=document.createElement('option');o.value=v.name;o.textContent=colorOptionLabel(i,v.name);select.appendChild(o)});select.value='なし';select.addEventListener('change',()=>{
 if(i===0)autoAscent=select.value==='';
 if(i===5){autoColors=select.value==='';userColorPicked=select.value!=='';}
 // 変化・染分で色を指定しない場合は、ランダムを維持して毎回2色を抽選。
 if(i===4&&['変化','染分'].includes(select.value)&&!userColorPicked){
   fields.colors.value='';autoColors=true;
 }
 generate(false);
});field.append(label,select);$('fields').appendChild(field);fields[IDs[i]]=select;});
function has(s,n){return s.includes(n)}
function colorSequence(str){return [...str].filter(ch=>COLORS[ch])}
function role(n){if(n.includes('千輪'))return 'senrin';if(n.includes('冠'))return 'crown';if(n.includes('牡丹'))return 'botan';if(n.includes('菊'))return 'kiku';if(n.includes('柳'))return 'willow';if(n.includes('椰子'))return 'palm';if(n.includes('蜂')&&!n.includes('飛'))return 'bee';if(n.includes('飛遊星'))return 'fly';if(n.includes('花雷'))return 'thunder';if(n.includes('万華鏡'))return 'cluster';if(n.includes('ダリヤ'))return 'botan';if(n.includes('ハート'))return 'heart';if(n.includes('蝶'))return 'butterfly';if(n.includes('土星'))return 'saturn';return 'kiku'}
function basicColor(n){if(n==='なし')return '炭';if(n==='錦')return '錦';return COLORS[n]?n:'炭'}
const none=()=>({name:'なし',desc:'',note:''});
function randomEntry(i,override){return override?TABLES[i].find(x=>x.name===override)||none():pick(TABLES[i])}
function resolve(input){
 let [a,b,c,d,e,f,g]=input.map(x=>({...x}));const notices=[];
 const sh=role(d.name),type=d.name;
 const senrin=sh==='senrin',crown=sh==='crown',willow=sh==='willow',cluster=sh==='cluster';
 const special=['palm','bee','fly','thunder','heart','butterfly','saturn'].includes(sh);
 const hasCore=!special&&!willow&&!cluster;
 if(!hasCore||senrin&& !['なし','芯入'].includes(b.name)){
   if(b.name!=='なし')notices.push('② この玉種では芯部を無効');b=none();
 }
 if(senrin||cluster){c=none();}

 if(special||willow){if(!['なし','紅','緑','青','黄','紫','銀','錦'].includes(c.name))c=none()}
 if(crown&&!['なし','紅','緑','青','黄','紫','銀','錦'].includes(c.name))c=none();
 const allowedMode=senrin||crown||cluster||special?['なし']:willow?['なし','先']:['なし','先','変化','染分'];
 if(e.name==='染分'&&!['kiku','botan'].includes(sh)||!allowedMode.includes(e.name)){
   if(e.name!=='なし')notices.push('⑤ この玉種に変化を適用しません');e=none();
 }
 if(e.name==='変化'&&!['kiku','botan'].includes(sh)){e=none();notices.push('⑤ 変化は菊・牡丹・ダリヤ限定')}
 if(e.name==='染分'&&!['kiku','botan'].includes(sh)){e=none()}
 const validColors=TABLES[5].filter(o=>{
   const s=colorSequence(o.name);
   // ③基本色と⑥の全色（単色・2色の両方）を重複させない。
   // 「なし」は比較対象外。
   const baseColor=c.name;
   if(COLORS[baseColor]&&s.includes(baseColor))return false;
   if(e.name==='先')return (s.length>=1&&s.length<=2)||(o.name==='なし'&&g.name==='点滅');
   if(e.name==='染分')return s.length===2&&s[0]!==s[1];
   if(e.name==='変化')return s.length===2&&s[0]!==s[1];
   return o.name==='なし';
 });
 if(e.name==='なし')f=none();
 else if(f.random||f.name==='ランダム'||!validColors.some(o=>o.name===f.name)){
   if(f.name!=='ランダム'&&!f.random)notices.push('⑥ ③の基本色と⑥の色が重複するなど、色の組み合わせ条件により振り直し');
   f={...pick(validColors)};
 }
 const permitted=senrin?['なし','点滅']:special||willow||cluster?['なし','光露']:
  crown?['なし','光露','降雪','銀乱','点滅','先割','群声','かすみ草','紅輝','小割浮模様','残輪']:null;
 const general=['kiku','botan','crown'].includes(sh);
 if((permitted&&!permitted.includes(g.name))||
   (!general&&!senrin&&g.name==='点滅')||
   (!general&&['降雪','銀乱','先割','群声','かすみ草','紅輝','小割浮模様','残輪'].includes(g.name))){
   if(g.name!=='なし')notices.push('⑦ この玉種では消え際を無効');g=none();
 }
 const tipBlink=e.name==='先'&&f.name==='なし'&&g.name==='点滅';
 // ⑥の「なし」は先点滅の組み合わせ以外では採用しない。
 if(e.name==='先'&&f.name==='なし'&&!tipBlink){f={...pick(validColors.filter(o=>o.name!=='なし'))};}
 let body=c.name==='なし'?'':c.name;
 if(e.name==='染分'){
   body=(sh==='botan'?'':(c.name==='錦'?c.name:''))+f.name+'染分'+type;
 }else if(e.name==='変化')body+='変化'+type;
 else body+=type;
 if(e.name==='先')body+=tipBlink?'先点滅':'先'+f.name;
 if(!tipBlink){
   if(g.name==='点滅'){
     if(senrin)body=body.replace('千輪菊','点滅千輪菊');
     else if(e.name==='先')body+='点滅';
     else body=body.replace(type,'点滅'+type);
   }else if(g.name!=='なし')body+=g.name;
 }
 const name=(a.name==='なし'?'':a.name)+(b.name==='なし'?'':b.name)+body;
 return {name,raw:[a,b,c,d,e,f,g],shape:sh,baseColor:basicColor(c.name),baseName:c.name,sequence:e.name==='なし'?[]:colorSequence(f.name),mode:e.name,ending:tipBlink?'先点滅':g.name,core:b.name==='なし'?'':b.name,ascent:a.name==='なし'?'':a.name,notices,originalType:type};
}
function describeFirework(v){
 const [ascent,core,base,type,,,ending]=v.raw;
 const sentence=text=>{const clean=(text||'').trim().replace(/[。\s]+$/,'');return clean?clean+'。':''};
 const colors={'紅':'紅色','緑':'緑色','青':'青色','黄':'黄色','紫':'紫色','銀':'銀白色','金':'金色','錦':'錦色（金色系）'};
 const seq=v.sequence.map(c=>colors[c]||c);
 const parts=[];
 if(ascent.name!=='なし')parts.push(sentence(ascent.desc.split('。')[0]));
 let bloom=type.desc;
 if(type.name.includes('ダリヤ'))bloom=bloom.replace('星が大粒の光点が','大粒の光点が');
 if(type.name.includes('椰子'))bloom=bloom.replace('星が太い光の筋が','星が太い光の筋となり、');
 if(v.mode==='染分'&&type.name.includes('牡丹'))bloom='光点が尾を引かず、球形に広がる。';
 parts.push(sentence(bloom));
 if(core.name!=='なし'){
 const peonyCore={彩色芯:'中心部にも本体と同じ色の牡丹星が広がる。',キラ芯:'芯部が本体と同じ色の細かな粒を散らしてきらめく。',輝光緑芯:'中心の芯が本体と同じ色で強く輝く。',紅輝光芯:'中心の芯が本体と同じ色で強く輝く。'};
 parts.push(sentence(v.shape==='senrin'?'それぞれの小花の内側に、一重の芯が開く。':type.name.includes('牡丹')&&peonyCore[core.name]?peonyCore[core.name]:core.name==='五重芯'?'親星の内側に五重の芯が開き、多重芯の構造を描く。':core.desc));
 }
 if(v.mode==='先'&&seq.length)parts.push(seq.length===1?`星の燃焼が進むにつれて、星先に${seq[0]}が現れる。`:`星の燃焼が進むにつれて、星先に${seq.join(' → ')}の順で色が現れる。`);
 if(v.mode==='変化'&&seq.length)parts.push(`星が燃え進むにつれて、${seq.join(' → ')}の順に色が変化する。`);
 if(v.mode==='染分'&&seq.length)parts.push(`花の領域が${seq.join('と')}に分かれ、2色が同時に開く。`);
 const endings={
 '光露':'星が消える直前、銀白色に一瞬強く閃く。',
 '降雪':'綿雪のような銀色の光を残して消える。',
 '銀乱':'終端に銀白色の細かな火花が乱れるように現れて消える。',
 '先点滅':'星の末端部が明滅しながら消える。',
 '点滅':v.shape==='senrin'?'小花を構成する星が点滅しながら開く。':'玉を構成する星が点滅しながら開く。',
 '先割':'星が消える間際、パリパリと乾いた音を発する。',
 '群声':'星の終わり際、波の寄せるような「ザーッ」という音が響く。',
 'かすみ草':'星先が消えた後に、銀白色の綿毛のような細かな光が残る。',
 '紅輝':'星が消える直前に、紅色で一瞬強く輝く。',
 '小割浮模様':'本体の開花後に、小割玉の小花が浮かび上がる。',
 '残輪':'ほかの星が消えた後に、一周の光の輪が残る。'};
 if(ending.name!=='なし')parts.push(sentence(endings[ending.name]||ending.desc));
 return parts.join('');
}
function renderFireworkData(v){current=v;const reading=hanabiReading(v.name);$('nameReading').textContent=reading.complete?reading.reading:(reading.reading?reading.reading+'（一部未確認）':'読み未設定');$('name').textContent=v.name;$('notice').textContent=v.notices.join(' ／ ');$('breakdown').textContent='';$('narrative').textContent=describeFirework(v);updateShareButtons()}
function generate(doPlay=false,randomize=false){
 if(randomize){autoAscent=false;autoColors=false;userColorPicked=false;}
 if(!randomize&&fields.type.value==='なし'){clearCurrentFirework();return null}
 const raw=KEYS.map((_,i)=>{
  const selected=randomize?'':fields[IDs[i]].value;
  if(i===0&&autoAscent&&!randomize)return {...pick(TABLES[0].filter(o=>o.name!=='なし'))};
  return i===5?((autoColors&&!randomize)||!selected?{name:'ランダム',random:true}:randomEntry(i,selected)):randomEntry(i,selected);
 });
 const v=resolve(raw);
 // すべてのプルダウンを実際に選ばれた構成に同期する。
 // 無効化された項目は「なし」に揃え、無効な組み合わせの再抽選結果も反映する。
 v.raw.forEach((e,i)=>{
   const select=fields[IDs[i]];
   if(!randomize&&((i===0&&autoAscent)||(i===5&&autoColors)))select.value='';
   else if([...select.options].some(o=>o.value===e.name))select.value=e.name;
 });
 renderFireworkData(v);
 if(doPlay)launch();
 return v;
}
function clearCurrentFirework(){
 resetPeakPhoto();current=null;++launchRequest;++audioRun;stopSounds();active=false;particles=[];trails=[];flashes=[];burstDone=false;t=0;
 clearSky();presentSky();$('name').textContent='';$('nameReading').textContent='';$('narrative').textContent='7項目を選ぶか、玉名を入力して花火を作ってみましょう。';
 for(const id of ['notice','ruleNote','breakdown'])$(id).textContent='';
 $('status').textContent='READY — 夜空の準備ができました';updateShareButtons();
}
function reset(){autoAscent=false;autoColors=false;userColorPicked=false;Object.values(fields).forEach(select=>select.value='なし');$('manual').value='';clearCurrentFirework()}

function interpret(doPlay=true){
 autoAscent=false;autoColors=false;userColorPicked=false;
 const input=$('manual').value.trim().replace(/\s+/g,'');
 if(!input){$('notice').textContent='玉名を入力してください';return}
 const notes=[];const names=i=>uniqueNames(i).filter(o=>o.name!=='なし').sort((a,b)=>b.name.length-a.name.length);
 const entry=(i,n)=>uniqueNames(i).find(o=>o.name===n)||none();let rest=input;
 // 「昇り曲導付き」など、種類を指定しない総称は①の実在する付加演出を抽選する。
 const genericAscent=rest.match(/^昇り?曲(?:導)?付き?/);
 let ascent=null;
 if(genericAscent){
   const candidates=TABLES[0].filter(o=>o.name!=='なし');
   ascent=pick(candidates);autoAscent=true;
   rest=rest.slice(genericAscent[0].length);
   notes.push('① 昇曲導：ランダム（打ち上げごとに抽選）');
 }else{
   ascent=names(0).find(o=>rest.startsWith(o.name));
   if(ascent)rest=rest.slice(ascent.name.length);
 }
 const core=names(1).find(o=>rest.startsWith(o.name));if(core)rest=rest.slice(core.name.length);
 const tipBlink=rest.endsWith('先点滅');if(tipBlink)rest=rest.slice(0,-4);
 let ending=tipBlink?entry(6,'点滅'):names(6).find(o=>rest.endsWith(o.name));
 if(ending&&!tipBlink)rest=rest.slice(0,-ending.name.length);
 let mode='なし',colors='なし';
 if(rest.includes('染分')){
    mode='染分';const m=rest.match(/([紅緑青黄紫銀金錦]{2})染分/);colors=m?m[1]:'ランダム';if(!m)autoColors=true;rest=rest.replace(/([紅緑青黄紫銀金錦]{2})染分/,'').replace('染分','');
 }else if(rest.includes('変化')){
    mode='変化';
    // 変化の指定色は玉名には記載されない。⑥から異なる2色をランダム抽選する。
    // 基本色との適合判定は、玉種・前色が確定した後に resolve が行う。
    colors='ランダム';autoColors=true;rest=rest.replace('変化','');
 }else if(tipBlink){mode='先';colors='なし'}
 else {const m=rest.match(/先([紅緑青黄紫銀金錦]{1,2})$/);if(m){mode='先';colors=m[1];rest=rest.slice(0,-m[0].length)}}
 const type=names(3).find(o=>rest.endsWith(o.name))||entry(3,'菊');
 if(rest.endsWith(type.name))rest=rest.slice(0,-type.name.length);
 const base=entry(2,rest||'なし');
 if(base.name==='なし'&&rest)notes.push('③ '+rest+' → なし');
 if(colors!=='ランダム'&&!uniqueNames(5).some(o=>o.name===colors)){
   const candidate=names(5).find(o=>o.name.length===colors.length&&o.name[0]===colors[0])||names(5).find(o=>o.name.length===colors.length);
   notes.push('⑥ '+colors+' → '+(candidate?.name||'紅青'));colors=candidate?.name||'紅青';
 }
 const requested=[entry(0,ascent?.name||'なし'),entry(1,core?.name||'なし'),base,type,entry(4,mode),colors==='ランダム'?{name:'ランダム',random:true}:entry(5,colors),entry(6,ending?.name||'なし')];
 const result=resolve(requested);
 if(mode==='変化'&&result.mode==='変化')notes.push('⑥ 変化する色：ランダム（2色から毎回抽選）');
 result.raw.forEach((item,i)=>{fields[IDs[i]].value=(i===0&&autoAscent)||(i===5&&autoColors)?'':item.name;if(!((i===0&&autoAscent)||(i===5&&autoColors))&&requested[i].name!==item.name)notes.push(`${i+1} ${requested[i].name} → ${item.name}（組合せ制限）`)});
 if(result.name!==input)notes.push('再現可能な玉名：'+result.name);
 renderFireworkData(result);$('notice').textContent=['玉名から構成を再現しました',...notes,...result.notices].join(' ／ ');
 if(doPlay)launch();
}
$('shufflePlay').onclick=()=>generate(true,true);$('reset').onclick=reset;$('play').onclick=()=>{if(generate(false))launch();else $('notice').textContent='④ 玉の種類を選択してください。'};$('interpret').onclick=interpret;$('manual').addEventListener('keydown',e=>{if(e.key==='Enter')interpret()});$('speed').oninput=e=>$('speedNum').textContent=(e.target.value/100).toFixed(1)+'×';

function updateShareButtons(){
 $('shareX').disabled=!current;$('shareNotice').textContent='';
}
function sharedFireworkURL(){
 if(!current)return '';
 const url=new URL(window.location.href);url.search='';url.hash='';
 current.raw.forEach((entry,i)=>url.searchParams.set(IDs[i],entry.name));
 url.searchParams.set('name',current.name);
 return url.href;
}
function shareMessage(){return current?'🎆 '+current.name+'\n花火工房｜玉名シミュレーター':''}
$('shareX').onclick=()=>{
 if(!current)return;
 const params=new URLSearchParams({text:shareMessage(),url:sharedFireworkURL()});
 const intent='https://twitter.com/intent/tweet?'+params.toString();
 const opened=window.open(intent,'_blank','noopener,noreferrer');
 if(!opened)$('shareNotice').textContent='Xの投稿画面が開かない場合は、ブラウザのポップアップ設定をご確認ください。';
};
function loadSharedFirework(){
 const params=new URLSearchParams(window.location.search);
 const config=IDs.map(id=>params.get(id));
 if(config.some(value=>value!==null)){
   const valid=config.every((name,i)=>name!==null&&(name==='なし'||uniqueNames(i).some(e=>e.name===name)));
   if(!valid){$('notice').textContent='共有URLの構成を読み込めませんでした。';return}
   config.forEach((name,i)=>{fields[IDs[i]].value=[...fields[IDs[i]].options].some(o=>o.value===name)?name:''});
   if(config[3]==='なし'){clearCurrentFirework();return}
   const raw=config.map((name,i)=>uniqueNames(i).find(e=>e.name===name)||{name:'なし'});
   const v=resolve(raw);v.raw.forEach((entry,i)=>{fields[IDs[i]].value=[...fields[IDs[i]].options].some(o=>o.value===entry.name)?entry.name:''});
   renderFireworkData(v);return;
 }
 const name=params.get('name');
 if(name&&name.trim()){$('manual').value=name.trim().slice(0,200);interpret(false)}
}
