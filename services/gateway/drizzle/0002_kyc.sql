CREATE TABLE "kyc_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"level" smallint NOT NULL,
	"status" text NOT NULL,
	"provider" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "kyc_request_status_check" CHECK ("kyc_request"."status" in ('pending', 'approved', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "kyc_request" ADD CONSTRAINT "kyc_request_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "kyc_request_pending_unique" ON "kyc_request" USING btree ("account_id") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "kyc_request_status_idx" ON "kyc_request" USING btree ("status","created_at");