const express = require("express");
const { store, save, refreshAndSave, patchArrayItem, nextId, getPhoto } = require("../db");
const { requireAdmin, requirePermission } = require("../auth");
const { buildQrSvg, getLogoDataUri } = require("../qr");
const { hasUnpaidOrder, partyOfTable, liveOrdersOf, partyPatchOf } = require("../partySize");
const { channelForTable } = require("../realtime");
const canEditTables = requirePermission("tableEdit");

const router = express.Router();

// The single 포장 카운터 "table" — not a real dine-in table (no floor-plan
// spot, no headcount prompt; see is_counter checks in src/routes/orders.js
// and the party-size route below), but stored as a table row anyway so the
// entire existing ordering/kitchen-queue/payment pipeline works for it
// unchanged. Lazily created on first use (POST /counter or GET
// /counter-qr, both idempotent) rather than seeded, so upgrading an
// existing restaurant doesn't need a migration step.
async function getOrCreateCounterTable() {
  let table = store.tables.find((t) => t.is_counter);
  if (table) return table;
  await refreshAndSave((s) => {
    table = s.tables.find((t) => t.is_counter);
    if (table) return;
    table = {
      id: nextId("tables"),
      number: "COUNTER",
      label: "포장 카운터",
      sort_order: 0,
      zone_id: null,
      x: 10,
      y: 10,
      width: 70,
      height: 70,
      is_counter: true,
    };
    s.tables.push(table);
  });
  return table;
}

/**
 * 직원 화면이 보는 자리 목록.
 *
 * 2026-09-10 사장님: "완전 포장(counter qr)를 제외하고 모든 테이블들은
 * 인원과 메뉴는 하나의 세트야."
 *
 * 그날 결제 탭과 테이블 탭에는 인원이 안 보이는데 실시간 주문 탭에는
 * 보이는 자리가 있었다. 실시간 주문 탭이 없는 숫자를 만들어낸 게 아니다 —
 * 주문은 만들어질 때 그 순간의 인원을 자기 안에 박아두고(결산의 손님 수가
 * 쓰는 값이다) 그걸 보여준 것이고, 자리 쪽 숫자가 사라져 있었던 것이다.
 *
 * 그래서 내보낼 때 둘을 맞춘다. 그리고 어긋난 자리는 그 자리에서 고쳐
 * 놓는다 — 안 고치면 그 자리 QR 은 앉아 계신 손님에게 인원을 다시 묻고,
 * 결제 화면은 빈 자리로 보여준다.
 */
router.get("/", requireAdmin, async (req, res) => {
  const repairs = [];
  const rows = [...store.tables]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((t) => {
      const party = partyOfTable(store, t);
      if (party.from === "order") {
        // 자리에 되돌려 놓는다. 「언제 앉았는가」는 그 주문이 들어온 시각으로
        // 본다 — 자리 이동 안내와 손님 주문 내역이 그 시각을 기준으로 삼는다.
        const live = liveOrdersOf(store, t.number).filter((o) => o.party_size);
        const newest = live.length ? live.reduce((a, b) => (b.id > a.id ? b : a)) : null;
        t.party_size = party.size;
        t.party_adults = party.adults;
        t.party_children = party.children;
        if (!t.party_size_updated_at && newest) {
          t.party_size_updated_at = new Date(String(newest.created_at).replace(" ", "T") + "+08:00").toISOString();
        }
        repairs.push(patchArrayItem("tables", t.id, partyPatchOf(t)));
      }
      return t;
    });
  if (repairs.length) await Promise.all(repairs);
  res.json(rows);
});

router.post("/", canEditTables, async (req, res) => {
  const { number, label } = req.body || {};
  if (!number) return res.status(400).json({ error: "number_required" });
  if (String(number).includes("4")) return res.status(400).json({ error: "unlucky_number" });
  // refreshAndSave (not save()) re-fetches right before creating — narrows
  // the window for a table added from a second admin tab/device at nearly
  // the same moment to race with this one (same "lost update" class of bug
  // fixed for the floor-plan drag/resize PATCHes above).
  let table = null;
  let dupe = false;
  await refreshAndSave((s) => {
    if (s.tables.some((t) => t.number === String(number))) {
      dupe = true;
      return;
    }
    const maxSort = s.tables.reduce((m, t) => Math.max(m, t.sort_order), 0);
    // zone_id starts unset — the table won't appear on the 배치도 floor plan
    // until the owner explicitly adds it into a zone from that view.
    table = {
      id: nextId("tables"),
      number: String(number),
      label: label || null,
      sort_order: maxSort + 1,
      zone_id: null,
      x: 10,
      y: 10,
      width: 70,
      height: 70,
    };
    s.tables.push(table);
  });
  if (dupe) return res.status(400).json({ error: "table_exists" });
  res.status(201).json(table);
});

