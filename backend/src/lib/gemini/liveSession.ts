import {
  ActivityHandling,
  MediaResolution,
  Modality,
  type LiveServerMessage,
  type Session,
} from "@google/genai";
import { randomUUID } from "crypto";
import { LIVE_MODEL } from "../../config/env";
import { getGeminiClient } from "./client";
import { ART_DIRECTOR_AI_SYSTEM_PROMPT } from "./systemPrompt";

export type ReviewTranscriptItem = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  timestamp: string;
};

export type LiveReviewFinding = {
  area: string;
  issue: string;
  severity: "High" | "Medium" | "Low";
  whyItHurtsQuality: string;
  improvementDirection: string;
  practicalNextStep: string;
};

export type LiveReviewSessionState = {
  id: string;
  status: "connected" | "finished";
  createdAt: string;
  finishedAt?: string;
  userName?: string;
  reviewStartedAt?: string;
  assetName?: string;
  transcript: ReviewTranscriptItem[];
  styleTarget?: string;
  assetType?: string;
  reviewedParts: string[];
  visibilityLimitations: string[];
  findings: LiveReviewFinding[];
  resourceCatalog: string[];
};

export type LiveReviewSessionStateUpdate = {
  assetName?: string | null;
  assetType?: string | null;
  styleTarget?: string | null;
  reviewedParts?: string[];
  visibilityLimitations?: string[];
  findings?: LiveReviewFinding[];
  resourceCatalog?: string[];
};

type LiveAudioChunk = {
  data: string;
  mimeType: string;
};

type HiddenLiveMessage = {
  id: string;
  purpose: "kickoff";
  text: string;
  timestamp: string;
};

type LiveImageFrame = {
  data: string;
  mimeType: string;
};

type StoredLiveReviewSessionState = LiveReviewSessionState & {
  hiddenMessages: HiddenLiveMessage[];
  hasSentKickoff: boolean;
};

type StoredLiveSession = {
  id: string;
  session: Session;
  status: "connected";
  responseQueue: LiveServerMessage[];
  audioQueue: LiveAudioChunk[];
  waiters: Array<{
    resolve: (message: LiveServerMessage) => void;
    reject: (error: Error) => void;
  }>;
  isSendingMessage: boolean;
  wasInterrupted: boolean;
  hasLoggedVisualStreamingActive: boolean;
  hasLoggedVoiceStreamingActive: boolean;
  pendingInputTranscriptionText: string | null;
  pendingOutputTranscriptionText: string | null;
  state: StoredLiveReviewSessionState;
};

const liveSessions = new Map<string, StoredLiveSession>();
const finishedLiveSessionStates = new Map<string, StoredLiveReviewSessionState>();
const LIVE_CONNECT_TIMEOUT_MS = 15000;
const LIVE_MESSAGE_TIMEOUT_MS = 20000;
const LIVE_RESPONSE_VOICE = "Leda";
const GENERIC_ASSET_NAME_WORDS = new Set([
  "asset",
  "model",
  "prop",
  "piece",
  "object",
  "thing",
  "work",
  "scene",
  "item",
  "art",
]);

function createTranscriptTimestamp() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function cloneLiveReviewFinding(
  finding: LiveReviewFinding,
): LiveReviewFinding {
  return { ...finding };
}

function cloneReviewTranscriptItem(
  transcriptItem: ReviewTranscriptItem,
): ReviewTranscriptItem {
  return { ...transcriptItem };
}

function cloneLiveReviewSessionState(
  state: LiveReviewSessionState,
): LiveReviewSessionState {
  return {
    ...state,
    transcript: state.transcript.map(cloneReviewTranscriptItem),
    reviewedParts: [...state.reviewedParts],
    visibilityLimitations: [...state.visibilityLimitations],
    findings: state.findings.map(cloneLiveReviewFinding),
    resourceCatalog: [...state.resourceCatalog],
  };
}

function cloneHiddenLiveMessage(message: HiddenLiveMessage): HiddenLiveMessage {
  return { ...message };
}

function cloneStoredLiveReviewSessionState(
  state: StoredLiveReviewSessionState,
): StoredLiveReviewSessionState {
  return {
    ...cloneLiveReviewSessionState(state),
    hiddenMessages: state.hiddenMessages.map(cloneHiddenLiveMessage),
    hasSentKickoff: state.hasSentKickoff,
  };
}

