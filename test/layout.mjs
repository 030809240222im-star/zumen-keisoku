// 割付の条件（LGS の建て方・捨て貼り・上貼りの貼り方・端の寸法）と、キワのカット寸法の試験
// 使い方：node test/layout.mjs   （部品 jsdom は dxf-takeoff の試験と同じ %LOCALAPPDATA%\dxf-takeoff）
import fs from 'node:fs'; import path from 'node:path'; import {createRequire} from 'node:module'; import {fileURLToPath} from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const {JSDOM}=createRequire(path.join(process.env.DXF_TAKEOFF_DEPS||path.join(process.env.LOCALAPPDATA||'','dxf-takeoff'),'package.json'))('jsdom');
let bad=0; const ok=(c,m)=>{ console.log((c?'OK  ':'NG  ')+m); if(!c) bad++; }; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const errs=[]; const dom=new JSDOM(fs.readFileSync(path.join(ROOT,'index.html'),'utf8').replace(/<script src="https:[^"]+"><\/script>/g,''),{url:'http://127.0.0.1:5500/',runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){
  const ctx=new Proxy({}, {get:(t,k)=> k==='measureText'? ()=>({width:10}) : k==='getImageData'||k==='createImageData'? ()=>({data:new Uint8ClampedArray(4)}) : k==='canvas'? {width:1,height:1} : (k in t? t[k] : ()=>{}), set:(t,k,v)=>{ t[k]=v; return true; }});
  w.HTMLCanvasElement.prototype.getContext=()=>ctx; w.ResizeObserver=class{observe(){}}; w.matchMedia=()=>({matches:false,addEventListener(){},addListener(){}}); w.Element.prototype.scrollIntoView=()=>{}; w.indexedDB=undefined; w.fetch=()=>Promise.reject(new Error('x')); w.addEventListener('error',e=>errs.push(e.message)); }});
await sleep(300); const {__S:S, __zk:Z}=dom.window, d=dom.window.document;
S.W=20000; S.H=20000; S.nPages=1; S.page=1; S.isPdf=false; S.name='試験図面'; S.scales[1]={mmPerUnit:1,label:'1:1'}; S.meas={1:[]};
let id=1; const wall=(pts,w)=>({id:id++,page:1,kind:pts.length>2?'poly':'dist',name:'壁 '+id,pts:pts.map(([x,y])=>({x,y})),wall:{base:'start',openings:[],...w}});
const L=5460, one=w=>Z.computeWall(wall([[0,0],[L,0]],w)); const near=(a,b,t=1)=>Math.abs(a-b)<=t;
const rowX=(c,k,f)=>Z.cutList(c,k).parts.filter(f).sort((a,b)=>a.x-b.x).map(p=>Math.round(p.w));

// ---- 枚数の見積もり：1枚の定尺から取れる切り物は1枚と数える（2026-11-26 から） ----
{ const c=Z.computeWall(wall([[0,0],[5402,0]],{sys:'f-s12',h:2700,orientLow:'v',lens:[2730]})); ok(c.boards['A下張'].sheets===6, '縦張り 910×2730 で幅5402：910×5＋852 の6枚（852×2700 を2枚と数えない）'); }
{ const c=Z.computeWall(wall([[0,0],[5460,0]],{sys:'f-s12',h:2700,orientLow:'v',lens:[2730]})); ok(c.boards['A下張'].sheets===6, '縦張り 910×2730 で幅5460：6枚'); }
// 取り合う壁がない直線の壁は、端の標準（取り合いの壁厚を引く）でも壁芯までと同じ
for (const [sys,len] of [['a2k',3000],['a2k',5460],['s12w',7850],['f-s12',5460],['sw1',7850]]){
  const t=c=>c.layers.map(k=>{ const b=c.boards[k]; return `${b.orient}${b.bw}x${b.bl}:${b.sheets}`; }).join();
  const a=Z.computeWall(wall([[0,0],[len,0]],{sys,h:2700})), b=Z.computeWall(wall([[0,0],[len,0]],{sys,h:2700,fin:'core'}));
  ok(t(a)===t(b), `取り合いのない ${sys} L${len}：標準と「壁芯まで」が同じ（${t(a)}）`); }

