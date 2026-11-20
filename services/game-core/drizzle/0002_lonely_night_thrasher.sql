CREATE TABLE "game"."meal" (
	"id" uuid PRIMARY KEY NOT NULL,
	"avatar_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"food_code" text NOT NULL,
	"price_cents" numeric(38, 0) NOT NULL,
	"effects" jsonb NOT NULL,
	"status" text NOT NULL,
	"client_key" text,
	"created_at" timestamp with time zone NOT NULL,
	"eaten_at" timestamp with time zone,
	CONSTRAINT "meal_status_check" CHECK ("game"."meal"."status" in ('pending', 'eaten', 'failed')),
	CONSTRAINT "meal_price_check" CHECK ("game"."meal"."price_cents" > 0)
);
--> statement-breakpoint
ALTER TABLE "game"."meal" ADD CONSTRAINT "meal_avatar_id_avatar_id_fk" FOREIGN KEY ("avatar_id") REFERENCES "game"."avatar"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meal_avatar_idx" ON "game"."meal" USING btree ("avatar_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "meal_client_key_unique" ON "game"."meal" USING btree ("account_id","client_key");