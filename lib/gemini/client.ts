import { GoogleGenAI } from "@google/genai";

export function getGeminiClient(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({ apiKey });
}
