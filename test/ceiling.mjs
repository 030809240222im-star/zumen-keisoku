// 面積から天井下地（LGS）とボードの数量を出す試験。材料積算（dxf-takeoff）の「天井の積算」と同じ数になるかも比べる
// 使い方：node test/ceiling.mjs   （部品 jsdom は dxf-takeoff の試験と同じ %LOCALAPPDATA%\dxf-takeoff、積算は ../../dxf-takeoff/app）
import fs from 'node:fs'; import path from 'node:path'; import {createRequire} from 'node:module'; import {fileURLToPath} from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const DXF=process.env.DXF_TAKEOFF_ROOT || path.resolve(ROOT,'../../dxf-takeoff');
const {JSDOM}=createRequire(path.join(process.env.DXF_TAKEOFF_DEPS||path.join(process.env.LOCALAPPDATA||'','dxf-takeoff'),'package.json'))('jsdom');
let bad=0; const ok=(c,m)=>{ console.log((c?'OK  ':'NG  ')+m); if(!c) bad++; }; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const errs=[]; const dom=new JSDOM(fs.readFileSync(path.join(ROOT,'index.html'),'utf8').replace(/<script src="https:[^"]+"><\/script>/g,''),{url:'http://127.0.0.1:5500/',runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){
  const ctx=new Proxy({}, {get:(t,k)=> k==='measureText'? ()=>({width:10}) : k==='getImageData'||k==='createImageData'? ()=>({data:new Uint8ClampedArray(4)}) : k==='canvas'? {width:1,height:1} : (k in t? t[k] : ()=>{}), set:(t,k,v)=>{ t[k]=v; return true; }});
  w.HTMLCanvasElement.prototype.getContext=()=>ctx; w.ResizeObserver=class{observe(){}}; w.matchMedia=()=>({matches:false,addEventListener(){},addListener(){}}); w.Element.prototype.scrollIntoView=()=>{}; w.indexedDB=undefined; w.fetch=()=>Promise.reject(new Error('x')); w.addEventListener('error',e=>errs.push(e.message)); }});
await sleep(300); const {__S:S, __zk:Z}=dom.window, d=dom.window.document, $=q=>d.querySelector(q);
S.W=40000; S.H=40000; S.nPages=2; S.page=1; S.isPdf=false; S.name='試験図面'; S.scales[1]={mmPerUnit:1,label:'1:1'}; S.meas={1:[],2:[]};
let id=1; const rect=(x,y,w,h,ceil,name)=>({id:id++,page:1,kind:'rect',name:name||'面積 '+id,inc:true,pts:[{x,y},{x:x+w,y:y+h}],...(ceil?{ceil}:{})});
const near=(a,b,t=1e-6)=>Math.abs(a-b)<=t, q=(r,n)=>{ const l=r.lines.find(x=>x.name===n); return l? l.q : 0; }, sp=(r,n)=>{ const l=r.lines.find(x=>x.name===n); return l? l.spec : ''; };

