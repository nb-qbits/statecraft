ALTER TABLE "resolution_results" ADD COLUMN IF NOT EXISTS "refusal_kind" varchar(64);
ALTER TABLE "resolution_results" ADD COLUMN IF NOT EXISTS "bounded" boolean;
ALTER TABLE "resolution_results" ADD COLUMN IF NOT EXISTS "upper_bound" varchar(10);