// ---- 目地ずらし（上貼りの目地を、捨て貼りの目地から決めた寸法だけずらす） ----
{ const c=Z.computeWall(wall([[0,0],[5460,0]],{sys:'f-s12',h:2700,orientLow:'v',layLow:'start',orientUp:'v',jOffX:303})); const lo=rowX(c,'A下張',p=>p.T), up=rowX(c,'A上張',p=>p.T);
  ok(lo[0]===910 && up[0]===303 && up[1]===910, `縦目地ずらし 303：捨て貼りの目地 910 に対し、上貼りの目地は 303・1213…（上貼り ${up.slice(0,3).join('・')}）`); ok(!c.boards['A上張'].conflict, '303 ずらすと縦目地は重ならない'); }
{ const c=Z.computeWall(wall([[0,0],[5460,0]],{sys:'f-s12',h:2700,orientLow:'h',layLow:'start',lenLow:1820,vLow:'bottom',orientUp:'h',lenUp:1820,jOffY:455})); const ys=Z.cutList(c,'A上張').parts.filter(p=>p.x<1).map(p=>Math.round(p.y)).sort((a,b)=>a-b);
  ok(ys.includes(910+455) && ys.includes(455), `横目地ずらし 455：捨て貼りの横目地 910 に対し、上貼りの横目地は 455・1365…（${ys.join('・')}）`); }
{ const c=Z.computeWall(wall([[0,0],[5460,0]],{sys:'f-s12',h:2700,orientLow:'v',layLow:'start',orientUp:'v',jOffX:40})); ok(c.boards['A上張'].conflict===false && rowX(c,'A上張',p=>p.T)[0]===40, '40mm のように小さいずらしも、決めたとおりに張る'); }
{ const c=Z.computeWall(wall([[0,0],[5460,0]],{sys:'f-s12',h:2700,orientLow:'v',layLow:'start',orientUp:'v',jOffX:910})); ok(c.boards['A上張'].conflict===true, 'ずらし 910（目地が重なる）は ⚠ を出す'); }

// ---- LGS ----
const xs=c=>c.studs.filter(s=>s.kind==='reg').map(s=>Math.round(s.x));
ok(xs(one({sys:'f-s12',h:2700})).slice(0,3).join()==='455,910,1365', 'LGS 始点から：455・910・1365');
ok(near(xs(one({sys:'f-s12',h:2700,base:'end'})).at(-1),L-455), 'LGS 終点から：終点から455');
ok(xs(one({sys:'f-s12',h:2700,base:'center'})).includes(L/2), 'LGS 中央（柱芯）：真ん中に柱');
{ const x=xs(one({sys:'f-s12',h:2700,base:'gap'})); ok(!x.includes(L/2) && x.some(v=>near(v,L/2-227.5)) && x.some(v=>near(v,L/2+227.5)), 'LGS 中央（間）：真ん中から左右227.5に柱'); }
ok(xs(one({sys:'f-s12',h:2700,lgsFirst:200})).slice(0,2).join()==='200,655', 'LGS 1本目 200：200・655');
{ const c=one({sys:'f-s12',h:2700,arr:'千鳥'}); ok(c.arr==='千鳥' && c.studs.some(s=>s.side==='A'&&s.kind==='reg') && c.studs.some(s=>s.side==='B'&&s.kind==='reg'), 'LGS 建て方を千鳥に変えられる'); }
ok(one({sys:'f-a60',h:2700,arr:'千鳥'}).arr==='なし', 'スタッドのない壁種は建て方を変えない');

