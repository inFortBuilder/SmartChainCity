CREATE TABLE "world"."auction" (
	"id" uuid PRIMARY KEY NOT NULL,
	"city" text NOT NULL,
	"lot_id" integer NOT NULL,
	"seller_account_id" uuid NOT NULL,
	"debt_cents" numeric(20, 0) NOT NULL,
	"bill_ids" jsonb NOT NULL,
	"status" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"winner_account_id" uuid,
	"price_cents" numeric(20, 0),
	"closed_at" timestamp with time zone,
	CONSTRAINT "auction_status_check" CHECK ("world"."auction"."status" in ('open', 'charged', 'settled', 'cancelled', 'unsold'))
);
--> statement-breakpoint
CREATE TABLE "world"."auction_bid" (
	"id" uuid PRIMARY KEY NOT NULL,
	"auction_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"amount_cents" numeric(20, 0) NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "world"."auction_bid" ADD CONSTRAINT "auction_bid_auction_id_auction_id_fk" FOREIGN KEY ("auction_id") REFERENCES "world"."auction"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auction_one_active_idx" ON "world"."auction" USING btree ("city","lot_id") WHERE status in ('open', 'charged');--> statement-breakpoint
CREATE INDEX "auction_status_idx" ON "world"."auction" USING btree ("status","ends_at");--> statement-breakpoint
CREATE INDEX "auction_bid_auction_idx" ON "world"."auction_bid" USING btree ("auction_id","amount_cents");