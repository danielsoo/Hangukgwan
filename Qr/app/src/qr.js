const QRCode = require("qrcode");

// Centers a logo (as a base64 data URI) directly over the QR code SVG
// string — no white plate behind it, just the logo image sitting on top of
// the modules. Only safe because the QR is generated with
// errorCorrectionLevel "H" (survives up to ~30% obstruction) — see
// buildQrSvg below. Shared by the real per-table QR sheet
// (src/routes/tables.js) and the settings-page logo preview
// (src/routes/settings.js) so both render identically.
function embedLogoInQrSvg(svg, logoDataUri) {
  const m = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
  if (!m) return svg;
  const vb = parseInt(m[1], 10);
  const logoSize = vb * 0.22;
  const center = vb / 2;
  const overlay = `
    <image x="${center - logoSize / 2}" y="${center - logoSize / 2}" width="${logoSize}" height="${logoSize}" href="${logoDataUri}" />
  `;
  return svg.replace("</svg>", `${overlay}</svg>`);
}

async function buildQrSvg(url, logoDataUri) {
  let svg = await QRCode.toString(url, { type: "svg", errorCorrectionLevel: "H", margin: 1, width: 300 });
  if (logoDataUri) svg = embedLogoInQrSvg(svg, logoDataUri);
  return svg;
}

// Reads the currently-uploaded store logo (Admin > 설정 > 매장 로고) and
// returns it as a data: URI ready to hand to buildQrSvg, or null if none is
// set. Shared by the real QR sheet and the settings-page live preview.
function photoIdFromUrl(url) {
  if (!url) return null;
  const m = url.match(/^\/api\/photo\/([a-f0-9]{24})$/);
  return m ? m[1] : null;
}

async function getLogoDataUri(store, getPhoto) {
  const photoId = photoIdFromUrl(store.settings.store_logo);
  if (!photoId) return null;
  const photo = await getPhoto(photoId);
  if (!photo || !photo.data) return null;
  const buffer = Buffer.isBuffer(photo.data) ? photo.data : Buffer.from(photo.data.buffer || photo.data);
  return `data:${photo.contentType || "image/png"};base64,${buffer.toString("base64")}`;
}

module.exports = { embedLogoInQrSvg, buildQrSvg, getLogoDataUri };
