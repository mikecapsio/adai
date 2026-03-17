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
  assetType?: string;
  styleTarget?: string;
  transcript: ReviewTranscriptItem[];
  reviewedParts: string[];
  visibilityLimitations: string[];
  findings: LiveReviewFinding[];
  resourceCatalog: string[];
};
