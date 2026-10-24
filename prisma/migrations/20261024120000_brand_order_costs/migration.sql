-- Work and costs on brand orders (embroidery, hand work …): worker pay, salaried, or paid out.
-- CreateTable
CREATE TABLE "brand_order_costs" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "item_id" INTEGER,
    "category_id" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "description" VARCHAR(200),
    "qty" DECIMAL(12,3) NOT NULL DEFAULT 1,
    "rate" DECIMAL(12,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paid_by" "CostPaidBy" NOT NULL,
    "mode" "payment_mode",
    "tailor_id" INTEGER,
    "created_by" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brand_order_costs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "brand_order_costs_order_id_idx" ON "brand_order_costs"("order_id");

-- CreateIndex
CREATE INDEX "brand_order_costs_date_idx" ON "brand_order_costs"("date");

-- CreateIndex
CREATE INDEX "brand_order_costs_tailor_id_idx" ON "brand_order_costs"("tailor_id");

-- AddForeignKey
ALTER TABLE "brand_order_costs" ADD CONSTRAINT "brand_order_costs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "brand_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_order_costs" ADD CONSTRAINT "brand_order_costs_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "brand_order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_order_costs" ADD CONSTRAINT "brand_order_costs_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "job_cost_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_order_costs" ADD CONSTRAINT "brand_order_costs_tailor_id_fkey" FOREIGN KEY ("tailor_id") REFERENCES "tailors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

