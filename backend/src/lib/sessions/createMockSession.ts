import { randomUUID } from "crypto";
import { LIVE_MODEL } from "../../config/env";

export type ReviewSession = {
  id: string;
  status: "created";
  liveModel: string;
};

// This helper keeps session creation logic in one place so it is easy to swap
// the mock response for real Gemini Live session setup later.
export function createMockReviewSession(): ReviewSession {
  return {
    id: `session-${randomUUID()}`,
    status: "created",
    liveModel: LIVE_MODEL,
  };
}
