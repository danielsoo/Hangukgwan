// 영수증 부가세 5% 규칙 (2026-10-21, src/ingredientVat.js) — 장부 줄로 넣는 5%.
//
// 사장님: "… 3. 월말에 한꺼번에 5% 청구하는 업체 4. 부가세가 아예 없는 업체 … 체크해서 정확한 금액이
// 산정될 수 있도록 해야함." 재는 것: 5% 가 **한 번만**, **맞는 금액으로** 붙는가 — 고치고 다시 맞춰도.
const fake = require("./fake-mongo");
const V = require("../src/ingredientVat");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

(async () => {
  const client = new fake.MongoClient("mongodb://fake/vat");
  await client.connect();
  const db = client.db("vat");
  const c = db.collection("ingredient_purchases");
  const vc = db.collection(V.COLL);
  const k = { store: "main", date: "2026-10-01", vendor: "房信菓菜行" };
  const put = async (amounts) => {
    await c.deleteMany({ store: k.store, date: k.date, vendor: k.vendor });
    for (const [i, a] of amounts.entries()) await c.insertOne({ _id: `${k.store}|${k.date}|${k.vendor}|${i}`, ...k, name: "x" + i, amount: a });
  };
  const vatRows = async () => (await c.find({ ...k, vat: true }).toArray());

  out.push("[금액]");
  check("★ 줄 합계 × 5%", V.vatOf([{ amount: 600 }, { amount: 400 }]) === 50);
  check("★ 이미 붙은 5% 줄은 다시 안 센다", V.vatOf([{ amount: 1000 }, { amount: 50, vat: true }]) === 50);
  check("소수 둘째 자리까지 (斤 단가 × 0.5)", V.vatOf([{ amount: 33.5 }]) === 1.68, String(V.vatOf([{ amount: 33.5 }])));
  check("빈 영수증엔 0", V.vatOf([]) === 0);

  out.push("\n[줄로 넣고 빼기]");
  await put([600, 400]);
  check("안 골랐으면 5% 줄이 없다", (await V.sync(c, vc, k)) === 0 && (await vatRows()).length === 0);
  await V.setMode(vc, k, "add", false);
  check("★★ 「더해야 함」 → 50 짜리 줄 하나", (await V.sync(c, vc, k)) === 50 && (await vatRows()).length === 1);
  await V.sync(c, vc, k);
  check("★★ 여러 번 맞춰도 한 줄뿐", (await vatRows()).length === 1);
  await put([1200]);
  check("★ 줄이 바뀌면 5% 도 따라간다(60)", (await V.sync(c, vc, k)) === 60 && (await vatRows())[0].amount === 60);
  await V.setMode(vc, k, "included", false);
  check("★ 「이미 포함」 → 5% 줄이 빠진다", (await V.sync(c, vc, k)) === 0 && (await vatRows()).length === 0);
  await V.setMode(vc, k, "add", false);
  await put([]);
  check("★ 영수증이 비면 5% 줄도 없다", (await V.sync(c, vc, k)) === 0 && (await vatRows()).length === 0);

  out.push("\n[업체 기억]");
  const k2 = { store: "main", date: "2026-10-02", vendor: "韓濟" };
  check("처음 업체는 안 고름", (await V.decideOnSave(vc, k2, null, false)) === null);
  await V.setMode(vc, k2, "none", true);
  const k3 = { ...k2, date: "2026-10-03" };
  check("★★ 기억한 업체의 새 영수증은 그 값", (await V.decideOnSave(vc, k3, null, false)) === "none");
  check("★ 그 값이 그 영수증 것으로 적힌다", ((await vc.findOne({ _id: V.receiptId(k3) })) || {}).mode === "none");
  await V.setMode(vc, { ...k2, date: "2026-10-04" }, "add", true);
  check("★ 업체 값을 나중에 바꿔도 지난 영수증은 안 움직인다", (await V.modeFor(vc, k3)).mode === "none");
  check("모르는 값은 받지 않는다", (await V.setMode(vc, k3, "half", false)) === null);

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
