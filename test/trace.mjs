// 線分タップ（図面の線をタップしてその直線・つながりを測る）の試験。作り物の図面の線（壁厚120の部屋・1本線・T字・L字）で確かめる
// 使い方：node test/trace.mjs   （部品 jsdom は dxf-takeoff の試験と同じ %LOCALAPPDATA%\dxf-takeoff）
import fs from 'node:fs'; import path from 'node:path'; import {createRequire} from 'node:module'; import {fileURLToPath} from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const {JSDOM}=createRequire(path.join(process.env.DXF_TAKEOFF_DEPS||path.join(process.env.LOCALAPPDATA||'','dxf-takeoff'),'package.json'))('jsdom');
let bad=0; const ok=(c,m)=>{ console.log((c?'OK  ':'NG  ')+m); if(!c) bad++; }; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const errs=[]; const dom=new JSDOM(fs.readFileSync(path.join(ROOT,'index.html'),'utf8').replace(/<script src="https:[^"]+"><\/script>/g,''),{url:'http://127.0.0.1:5500/',runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){
  const ctx=new Proxy({}, {get:(t,k)=> k==='measureText'? ()=>({width:10}) : k==='getImageData'||k==='createImageData'? ()=>({data:new Uint8ClampedArray(4)}) : k==='canvas'? {width:1,height:1} : (k in t? t[k] : ()=>{}), set:(t,k,v)=>{ t[k]=v; return true; }});
  w.HTMLCanvasElement.prototype.getContext=()=>ctx; w.ResizeObserver=class{observe(){}}; w.matchMedia=()=>({matches:false,addEventListener(){},addListener(){}}); w.Element.prototype.scrollIntoView=()=>{}; w.indexedDB=undefined; w.fetch=()=>Promise.reject(new Error('x')); w.addEventListener('error',e=>errs.push(e.message)); }});
await sleep(300); const {__S:S, __zk:Z}=dom.window, d=dom.window.document;
// 図面の座標はポイント（本物の PDF と同じ）、縮尺 1/100。下の寸法は実寸 mm で書き、K で割ってポイントにする。壁厚 120 の部屋（外 5000×4000・内 4760×3760）。外側の上の線は 3本に切れている
const K=25.4/72*100, L=[]; const ln=(a,b,c,e)=>L.push(a/K,b/K,c/K,e/K); const box=(x0,y0,x1,y1)=>{ ln(x0,y0,x1,y0); ln(x1,y0,x1,y1); ln(x1,y1,x0,y1); ln(x0,y1,x0,y0); };
ln(0,0,2000,0); ln(2000,0,3500,0); ln(3500,0,5000,0); ln(5000,0,5000,4000); ln(5000,4000,0,4000); ln(0,4000,0,0);
box(120,120,4880,3880);
ln(0,10000,3000,10000); ln(1500,10000,1500,12000);              // 1本線と、その途中に突き当たる線（T字）
ln(0,20000,3000,20000); ln(3000,20000,3000,22000);              // L字（平行な線なし）
// 開口のある壁：内側の線が開口で切れ、開口の脇の線（壁の小口）で外側につながる
ln(0,30000,1500,30000); ln(2400,30000,5000,30000); ln(0,30120,1500,30120); ln(2400,30120,5000,30120); ln(1500,30000,1500,30120); ln(2400,30000,2400,30120);
S.W=40000; S.H=40000; S.nPages=1; S.page=1; S.isPdf=true; S.name='試験'; S.scales[1]={mmPerUnit:K,label:'1/100'}; S.meas={1:[]}; S.zoom=1;
S.geo=Z.buildIndex(new Float32Array(L), new Float32Array(0), new Float64Array(0)); S.geoPage=1;
const len=r=>K*r.pts.reduce((a,p,i)=>i? a+Math.hypot(p.x-r.pts[i-1].x,p.y-r.pts[i-1].y) : 0,0), near=(a,b,t=0.5)=>Math.abs(a-b)<=t;
const area=P=>K*K*Math.abs(P.reduce((a,p,i)=>{ const q=P[(i+1)%P.length]; return a+p.x*q.y-q.x*p.y; },0)/2);

