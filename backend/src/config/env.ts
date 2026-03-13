import fs from "fs";
import dotenv from "dotenv";
import path from "path";

const backendRoot = path.resolve(__dirname, "..", "..");
const repoRoot = path.resolve(backendRoot, "..");
const envFilePaths = [
  path.join(backendRoot, ".env.local"),
  path.join(backendRoot, ".env"),
  path.join(repoRoot, ".env.local"),
  path.join(repoRoot, ".env"),
];

for (const envFilePath of envFilePaths) {
  if (fs.existsSync(envFilePath)) {
    dotenv.config({
      path: envFilePath,
      override: false,
      quiet: true,
    });
  }
}

function readPort() {
  const portValue = process.env.PORT;

  if (!portValue) {
    return 8080;
  }

  const port = Number.parseInt(portValue, 10);

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`PORT must be a positive integer. Received "${portValue}".`);
  }

  return port;
}

export const PORT = readPort();
export const LIVE_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025";
export const TEST_PROMPT_MODEL =
  process.env.TEST_PROMPT_MODEL?.trim() ||
  (() => {
    throw new Error("TEST_PROMPT_MODEL is not configured.");
  })();

export function hasGeminiKey() {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

export function getGeminiApiKey() {
  return process.env.GEMINI_API_KEY?.trim();
}
