CREATE SCHEMA "game";
--> statement-breakpoint
CREATE TABLE "game"."avatar" (
	"id" uuid PRIMARY KEY NOT NULL,
	"token_id" numeric(78, 0),
	"account_id" uuid NOT NULL,
	"rarity" text NOT NULL,
	"job_code" text NOT NULL,
	"energy" smallint NOT NULL,
	"health" smallint NOT NULL,
	"happiness" smallint NOT NULL,
	"food" smallint NOT NULL,
	"hygiene" smallint NOT NULL,
	"education" smallint NOT NULL,
	"food_at" timestamp with time zone NOT NULL,
	"happiness_at" timestamp with time zone NOT NULL,
	"hygiene_at" timestamp with time zone NOT NULL,
	"employment_status" text DEFAULT 'employed' NOT NULL,
	"last_worked_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "avatar_token_id_unique" UNIQUE("token_id"),
	CONSTRAINT "avatar_rarity_check" CHECK ("game"."avatar"."rarity" in ('common', 'rare', 'epic', 'legendary')),
	CONSTRAINT "avatar_energy_check" CHECK ("game"."avatar"."energy" between 0 and 10),
	CONSTRAINT "avatar_health_check" CHECK ("game"."avatar"."health" between 0 and 10),
	CONSTRAINT "avatar_happiness_check" CHECK ("game"."avatar"."happiness" between 0 and 10),
	CONSTRAINT "avatar_food_check" CHECK ("game"."avatar"."food" between 0 and 10),
	CONSTRAINT "avatar_hygiene_check" CHECK ("game"."avatar"."hygiene" between 0 and 10),
	CONSTRAINT "avatar_education_check" CHECK ("game"."avatar"."education" between 0 and 100)
);
--> statement-breakpoint
CREATE INDEX "avatar_account_idx" ON "game"."avatar" USING btree ("account_id");