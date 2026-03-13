import express from "express";
import { configRouter } from "./routes/config";
import { geminiRouter } from "./routes/gemini";
import { healthRouter } from "./routes/health";
import { liveRouter } from "./routes/live";
import { reportRouter } from "./routes/report";
import { sessionsRouter } from "./routes/sessions";

const allowedOrigins = new Set([
  "http://localhost:3000",
  "https://artdirectorai-frontend-9279022099.us-central1.run.app",
]);

export function createApp() {
  const app = express();

  app.use(express.json({ limit: "20mb" }));

  app.use((request, response, next) => {
    const origin = request.headers.origin;

    if (origin && allowedOrigins.has(origin)) {
      response.setHeader("Access-Control-Allow-Origin", origin);
    }

    response.setHeader("Vary", "Origin");
    response.setHeader(
      "Access-Control-Allow-Methods",
      "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    );
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (request.method === "OPTIONS") {
      response.sendStatus(204);
      return;
    }

    next();
  });

  app.use("/config", configRouter);
  app.use("/gemini", geminiRouter);
  app.use("/health", healthRouter);
  app.use("/live", liveRouter);
  app.use("/report", reportRouter);
  app.use("/sessions", sessionsRouter);

  return app;
}