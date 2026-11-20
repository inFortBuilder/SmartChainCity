CREATE TABLE "world"."property" (
	"id" uuid PRIMARY KEY NOT NULL,
	"city" text NOT NULL,
	"lot_id" integer NOT NULL,
	"owner_account_id" uuid NOT NULL,
	"type" text NOT NULL,
	"level" smallint NOT NULL,
	"status" text NOT NULL,
	"price_cents" numeric(20, 0) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"ready_at" timestamp with time zone NOT NULL,
	"wear_base" real NOT NULL,
	"wear_since" timestamp with time zone NOT NULL,
	"last_claim_at" timestamp with time zone NOT NULL,
	CONSTRAINT "property_status_check" CHECK ("world"."property"."status" in ('pending', 'active'))
);
--> statement-breakpoint
CREATE TABLE "world"."property_claim" (
	"id" uuid PRIMARY KEY NOT NULL,
	"property_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"amount_cents" numeric(20, 0) NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "property_claim_status_check" CHECK ("world"."property_claim"."status" in ('pending', 'paid'))
);
--> statement-breakpoint
ALTER TABLE "world"."property_claim" ADD CONSTRAINT "property_claim_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "world"."property"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "property_lot_idx" ON "world"."property" USING btree ("city","lot_id");--> statement-breakpoint
CREATE INDEX "property_owner_idx" ON "world"."property" USING btree ("owner_account_id");--> statement-breakpoint
CREATE INDEX "property_pending_idx" ON "world"."property" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "property_claim_pending_idx" ON "world"."property_claim" USING btree ("status","created_at");