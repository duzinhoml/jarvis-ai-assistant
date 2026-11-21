import { readFile, mkdir, writeFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type MemoryFile, isMemoryFile } from "./index.js";
import { randomUUID } from "node:crypto";

export const loadMemoryFile = async (filePath: string): Promise<MemoryFile> => {
  let file;

  try {
    file = await readFile(filePath, "utf-8");
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error) {
      if (error.code === "ENOENT") return { version: 1, facts: [] };
    }
    throw error;
  }

  const fileObj: unknown = JSON.parse(file);

  if (!isMemoryFile(fileObj))
    throw new Error(
      "Saved memory has an invalid format. Expected version 1 and valid facts with unique normalized keys.",
    );

  return fileObj;
};

export const saveMemoryFile = async (
  filePath: string,
  file: MemoryFile,
): Promise<void> => {
  if (!isMemoryFile(file))
    throw new Error(
      "Cannot save memory. Expected version 1 and valid facts with unique normalized keys.",
    );

  await mkdir(dirname(filePath), { recursive: true });

  const stringFile = JSON.stringify(file);

  const tempFile = join(dirname(filePath), `memory-${randomUUID()}`);

  try {
    await writeFile(tempFile, stringFile);
    await rename(tempFile, filePath);
  } catch (error) {
    try {
      await unlink(tempFile);
    } finally {
      throw error;
    }
  }
};
