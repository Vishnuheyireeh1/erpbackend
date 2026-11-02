-- Money received can be linked to the brand order it was taken on (order page → Receive money).
-- AlterTable
ALTER TABLE "brand_payments" ADD COLUMN     "order_id" INTEGER;

-- CreateIndex
CREATE INDEX "brand_payments_order_id_idx" ON "brand_payments"("order_id");

-- AddForeignKey
ALTER TABLE "brand_payments" ADD CONSTRAINT "brand_payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "brand_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
