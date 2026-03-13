import { GoogleGenAI } from "@google/genai";
import { getGeminiApiKey } from "../../config/env";

let geminiClient: GoogleGenAI | null = null;

// Keep the API key on the server so the browser never talks to Gemini directly.
export function getGeminiClient() {
  const apiKey = getGeminiApiKey();

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  if (!geminiClient) {
    geminiClient = new GoogleGenAI({ apiKey });
  }

  return geminiClient;
}
