import { pathToFileURL } from "node:url";
import { writeJsonFile } from "../shared/files.ts";
import { resolveFromCwd } from "../shared/utils.ts";
import { scrapeNotopediaCollegeList } from "../scrapers/notopedia-college-list.ts";

const DEFAULT_OUTPUT = "src/notopedia/college-list.json";

function parseArgs(): { outputFile: string; pageLimit?: number; startPage: number } {
  const args = process.argv.slice(2);
  let outputFile = DEFAULT_OUTPUT;
  let pageLimit: number | undefined;
  let startPage = 1;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]?.trim();
    if (!arg) {
      continue;
    }

    if (arg === "--output" || arg === "-o") {
      outputFile = args[index + 1]?.trim() || outputFile;
      index += 1;
      continue;
    }

    if (arg === "--pages" || arg === "-p") {
      const value = Number(args[index + 1]);
      if (Number.isFinite(value) && value > 0) {
        pageLimit = Math.floor(value);
      }
      index += 1;
      continue;
    }

    if (arg === "--start") {
      const value = Number(args[index + 1]);
      if (Number.isFinite(value) && value > 0) {
        startPage = Math.floor(value);
      }
      index += 1;
      continue;
    }

    if (!arg.startsWith("-") && pageLimit === undefined) {
      const value = Number(arg);
      if (Number.isFinite(value) && value > 0) {
        pageLimit = Math.floor(value);
      }
    }
  }

  return { outputFile, pageLimit, startPage };
}

export async function main(): Promise<void> {
  const { outputFile, pageLimit, startPage } = parseArgs();
  const outputPath = resolveFromCwd(outputFile);
  const startedAt = Date.now();

  const result = await scrapeNotopediaCollegeList({
    pageLimit,
    startPage,
    onProgress: ({ page, totalPages, colleges }) => {
      console.log(`Page ${page}/${totalPages} scraped (${colleges} colleges so far)`);
    },
  });

  await writeJsonFile(outputPath, result);

  const durationSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `Saved ${result.count} college(s) from ${result.pageCount} page(s) to ${outputPath} in ${durationSeconds}s`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Notopedia college list scrape failed: ${message}`);
    process.exit(1);
  });
}
