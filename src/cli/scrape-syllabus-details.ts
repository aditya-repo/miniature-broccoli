import { pathToFileURL } from "node:url";
import { runDetailSection } from "./run-detail-section.ts";

export async function main(): Promise<void> {
  await runDetailSection("syllabus");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Syllabus detail scrape failed: ${message}`);
    process.exit(1);
  });
}
