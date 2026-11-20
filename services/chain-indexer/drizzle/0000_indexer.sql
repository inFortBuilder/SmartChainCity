CREATE SCHEMA "indexer";
--> statement-breakpoint
CREATE TABLE "indexer"."avatar_token" (
	"chain_id" integer NOT NULL,
	"token_id" text NOT NULL,
	"owner" text NOT NULL,
	"rarity" smallint,
	"profession" text,
	"block" bigint NOT NULL,
	CONSTRAINT "avatar_token_chain_id_token_id_pk" PRIMARY KEY("chain_id","token_id")
);
--> statement-breakpoint
CREATE TABLE "indexer"."box_request" (
	"chain_id" integer NOT NULL,
	"request_id" text NOT NULL,
	"buyer" text NOT NULL,
	"tier_id" integer NOT NULL,
	"status" text NOT NULL,
	"token_id" text,
	"block" bigint NOT NULL,
	CONSTRAINT "box_request_chain_id_request_id_pk" PRIMARY KEY("chain_id","request_id")
);
--> statement-breakpoint
CREATE TABLE "indexer"."chain_event" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"block_hash" text NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"contract" text NOT NULL,
	"event" text NOT NULL,
	"args" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "indexer"."cursor" (
	"chain_id" integer PRIMARY KEY NOT NULL,
	"block" bigint NOT NULL,
	"hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "indexer"."lot_token" (
	"chain_id" integer NOT NULL,
	"token_id" text NOT NULL,
	"city" integer NOT NULL,
	"lot" integer NOT NULL,
	"owner" text NOT NULL,
	"block" bigint NOT NULL,
	CONSTRAINT "lot_token_chain_id_token_id_pk" PRIMARY KEY("chain_id","token_id")
);
--> statement-breakpoint
CREATE INDEX "avatar_token_owner_idx" ON "indexer"."avatar_token" USING btree ("chain_id","owner");--> statement-breakpoint
CREATE UNIQUE INDEX "chain_event_log_idx" ON "indexer"."chain_event" USING btree ("chain_id","tx_hash","log_index");--> statement-breakpoint
CREATE INDEX "chain_event_block_idx" ON "indexer"."chain_event" USING btree ("chain_id","block_number","log_index");--> statement-breakpoint
CREATE INDEX "lot_token_owner_idx" ON "indexer"."lot_token" USING btree ("chain_id","owner");