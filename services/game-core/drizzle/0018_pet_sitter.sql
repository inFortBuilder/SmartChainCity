CREATE TABLE "game"."pet_sitter_offer" (
	"avatar_id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"price_cents" bigint NOT NULL,
	"open" boolean NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game"."pet_sitting" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sitter_avatar_id" uuid NOT NULL,
	"sitter_account_id" uuid NOT NULL,
	"owner_avatar_id" uuid NOT NULL,
	"owner_account_id" uuid NOT NULL,
	"price_cents" bigint NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	CONSTRAINT "pet_sitting_status_check" CHECK ("game"."pet_sitting"."status" in ('reserved', 'active', 'cancelled'))
);
--> statement-breakpoint
CREATE INDEX "pet_sitting_sitter_idx" ON "game"."pet_sitting" USING btree ("sitter_avatar_id","ends_at");--> statement-breakpoint
CREATE INDEX "pet_sitting_owner_idx" ON "game"."pet_sitting" USING btree ("owner_avatar_id","starts_at");