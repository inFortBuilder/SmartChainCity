CREATE TABLE "world"."sale" (
	"city" text PRIMARY KEY NOT NULL,
	"opens_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"pre_queue_seconds" integer NOT NULL,
	"batch_size" integer NOT NULL,
	"batch_seconds" integer NOT NULL,
	"window_seconds" integer NOT NULL,
	"max_lots" integer NOT NULL,
	"require_wallet" boolean NOT NULL,
	CONSTRAINT "sale_window_check" CHECK ("world"."sale"."ends_at" > "world"."sale"."opens_at" and "world"."sale"."batch_size" > 0 and "world"."sale"."max_lots" > 0)
);
--> statement-breakpoint
CREATE TABLE "world"."sale_ticket" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"city" text NOT NULL,
	"account_id" uuid NOT NULL,
	"joined_at" timestamp with time zone NOT NULL,
	"pre_open" boolean NOT NULL,
	"lottery" double precision NOT NULL
);
--> statement-breakpoint
ALTER TABLE "world"."sale" ADD CONSTRAINT "sale_city_city_code_fk" FOREIGN KEY ("city") REFERENCES "world"."city"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sale_ticket_account_idx" ON "world"."sale_ticket" USING btree ("city","account_id","id");--> statement-breakpoint
CREATE INDEX "sale_ticket_rank_idx" ON "world"."sale_ticket" USING btree ("city","pre_open","lottery");