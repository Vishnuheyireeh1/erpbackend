-- One people list: everyone is a Staff member; a worker (tailors table) is the job-work profile of a staff member.
ALTER TABLE "job_cost_entries" ADD COLUMN "tailor_id" INTEGER;
ALTER TABLE "tailors" ADD COLUMN "staff_id" INTEGER;
CREATE INDEX "job_cost_entries_tailor_id_idx" ON "job_cost_entries"("tailor_id");
CREATE UNIQUE INDEX "tailors_staff_id_key" ON "tailors"("staff_id");
ALTER TABLE "job_cost_entries" ADD CONSTRAINT "job_cost_entries_tailor_id_fkey" FOREIGN KEY ("tailor_id") REFERENCES "tailors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tailors" ADD CONSTRAINT "tailors_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Work by our own worker needs the person; paid-out work needs how it was paid.
ALTER TABLE "job_cost_entries" DROP CONSTRAINT "job_cost_entries_mode_when_paid";
ALTER TABLE "job_cost_entries" ADD CONSTRAINT "job_cost_entries_mode_when_paid" CHECK ("paid_by" <> 'PAID' OR "mode" IS NOT NULL OR "created_by" = 'migration');
ALTER TABLE "job_cost_entries" ADD CONSTRAINT "job_cost_entries_worker_person" CHECK ("paid_by" <> 'WORKER' OR "tailor_id" IS NOT NULL);

-- Existing tailors become staff members (Workshop, role Tailor), linked to their worker profile — history kept.
DO $$
DECLARE t RECORD; n INT; sid INT;
BEGIN
  FOR t IN SELECT * FROM tailors WHERE staff_id IS NULL ORDER BY id LOOP
    UPDATE counters SET value = value + 1 WHERE key = 'staff' RETURNING value INTO n;
    IF n IS NULL THEN
      INSERT INTO counters (key, value) VALUES ('staff', 1) RETURNING value INTO n;
    END IF;
    INSERT INTO staff (code, name, phone, role, dept, salary, notes, is_active, created_at, updated_at)
      VALUES ('E' || lpad(n::text, 3, '0'), t.name, t.phone, 'Tailor', 'WORKSHOP', 0, t.notes, t.is_active, now(), now())
      RETURNING id INTO sid;
    UPDATE tailors SET staff_id = sid WHERE id = t.id;
  END LOOP;
END $$;