// Admin: create (or, if it already exists, just return) the 포장 카운터.
// Called from the "포장 카운터 QR 만들기" button in Admin > 테이블 / QR 코드
// (public/js/admin.js's renderCounterSection) — idempotent, so a second
// click or a page reload never creates a duplicate.
router.post("/counter", canEditTables, async (req, res) => {
  const table = await getOrCreateCounterTable();
  res.status(201).json(table);
});

// Admin: move/resize a table within its zone on the floor-plan canvas (or
// assign/unassign it to a zone, or rename its label). x/y are relative to
// the zone the table belongs to, not the overall canvas.
router.patch("/:id", canEditTables, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const table = store.tables.find((t) => t.id === id);
  if (!table) return res.status(404).json({ error: "not_found" });
  const { x, y, width, height, label, zoneId } = req.body || {};
  // Collects only the fields this call actually changes, then writes them
  // with a targeted per-item DB update (see patchArrayItem() in src/db.js)
  // instead of save()'s full-document replace. The 배치도 floor plan fires
  // one of these PATCHes per drag/resize, often several in quick
  // succession while rearranging tables — a full-document save() can race
  // with another one in flight and silently overwrite it with stale data,
  // which is what caused rearranged tables to randomly "revert".
  const updates = {};
  if (zoneId !== undefined) {
    if (zoneId === null) {
      table.zone_id = null;
      updates.zone_id = null;
    } else {
      const zone = store.zones.find((z) => z.id === parseInt(zoneId, 10));
      if (!zone) return res.status(400).json({ error: "zone_not_found" });
      table.zone_id = zone.id;
      updates.zone_id = zone.id;
      if (table.x == null) {
        table.x = 10;
        updates.x = 10;
      }
      if (table.y == null || table.y < 34) {
        table.y = 34; // stay clear of the zone's header strip
        updates.y = 34;
      }
    }
  }
  if (x != null) {
    table.x = Math.max(0, Number(x));
    updates.x = table.x;
  }
  // Stay clear of the zone's header strip (label / + 테이블 / ✕ buttons).
  if (y != null) {
    table.y = table.zone_id != null ? Math.max(34, Number(y)) : Math.max(0, Number(y));
    updates.y = table.y;
  }
  if (width != null) {
    table.width = Math.max(40, Number(width));
    updates.width = table.width;
  }
  if (height != null) {
    table.height = Math.max(40, Number(height));
    updates.height = table.height;
  }
  if (label != null) {
    table.label = String(label).slice(0, 20) || null;
    updates.label = table.label;
  }
  if (Object.keys(updates).length) await patchArrayItem("tables", id, updates);
  res.json(table);
});

// Public: customer sets the headcount for the table they're ordering from.
// Asked once per fresh page load (see public/js/order.js) and kept on the
// table itself, since until payment everyone ordering from that table is
// treated as the same party.
// 자리 이동 안내를 얼마나 오래 들고 있을지.
//
// 2026-09-10 사장님: "자리 이동을 하면 그 즉시 그 자리는 빈 자리로 새 손님을
// 받을 준비가 되어있어야 해."
//
// 그래서 이 값은 이제 「안내를 보여주는 기간」이 아니라 못 받은 폰을 위한
// 마지막 그물일 뿐이다. 실제 경로는 셋이고, 정상적인 경우 전부 즉시 끝난다.
//   1. 옮기는 순간 그 자리 채널로 push 가 간다(src/realtime.js).
//   2. 손님이 「확인」을 누르면 폰이 POST /moved-ack 로 알려주고 여기서 지운다.
//   3. 새 손님이 앉아 인원수가 들어오면 PUT /party-size 가 지운다.
// 남는 경우는 하나뿐이다 — 손님 폰이 그 순간 잠겨 있거나 꺼져 있어서 push 도
// 못 받고 확인도 못 누른 채, 그 자리에 아무도 새로 앉지 않은 상태. 그 폰이
// 다시 켜졌을 때 한 번 알려주면 되므로 길 필요가 없다. 예전의 3시간은 저녁
// 손님의 안내가 밤늦게까지 자리에 남아 있게 했다.
const MOVED_NOTICE_MS = 30 * 60 * 1000;

