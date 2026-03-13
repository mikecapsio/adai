import { TEST_PROMPT_MODEL } from "../../config/env";
import { getGeminiClient } from "./client";
import type {
  LiveReviewFinding,
  LiveReviewSessionState,
  ReviewTranscriptItem,
} from "./liveSession";
import {
  lookupGroundedLearningResources,
  type GroundedLearningResource,
} from "./reportGrounding";
import {
  extractReportInsights,
  type ExtractedReportInsights,
} from "./reportInsights";
import { ART_DIRECTOR_AI_REPORT_PROMPT } from "./reportPrompt";

export type ReportTranscriptMessage = ReviewTranscriptItem;

export type ReportScreenshot = {
  id: string;
  imageDataUrl: string;
  timestamp: string;
  label?: string;
};

export type ReportGenerationInput = {
  assetMetadata?: Record<string, unknown> | null;
  screenshots: ReportScreenshot[];
  sessionState: Pick<
    LiveReviewSessionState,
    | "id"
    | "assetName"
    | "assetType"
    | "styleTarget"
    | "transcript"
    | "reviewedParts"
    | "visibilityLimitations"
    | "findings"
    | "resourceCatalog"
  >;
  styleTarget?: string | null;
};

export type ReportPromptPayload = {
  assetMeta: {
    assetName: string | null;
    assetType: string;
    projectName: string | null;
    styleTarget: string | null;
    targetPlatform: string | null;
  };
  transcript: Array<{
    role: ReportTranscriptMessage["role"];
    text: string;
    timestamp: string;
  }>;
  findings: LiveReviewFinding[];
  reviewedParts: string[];
  visibilityLimitations: string[];
  resourceCatalog: Array<{
    title: string;
    type: "article" | "breakdown" | "video";
    provider: string;
    url: string;
    whyRelevant: string;
    relatedIssue: string;
  }>;
  screenshots: Array<{
    id: string;
    timestamp: string;
    label: string | null;
  }>;
};

function getOptionalStringValue(
  object: Record<string, unknown> | null | undefined,
  key: string,
) {
  return typeof object?.[key] === "string" ? object[key] : null;
}

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

export function buildReportPromptPayload(
  input: ReportGenerationInput,
  options?: {
    extractedInsights?: ExtractedReportInsights;
    resourceCatalog?: GroundedLearningResource[];
  },
): ReportPromptPayload {
  const assetTypeFromMetadata = getOptionalStringValue(
    input.assetMetadata,
    "assetType",
  );
  const styleTargetFromMetadata = getOptionalStringValue(
    input.assetMetadata,
    "styleTarget",
  );
  const transcriptMessages = input.sessionState.transcript.filter(
    (message) => message.role === "user" || message.role === "assistant",
  );
  const extractedInsights = options?.extractedInsights;
  const resourceCatalog = options?.resourceCatalog || [];

  return {
    assetMeta: {
      assetName:
        input.sessionState.assetName ||
        extractedInsights?.assetName ||
        getOptionalStringValue(input.assetMetadata, "assetName"),
      assetType:
        input.sessionState.assetType ||
        extractedInsights?.assetType ||
        assetTypeFromMetadata ||
        "3D game asset",
      projectName: getOptionalStringValue(input.assetMetadata, "projectName"),
      styleTarget:
        input.styleTarget ||
        input.sessionState.styleTarget ||
        extractedInsights?.styleTarget ||
        styleTargetFromMetadata ||
        null,
      targetPlatform: getOptionalStringValue(
        input.assetMetadata,
        "targetPlatform",
      ),
    },
    transcript: transcriptMessages.map((message) => ({
      role: message.role,
      text: message.text,
      timestamp: message.timestamp,
    })),
    findings: (
      input.sessionState.findings.length > 0
        ? input.sessionState.findings
        : extractedInsights?.findings || []
    ).map((finding) => ({ ...finding })),
    reviewedParts: [
      ...(input.sessionState.reviewedParts.length > 0
        ? input.sessionState.reviewedParts
        : extractedInsights?.reviewedParts || []),
    ],
    visibilityLimitations: [
      ...(input.sessionState.visibilityLimitations.length > 0
        ? input.sessionState.visibilityLimitations
        : extractedInsights?.visibilityLimitations || []),
    ],
    resourceCatalog: resourceCatalog.map((resource) => ({
      title: resource.title,
      type: resource.type,
      provider: resource.provider,
      url: resource.url,
      whyRelevant: resource.whyRelevant,
      relatedIssue: resource.relatedIssue,
    })),
    screenshots: input.screenshots.map((screenshot) => ({
      id: screenshot.id,
      timestamp: screenshot.timestamp,
      label: screenshot.label || null,
    })),
  };
}

