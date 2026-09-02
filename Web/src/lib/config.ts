// Single source of truth for the "order online" destination — the QR
// ordering system's takeout counter (`/t/COUNTER`), not a dine-in table.
//
// Change the deployed URL by setting NEXT_PUBLIC_ORDER_URL (e.g. in a
// Vercel project's Environment Variables) and redeploying — no code
// change needed. Until a custom domain is bought for the QR app, point
// this at whatever it's currently deployed to (e.g. a *.vercel.app URL).
export const ORDER_URL =
  process.env.NEXT_PUBLIC_ORDER_URL || 'https://REPLACE_WITH_QR_ORDER_DOMAIN.example/t/COUNTER'