function movedToFor(table) {
  const m = table && table.moved_to;
  if (!m || !m.to) return null;
  const at = new Date(String(m.at || "").replace(" ", "T") + "+08:00");
  if (Number.isNaN(at.getTime())) return null;
  if (Date.now() - at.getTime() > MOVED_NOTICE_MS) return null;
  // seating — 이 안내가 「내 것」인지 손님 폰이 가리는 두 번째 기준.
  // 직원이 대신 넣어준 주문은 폰에 주문 번호가 없어서 order_ids 로는 못
  // 알아본다(src/routes/orders.js 의 POST /move 주석).
  return { to: m.to, at: m.at, order_ids: m.order_ids || [], seating: m.seating || null };
}

// 어른(大)/아이(小)를 나눠 받는다 — 2026-09-10 사장님: "인원수 물을 때
// 어른(大), 아이(小) 묻기".
//
// 옛 형태(`partySize` 하나만)도 계속 받는다. 손님 폰에 예전 화면이 떠 있는
// 채로 배포가 되면 그 폰은 아직 옛 모양으로 보내는데, 거기서 400을 돌려주면
// 그 손님은 인원수를 못 넣어 주문 자체를 못 한다. 그때는 전부 어른으로 친다.
router.put("/:tableNumber/party-size", async (req, res) => {
  const b = req.body || {};
  const hasSplit = b.adults !== undefined || b.children !== undefined;
  const adults = hasSplit ? parseInt(b.adults, 10) || 0 : parseInt(b.partySize, 10) || 0;
  const children = hasSplit ? parseInt(b.children, 10) || 0 : 0;
  const size = adults + children;
  if (adults < 0 || children < 0) return res.status(400).json({ error: "invalid_party_size" });
  if (!size || size < 1 || size > 50) return res.status(400).json({ error: "invalid_party_size" });
  const table = store.tables.find((t) => t.number === String(req.params.tableNumber));
  if (!table) return res.status(404).json({ error: "table_not_found" });
  table.party_size = size;
  table.party_adults = adults;
  table.party_children = children;
  table.party_size_updated_at = new Date().toISOString();
  // 새 손님이 앉았다 — 「자리가 옮겨졌어요」 안내는 여기서 끝난다.
  // 안 지우면 오늘 저녁 내내 그 자리 손님마다 옮겨가라는 말을 듣는다.
  delete table.moved_to;
  await save();
  res.json({ party_size: table.party_size, party_adults: table.party_adults, party_children: table.party_children });
});

// Public: lets the customer page check whether this table already has a
// party size registered — so a page refresh (or re-scanning the QR code
// mid-visit) doesn't ask again for the same party. Only exposes the one
// field (not the rest of the table record).
router.get("/:tableNumber/party-size", (req, res) => {
  const table = store.tables.find((t) => t.number === String(req.params.tableNumber));
  if (!table) return res.status(404).json({ error: "table_not_found" });
  // is_counter tells the customer page (see initPartySize in public/js/order.js)
  // this QR is the 포장 카운터, not a real table — it skips the headcount
  // prompt entirely rather than treating a missing party_size as "not asked yet".
  // moved_to — 이 자리 손님이 다른 자리로 옮겨졌는가(src/routes/orders.js
  // 의 POST /move). 손님 폰에는 아직 이 자리 화면이 떠 있어서, 그대로
  // 주문하면 그 주문만 빈 자리로 들어간다.
  //
  // 오래된 안내는 내려보내지 않는다. 새 손님이 앉으면 위 PUT 이 지우지만,
  // 아무도 안 앉은 채로 하루가 지나면 그대로 남아 있게 된다.
  const moved = movedToFor(table);
  // 자리와 주문을 함께 본다. 자리 쪽 숫자가 어떤 이유로 사라졌더라도 살아
  // 있는 주문이 있으면 그 손님은 앉아 계신 것이고, 그때 인원을 다시 물으면
  // 앞 손님 밥값이 남은 자리에 새 인원이 찍힌다(2026-09-10 사장님:
  // "인원과 메뉴는 하나의 세트야").
  const party = partyOfTable(store, table);
  res.json({
    party_size: party.size || null,
    // 구분이 생기기 전에 앉은 손님도 같은 모양으로 내려간다(전부 어른).
    party_adults: party.size ? party.adults : null,
    party_children: party.size ? party.children : null,
    is_counter: !!table.is_counter,
    // 지금 앉아 있는 손님이 언제 앉았는지. 손님 폰이 이걸 적어뒀다가,
    // 나중에 「자리가 옮겨졌어요」 안내가 자기 것인지 가리는 데 쓴다
    // (src/routes/orders.js 의 moved_to.seating).
    seating_started_at: party.size ? table.party_size_updated_at || null : null,
    moved_to: moved,
    // 이 자리에 무슨 일이 생기면 알려줄 채널. 손님 폰은 이걸 구독해두고
    // 자리 이동을 「1분 안에」 가 아니라 「그 즉시」 받는다. Pusher 가 설정
    // 안 된 매장에서는 realtime.enabled 가 false 라(GET /api/settings) 폰이
    // 구독을 아예 시도하지 않는다.
    realtime_channel: channelForTable(table.number),
  });
});