function archiveLiveReviewSessionState(state: StoredLiveReviewSessionState) {
  finishedLiveSessionStates.set(state.id, cloneStoredLiveReviewSessionState(state));
}

function normalizeUniqueStringList(values: string[]) {
  const seenValues = new Set<string>();
  const nextValues: string[] = [];

  for (const value of values) {
    const normalizedValue = value.trim();
    const dedupeKey = normalizedValue.toLowerCase();

    if (!normalizedValue || seenValues.has(dedupeKey)) {
      continue;
    }

    seenValues.add(dedupeKey);
    nextValues.push(normalizedValue);
  }

  return nextValues;
}

function applyLiveReviewSessionStateUpdate(
  state: LiveReviewSessionState,
  update: LiveReviewSessionStateUpdate,
) {
  if (typeof update.assetName === "string" && update.assetName.trim()) {
    state.assetName = update.assetName.trim();
  }

  if (typeof update.assetType === "string" && update.assetType.trim()) {
    state.assetType = update.assetType.trim();
  }

  if (typeof update.styleTarget === "string" && update.styleTarget.trim()) {
    state.styleTarget = update.styleTarget.trim();
  }

  if (Array.isArray(update.reviewedParts)) {
    state.reviewedParts = normalizeUniqueStringList(update.reviewedParts);
  }

  if (Array.isArray(update.visibilityLimitations)) {
    state.visibilityLimitations = normalizeUniqueStringList(
      update.visibilityLimitations,
    );
  }

  if (Array.isArray(update.findings)) {
    state.findings = update.findings.map(cloneLiveReviewFinding);
  }

  if (Array.isArray(update.resourceCatalog)) {
    state.resourceCatalog = normalizeUniqueStringList(update.resourceCatalog);
  }
}

function appendTranscriptItem(
  state: LiveReviewSessionState,
  role: ReviewTranscriptItem["role"],
  text: string,
) {
  const normalizedText = text.trim();

  if (!normalizedText) {
    return null;
  }

  const lastTranscriptItem = state.transcript[state.transcript.length - 1];

  if (
    lastTranscriptItem?.role === role &&
    lastTranscriptItem.text === normalizedText
  ) {
    return lastTranscriptItem;
  }

  const transcriptItem: ReviewTranscriptItem = {
    id: `transcript-${randomUUID()}`,
    role,
    text: normalizedText,
    timestamp: createTranscriptTimestamp(),
  };

  state.transcript.push(transcriptItem);
  maybeUpdateAssetNameFromText(state, normalizedText);

  return transcriptItem;
}

function toTitleCase(value: string) {
  return value.replace(/\b[a-z]/g, (character) => character.toUpperCase());
}