// ---- 捨て貼り・上貼り ----
{ const c=one({sys:'f-s12',h:2700,orientLow:'v',layLow:'start',orientUp:'v',firstUp:455,layUp:'start'}); const b=c.boards;
  ok(rowX(c,'A下張',p=>p.T).join()==='910,910,910,910,910,910', '捨て貼り 縦・始点から：910×6');
  ok(rowX(c,'A上張',p=>p.T)[0]===455 && rowX(c,'A上張',p=>p.T).at(-1)===455, '上貼り 1枚目455：始点455・終点455');
  ok(!b['A上張'].conflict && b['A下張'].offStud===0, '縦目地が重ならず、スタッドの上'); }
{ const c=one({sys:'f-s12',h:2700,orientLow:'v',layLow:'start',orientUp:'v',layUp:'start'}); ok(c.boards['A上張'].alt && rowX(c,'A上張',p=>p.T)[0]===455, '上貼りも始点からにすると、目地が重なるので1枚目を半枚にする（断りを出す）'); }
{ const c=one({sys:'f-s12',h:2700,orientLow:'h',layLow:'end',vLow:'bottom',jtLow:'imo',lenLow:1820,orientUp:'h',vUp:'top',jtUp:'uma',layUp:'cboard'}); const a=c.boards['A下張'], u=c.boards['A上張'];
  ok(a.orient==='h' && a.bl===1820 && a.P[0].stagger===0 && a.P[0].fromTop===false, '捨て貼り 横・通し目地・下から・定尺1820');
  ok(u.orient==='h' && u.P[0].stagger>0 && u.P[0].fromTop===true, '上貼り 横・千鳥目地・上から'); }
{ const c=one({sys:'f-s12',h:3200,orientUp:'v',jtUp:'uma',lenUp:1820}); const ps=Z.cutList(c,'A上張').parts.filter(p=>p.B).sort((a,b)=>a.x-b.x).map(p=>Math.round(p.h));
  ok(new Set(ps).size===2 && ps.every((v,i)=>i<2||v===ps[i-2]), `縦張りの千鳥目地：1列おきに高さが入れ替わる（${[...new Set(ps)].join('・')}）`); }
ok(one({sys:'a2k',h:2700,lenLow:2420}).boards['A下張'].bl===1820, '定尺1820しかないボードは、ほかの定尺を選べない');
{ const c=one({sys:'f-s12',h:2700,orientLow:'v',layLow:'start',layUp:'start',orientUp:'h'}); ok(c.boards['A下張'].orient==='v' && c.boards['A上張'].orient==='h', '捨て貼りは縦・上貼りは横、と別々に選べる'); }

// ---- キワの寸法：足すと壁の面積に合う ----
function unionArea(ns){ let t=0; const X=[...new Set(ns.flatMap(q=>[q.x,q.x+q.w]))].sort((a,b)=>a-b), Y=[...new Set(ns.flatMap(q=>[q.y,q.y+q.h]))].sort((a,b)=>a-b);
  for (let a=1;a<X.length;a++) for (let b=1;b<Y.length;b++){ const x=(X[a]+X[a-1])/2, y=(Y[b]+Y[b-1])/2; if (ns.some(q=>x>q.x&&x<q.x+q.w&&y>q.y&&y<q.y+q.h)) t+=(X[a]-X[a-1])*(Y[b]-Y[b-1]); } return t; }