/**
 * 손님이 「확인」을 눌렀다 — 안내를 다 봤으니 옛 자리에서 지운다.
 *
 * 2026-09-10 사장님: "자리 이동을 하면 그 즉시 그 자리는 빈 자리로."
 *
 * 이게 없으면 안내가 시간이 다 될 때까지 자리에 붙어 있는다. 그 사이 같은
 * 폰으로 옛 자리 QR 을 다시 열면(뒤로 가기 한 번이면 된다) 이미 확인한
 * 안내가 또 뜬다.
 *
 * 직원 로그인을 요구하지 않는다 — 누르는 사람이 손님이다. 대신 지우는
 * 조건을 좁게 잡는다: 옮겨간 자리 번호가 서버가 아는 것과 같을 때만.
 * 그래야 지나가던 요청 하나가 남의 안내를 조용히 없애지 못한다.
 */
router.post("/:tableNumber/moved-ack", async (req, res) => {
  const table = store.tables.find((t) => t.number === String(req.params.tableNumber));
  if (!table) return res.status(404).json({ error: "table_not_found" });
  const m = table.moved_to;
  if (!m || !m.to) return res.json({ ok: true, cleared: false });
  if (String((req.body || {}).to || "") !== String(m.to)) {
    return res.status(409).json({ error: "moved_to_mismatch" });
  }
  delete table.moved_to;
  await save();
  res.json({ ok: true, cleared: true });
});

// Clears the registered party size — called once a table is fully settled
// (admin's "전체 결제 완료" and the online-payment callback both call this),
// so the *next* party that scans this table's QR code is asked fresh
// instead of silently inheriting the previous party's headcount.
// 직원 전용이다. 손님 화면은 이 라우트를 부르지 않는다(GET 으로 물어볼지
// 정하고, PUT 으로 답을 저장할 뿐이다). 예전에는 아무 보호가 없어서, 주소만
// 알면 누구나 남의 테이블 인원수를 지울 수 있었다 — 이제 결제 탭의
// 「손님 나감」 버튼이 실제로 쓰는 길이므로 확실히 막는다.
router.delete("/:tableNumber/party-size", requireAdmin, async (req, res) => {
  const table = store.tables.find((t) => t.number === String(req.params.tableNumber));
  if (!table) return res.status(404).json({ error: "table_not_found" });
  table.party_size = null;
  table.party_size_updated_at = null;
  table.party_adults = null;
  table.party_children = null;
  await save();
  res.json({ ok: true });
});

