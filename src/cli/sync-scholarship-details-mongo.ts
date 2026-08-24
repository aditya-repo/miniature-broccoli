import "../shared/prefers-public-dns.ts";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { MongoClient } from "mongodb";
import { SCRAPE_CONFIG } from "../config/scrape-config.ts";

const COLLECTION = "scholarship_details";
const DEFAULT_JSON = "src/notopedia/scholarship-details.json";

type NotopediaScholarshipFile = {
  sourceFile?: string;
  scrapedAt?: string;
  count?: number;
  details?: unknown;
};

function parseArgs(): string {
  const fileArg = process.argv[2]?.trim();
  return fileArg && fileArg.length > 0 ? fileArg : DEFAULT_JSON;
}

function resolvePath(input: string): string {
  return path.isAbsolute(input) ? input : path.join(process.cwd(), input);
}

async function readNotopediaJson(filePath: string): Promise<NotopediaScholarshipFile> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as NotopediaScholarshipFile;
}

function extractScholarshipDetailsDocuments(data: NotopediaScholarshipFile): Record<string, unknown>[] {
  const raw = data.details;
  if (!Array.isArray(raw)) {
    throw new Error("Expected a top-level \"details\" array of scholarship objects in the JSON file.");
  }

  const out: Record<string, unknown>[] = [];
  for (const item of raw) {
    if (item !== null && typeof item === "object" && !Array.isArray(item)) {
      out.push({ ...item } as Record<string, unknown>);
    }
  }
  return out;
}

async function main(): Promise<void> {
  const fileArg = parseArgs();
  const jsonPath = resolvePath(fileArg);

  const mongoUri = process.env[SCRAPE_CONFIG.output.mongoUriEnvVar];
  if (!mongoUri?.trim()) {
    console.error(`Missing MongoDB URI: set ${SCRAPE_CONFIG.output.mongoUriEnvVar} in the environment.`);
    process.exitCode = 1;
    return;
  }

  const data = await readNotopediaJson(jsonPath);
  const documents = extractScholarshipDetailsDocuments(data);

  const client = new MongoClient(mongoUri);
  try {
    await client.connect();
    const collection = client.db().collection(COLLECTION);
    await collection.deleteMany({});
    if (documents.length > 0) {
      await collection.insertMany(documents);
    }
  } finally {
    await client.close();
  }

  console.log(
    `Synced ${documents.length} document(s) to ${COLLECTION} (collection cleared, then re-inserted). Read from ${jsonPath}.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
