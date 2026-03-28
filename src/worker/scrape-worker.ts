import { pathToFileURL } from "node:url";
import { main as scrapeAll } from "../cli/scrape-all.ts";

export async function main(): Promise<void> {
  const startedAt = new Date();
  console.log(`[worker] Started at ${startedAt.toISOString()}`);

  await scrapeAll();

  const finishedAt = new Date();
  console.log(`[worker] Finished at ${finishedAt.toISOString()}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[worker] Failed: ${message}`);
    process.exit(1);
  });
}
