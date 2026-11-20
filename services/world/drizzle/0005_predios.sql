CREATE TABLE "world"."building" (
	"id" uuid PRIMARY KEY NOT NULL,
	"city" text NOT NULL,
	"lot_id" integer NOT NULL,
	"owner_account_id" uuid NOT NULL,
	"job_id" text NOT NULL,
	"model_id" text NOT NULL,
	"model_version" integer NOT NULL,
	"rotation_deg" real NOT NULL,
	"position" jsonb NOT NULL,
	"height_m" real NOT NULL,
	"footprint_m2" integer NOT NULL,
	"floors" integer NOT NULL,
	"gfa_m2" integer NOT NULL,
	"outorga_wei" numeric(78, 0) NOT NULL,
	"checks" jsonb NOT NULL,
	"artifacts" jsonb NOT NULL,
	"status" text NOT NULL,
	"review_note" text,
	"created_at" timestamp with time zone NOT NULL,
	"reviewed_at" timestamp with time zone,
	CONSTRAINT "building_status_check" CHECK ("world"."building"."status" in ('pending_payment', 'pending_review', 'approved', 'rejected'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "building_lot_active_idx" ON "world"."building" USING btree ("city","lot_id") WHERE status <> 'rejected';--> statement-breakpoint
CREATE INDEX "building_owner_idx" ON "world"."building" USING btree ("owner_account_id");--> statement-breakpoint
CREATE INDEX "building_status_idx" ON "world"."building" USING btree ("status","created_at");