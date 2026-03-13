import { Router } from "express";
import { hasGeminiKey } from "../config/env";
import { sendGeminiTestPrompt } from "../lib/gemini/service";

export const geminiRouter = Router();

function getGeminiErrorMessage(error: unknown) {
  if (error instanceof Error) {
    if (error.message === "fetch failed") {
      return "Could not reach the Gemini API from the backend. Check network access and GEMINI_API_KEY.";
    }

    return error.message;
  }

  return "Gemini test prompt failed.";
}

geminiRouter.post("/test-prompt", async (_request, response) => {
  if (!hasGeminiKey()) {
    response.status(503).json({
      error: "GEMINI_API_KEY is not configured on the backend.",
    });
    return;
  }

  try {
    const result = await sendGeminiTestPrompt();

    response.status(200).json({
      text: result.text,
      model: result.model,
      liveModel: result.liveModel,
    });
  } catch (error) {
    response.status(502).json({
      error: getGeminiErrorMessage(error),
    });
  }
});
