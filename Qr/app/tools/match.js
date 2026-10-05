// 사진 이름이 엑셀 정답과 짝이 맞는 것이 몇 장인가.
const fs=require("fs");
const T=require("./truth.js");
(async()=>{
 const truth=await T.load();
 const lines=fs.readFileSync("entries.tsv","utf8").split("\n").filter(Boolean);
 let have=0, no=0; const byYear={}, byVendor={}, miss={};
 const picked=[];
 for(const l of lines){
  const [zip,name]=l.split("\t");
  const base=name.replace(/\.(jpg|jpeg|png)$/i,"");
  const k=T.keyOf(base);
  if(!k){no++; continue;}
  const rows=truth.get(k.key);
  const [,vendor,date]=k.key.split("|");
  if(!rows){ no++; miss[vendor]=(miss[vendor]||0)+1; continue; }
  have++;
  byYear[date.slice(0,4)]=(byYear[date.slice(0,4)]||0)+1;
  byVendor[vendor]=(byVendor[vendor]||0)+1;
  picked.push([zip,name,k.key,rows.length].join("\t"));
 }
 console.log(`사진 ${lines.length}장 · 엑셀 정답이 있는 것 ${have} · 없는 것 ${no}`);
 console.log(`해마다: ${Object.keys(byYear).sort().map(y=>`${y} ${byYear[y]}`).join(" · ")}`);
 const tv=Object.entries(byVendor).sort((a,b)=>b[1]-a[1]);
 console.log(`업체 ${tv.length}곳 — 많은 순: ${tv.slice(0,12).map(([v,n])=>`${v} ${n}`).join(" · ")}`);
 console.log(`정답 못 찾은 이름 많은 순: ${Object.entries(miss).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([v,n])=>`${v} ${n}`).join(" · ")}`);
 fs.writeFileSync("picked.tsv",picked.join("\n"));
 console.log(`picked.tsv 에 ${picked.length}줄`);
})();
