CREATE TABLE "world"."building_unit" (
	"id" uuid PRIMARY KEY NOT NULL,
	"building_id" uuid NOT NULL,
	"city" text NOT NULL,
	"lot_id" integer NOT NULL,
	"builder_account_id" uuid NOT NULL,
	"floor" integer NOT NULL,
	"number" integer NOT NULL,
	"area_m2" real NOT NULL,
	"kind" text NOT NULL,
	"owner_account_id" uuid,
	"price_cents" numeric(20, 0),
	"rent_cents_per_day" numeric(20, 0),
	"pending_sale_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "building_unit_kind_check" CHECK ("world"."building_unit"."kind" in ('residencial', 'comercial'))
);
--> statement-breakpoint
CREATE TABLE "world"."unit_lease" (
	"id" uuid PRIMARY KEY NOT NULL,
	"unit_id" uuid NOT NULL,
	"owner_account_id" uuid NOT NULL,
	"tenant_account_id" uuid NOT NULL,
	"avatar_id" uuid NOT NULL,
	"cents_per_day" numeric(20, 0) NOT NULL,
	"days" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "unit_lease_status_check" CHECK ("world"."unit_lease"."status" in ('pending', 'paid', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "world"."unit_sale" (
	"id" uuid PRIMARY KEY NOT NULL,
	"unit_id" uuid NOT NULL,
	"buyer_account_id" uuid NOT NULL,
	"seller_account_id" uuid NOT NULL,
	"builder_account_id" uuid NOT NULL,
	"primary" boolean NOT NULL,
	"price_cents" numeric(20, 0) NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "unit_sale_status_check" CHECK ("world"."unit_sale"."status" in ('pending', 'paid', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "world"."building_unit" ADD CONSTRAINT "building_unit_building_id_building_id_fk" FOREIGN KEY ("building_id") REFERENCES "world"."building"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world"."unit_lease" ADD CONSTRAINT "unit_lease_unit_id_building_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "world"."building_unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world"."unit_sale" ADD CONSTRAINT "unit_sale_unit_id_building_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "world"."building_unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "building_unit_position_idx" ON "world"."building_unit" USING btree ("building_id","floor","number");--> statement-breakpoint
CREATE INDEX "building_unit_owner_idx" ON "world"."building_unit" USING btree ("owner_account_id");--> statement-breakpoint
CREATE INDEX "building_unit_rent_idx" ON "world"."building_unit" USING btree ("city","rent_cents_per_day");--> statement-breakpoint
CREATE INDEX "unit_lease_unit_idx" ON "world"."unit_lease" USING btree ("unit_id","ends_at");--> statement-breakpoint
CREATE INDEX "unit_lease_tenant_idx" ON "world"."unit_lease" USING btree ("tenant_account_id","ends_at");--> statement-breakpoint
CREATE INDEX "unit_lease_pending_idx" ON "world"."unit_lease" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "unit_sale_pending_idx" ON "world"."unit_sale" USING btree ("status","created_at");