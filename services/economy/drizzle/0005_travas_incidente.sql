CREATE TABLE "economy"."incident_switch" (
	"name" text PRIMARY KEY NOT NULL,
	"frozen" boolean NOT NULL,
	"reason" text,
	"changed_by" text,
	"since" timestamp with time zone
);
