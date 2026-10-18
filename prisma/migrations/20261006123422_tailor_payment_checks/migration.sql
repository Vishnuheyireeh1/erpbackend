ALTER TABLE "tailor_payments" ADD CONSTRAINT "tailor_payments_amount_positive" CHECK ("amount" > 0);
