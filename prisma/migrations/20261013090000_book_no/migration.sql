-- Manual number from the paper bill / order book (optional) on bills and stitching jobs.
ALTER TABLE "sales_invoices" ADD COLUMN "book_no" VARCHAR(30);
ALTER TABLE "stitching_jobs" ADD COLUMN "book_no" VARCHAR(30);
CREATE INDEX "sales_invoices_book_no_idx" ON "sales_invoices"("book_no");
CREATE INDEX "stitching_jobs_book_no_idx" ON "stitching_jobs"("book_no");
