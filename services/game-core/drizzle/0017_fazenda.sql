CREATE TABLE "game"."farm" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"level" smallint NOT NULL,
	"harvests_at_level" integer NOT NULL,
	"harvests_total" integer NOT NULL,
	"state" jsonb NOT NULL,
	"bought_at" timestamp with time zone NOT NULL,
	"version" integer NOT NULL,
	CONSTRAINT "farm_level_check" CHECK ("game"."farm"."level" between 1 and 3)
);
