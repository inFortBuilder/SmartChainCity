CREATE TABLE "game"."game_pass" (
	"account_id" uuid NOT NULL,
	"season" text NOT NULL,
	"level" smallint NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "game_pass_level_check" CHECK ("game"."game_pass"."level" between 1 and 5)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "game_pass_account_season_unique" ON "game"."game_pass" USING btree ("account_id","season");