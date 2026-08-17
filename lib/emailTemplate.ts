/**
 * Branded HTML email wrapper for outreach: plain-looking personal body
 * (deliverability!) + designed PromoSound footer with logo and service links.
 * Table layout + inline styles for email-client compatibility.
 */

const LOGO_URL = "https://cdn.shopify.com/s/files/1/0720/1007/2242/files/promosound-logo-black-white.png";

const SERVICES = [
  { label: "Spotify Promo", url: "https://promosoundgroup.net/collections/spotify-promotion" },
  { label: "Beatport Promo", url: "https://promosoundgroup.net/collections/beatport-top-100-promotion" },
  { label: "SoundCloud Promo", url: "https://promosoundgroup.net/collections/s-cloud-promotion" },
  { label: "YouTube Promo", url: "https://promosoundgroup.net/collections/youtube-promotion" },
  { label: "More", url: "https://promosoundgroup.net/" },
];

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Plain-text signature (used as the text-part fallback). */
export const TEXT_SIGNATURE = `\n\n--\nMax | PromoSound\n${SERVICES.map((s) => `${s.label}: ${s.url}`).join("\n")}\nhttps://promosoundgroup.net/`;

/** Wrap a plain-text message into branded HTML (paragraphs + footer). */
export function wrapEmailHtml(bodyText: string): string {
  const paragraphs = bodyText
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px 0;">${escapeHtml(p.trim()).replace(/\n/g, "<br>")}</p>`)
    .join("");

  const serviceLinks = SERVICES.map(
    (s) =>
      `<a href="${s.url}" style="display:inline-block;margin:0 6px 6px 0;padding:7px 14px;border:1px solid #d4d4d4;border-radius:20px;color:#111;font-size:12px;text-decoration:none;">${s.label}</a>`
  ).join("");

  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#ffffff;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;">
    <tr>
      <td style="padding:24px 20px 8px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;">
        ${paragraphs}
      </td>
    </tr>
    <tr>
      <td style="padding:8px 20px 28px 20px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="border-top:1px solid #e5e5e5;padding-top:18px;">
            <a href="https://promosoundgroup.net/" style="text-decoration:none;">
              <img src="${LOGO_URL}" alt="PromoSound" width="130" style="display:block;max-width:130px;height:auto;border:0;margin-bottom:10px;">
            </a>
            <p style="margin:0 0 12px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:#737373;line-height:1.5;">
              Music promotion for electronic artists, trusted by 100k+ musicians since 2013.
            </p>
            <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">${serviceLinks}</div>
          </td></tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
