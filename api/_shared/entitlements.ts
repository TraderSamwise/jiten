import { ApiError } from "./auth";

export type PremiumFeature = "reader_sentence_explain" | "word_example_sentences";

export interface FeatureAccess {
  allowed: boolean;
  reason?: string;
}

export async function getFeatureAccess(
  _userId: string,
  _feature: PremiumFeature,
): Promise<FeatureAccess> {
  // Billing is intentionally not wired yet. Keep the server-side seam real so
  // paid features can be enforced here later without changing clients.
  return { allowed: true };
}

export async function assertFeatureAccess(userId: string, feature: PremiumFeature): Promise<void> {
  const access = await getFeatureAccess(userId, feature);
  if (!access.allowed) {
    throw new ApiError(402, access.reason ?? "Feature requires an active subscription");
  }
}
