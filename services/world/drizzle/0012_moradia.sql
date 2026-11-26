ALTER TABLE "world"."property_work" DROP CONSTRAINT "property_work_kind_check";--> statement-breakpoint
ALTER TABLE "world"."property" ADD COLUMN "regularized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "world"."property" ADD COLUMN "water_from" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "world"."property" ADD COLUMN "water_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "world"."property" ADD COLUMN "power_from" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "world"."property" ADD COLUMN "power_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "world"."property_work" ADD CONSTRAINT "property_work_kind_check" CHECK ("world"."property_work"."kind" in ('repair', 'upgrade', 'regularize', 'water', 'power'));