CREATE TABLE "game"."work_shift" (
	"id" uuid PRIMARY KEY NOT NULL,
	"avatar_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"job_code" text NOT NULL,
	"shift_hours" smallint NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"seed_commit" text NOT NULL,
	"seed" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"result" jsonb,
	"thaler_earned" numeric(38, 0),
	"status" text NOT NULL,
	CONSTRAINT "work_shift_hours_check" CHECK ("game"."work_shift"."shift_hours" in (6, 12)),
	CONSTRAINT "work_shift_status_check" CHECK ("game"."work_shift"."status" in ('running', 'done', 'claimed'))
);
--> statement-breakpoint
ALTER TABLE "game"."work_shift" ADD CONSTRAINT "work_shift_avatar_id_avatar_id_fk" FOREIGN KEY ("avatar_id") REFERENCES "game"."avatar"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_shift_avatar_idx" ON "game"."work_shift" USING btree ("avatar_id","starts_at");--> statement-breakpoint
CREATE INDEX "work_shift_due_idx" ON "game"."work_shift" USING btree ("status","ends_at");