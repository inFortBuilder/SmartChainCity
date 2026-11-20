CREATE TABLE "world"."tax_bill" (
	"id" uuid PRIMARY KEY NOT NULL,
	"city" text NOT NULL,
	"lot_id" integer NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"period" integer NOT NULL,
	"amount_cents" numeric(20, 0) NOT NULL,
	"fine_cents" numeric(20, 0) NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "tax_bill_kind_check" CHECK ("world"."tax_bill"."kind" in ('iptu', 'pt')),
	CONSTRAINT "tax_bill_status_check" CHECK ("world"."tax_bill"."status" in ('pending', 'paid'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tax_bill_period_idx" ON "world"."tax_bill" USING btree ("city","lot_id","kind","period");--> statement-breakpoint
CREATE INDEX "tax_bill_account_idx" ON "world"."tax_bill" USING btree ("account_id","due_at");--> statement-breakpoint
CREATE INDEX "tax_bill_pending_idx" ON "world"."tax_bill" USING btree ("status","due_at");