import { Router } from "express";
import { hasGeminiKey } from "../config/env";
import {
  appendSystemEventToLiveReviewSession,
  closeLiveReviewSession,
  createLiveReviewSession,
  drainAudioChunksFromLiveReviewSession,
  getLiveReviewSessionState,
  sendAudioChunkToLiveReviewSession,
  sendAudioStreamEndToLiveReviewSession,
  sendFrameToLiveReviewSession,
  sendTextMessageToLiveReviewSession,
  startHiddenKickoffForLiveReviewSession,
} from "../lib/gemini/liveSession";

export const liveRouter = Router();

function parseImageDataUrl(imageDataUrl: string) {
  const match = imageDataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);

  if (!match) {
    return null;
  }

  return {
    mimeType: match[1],
    data: match[2],
  };
}

function parseBase64AudioChunk(data: unknown, mimeType: unknown) {
  if (
    typeof data !== "string" ||
    typeof mimeType !== "string" ||
    !data ||
    !mimeType.startsWith("audio/")
  ) {
    return null;
  }

  return {
    data,
    mimeType,
  };
}

function parseSystemEventText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseUserName(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getLiveErrorMessage(error: unknown) {
  if (error instanceof Error) {
    if (error.message === "fetch failed") {
      return "Could not reach the Gemini Live API from the backend. Check network access and GEMINI_API_KEY.";
    }

    return error.message;
  }

  return "Live Gemini connection failed.";
}

liveRouter.post("/session", async (_request, response) => {
  if (!hasGeminiKey()) {
    response.status(503).json({
      error: "GEMINI_API_KEY is not configured on the backend.",
    });
    return;
  }

  try {
    const session = await createLiveReviewSession();

    response.status(200).json(session);
  } catch (error) {
    response.status(502).json({
      error: getLiveErrorMessage(error),
    });
  }
});

liveRouter.post("/:id/message", async (request, response) => {
  const { id } = request.params;
  const text =
    typeof request.body?.text === "string" ? request.body.text.trim() : "";

  if (!text) {
    response.status(400).json({
      error: "A non-empty text message is required.",
    });
    return;
  }

  try {
    // Reuse the open in-memory Gemini Live session for a single text turn.
    const responseText = await sendTextMessageToLiveReviewSession(id, text);

    if (!responseText) {
      response.status(404).json({
        error: "Live review session not found.",
      });
      return;
    }

    response.status(200).json({ text: responseText });
  } catch (error) {
    response.status(502).json({
      error: getLiveErrorMessage(error),
    });
  }
});

liveRouter.post("/:id/kickoff", async (request, response) => {
  const { id } = request.params;
  const userName = parseUserName(request.body?.userName);

  if (!userName) {
    response.status(400).json({
      error: "A non-empty userName is required.",
    });
    return;
  }

  try {
    const kickoffResult = await startHiddenKickoffForLiveReviewSession(
      id,
      userName,
    );

    if (!kickoffResult) {
      response.status(404).json({
        error: "Live review session not found.",
      });
      return;
    }

    response.status(200).json({
      ok: true,
      status: kickoffResult.status,
      reviewStartedAt: kickoffResult.reviewStartedAt,
    });
  } catch (error) {
    response.status(502).json({
      error: getLiveErrorMessage(error),
    });
  }
});

liveRouter.post("/:id/events", (request, response) => {
  const { id } = request.params;
  const text = parseSystemEventText(request.body?.text);

  if (!text) {
    response.status(400).json({
      error: "A non-empty system event text is required.",
    });
    return;
  }

  try {
    const didAppendEvent = appendSystemEventToLiveReviewSession(id, text);

    if (!didAppendEvent) {
      response.status(404).json({
        error: "Live review session not found.",
      });
      return;
    }

    response.status(200).json({
      ok: true,
    });
  } catch (error) {
    response.status(502).json({
      error: getLiveErrorMessage(error),
    });
  }
});

liveRouter.post("/:id/finish", (request, response) => {
  const { id } = request.params;

  try {
    const didCloseSession = closeLiveReviewSession(id, {
      systemEventText: "Finish review clicked.",
    });

    if (!didCloseSession) {
      response.status(404).json({
        error: "Live review session not found.",
      });
      return;
    }

    response.status(200).json({
      ok: true,
      status: "finished",
    });
  } catch (error) {
    response.status(502).json({
      error: getLiveErrorMessage(error),
    });
  }
});

liveRouter.get("/:id/transcript", (request, response) => {
  const { id } = request.params;

  try {
    const sessionState = getLiveReviewSessionState(id);

    if (!sessionState) {
      response.status(404).json({
        error: "Live review session not found.",
      });
      return;
    }

    response.status(200).json(sessionState);
  } catch (error) {
    response.status(502).json({
      error: getLiveErrorMessage(error),
    });
  }
});

liveRouter.post("/:id/frame", (request, response) => {
  const { id } = request.params;
  const imageDataUrl =
    typeof request.body?.imageDataUrl === "string"
      ? request.body.imageDataUrl
      : "";
  const parsedFrame = parseImageDataUrl(imageDataUrl);

  if (!parsedFrame) {
    response.status(400).json({
      error: "A valid base64 imageDataUrl is required.",
    });
    return;
  }

  try {
    const didSendFrame = sendFrameToLiveReviewSession(id, parsedFrame);

    if (!didSendFrame) {
      response.status(404).json({
        error: "Live review session not found.",
      });
      return;
    }

    response.status(200).json({
      ok: true,
    });
  } catch (error) {
    response.status(502).json({
      error: getLiveErrorMessage(error),
    });
  }
});

liveRouter.post("/:id/audio", (request, response) => {
  const { id } = request.params;
  const audioChunk = parseBase64AudioChunk(
    request.body?.data,
    request.body?.mimeType,
  );

  if (!audioChunk) {
    response.status(400).json({
      error: "A valid base64 audio chunk and audio mimeType are required.",
    });
    return;
  }

  try {
    const didSendAudio = sendAudioChunkToLiveReviewSession(id, audioChunk);

    if (!didSendAudio) {
      response.status(404).json({
        error: "Live review session not found.",
      });
      return;
    }

    response.status(200).json({
      ok: true,
    });
  } catch (error) {
    response.status(502).json({
      error: getLiveErrorMessage(error),
    });
  }
});

liveRouter.post("/:id/audio-end", (request, response) => {
  const { id } = request.params;

  try {
    const didSendAudioStreamEnd = sendAudioStreamEndToLiveReviewSession(id);

    if (!didSendAudioStreamEnd) {
      response.status(404).json({
        error: "Live review session not found.",
      });
      return;
    }

    response.status(200).json({
      ok: true,
    });
  } catch (error) {
    response.status(502).json({
      error: getLiveErrorMessage(error),
    });
  }
});

liveRouter.get("/:id/audio-output", (request, response) => {
  const { id } = request.params;

  try {
    const audioOutput = drainAudioChunksFromLiveReviewSession(id);

    if (!audioOutput) {
      response.status(404).json({
        error: "Live review session not found.",
      });
      return;
    }

    response.status(200).json({
      chunks: audioOutput.chunks,
      interrupted: audioOutput.interrupted,
    });
  } catch (error) {
    response.status(502).json({
      error: getLiveErrorMessage(error),
    });
  }
});
