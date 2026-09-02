// Single source of truth for where the QR ordering system (Qr/app —
// login, admin dashboard, table/counter ordering) is currently deployed.
//
// Change this by setting NEXT_PUBLIC_QR_APP_URL (e.g. in a Vercel
// project's Environment Variables) and redeploying — no code change
// needed. Once a custom domain is bought and the two projects are
// unified under it (see vercel.json — its rewrites need the same URL),
// this can point at a path on that same domain instead of the QR app's
// own *.vercel.app URL.
const QR_APP_BASE_URL = process.env.NEXT_PUBLIC_QR_APP_URL || 'https://REPLACE_WITH_QR_APP_DOMAIN.example'

// "Order online" — the takeout counter, not a dine-in table.
export const ORDER_URL = `${QR_APP_BASE_URL}/t/COUNTER`

// The QR app's existing owner/admin login (already built and tested
// there — see the vip-membership-system project doc). Nothing new to
// build on the marketing site: this just links to it.
export const ADMIN_URL = `${QR_APP_BASE_URL}/admin`