// ---- 1か所の数量 ----
const a=rect(0,0,10000,8000); S.meas[1]=[a]; let r=Z.ceilCalc(a);
ok(r.on && near(r.A,80), '10m×8m の面積を測ると、天井 80 m² として数える');
ok(near(q(r,'野縁受け'),24)&&near(q(r,'ダブル野縁'),16)&&near(q(r,'シングル野縁'),40)&&near(q(r,'シングルクリップ'),240)&&near(q(r,'ダブルクリップ'),80)&&near(q(r,'ハンガー'),128)&&near(q(r,'吊りボルト'),128)&&near(q(r,'ナット'),256), '捨貼り 80㎡：野縁受け24・ダブル野縁16・シングル野縁40・クリップ240/80・ハンガー128・ボルト128・ナット256（100㎡あたりの表×0.8）');
ok(near(q(r,'普通せっこうボード GB-R 9.5mm'),80/(0.91*1.82)) && sp(r,'普通せっこうボード GB-R 9.5mm')==='3×6' && near(q(r,'ビス'),80/(0.91*1.82)*36), 'ボード GB-R9.5：80÷1.6562＝48.3枚（切り上げ49）、ビス 3.5×22 は1枚36本');
ok(sp(r,'吊りボルト')==='W3/8（3分） L=1,000' && r.note.some(n=>/階高/.test(n)), '階高が分からないときは吊りボルト 1,000（断りを出す）');
S.stexts={1:[{raw:'CH=2,400',cx:5000,cy:4000},{raw:'ＣＨ＝３０００',cx:20000,cy:4000},{raw:'洋室',cx:5000,cy:3000}]}; a.ceil={H:3500}; r=Z.ceilCalc(a);
ok(r.ch===2400 && r.chSrc==='図面の文字', '囲みの中の「CH=2,400」を天井高として読む（囲みの外の CH は読まない）');
ok(r.fz===900 && r.L===900 && sp(r,'吊りボルト')==='W3/8（3分） L=900', '階高3,500−CH2,400−スラブ200＝懐900 → 吊りボルト L=900');
a.ceil={H:5000}; r=Z.ceilCalc(a); ok(r.L===2400 && r.note.some(n=>/懐 1.5m/.test(n)), '懐 1.5m 以上は、補強が要ると断る');
a.ceil={H:3500, ch:2600}; r=Z.ceilCalc(a); ok(r.ch===2600 && r.chSrc==='手入力' && r.L===700, 'CH を手で入れると、図面の文字より優先');
a.ceil={kind:'突付貼り'}; r=Z.ceilCalc(a); ok(near(q(r,'ダブル野縁'),48)&&near(q(r,'ダブルクリップ'),256), '突付貼り：ダブル野縁60・ダブルクリップ320 /100㎡');
a.ceil={kind:'スパンドレル'}; r=Z.ceilCalc(a); ok(!q(r,'ダブル野縁') && near(q(r,'シングル野縁'),64), 'スパンドレル：ダブル野縁なし・シングル野縁80 /100㎡');
a.ceil={ser:25}; r=Z.ceilCalc(a); ok(sp(r,'野縁受け')==='CC-25 L=5,000' && sp(r,'野縁ジョイント（シングル）')==='25SJ', '25形：CC-25・25SJ');
a.ceil={low:'GB-R9.5', up:'RAB12'}; r=Z.ceilCalc(a); ok(near(q(r,'岩綿吸音板 RAB'),80) && sp(r,'岩綿吸音板 RAB')==='t=12' && near(q(r,'ビス'),80/(0.91*1.82)*36), '捨て貼り GB-R9.5＋上貼り 岩綿吸音板12：岩綿は m² で80');
a.ceil={low:'GB-R9.5', up:'GB-R9.5'}; r=Z.ceilCalc(a); ok(near(q(r,'ステープル'),80/(0.91*1.82)*150), '上貼りの石膏ボードはステープル 419J を1枚150本');
a.ceil={low:'', up:''}; r=Z.ceilCalc(a); ok(!r.lines.some(l=>l.cat==='ボード') && q(r,'野縁受け')>0, 'ボードなしにすると、下地だけ数える');
a.ceil={on:false}; ok(!Z.ceilCalc(a).on && !Z.ceilCalc(a).lines.length, '「数える」を外すと数えない');
delete a.ceil; const c=Object.assign({id:id++,page:1,kind:'circle',name:'円',pts:[{x:0,y:0},{x:2000,y:0}]}); ok(near(Z.ceilCalc(c).A,Math.PI*4,1e-3), '円の面積も天井として数える（半径2m＝12.57㎡）');
S.meas[2]=[Object.assign(rect(0,0,5000,5000),{page:2})]; ok(!Z.ceilCalc(S.meas[2][0]).on && Z.ceilCalc(S.meas[2][0]).why==='縮尺が決まっていない', '縮尺のないページは数えない'); S.meas[2]=[];
{ const C=Z.normCeil({on:'yes',kind:'<img src=x>',ser:'19',low:'GB-X',up:'RAB12',ch:'2400',H:-5,slabT:5,foo:1}); ok(C.on===false && !('kind' in C) && C.ser===19 && !('low' in C) && C.up==='RAB12' && C.ch===2400 && !('H' in C) && !('foo' in C), '読み込んだ変な値は使わない（決まった値だけ残す）'); }

