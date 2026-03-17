import type { LiveReviewFinding, ReviewTranscriptItem } from "./types";

export type CuratedLearningResource = {
  id: string;
  title: string;
  format: "text" | "video";
  provider: string;
  url: string;
  description: string;
  topics: string[];
};

const CURATED_LEARNING_RESOURCES: CuratedLearningResource[] = [
  {
    id: "marmoset-pbr-theory",
    title: "Physically-Based Rendering, And You Can Too!",
    format: "text",
    provider: "Marmoset",
    url: "https://marmoset.co/posts/physically-based-rendering-and-you-can-too/",
    description:
      "Strong reference for roughness breakup, measured material values, and cleaner PBR decision-making.",
    topics: ["materials", "roughness", "pbr", "texturing"],
  },
  {
    id: "unreal-pbr-materials",
    title: "Physically Based Materials in Unreal Engine",
    format: "text",
    provider: "Epic Games",
    url: "https://dev.epicgames.com/documentation/unreal-engine/physically-based-materials-in-unreal-engine",
    description:
      "Useful when the critique points toward material definition, roughness control, and believable surface response.",
    topics: ["materials", "roughness", "pbr", "presentation"],
  },
  {
    id: "adobe-pbr-guide",
    title: "The PBR Guide - Part 1",
    format: "text",
    provider: "Adobe",
    url: "https://www.adobe.com/learn/substance-3d-designer/web/the-pbr-guide-part-1",
    description:
      "Helpful for artists who need a clearer grounding in how light, material values, and surface breakup should behave.",
    topics: ["materials", "roughness", "pbr", "texturing"],
  },
  {
    id: "marmoset-lighting-docs",
    title: "Marmoset Toolbag Lighting Documentation",
    format: "text",
    provider: "Marmoset",
    url: "https://docs.marmoset.co/docs/lighting/",
    description:
      "Relevant when the review calls out presentation, lighting quality, or portfolio readability.",
    topics: ["presentation", "portfolio", "lighting", "rendering"],
  },
  {
    id: "adobe-substance-video",
    title: "Adobe Substance 3D Video Tutorials",
    format: "video",
    provider: "Adobe",
    url: "https://www.youtube.com/@AdobeSubstance3D",
    description:
      "Good follow-up when the asset needs stronger texture work, material separation, or Painter workflow refinement.",
    topics: ["materials", "texturing", "roughness", "video"],
  },
  {
    id: "marmoset-video",
    title: "Marmoset Video Tutorials",
    format: "video",
    provider: "Marmoset",
    url: "https://www.youtube.com/@MarmosetCo",
    description:
      "Useful when the next pass should improve presentation, lighting, renders, or final portfolio polish.",
    topics: ["presentation", "portfolio", "lighting", "rendering", "video"],
  },
  {
    id: "unreal-video",
    title: "Unreal Engine Learning Videos",
    format: "video",
    provider: "Epic Games",
    url: "https://www.youtube.com/@UnrealEngine",
    description:
      "Helpful when the review points toward game-readiness, shading validation, or engine-facing material checks.",
    topics: ["materials", "pbr", "game-readiness", "video"],
  },
];

const TOPIC_KEYWORDS: Array<{ topic: string; keywords: string[] }> = [
  {
    topic: "materials",
    keywords: [
      "material",
      "materials",
      "roughness",
      "metallic",
      "metalness",
      "specular",
      "surface",
      "shader",
      "pbr",
      "breakup",
    ],
  },
  {
    topic: "texturing",
    keywords: [
      "texture",
      "textures",
      "albedo",
      "normal",
      "bake",
      "baking",
      "uv",
      "wear",
      "dirt",
      "damage",
    ],
  },
  {
    topic: "presentation",
    keywords: [
      "presentation",
      "portfolio",
      "beauty",
      "beauty-pass",
      "readability",
      "camera",
      "turntable",
      "render",
      "lighting",
    ],
  },
  {
    topic: "lighting",
    keywords: ["lighting", "light", "highlight", "hdr", "hdri", "sky"],
  },
  {
    topic: "rendering",
    keywords: ["render", "rendering", "portfolio", "presentation"],
  },
  {
    topic: "game-readiness",
    keywords: ["engine", "gameplay", "distance", "readability", "unreal"],
  },
];

function collectTopicMatches(text: string) {
  const normalizedText = text.toLowerCase();
  const matchedTopics = new Set<string>();

  for (const entry of TOPIC_KEYWORDS) {
    if (entry.keywords.some((keyword) => normalizedText.includes(keyword))) {
      matchedTopics.add(entry.topic);
    }
  }

  return matchedTopics;
}

function buildContextText(input: {
  assetType?: string;
  styleTarget?: string | null;
  transcript: ReviewTranscriptItem[];
  findings: LiveReviewFinding[];
  reviewedParts: string[];
  visibilityLimitations: string[];
}) {
  return [
    input.assetType || "",
    input.styleTarget || "",
    ...input.transcript.map((message) => message.text),
    ...input.reviewedParts,
    ...input.visibilityLimitations,
    ...input.findings.flatMap((finding) => [
      finding.area,
      finding.issue,
      finding.whyItHurtsQuality,
      finding.improvementDirection,
      finding.practicalNextStep,
    ]),
  ]
    .join(" ")
    .trim();
}

export function selectRelevantLearningResources(input: {
  assetType?: string;
  styleTarget?: string | null;
  transcript: ReviewTranscriptItem[];
  findings: LiveReviewFinding[];
  reviewedParts: string[];
  visibilityLimitations: string[];
}) {
  const contextText = buildContextText(input);
  const matchedTopics = collectTopicMatches(contextText);
  const scoredResources = CURATED_LEARNING_RESOURCES.map((resource) => {
    let score = 0;

    for (const topic of resource.topics) {
      if (matchedTopics.has(topic)) {
        score += 2;
      }
    }

    if (resource.topics.includes("materials")) {
      score += 1;
    }

    return {
      resource,
      score,
    };
  }).sort((left, right) => right.score - left.score);

  const selectedResources: CuratedLearningResource[] = [];
  const selectedIds = new Set<string>();

  function pushFirstMatching(format: CuratedLearningResource["format"]) {
    const match = scoredResources.find(
      ({ resource, score }) =>
        resource.format === format &&
        score > 0 &&
        !selectedIds.has(resource.id),
    );

    if (!match) {
      return;
    }

    selectedResources.push(match.resource);
    selectedIds.add(match.resource.id);
  }

  pushFirstMatching("text");
  pushFirstMatching("video");

  for (const { resource, score } of scoredResources) {
    if (selectedResources.length >= 5) {
      break;
    }

    if (selectedIds.has(resource.id)) {
      continue;
    }

    if (score <= 0 && selectedResources.length >= 3) {
      continue;
    }

    selectedResources.push(resource);
    selectedIds.add(resource.id);
  }

  if (selectedResources.length === 0) {
    return CURATED_LEARNING_RESOURCES.slice(0, 3);
  }

  return selectedResources;
}
