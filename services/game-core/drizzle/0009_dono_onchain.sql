CREATE TABLE "game"."chain_avatar_pending" (
	"token_id" text PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"to_address" text NOT NULL,
	"rarity" smallint,
	"job_code" text
);
--> statement-breakpoint
CREATE TABLE "game"."chain_cursor" (
	"name" text PRIMARY KEY NOT NULL,
	"after" integer NOT NULL
);
--> statement-breakpoint
-- Avatares de antes: são da conta desde que foram criados.
ALTER TABLE "game"."avatar" ADD COLUMN "owned_since" timestamp with time zone;--> statement-breakpoint
UPDATE "game"."avatar" SET "owned_since" = "created_at";--> statement-breakpoint
ALTER TABLE "game"."avatar" ALTER COLUMN "owned_since" SET NOT NULL;