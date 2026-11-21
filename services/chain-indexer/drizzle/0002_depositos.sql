CREATE TABLE "indexer"."deposit" (
	"chain_id" integer NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"account" text NOT NULL,
	"amount_wei" text NOT NULL,
	"block" bigint NOT NULL,
	"status" text NOT NULL,
	"account_id" text,
	CONSTRAINT "deposit_chain_id_tx_hash_log_index_pk" PRIMARY KEY("chain_id","tx_hash","log_index")
);
--> statement-breakpoint
CREATE INDEX "deposit_pending_idx" ON "indexer"."deposit" USING btree ("chain_id","status","block");--> statement-breakpoint
CREATE INDEX "deposit_account_idx" ON "indexer"."deposit" USING btree ("chain_id","account");