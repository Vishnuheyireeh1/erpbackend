-- Staff paid per day: amount per day on the staff member, days worked typed each month, both kept on the payslip.
-- AlterTable
ALTER TABLE "staff" ADD COLUMN     "day_rate" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "payslips" ADD COLUMN     "day_rate" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "days" DECIMAL(4,1) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "staff_work_days" (
    "staff_id" INTEGER NOT NULL,
    "month" DATE NOT NULL,
    "days" DECIMAL(4,1) NOT NULL,
    "updated_by" VARCHAR(50) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_work_days_pkey" PRIMARY KEY ("staff_id","month")
);

-- CreateIndex
CREATE INDEX "staff_work_days_month_idx" ON "staff_work_days"("month");

-- AddForeignKey
ALTER TABLE "staff_work_days" ADD CONSTRAINT "staff_work_days_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;
