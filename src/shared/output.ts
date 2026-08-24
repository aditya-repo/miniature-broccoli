import "./prefers-public-dns.ts";
import { SCRAPE_CONFIG } from "../config/scrape-config.ts";
import { writeJsonFile } from "./files.ts";

type SaveOutputOptions = {
  collectionName: string;
  filePath: string;
  data: unknown;
  label: string;
};

type InsertableDocument = Record<string, unknown>;

export async function saveOutput(options: SaveOutputOptions): Promise<void> {
  if (SCRAPE_CONFIG.output.local) {
    await writeJsonFile(options.filePath, options.data);
  }

  if (SCRAPE_CONFIG.output.remote) {
    await pushOutputToMongo(options);
  }
}

/** Push already-scraped JSON to MongoDB (clears collection, then insertMany). */
export async function pushOutputToMongo(options: SaveOutputOptions): Promise<number> {
  const mongoUri = process.env[SCRAPE_CONFIG.output.mongoUriEnvVar];
  if (!mongoUri) {
    throw new Error(`DB not found: ${SCRAPE_CONFIG.output.mongoUriEnvVar} is missing`);
  }

  let mongodbModule: typeof import("mongodb");

  try {
    mongodbModule = await import("mongodb");
  } catch {
    throw new Error("DB not found: mongodb package is not installed");
  }

  const documents = buildMongoDocuments(options.label, options.data);
  if (documents.length === 0) {
    return 0;
  }

  const client = new mongodbModule.MongoClient(mongoUri);

  try {
    await client.connect();
    const db = client.db();
    const collection = db.collection(options.collectionName);
    await collection.deleteMany({});
    await collection.insertMany(documents);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (/server selection|timed out|ECONNREFUSED|querySrv/i.test(message)) {
      throw new Error(
        `MongoDB connection failed: ${message}. If using Atlas, allow access from GitHub Actions (Network Access → allow 0.0.0.0/0 or add runner IPs).`,
      );
    }

    throw error;
  } finally {
    await client.close();
  }

  return documents.length;
}

function buildMongoDocuments(label: string, data: unknown): InsertableDocument[] {
  if (!isRecord(data)) {
    return [{ label, value: data }];
  }

  if (Array.isArray(data.items)) {
    const meta = buildMetadata(data, label);
    return data.items
      .filter((item): item is InsertableDocument => isRecord(item))
      .map((item) => ({
        ...meta,
        ...item,
      }));
  }

  if (isRecord(data.latestSections)) {
    const meta = buildMetadata(data, label);
    const sectionDocuments = Object.entries(data.latestSections)
      .filter(([, value]) => isRecord(value))
      .map(([sectionName, value]) => ({
        ...meta,
        documentType: "section",
        sectionName,
        ...value,
      }));

    const bannerDocuments = Array.isArray(data.bannerLinks)
      ? data.bannerLinks
          .filter((item): item is InsertableDocument => isRecord(item))
          .map((item) => ({
            ...meta,
            documentType: "bannerLink",
            ...item,
          }))
      : [];

    return [...sectionDocuments, ...bannerDocuments];
  }

  return [
    {
      ...buildMetadata(data, label),
      ...data,
    },
  ];
}

function buildMetadata(data: Record<string, unknown>, label: string): InsertableDocument {
  return {
    scrapeLabel: label,
    scrapedAt: data.scrapedAt ?? new Date().toISOString(),
    source: data.source ?? data.sourceListFile ?? null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
