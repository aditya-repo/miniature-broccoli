import { pathToFileURL } from "node:url";
import { main as scrapeHomepage } from "./scrape-homepage.ts";
import { runDetailSection } from "./run-detail-section.ts";
import { SCRAPE_CONFIG, type DetailSectionKey } from "../config/scrape-config.ts";

export async function main(): Promise<void> {
  await scrapeHomepage();

  const sectionOrder: DetailSectionKey[] = [
    "banner",
    "latestJobs",
    "admitCard",
    "result",
    "answerKey",
    "syllabus",
    "admission",
  ];

  for (const sectionKey of sectionOrder) {
    const sectionConfig = SCRAPE_CONFIG.sections[sectionKey];
    if (!sectionConfig.enabled) {
      continue;
    }

    await runDetailSection(sectionKey, { limitOverride: sectionConfig.limit });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Scrape all failed: ${message}`);
    process.exit(1);
  });
}
