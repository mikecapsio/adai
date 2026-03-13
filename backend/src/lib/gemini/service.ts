import { LIVE_MODEL, TEST_PROMPT_MODEL } from "../../config/env";
import { getGeminiClient } from "./client";
import { getFutureLiveSessionConfig } from "./liveSession";

const TEST_PROMPT =
  "You are an art director reviewing a 3D game asset. Give one short paragraph of practical feedback about silhouette clarity, material breakup, and one next camera angle to inspect.";

/**
 * Sends a small text-only request to Gemini so we can verify backend-to-Gemini
 * connectivity before adding realtime screen and microphone streaming.
 */
export async function sendGeminiTestPrompt() {
  const ai = getGeminiClient();
  const response = await ai.models.generateContent({
    model: TEST_PROMPT_MODEL,
    contents: TEST_PROMPT,
  });

  return {
    text:
      response.text?.trim() ||
      "Gemini responded, but no text was returned in the test response.",
    model: TEST_PROMPT_MODEL,
    futureLiveSession: getFutureLiveSessionConfig(),
    liveModel: LIVE_MODEL,
  };
}
