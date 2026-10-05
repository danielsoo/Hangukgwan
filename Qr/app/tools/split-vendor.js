// 房信菓菜行 사진의 정답만 따로 뽑는다. 다른 업체는 칸을 잘못 짚어 붙은
// 정답이라 섞으면 해가 된다(2026-10-05 측정: 房信 말고는 한 줄도 안 맞았다).
const fs=require("fs"),path=require("path");
const G=require("../src/ingredients.js");
const WANT=process.env.VENDOR||"房信菓菜行";
for (const name of ["big-paired","big-boot"]) {
 const b=fs.readFileSync(path.join(__dirname,name+".bin"));
 const photos=JSON.parse(fs.readFileSync(path.join(__dirname,name+"-photos.json"),"utf8"));
 const keep=new Set(); 
 photos.forEach((p,i)=>{const m=/^(.+?)-(\d{8})/.exec(p); if(m&&G.canonicalVendor(m[1])===WANT)keep.add(i);});
 const rows=[];
 for(let i=0;i<Math.floor(b.length/787);i++){const o=i*787;
  if(keep.has(b.readUInt16LE(o+1)))rows.push(b.slice(o,o+787));}
 const outPhotos=photos.filter((_,i)=>keep.has(i));
 const remap=new Map(); let n=0;
 photos.forEach((_,i)=>{if(keep.has(i))remap.set(i,n++);});
 const out=Buffer.concat(rows.map(r=>{const c=Buffer.from(r);c.writeUInt16LE(remap.get(r.readUInt16LE(1)),1);return c;}));
 fs.writeFileSync(path.join(__dirname,name.replace("big",WANT==="房信菓菜行"?"fs":"v")+".bin"),out);
 fs.writeFileSync(path.join(__dirname,name.replace("big",WANT==="房信菓菜行"?"fs":"v")+"-photos.json"),JSON.stringify(outPhotos));
 console.log(`${name}: ${Math.floor(b.length/787)}자 → ${rows.length}자 (사진 ${photos.length} → ${outPhotos.length})`);
}