function normalizeAssetNameCandidate(value: string) {
  const normalizedValue = value
    .replace(/[.,:;!?()[\]{}"'`]+$/g, "")
    .replace(/\b(asset|prop|model|piece|object)\b$/i, "")
    .trim();

  if (!normalizedValue) {
    return null;
  }

  const words = normalizedValue
    .split(/\s+/)
    .map((word) => word.toLowerCase())
    .filter(Boolean);

  if (words.length === 0 || words.length > 4) {
    return null;
  }

  if (words.every((word) => GENERIC_ASSET_NAME_WORDS.has(word))) {
    return null;
  }

  return toTitleCase(words.join(" "));
}

function extractAssetNameCandidate(text: string) {
  const patterns = [
    /\b(?:this|the)\s+(?:asset|prop|model|piece)\s+(?:is|looks like|appears to be)\s+(?:a|an)\s+([a-z0-9][a-z0-9\s-]{1,40})/i,
    /\bit(?:'s| is)\s+(?:a|an)\s+([a-z0-9][a-z0-9\s-]{1,40})/i,
    /\b(?:review(?:ing)?|show(?:ing)?|look(?:ing)? at)\s+(?:a|an|the)\s+([a-z0-9][a-z0-9\s-]{1,40})/i,
    /\b(?:looks like|appears to be)\s+(?:a|an)\s+([a-z0-9][a-z0-9\s-]{1,40})/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (!match) {
      continue;
    }

    const candidate = normalizeAssetNameCandidate(match[1]);

    if (candidate) {
      return candidate;
    }
  }

  return null;
}

function maybeUpdateAssetNameFromText(
  state: LiveReviewSessionState,
  text: string,
) {
  if (state.assetName) {
    return;
  }

  const candidate = extractAssetNameCandidate(text);

  if (candidate) {
    state.assetName = candidate;
  }
}

function upsertTranscriptionTranscriptItem(
  state: LiveReviewSessionState,
  role: "user" | "assistant",
  text: string,
) {
  const normalizedText = text.trim();

  if (!normalizedText) {
    return null;
  }

  const lastTranscriptItem = state.transcript[state.transcript.length - 1];

  if (lastTranscriptItem?.role === role) {
    if (lastTranscriptItem.text === normalizedText) {
      return lastTranscriptItem;
    }

    if (
      normalizedText.startsWith(lastTranscriptItem.text) ||
      lastTranscriptItem.text.startsWith(normalizedText)
    ) {
      lastTranscriptItem.text = normalizedText;
      return lastTranscriptItem;
    }
  }

  return appendTranscriptItem(state, role, normalizedText);
}

function collectAudioChunksFromLiveMessage(message: LiveServerMessage) {
  const audioChunks: LiveAudioChunk[] = [];
  const parts = message.serverContent?.modelTurn?.parts ?? [];

  for (const part of parts) {
    const inlineData = part.inlineData;

    if (
      inlineData?.data &&
      typeof inlineData.data === "string" &&
      typeof inlineData.mimeType === "string" &&
      inlineData.mimeType.startsWith("audio/")
    ) {
      audioChunks.push({
        data: inlineData.data,
        mimeType: inlineData.mimeType,
      });
    }
  }

  return audioChunks;
}

function collectTranscriptItemsFromLiveMessage(
  storedSession: StoredLiveSession,
  message: LiveServerMessage,
) {
  const inputTranscription = message.serverContent?.inputTranscription;
  const outputTranscription = message.serverContent?.outputTranscription;

  if (typeof inputTranscription?.text === "string") {
    const normalizedInputText = inputTranscription.text.trim();

    if (normalizedInputText) {
      storedSession.pendingInputTranscriptionText = normalizedInputText;
    }
  }

  if (typeof outputTranscription?.text === "string") {
    const normalizedOutputText = outputTranscription.text.trim();

    if (normalizedOutputText) {
      storedSession.pendingOutputTranscriptionText = normalizedOutputText;
    }
  }

  if (inputTranscription?.finished && storedSession.pendingInputTranscriptionText) {
    upsertTranscriptionTranscriptItem(
      storedSession.state,
      "user",
      storedSession.pendingInputTranscriptionText,
    );
    storedSession.pendingInputTranscriptionText = null;
  }

  if (
    outputTranscription?.finished &&
    storedSession.pendingOutputTranscriptionText
  ) {
    upsertTranscriptionTranscriptItem(
      storedSession.state,
      "assistant",
      storedSession.pendingOutputTranscriptionText,
    );
    storedSession.pendingOutputTranscriptionText = null;
  }
}

function flushPendingTranscriptions(storedSession: StoredLiveSession) {
  if (storedSession.pendingInputTranscriptionText) {
    upsertTranscriptionTranscriptItem(
      storedSession.state,
      "user",
      storedSession.pendingInputTranscriptionText,
    );
    storedSession.pendingInputTranscriptionText = null;
  }

  if (storedSession.pendingOutputTranscriptionText) {
    upsertTranscriptionTranscriptItem(
      storedSession.state,
      "assistant",
      storedSession.pendingOutputTranscriptionText,
    );
    storedSession.pendingOutputTranscriptionText = null;
  }
}

function pushLiveMessage(
  storedSession: StoredLiveSession,
  message: LiveServerMessage,
) {
  if (message.serverContent?.interrupted) {
    storedSession.wasInterrupted = true;
    storedSession.audioQueue.length = 0;
  }

  collectTranscriptItemsFromLiveMessage(storedSession, message);

  if (
    message.serverContent?.turnComplete ||
    message.serverContent?.generationComplete ||
    message.serverContent?.interrupted
  ) {
    flushPendingTranscriptions(storedSession);
  }

  storedSession.audioQueue.push(...collectAudioChunksFromLiveMessage(message));

  const waiter = storedSession.waiters.shift();

  if (waiter) {
    waiter.resolve(message);
    return;
  }

  storedSession.responseQueue.push(message);
}

function rejectLiveWaiters(storedSession: StoredLiveSession, error: Error) {
  while (storedSession.waiters.length > 0) {
    const waiter = storedSession.waiters.shift();
    waiter?.reject(error);
  }
}

function waitForNextLiveMessage(storedSession: StoredLiveSession) {
  const queuedMessage = storedSession.responseQueue.shift();

  if (queuedMessage) {
    return Promise.resolve(queuedMessage);
  }

  return new Promise<LiveServerMessage>((resolve, reject) => {
    const waiter = { resolve, reject };
    storedSession.waiters.push(waiter);

    setTimeout(() => {
      const waiterIndex = storedSession.waiters.indexOf(waiter);

      if (waiterIndex >= 0) {
        storedSession.waiters.splice(waiterIndex, 1);
        reject(
          new Error("Timed out while waiting for a Gemini Live response."),
        );
      }
    }, LIVE_MESSAGE_TIMEOUT_MS);
  });
}

async function collectLiveTurn(storedSession: StoredLiveSession) {
  const turnMessages: LiveServerMessage[] = [];
  let turnComplete = false;

  while (!turnComplete) {
    const message = await waitForNextLiveMessage(storedSession);
    turnMessages.push(message);

    if (message.serverContent?.turnComplete) {
      turnComplete = true;
    }
  }

  return turnMessages;
}

function extractTextFromLiveTurn(turnMessages: LiveServerMessage[]) {
  const textParts: string[] = [];

  for (const message of turnMessages) {
    const parts = message.serverContent?.modelTurn?.parts ?? [];

    for (const part of parts) {
      if (typeof part.text === "string") {
        textParts.push(part.text);
      }
    }
  }

  return textParts.join("").trim();
}

function extractTranscriptionTextFromLiveTurn(turnMessages: LiveServerMessage[]) {
  const transcriptionParts: string[] = [];

  for (const message of turnMessages) {
    const transcriptionText = message.serverContent?.outputTranscription?.text;

    if (typeof transcriptionText === "string") {
      transcriptionParts.push(transcriptionText);
    }
  }

  return transcriptionParts.join("").trim();
}

function createStoredLiveReviewSession(id: string): StoredLiveSession {
  return {
    id,
    session: undefined as unknown as Session,
    status: "connected",
    responseQueue: [],
    audioQueue: [],
    waiters: [],
    isSendingMessage: false,
    wasInterrupted: false,
    hasLoggedVisualStreamingActive: false,
    hasLoggedVoiceStreamingActive: false,
    pendingInputTranscriptionText: null,
    pendingOutputTranscriptionText: null,
    state: {
      id,
      status: "connected",
      createdAt: new Date().toISOString(),
      hiddenMessages: [],
      hasSentKickoff: false,
      transcript: [],
      reviewedParts: [],
      visibilityLimitations: [],
      findings: [],
      resourceCatalog: [],
    },
  };
}

/**
 * This module manages Gemini Live sessions on the server.
 *
 * The backend keeps the real live-review transcript and review state in memory
 * so report generation can use the actual session history instead of trying
 * to rebuild it from browser UI state.
 */
export function describeFutureGeminiLiveSession() {
  return {
    status: "not-implemented-yet",
    liveModel: LIVE_MODEL,
    responseModalities: [Modality.AUDIO],
  };
}

export function getFutureLiveSessionConfig() {
  return {
    model: LIVE_MODEL,
    config: {
      mediaResolution: MediaResolution.MEDIA_RESOLUTION_HIGH,
      inputAudioTranscription: {},
      realtimeInputConfig: {
        activityHandling: ActivityHandling.START_OF_ACTIVITY_INTERRUPTS,
      },
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: LIVE_RESPONSE_VOICE,
          },
        },
      },
      outputAudioTranscription: {},
      systemInstruction: ART_DIRECTOR_AI_SYSTEM_PROMPT,
    },
  };
}

