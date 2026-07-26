// Selects the v2 trading card (see CARD-REDESIGN-PLAN.md). Off by default: the new card is built
// ALONGSIDE the legacy .tcg-* card so the old one is always one env var away during the migration.
// NEXT_PUBLIC_ so the choice is available in client components without prop-drilling.
export const NEW_CARD_ENABLED = process.env.NEXT_PUBLIC_NEW_CARD === "1";
