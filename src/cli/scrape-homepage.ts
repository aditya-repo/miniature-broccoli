import { pathToFileURL } from "node:url";
import { launchBrowser, createConfiguredPage } from "../shared/browser.ts";
import { SCRAPE_CONFIG } from "../config/scrape-config.ts";
import { scrapeHomepageLists } from "../scrapers/homepage-lists.ts";
import { resolveFromCwd } from "../shared/utils.ts";
import { saveOutput } from "../shared/output.ts";
import { setLatestNotificationsCache } from "../shared/runtime-cache.ts";

async function diagnoseEmptyHomepage(page: import("playwright").Page): Promise<string> {
  const snapshot = await page.evaluate(() => ({
    title: document.title,
    anchorCount: document.querySelectorAll("a").length,
    viewMoreCount: Array.from(document.querySelectorAll("a")).filter((anchor) =>
      (anchor.textContent || "").trim().toLowerCase() === "view more",
    ).length,
    bodyPreview: (document.body?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 240),
  }));

  return JSON.stringify(snapshot);
}

export async function main(): Promise<void> {
  const browser = await launchBrowser();

  try {
    const page = await createConfiguredPage(browser);
    const result = await scrapeHomepageLists(page);

    if (result.sectionCount === 0) {
      const snapshot = await diagnoseEmptyHomepage(page);
      throw new Error(
        `Homepage scrape returned 0 sections. The site may be blocking this runner or the layout changed. Snapshot: ${snapshot}`,
      );
    }

    setLatestNotificationsCache(result);
    const outputPath = resolveFromCwd(SCRAPE_CONFIG.homepage.outputFile);

    await saveOutput({
      collectionName: SCRAPE_CONFIG.homepage.collectionName,
      filePath: outputPath,
      data: result,
      label: "Homepage",
    });
    console.log(
      `Saved JSON to ${outputPath} (${result.sectionCount} sections, ${result.bannerLinks.length} banner links)`,
    );
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
