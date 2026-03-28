import * as fs from "node:fs/promises";
import * as path from "node:path";
import { resolveFromCwd } from "./utils.ts";

export async function ensureParentDirectory(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

export async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await ensureParentDirectory(filePath);
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export async function readJsonFile<T>(relativePath: string): Promise<T> {
  const filePath = resolveFromCwd(relativePath);
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}
