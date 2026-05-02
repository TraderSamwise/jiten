# Premium Entitlements Plan

## Goal

Add real premium monthly subscription support across iOS, Android, and web while keeping entitlement enforcement centralized and backend-authoritative.

The immediate product requirement is:

- paid-feature APIs already have a server-side entitlement seam
- all users are temporarily allowed while billing is not wired
- once billing is wired, premium access should come from either a real subscription or an explicit admin grant
- admin grants must let the owner, beta testers, reviewers, support users, or trusted users receive premium without paying

Jiten should never require the owner to purchase premium from the app stores just to use or test premium behavior.

## Non-goals

This plan does not cover:

- deciding final pricing
- designing the final paywall UI
- building full admin dashboards
- adding complicated promotional-code infrastructure
- replacing the existing AI quota system
- making the client the source of truth for premium access

## Recommended Provider

Use RevenueCat as the subscription and entitlement aggregation layer.

RevenueCat should unify:

- Apple App Store subscriptions
- Google Play subscriptions
- web checkout subscriptions, likely via RevenueCat Web Billing or Stripe integration
- normalized customer entitlement state

The app and API should reason about a single product-level entitlement, not platform-specific receipt formats.

Target entitlement:

- `jiten_plus`

Target package/offering:

- one monthly subscription to start
- annual can be added later without changing the entitlement contract

## Entitlement Sources

Premium access should resolve from multiple sources with explicit precedence.

```ts
type EntitlementSource = "admin_grant" | "store_subscription" | "dev_override";

type EntitlementResult = {
  active: boolean;
  source?: EntitlementSource;
  entitlement: "jiten_plus";
  expiresAt?: string | null;
  reason?: string;
};
```

Resolution order:

1. `admin_grant`
2. `store_subscription`
3. `dev_override`
4. denied

Admin grants must win over store subscription state. If a user has an active manual grant, they should keep premium even if they never purchased through Apple, Google, or web checkout.

`dev_override` should be limited to local/development behavior and must not accidentally create production access.

## Admin Grants

Admin grants are discretionary server-side records. They are for:

- the owner
- beta testers
- internal testing accounts
- App Review or Play review support if needed
- support cases
- trusted friends or early users

Admin grants should be stored in the server database, not only in Clerk public metadata and not only on the client.

Suggested table:

```sql
CREATE TABLE premium_entitlement_grants (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  entitlement TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'admin_grant',
  reason TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT
);

CREATE INDEX premium_entitlement_grants_user_idx
  ON premium_entitlement_grants (user_id, entitlement, revoked_at, expires_at);
```

Rules:

- `user_id` should be the Clerk user ID.
- `entitlement` should initially be `jiten_plus`.
- `expires_at` may be null for permanent grants.
- `revoked_at` disables the grant without deleting audit history.
- `reason` should be a short internal note, not shown in UI.
- `created_by` can be the owner/admin Clerk user ID or `"system"` for scripted bootstraps.

Initial admin tooling can be simple:

- script: `yarn premium:grant --email person@example.com --reason beta`
- script: `yarn premium:revoke --email person@example.com`
- script: `yarn premium:list --email person@example.com`

A full UI dashboard is unnecessary until operations justify it.

## Backend Enforcement

The backend must be the source of truth for premium-gated API access.

Current seam:

- `api/_shared/entitlements.ts`
- `assertFeatureAccess(userId, feature)`

Target behavior:

```ts
export async function getFeatureAccess(
  userId: string,
  feature: PremiumFeature,
): Promise<FeatureAccess> {
  const entitlement = await getPremiumEntitlement(userId);

  if (!entitlement.active) {
    return {
      allowed: false,
      reason: "Feature requires an active subscription",
    };
  }

  return { allowed: true };
}
```

`getPremiumEntitlement(userId)` should:

1. Check active admin grants from the server DB.
2. Check RevenueCat customer entitlement state.
3. Apply local/dev override only when explicitly enabled outside production.
4. Return inactive if none apply.

Do not trust client-provided premium state for API access.

## Client Entitlement State

The client still needs entitlement state for UI:

- show paid actions
- show paywall prompts
- avoid calling premium endpoints when obviously unavailable
- show subscription management affordances

But this state is advisory. The backend remains authoritative.

Client target:

```ts
type PremiumState = {
  loading: boolean;
  active: boolean;
  source?: EntitlementSource;
  canManageSubscription: boolean;
  refresh: () => Promise<void>;
};
```

Native app:

- initialize RevenueCat with Clerk user ID as the app user ID
- fetch `CustomerInfo`
- consider `customerInfo.entitlements.active.jiten_plus` active
- expose purchase/restore flows through a small app-owned premium provider

Web:

- use the same app-level `PremiumState` shape
- use web checkout/session flow instead of native purchase UI
- refresh server-side entitlement after checkout completes

The UI should not care whether premium came from App Store, Play Store, web checkout, or admin grant.

## Feature Gating

Premium features should map to the product entitlement, not to independent subscriptions.

Current premium feature names:

- `reader_sentence_explain`
- `word_example_sentences`

Target mapping:

```ts
const PREMIUM_FEATURE_ENTITLEMENTS = {
  reader_sentence_explain: "jiten_plus",
  word_example_sentences: "jiten_plus",
} as const;
```

New AI endpoints should reuse the same entitlement check and the same quota infrastructure.

The current daily AI quota remains separate from entitlement:

- entitlement answers: can this user use premium AI features at all?
- quota answers: has this user used too much today?

Order:

1. authenticate user
2. assert premium feature access
3. consume quota
4. execute paid operation

## Paywall Behavior

For now:

- backend has a real entitlement seam
- all users may still be allowed until billing is cut over
- UI can be wired later, but should be designed around the shared `PremiumState`

