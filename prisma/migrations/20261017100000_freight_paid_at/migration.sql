-- Time the freight payment was entered (day book shows it in order). Existing ones: now.
-- AlterTable
ALTER TABLE "purchase_invoices" ADD COLUMN     "freight_paid_at" TIMESTAMP(3);

UPDATE "purchase_invoices" SET "freight_paid_at" = CURRENT_TIMESTAMP WHERE "freight_mode" IS NOT NULL;
