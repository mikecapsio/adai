"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  ActivityHandling,
  MediaResolution,
  Modality,
  type LiveServerMessage,
  type Session,
} from "@google/genai";
import { ReportMarkdown } from "./components/ReportMarkdown";
import { getGeminiClient } from "@/lib/gemini/client";
import { generateReviewReport } from "@/lib/gemini/report";
import { ART_DIRECTOR_AI_SYSTEM_PROMPT } from "@/lib/gemini/systemPrompt";
import { LIVE_MODEL } from "@/lib/gemini/models";

type MicrophoneStatus = "idle" | "ready" | "denied" | "error";
type ScreenShareStatus = "idle" | "sharing" | "denied" | "error";
type LiveReviewSession = {
  id: string;
  status: string;
};
type LiveAudioChunk = {
  data: string;
  mimeType: string;
};
type ReportExportScreenshot = {
  id: string;
  imageDataUrl: string;
  timestamp: string;
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
const LIVE_FRAME_HASH_WIDTH = 48;
const LIVE_FRAME_FORCE_SEND_INTERVAL_MS = 5000;
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

function buildKickoffPrompt(userName: string) {
  const sanitized = userName.replace(/[^a-zA-Z0-9 '\-]/g, "").trim().slice(0, 50) || "there";
  return [
    `The user's name is ${sanitized}.`,
    "",
    "Start the session by greeting them warmly and professionally.",
    "",
    "Briefly introduce yourself as a live Art Director AI for 3D game art, but friends call you Adai.",
    "Then ask them to show the 3D model they want to review today.",
    "",
    "Keep it natural, short, and conversational.",
  ].join("\n");
}

export default function Home() {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [apiKeyError, setApiKeyError] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep>("welcome");
  const [userName, setUserName] = useState("");
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
  const [generatedReport, setGeneratedReport] = useState<string | null>(null);
  const [reportScreenshots, setReportScreenshots] = useState<
    ReportExportScreenshot[]
  >([]);
  const [transcript, setTranscript] = useState<TranscriptMessage[]>([]);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const isSendingLiveFrameRef = useRef(false);
  const lastSentFrameHashRef = useRef(0);
  const lastForcedFrameSentAtRef = useRef(0);
  const isFinishingReviewRef = useRef(false);
  const lastVisualFrameSentAtRef = useRef(0);
  const lastDetectedSpeechAtRef = useRef<number | null>(null);
  const hasSentAudioStreamEndRef = useRef(true);
  const lastLocalBargeInAtRef = useRef(0);
  const suppressLiveAudioPlaybackUntilRef = useRef(0);
  const activePlaybackSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const playbackAudioContextRef = useRef<AudioContext | null>(null);
  const nextPlaybackTimeRef = useRef(0);
  const geminiSessionRef = useRef<Session | null>(null);
  const pendingInputRef = useRef<string | null>(null);
  const pendingOutputRef = useRef<string | null>(null);
  const playLiveAudioChunkImplRef = useRef<(chunk: LiveAudioChunk) => Promise<void>>(async () => {});
  const handleLiveMessageImplRef = useRef<(message: LiveServerMessage) => void>(() => {});
  const handleLiveCloseImplRef = useRef<() => void>(() => {});
  // Stable wrappers created once — captured by the SDK at connect time, delegate to impl refs updated each render.
  const stableHandleLiveMessage = useRef((msg: LiveServerMessage) => handleLiveMessageImplRef.current(msg));
  const stableHandleLiveClose = useRef(() => handleLiveCloseImplRef.current());

  const isVisualStreamingActive =
    liveReviewSession?.status === "connected" && Boolean(screenStream);
  const isReviewScreenVisible = onboardingStep === "review";
  const isLiveReviewConnected = liveReviewSession?.status === "connected";
  const isReportReady =
    Boolean(reviewStartedAt) && reportReadyCountdownMs <= 0;
  const hasReviewStarted = Boolean(reviewStartedAt);
  const isMicrophoneReady = microphoneStatus === "ready";
  const isScreenReady = screenShareStatus === "sharing";
  const isSetupReady = isMicrophoneReady && isScreenReady;

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

  function appendTranscriptItem(role: "user" | "assistant", text: string) {
    setTranscript((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role,
        text,
        timestamp: new Date().toISOString(),
      },
    ]);
  }

  useEffect(() => {
    const storedUserName = window.localStorage
      .getItem(USER_NAME_STORAGE_KEY)
      ?.trim();

    if (storedUserName) {
      setUserName(storedUserName);
      setOnboardingStep("setup");
    }

    fetch("/api/session")
      .then((res) => res.json())
      .then((data: { key?: string; error?: string }) => {
        if (data.key) {
          setApiKey(data.key);
        } else {
          setApiKeyError(true);
        }
      })
      .catch(() => setApiKeyError(true));
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

  // Update impl refs every render so stable wrappers always call the latest closure.
  playLiveAudioChunkImplRef.current = async (chunk: LiveAudioChunk) => {
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
  };

  handleLiveMessageImplRef.current = (message: LiveServerMessage) => {
    if (message.serverContent?.interrupted) {
      clearLiveAudioPlayback();
      suppressLiveAudioPlaybackUntilRef.current = 0;
    }

    // Audio output — play directly (skip during barge-in suppression)
    if (performance.now() >= suppressLiveAudioPlaybackUntilRef.current) {
      const parts = message.serverContent?.modelTurn?.parts ?? [];
      for (const part of parts) {
        const inlineData = part.inlineData;
        if (
          inlineData?.data &&
          typeof inlineData.data === "string" &&
          typeof inlineData.mimeType === "string" &&
          inlineData.mimeType.startsWith("audio/")
        ) {
          void playLiveAudioChunkImplRef.current({ data: inlineData.data, mimeType: inlineData.mimeType });
        }
      }
    }

    // Transcription accumulation
    const inputT = message.serverContent?.inputTranscription;
    const outputT = message.serverContent?.outputTranscription;

    if (typeof inputT?.text === "string" && inputT.text.trim()) {
      pendingInputRef.current = inputT.text.trim();
    }
    if (typeof outputT?.text === "string" && outputT.text.trim()) {
      pendingOutputRef.current = outputT.text.trim();
    }
    if (inputT?.finished && pendingInputRef.current) {
      appendTranscriptItem("user", pendingInputRef.current);
      pendingInputRef.current = null;
    }
    if (outputT?.finished && pendingOutputRef.current) {
      appendTranscriptItem("assistant", pendingOutputRef.current);
      pendingOutputRef.current = null;
    }
  };

  handleLiveCloseImplRef.current = () => {
    if (isFinishingReviewRef.current) return;
    geminiSessionRef.current = null;
    setLiveReviewSession(null);
    setReviewStartedAt(null);
    setLiveReviewError("Live review session closed unexpectedly. Please try starting a new review.");
  };

  async function startLiveReview(currentApiKey: string) {
    const normalizedUserName = userName.trim();

    if (!normalizedUserName) {
      setLiveReviewError("Your name is required before review can start.");
      setOnboardingStep("welcome");
      return false;
    }

    setIsConnectingLiveReview(true);
    setIsSendingKickoff(true);
    setLiveReviewError(null);
    setLiveMessageError(null);
    setLiveFrameError(null);
    setLiveAudioError(null);

    try {
      const ai = getGeminiClient(currentApiKey);
      const sessionId = crypto.randomUUID();

      const session = await ai.live.connect({
        model: LIVE_MODEL,
        config: {
          mediaResolution: MediaResolution.MEDIA_RESOLUTION_HIGH,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          realtimeInputConfig: {
            activityHandling: ActivityHandling.START_OF_ACTIVITY_INTERRUPTS,
          },
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: "Leda" },
            },
          },
          contextWindowCompression: { slidingWindow: {} },
          systemInstruction: ART_DIRECTOR_AI_SYSTEM_PROMPT,
        },
        callbacks: {
          onmessage: stableHandleLiveMessage.current,
          onerror: (e: ErrorEvent) =>
            setLiveReviewError(e.message ?? "Live session error."),
          onclose: stableHandleLiveClose.current,
        },
      });

      geminiSessionRef.current = session;

      session.sendClientContent({
        turns: buildKickoffPrompt(normalizedUserName),
        turnComplete: true,
      });

      persistUserName(normalizedUserName);
      setTranscript([]);
      setLiveReviewSession({ id: sessionId, status: "connected" });
      setReviewStartedAt(new Date().toISOString());

      return true;
    } catch (error) {
      geminiSessionRef.current = null;
      setLiveReviewSession(null);
      setLiveReviewError(
        error instanceof Error ? error.message : "Live Gemini connection failed.",
      );
      return false;
    } finally {
      setIsConnectingLiveReview(false);
      setIsSendingKickoff(false);
    }
  }

  function stopLocalLiveReview() {
    try {
      geminiSessionRef.current?.close();
    } catch {
      // ignore close errors
    }
    geminiSessionRef.current = null;

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

  async function handleFinishReview() {
    if (!liveReviewSession?.id || isGeneratingReport) {
      return;
    }

    const currentTranscript = transcript;
    const currentSessionId = liveReviewSession.id;

    isFinishingReviewRef.current = true;
    setIsGeneratingReport(true);
    setIsDownloadingPdf(false);
    setPdfError(null);
    setReportError(null);
    setGeneratedReport(null);
    setReportScreenshots([]);

    stopLocalLiveReview();

    try {
      const report = await generateReviewReport(
        {
          sessionState: {
            id: currentSessionId,
            assetName: undefined,
            assetType: undefined,
            styleTarget: undefined,
            transcript: currentTranscript,
            reviewedParts: [],
            visibilityLimitations: [],
            findings: [],
            resourceCatalog: [],
          },
          screenshots: [],
          assetMetadata: null,
          styleTarget: null,
        },
        apiKey!,
      );

      setGeneratedReport(report.markdown);
      setReportScreenshots([]);
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const html2pdf = (await import("html2pdf.js" as any)).default;
      const reportElement = document.getElementById("report-pdf-content");

      if (!reportElement) {
        throw new Error("Report element not found.");
      }

      await html2pdf()
        .set({
          margin: [15, 15],
          filename: "art-director-ai-review.pdf",
          html2canvas: { scale: 2 },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        })
        .from(reportElement)
        .save();
    } catch (error) {
      setPdfError(
        error instanceof Error ? error.message : "PDF generation failed.",
      );
    } finally {
      setIsDownloadingPdf(false);
    }
  }

  function computeFrameHash(videoElement: HTMLVideoElement): number {
    const hashHeight = Math.round(
      LIVE_FRAME_HASH_WIDTH * (videoElement.videoHeight / videoElement.videoWidth),
    );
    const canvas = document.createElement("canvas");
    canvas.width = LIVE_FRAME_HASH_WIDTH;
    canvas.height = hashHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return 0;
    ctx.drawImage(videoElement, 0, 0, LIVE_FRAME_HASH_WIDTH, hashHeight);
    const data = ctx.getImageData(0, 0, LIVE_FRAME_HASH_WIDTH, hashHeight).data;
    let hash = 0;
    for (let i = 0; i < data.length; i += 16) {
      hash = (Math.imul(hash, 31) + data[i]) | 0;
    }
    return hash;
  }

  async function handleSendCurrentScreenFrame() {
    if (!liveReviewSession?.id) {
      setLiveFrameError("Live review session is not connected.");
      return false;
    }

    if (isSendingLiveFrameRef.current) {
      return false;
    }

    const videoElement = videoRef.current;

    if (videoElement && videoElement.videoWidth && videoElement.videoHeight) {
      const now = performance.now();
      const hash = computeFrameHash(videoElement);
      const isForced = now - lastForcedFrameSentAtRef.current >= LIVE_FRAME_FORCE_SEND_INTERVAL_MS;

      if (hash === lastSentFrameHashRef.current && !isForced) {
        return false;
      }

      lastSentFrameHashRef.current = hash;
      if (isForced) {
        lastForcedFrameSentAtRef.current = now;
      }
    }

    const frame = captureCurrentScreenCanvas({
      maxWidth: LIVE_FRAME_MAX_WIDTH,
    });

    if (!frame) {
      return false;
    }

    isSendingLiveFrameRef.current = true;
    try {
      const base64 = frame.canvas.toDataURL("image/jpeg", 0.8).split(",")[1];
      geminiSessionRef.current?.sendRealtimeInput({
        video: { data: base64, mimeType: "image/jpeg" },
      });
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
    if (!microphoneStream || !isLiveReviewConnected) {
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
    let processor: AudioWorkletNode | null = null;
    let isCancelled = false;

    const handleAudioChunk = (event: MessageEvent<{ data: string; rms: number }>) => {
      if (isCancelled || !isLiveReviewConnected) {
        return;
      }

      const { data, rms } = event.data;
      const now = performance.now();
      const isSpeechDetected = rms >= MICROPHONE_SPEECH_RMS_THRESHOLD;

      // Local barge-in: mute model playback when user starts speaking.
      // Gemini handles the actual interruption server-side via activityHandling.
      const hasQueuedModelAudio =
        activePlaybackSourcesRef.current.size > 0 ||
        nextPlaybackTimeRef.current - audioContext.currentTime > 0.05;

      if (
        isSpeechDetected &&
        hasQueuedModelAudio &&
        now - lastLocalBargeInAtRef.current > 150
      ) {
        lastLocalBargeInAtRef.current = now;
        suppressLiveAudioPlaybackUntilRef.current =
          now + LIVE_AUDIO_BARGE_IN_SUPPRESS_MS;
        clearLiveAudioPlayback();
      }

      // Always send audio — Gemini's server-side VAD detects speech start/end.
      // Filtering here would prevent Gemini from hearing the silence→speech
      // transition it needs to trigger a response.
      try {
        geminiSessionRef.current?.sendRealtimeInput({
          audio: { data, mimeType: "audio/pcm;rate=16000" },
        });
      } catch (error) {
        setLiveAudioError(
          error instanceof Error ? error.message : "Live microphone streaming failed.",
        );
      }
    };

    void audioContext.audioWorklet
      .addModule("/audio-processor.worklet.js")
      .then(() => {
        if (isCancelled) return;
        processor = new AudioWorkletNode(audioContext, "audio-processor");
        processor.port.onmessage = handleAudioChunk;
        source.connect(processor);
        void audioContext.resume();
      })
      .catch(() => {
        if (!isCancelled) {
          setLiveAudioError("Browser microphone streaming is unavailable.");
        }
      });

    return () => {
      isCancelled = true;
      processor?.disconnect();
      source.disconnect();
      void audioContext.close();
    };
  }, [isLiveReviewConnected, microphoneStream]);

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

    // Create and resume AudioContext synchronously within the user gesture so
    // the browser doesn't block playback later (autoplay policy).
    const AudioContextConstructor =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (AudioContextConstructor) {
      if (!playbackAudioContextRef.current) {
        playbackAudioContextRef.current = new AudioContextConstructor();
      }
      if (playbackAudioContextRef.current.state === "suspended") {
        void playbackAudioContextRef.current.resume();
      }
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

      const started = await startLiveReview(apiKey!);

      if (!started) {
        setOnboardingStep("setup");
      }
    } finally {
      setIsStartingLiveReview(false);
    }
  }

  if (apiKeyError || !apiKey) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-100 px-6 py-16">
        <section className="w-full max-w-2xl rounded-3xl border border-zinc-200 bg-white p-10 shadow-sm">
          <div className="space-y-4">
            <p className="text-sm font-medium uppercase tracking-[0.24em] text-zinc-500">
              Adai
            </p>
            <h1 className="text-4xl font-semibold tracking-tight text-zinc-950 sm:text-5xl">
              Service unavailable
            </h1>
            <p className="text-base leading-7 text-zinc-600 sm:text-lg">
              Could not connect to the service. Please try again later.
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
                    <div id="report-pdf-content" className="mt-4 max-h-[420px] space-y-6 overflow-y-auto pr-2">
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
