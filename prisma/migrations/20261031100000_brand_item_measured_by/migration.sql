-- Who took the measurements of a brand order piece (staff, optional).
-- AlterTable
ALTER TABLE "brand_order_items" ADD COLUMN     "measured_by_id" INTEGER;

-- AddForeignKey
ALTER TABLE "brand_order_items" ADD CONSTRAINT "brand_order_items_measured_by_id_fkey" FOREIGN KEY ("measured_by_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
