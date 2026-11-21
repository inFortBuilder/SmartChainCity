CREATE TABLE "economy"."fx_conversion" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"direction" text NOT NULL,
	"thaler_cents" numeric(38, 0) NOT NULL,
	"scity_wei" numeric(78, 0) NOT NULL,
	"fee_cents" numeric(38, 0) NOT NULL,
	"thaler_per_scity_micro" numeric(38, 0) NOT NULL,
	"spread_bps" integer NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "fx_conversion_direction_check" CHECK ("economy"."fx_conversion"."direction" in ('scity_to_thaler', 'thaler_to_scity')),
	CONSTRAINT "fx_conversion_status_check" CHECK ("economy"."fx_conversion"."status" in ('created', 'done', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "economy"."fx_rate" (
	"valid_from" timestamp with time zone PRIMARY KEY NOT NULL,
	"thaler_per_scity_micro" numeric(38, 0) NOT NULL,
	"scity_usd" numeric(20, 8) NOT NULL,
	"source" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "fx_conversion_account_idx" ON "economy"."fx_conversion" USING btree ("account_id","created_at");