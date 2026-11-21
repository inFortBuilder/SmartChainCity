CREATE TABLE "indexer"."market_auction" (
	"chain_id" integer NOT NULL,
	"auction_id" text NOT NULL,
	"seller" text NOT NULL,
	"start_price_wei" text NOT NULL,
	"ends_at" bigint NOT NULL,
	"items" jsonb NOT NULL,
	"status" text NOT NULL,
	"highest_bid_wei" text,
	"highest_bidder" text,
	"bids" integer NOT NULL,
	"winner" text,
	"block" bigint NOT NULL,
	CONSTRAINT "market_auction_chain_id_auction_id_pk" PRIMARY KEY("chain_id","auction_id")
);
--> statement-breakpoint
CREATE INDEX "market_auction_status_idx" ON "indexer"."market_auction" USING btree ("chain_id","status");