// 자리를 없앤다. 세 가지는 거절한다 — 지우고 나면 되돌릴 방법이 없어서다.
//
// 2026-09-10: 포장 손님이 「테이블 0」 으로 들어오고 있었다. 진짜 포장
// 카운터(is_counter)는 따로 멀쩡히 있는데, 손님에게 나가던 QR 이 번호 0 짜리
// 일반 테이블을 가리키고 있었다. 그걸 정리하려면 그 자리를 지워야 하는데,
// 이 라우트는 그때까지 아무것도 확인하지 않고 지웠다.
//
//  1. 그 자리에 아직 안 받은 돈이 있으면 안 된다. 지우는 순간 그 주문은
//     배치도에서 열 수 없는 주문이 된다 — 결제 탭이 자리에서 주문을 찾기
//     때문이다. 돈을 못 받는다.
//  2. 손님이 앉아 계시면(party_size) 안 된다. 주문을 아직 안 넣었을 뿐
//     사람은 그 자리에 있다.
//  3. 포장 카운터는 지울 수 없다. 이건 자리가 아니라 포장 주문이 들어오는
//     길목이고, 지우면 포장 QR 전체가 죽는다. 실수로 눌릴 자리에 있다.
//
// 거절할 때는 왜인지 함께 돌려준다 — 화면이 아무 말 없이 "안 지워졌네" 로
// 끝나면 사장님은 버튼이 고장 난 줄 안다.
router.delete("/:id", canEditTables, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const table = store.tables.find((t) => t.id === id);
  if (!table) return res.status(404).json({ error: "table_not_found" });
  if (table.is_counter) return res.status(400).json({ error: "counter_not_deletable" });
  if (hasUnpaidOrder(store, table.number)) {
    return res.status(400).json({ error: "table_has_unpaid_orders", table_number: table.number });
  }
  if (table.party_size) {
    return res.status(400).json({ error: "table_seated", table_number: table.number });
  }
  await refreshAndSave((s) => {
    s.tables = s.tables.filter((t) => t.id !== id);
  });
  res.json({ ok: true });
});

// Printable sheet of QR codes, one per table, pointing at this server's
// own host — so it always works regardless of what domain the app ends
// up deployed on. Open this page and use the browser's Print > Save as PDF.
router.get("/qr-sheet", requireAdmin, async (req, res) => {
  // 포장 카운터 is included here too (auto-provisioned if it doesn't exist
  // yet) so the owner gets every QR code — tables and the takeout counter —
  // in one print job instead of having to separately open GET /counter-qr.
  // Its sort_order of 0 naturally puts it first in the grid; the
  // is_counter flag drives the distinct badge/border below so it doesn't
  // get mistaken for an actual table number when handed to a customer.
  await getOrCreateCounterTable();
  const tables = [...store.tables].sort((a, b) => a.sort_order - b.sort_order);
  const baseUrl = `${req.protocol}://${req.get("host")}`;
  const storeNameZh = (store.settings && store.settings.store_name_zh) || "韓國館";

  // Load the store logo once (if the owner uploaded one from Admin >
  // 설정), to stamp into the center of every QR code below.
  const logoDataUri = await getLogoDataUri(store, getPhoto);

  const cards = await Promise.all(
    tables.map(async (t) => {
      const url = `${baseUrl}/t/${encodeURIComponent(t.number)}`;
      const svg = await buildQrSvg(url, logoDataUri);
      // Card layout matches the restaurant's existing laminated table-tent
      // reference (掃描 點餐 header, circular number badge, store name
      // footer) so the printed sheet looks like what the owner actually
      // expects instead of a bare QR code. The badge still sits ABOVE the
      // QR in normal document flow, never overlaid on top of it — it used
      // to be absolutely positioned over the QR's top-left corner, which is
      // exactly where one of the three finder-pattern squares a scanner
      // needs lives, and could make the code harder (or, printed slightly
      // larger/offset, impossible) to scan. A label above the code can
      // never cover any part of it.
      return `
        <div class="card${t.is_counter ? " counter-card" : ""}">
          <div class="scan-header">掃描 點餐<br/>QR Code</div>
          <div class="table-no-badge${t.is_counter ? " counter-badge" : ""}">${t.label || t.number}</div>
          ${!t.is_counter && t.label ? `<div class="table-no-sub">${t.number}번</div>` : ""}
          <div class="qr-wrap">${svg}</div>
          <div class="url">${url}</div>
          <div class="store-name">${storeNameZh}</div>
        </div>`;
    })
  );

  res.send(`<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8" />
<title>QR Code 桌牌列印</title>
<style>
  body { font-family: 'Noto Sans TC', Arial, sans-serif; margin: 0; padding: 24px; background:#fff; }
  .toolbar { margin-bottom: 16px; }
  button { padding: 10px 18px; font-size: 14px; cursor: pointer; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
  .card {
    border: 2px dashed #999; border-radius: 12px; padding: 16px; text-align: center;
    page-break-inside: avoid; display:flex; flex-direction:column; align-items:center; gap:6px;
  }
  .counter-card { border-color: #16213e; border-style: solid; }
  /* 라벨을 붙인 자리는 번호가 통째로 가려진다. 2026-09-10 에 그것 때문에
     번호 0 짜리 일반 테이블이 「포장」 이라는 이름으로 포장 카운터 행세를
     하고 있었고, 인쇄물에도 화면에도 0 이 어디에도 안 보여서 아무도
     알아채지 못했다. 라벨 아래에 번호를 작게 같이 적는다 — 포장 카운터만
     번호가 없다(그건 자리가 아니다). */
  .table-no-sub { font-size: 12px; color: #666; margin-top: -2px; }
  .scan-header {
    font-size: 13px; font-weight: 700; color: #222; line-height: 1.3; letter-spacing: 0.5px;
  }
  .qr-wrap { width: 200px; height: 200px; }
  .qr-wrap svg { width: 200px; height: 200px; display: block; }
  .table-no-badge {
    min-width: 30px; height: 30px; padding: 0 10px; white-space: nowrap;
    border-radius: 999px; background: #b5232c; color: #fff; font-size: 15px; font-weight: 800;
    display: flex; align-items: center; justify-content: center;
  }
  .table-no-badge.counter-badge { background: #16213e; }
  .url { font-size: 10px; color: #666; word-break: break-all; }
  .store-name { font-size: 13px; font-weight: 700; color: #444; margin-top: 2px; }
  @media print {
    .toolbar { display: none; }
    .grid { grid-template-columns: repeat(2, 1fr); }
  }
</style>
</head>
<body>
  <div class="toolbar"><button onclick="window.print()">列印 / Print all QR codes</button></div>
  <div class="grid">${cards.join("")}</div>
</body>
</html>`);
});

