import { createConfiguredPage, launchBrowser } from "../shared/browser.ts";
import { loadSectionItemsByKey } from "../shared/notification-source.ts";
import { scrapeJobDetail } from "../scrapers/job-details.ts";
import type { JobDetailResult, JobDetailsOutput } from "../shared/types.ts";
import { getDetailSectionConfig } from "../shared/section-config.ts";
import { resolveFromCwd } from "../shared/utils.ts";
import { SCRAPE_CONFIG, type DetailSectionKey } from "../config/scrape-config.ts";
import { saveOutput } from "../shared/output.ts";

type RunDetailSectionOptions = {
  limitOverride?: number;
};

export async function runDetailSection(
  sectionKey: DetailSectionKey,
  options: RunDetailSectionOptions = {},
): Promise<void> {
  const startedAtMs = Date.now();
  const sectionConfig = getDetailSectionConfig(sectionKey);

  if (!sectionConfig.enabled) {
    throw new Error(`Section '${sectionConfig.displayName}' is disabled in src/config/scrape-config.ts.`);
  }

  const requestedLimit = Number(options.limitOverride ?? process.argv[2] ?? sectionConfig.limit);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.floor(requestedLimit)
    : sectionConfig.limit;
  const maxWorkers = Math.max(1, Math.floor(SCRAPE_CONFIG.detailScraping.parallelWorkers));

  const items = await loadSectionItemsByKey(sectionKey);
  const itemsToProcess = items.slice(0, limit);

  const browser = await launchBrowser();

  try {
    const results: JobDetailResult[] = [];
    const workerCount = Math.min(maxWorkers, Math.max(itemsToProcess.length, 1));
    let cursor = 0;

    const workers = Array.from({ length: workerCount }, async () => {
      const page = await createConfiguredPage(browser);

      try {
        while (true) {
          const currentIndex = cursor;
          cursor += 1;

          const item = itemsToProcess[currentIndex];
          if (!item) {
            return;
          }

          const detail = await scrapeJobDetail(page, item);
          results[currentIndex] = detail;
        }
      } finally {
        await page.close();
      }
    });

    await Promise.all(workers);

    const output: JobDetailsOutput = {
      scrapedAt: new Date().toISOString(),
      sourceListFile: resolveFromCwd(SCRAPE_CONFIG.homepage.outputFile),
      processedCount: results.filter(Boolean).length,
      items: results.filter(Boolean),
    };

    const outputPath = resolveFromCwd(sectionConfig.outputFile);
    await saveOutput({
      collectionName: sectionConfig.collectionName,
      filePath: outputPath,
      data: output,
      label: sectionConfig.displayName,
    });

    const durationMs = Date.now() - startedAtMs;
    const durationSeconds = (durationMs / 1000).toFixed(2);
    console.log(`${sectionConfig.displayName}: ${output.processedCount} pages in ${durationSeconds}s`);
  } finally {
    await browser.close();
  }
}
