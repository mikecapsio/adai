import { Router } from "express";
import { hasGeminiKey } from "../config/env";
import {
  getLiveReviewSessionState,
  updateLiveReviewSessionState,
} from "../lib/gemini/liveSession";
import {
  generateReviewReport,
  type ReportGenerationInput,
  type ReportScreenshot,
  type ReportTranscriptMessage,
} from "../lib/gemini/report";
import { generateReviewReportPdf } from "../lib/report/pdf";

export const reportRouter = Router();

function getReportErrorMessage(error: unknown) {
  if (error instanceof Error) {
    if (error.message === "fetch failed") {
      return "Could not reach the Gemini API from the backend. Check network access and GEMINI_API_KEY.";
    }

    return error.message;
  }

  return "Report generation failed.";
}

function getPdfErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "PDF generation failed.";
}

function isTranscriptMessage(value: unknown): value is ReportTranscriptMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ReportTranscriptMessage).id === "string" &&
    typeof (value as ReportTranscriptMessage).role === "string" &&
    typeof (value as ReportTranscriptMessage).text === "string" &&
    typeof (value as ReportTranscriptMessage).timestamp === "string"
  );
}

function isScreenshot(value: unknown): value is ReportScreenshot {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ReportScreenshot).id === "string" &&
    typeof (value as ReportScreenshot).imageDataUrl === "string" &&
    typeof (value as ReportScreenshot).timestamp === "string"
  );
}

function hasRecordedConversationTranscript(messages: ReportTranscriptMessage[]) {
  return messages.some(
    (message) =>
      (message.role === "user" || message.role === "assistant") &&
      message.text.trim().length > 0,
  );
}

reportRouter.post("/", async (request, response) => {
  if (!hasGeminiKey()) {
    response.status(503).json({
      error: "GEMINI_API_KEY is not configured on the backend.",
    });
    return;
  }

  const liveReviewSessionId =
    typeof request.body?.liveReviewSessionId === "string"
      ? request.body.liveReviewSessionId.trim()
      : "";
  const transcriptMessages = Array.isArray(request.body?.transcriptMessages)
    ? request.body.transcriptMessages.filter(isTranscriptMessage)
    : [];
  const screenshots = Array.isArray(request.body?.screenshots)
    ? request.body.screenshots.filter(isScreenshot)
    : [];
  const styleTarget =
    typeof request.body?.styleTarget === "string"
      ? request.body.styleTarget
      : null;
  const assetMetadata =
    typeof request.body?.assetMetadata === "object" &&
    request.body.assetMetadata !== null
      ? (request.body.assetMetadata as Record<string, unknown>)
      : null;
  const storedSessionState = liveReviewSessionId
    ? getLiveReviewSessionState(liveReviewSessionId)
    : null;

  if (liveReviewSessionId && !storedSessionState) {
    response.status(404).json({
      error: "Stored live review session data was not found on the backend.",
    });
    return;
  }

  const sessionState = storedSessionState || {
    id: liveReviewSessionId || "ad-hoc-report-session",
    assetName:
      typeof assetMetadata?.assetName === "string"
        ? assetMetadata.assetName
        : undefined,
    transcript: transcriptMessages,
    styleTarget:
      styleTarget ||
      (typeof assetMetadata?.styleTarget === "string"
        ? assetMetadata.styleTarget
        : undefined),
    assetType:
      typeof assetMetadata?.assetType === "string"
        ? assetMetadata.assetType
        : undefined,
    reviewedParts: [],
    visibilityLimitations: [],
    findings: [],
    resourceCatalog: [],
  };

  if (sessionState.transcript.length === 0) {
    response.status(400).json({
      error: "No stored live review transcript was available for report generation.",
    });
    return;
  }

  if (!hasRecordedConversationTranscript(sessionState.transcript)) {
    response.status(400).json({
      error:
        "No recorded user or assistant live-review transcript was available for report generation.",
    });
    return;
  }

  const reportInput: ReportGenerationInput = {
    assetMetadata,
    screenshots,
    sessionState,
    styleTarget,
  };

  try {
    const result = await generateReviewReport(reportInput);

    if (liveReviewSessionId) {
      updateLiveReviewSessionState(liveReviewSessionId, {
        assetName: result.extractedInsights.assetName,
        assetType: result.extractedInsights.assetType,
        styleTarget: result.extractedInsights.styleTarget,
        reviewedParts: result.extractedInsights.reviewedParts,
        visibilityLimitations: result.extractedInsights.visibilityLimitations,
        findings: result.extractedInsights.findings,
        resourceCatalog: result.promptPayload.resourceCatalog.map(
          (resource) => resource.url,
        ),
      });
    }

    response.status(200).json({
      markdown: result.markdown,
      model: result.model,
    });
  } catch (error) {
    response.status(502).json({
      error: getReportErrorMessage(error),
    });
  }
});

reportRouter.post("/pdf", async (request, response) => {
  const markdown =
    typeof request.body?.markdown === "string" ? request.body.markdown.trim() : "";
  const screenshots = Array.isArray(request.body?.screenshots)
    ? request.body.screenshots.filter(isScreenshot)
    : [];

  if (!markdown) {
    response.status(400).json({
      error: "A generated Markdown report is required to export PDF.",
    });
    return;
  }

  try {
    const pdfBuffer = await generateReviewReportPdf({
      markdown,
      screenshots,
    });

    response.status(200);
    response.setHeader("Content-Type", "application/pdf");
    response.setHeader(
      "Content-Disposition",
      'attachment; filename="art-director-ai-review.pdf"',
    );
    response.send(pdfBuffer);
  } catch (error) {
    response.status(502).json({
      error: getPdfErrorMessage(error),
    });
  }
});