// Printable single QR code for the 포장 카운터 — separate from the per-table
// grid above since this isn't a table (see getOrCreateCounterTable at the
// top of this file). Auto-provisions the counter on first visit, so there's
// nothing to set up beforehand: clicking "포장 QR 코드 보기/인쇄" in Admin >
// 테이블 / QR 코드 just works.
router.get("/counter-qr", requireAdmin, async (req, res) => {
  const table = await getOrCreateCounterTable();
  const baseUrl = `${req.protocol}://${req.get("host")}`;
  const url = `${baseUrl}/t/${encodeURIComponent(table.number)}`;
  const storeNameZh = (store.settings && store.settings.store_name_zh) || "韓國館";
  const logoDataUri = await getLogoDataUri(store, getPhoto);
  const svg = await buildQrSvg(url, logoDataUri);

  res.send(`<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8" />
<title>外帶櫃檯 QR Code</title>
<style>
  body { font-family: 'Noto Sans TC', Arial, sans-serif; margin: 0; padding: 24px; background:#fff; display:flex; flex-direction:column; align-items:center; gap:20px; }
  .toolbar { margin-bottom: 4px; }
  button { padding: 10px 18px; font-size: 14px; cursor: pointer; }
  .card {
    border: 2px solid #16213e; border-radius: 12px; padding: 28px; text-align: center;
    display:flex; flex-direction:column; align-items:center; gap:12px;
  }
  .scan-header { font-size: 15px; font-weight: 700; color: #222; line-height: 1.3; letter-spacing: 0.5px; }
  .qr-wrap { width: 320px; height: 320px; }
  .qr-wrap svg { width: 320px; height: 320px; display: block; }
  .counter-badge {
    padding: 6px 16px; white-space: nowrap;
    border-radius: 999px; background: #16213e; color: #fff; font-size: 16px; font-weight: 800;
    display: flex; align-items: center; justify-content: center;
  }
  .url { font-size: 12px; color: #666; word-break: break-all; }
  .store-name { font-size: 15px; font-weight: 700; color: #444; }
  @media print { .toolbar { display: none; } }
</style>
</head>
<body>
  <div class="toolbar"><button onclick="window.print()">列印 / Print QR code</button></div>
  <div class="card">
    <div class="scan-header">掃描 點餐<br/>QR Code</div>
    <div class="counter-badge">${table.label || "포장"}</div>
    <div class="qr-wrap">${svg}</div>
    <div class="url">${url}</div>
    <div class="store-name">${storeNameZh}</div>
  </div>
</body>
</html>`);
});

module.exports = router;
