import { pathToFileURL } from "node:url";
import * as fs from "node:fs/promises";
import { SCRAPE_CONFIG } from "../config/scrape-config.ts";
import { readJsonFile } from "../shared/files.ts";
import { pushOutputToMongo } from "../shared/output.ts";
import { resolveFromCwd } from "../shared/utils.ts";

type PushTarget = {
  label: string;
  collectionName: string;
  filePath: string;
};

function getPushTargets(): PushTarget[] {
  const targets: PushTarget[] = [
    {
      label: "Homepage",
      collectionName: SCRAPE_CONFIG.homepage.collectionName,
      filePath: SCRAPE_CONFIG.homepage.outputFile,
    },
  ];

  for (const section of Object.values(SCRAPE_CONFIG.sections)) {
    if (!section.enabled) {
      continue;
    }

    targets.push({
      label: section.displayName,
      collectionName: section.collectionName,
      filePath: section.outputFile,
    });
  }

  return targets;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function main(): Promise<void> {
  const targets = getPushTargets();
  let pushed = 0;
  let skipped = 0;

  for (const target of targets) {
    const absolutePath = resolveFromCwd(target.filePath);
    if (!(await fileExists(absolutePath))) {
      console.log(`Skipped ${target.label}: missing ${target.filePath}`);
      skipped += 1;
      continue;
    }

    const data = await readJsonFile<unknown>(target.filePath);
    const count = await pushOutputToMongo({
      collectionName: target.collectionName,
      filePath: absolutePath,
      data,
      label: target.label,
    });

    console.log(`Pushed ${count} document(s) → ${target.collectionName} (${target.filePath})`);
    pushed += 1;
  }

  console.log(`Done. Pushed ${pushed} file(s), skipped ${skipped}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Push to MongoDB failed: ${message}`);
    process.exit(1);
  });
}