let n=0, miss=0, seed=11; const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647, pick=a=>a[Math.floor(rnd()*a.length)];
for (let i=0;i<150;i++){
  const len=Math.round(1200+rnd()*7000), lay=['auto','start','end','center','cboard'];
  const w={sys:pick(['a2k','s12w','f-s12','f-swa','sw1','dr65']),h:Math.round(2300+rnd()*1500),orientLow:pick(['auto','v','h']),orientUp:pick(['auto','v','h']),layLow:pick(lay),layUp:pick(lay),vUp:pick(['','bottom','top']),jtUp:pick(['','imo','uma']),jtLow:pick(['','imo','uma']),gapS:pick([0,68]),gapE:pick([0,30]),gapT:pick([0,10]),gapB:pick([0,10]),openings:[]};
  if (rnd()<.6) w.openings.push({mark:'SD-1',s:Math.round(rnd()*len*.6),w:900,h:2000});
  if (rnd()<.4) w.openings.push({mark:'AW-1',s:Math.round(rnd()*len*.6),w:700,h:900,sill:900});
  const c=Z.computeWall(wall([[0,0],[len,0]],w));
  for (const k of c.layers){ n++; const B=c.boards[k], {parts}=Z.cutList(c,k), F=B.fs[0];
    // 張る範囲 − 開口（重なりは二重に数えない）＝ 切り寸法の面積
    const holes=c.ops.map(o=>{ const x=Math.max(F.a,o.s), y=Math.max(B.y0,+o.sill||0); return {x,y,w:Math.min(F.b,o.e)-x,h:Math.min(B.y1,(+o.sill||0)+ +o.h)-y}; }).filter(q=>q.w>0&&q.h>0);
    const want=(F.b-F.a)*(B.y1-B.y0)-unionArea(holes), got=parts.reduce((s,p)=>s+p.w*p.h-unionArea(p.n),0);
    if (Math.abs(got-want)>Math.max(8000,want*0.001)){ miss++; if (miss<4) console.log('   ずれ',k,JSON.stringify({len,...w}),Math.round(got-want)); } } }
ok(miss===0, `切り寸法を全部足すと、張る面積と合う（150壁・${n}層、合わない物 ${miss}）`);
{ const c=Z.computeWall(wall([[0,0],[5000,0]],{sys:'f-s12',h:2500,orientLow:'v',layLow:'start',orientUp:'v',layUp:'center',lens:[1820],vLow:'bottom',openings:[{mark:'SD-1',s:1000,w:900,h:2000}]})); const r=Z.cutList(c,'A下張').rows;
  ok(r.some(x=>/終点キワ/.test(x.where)&&x.w===450), '終点キワ 450（5000−910×5）'); ok(r.some(x=>/上端/.test(x.where)&&x.h===680), '上端 680（2500−1820）');
  ok(r.some(x=>/L欠き/.test(x.note)) && r.some(x=>/SD-1/.test(x.where)), '開口まわりの切り欠きが出る');
  ok(/終点 450/.test(Z.edgeTxt(c,'A下張')) && /上端 680/.test(Z.edgeTxt(c,'A下張')), 'キワの1行：'+Z.edgeTxt(c,'A下張')); }

// ---- 端の寸法（取り合いの壁厚を引く） ----
{ const a=wall([[0,0],[5000,0]],{sys:'f-s12',h:2700,fin:'auto'}), L1=wall([[0,0],[0,3000]],{sys:'a2k',h:2700}), T1=wall([[5000,-2000],[5000,2000]],{sys:'a2k',h:2700}); S.meas[1]=[a,L1,T1]; const c=Z.computeWall(a), f=k=>c.boards[k].fs[0];
  ok(near(f('B下張').a,68)&&near(f('A下張').a,-68), 'L形：内側（B面）は136/2＝68短く、外側（A面）は68長い'); ok(near(f('A下張').b,4932)&&near(f('B下張').b,4932), 'T形：両面とも68短い'); ok(near(c.area,5000*2700), '壁面積は変えない（芯々のまま）');
  a.wall.fin='core'; ok(near(Z.computeWall(a).boards['A下張'].fs[0].a,0), '「壁芯まで」を選ぶと元の長さ'); delete a.wall.fin; ok(near(Z.computeWall(a).boards['B下張'].fs[0].a,68), '何も選ばない壁は、取り合いの壁厚を引く（標準）'); a.wall.fin='core'; a.wall.gapS=50; ok(near(Z.computeWall(a).boards['A下張'].fs[0].a,50)&&near(Z.computeWall(a).studs[0].x,50), '逃げ 始点50：ボードも LGS も50から');
  // 図面の向きが逆でも、A面・B面が入れ替わるだけ
  const r=wall([[5000,0],[0,0]],{sys:'f-s12',h:2700,fin:'auto'}); S.meas[1]=[r,L1,T1]; const cr=Z.computeWall(r); ok(near(cr.boards['A下張'].fs[0].b,4932)&&near(cr.boards['B下張'].fs[0].b,5068)&&near(cr.boards['A下張'].fs[0].a,68), '逆向きに測っても、内側・外側を取り違えない');
  const short=wall([[68,9000],[3000,9000]],{sys:'f-s12',h:2700,fin:'auto'}), T2=wall([[0,8000],[0,10000]],{sys:'a2k',h:2700}); S.meas[1]=[short,T2]; ok(near(Z.computeWall(short).boards['A下張'].fs[0].a,0), '相手の壁の面まで測った壁は、二重に引かない');
  const z=wall([[0,0],[3000,0],[3000,2000]],{sys:'f-s12',h:2700,fin:'auto'}); S.meas[1]=[z]; const q=Z.computeWall(z); ok(near(q.boards['A下張'].fs[0].b,3057.5)&&near(q.boards['B下張'].fs[0].b,2942.5), '折れ点：外側（A面）は57.5長く、内側（B面）は57.5短い（壁厚115）');
  ok(/<svg/.test(Z.elevSVG(q,'A下張',1,{})) && !/NaN/.test(Z.elevSVG(q,'A下張',1,{mir:true})), '折れた壁の図が描ける');
  const lone=wall([[0,0],[3000,0]],{sys:'f-s12',h:2700,fin:'auto'}); S.meas[1]=[lone]; ok(!Z.computeWall(lone).trim.found, '取り合う壁がなければ壁芯まで（断りを出す）'); }

