-- The Add cost dropdown lists only chosen kinds: Embroidery, Ironing, Piping (and any name typed there later).
-- AlterTable
ALTER TABLE "job_cost_categories" ADD COLUMN     "show_in_costs" BOOLEAN NOT NULL DEFAULT false;

INSERT INTO "job_cost_categories" ("name", "default_paid_by", "show_in_costs")
VALUES ('Piping', 'PAID', true), ('Embroidery', 'PAID', true), ('Ironing', 'PAID', true)
ON CONFLICT ("name") DO UPDATE SET "show_in_costs" = true, "is_active" = true;