function buildLiveKickoffPrompt(userName: string) {
  return [
    `The user's name is ${userName}.`,
    "",
    "Start the session by greeting them warmly and professionally.",
    "",
    "Briefly introduce yourself as a live Art Director AI for 3D game art, but friends call you Adai.",
    "Then ask them to show the 3D model they want to review today.",
    "",
    "Keep it natural, short, and conversational.",
  ].join("\n");
}

async function sendTextTurnThroughLiveSession(
  storedSession: StoredLiveSession,
  text: string,
  options?: {
    appendUserTranscript?: boolean;
    appendAssistantTranscript?: boolean;
  },
) {
  if (storedSession.isSendingMessage) {
    throw new Error(
      "This live review session is already processing another message.",
    );
  }

  storedSession.isSendingMessage = true;

  try {
    if (options?.appendUserTranscript !== false) {
      appendTranscriptItem(storedSession.state, "user", text);
    }

    storedSession.session.sendClientContent({
      turns: text,
      turnComplete: true,
    });

    const turnMessages = await collectLiveTurn(storedSession);
    const responseText =
      extractTextFromLiveTurn(turnMessages) ||
      extractTranscriptionTextFromLiveTurn(turnMessages);

    if (!responseText) {
      throw new Error("Gemini Live returned no text for this message.");
    }

    if (options?.appendAssistantTranscript !== false) {
      appendTranscriptItem(storedSession.state, "assistant", responseText);
    }

    return responseText;
  } finally {
    storedSession.isSendingMessage = false;
  }
}

