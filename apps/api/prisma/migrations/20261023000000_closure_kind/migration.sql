-- Season calendar (PRD A-05): planned off-season closures are closures of kind SEASON.
-- Additive: existing rows become EMERGENCY, which is what they were.
CREATE TYPE "ClosureKind" AS ENUM ('EMERGENCY', 'SEASON');
ALTER TABLE "closures" ADD COLUMN "kind" "ClosureKind" NOT NULL DEFAULT 'EMERGENCY';

-- A season always has an end date, and the end comes after the start.
ALTER TABLE "closures" ADD CONSTRAINT chk_season_has_end
  CHECK (kind <> 'SEASON' OR (ends_at IS NOT NULL AND ends_at > starts_at));

CREATE INDEX "closures_kind_starts_at_idx" ON "closures" ("kind", "starts_at");
