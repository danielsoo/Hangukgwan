# 韓國館 QR Code Ordering System

A QR-code table-ordering system for Hangukgwan, similar to Tag Here. Customers
scan a QR code at their table and order from their phone; you manage the
menu, tables, and see every order live from an admin dashboard.

## What's included

- **Customer ordering page** (`/t/12` for table 12) — browse the full menu
  in Chinese, Korean, or English, add items to a cart (with options like
  牛/豬 or 鮪魚/蝦仁 where relevant), add notes, and submit the order. They
  can then watch its status (Received → Preparing → Served → Paid) live.
- **Owner admin dashboard** (`/admin`) — password-protected. Four tabs:
  - **即時訂單 (Live Orders)** — a kanban board of every order, grouped by
    status, refreshing automatically every few seconds with a sound alert
    on new orders.
  - **菜單管理 (Menu)** — add/edit/delete dishes: name (中/한/EN),
    description, price, price note (e.g. "2人份"), spicy/signature tags,
    options (e.g. 牛,豬), photo upload, and an availability toggle to take
    a dish off the menu without deleting it.
  - **桌號 / QR Code (Tables)** — add/remove tables and print a ready-to-cut
    sheet of QR codes, one per table, that always point at wherever this
    app is currently hosted.
  - **設定 (Settings)** — store name/phone/address/hours/min-spend shown
    on the customer page footer, and change the admin password.
- The full 韓國館 menu (49 dishes) is pre-loaded from your paper order slip
  and printed menu — codes, prices, and Korean names included. Photos start
  blank; add them anytime from Admin > 菜單管理 by tapping a dish.

## Tech notes

Plain Node.js + Express, with MongoDB Atlas as the datastore (menu, orders,
tables, settings, and uploaded photos all live there — no local disk is
used, which is what makes this deployable on serverless hosts like Vercel).
The live order board and order-status tracking refresh via polling every
few seconds rather than a persistent WebSocket connection, since serverless
functions can't hold one open — in practice this means a few seconds of
delay instead of instant push, which is a fair trade for being deployable
anywhere for free/cheap.

## Running it locally (to try it out)

You'll need [Node.js](https://nodejs.org) 18 or newer installed, and a
MongoDB Atlas connection string (a free cluster at
[mongodb.com/cloud/atlas](https://www.mongodb.com/cloud/atlas) is plenty —
Database > Connect > Drivers gives you the URL).

```bash
cd app
cp .env.example .env      # then edit .env — set MONGODB_URI and ADMIN_PASSWORD
npm install
npm start
```

Then open:
- `http://localhost:3000/admin` — log in with the password from `.env`
- `http://localhost:3000/t/1` — the customer menu for table 1

## Deploying so customers can scan and order on their own phones

Because customers use their own mobile data (not your restaurant WiFi), the
app needs to live at a public web address. Since all data lives in MongoDB
Atlas rather than on local disk, this app deploys cleanly to serverless
hosts like Vercel as well as traditional hosts like Railway or Render.

### Option A: Vercel

1. Create a free MongoDB Atlas cluster at
   [mongodb.com/cloud/atlas](https://www.mongodb.com/cloud/atlas), and copy
   its connection string (Database > Connect > Drivers).
2. Push this repository to GitHub if you haven't already.
3. Go to [vercel.com/new](https://vercel.com/new), import the GitHub repo.
   If the repo has more than just this app in it, set **Root Directory**
   to wherever this `app` folder lives (e.g. `Qr/app`).
4. Under **Environment Variables**, add:
   - `MONGODB_URI` — your Atlas connection string
   - `ADMIN_PASSWORD` — your real admin password
   - `SESSION_SECRET` — any long random string
5. Click **Deploy**. Once it's live, visit `/admin` on your Vercel URL, log
   in, go to **桌號 / QR Code**, and click **🖨️ 全部 QR Code 列印** to get a
   printable sheet of QR codes pointing at your live URL.

Note: the live order board and order-status screen refresh every few
seconds (polling) rather than instantly, since Vercel's serverless
functions can't hold a persistent connection open.

### Option B: Railway or Render

Both work the same way and don't require any command-line knowledge:

1. Push this `app` folder to a GitHub repository.
2. Railway: **New Project > Deploy from GitHub repo**. Render: **New Web
   Service** from your GitHub repo. Either auto-detects Node.js and runs
   `npm install` + `npm start`.
3. Set the same three environment variables as above (`MONGODB_URI`,
   `ADMIN_PASSWORD`, `SESSION_SECRET`).
4. Once deployed, visit `/admin` on your public URL and print the QR sheet
   the same way as above.

If you'd rather run this on a computer physically at the restaurant instead
of hosting it online (customers would then need your restaurant WiFi to
order), just run `npm start` on that machine and keep it running — the app
listens on port 3000 by default (still needs `MONGODB_URI` set in `.env`).

## Day-to-day use

- **Changing prices/photos/descriptions**: Admin > 菜單管理, tap any dish,
  edit, save.
- **86'ing a dish for the day**: tap the dish, uncheck "上架供應中", save —
  it disappears from the customer menu but stays in your data for later.
- **Seeing what a table ordered and when**: Admin > 即時訂單, tap any order
  card for the full breakdown with timestamps.
- **Adding/removing tables**: Admin > 桌號 / QR Code. After adding a table,
  reprint the QR sheet so the new table has a code.
- **Changing the admin password**: Admin > 設定.

## Support

The customer-facing pages and admin dashboard are plain HTML/CSS/JS files
under `public/` if you (or a developer) ever want to adjust the look and
feel. The menu seed data lives in `src/seed.js` if you want to bulk-edit it
directly instead of through the dashboard.