export async function createLiveReviewSession() {
  const ai = getGeminiClient();
  const id = `live-${randomUUID()}`;
  let didTimeout = false;
  const storedSession = createStoredLiveReviewSession(id);

  const sessionPromise = ai.live.connect({
    model: LIVE_MODEL,
    config: {
      mediaResolution: MediaResolution.MEDIA_RESOLUTION_HIGH,
      inputAudioTranscription: {},
      realtimeInputConfig: {
        activityHandling: ActivityHandling.START_OF_ACTIVITY_INTERRUPTS,
      },
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: LIVE_RESPONSE_VOICE,
          },
        },
      },
      outputAudioTranscription: {},
      systemInstruction: ART_DIRECTOR_AI_SYSTEM_PROMPT,
    },
    callbacks: {
      onopen: () => {
        console.info(`[live] session opened: ${id}`);
      },
      onmessage: (message) => {
        pushLiveMessage(storedSession, message);
      },
      onerror: (error) => {
        console.error(
          `[live] session error: ${id} ${error.message || "unknown error"}`,
        );
        rejectLiveWaiters(
          storedSession,
          new Error(error.message || "Gemini Live session error."),
        );
      },
      onclose: (event) => {
        console.warn(
          `[live] session closed: ${id} code=${event.code} reason=${event.reason || "none"}`,
        );
        rejectLiveWaiters(
          storedSession,
          new Error("Gemini Live session closed."),
        );

        if (liveSessions.has(id)) {
          flushPendingTranscriptions(storedSession);
          appendTranscriptItem(
            storedSession.state,
            "system",
            "Live Gemini review disconnected.",
          );
          storedSession.state.status = "finished";
          storedSession.state.finishedAt ??= new Date().toISOString();
          archiveLiveReviewSessionState(storedSession.state);
          liveSessions.delete(id);
        }
      },
    },
  });

  sessionPromise
    .then((lateSession) => {
      if (didTimeout) {
        lateSession.close();
      }
    })
    .catch(() => {
      // Route-level error handling already covers failed connections.
    });

  const session = await Promise.race([
    sessionPromise,
    new Promise<never>((_, reject) => {
      setTimeout(() => {
        didTimeout = true;
        reject(
          new Error("Timed out while connecting to the Gemini Live API."),
        );
      }, LIVE_CONNECT_TIMEOUT_MS);
    }),
  ]);

  storedSession.session = session;
  liveSessions.set(id, storedSession);
  appendTranscriptItem(
    storedSession.state,
    "system",
    "Live Gemini review connected.",
  );

  return {
    id,
    status: "connected" as const,
  };
}

export async function sendTextMessageToLiveReviewSession(
  id: string,
  text: string,
) {
  const storedSession = liveSessions.get(id);

  if (!storedSession) {
    return null;
  }

  return sendTextTurnThroughLiveSession(storedSession, text);
}

