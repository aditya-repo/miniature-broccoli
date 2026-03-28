import { pathToFileURL } from "node:url";
import { launchBrowser, createConfiguredPage } from "../shared/browser.ts";
import { SCRAPE_CONFIG } from "../config/scrape-config.ts";
import { scrapeHomepageLists } from "../scrapers/homepage-lists.ts";
import { resolveFromCwd } from "../shared/utils.ts";
import { saveOutput } from "../shared/output.ts";
import { setLatestNotificationsCache } from "../shared/runtime-cache.ts";

export async function main(): Promise<void> {
  const browser = await launchBrowser();

  try {
    const page = await createConfiguredPage(browser);
    const result = await scrapeHomepageLists(page);
    setLatestNotificationsCache(result);
    const outputPath = resolveFromCwd(SCRAPE_CONFIG.homepage.outputFile);

    await saveOutput({
      collectionName: SCRAPE_CONFIG.homepage.collectionName,
      filePath: outputPath,
      data: result,
      label: "Homepage",
    });
    console.log(`Saved JSON to ${outputPath}`);
    return result;
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Scrape failed: ${message}`);
    process.exit(1);
  });
}
