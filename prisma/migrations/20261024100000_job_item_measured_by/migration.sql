-- Who took the measurements of a job garment (staff, optional).
-- AlterTable
ALTER TABLE "job_items" ADD COLUMN     "measured_by_id" INTEGER;

-- AddForeignKey
ALTER TABLE "job_items" ADD CONSTRAINT "job_items_measured_by_id_fkey" FOREIGN KEY ("measured_by_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

