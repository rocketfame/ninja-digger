/** Clean a raw email text/HTML part into a readable excerpt. */
export function cleanEmailText(raw: string, maxChars = 900): string {
  let text = raw
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-F]{2})/g, (_, h) => {
      try { return Buffer.from(h, "hex").toString("utf8"); } catch { return ""; }
    })
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const quoteIdx = text.search(/\nOn .{5,80} wrote:|\n>{1,2} |\n-{2,}\s*\n/);
  if (quoteIdx > 40) text = text.slice(0, quoteIdx).trim();
  return text.slice(0, maxChars);
}
