import { getGeminiClient } from "./client";
import { REPORT_MODEL } from "./models";
import type {
  LiveReviewFinding,
  LiveReviewSessionState,
  ReviewTranscriptItem,
} from "./types";

type ReportInsightScreenshot = {
  id: string;
  imageDataUrl: string;
  timestamp: string;
  label?: string;
};

export type ExtractedReportInsights = {
  assetName: string | null;
  assetType: string | null;
  styleTarget: string | null;
  reviewedParts: string[];
  visibilityLimitations: string[];
  findings: LiveReviewFinding[];
};

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

function parseJsonResponseText<T>(text: string | undefined) {
  if (!text) {
    return null;
  }

  const normalizedText = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");

  try {
    return JSON.parse(normalizedText) as T;
  } catch {
    return null;
  }
}

function normalizeUniqueStringList(values: unknown) {
  if (!Array.isArray(values)) {
    return [];
  }

  const seenValues = new Set<string>();
  const nextValues: string[] = [];

  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }

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

function normalizeExtractedFindings(value: unknown): LiveReviewFinding[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalizedFindings: LiveReviewFinding[] = [];

  for (const finding of value) {
    if (typeof finding !== "object" || finding === null) {
      continue;
    }

    const severity =
      finding &&
      typeof (finding as { severity?: unknown }).severity === "string" &&
      ["High", "Medium", "Low"].includes(
        (finding as { severity: string }).severity,
      )
        ? (finding as { severity: "High" | "Medium" | "Low" }).severity
        : "Medium";

    normalizedFindings.push({
      area:
        typeof (finding as { area?: unknown }).area === "string"
          ? (finding as { area: string }).area.trim()
          : "",
      issue:
        typeof (finding as { issue?: unknown }).issue === "string"
          ? (finding as { issue: string }).issue.trim()
          : "",
      severity,
      whyItHurtsQuality:
        typeof (finding as { whyItHurtsQuality?: unknown }).whyItHurtsQuality ===
        "string"
          ? (
              finding as {
                whyItHurtsQuality: string;
              }
            ).whyItHurtsQuality.trim()
          : "",
      improvementDirection:
        typeof (finding as { improvementDirection?: unknown }).improvementDirection ===
        "string"
          ? (
              finding as {
                improvementDirection: string;
              }
            ).improvementDirection.trim()
          : "",
      practicalNextStep:
        typeof (finding as { practicalNextStep?: unknown }).practicalNextStep ===
        "string"
          ? (
              finding as {
                practicalNextStep: string;
              }
            ).practicalNextStep.trim()
          : "",
    });
  }

  return normalizedFindings.filter(
    (finding) =>
      finding.area &&
      finding.issue &&
      finding.whyItHurtsQuality &&
      finding.improvementDirection &&
      finding.practicalNextStep,
  );
}

function buildInsightRequestText(input: {
  transcript: ReviewTranscriptItem[];
  sessionState: Pick<
    LiveReviewSessionState,
    | "assetName"
    | "assetType"
    | "styleTarget"
    | "reviewedParts"
    | "visibilityLimitations"
    | "findings"
  >;
}) {
  return [
    "You are preparing structured review data from a completed 3D game asset critique session.",
    "Return JSON only.",
    "Base the output only on the provided transcript and screenshots.",
    "If the asset name is explicitly stated or clearly identified during the review, return that exact short asset name.",
    "Do not invent findings that are not supported by the review evidence.",
    "",
    "Return an object with these fields:",
    '- assetName: string or null',
    '- assetType: string or null',
    '- styleTarget: string or null',
    '- reviewedParts: string[]',
    '- visibilityLimitations: string[]',
    "- findings: array of objects with area, issue, severity, whyItHurtsQuality, improvementDirection, practicalNextStep",
    "",
    "Existing stored session context:",
    JSON.stringify(
      {
        assetName: input.sessionState.assetName || null,
        assetType: input.sessionState.assetType || null,
        styleTarget: input.sessionState.styleTarget || null,
        reviewedParts: input.sessionState.reviewedParts,
        visibilityLimitations: input.sessionState.visibilityLimitations,
        findings: input.sessionState.findings,
      },
      null,
      2,
    ),
    "",
    "Transcript JSON:",
    JSON.stringify(
      input.transcript.map((message) => ({
        role: message.role,
        text: message.text,
        timestamp: message.timestamp,
      })),
      null,
      2,
    ),
  ].join("\n");
}

/**
 * Extracts report-ready review structure from the completed live session.
 * This keeps the report pipeline deterministic and lets the final report
 * prompt work from explicit findings instead of only raw transcript text.
 */
export async function extractReportInsights(
  input: {
    transcript: ReviewTranscriptItem[];
    screenshots: ReportInsightScreenshot[];
    sessionState: Pick<
      LiveReviewSessionState,
      | "assetName"
      | "assetType"
      | "styleTarget"
      | "reviewedParts"
      | "visibilityLimitations"
      | "findings"
    >;
  },
  apiKey: string,
) {
  const ai = getGeminiClient(apiKey);
  const parts: Array<{
    text?: string;
    inlineData?: {
      data: string;
      mimeType: string;
    };
  }> = [
    {
      text: buildInsightRequestText(input),
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
    model: REPORT_MODEL,
    contents: [
      {
        role: "user",
        parts,
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: {
        type: "object",
        properties: {
          assetName: { type: ["string", "null"] },
          assetType: { type: ["string", "null"] },
          styleTarget: { type: ["string", "null"] },
          reviewedParts: {
            type: "array",
            items: { type: "string" },
          },
          visibilityLimitations: {
            type: "array",
            items: { type: "string" },
          },
          findings: {
            type: "array",
            items: {
              type: "object",
              properties: {
                area: { type: "string" },
                issue: { type: "string" },
                severity: { type: "string" },
                whyItHurtsQuality: { type: "string" },
                improvementDirection: { type: "string" },
                practicalNextStep: { type: "string" },
              },
              required: [
                "area",
                "issue",
                "severity",
                "whyItHurtsQuality",
                "improvementDirection",
                "practicalNextStep",
              ],
            },
          },
        },
        required: [
          "assetName",
          "assetType",
          "styleTarget",
          "reviewedParts",
          "visibilityLimitations",
          "findings",
        ],
      },
    },
  });

  const parsedResponse = parseJsonResponseText<{
    assetName?: string | null;
    assetType?: string | null;
    styleTarget?: string | null;
    reviewedParts?: unknown;
    visibilityLimitations?: unknown;
    findings?: unknown;
  }>(response.text);

  return {
    assetName:
      typeof parsedResponse?.assetName === "string" &&
      parsedResponse.assetName.trim()
        ? parsedResponse.assetName.trim()
        : null,
    assetType:
      typeof parsedResponse?.assetType === "string" &&
      parsedResponse.assetType.trim()
        ? parsedResponse.assetType.trim()
        : null,
    styleTarget:
      typeof parsedResponse?.styleTarget === "string" &&
      parsedResponse.styleTarget.trim()
        ? parsedResponse.styleTarget.trim()
        : null,
    reviewedParts: normalizeUniqueStringList(parsedResponse?.reviewedParts),
    visibilityLimitations: normalizeUniqueStringList(
      parsedResponse?.visibilityLimitations,
    ),
    findings: normalizeExtractedFindings(parsedResponse?.findings),
  } satisfies ExtractedReportInsights;
}
