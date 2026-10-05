// 엑셀 정답이 있는 사진만 옮긴다.
const fs=require("fs"),path=require("path");
const G=require("../src/ingredients.js");
const wanted=new Set(fs.readFileSync(path.join(__dirname,"picked.tsv"),"utf8")
 .split("\n").filter(Boolean).map(l=>l.split("\t")[1]));
const [from,to]=process.argv.slice(2);
let n=0;
for(const f of fs.readdirSync(path.join(__dirname,from))){
 if(!wanted.has(f))continue;
 fs.renameSync(path.join(__dirname,from,f),path.join(__dirname,to,f));
 n++;
}
console.log(`  ${n}장 남김`);
