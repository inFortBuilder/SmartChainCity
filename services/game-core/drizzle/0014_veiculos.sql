CREATE TABLE "game"."vehicle" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"model" text NOT NULL,
	"kind" text NOT NULL,
	"paid_cents" numeric(38, 0) NOT NULL,
	"bought_at" timestamp with time zone NOT NULL,
	"rental_until" timestamp with time zone,
	"ipva_paid_until" timestamp with time zone,
	"status" text NOT NULL,
	"sold_at" timestamp with time zone,
	CONSTRAINT "vehicle_kind_check" CHECK ("game"."vehicle"."kind" in ('owned', 'rental')),
	CONSTRAINT "vehicle_status_check" CHECK ("game"."vehicle"."status" in ('pending', 'active', 'sold'))
);
--> statement-breakpoint
ALTER TABLE "game"."avatar" ADD COLUMN "license" jsonb;--> statement-breakpoint
CREATE INDEX "vehicle_account_idx" ON "game"."vehicle" USING btree ("account_id","bought_at");--> statement-breakpoint
CREATE INDEX "vehicle_pending_idx" ON "game"."vehicle" USING btree ("status","bought_at");