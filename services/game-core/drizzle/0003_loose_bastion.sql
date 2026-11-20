CREATE TABLE "game"."hospital_stay" (
	"id" uuid PRIMARY KEY NOT NULL,
	"avatar_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"fee_cents" numeric(38, 0) NOT NULL,
	"fee_status" text NOT NULL,
	"admitted_at" timestamp with time zone NOT NULL,
	"discharge_at" timestamp with time zone NOT NULL,
	CONSTRAINT "hospital_stay_reason_check" CHECK ("game"."hospital_stay"."reason" in ('health', 'energy')),
	CONSTRAINT "hospital_stay_fee_status_check" CHECK ("game"."hospital_stay"."fee_status" in ('pending', 'paid', 'waived')),
	CONSTRAINT "hospital_stay_fee_check" CHECK ("game"."hospital_stay"."fee_cents" > 0),
	CONSTRAINT "hospital_stay_period_check" CHECK ("game"."hospital_stay"."discharge_at" > "game"."hospital_stay"."admitted_at")
);
--> statement-breakpoint
ALTER TABLE "game"."avatar" ADD COLUMN "hospital_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "game"."hospital_stay" ADD CONSTRAINT "hospital_stay_avatar_id_avatar_id_fk" FOREIGN KEY ("avatar_id") REFERENCES "game"."avatar"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hospital_stay_avatar_idx" ON "game"."hospital_stay" USING btree ("avatar_id","admitted_at");--> statement-breakpoint
CREATE INDEX "hospital_stay_fee_idx" ON "game"."hospital_stay" USING btree ("fee_status","admitted_at");