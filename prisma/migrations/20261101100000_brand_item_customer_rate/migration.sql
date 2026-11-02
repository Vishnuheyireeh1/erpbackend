-- What the brand's customer pays per piece — printed on the brand order bill only (not the brand's rate, not in the books).
-- AlterTable
ALTER TABLE "brand_order_items" ADD COLUMN     "customer_rate" DECIMAL(12,2);
