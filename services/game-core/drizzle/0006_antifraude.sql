CREATE TABLE "game"."risk_decision" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"decision" text NOT NULL,
	"note" text,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "risk_decision_check" CHECK ("game"."risk_decision"."decision" in ('allow', 'block'))
);
--> statement-breakpoint
CREATE TABLE "game"."risk_signal" (
	"account_id" uuid NOT NULL,
	"device" text DEFAULT '' NOT NULL,
	"network" text NOT NULL,
	"first_seen" timestamp with time zone NOT NULL,
	"last_seen" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "risk_signal_key_idx" ON "game"."risk_signal" USING btree ("account_id","device","network");--> statement-breakpoint
CREATE INDEX "risk_signal_device_idx" ON "game"."risk_signal" USING btree ("device","last_seen");--> statement-breakpoint
CREATE INDEX "risk_signal_network_idx" ON "game"."risk_signal" USING btree ("network","last_seen");