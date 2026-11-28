CREATE TABLE "indexer"."building_token" (
	"chain_id" integer NOT NULL,
	"token_id" text NOT NULL,
	"owner" text NOT NULL,
	"lot_id" text,
	"developer" text,
	"model_hash" text,
	"floors" smallint,
	"demolished" boolean DEFAULT false NOT NULL,
	"block" bigint NOT NULL,
	CONSTRAINT "building_token_chain_id_token_id_pk" PRIMARY KEY("chain_id","token_id")
);
--> statement-breakpoint
CREATE TABLE "indexer"."unit_token" (
	"chain_id" integer NOT NULL,
	"token_id" text NOT NULL,
	"owner" text NOT NULL,
	"building_id" text,
	"unit_key" text,
	"developer" text,
	"floor" smallint,
	"area_m2x100" integer,
	"code" text,
	"rent_per_day_wei" text,
	"rent_owner" text,
	"tenant" text,
	"lease_ends_at" bigint,
	"block" bigint NOT NULL,
	CONSTRAINT "unit_token_chain_id_token_id_pk" PRIMARY KEY("chain_id","token_id")
);
--> statement-breakpoint
CREATE INDEX "building_token_owner_idx" ON "indexer"."building_token" USING btree ("chain_id","owner");--> statement-breakpoint
CREATE INDEX "unit_token_owner_idx" ON "indexer"."unit_token" USING btree ("chain_id","owner");--> statement-breakpoint
CREATE INDEX "unit_token_building_idx" ON "indexer"."unit_token" USING btree ("chain_id","building_id");