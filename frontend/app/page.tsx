"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { ReportMarkdown } from "./components/ReportMarkdown";

type BackendStatus = "idle" | "success" | "error";
type MicrophoneStatus = "idle" | "ready" | "denied" | "error";
type ScreenShareStatus = "idle" | "sharing" | "denied" | "error";
type LiveReviewSession = {
  id: string;
  status: string;
};
type LiveKickoffResponse = {
  ok: boolean;
  status: string;
  reviewStartedAt: string;
};
type LiveFrameResponse = {
  ok: boolean;
};
type LiveAudioChunk = {
  data: string;
  mimeType: string;
};
type LiveAudioOutputResponse = {
  chunks: LiveAudioChunk[];
  interrupted: boolean;
};
type BackendLiveTranscriptResponse = {
  id: string;
  status: string;
  userName?: string;
  reviewStartedAt?: string;
  transcript: TranscriptMessage[];
  styleTarget?: string;
  assetType?: string;
  reviewedParts: string[];
  visibilityLimitations: string[];
  findings: Array<{
    area: string;
    issue: string;
    severity: "High" | "Medium" | "Low";
    whyItHurtsQuality: string;
    improvementDirection: string;
    practicalNextStep: string;
  }>;
  resourceCatalog: string[];
};
type ReportResponse = {
  markdown: string;
};
type ReportExportScreenshot = {
  id: string;
  imageDataUrl: string;
  timestamp: string;
  label?: string;
};
type CapturedScreenshot = {
  id: string;
  imageDataUrl: string;
  timestamp: string;
  width: number;
  height: number;
  label?: string;
};
type TranscriptMessage = {
  id: string;
  role: "system" | "assistant" | "user";
  text: string;
  timestamp: string;
};
type OnboardingStep = "welcome" | "setup" | "review";

const VISUAL_STREAM_MIN_INTERVAL_MS = 1000;
const LIVE_FRAME_MAX_WIDTH = 1280;
const LIVE_AUDIO_OUTPUT_POLL_INTERVAL_MS = 250;
const LIVE_TRANSCRIPT_POLL_INTERVAL_MS = 1000;
const MICROPHONE_BUFFER_SIZE = 16384;
const MICROPHONE_SPEECH_RMS_THRESHOLD = 0.015;
const MICROPHONE_SPEECH_HANGOVER_MS = 250;
const MICROPHONE_SILENCE_END_MS = 900;
const LIVE_AUDIO_BARGE_IN_SUPPRESS_MS = 600;
const REPORT_READY_DELAY_MS = 30000;
const USER_NAME_STORAGE_KEY = "art-director-ai-user-name";
const PRIMARY_PILL_BUTTON_CLASS =
  "inline-flex h-[52px] shrink-0 cursor-pointer items-center justify-center rounded-full border border-zinc-800 bg-zinc-800 px-8 text-sm font-semibold text-white shadow-[0_20px_45px_-32px_rgba(24,24,27,0.55),0_4px_0_#09090b] transition-[transform,background-color,box-shadow,color,border-color] duration-100 hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-zinc-300/40 active:translate-y-1 active:shadow-[0_20px_45px_-32px_rgba(24,24,27,0.55),0_0_0_#09090b] disabled:cursor-not-allowed disabled:border-zinc-300 disabled:bg-zinc-300 disabled:text-zinc-500 disabled:shadow-[0_20px_45px_-32px_rgba(161,161,170,0.28),0_4px_0_#b4b4b8] disabled:hover:bg-zinc-300";

type SetupStepTone = "ready" | "idle" | "error";
type SetupStepState = {
  label: string;
  description: string;
  tone: SetupStepTone;
  actionLabel: string;
  actionDisabled: boolean;
};

function getSetupToneClasses(tone: SetupStepTone) {
  switch (tone) {
    case "ready":
      return {
        badge: "border-emerald-200 bg-emerald-50 text-emerald-700",
        dot: "bg-emerald-500",
        panel: "border-emerald-100/80",
      };
    case "error":
      return {
        badge: "border-red-200 bg-red-50 text-red-600",
        dot: "bg-red-500",
        panel: "border-red-100/80",
      };
    default:
      return {
        badge: "border-zinc-200 bg-zinc-100 text-zinc-600",
        dot: "bg-zinc-400",
        panel: "border-zinc-200/80",
      };
  }
}

function getSetupButtonToneClasses(tone: SetupStepTone) {
  switch (tone) {
    case "ready":
      return "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-500";
    case "error":
      return "border-red-500 text-red-700 hover:bg-red-50";
    default:
      return "";
  }
}

function getMicrophoneSetupState(status: MicrophoneStatus): SetupStepState {
  switch (status) {
    case "ready":
      return {
        label: "Ready",
        description: "",
        tone: "ready",
        actionLabel: "Microphone ready",
        actionDisabled: false,
      };
    case "denied":
      return {
        label: "Permission denied",
        description: "",
        tone: "error",
        actionLabel: "Try Again",
        actionDisabled: false,
      };
    case "error":
      return {
        label: "Unavailable",
        description: "",
        tone: "error",
        actionLabel: "Try Again",
        actionDisabled: false,
      };
    default:
      return {
        label: "Not ready",
        description: "",
        tone: "idle",
        actionLabel: "1. Enable microphone so we can talk",
        actionDisabled: false,
      };
  }
}

function getScreenShareSetupState(status: ScreenShareStatus): SetupStepState {
  switch (status) {
    case "sharing":
      return {
        label: "Ready",
        description: "",
        tone: "ready",
        actionLabel: "Screen Shared",
        actionDisabled: false,
      };
    case "denied":
      return {
        label: "Permission denied",
        description: "",
        tone: "error",
        actionLabel: "Try Again",
        actionDisabled: false,
      };
    case "error":
      return {
        label: "Unavailable",
        description: "",
        tone: "error",
        actionLabel: "Try Again",
        actionDisabled: false,
      };
    default:
      return {
        label: "Not ready",
        description: "",
        tone: "idle",
        actionLabel: "2. Share your screen so I can see",
        actionDisabled: false,
      };
  }
}

function createLocalId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

