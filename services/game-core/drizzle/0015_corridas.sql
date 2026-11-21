CREATE TABLE "game"."vehicle_race" (
	"id" uuid PRIMARY KEY NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"avatar_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"day" text NOT NULL,
	"seed" text NOT NULL,
	"result" jsonb NOT NULL,
	"fuel_cents" numeric(38, 0) NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "vehicle_race_status_check" CHECK ("game"."vehicle_race"."status" in ('pending', 'charged', 'done', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "game"."vehicle" ADD COLUMN "breakdown" text;--> statement-breakpoint
ALTER TABLE "game"."vehicle" ADD COLUMN "broken_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "game"."vehicle" ADD COLUMN "repair_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "game"."vehicle" ADD COLUMN "revision_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "game"."vehicle_race" ADD CONSTRAINT "vehicle_race_vehicle_id_vehicle_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "game"."vehicle"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vehicle_race_avatar_day_idx" ON "game"."vehicle_race" USING btree ("avatar_id","day");--> statement-breakpoint
CREATE INDEX "vehicle_race_account_idx" ON "game"."vehicle_race" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "vehicle_race_stuck_idx" ON "game"."vehicle_race" USING btree ("status","created_at");