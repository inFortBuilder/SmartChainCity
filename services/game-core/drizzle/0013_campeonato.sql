CREATE TABLE "game"."championship" (
	"id" text PRIMARY KEY NOT NULL,
	"seed" text NOT NULL,
	"seed_commit" text NOT NULL,
	"status" text NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"settled_at" timestamp with time zone,
	"result" jsonb,
	CONSTRAINT "championship_status_check" CHECK ("game"."championship"."status" in ('open', 'settled'))
);
--> statement-breakpoint
CREATE TABLE "game"."championship_member" (
	"championship_id" text NOT NULL,
	"team_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"avatar_id" uuid NOT NULL,
	"fee_cents" numeric(38, 0) NOT NULL,
	"status" text NOT NULL,
	"joined_at" timestamp with time zone NOT NULL,
	CONSTRAINT "championship_member_status_check" CHECK ("game"."championship_member"."status" in ('pending', 'paid'))
);
--> statement-breakpoint
CREATE TABLE "game"."championship_team" (
	"id" uuid PRIMARY KEY NOT NULL,
	"championship_id" text NOT NULL,
	"name" text NOT NULL,
	"captain_account_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "game"."championship_member" ADD CONSTRAINT "championship_member_championship_id_championship_id_fk" FOREIGN KEY ("championship_id") REFERENCES "game"."championship"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game"."championship_member" ADD CONSTRAINT "championship_member_team_id_championship_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "game"."championship_team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game"."championship_team" ADD CONSTRAINT "championship_team_championship_id_championship_id_fk" FOREIGN KEY ("championship_id") REFERENCES "game"."championship"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "championship_due_idx" ON "game"."championship" USING btree ("status","ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "championship_member_account_unique" ON "game"."championship_member" USING btree ("championship_id","account_id");--> statement-breakpoint
CREATE INDEX "championship_member_team_idx" ON "game"."championship_member" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "championship_member_pending_idx" ON "game"."championship_member" USING btree ("status","joined_at");--> statement-breakpoint
CREATE UNIQUE INDEX "championship_team_name_unique" ON "game"."championship_team" USING btree ("championship_id",lower("name"));