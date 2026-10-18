-- Separate freight ("to pay" the transporter): how and when it was paid. Null = still to pay.
-- AlterTable
ALTER TABLE "purchase_invoices" ADD COLUMN     "freight_mode" "payment_mode",
ADD COLUMN     "freight_paid_on" DATE;

