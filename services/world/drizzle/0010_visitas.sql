CREATE TABLE "world"."place_guest" (
	"kind" text NOT NULL,
	"place_id" uuid NOT NULL,
	"guest_account_id" uuid NOT NULL,
	"invited_by" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "place_guest_kind_place_id_guest_account_id_pk" PRIMARY KEY("kind","place_id","guest_account_id"),
	CONSTRAINT "place_guest_kind_check" CHECK ("world"."place_guest"."kind" in ('property', 'building'))
);
--> statement-breakpoint
CREATE INDEX "place_guest_guest_idx" ON "world"."place_guest" USING btree ("guest_account_id");