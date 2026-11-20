CREATE TABLE "indexer"."property_token" (
	"chain_id" integer NOT NULL,
	"token_id" text NOT NULL,
	"owner" text NOT NULL,
	"lot_id" text,
	"type_code" text,
	"level" smallint,
	"block" bigint NOT NULL,
	CONSTRAINT "property_token_chain_id_token_id_pk" PRIMARY KEY("chain_id","token_id")
);
--> statement-breakpoint
CREATE INDEX "property_token_owner_idx" ON "indexer"."property_token" USING btree ("chain_id","owner");