/**
 * Generates the MVP report from the stored live review session state.
 * The transcript and review metadata come from backend memory, while
 * screenshots are attached as optional image references for the report pass.
 */
export async function generateReviewReport(input: ReportGenerationInput) {
  const ai = getGeminiClient();
  const transcriptMessages = input.sessionState.transcript.filter(
    (message) => message.role === "user" || message.role === "assistant",
  );
  const extractedInsights = await extractReportInsights({
    transcript: transcriptMessages,
    screenshots: input.screenshots,
    sessionState: {
      assetName: input.sessionState.assetName,
      assetType: input.sessionState.assetType,
      styleTarget: input.sessionState.styleTarget,
      reviewedParts: input.sessionState.reviewedParts,
      visibilityLimitations: input.sessionState.visibilityLimitations,
      findings: input.sessionState.findings,
    },
  });
  const promptPayload = buildReportPromptPayload(input, {
    extractedInsights,
    resourceCatalog: await lookupGroundedLearningResources({
      assetName:
        input.sessionState.assetName ||
        extractedInsights.assetName ||
        getOptionalStringValue(input.assetMetadata, "assetName"),
      assetType:
        input.sessionState.assetType ||
        extractedInsights.assetType ||
        getOptionalStringValue(input.assetMetadata, "assetType") ||
        "3D game asset",
      styleTarget:
        input.styleTarget ||
        input.sessionState.styleTarget ||
        extractedInsights.styleTarget ||
        getOptionalStringValue(input.assetMetadata, "styleTarget"),
      findings:
        input.sessionState.findings.length > 0
          ? input.sessionState.findings
          : extractedInsights.findings,
      reviewedParts:
        input.sessionState.reviewedParts.length > 0
          ? input.sessionState.reviewedParts
          : extractedInsights.reviewedParts,
      visibilityLimitations:
        input.sessionState.visibilityLimitations.length > 0
          ? input.sessionState.visibilityLimitations
          : extractedInsights.visibilityLimitations,
      transcript: transcriptMessages,
    }),
  });
  const parts: Array<{
    text?: string;
    inlineData?: {
      data: string;
      mimeType: string;
    };
  }> = [
    {
      text: [
        ART_DIRECTOR_AI_REPORT_PROMPT,
        "Use the following structured live review session data as the primary source of truth.",
        "Screenshots are attached separately as image inputs when available.",
        "",
        "Session data JSON:",
        JSON.stringify(promptPayload, null, 2),
        "",
        "Return only the final Markdown report.",
      ].join("\n"),
    },
  ];

  for (const screenshot of input.screenshots) {
    const parsedScreenshot = parseImageDataUrl(screenshot.imageDataUrl);

    if (!parsedScreenshot) {
      continue;
    }

    parts.push({
      inlineData: {
        data: parsedScreenshot.data,
        mimeType: parsedScreenshot.mimeType,
      },
    });
  }

  const response = await ai.models.generateContent({
    model: TEST_PROMPT_MODEL,
    contents: [
      {
        role: "user",
        parts,
      },
    ],
  });

  return {
    markdown:
      response.text?.trim() ||
      "# Art Director AI Review Report\n\nGemini returned an empty report.",
    model: TEST_PROMPT_MODEL,
    promptPayload,
    extractedInsights,
  };
}