// ---- 材料積算（dxf-takeoff）と比べる ----
const APP=path.join(DXF,'app','material-estimate.html');
let src=fs.readFileSync(APP,'utf8'); src=src.replace('// 起動：','window.__m={get S(){return S},compute,openFile};\n// 起動：');
const edom=new JSDOM('<!doctype html><html><head><meta charset="utf-8"></head><body>'+src+'</body></html>',{url:'https://zairyo.test/',runScripts:'dangerously',pretendToBeVisual:true});
await sleep(150); const M=edom.window.__m;
// 部屋：いろいろな張り方・野縁・ボード・CH・大きさ
const KINDS=['捨貼り','突付貼り','目透し貼り','スパンドレル'], BDS=[['GB-R9.5',''],['GB-R12.5','RAB12'],['GB-F15','GB-R9.5'],['','GB-S12.5'],['GB-R9.5','RAB9'],['','']];
S.stexts={}; S.ceilDef.H=3800; const rooms=[]; let n=0;
for (const k of KINDS) for (const ser of [19,25]) for (const [low,up] of BDS){ n++; const w=2000+n*137, h=1500+n*91;
  rooms.push(rect((n%10)*12000,Math.floor(n/10)*12000,w,h,{kind:k,ser,low,up,ch:2200+(n%7)*100},`部屋${n}`)); }
rooms.push(rect(0,200000,9100,7300,{ch:2400},'CH なし'));  rooms[rooms.length-1].ceil={};   // CH が分からない部屋
S.meas[1]=[...rooms];
{ const w0=Z.takeoffWork(); ok(!w0.info.walls && w0.info.room.n===rooms.length, '壁のない図面：天井だけの作業データになる（積算は壁のない作業データを開けないので、画面では書き出さずに案内する）'); }
S.meas[1].push({id:id++,page:1,kind:'dist',name:'壁',inc:true,pts:[{x:0,y:300000},{x:3000,y:300000}],wall:{sys:'a2k',h:2700,base:'start',openings:[]}});   // 積算は壁が1本ないと開けない
const {work, info}=Z.takeoffWork();
ok(info.room.n===rooms.length && work.summary.rooms.length===rooms.length && work.settings.slab==='3800', `天井として数える ${rooms.length}か所を、作業データの部屋として渡す（階高 3800）`);
await M.openFile({name:'試験_積算用作業データ.json', text:async()=>JSON.stringify(work)});
ok(M.S.rooms && M.S.rooms.length===rooms.length, `壁と一緒に書き出すと、積算で天井の部屋として開ける（部屋 ${M.S.rooms.length}）`);
// 積算の部屋ごとの設定を、こちらで選んだ物に合わせて数え直す（作業データでは張り方・ボードは渡らない）
const CE=M.S.cfg.ceil||(M.S.cfg.ceil={}); CE.rows=CE.rows||{}; for (const R of work.summary.rooms) CE.rows['|'+R.name]={kind:R.kind, ser:R.ser, bd:R.bd};
const E=M.compute().C; let same=0, diff=[];
for (const m of rooms){ const zr=Z.ceilCalc(m), er=E.rows.find(x=>x.name===m.name); if (!er){ diff.push(m.name+' 積算に無い'); continue; }
  if (!er.on){ if (!zr.ch) { same++; continue; } diff.push(m.name+' 積算で数えない：'+er.why); continue; }
  const key=l=>[l.cat,l.name,l.spec,l.unit].join('|'), zl=new Map(zr.lines.map(l=>[key(l),l.q])), el=new Map(er.lines.map(l=>[key(l),l.q]));
  const keys=new Set([...zl.keys(),...el.keys()]); const bad1=[...keys].filter(k=>!near(zl.get(k)||0, el.get(k)||0, 1e-6));
  if (bad1.length) diff.push(m.name+' '+bad1.slice(0,2).map(k=>`${k} ${zl.get(k)} / ${el.get(k)}`).join('、')); else same++; }
