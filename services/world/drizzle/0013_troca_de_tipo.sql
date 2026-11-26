ALTER TABLE "world"."property_work" DROP CONSTRAINT "property_work_kind_check";--> statement-breakpoint
ALTER TABLE "world"."property_work" ADD COLUMN "to_type" text;--> statement-breakpoint
ALTER TABLE "world"."property_work" ADD CONSTRAINT "property_work_kind_check" CHECK ("world"."property_work"."kind" in ('repair', 'upgrade', 'regularize', 'water', 'power', 'retype'));