// ---- 読み込んだ値の検査 ----
{ const c=one({sys:'f-s12',h:2700,layLow:'"><img src=x onerror=alert(1)>',firstUp:'1e9',arr:{},gapT:-5,vUp:'x',lenUp:'abc'}); ok(c.layers.length===4, '変な値の入ったファイルでも計算できる（その値は使わない）'); }

// ---- 画面 ----
const A=wall([[0,0],[5460,0]],{sys:'f-s12',h:2700,openings:[{mark:'SD-1',s:1000,w:900,h:2000}]}), B=wall([[0,4000],[3000,4000]],{sys:'a2k',h:2700,gapS:20}); S.meas[1]=[A,B]; errs.length=0;
const $=q=>d.querySelector(q);
Z.openDevView({}); await sleep(20); const set=(k,v)=>{ const e=$(`.laycond [data-lk="${k}"]`); e.value=v; e.onchange(); };
ok(['jOffX','jOffY','arr','pitch','base','lgsFirst','orientLow','layLow','firstLow','vLow','jtLow','lenLow','orientUp','layUp','firstUp','vUp','jtUp','lenUp','fin','gapS','gapE','gapT','gapB'].every(k=>$(`.laycond [data-lk="${k}"]`)), '展開図に LGS・捨て貼り・上貼り・キワの選択が出る');
set('orientLow','v'); set('layLow','start'); set('orientUp','h'); set('layUp','end'); set('base','end'); set('gapE','30');
ok(A.wall.orientLow==='v'&&A.wall.layLow==='start'&&A.wall.orientUp==='h'&&A.wall.layUp==='end'&&A.wall.base==='end'&&A.wall.gapE===30, '選ぶと壁に入る');
ok(/捨て貼り/.test($('#dvSheet').textContent) && /キワのカット寸法/.test($('#dvSheet').textContent), '展開図にキワのカット寸法と割付の条件が載る');
ok(!/NaN|undefined/.test($('#dvSheet').innerHTML), '図に欠けた数字がない');
$('[data-la="all"]').click(); await sleep(10); ok(B.wall.layUp==='end'&&B.wall.base==='end'&&B.wall.gapS===20&&!B.wall.gapE, '「全壁に同じ条件」：貼り方は写し、逃げは壁ごとのまま'); ok(Z.newWallObj().layUp==='end', 'これから描く壁にも同じ条件が入る');
[...d.querySelectorAll('#dvMode button')].find(b=>b.dataset.v==='cut').click(); await sleep(10); ok(/SD-1/.test($('#dvSheet').textContent), 'カット寸法表のページが出る');
ok(Z.cutRows([A,B]).length>8 && Z.cutRows([A,B])[0].includes('幅(mm)'), 'カット寸法の CSV（'+(Z.cutRows([A,B]).length-1)+'行）');
$('[data-la="reset"]').click(); await sleep(10); ok(!A.wall.layLow&&!A.wall.gapE&&A.wall.base==='start', '「自動に戻す」');
$('#bCancel').click(); Z.showElevation(A); await sleep(10); ok($('#eCond .laycond')&&$('.cutq'), '割付図にも条件とカット寸法の表が出る'); set('layUp','center'); ok(A.wall.layUp==='center'&&$('.cutq'), '割付図で選んでも効く');
$('#bCancel').click(); S.sel=A.id; Z.refreshProps(); await sleep(20); ok($('#pLay').value==='__mix', '壁の設定欄：捨て貼り・上貼りで違うときは「別々」と出る'); $('#pLay').value='start'; $('#pLay').onchange({target:$('#pLay')}); ok(A.wall.layMode==='start'&&!A.wall.layUp, '設定欄でまとめて選ぶと両方に効く');
// ---- 捨て貼りと上貼りを重ねた割付図・目地ずらしの寸法 ----
{ const w0=wall([[0,0],[5460,0]],{sys:'f-s12',h:2700,orientLow:'v',layLow:'start',orientUp:'v',jOffX:303,openings:[]}); S.meas[1]=[w0]; const c=Z.computeWall(w0), J=Z.jointOffsets(c,'A');
  ok(J.minV===303 && J.v.length>0 && J.v.every(j=>j.d===303||j.d===607), `縦目地ずらし 303 を入れると、重ねた図の寸法も 303（最小 ${J.minV}）`);
  w0.wall.jOffX=40; const J2=Z.jointOffsets(Z.computeWall(w0),'A'); ok(J2.minV===40 && J2.few>0, 'ずらし 40 は 100 未満として数える（赤で出す）');
  const sv=Z.elevSVG(Z.computeWall(w0),'A重ね',1,{}); ok(/stroke-dasharray="7 4"/.test(sv) && />40</.test(sv) && !/NaN|undefined/.test(sv), '重ねた図：捨て貼りは破線、上貼りは実線、ずらし寸法を書く');
  ok(!/NaN|undefined/.test(Z.elevSVG(Z.computeWall(w0),'A重ね',1,{mir:true})), '正面から見た向き（左右反転）でも描ける');
  const sh=Z.sheetSVG(w0,1,1,'A'); ok(/A面 重ね/.test(sh) && /目地ずらし/.test(sh), '展開図の「A面」のページに重ねた図が入る');
  delete w0.wall.jOffX; w0.wall.orientLow='h'; w0.wall.lenLow=1820; w0.wall.lenUp=1820; w0.wall.openings=[{mark:'SD-1',s:1200,w:900,h:2100}]; const J3=Z.jointOffsets(Z.computeWall(w0),'A');
  ok(J3.h.length>0 && J3.v.every(j=>j.d<=910), `捨て貼り横張り・開口あり：横目地のずらしも出し、板の幅より遠い目地は書かない（縦 ${J3.minV}・横 ${J3.minH}）`);
  Z.showElevation(w0); await sleep(10); ok($('.etabs [data-l="A重ね"]') && $('.etabs [data-l="B重ね"]'), '割付図に「A面 重ね」「B面 重ね」のタブが出る'); $('.etabs [data-l="A重ね"]').click(); await sleep(10); ok(/stroke-dasharray="7 4"/.test($('#esvg').innerHTML), 'タブを押すと重ねた図が出る'); $('#bCancel').click(); }
ok(!errs.length, '画面の操作でエラーが出ない'+(errs.length?'（'+errs[0]+'）':''));
console.log(bad? `\n${bad}件 不合格` : '\nすべて合格'); process.exit(bad?1:0);
