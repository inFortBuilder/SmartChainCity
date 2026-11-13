CREATE SCHEMA "world";
--> statement-breakpoint
CREATE TABLE "world"."city" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"zones" jsonb NOT NULL,
	"open_count" integer NOT NULL,
	"district_count" integer NOT NULL,
	"release_threshold" real NOT NULL
);
--> statement-breakpoint
CREATE TABLE "world"."lot" (
	"city" text NOT NULL,
	"id" integer NOT NULL,
	"district" smallint NOT NULL,
	"zone" text NOT NULL,
	"area_m2" double precision NOT NULL,
	"status" text NOT NULL,
	"owner_account_id" uuid,
	"reserved_by" uuid,
	"reserved_until" timestamp with time zone,
	"reservation_id" uuid,
	"sold_at" timestamp with time zone,
	CONSTRAINT "lot_city_id_pk" PRIMARY KEY("city","id"),
	CONSTRAINT "lot_status_check" CHECK ("world"."lot"."status" in ('vacant', 'reserved', 'sold', 'civic')),
	CONSTRAINT "lot_owner_check" CHECK (("world"."lot"."status" = 'sold') = ("world"."lot"."owner_account_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "world"."purchase" (
	"id" uuid PRIMARY KEY NOT NULL,
	"city" text NOT NULL,
	"lot_id" integer NOT NULL,
	"account_id" uuid NOT NULL,
	"price_wei" numeric(78, 0) NOT NULL,
	"price_usd" double precision NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "purchase_status_check" CHECK ("world"."purchase"."status" in ('pending', 'paid', 'failed', 'refunded'))
);
--> statement-breakpoint
ALTER TABLE "world"."lot" ADD CONSTRAINT "lot_city_city_code_fk" FOREIGN KEY ("city") REFERENCES "world"."city"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lot_district_idx" ON "world"."lot" USING btree ("city","district");--> statement-breakpoint
CREATE INDEX "lot_owner_idx" ON "world"."lot" USING btree ("owner_account_id");--> statement-breakpoint
CREATE INDEX "purchase_pending_idx" ON "world"."purchase" USING btree ("status","created_at");