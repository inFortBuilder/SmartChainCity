CREATE TABLE "indexer"."market_listing" (
	"chain_id" integer NOT NULL,
	"listing_id" text NOT NULL,
	"seller" text NOT NULL,
	"price_wei" text NOT NULL,
	"expires_at" bigint NOT NULL,
	"items" jsonb NOT NULL,
	"status" text NOT NULL,
	"buyer" text,
	"block" bigint NOT NULL,
	CONSTRAINT "market_listing_chain_id_listing_id_pk" PRIMARY KEY("chain_id","listing_id")
);
--> statement-breakpoint
CREATE INDEX "market_listing_status_idx" ON "indexer"."market_listing" USING btree ("chain_id","status");