// ---- 1本（直線）----
let r=Z.trSingle(S.geo,{x:2500/K,y:2/K},12,1); ok(r && near(len(r),5000) && r.ends.join()==='出隅,出隅', `外側の上の線（3本に切れている）をタップ：5000 でつなぎ、両端は出隅（${r&&len(r)}・${r&&r.ends}）`);
r=Z.trSingle(S.geo,{x:2500/K,y:121/K},12,1); ok(r && near(len(r),4760) && r.ends.join()==='入隅,入隅', `内側の上の線：4760、両端は入隅（${r&&r.ends}）`);
r=Z.trSingle(S.geo,{x:700/K,y:10001/K},12,1); ok(r && near(len(r),3000) && r.ends.join()==='切れ目,切れ目', `ただの1本線：3000、両端は切れ目（途中の T字では止まらない）（${r&&r.ends}）`);
r=Z.trSingle(S.geo,{x:1501/K,y:11000/K},12,1); ok(r && near(len(r),2000) && r.ends.includes('突き当たり') && r.ends.includes('切れ目'), `ほかの線の途中に当たる線：2000、突き当たり（${r&&r.ends}）`);
r=Z.trSingle(S.geo,{x:1000/K,y:20001/K},12,1); ok(r && near(len(r),3000) && r.ends.join()==='切れ目,曲がり', `平行な線のない L字：曲がり（入隅・出隅は分からない）（${r&&r.ends}）`);
r=Z.trSingle(S.geo,{x:700/K,y:30119/K},12,1); ok(r && near(len(r),1500) && r.ends.join()==='入隅,出隅' || (r && near(len(r),1500) && r.ends[1]==='出隅'), `開口で切れた内側の線：1500、開口の所は壁の小口へ曲がる出隅（${r&&r.ends}）`);
ok(Z.trSingle(S.geo,{x:2500/K,y:2000/K},12,1)===null, '線のない所をタップすると、何も測らない');

// ---- つながり ----
r=Z.trChain(S.geo,{x:2500/K,y:121/K},12,1); ok(r && r.closed && r.pts.length===4 && near(area(r.pts),4760*3760,1), `内側をたどる：一周して面積 ${r&&(area(r.pts)/1e6).toFixed(2)} m²（4.76×3.76）`);
r=Z.trChain(S.geo,{x:2500/K,y:2/K},12,1); ok(r && r.closed && near(area(r.pts),5000*4000,1), `外側をたどる：一周して面積 ${r&&(area(r.pts)/1e6).toFixed(2)} m²（3本に切れた線もつなぐ）`);
r=Z.trChain(S.geo,{x:1000/K,y:20001/K},12,1); ok(r && !r.closed && r.pts.length===3 && near(len(r),5000) && r.ends.join()==='切れ目,切れ目', `L字をたどる：連続線 5000（3000＋2000）（${r&&r.ends}）`);
r=Z.trChain(S.geo,{x:700/K,y:10001/K},12,1); ok(r && !r.closed && near(len(r),3000), 'T字の線は、枝分かれをたどらない');

// ---- 画面：道具を選んでタップ ----
Z.setTool('trace'); ok(S.tool==='trace' && d.querySelector('.tb[data-t="trace"]').classList.contains('on'), '道具「線分」（J キー）');
let m=Z.trTap({x:2500/K,y:121/K},false); ok(m && m.kind==='dist' && m.tr && m.tr.a==='入隅' && m.tr.b==='入隅', '線分タップで「距離」の計測ができ、両端の入隅・出隅を覚える');
ok(/始点 入隅・終点 入隅/.test(d.body.textContent), '一覧に両端の様子（始点 入隅・終点 入隅）が出る');
m=Z.trTap({x:2500/K,y:121/K},true); ok(m && m.kind==='area' && m.pts.length===4, `長押し・ダブルクリック：一周すると「面積」の計測（${m&&m.kind}・${m&&m.pts.length}点）`);
m=Z.trTap({x:1000/K,y:20001/K},true); ok(m && m.kind==='poly' && m.pts.length===3 && m.tr && m.tr.a==='切れ目', '途中で止まると「連続線」の計測');
S.wallDef.autoLine=true; m=Z.trTap({x:2500/K,y:2/K},false); ok(m && m.wall, '「壁として計測」のときは、測った線が壁になる'); S.wallDef.autoLine=false;
S.geo=null; ok(Z.trTap({x:2500/K,y:2/K},false)===null, '線の情報がない図面（画像など）では測らず、案内を出す');
ok(!errs.length, 'エラーが出ない'+(errs.length?'（'+errs[0]+'）':''));
console.log(bad? `\n${bad}件 不合格` : '\nすべて合格'); process.exit(bad?1:0);
