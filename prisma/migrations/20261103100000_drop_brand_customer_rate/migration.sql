-- The separate customer price was dropped: the brand order bill prints the piece's price.
-- AlterTable
ALTER TABLE "brand_order_items" DROP COLUMN "customer_rate";
