ALTER TABLE "game"."avatar" ADD COLUMN "health_drain_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "game"."avatar" ADD COLUMN "health_zero_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "avatar_health_drain_idx" ON "game"."avatar" USING btree ("health_drain_at") WHERE health_drain_at is not null;--> statement-breakpoint
CREATE INDEX "avatar_health_zero_idx" ON "game"."avatar" USING btree ("health_zero_at") WHERE health_zero_at is not null;--> statement-breakpoint
-- Avatares que já tinham doença grave: entram na fila do job da queda uma vez, e ele recalcula as marcas.
UPDATE "game"."avatar" SET "health_drain_at" = now()
WHERE jsonb_path_exists("conditions", '$[*] ? (@.code == "febre" || @.code == "enxaqueca" || @.code == "virose")');
