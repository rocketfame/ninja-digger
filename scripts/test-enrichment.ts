/**
 * Тест пошуку посилань і контактів (discoverLinks) без запису в БД.
 * Запуск: npx tsx scripts/test-enrichment.ts
 * Потрібен інтернет (DuckDuckGo/Bing + завантаження знайдених сторінок).
 */

import "dotenv/config";
import { discoverLinks, getSearchResultUrls } from "../lib/enrichV1";

const TEST_ARTISTS = ["Stephan Bodzin", "Recondite"];

async function main() {
  console.log("=== Тест enrichment (пошук посилань і контактів) ===\n");

  const firstQuery = `${TEST_ARTISTS[0]} site:instagram.com`;
  console.log(`Перевірка пошуку: "${firstQuery}"`);
  const searchUrls = await getSearchResultUrls(firstQuery);
  console.log(`Пошук повернув ${searchUrls.length} URL:`, searchUrls.slice(0, 3).join(", ") || "(немає)");
  console.log("");

  for (const name of TEST_ARTISTS) {
    console.log(`--- Артист: ${name} ---`);
    const start = Date.now();
    try {
      const { links, contacts } = await discoverLinks(name, null);
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`Час: ${elapsed} с`);
      console.log(`Посилання (${links.length}):`);
      for (const l of links) {
        console.log(`  [${l.type}] ${l.url} (confidence: ${l.confidence})`);
      }
      console.log(`Контакти (${contacts.length}):`);
      for (const c of contacts) {
        console.log(`  ${c.value} (source: ${c.source_url ?? "—"}, confidence: ${c.confidence})`);
      }
      if (links.length === 0 && contacts.length === 0) {
        console.log("  (нічого не знайдено)");
      }
    } catch (e) {
      console.error("Помилка:", e instanceof Error ? e.message : e);
    }
    console.log("");
  }

  console.log("=== Кінець тесту ===");
}

main();
