// 지금 쓰는 방식(가까운 이웃 + k-means 견본)을 **같은 자료·같은 묶음**으로
// 재서 신경망과 공정하게 비교한다.
const fs=require("fs"),path=require("path");
const {load,feat14,rngOf}=require("./train.js");
const P=load(process.env.PAIRED||"big-paired");
const B=load(process.env.BOOT||"big-boot");
for(const s of P)s.f=feat14(s.img);
for(const s of B)s.f=feat14(s.img);
const norm=(v)=>{let m=0;for(const x of v)m+=x*x;m=Math.sqrt(m)||1;
 const o=new Float32Array(v.length);for(let i=0;i<v.length;i++)o[i]=v[i]/m;return o;};
for(const s of P)s.g=norm(s.f);
for(const s of B)s.g=norm(s.f);
const photos=[...new Set(P.map(s=>s.photo))];
const fold=new Map(photos.map((p,i)=>[p,i%5]));
const FOLDS=Number(process.env.FOLDS||2);
const PER=Number(process.env.PER||40);
let ok=0,n=0;
for(let g=0;g<FOLDS;g++){
 const test=P.filter(s=>fold.get(s.photo)===g);
 const tr=P.filter(s=>fold.get(s.photo)!==g).concat(B.filter(s=>!fold.has(s.photo)||fold.get(s.photo)!==g));
 if(!test.length||!tr.length)continue;
 // 숫자마다 k-means 로 PER 개
 const red=[];
 for(let d=0;d<10;d++){
  const pool=tr.filter(t=>t.d===d).map(t=>t.g);
  if(!pool.length)continue;
  const kk=Math.min(PER,pool.length);
  let cen=[];
  for(let i=0;i<kk;i++)cen.push(Float32Array.from(pool[Math.floor(i*pool.length/kk)]));
  for(let it=0;it<12;it++){
   const sum=cen.map(()=>new Float32Array(196)),cnt=cen.map(()=>0);
   for(const t of pool){let bi=0,bv=-1;
    for(let i=0;i<cen.length;i++){let v=0;for(let j=0;j<196;j++)v+=t[j]*cen[i][j];if(v>bv){bv=v;bi=i;}}
    for(let j=0;j<196;j++)sum[bi][j]+=t[j];cnt[bi]++;}
   cen=cen.map((c,i)=>{if(!cnt[i])return c;const v=new Float32Array(196);
    for(let j=0;j<196;j++)v[j]=sum[i][j]/cnt[i];return norm(v);});
  }
  for(const c of cen)red.push({d,f:c});
 }
 for(const s of test){
  const sc=red.map(t=>{let v=0;for(let j=0;j<196;j++)v+=s.g[j]*t.f[j];return{v,d:t.d};});
  sc.sort((a,b)=>b.v-a.v);
  const vote={};for(let i=0;i<3&&i<sc.length;i++)vote[sc[i].d]=(vote[sc[i].d]||0)+sc[i].v;
  const d=+Object.keys(vote).reduce((a,b)=>vote[b]>vote[a]?b:a);
  n++; if(d===s.d)ok++;
 }
}
console.log(`가까운 이웃(견본 ${PER}개/숫자): ${ok}/${n} = ${(ok/Math.max(n,1)*100).toFixed(1)}%`);
