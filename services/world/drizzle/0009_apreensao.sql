CREATE TABLE "world"."seizure" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"token_id" text NOT NULL,
	"city" text NOT NULL,
	"lot_id" integer NOT NULL,
	"property_id" uuid,
	"to_account_id" uuid NOT NULL,
	"nonce" numeric(78, 0) NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "seizure_kind_check" CHECK ("world"."seizure"."kind" in ('lot', 'property')),
	CONSTRAINT "seizure_status_check" CHECK ("world"."seizure"."status" in ('open', 'done', 'cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "seizure_open_token_idx" ON "world"."seizure" USING btree ("kind","token_id") WHERE status = 'open';--> statement-breakpoint
CREATE INDEX "seizure_account_idx" ON "world"."seizure" USING btree ("to_account_id","status");