function createLocalTimestamp() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function float32ToBase64Pcm(float32Samples: Float32Array) {
  const buffer = new ArrayBuffer(float32Samples.length * 2);
  const view = new DataView(buffer);

  for (let index = 0; index < float32Samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, float32Samples[index]));
    const pcmValue = sample < 0 ? sample * 0x8000 : sample * 0x7fff;

    view.setInt16(index * 2, pcmValue, true);
  }

  let binary = "";
  const bytes = new Uint8Array(buffer);

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function base64ToUint8Array(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function parseSampleRateFromMimeType(mimeType: string, fallbackRate: number) {
  const match = mimeType.match(/rate=(\d+)/);

  if (!match) {
    return fallbackRate;
  }

  const parsedRate = Number(match[1]);

  return Number.isFinite(parsedRate) ? parsedRate : fallbackRate;
}

function getSignalRms(samples: Float32Array) {
  let sumSquares = 0;

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    sumSquares += sample * sample;
  }

  return Math.sqrt(sumSquares / samples.length);
}

export default function Home() {
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep>("welcome");
  const [userName, setUserName] = useState("");
  const [isHydratingOnboarding, setIsHydratingOnboarding] = useState(true);
  const [backendStatus] = useState<BackendStatus>("idle");
  const [microphoneStatus, setMicrophoneStatus] =
    useState<MicrophoneStatus>("idle");
  const [screenShareStatus, setScreenShareStatus] =
    useState<ScreenShareStatus>("idle");
  const [microphoneStream, setMicrophoneStream] = useState<MediaStream | null>(
    null,
  );
  const [liveReviewSession, setLiveReviewSession] =
    useState<LiveReviewSession | null>(null);
  const [liveReviewError, setLiveReviewError] = useState<string | null>(null);
  const [, setLiveMessageError] = useState<string | null>(null);
  const [, setLiveFrameError] = useState<string | null>(null);
  const [, setLiveAudioError] = useState<string | null>(null);
  const [isStartingLiveReview, setIsStartingLiveReview] = useState(false);
  const [, setIsConnectingLiveReview] = useState(false);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [isSendingKickoff, setIsSendingKickoff] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reviewStartedAt, setReviewStartedAt] = useState<string | null>(null);
  const [reportReadyCountdownMs, setReportReadyCountdownMs] = useState(0);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [capturedScreenshots] = useState<CapturedScreenshot[]>([]);
  const [generatedReport, setGeneratedReport] = useState<string | null>(null);
  const [reportScreenshots, setReportScreenshots] = useState<
    ReportExportScreenshot[]
  >([]);
  const [, setTranscriptMessages] = useState<TranscriptMessage[]>([]);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const isSendingLiveFrameRef = useRef(false);
  const isSendingMicrophoneAudioRef = useRef(false);
  const isPollingLiveAudioOutputRef = useRef(false);
  const isSyncingLiveTranscriptRef = useRef(false);
  const isFinishingReviewRef = useRef(false);
  const hasLoggedScreenShareStartedRef = useRef<string | null>(null);
  const lastVisualFrameSentAtRef = useRef(0);
  const lastDetectedSpeechAtRef = useRef<number | null>(null);
  const hasSentAudioStreamEndRef = useRef(true);
  const lastLocalBargeInAtRef = useRef(0);
  const suppressLiveAudioPlaybackUntilRef = useRef(0);
  const activePlaybackSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const playbackAudioContextRef = useRef<AudioContext | null>(null);
  const nextPlaybackTimeRef = useRef(0);

  const isVisualStreamingActive =
    liveReviewSession?.status === "connected" && Boolean(screenStream);
  const isReviewScreenVisible = onboardingStep === "review";
  const liveReviewSessionId = liveReviewSession?.id ?? null;
  const isLiveReviewConnected = liveReviewSession?.status === "connected";
  const isReportReady =
    Boolean(reviewStartedAt) && reportReadyCountdownMs <= 0;
  const hasReviewStarted = Boolean(reviewStartedAt);
  const isMicrophoneReady = microphoneStatus === "ready";
  const isScreenReady = screenShareStatus === "sharing";
  const isSetupReady = isMicrophoneReady && isScreenReady;

  function markLiveReviewSessionMissing() {
    if (isFinishingReviewRef.current) {
      setLiveReviewSession(null);
      setReviewStartedAt(null);
      return;
    }

    setLiveReviewSession(null);
    setReviewStartedAt(null);
    setLiveReviewError(
      "Live review session ended on the backend. Click Connect Live Review again.",
    );
    setLiveAudioError(null);
    addTranscriptMessage("system", "Live Gemini review disconnected.");
  }

  const handleMissingLiveSessionInEffect = useEffectEvent(() => {
    markLiveReviewSessionMissing();
  });

  useEffect(() => {
    const storedUserName = window.localStorage
      .getItem(USER_NAME_STORAGE_KEY)
      ?.trim();

    if (storedUserName) {
      setUserName(storedUserName);
      setOnboardingStep("setup");
    }

    setIsHydratingOnboarding(false);
  }, []);

  useEffect(() => {
    const videoElement = videoRef.current;

    if (!videoElement) {
      return;
    }

    videoElement.srcObject = screenStream;
    if (screenStream) {
      void videoElement.play().catch(() => undefined);
    }

    return () => {
      if (videoElement.srcObject === screenStream) {
        videoElement.srcObject = null;
      }
    };
  }, [screenStream, isReviewScreenVisible]);

  useEffect(() => {
    return () => {
      microphoneStream?.getTracks().forEach((track) => track.stop());
    };
  }, [microphoneStream]);

  useEffect(() => {
    return () => {
      screenStream?.getTracks().forEach((track) => track.stop());
    };
  }, [screenStream]);

  useEffect(() => {
    if (!reviewStartedAt) {
      setReportReadyCountdownMs(0);
      return;
    }

    const reviewStartedTimestamp = Date.parse(reviewStartedAt);

    if (!Number.isFinite(reviewStartedTimestamp)) {
      setReportReadyCountdownMs(0);
      return;
    }

    const updateCountdown = () => {
      const millisecondsUntilReady =
        reviewStartedTimestamp + REPORT_READY_DELAY_MS - Date.now();

      setReportReadyCountdownMs(Math.max(0, millisecondsUntilReady));
    };

    updateCountdown();
    const intervalId = window.setInterval(updateCountdown, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [reviewStartedAt]);

  useEffect(() => {
    if (!isLiveReviewConnected || !liveReviewSessionId) {
      return;
    }

    const currentLiveReviewSessionId = liveReviewSessionId;
    let isCancelled = false;

    async function syncTranscript() {
      if (isCancelled) {
        return;
      }

      await syncLiveTranscriptInEffect(currentLiveReviewSessionId);
    }

    void syncTranscript();

    const intervalId = window.setInterval(() => {
      void syncTranscript();
    }, LIVE_TRANSCRIPT_POLL_INTERVAL_MS);

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
    };
  }, [isLiveReviewConnected, liveReviewSessionId]);

  useEffect(() => {
    if (!screenStream) {
      hasLoggedScreenShareStartedRef.current = null;
      return;
    }

    if (
      !liveReviewSessionId ||
      screenShareStatus !== "sharing" ||
      hasLoggedScreenShareStartedRef.current === liveReviewSessionId
    ) {
      return;
    }

    hasLoggedScreenShareStartedRef.current = liveReviewSessionId;
    void logLiveSystemEventInEffect("Screen share started.");
  }, [liveReviewSessionId, screenShareStatus, screenStream]);

  async function ensureMicrophoneReady() {
    if (microphoneStream) {
      setMicrophoneStatus("ready");
      return true;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setMicrophoneStatus("error");
      return false;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });

      stream.getAudioTracks()[0].onended = () => {
        setMicrophoneStream((currentStream) =>
          currentStream === stream ? null : currentStream,
        );
        setMicrophoneStatus("idle");
      };

      setMicrophoneStream((currentStream) => {
        currentStream?.getTracks().forEach((track) => track.stop());
        return stream;
      });
      setMicrophoneStatus("ready");
      return true;
    } catch (error) {
      if (
        error instanceof DOMException &&
        (error.name === "NotAllowedError" || error.name === "AbortError")
      ) {
        setMicrophoneStatus("denied");
        return false;
      }

      setMicrophoneStatus("error");
      return false;
    }
  }

  async function handleEnableMicrophone() {
    await ensureMicrophoneReady();
  }

  function addTranscriptMessage(
    role: TranscriptMessage["role"],
    text: string,
  ) {
    const message: TranscriptMessage = {
      id: createLocalId(),
      role,
      text,
      timestamp: createLocalTimestamp(),
    };

    setTranscriptMessages((currentMessages) => [...currentMessages, message]);
  }

  function mergeTranscriptMessages(messages: TranscriptMessage[]) {
    setTranscriptMessages((currentMessages) => {
      const existingMessageIds = new Set(
        currentMessages.map((message) => message.id),
      );
      const nextMessages = [...currentMessages];

      for (const message of messages) {
        if (!existingMessageIds.has(message.id)) {
          nextMessages.push(message);
          existingMessageIds.add(message.id);
        }
      }

      return nextMessages;
    });
  }

  async function syncLiveTranscriptWithBackend(
    sessionId: string,
    options?: { suppressErrors?: boolean },
  ) {
    if (isSyncingLiveTranscriptRef.current) {
      return;
    }

    isSyncingLiveTranscriptRef.current = true;

    try {
      const response = await fetch(
        `https://artdirectorai-backend-9279022099.us-central1.run.app/live/${sessionId}/transcript`,
      );
      const data = (await response.json()) as
        | BackendLiveTranscriptResponse
        | { error?: string };

      if (!response.ok || !("transcript" in data)) {
        if (response.status === 404) {
          if (!isFinishingReviewRef.current) {
            markLiveReviewSessionMissing();
          }

          return;
        }

        throw new Error(
          "error" in data && data.error
            ? data.error
            : "Could not sync live transcript from the backend.",
        );
      }

      setReviewStartedAt(data.reviewStartedAt || null);
      mergeTranscriptMessages(data.transcript);
    } catch (error) {
      if (!options?.suppressErrors) {
        setLiveReviewError(
          error instanceof Error
            ? error.message
            : "Could not sync live transcript from the backend.",
        );
      }
    } finally {
      isSyncingLiveTranscriptRef.current = false;
    }
  }

  async function logLiveSystemEvent(text: string) {
    if (!liveReviewSessionId) {
      return;
    }

    try {
      const response = await fetch(
        `https://artdirectorai-backend-9279022099.us-central1.run.app/live/${liveReviewSessionId}/events`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ text }),
        },
      );

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;

        if (response.status === 404) {
          if (!isFinishingReviewRef.current) {
            markLiveReviewSessionMissing();
          }

          return;
        }

        throw new Error(data?.error || "Could not log the live review event.");
      }

      await syncLiveTranscriptWithBackend(liveReviewSessionId, {
        suppressErrors: true,
      });
    } catch (error) {
      console.warn(
        error instanceof Error
          ? error.message
          : "Could not log the live review event.",
      );
    }
  }

  const syncLiveTranscriptInEffect = useEffectEvent(async (sessionId: string) => {
    await syncLiveTranscriptWithBackend(sessionId, {
      suppressErrors: true,
    });
  });

  const logLiveSystemEventInEffect = useEffectEvent(async (text: string) => {
    await logLiveSystemEvent(text);
  });

  function captureCurrentScreenCanvas(options?: { maxWidth?: number }) {
    const videoElement = videoRef.current;

    if (!screenStream || !videoElement) {
      return null;
    }

    const width = videoElement.videoWidth;
    const height = videoElement.videoHeight;

    if (!width || !height) {
      return null;
    }

    const maxWidth = options?.maxWidth;
    const scale =
      maxWidth && width > maxWidth ? maxWidth / width : 1;
    const canvasWidth = Math.round(width * scale);
    const canvasHeight = Math.round(height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    const context = canvas.getContext("2d");

    if (!context) {
      return null;
    }

    context.drawImage(videoElement, 0, 0, canvasWidth, canvasHeight);

    return {
      canvas,
      width: canvasWidth,
      height: canvasHeight,
    };
  }

  function persistUserName(nextUserName: string) {
    const normalizedUserName = nextUserName.trim();

    setUserName(normalizedUserName);
    window.localStorage.setItem(USER_NAME_STORAGE_KEY, normalizedUserName);
  }

  function handleContinueToSetup() {
    const normalizedUserName = userName.trim();

    if (!normalizedUserName) {
      return;
    }

    persistUserName(normalizedUserName);
    setOnboardingStep("setup");
  }

  function handleChangeName() {
    setOnboardingStep("welcome");
  }

  async function ensureLiveReviewConnected() {
    if (liveReviewSession?.status === "connected") {
      return liveReviewSession;
    }

    setIsConnectingLiveReview(true);
    setLiveReviewError(null);
    setLiveMessageError(null);
    setLiveFrameError(null);
    setLiveAudioError(null);

    try {
      const response = await fetch("https://artdirectorai-backend-9279022099.us-central1.run.app/live/session", {
        method: "POST",
      });
      const data = (await response.json()) as
        | LiveReviewSession
        | { error?: string };

      if (!response.ok || !("id" in data)) {
        throw new Error(
          "error" in data && data.error
            ? data.error
            : "Live Gemini connection failed.",
        );
      }

      setLiveReviewSession(data);
      await syncLiveTranscriptWithBackend(data.id, {
        suppressErrors: true,
      });
      return data;
    } catch (error) {
      setLiveReviewSession(null);
      setLiveReviewError(
        error instanceof Error
          ? error.message
          : "Live Gemini connection failed.",
      );
      return null;
    } finally {
      setIsConnectingLiveReview(false);
    }
  }

  async function ensureLiveReviewKickoffStarted(liveSessionId: string) {
    if (!liveSessionId) {
      setLiveReviewError("Live review session is not connected.");
      return false;
    }

    const normalizedUserName = userName.trim();

    if (!normalizedUserName) {
      setLiveReviewError("Your name is required before review can start.");
      setOnboardingStep("welcome");
      return false;
    }

    setIsSendingKickoff(true);
    setLiveReviewError(null);

    try {
      const response = await fetch(
        `https://artdirectorai-backend-9279022099.us-central1.run.app/live/${liveSessionId}/kickoff`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            userName: normalizedUserName,
          }),
        },
      );
      const data = (await response.json()) as
        | LiveKickoffResponse
        | { error?: string };

      if (!response.ok || !("reviewStartedAt" in data)) {
        if (response.status === 404) {
          markLiveReviewSessionMissing();
        }

        throw new Error(
          "error" in data && data.error
            ? data.error
            : "Could not start the review conversation.",
        );
      }

      persistUserName(normalizedUserName);
      setReviewStartedAt(data.reviewStartedAt);
      await syncLiveTranscriptWithBackend(liveSessionId, {
        suppressErrors: true,
      });
      return true;
    } catch (error) {
      setLiveReviewError(
        error instanceof Error
          ? error.message
          : "Could not start the review conversation.",
      );
      return false;
    } finally {
      setIsSendingKickoff(false);
    }
  }

  function stopLocalLiveReview() {
    microphoneStream?.getTracks().forEach((track) => track.stop());
    screenStream?.getTracks().forEach((track) => track.stop());

    setMicrophoneStream(null);
    setScreenStream(null);
    setMicrophoneStatus("idle");
    setScreenShareStatus("idle");
    setLiveReviewSession(null);
    setLiveReviewError(null);
    setLiveMessageError(null);
    setLiveFrameError(null);
    setLiveAudioError(null);
    setReviewStartedAt(null);

    isSendingLiveFrameRef.current = false;
    isSendingMicrophoneAudioRef.current = false;
    isPollingLiveAudioOutputRef.current = false;
    lastDetectedSpeechAtRef.current = null;
    hasSentAudioStreamEndRef.current = true;
    lastLocalBargeInAtRef.current = 0;
    suppressLiveAudioPlaybackUntilRef.current = 0;
    clearLiveAudioPlayback();

    const playbackAudioContext = playbackAudioContextRef.current;
    playbackAudioContextRef.current = null;

    if (playbackAudioContext) {
      void playbackAudioContext.close().catch(() => undefined);
    }
  }

  function clearLiveAudioPlayback() {
    for (const source of activePlaybackSourcesRef.current) {
      try {
        source.stop();
      } catch {
        // Ignore sources that are already stopped.
      }

      source.disconnect();
    }

    activePlaybackSourcesRef.current.clear();

    const audioContext = playbackAudioContextRef.current;
    nextPlaybackTimeRef.current = audioContext ? audioContext.currentTime : 0;
  }

  async function handleFinishReview() {
    if (!liveReviewSession?.id || isGeneratingReport) {
      return;
    }

    const currentLiveReviewSessionId = liveReviewSession.id;
    const currentScreenshots = capturedScreenshots.map((screenshot) => ({
      id: screenshot.id,
      imageDataUrl: screenshot.imageDataUrl,
      timestamp: screenshot.timestamp,
      label: screenshot.label,
    }));
    const assetMetadata = null;

    isFinishingReviewRef.current = true;
    setIsGeneratingReport(true);
    setIsDownloadingPdf(false);
    setPdfError(null);
    setReportError(null);
    setGeneratedReport(null);
    setReportScreenshots([]);

    try {
      const finishResponse = await fetch(
        `https://artdirectorai-backend-9279022099.us-central1.run.app/live/${currentLiveReviewSessionId}/finish`,
        {
          method: "POST",
        },
      );

      if (!finishResponse.ok && finishResponse.status !== 404) {
        const finishData = (await finishResponse.json()) as { error?: string };

        throw new Error(
          finishData.error || "Could not finish the live review session.",
        );
      }

      await syncLiveTranscriptWithBackend(currentLiveReviewSessionId, {
        suppressErrors: true,
      });
    } catch (error) {
      setLiveReviewError(
        error instanceof Error
          ? `${error.message} Generating report from the current local review data instead.`
          : "Could not finish the live review session. Generating report from the current local review data instead.",
      );
    } finally {
      stopLocalLiveReview();
    }

    try {
      const response = await fetch("https://artdirectorai-backend-9279022099.us-central1.run.app/report", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          liveReviewSessionId: currentLiveReviewSessionId,
          assetMetadata,
          screenshots: currentScreenshots,
          styleTarget: null,
        }),
      });
      const data = (await response.json()) as ReportResponse | { error?: string };

      if (!response.ok || !("markdown" in data)) {
        throw new Error(
          "error" in data && data.error
            ? data.error
            : "Report generation failed.",
        );
      }

      setGeneratedReport(data.markdown);
      setReportScreenshots(currentScreenshots);
    } catch (error) {
      setReportError(
        error instanceof Error ? error.message : "Report generation failed.",
      );
    } finally {
      setIsGeneratingReport(false);
      isFinishingReviewRef.current = false;
    }
  }

  async function handleDownloadPdf() {
    if (!generatedReport || isDownloadingPdf) {
      return;
    }

    setIsDownloadingPdf(true);
    setPdfError(null);

    try {
      const response = await fetch("https://artdirectorai-backend-9279022099.us-central1.run.app/report/pdf", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          markdown: generatedReport,
          screenshots: reportScreenshots.map((screenshot) => ({
            id: screenshot.id,
            imageDataUrl: screenshot.imageDataUrl,
            timestamp: screenshot.timestamp,
            label: screenshot.label,
          })),
        }),
      });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;

        throw new Error(errorData?.error || "PDF generation failed.");
      }

      const pdfBlob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(pdfBlob);
      const downloadLink = document.createElement("a");

      downloadLink.href = downloadUrl;
      downloadLink.download = "art-director-ai-review.pdf";
      document.body.appendChild(downloadLink);
      downloadLink.click();
      downloadLink.remove();
      window.URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      setPdfError(
        error instanceof Error ? error.message : "PDF generation failed.",
      );
    } finally {
      setIsDownloadingPdf(false);
    }
  }

  async function handleSendCurrentScreenFrame() {
    if (!liveReviewSession?.id) {
      setLiveFrameError("Live review session is not connected.");
      return false;
    }

    if (isSendingLiveFrameRef.current) {
      return false;
    }

    const frame = captureCurrentScreenCanvas({
      maxWidth: LIVE_FRAME_MAX_WIDTH,
    });

    if (!frame) {
      return false;
    }

    isSendingLiveFrameRef.current = true;
    try {
      const response = await fetch(
        `https://artdirectorai-backend-9279022099.us-central1.run.app/live/${liveReviewSession.id}/frame`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            imageDataUrl: frame.canvas.toDataURL("image/jpeg", 0.8),
          }),
        },
      );
      const data = (await response.json()) as
        | LiveFrameResponse
        | { error?: string };

      if (!response.ok || !("ok" in data) || !data.ok) {
        if (response.status === 404) {
          markLiveReviewSessionMissing();
        }

        throw new Error(
          "error" in data && data.error
            ? data.error
            : "Live screen frame send failed.",
        );
      }

      setLiveFrameError(null);
      return true;
    } catch (error) {
      setLiveFrameError(
        error instanceof Error ? error.message : "Live screen frame send failed.",
      );
      return false;
    } finally {
      isSendingLiveFrameRef.current = false;
    }
  }

  const streamCurrentScreenFrame = useEffectEvent(async () => {
    return handleSendCurrentScreenFrame();
  });

  const playLiveAudioChunk = useEffectEvent(async (chunk: LiveAudioChunk) => {
    const AudioContextConstructor =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;

    if (!AudioContextConstructor) {
      setLiveAudioError("Browser audio playback is unavailable.");
      return;
    }

    if (!playbackAudioContextRef.current) {
      playbackAudioContextRef.current = new AudioContextConstructor();
    }

    const audioContext = playbackAudioContextRef.current;

    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    const sampleRate = parseSampleRateFromMimeType(chunk.mimeType, 24000);
    const bytes = base64ToUint8Array(chunk.data);
    const sampleCount = Math.floor(bytes.byteLength / 2);
    const audioBuffer = audioContext.createBuffer(1, sampleCount, sampleRate);
    const channelData = audioBuffer.getChannelData(0);
    const view = new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    );

    for (let index = 0; index < sampleCount; index += 1) {
      channelData[index] = view.getInt16(index * 2, true) / 0x8000;
    }

    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext.destination);
    activePlaybackSourcesRef.current.add(source);
    source.onended = () => {
      activePlaybackSourcesRef.current.delete(source);
      source.disconnect();
    };

    const playbackTime = Math.max(
      audioContext.currentTime,
      nextPlaybackTimeRef.current,
    );

    source.start(playbackTime);
    nextPlaybackTimeRef.current = playbackTime + audioBuffer.duration;
  });

  useEffect(() => {
    if (!isVisualStreamingActive || !isReviewScreenVisible) {
      return;
    }

    const videoElement = videoRef.current;

    if (!videoElement) {
      return;
    }

    setLiveFrameError(null);
    lastVisualFrameSentAtRef.current = 0;

    let isCancelled = false;
    let intervalId: number | null = null;
    let frameCallbackId: number | null = null;

    const sendVisualFrameIfReady = async (timestampMs: number) => {
      if (isCancelled) {
        return;
      }

      if (
        timestampMs - lastVisualFrameSentAtRef.current <
        VISUAL_STREAM_MIN_INTERVAL_MS
      ) {
        return;
      }

      const didSendFrame = await streamCurrentScreenFrame();

      if (didSendFrame) {
        lastVisualFrameSentAtRef.current = timestampMs;
      }
    };

    const supportsVideoFrameCallback =
      "requestVideoFrameCallback" in videoElement &&
      typeof videoElement.requestVideoFrameCallback === "function";

    if (supportsVideoFrameCallback) {
      const handleVideoFrame = async (_now: number, metadata: { expectedDisplayTime: number }) => {
        await sendVisualFrameIfReady(metadata.expectedDisplayTime);

        if (!isCancelled) {
          frameCallbackId = videoElement.requestVideoFrameCallback(
            handleVideoFrame,
          );
        }
      };

      frameCallbackId = videoElement.requestVideoFrameCallback(handleVideoFrame);
    }

    void streamCurrentScreenFrame();

    intervalId = window.setInterval(() => {
      void sendVisualFrameIfReady(performance.now());
    }, VISUAL_STREAM_MIN_INTERVAL_MS);

    return () => {
      isCancelled = true;

      if (
        frameCallbackId !== null &&
        "cancelVideoFrameCallback" in videoElement &&
        typeof videoElement.cancelVideoFrameCallback === "function"
      ) {
        videoElement.cancelVideoFrameCallback(frameCallbackId);
      }

      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
    };
  }, [isReviewScreenVisible, isVisualStreamingActive]);

  useEffect(() => {
    if (!isLiveReviewConnected || !liveReviewSessionId) {
      return;
    }

    let isCancelled = false;

    async function pollLiveAudioOutput() {
      if (isPollingLiveAudioOutputRef.current) {
        return;
      }

      isPollingLiveAudioOutputRef.current = true;

      try {
        const response = await fetch(
          `https://artdirectorai-backend-9279022099.us-central1.run.app/live/${liveReviewSessionId}/audio-output`,
        );
        const data = (await response.json()) as
          | LiveAudioOutputResponse
          | { error?: string };

        if (!response.ok || !("chunks" in data)) {
          if (response.status === 404) {
            handleMissingLiveSessionInEffect();
          }

          throw new Error(
            "error" in data && data.error
              ? data.error
              : "Live audio playback failed.",
          );
        }

        if (data.interrupted) {
          clearLiveAudioPlayback();
          suppressLiveAudioPlaybackUntilRef.current = 0;
        }

        if (performance.now() < suppressLiveAudioPlaybackUntilRef.current) {
          if (data.chunks.length > 0) {
            setLiveAudioError(null);
          }

          return;
        }

        for (const chunk of data.chunks) {
          if (isCancelled) {
            break;
          }

          await playLiveAudioChunk(chunk);
        }

        if (data.chunks.length > 0) {
          setLiveAudioError(null);
        }
      } catch (error) {
        if (!isCancelled) {
          setLiveAudioError(
            error instanceof Error ? error.message : "Live audio playback failed.",
          );
        }
      } finally {
        isPollingLiveAudioOutputRef.current = false;
      }
    }

    void pollLiveAudioOutput();

    const intervalId = window.setInterval(() => {
      void pollLiveAudioOutput();
    }, LIVE_AUDIO_OUTPUT_POLL_INTERVAL_MS);

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
    };
  }, [isLiveReviewConnected, liveReviewSessionId]);

  useEffect(() => {
    if (!microphoneStream || !isLiveReviewConnected || !liveReviewSessionId) {
      return;
    }

    const AudioContextConstructor =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;

    if (!AudioContextConstructor) {
      setLiveAudioError("Browser microphone streaming is unavailable.");
      return;
    }

    const audioContext = new AudioContextConstructor();
    const source = audioContext.createMediaStreamSource(microphoneStream);
    const processor = audioContext.createScriptProcessor(
      MICROPHONE_BUFFER_SIZE,
      1,
      1,
    );

    lastDetectedSpeechAtRef.current = null;
    hasSentAudioStreamEndRef.current = true;

    processor.onaudioprocess = (event) => {
      event.outputBuffer.getChannelData(0).fill(0);

      if (!isLiveReviewConnected) {
        return;
      }

      const inputChannel = event.inputBuffer.getChannelData(0);
      const now = performance.now();
      const rms = getSignalRms(inputChannel);
      const isSpeechDetected = rms >= MICROPHONE_SPEECH_RMS_THRESHOLD;

      if (isSpeechDetected) {
        lastDetectedSpeechAtRef.current = now;
        hasSentAudioStreamEndRef.current = false;
      }

      const isWithinSpeechHangover =
        lastDetectedSpeechAtRef.current !== null &&
        now - lastDetectedSpeechAtRef.current < MICROPHONE_SPEECH_HANGOVER_MS;
      const shouldStreamAudioChunk =
        isSpeechDetected || isWithinSpeechHangover;
      const hasQueuedModelAudio =
        activePlaybackSourcesRef.current.size > 0 ||
        nextPlaybackTimeRef.current - audioContext.currentTime > 0.05;

      if (
        shouldStreamAudioChunk &&
        hasQueuedModelAudio &&
        now - lastLocalBargeInAtRef.current > 150
      ) {
        lastLocalBargeInAtRef.current = now;
        suppressLiveAudioPlaybackUntilRef.current =
          now + LIVE_AUDIO_BARGE_IN_SUPPRESS_MS;
        clearLiveAudioPlayback();
      }

      if (
        !shouldStreamAudioChunk &&
        lastDetectedSpeechAtRef.current !== null &&
        !hasSentAudioStreamEndRef.current &&
        now - lastDetectedSpeechAtRef.current >= MICROPHONE_SILENCE_END_MS &&
        !isSendingMicrophoneAudioRef.current
      ) {
        hasSentAudioStreamEndRef.current = true;
        isSendingMicrophoneAudioRef.current = true;

        void fetch(`https://artdirectorai-backend-9279022099.us-central1.run.app/live/${liveReviewSessionId}/audio-end`, {
          method: "POST",
        })
          .then(async (response) => {
            const data = (await response.json()) as { error?: string };

            if (!response.ok) {
              if (response.status === 404) {
                handleMissingLiveSessionInEffect();
              }

              throw new Error(data.error || "Live microphone streaming failed.");
            }

            setLiveAudioError(null);
          })
          .catch((error) => {
            setLiveAudioError(
              error instanceof Error
                ? error.message
                : "Live microphone streaming failed.",
            );
          })
          .finally(() => {
            isSendingMicrophoneAudioRef.current = false;
          });
      }

      if (!shouldStreamAudioChunk || isSendingMicrophoneAudioRef.current) {
        return;
      }

      const audioChunk = {
        data: float32ToBase64Pcm(new Float32Array(inputChannel)),
        mimeType: `audio/pcm;rate=${audioContext.sampleRate}`,
      };

      isSendingMicrophoneAudioRef.current = true;

      void fetch(`https://artdirectorai-backend-9279022099.us-central1.run.app/live/${liveReviewSessionId}/audio`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(audioChunk),
      })
        .then(async (response) => {
          const data = (await response.json()) as { error?: string };

          if (!response.ok) {
            if (response.status === 404) {
              handleMissingLiveSessionInEffect();
            }

            throw new Error(data.error || "Live microphone streaming failed.");
          }

          setLiveAudioError(null);
        })
        .catch((error) => {
          setLiveAudioError(
            error instanceof Error
              ? error.message
              : "Live microphone streaming failed.",
          );
        })
        .finally(() => {
          isSendingMicrophoneAudioRef.current = false;
        });
    };

    source.connect(processor);
    processor.connect(audioContext.destination);
    void audioContext.resume();

    return () => {
      if (!hasSentAudioStreamEndRef.current && liveReviewSessionId) {
        void fetch(`https://artdirectorai-backend-9279022099.us-central1.run.app/live/${liveReviewSessionId}/audio-end`, {
          method: "POST",
        }).catch(() => undefined);
      }

      hasSentAudioStreamEndRef.current = true;
      lastDetectedSpeechAtRef.current = null;
      processor.disconnect();
      source.disconnect();
      void audioContext.close();
    };
  }, [isLiveReviewConnected, liveReviewSessionId, microphoneStream]);

  async function ensureScreenShareReady() {
    if (screenStream) {
      setScreenShareStatus("sharing");
      return true;
    }

    if (!navigator.mediaDevices?.getDisplayMedia) {
      setScreenShareStatus("error");
      return false;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
      });

      stream.getVideoTracks()[0].onended = () => {
        setScreenStream((currentStream) =>
          currentStream === stream ? null : currentStream,
        );
        setScreenShareStatus("idle");
      };

      setScreenStream((currentStream) => {
        currentStream?.getTracks().forEach((track) => track.stop());
        return stream;
      });
      setScreenShareStatus("sharing");
      return true;
    } catch (error) {
      if (
        error instanceof DOMException &&
        (error.name === "NotAllowedError" || error.name === "AbortError")
      ) {
        setScreenShareStatus("denied");
        return false;
      }

      setScreenShareStatus("error");
      return false;
    }
  }

  async function handleShareScreen() {
    await ensureScreenShareReady();
  }

  async function handleStartLiveReview() {
    if (isStartingLiveReview) {
      return;
    }

    setIsStartingLiveReview(true);
    setLiveReviewError(null);
    setLiveAudioError(null);
    setOnboardingStep("review");

    try {
      const microphoneReady = await ensureMicrophoneReady();

      if (!microphoneReady) {
        setLiveReviewError(
          "Microphone access is required to start live review.",
        );
        setOnboardingStep("setup");
        return;
      }

      const screenReady = await ensureScreenShareReady();

      if (!screenReady) {
        setLiveReviewError(
          "Screen sharing is required to start live review.",
        );
        setOnboardingStep("setup");
        return;
      }

      const liveConnected = await ensureLiveReviewConnected();

      if (!liveConnected) {
        setOnboardingStep("setup");
        return;
      }

      const kickoffStarted = await ensureLiveReviewKickoffStarted(
        liveConnected.id,
      );

      if (!kickoffStarted) {
        setOnboardingStep("setup");
        return;
      }
    } finally {
      setIsStartingLiveReview(false);
    }
  }

  if (isHydratingOnboarding) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-100 px-6 py-16">
        <section className="w-full max-w-2xl rounded-3xl border border-zinc-200 bg-white p-10 shadow-sm">
          <div className="space-y-4">
            <p className="text-sm font-medium uppercase tracking-[0.24em] text-zinc-500">
              Adai
            </p>
            <h1 className="text-4xl font-semibold tracking-tight text-zinc-950 sm:text-5xl">
              Preparing your live review
            </h1>
            <p className="text-base leading-7 text-zinc-600 sm:text-lg">
              Loading your setup preferences.
            </p>
          </div>
        </section>
      </main>
    );
  }

  if (onboardingStep === "welcome") {
    return (
      <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#f3efe8] px-6 py-16 sm:px-10">
        <div
          aria-hidden="true"
          className="absolute inset-0 overflow-hidden"
        >
          <div className="absolute left-[8%] top-[18%] h-64 w-64 rounded-full bg-white/70 blur-3xl" />
          <div className="absolute bottom-[12%] right-[10%] h-80 w-80 rounded-full bg-[#ddd4c7] blur-3xl" />
        </div>

        <section className="relative w-full max-w-6xl">
          <div className="space-y-10 text-center sm:space-y-12">
            <div className="space-y-5">
              <h1 className="text-4xl font-semibold tracking-[-0.05em] text-zinc-950 sm:text-5xl lg:text-6xl">
                <span className="block">Hey! I am an Art Director AI,</span>
                <span className="block">but friends call me Adai</span>
              </h1>
              <p className="mx-auto max-w-4xl text-base leading-8 text-zinc-600 sm:text-lg lg:text-xl">
                <span className="block">
                  I help 3D Artists improve textured game assets through live
                  art-direction feedback.
                </span>
                <span className="block">
                  I can review materials, wear logic, storytelling,
                  readability, and overall polish.
                </span>
              </p>
            </div>

            <form
              className="mx-auto flex w-full max-w-2xl flex-col gap-3 sm:flex-row sm:items-stretch"
              onSubmit={(event) => {
                event.preventDefault();
                handleContinueToSetup();
              }}
            >
              <label htmlFor="user-name" className="sr-only">
                What&apos;s your name?
              </label>
              <input
                id="user-name"
                type="text"
                maxLength={30}
                value={userName}
                onChange={(event) => setUserName(event.target.value)}
                placeholder="What is your name?"
                className="h-14 flex-1 rounded-full border border-zinc-300/80 bg-white/80 px-6 text-center text-base text-zinc-900 shadow-[0_20px_45px_-32px_rgba(24,24,27,0.55)] outline-none transition-all placeholder:text-zinc-400 focus:border-zinc-950 focus:bg-white"
              />
              <button
                type="submit"
                disabled={!userName.trim()}
                className="inline-flex h-[52px] shrink-0 cursor-pointer items-center justify-center rounded-full border border-zinc-800 bg-zinc-800 px-8 text-sm font-semibold text-white shadow-[0_20px_45px_-32px_rgba(24,24,27,0.55),0_4px_0_#09090b] transition-[transform,background-color,box-shadow,color,border-color] duration-100 hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-zinc-300/40 active:translate-y-1 active:shadow-[0_20px_45px_-32px_rgba(24,24,27,0.55),0_0_0_#09090b] disabled:cursor-not-allowed disabled:border-zinc-300 disabled:bg-zinc-300 disabled:text-zinc-500 disabled:shadow-[0_20px_45px_-32px_rgba(161,161,170,0.28),0_4px_0_#b4b4b8] disabled:hover:bg-zinc-300 sm:min-w-40"
              >
                Continue
              </button>
            </form>
          </div>
        </section>
      </main>
    );
  }

  if (onboardingStep === "setup") {
    const microphoneSetupState = getMicrophoneSetupState(microphoneStatus);
    const screenShareSetupState = getScreenShareSetupState(screenShareStatus);
    const setupCards = [
      {
        title: "Microphone",
        state: microphoneSetupState,
        onClick: handleEnableMicrophone,
      },
      {
        title: "Screen share",
        state: screenShareSetupState,
        onClick: handleShareScreen,
      },
    ];
    const setupMessages: Array<{ tone: "success" | "error"; text: string }> = [];

    if (backendStatus === "success") {
      setupMessages.push({
        tone: "success",
        text: "Backend connected.",
      });
    }

    if (backendStatus === "error") {
      setupMessages.push({
        tone: "error",
        text: "Backend check failed. Make sure the backend is running.",
      });
    }

    if (liveReviewError) {
      setupMessages.push({
        tone: "error",
        text: liveReviewError,
      });
    }

    return (
      <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#f3efe8] px-6 py-16 sm:px-10">
        <div aria-hidden="true" className="absolute inset-0 overflow-hidden">
          <div className="absolute left-[8%] top-[18%] h-64 w-64 rounded-full bg-white/70 blur-3xl" />
          <div className="absolute bottom-[12%] right-[10%] h-80 w-80 rounded-full bg-[#ddd4c7] blur-3xl" />
        </div>

        <section className="relative w-full max-w-6xl">
          <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center">
            <div className="w-full space-y-0 text-center sm:space-y-0">
              <div className="space-y-4">
                <h1 className="text-4xl font-semibold tracking-[-0.05em] text-zinc-950 sm:text-5xl lg:text-6xl">
                  <span className="block">
                    Happy to help you{" "}
                    <span className="relative inline-block">
                      {userName}!
                      <button
                        type="button"
                        onClick={handleChangeName}
                        className="absolute left-1/2 top-full -translate-x-1/2 -mt-1.5 cursor-pointer whitespace-nowrap text-[11px] font-medium leading-none tracking-normal text-zinc-500 transition-colors hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300/40"
                      >
                        change
                      </button>
                    </span>
                  </span>
                  <span className="block">
                    Are you ready to get your art review?
                  </span>
                </h1>
                <p className="mx-auto max-w-4xl text-base leading-7 text-zinc-600 sm:text-lg lg:text-xl">
                  <span className="block">
                    To start the art direction review, please turn on your microphone and
                    share your screen,
                  </span>
                  <span className="block">
                    so I can see your 3D model, and respond to you
                  </span>
                </p>
              </div>

              <div className="mx-auto w-full max-w-4xl space-y-8 text-center -mt-4 sm:-mt-5">
                <div className="grid gap-8 text-left sm:grid-cols-2">
              {setupCards.map((card) => {
                const toneClasses = getSetupToneClasses(card.state.tone);
                const buttonToneClasses = getSetupButtonToneClasses(card.state.tone);

                return (
                  <article key={card.title} className="space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      {card.state.tone === "error" ? (
                        <span
                          className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${toneClasses.badge}`}
                        >
                          <span
                            className={`h-2 w-2 rounded-full ${toneClasses.dot}`}
                          />
                          {card.state.label}
                        </span>
                      ) : null}
                    </div>
                      <p className="text-center text-sm leading-7 text-zinc-600 min-h-7">
                        {card.state.description || "\u00a0"}
                      </p>
                    <button
                      type="button"
                      onClick={card.onClick}
                      disabled={card.state.actionDisabled}
                      className={`${PRIMARY_PILL_BUTTON_CLASS} w-full ${buttonToneClasses}`}
                    >
                      {card.state.actionLabel}
                      {card.state.tone === "ready" ? (
                        <span className="ml-2 inline-flex items-center justify-center">
                          <span className="relative flex h-3 w-3 items-center justify-center">
                            <span className="absolute h-3 w-3 rounded-full bg-emerald-400/40 blur-[2px]" />
                            <span className="relative h-1.5 w-1.5 rounded-full bg-emerald-400" />
                          </span>
                        </span>
                      ) : null}
                    </button>
                  </article>
                );
              })}
                </div>

                <div className="flex flex-col items-center gap-3">
                  <div className="flex flex-wrap justify-center gap-3">
                    <button
                      type="button"
                      onClick={handleStartLiveReview}
                      disabled={
                        !isSetupReady ||
                        isStartingLiveReview ||
                        isGeneratingReport ||
                        isSendingKickoff
                      }
                      className={PRIMARY_PILL_BUTTON_CLASS}
                    >
                      {isStartingLiveReview || isSendingKickoff
                        ? "Beginning Review..."
                        : "3. Begin Art Review"}
                    </button>
                  </div>
                  {setupMessages.length > 0 ? (
                    <div className="space-y-2">
                      {setupMessages.map((message) => (
                        <p
                          key={`${message.tone}-${message.text}`}
                          className={`text-sm font-medium ${
                            message.tone === "success"
                              ? "text-emerald-700"
                              : "text-red-600"
                          }`}
                        >
                          {message.text}
                        </p>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    );
  }

  if (onboardingStep === "review") {
    return (
      <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#f3efe8] px-6 py-16 sm:px-10">
        <div aria-hidden="true" className="absolute inset-0 overflow-hidden">
          <div className="absolute left-[8%] top-[18%] h-64 w-64 rounded-full bg-white/70 blur-3xl" />
          <div className="absolute bottom-[12%] right-[10%] h-80 w-80 rounded-full bg-[#ddd4c7] blur-3xl" />
        </div>

        <section className="relative w-full max-w-6xl">
          <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center">
            <div className="w-full space-y-10 text-center">
              <div className="space-y-4">
                <h1 className="text-4xl font-semibold tracking-[-0.05em] text-zinc-950 sm:text-5xl lg:text-6xl">
                  <span className="block">
                    Now you can talk to me,
                  </span>
                  <span className="block">
                    and showing me your 3D model
                  </span>
                </h1>
                <p className="mx-auto max-w-3xl text-base leading-7 text-zinc-600 sm:text-lg lg:text-xl">
                 When we are done, you will get a detailed art report with my feedback and useful links to help you refine and improve your art
                </p>
              </div>

              <div className="mx-auto w-full max-w-4xl space-y-6">
                <div className="mx-auto max-w-md space-y-4">
                  {liveReviewError ? (
                    <p className="text-sm font-medium text-red-600">
                      {liveReviewError}
                    </p>
                  ) : null}
                  {reportError ? (
                    <p className="text-sm font-medium text-red-600">
                      {reportError}
                    </p>
                  ) : null}
                  {pdfError ? (
                    <p className="text-sm font-medium text-red-600">
                      {pdfError}
                    </p>
                  ) : null}

                  {isGeneratingReport ? (
                    <button
                      type="button"
                      className={`${PRIMARY_PILL_BUTTON_CLASS} w-full`}
                      disabled
                    >
                      <span className="inline-flex w-full items-center justify-center gap-2">
                        <span>
                          I am building you the final report, it can take a while
                        </span>
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900" />
                      </span>
                    </button>
                  ) : generatedReport ? (
                    <button
                      type="button"
                      onClick={handleDownloadPdf}
                      disabled={isDownloadingPdf}
                      className={`${PRIMARY_PILL_BUTTON_CLASS} w-full`}
                    >
                      {isDownloadingPdf ? "Preparing your download..." : "Download report"}
                    </button>
                  ) : !hasReviewStarted || !isReportReady ? null : (
                    <button
                      type="button"
                      onClick={handleFinishReview}
                      className={`${PRIMARY_PILL_BUTTON_CLASS} w-full`}
                    >
                      I&apos;m ready to get the final report
                    </button>
                  )}
                </div>

                {generatedReport ? (
                  <div className="rounded-3xl border border-zinc-200 bg-white/80 p-6 text-left shadow-sm backdrop-blur">
                    <div className="flex flex-col gap-3 border-b border-zinc-200 pb-4 text-left sm:flex-row sm:items-baseline sm:justify-between">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
                          Final review report
                        </p>
                        <p className="mt-1 text-sm text-zinc-500">
                          Read through the findings before downloading as PDF.
                        </p>
                      </div>
                      <p className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-400">
                        Preview
                      </p>
                    </div>
                    <div className="mt-4 max-h-[420px] space-y-6 overflow-y-auto pr-2">
                      <ReportMarkdown markdown={generatedReport} />
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="sr-only">
                <video ref={videoRef} autoPlay playsInline muted />
              </div>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return null;
}