ok(!diff.length, `同じ部屋を積算と比べ、材料・規格・数量がすべて同じ（${same}/${rooms.length}か所）`+(diff.length? '\n     '+diff.slice(0,4).join('\n     ') : ''));
const er=E.rows.find(x=>x.name==='CH なし'); ok(er && !er.on && /CH/.test(er.why), 'CH の分からない部屋は、積算では「数える」が外れる（書き出しで断る）');
ok(info.room.noCh===1 && info.room.other>0, '書き出しの断り：CH なし 1か所・標準と違う張り方の部屋あり');
{ const zs=Z.ceilTotals(rooms.map(Z.ceilCalc).filter(x=>x.on&&x.ch)), es=new Map(); for (const R of E.rows) if (R.on) for (const l of R.lines){ const k=[l.name,l.spec,l.unit].join('|'); es.set(k,(es.get(k)||0)+l.q); }
  ok(zs.every(l=>near(l.q, es.get([l.name,l.spec,l.unit].join('|'))||0, 1e-6)), `合計も同じ（材料 ${zs.length}行）`); }

// ---- 画面 ----
S.meas[1]=[rect(0,0,10000,8000,null,'洋室'), rect(12000,0,6000,4000,null,'廊下')]; const [A,B]=S.meas[1]; delete S.ceilDef.H; errs.length=0;
S.sel=A.id; Z.refreshProps(); await sleep(20);
ok($('#props #cKind') && $('#props .ceqn') && /野縁受け/.test($('#props').textContent), '面積を選ぶと、設定欄に天井の張り方・ボードと数量の表が出る');
$('#cKind').value='目透し貼り'; $('#cKind').onchange({target:$('#cKind')}); await sleep(20); ok(A.ceil.kind==='目透し貼り' && /目透し貼り/.test($('#props').textContent), '張り方を変えると、その面積に入る');
$('#cH').value='3600'; $('#cH').onchange({target:$('#cH')}); await sleep(20); ok(A.ceil.H===3600, '階高を入れられる');
$('#cOn').checked=false; $('#cOn').onchange({target:$('#cOn')}); await sleep(20); ok(A.ceil.on===false && !$('#props .ceqn'), '「数える」を外すと表が消える'); A.ceil.on=true;
ok(/天井/.test($('#tot').textContent), '合計欄に天井の面積が出る');
Z.openCeilBatch({}); await sleep(20); ok(d.querySelectorAll('#cbTbl tr[data-id]').length===2 && $('#cbSum .ceq'), '天井の集計：面積ごとの表と、材料の合計が出る');
d.querySelectorAll('#cbTbl [data-sel]').forEach(x=>{ x.checked=true; x.onchange({target:x}); }); $('#cbLow').value='GB-R12.5'; $('#cbUp').value='RAB12'; $('#cbH').value='3700'; $('#cbApply').click(); await sleep(20);
ok(A.ceil.low==='GB-R12.5' && B.ceil.up==='RAB12' && B.ceil.H===3700, '選んだ面積に、まとめて捨て貼り・上貼り・階高を入れられる');
ok(/岩綿吸音板/.test($('#cbSum').textContent), '合計の表にも反映される');
const off=$('#cbTbl tr[data-id="'+B.id+'"] [data-on]'); off.checked=false; off.onchange({target:off}); await sleep(20); ok(B.ceil.on===false, '表から「数える」を外せる');
$('#cbDef').checked=false; $('#cbDef').onchange({target:$('#cbDef')}); const C2=rect(0,30000,3000,3000); S.meas[1].push(C2); ok(!Z.ceilCalc(C2).on, '「面積を測ったら天井として数える」を外すと、新しい面積は数えない'); S.ceilDef.on=true;
ok(!errs.length, '画面の操作でエラーが出ない'+(errs.length?'（'+errs[0]+'）':''));
console.log(bad? `\n${bad}件 不合格` : '\nすべて合格'); process.exit(bad?1:0);
