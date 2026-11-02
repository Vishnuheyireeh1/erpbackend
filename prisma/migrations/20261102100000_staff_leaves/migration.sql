-- Leave days per staff member per month (typed in the Monthly salary list).
-- CreateTable
CREATE TABLE "staff_leaves" (
    "staff_id" INTEGER NOT NULL,
    "month" DATE NOT NULL,
    "days" DECIMAL(4,1) NOT NULL,
    "updated_by" VARCHAR(50) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_leaves_pkey" PRIMARY KEY ("staff_id","month")
);

-- CreateIndex
CREATE INDEX "staff_leaves_month_idx" ON "staff_leaves"("month");

-- AddForeignKey
ALTER TABLE "staff_leaves" ADD CONSTRAINT "staff_leaves_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;
