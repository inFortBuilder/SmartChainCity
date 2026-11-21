CREATE TABLE "world"."chain_cursor" (
	"name" text PRIMARY KEY NOT NULL,
	"after" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "world"."chain_transfer_pending" (
	"event_id" integer PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"token_id" text NOT NULL,
	"to_address" text NOT NULL,
	CONSTRAINT "chain_transfer_pending_kind_check" CHECK ("world"."chain_transfer_pending"."kind" in ('lot', 'property'))
);
--> statement-breakpoint
CREATE INDEX "chain_transfer_pending_token_idx" ON "world"."chain_transfer_pending" USING btree ("kind","token_id");