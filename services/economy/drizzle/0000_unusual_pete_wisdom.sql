CREATE SCHEMA "economy";
--> statement-breakpoint
CREATE TABLE "economy"."ledger_account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_type" text NOT NULL,
	"owner_id" text NOT NULL,
	"currency" text NOT NULL,
	"balance" numeric(38, 0) DEFAULT '0' NOT NULL,
	CONSTRAINT "ledger_account_owner_unique" UNIQUE("owner_type","owner_id","currency"),
	CONSTRAINT "ledger_account_owner_type_check" CHECK ("economy"."ledger_account"."owner_type" in ('player', 'system', 'pool', 'burn', 'escrow')),
	CONSTRAINT "ledger_account_currency_check" CHECK ("economy"."ledger_account"."currency" in ('THALER', 'SCITY')),
	CONSTRAINT "ledger_account_balance_check" CHECK ("economy"."ledger_account"."owner_type" = 'system' or "economy"."ledger_account"."balance" >= 0)
);
--> statement-breakpoint
CREATE TABLE "economy"."ledger_entry" (
	"tx_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"amount" numeric(38, 0) NOT NULL,
	CONSTRAINT "ledger_entry_tx_id_account_id_pk" PRIMARY KEY("tx_id","account_id"),
	CONSTRAINT "ledger_entry_amount_check" CHECK ("economy"."ledger_entry"."amount" <> 0)
);
--> statement-breakpoint
CREATE TABLE "economy"."ledger_tx" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigserial NOT NULL,
	"kind" text NOT NULL,
	"ref_type" text,
	"ref_id" text,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_tx_seq_unique" UNIQUE("seq"),
	CONSTRAINT "ledger_tx_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "economy"."ledger_entry" ADD CONSTRAINT "ledger_entry_tx_id_ledger_tx_id_fk" FOREIGN KEY ("tx_id") REFERENCES "economy"."ledger_tx"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "economy"."ledger_entry" ADD CONSTRAINT "ledger_entry_account_id_ledger_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "economy"."ledger_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_entry_account_idx" ON "economy"."ledger_entry" USING btree ("account_id");