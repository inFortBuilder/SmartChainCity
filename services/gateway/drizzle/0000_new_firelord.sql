CREATE TABLE "account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"kyc_level" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "account_status_check" CHECK ("account"."status" in ('active', 'suspended', 'banned'))
);
--> statement-breakpoint
CREATE TABLE "auth_nonce" (
	"nonce" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_link" (
	"account_id" uuid NOT NULL,
	"address" text NOT NULL,
	"chain_id" integer NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	CONSTRAINT "wallet_link_account_id_address_pk" PRIMARY KEY("account_id","address")
);
--> statement-breakpoint
ALTER TABLE "wallet_link" ADD CONSTRAINT "wallet_link_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_email_unique" ON "account" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_link_address_unique" ON "wallet_link" USING btree ("address");