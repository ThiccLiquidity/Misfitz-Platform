// MisFitz Rewards — shadow feature flag. DEFAULT OFF. When off: the dashboard section is not rendered, the read
// APIs 404, and the compute cron early-returns before any work. Server-side env only (NEVER NEXT_PUBLIC_ — that
// would ship the tokenomics preview into the client bundle). Flip to "1"/"true" only after legal sign-off.
export function isRewardsShadowEnabled(): boolean {
  const v = process.env.REWARDS_SHADOW;
  return v === "1" || v === "true";
}
