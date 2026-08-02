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
    status, updating instantly (no refresh needed) with a sound alert on
    new orders.
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

Plain Node.js + Express, Socket.IO for the live order board, and a small
JSON-file datastore (`data/store.json`) — no database server to manage, and
no native modules to compile, so it installs cleanly on any host.

## Running it locally (to try it out)

You'll need [Node.js](https://nodejs.org) 18 or newer installed.

```bash
cd app
cp .env.example .env      # then edit .env — at minimum change ADMIN_PASSWORD
npm install
npm start
```

Then open:
- `http://localhost:3000/admin` — log in with the password from `.env`
- `http://localhost:3000/t/1` — the customer menu for table 1

## Deploying so customers can scan and order on their own phones

Because customers use their own mobile data (not your restaurant WiFi), the
app needs to live at a public web address. **Railway** is the easiest option
that doesn't require any command-line or server knowledge:

1. Push this `app` folder to a new GitHub repository (or ask someone to help
   with this one-time step — GitHub Desktop makes it a few clicks).
2. Go to [railway.app](https://railway.app), sign up, click **New Project >
   Deploy from GitHub repo**, and select the repository.
3. Railway auto-detects Node.js and runs `npm install` + `npm start` for you.
4. Add a **Volume** (Railway calls it a "Volume") mounted at `/app/data` and
   another at `/app/public/uploads` — this makes sure your menu, orders, and
   uploaded photos survive restarts and redeploys. (Settings > Volumes)
5. In the **Variables** tab, set:
   - `ADMIN_PASSWORD` — your real admin password
   - `SESSION_SECRET` — any long random string
   - (optionally) `DEFAULT_TABLE_COUNT` if you want a different starting
     number of tables than 40 — you can also just add/remove tables from
     the admin dashboard afterwards.
6. Once deployed, Railway gives you a public URL like
   `https://hangukgwan-qr.up.railway.app`. Visit `/admin`, log in, go to
   **桌號 / QR Code**, and click **🖨️ 列印所有 QR Code** — this generates a
   printable sheet of QR codes that already point at your live URL. Print
   it, cut it out, and put one on each table.

**Render** ([render.com](https://render.com)) works the same way if you'd
rather use that — "New Web Service" from your GitHub repo, add a persistent
disk mounted at `/app/data` (and one for `/app/public/uploads`), set the same
environment variables, and deploy.

If you'd rather run this on a computer physically at the restaurant instead
of hosting it online (customers would then need your restaurant WiFi to
order), just run `npm start` on that machine and keep it running — the app
listens on port 3000 by default.

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