export async function startHiddenKickoffForLiveReviewSession(
  id: string,
  userName: string,
) {
  const storedSession = liveSessions.get(id);
  const normalizedUserName = userName.trim();

  if (!storedSession) {
    return null;
  }

  if (storedSession.state.hasSentKickoff && storedSession.state.reviewStartedAt) {
    return {
      reviewStartedAt: storedSession.state.reviewStartedAt,
      status: "started" as const,
    };
  }

  const kickoffPrompt = buildLiveKickoffPrompt(normalizedUserName);
  await sendTextTurnThroughLiveSession(storedSession, kickoffPrompt, {
    appendUserTranscript: false,
    appendAssistantTranscript: true,
  });

  storedSession.state.userName = normalizedUserName;
  storedSession.state.hasSentKickoff = true;
  storedSession.state.reviewStartedAt = new Date().toISOString();
  storedSession.state.hiddenMessages.push({
    id: `hidden-${randomUUID()}`,
    purpose: "kickoff",
    text: kickoffPrompt,
    timestamp: createTranscriptTimestamp(),
  });

  return {
    reviewStartedAt: storedSession.state.reviewStartedAt,
    status: "started" as const,
  };
}

export function appendSystemEventToLiveReviewSession(id: string, text: string) {
  const storedSession = liveSessions.get(id);

  if (!storedSession) {
    return false;
  }

  appendTranscriptItem(storedSession.state, "system", text);

  return true;
}

export function sendFrameToLiveReviewSession(id: string, frame: LiveImageFrame) {
  const storedSession = liveSessions.get(id);

  if (!storedSession) {
    return false;
  }

  if (!storedSession.hasLoggedVisualStreamingActive) {
    storedSession.hasLoggedVisualStreamingActive = true;
    appendTranscriptItem(storedSession.state, "system", "Visual streaming active.");
  }

  storedSession.session.sendRealtimeInput({
    video: {
      data: frame.data,
      mimeType: frame.mimeType,
    },
  });

  return true;
}

export function sendAudioChunkToLiveReviewSession(
  id: string,
  audioChunk: LiveAudioChunk,
) {
  const storedSession = liveSessions.get(id);

  if (!storedSession) {
    return false;
  }

  if (!storedSession.hasLoggedVoiceStreamingActive) {
    storedSession.hasLoggedVoiceStreamingActive = true;
    appendTranscriptItem(storedSession.state, "system", "Voice streaming active.");
  }

  storedSession.session.sendRealtimeInput({
    audio: {
      data: audioChunk.data,
      mimeType: audioChunk.mimeType,
    },
  });

  return true;
}

export function sendAudioStreamEndToLiveReviewSession(id: string) {
  const storedSession = liveSessions.get(id);

  if (!storedSession) {
    return false;
  }

  storedSession.session.sendRealtimeInput({
    audioStreamEnd: true,
  });

  return true;
}

export function drainAudioChunksFromLiveReviewSession(id: string) {
  const storedSession = liveSessions.get(id);

  if (!storedSession) {
    return null;
  }

  const chunks = [...storedSession.audioQueue];
  storedSession.audioQueue.length = 0;
  const interrupted = storedSession.wasInterrupted;
  storedSession.wasInterrupted = false;

  return {
    chunks,
    interrupted,
  };
}

export function getLiveReviewSessionState(id: string) {
  const storedSession = liveSessions.get(id);

  if (storedSession) {
    flushPendingTranscriptions(storedSession);
    return cloneLiveReviewSessionState(storedSession.state);
  }

  const finishedState = finishedLiveSessionStates.get(id);

  return finishedState ? cloneLiveReviewSessionState(finishedState) : null;
}

export function updateLiveReviewSessionState(
  id: string,
  update: LiveReviewSessionStateUpdate,
) {
  const storedSession = liveSessions.get(id);

  if (storedSession) {
    applyLiveReviewSessionStateUpdate(storedSession.state, update);
    return true;
  }

  const finishedState = finishedLiveSessionStates.get(id);

  if (!finishedState) {
    return false;
  }

  applyLiveReviewSessionStateUpdate(finishedState, update);
  return true;
}

export function closeLiveReviewSession(
  id: string,
  options?: { systemEventText?: string },
) {
  const storedSession = liveSessions.get(id);

  if (!storedSession) {
    return false;
  }

  if (options?.systemEventText) {
    appendTranscriptItem(storedSession.state, "system", options.systemEventText);
  }

  flushPendingTranscriptions(storedSession);
  storedSession.state.status = "finished";
  storedSession.state.finishedAt = new Date().toISOString();
  archiveLiveReviewSessionState(storedSession.state);

  liveSessions.delete(id);
  rejectLiveWaiters(storedSession, new Error("Gemini Live session closed."));
  storedSession.session.close();

  return true;
}

export function getLiveReviewSessionCount() {
  return liveSessions.size;
}
