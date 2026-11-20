CREATE TABLE "world"."property_work" (
	"id" uuid PRIMARY KEY NOT NULL,
	"property_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"cost_cents" numeric(20, 0) NOT NULL,
	"to_level" smallint,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "property_work_kind_check" CHECK ("world"."property_work"."kind" in ('repair', 'upgrade')),
	CONSTRAINT "property_work_status_check" CHECK ("world"."property_work"."status" in ('pending', 'applied', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "world"."property_work" ADD CONSTRAINT "property_work_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "world"."property"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "property_work_one_pending_idx" ON "world"."property_work" USING btree ("property_id") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "property_work_pending_idx" ON "world"."property_work" USING btree ("status","created_at");