CREATE TABLE "economy"."withdrawal" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"wallet" text NOT NULL,
	"amount_wei" numeric(78, 0) NOT NULL,
	"nonce" numeric(78, 0) NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"signature" text,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "withdrawal_nonce_unique" UNIQUE("nonce"),
	CONSTRAINT "withdrawal_status_check" CHECK ("economy"."withdrawal"."status" in ('created', 'pending', 'claimed', 'refunded', 'failed'))
);
--> statement-breakpoint
CREATE INDEX "withdrawal_account_idx" ON "economy"."withdrawal" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "withdrawal_open_idx" ON "economy"."withdrawal" USING btree ("status","created_at");