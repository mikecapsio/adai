import { getGeminiClient } from "./client";
import { REPORT_MODEL } from "./models";
import type { LiveReviewFinding, ReviewTranscriptItem } from "./types";

export type GroundedLearningResource = {
  title: string;
  provider: string;
  url: string;
  type: "article" | "breakdown" | "video";
  whyRelevant: string;
  relatedIssue: string;
};

type GroundedCandidateResource = {
  title: string;
  provider: string;
  url: string;
  type: "article" | "breakdown" | "video";
};

function normalizeProviderFromUrl(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
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

function inferResourceType(title: string, url: string) {
  const normalizedValue = `${title} ${url}`.toLowerCase();

  if (
    normalizedValue.includes("youtube.com") ||
    normalizedValue.includes("youtu.be") ||
    normalizedValue.includes("vimeo.com") ||
    normalizedValue.includes("video")
  ) {
    return "video" as const;
  }

  if (normalizedValue.includes("breakdown")) {
    return "breakdown" as const;
  }

  return "article" as const;
}

function fallbackGroundedCandidatesToResources(
  candidateResources: GroundedCandidateResource[],
  findings: LiveReviewFinding[],
) {
  const primaryIssue =
    findings[0]?.issue || findings[0]?.area || "this review";

  return candidateResources.slice(0, 4).map((resource) => ({
    title: resource.title,
    provider: resource.provider,
    url: resource.url,
    type: resource.type,
    whyRelevant: `Grounded search result selected because it appears directly relevant to ${primaryIssue}.`,
    relatedIssue: primaryIssue,
  }));
}

function extractGroundedCandidateResources(response: {
  candidates?: Array<{
    groundingMetadata?: {
      groundingChunks?: Array<{
        web?: {
          title?: string;
          uri?: string;
          domain?: string;
        };
      }>;
    };
  }>;
}) {
  const seenUrls = new Set<string>();
  const resources: GroundedCandidateResource[] = [];

  for (const candidate of response.candidates || []) {
    for (const chunk of candidate.groundingMetadata?.groundingChunks || []) {
      const title = chunk.web?.title?.trim();
      const url = chunk.web?.uri?.trim();

      if (!title || !url || seenUrls.has(url)) {
        continue;
      }

      seenUrls.add(url);
      resources.push({
        title,
        provider: chunk.web?.domain?.trim() || normalizeProviderFromUrl(url),
        url,
        type: inferResourceType(title, url),
      });
    }
  }

  return resources.slice(0, 12);
}

function isGroundingRedirectUrl(url: string) {
  try {
    const parsedUrl = new URL(url);

    return (
      parsedUrl.hostname === "vertexaisearch.cloud.google.com" &&
      (parsedUrl.pathname.includes("grounding-api-redirect") ||
        parsedUrl.pathname.includes("grounding-apiredirect"))
    );
  } catch {
    return false;
  }
}

async function resolveGroundedCandidateResourceUrl(
  resource: GroundedCandidateResource,
) {
  if (!isGroundingRedirectUrl(resource.url)) {
    return resource;
  }

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => {
    abortController.abort();
  }, 8000);

  try {
    const response = await fetch(resource.url, {
      method: "GET",
      redirect: "follow",
      signal: abortController.signal,
    });

    void response.body?.cancel();

    const resolvedUrl = response.url?.trim() || resource.url;

    if (!resolvedUrl || isGroundingRedirectUrl(resolvedUrl)) {
      return resource;
    }

    return {
      ...resource,
      url: resolvedUrl,
      provider: normalizeProviderFromUrl(resolvedUrl),
      type: inferResourceType(resource.title, resolvedUrl),
    };
  } catch {
    return resource;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function resolveGroundedCandidateResourceUrls(
  candidateResources: GroundedCandidateResource[],
) {
  const resolvedResources = await Promise.all(
    candidateResources.map(resolveGroundedCandidateResourceUrl),
  );
  const seenUrls = new Set<string>();

  return resolvedResources.filter((resource) => {
    if (seenUrls.has(resource.url)) {
      return false;
    }

    seenUrls.add(resource.url);
    return true;
  });
}

function normalizeSelectedResources(
  value: unknown,
  allowedUrls: Set<string>,
) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seenUrls = new Set<string>();
  const resources: GroundedLearningResource[] = [];

  for (const resource of value) {
    if (typeof resource !== "object" || resource === null) {
      continue;
    }

    const url =
      typeof (resource as { url?: unknown }).url === "string"
        ? (resource as { url: string }).url.trim()
        : "";

    if (!url || !allowedUrls.has(url) || seenUrls.has(url)) {
      continue;
    }

    const type =
      typeof (resource as { type?: unknown }).type === "string" &&
      ["article", "breakdown", "video"].includes(
        (resource as { type: string }).type,
      )
        ? (resource as { type: "article" | "breakdown" | "video" }).type
        : inferResourceType(
            typeof (resource as { title?: unknown }).title === "string"
              ? (resource as { title: string }).title
              : "",
            url,
          );

    const normalizedResource: GroundedLearningResource = {
      title:
        typeof (resource as { title?: unknown }).title === "string"
          ? (resource as { title: string }).title.trim()
          : "",
      provider:
        typeof (resource as { provider?: unknown }).provider === "string"
          ? (resource as { provider: string }).provider.trim()
          : "",
      url,
      type,
      whyRelevant:
        typeof (resource as { whyRelevant?: unknown }).whyRelevant === "string"
          ? (resource as { whyRelevant: string }).whyRelevant.trim()
          : "",
      relatedIssue:
        typeof (resource as { relatedIssue?: unknown }).relatedIssue === "string"
          ? (resource as { relatedIssue: string }).relatedIssue.trim()
          : "",
    };

    if (
      !normalizedResource.title ||
      !normalizedResource.provider ||
      !normalizedResource.whyRelevant ||
      !normalizedResource.relatedIssue
    ) {
      continue;
    }

    seenUrls.add(url);
    resources.push(normalizedResource);
  }

  return resources.slice(0, 6);
}

function buildGroundedSearchPrompt(input: {
  assetName: string | null;
  assetType: string;
  styleTarget: string | null;
  findings: LiveReviewFinding[];
  reviewedParts: string[];
  transcript: ReviewTranscriptItem[];
}) {
  return [
    "Use Google Search grounding to search for free, practical learning resources for this exact 3D game art review.",
    "Search for relevant tutorials, articles, and breakdowns that directly match the actual issues, workflow needs, and style goals in the review.",
    "Prioritize resources that are actionable for a working game artist.",
    "Do not look for paid courses, marketplace listings, or generic unrelated pages.",
    "",
    "Review context JSON:",
    JSON.stringify(
      {
        assetName: input.assetName,
        assetType: input.assetType,
        styleTarget: input.styleTarget,
        reviewedParts: input.reviewedParts,
        findings: input.findings,
        transcript: input.transcript.map((message) => ({
          role: message.role,
          text: message.text,
        })),
      },
      null,
      2,
    ),
  ].join("\n");
}

function buildGroundedSelectionPrompt(input: {
  assetName: string | null;
  assetType: string;
  styleTarget: string | null;
  findings: LiveReviewFinding[];
  reviewedParts: string[];
  transcript: ReviewTranscriptItem[];
  candidateResources: GroundedCandidateResource[];
}) {
  return [
    "You are selecting the final study resources for a 3D game art review report.",
    "Choose only from the provided grounded candidateResources. Do not invent new URLs.",
    "Pick 3 to 6 resources that best match the real issues and goals in the review.",
    "Prefer a mix of text and video when possible, but relevance matters more than balance.",
    "Return JSON only.",
    "",
    "Return an object with a resources array.",
    "Each resource object must include:",
    "- title",
    "- provider",
    "- url",
    '- type: "article" | "breakdown" | "video"',
    "- whyRelevant",
    "- relatedIssue",
    "",
    "Review context JSON:",
    JSON.stringify(
      {
        assetName: input.assetName,
        assetType: input.assetType,
        styleTarget: input.styleTarget,
        reviewedParts: input.reviewedParts,
        findings: input.findings,
        transcript: input.transcript.map((message) => ({
          role: message.role,
          text: message.text,
        })),
      },
      null,
      2,
    ),
    "",
    "Grounded candidateResources JSON:",
    JSON.stringify(input.candidateResources, null, 2),
  ].join("\n");
}

/**
 * Uses Google Search grounding to find report-specific learning resources.
 * The final resources are selected only from grounded search results so the
 * report no longer falls back to the previous static tutorial list.
 */
export async function lookupGroundedLearningResources(
  input: {
    assetName: string | null;
    assetType: string;
    styleTarget: string | null;
    findings: LiveReviewFinding[];
    reviewedParts: string[];
    transcript: ReviewTranscriptItem[];
  },
  apiKey: string,
) {
  try {
    const ai = getGeminiClient(apiKey);
    const searchResponse = await ai.models.generateContent({
      model: REPORT_MODEL,
      contents: buildGroundedSearchPrompt(input),
      config: {
        tools: [{ googleSearch: {} }],
      },
    });
    const extractedGroundedCandidateResources =
      extractGroundedCandidateResources(searchResponse);

    if (extractedGroundedCandidateResources.length === 0) {
      return [];
    }

    const groundedCandidateResources =
      await resolveGroundedCandidateResourceUrls(
        extractedGroundedCandidateResources,
      );

    const allowedUrls = new Set(
      groundedCandidateResources.map((resource) => resource.url),
    );
    const selectionResponse = await ai.models.generateContent({
      model: REPORT_MODEL,
      contents: buildGroundedSelectionPrompt({
        ...input,
        candidateResources: groundedCandidateResources,
      }),
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: {
          type: "object",
          properties: {
            resources: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  provider: { type: "string" },
                  url: { type: "string" },
                  type: { type: "string" },
                  whyRelevant: { type: "string" },
                  relatedIssue: { type: "string" },
                },
                required: [
                  "title",
                  "provider",
                  "url",
                  "type",
                  "whyRelevant",
                  "relatedIssue",
                ],
              },
            },
          },
          required: ["resources"],
        },
      },
    });
    const parsedSelectionResponse = parseJsonResponseText<{
      resources?: unknown;
    }>(selectionResponse.text);
    const selectedResources = normalizeSelectedResources(
      parsedSelectionResponse?.resources,
      allowedUrls,
    );

    if (selectedResources.length > 0) {
      return selectedResources;
    }

    return fallbackGroundedCandidatesToResources(
      groundedCandidateResources,
      input.findings,
    );
  } catch {
    return [];
  }
}
