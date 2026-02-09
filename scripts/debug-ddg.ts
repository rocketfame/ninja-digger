/**
 * One-off: fetch DDG HTML and log structure. Run: npx tsx scripts/debug-ddg.ts
 */
import * as cheerio from "cheerio";

async function main() {
  const url = "https://html.duckduckgo.com/html/?q=Lunaro+site%3Ainstagram.com";
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  const html = await res.text();
  console.log("Status:", res.status, "HTML length:", html.length);

  const $ = cheerio.load(html);
  const aCount = $(".result__a").length;
  const urlCount = $(".result__url").length;
  console.log(".result__a count:", aCount);
  console.log(".result__url count:", urlCount);

  console.log(".result count:", $(".result").length);
  console.log("a[href*='instagram'] count:", $("a[href*='instagram']").length);

  const links: string[] = [];
  $("a[href*='instagram.com']").each((_, el) => {
    const href = $(el).attr("href");
    if (href && !href.includes("duckduckgo.com")) links.push(href);
  });
  console.log("Instagram links found:", links.slice(0, 5));

  const classes = new Set<string>();
  $("[class]").each((_, el) => {
    const c = $(el).attr("class") || "";
    c.split(/\s+/).forEach((cls) => {
      if (cls.includes("result")) classes.add(cls);
    });
  });
  console.log("Classes containing 'result':", [...classes]);
  // First 800 chars to see what DDG actually returned
  console.log("\n--- HTML sample ---\n", html.slice(0, 800));
}
main();
