import { Router } from "express";
import { hasGeminiKey, LIVE_MODEL } from "../config/env";

export const configRouter = Router();

configRouter.get("/", (_request, response) => {
  response.status(200).json({
    hasGeminiKey: hasGeminiKey(),
    liveModel: LIVE_MODEL,
  });
});
