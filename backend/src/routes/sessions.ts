import { Router } from "express";
import { createMockReviewSession } from "../lib/sessions/createMockSession";

export const sessionsRouter = Router();

sessionsRouter.post("/", (_request, response) => {
  response.status(201).json(createMockReviewSession());
});
