-- Job lines without a garment (Saree fall & pico, Saree bleeding …): garment is now optional; description = the work.
-- AlterTable
ALTER TABLE "job_items" ALTER COLUMN "garment_type_id" DROP NOT NULL;
