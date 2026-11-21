CREATE TABLE "economy"."fx_tick_sample" (
	"pool" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"tick_cumulative" numeric(38, 0) NOT NULL,
	CONSTRAINT "fx_tick_sample_pool_at_pk" PRIMARY KEY("pool","at")
);