Final behavior:

- premium actions remain visible as acquisition funnels
- unauthenticated users should be prompted to sign in
- signed-in non-premium users should see the paywall
- admin-granted users should simply see premium as active
- quota-exceeded users should see the quota reset message, not the paywall

Important distinction:

- no entitlement: paywall/sign-in problem
- quota exceeded: usage limit problem
- model/API failure: operational error

These should be separate error codes and separate UI states.

## Environment Variables

Server:

- `REVENUECAT_SECRET_API_KEY`
- `REVENUECAT_PROJECT_ID` if needed by the API shape
- `PREMIUM_ENTITLEMENT_ID=jiten_plus`
- `AI_DAILY_QUOTA`

Client:

- `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY`
- `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY`
- web checkout config if/when web billing is wired

Development-only:

- `DEV_PREMIUM_USER_IDS`
- or `DEV_PREMIUM_ALL=true`

Development overrides must be ignored in production unless intentionally added as an explicit production admin grant.

## Caching

Entitlement checks should be correct first, then optimized.

Initial implementation can query live sources directly because current premium endpoint volume is low.

Later optimization:

- cache RevenueCat entitlement results for a short TTL, for example 1-5 minutes
- never cache admin revocations so long that support cannot fix access quickly
- invalidate or refresh on RevenueCat webhooks
- mirror coarse entitlement state into Clerk private metadata only as a cache, not as the source of truth

Admin grants should be cheap to query from the server DB and can remain direct.

## Data Model Ownership

Admin grants belong in the server database because they are product-owned state.

RevenueCat remains the source of truth for paid store/web subscription state.

Clerk remains the source of truth for user identity.

The local app database should not store authoritative premium state.

## Webhooks

RevenueCat webhooks are optional for the first cut if API checks query RevenueCat directly.

They become useful when:

- caching entitlement state
- showing account subscription metadata
- sending lifecycle emails
- debugging billing issues
- handling entitlement changes quickly after renewals/cancellations

Webhook handling should update a cache/mirror, not replace RevenueCat as the subscription authority.

## Migration Plan

This should ship as one complete cutover when implemented. Intermediate commits are fine, but the final merged state should not leave dead entitlement paths.

### Phase 1: Formalize Types and Mapping

- Add shared entitlement types.
- Map premium features to `jiten_plus`.
- Keep the existing `assertFeatureAccess` call sites.
- Add tests for allowed/denied feature mapping.

### Phase 2: Add Admin Grants

- Add `premium_entitlement_grants` table and migrations.
- Add grant/revoke/list scripts.
- Implement admin grant lookup by Clerk `userId`.
- Add tests for permanent, expiring, expired, and revoked grants.

### Phase 3: Add RevenueCat Server Verification

- Add RevenueCat server client.
- Implement customer lookup by Clerk user ID.
- Check `jiten_plus` entitlement.
- Add timeout and clear operational errors.
- Add tests with mocked RevenueCat responses.

### Phase 4: Replace Fake Entitlement Allowance

- Change `getFeatureAccess` from "allow everyone" to the real resolver.
- Keep an explicit development override for local work only.
- Verify AI endpoints return subscription-required errors for non-premium users.
- Verify admin-granted users pass without a store subscription.

### Phase 5: Add Client Premium Provider

- Add app-level premium provider/hook.
- On native, configure RevenueCat with Clerk user ID.
- On web, expose the same hook shape and route to web checkout when ready.
- Surface active entitlement state in settings/account UI.

### Phase 6: Add Paywall Entry Points

- Keep premium actions visible.
- If unauthenticated, prompt sign-in.
- If signed in but not premium, show paywall.
- If premium but quota-limited, show quota reset message.
- Do not hide paid features completely.

### Phase 7: Add Subscription Management

- Native: restore purchases and manage subscription links.
- Web: billing portal or RevenueCat web customer management.
- Admin-granted users should show a clear internal/support state if needed, but no purchase management requirement.

### Phase 8: Production Hardening

- Add logging around entitlement source and denial reason.
- Add basic observability for RevenueCat failures.
- Add short TTL caching if latency becomes noticeable.
- Add webhook mirror if needed.
- Add runbook for granting/revoking beta access.

## Testing Requirements

Backend tests:

- unauthenticated request is rejected before entitlement
- signed-in non-premium user gets subscription-required response
- active admin grant allows access
- expired admin grant denies access
- revoked admin grant denies access
- active RevenueCat entitlement allows access
- inactive RevenueCat entitlement denies access
- admin grant wins even if RevenueCat is inactive
- quota still applies after entitlement passes

Client tests:

- premium state loading
- admin-granted active state from backend/profile mirror if exposed
- purchase unavailable/error state
- quota-exceeded message does not show paywall
- premium-required message routes to paywall/sign-in

Manual test matrix:

- iOS subscribed user
- Android subscribed user
- web subscribed user
- admin-granted user with no subscription
- non-premium signed-in user
- signed-out user
- quota-exceeded premium user

## Operational Notes

Owner account should receive a permanent admin grant before entitlement enforcement is enabled.

Beta testers should receive either:

- permanent grants if trusted/internal
- expiring grants if temporary

Do not rely on store sandbox subscriptions for owner access. They are useful for purchase-flow testing, not for day-to-day product access.

Do not create a second "free premium" client path. Free premium is just `admin_grant` as an entitlement source.

## Open Decisions

- RevenueCat web billing vs direct Stripe plus RevenueCat import/mirror.
- Exact monthly price.
- Whether annual subscription launches at the same time.
- Whether admin grants are managed only by scripts or eventually by a small internal UI.
- Whether premium entitlement state should be mirrored into Clerk private metadata for faster UI boot.
