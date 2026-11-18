-- Product's usual supplier (optional). Empty = the list shows the supplier of the latest purchase bill.
-- AlterTable
ALTER TABLE "products" ADD COLUMN "supplier_id" INTEGER;

-- CreateIndex
CREATE INDEX "products_supplier_id_idx" ON "products"("supplier_id");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
