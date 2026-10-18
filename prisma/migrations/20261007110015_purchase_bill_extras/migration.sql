-- AlterTable
ALTER TABLE "purchase_invoices" ADD COLUMN     "bill_discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "bill_discount_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "charges_gst_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "charges_tax" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "freight_note" VARCHAR(120),
ADD COLUMN     "freight_separate" DECIMAL(14,2) NOT NULL DEFAULT 0;
