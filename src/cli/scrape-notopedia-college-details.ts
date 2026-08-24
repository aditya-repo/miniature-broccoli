import { pathToFileURL } from "node:url";
import { readJsonFile, writeJsonFile } from "../shared/files.ts";
import { resolveFromCwd } from "../shared/utils.ts";
import {
  scrapeNotopediaCollegeDetailsBatch,
  type NotopediaCollegeDetailsBatchResult,
} from "../scrapers/notopedia-college-details.ts";
import type { NotopediaCollegeListResult } from "../scrapers/notopedia-college-list.ts";

const DEFAULT_LIST_FILE = "src/notopedia/college-list.json";
const DEFAULT_BATCH_SIZE = 50;

function parseArgs(): {
  listFile: string;
  outputFile: string;
  batchNumber: number;
  batchSize: number;
  workers: number;
} {
  const args = process.argv.slice(2);
  let listFile = DEFAULT_LIST_FILE;
  let outputFile = "";
  let batchNumber = 1;
  let batchSize = DEFAULT_BATCH_SIZE;
  let workers = 3;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]?.trim();
    if (!arg) {
      continue;
    }

    if (arg === "--list" || arg === "-l") {
      listFile = args[index + 1]?.trim() || listFile;
      index += 1;
      continue;
    }

    if (arg === "--output" || arg === "-o") {
      outputFile = args[index + 1]?.trim() || outputFile;
      index += 1;
      continue;
    }

    if (arg === "--batch" || arg === "-b") {
      const value = Number(args[index + 1]);
      if (Number.isFinite(value) && value > 0) {
        batchNumber = Math.floor(value);
      }
      index += 1;
      continue;
    }

    if (arg === "--batch-size") {
      const value = Number(args[index + 1]);
      if (Number.isFinite(value) && value > 0) {
        batchSize = Math.floor(value);
      }
      index += 1;
      continue;
    }

    if (arg === "--workers" || arg === "-w") {
      const value = Number(args[index + 1]);
      if (Number.isFinite(value) && value > 0) {
        workers = Math.floor(value);
      }
      index += 1;
      continue;
    }

    if (!arg.startsWith("-") && batchNumber === 1 && Number.isFinite(Number(arg))) {
      batchNumber = Math.floor(Number(arg));
    }
  }

  if (!outputFile) {
    const paddedBatch = String(batchNumber).padStart(3, "0");
    outputFile = `src/notopedia/college-details-batch-${paddedBatch}.json`;
  }

  return { listFile, outputFile, batchNumber, batchSize, workers };
}

export async function main(): Promise<NotopediaCollegeDetailsBatchResult> {
  const { listFile, outputFile, batchNumber, batchSize, workers } = parseArgs();
  const listPath = resolveFromCwd(listFile);
  const outputPath = resolveFromCwd(outputFile);
  const startedAt = Date.now();

  const source = await readJsonFile<NotopediaCollegeListResult>(listFile);
  const startIndex = (batchNumber - 1) * batchSize;

  if (startIndex >= source.colleges.length) {
    throw new Error(
      `Batch ${batchNumber} starts at index ${startIndex}, but the list only has ${source.colleges.length} colleges.`,
    );
  }

  const result = await scrapeNotopediaCollegeDetailsBatch({
    colleges: source.colleges,
    batchNumber,
    batchSize,
    startIndex,
    parallelWorkers: workers,
    onProgress: ({ completed, total, collegeName }) => {
      console.log(`[${completed}/${total}] ${collegeName}`);
    },
  });

  result.sourceListFile = listPath;

  await writeJsonFile(outputPath, result);

  const durationSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `Saved batch ${batchNumber} (${result.processedCount} college details) to ${outputPath} in ${durationSeconds}s`,
  );

  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Notopedia college detail scrape failed: ${message}`);
    process.exit(1);
  });
}
