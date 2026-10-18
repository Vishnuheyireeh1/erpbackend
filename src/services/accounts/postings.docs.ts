import { Prisma } from '../../generated/prisma/client'

// Automatic double entry — part 1: bills, jobs, returns, purchases, production, stock.
// Every row: d (date), acct (account code), party (C12 customer / S3 supplier / T2 tailor / ''), amt (+ debit, − credit),
// src + ref_id (the document), doc_no, memo. Each document's rows add up to 0 (any paise left → round off,
// see postings.sql.ts). Cancelled documents never count (same rule as the day book and every report).

// Helper tables used below.
export const DOC_CTES = Prisma.sql`
  dead AS (
    SELECT 'INV'::text AS ref_type, id FROM sales_invoices WHERE status = 'CANCELLED'
    UNION ALL SELECT 'SR', id FROM sales_returns WHERE status = 'CANCELLED'
    UNION ALL SELECT 'JOB', id FROM stitching_jobs WHERE status = 'CANCELLED'
    UNION ALL SELECT CASE WHEN kind = 'OPENING' THEN 'OPN' ELSE 'ADJ' END, id FROM stock_documents WHERE status = 'CANCELLED'
  ),
  job_x AS (
    SELECT j.*, COALESCE(so.amt, 0) AS sold_amt, COALESCE(so.tx, 0) AS sold_tx, COALESCE(so.tax, 0) AS sold_tax
    FROM stitching_jobs j LEFT JOIN LATERAL (
      SELECT SUM(m.amount) AS amt, SUM(m.taxable) AS tx, SUM(m.cgst + m.sgst + m.igst) AS tax FROM job_materials m WHERE m.job_id = j.id AND NOT m.included
    ) so ON TRUE WHERE j.status <> 'CANCELLED'
  ),
  pur_x AS (
    SELECT p.*, x.stock, x.tax,
      CASE WHEN x.tax <> 0 AND ABS((p.grand_total + p.freight_separate - p.round_off - x.stock) - x.tax) <= ABS(p.grand_total + p.freight_separate - p.round_off - x.stock)
        THEN x.tax ELSE 0 END AS gst_in -- GST counts as input only when it is not already in the stock cost (shop GST registered)
    FROM purchase_invoices p, LATERAL (
      SELECT COALESCE((SELECT SUM(value) FROM stock_movements WHERE ref_type = 'PUR' AND ref_id = p.id), 0) AS stock, p.cgst_total + p.sgst_total + p.igst_total AS tax
    ) x WHERE p.status = 'POSTED'
  ),
  dn_x AS (
    SELECT r.*, x.stock, CASE WHEN r.tax_total <> 0 AND ABS((r.grand_total + x.stock) - r.tax_total) <= ABS(r.grand_total + x.stock) THEN r.tax_total ELSE 0 END AS gst_in
    FROM purchase_returns r, LATERAL (SELECT COALESCE((SELECT SUM(value) FROM stock_movements WHERE ref_type = 'DN' AND ref_id = r.id), 0) AS stock) x
    WHERE r.status = 'POSTED'
  ),
  stock_fix AS (SELECT (SELECT COALESCE(SUM(stock_value), 0) FROM product_variants) - (SELECT COALESCE(SUM(value), 0) FROM stock_movements) AS fix),
  prd_x AS (
    SELECT o.id, o.doc_date, o.doc_no, COALESCE((SELECT SUM(value) FROM stock_movements WHERE ref_type = 'PRD' AND ref_id = o.id), 0) AS stock
    FROM production_orders o WHERE o.status = 'POSTED'
  )`

const cashOrBank = (mode: Prisma.Sql) => Prisma.sql`CASE WHEN ${mode} = 'CASH' THEN '1000' ELSE '1010' END`

export const DOC_LINES = Prisma.sql`
  -- Counter bill: customer owes the bill; sales (before GST) + GST collected.
  SELECT s.doc_date AS d, '1100'::text AS acct, 'C' || COALESCE(s.customer_id, 0) AS party, s.grand_total AS amt, 'INV'::text AS src, s.id AS ref_id, s.doc_no::text AS doc_no, s.customer_name::text AS memo
    FROM sales_invoices s WHERE s.status = 'POSTED'
  UNION ALL SELECT s.doc_date, '4000', '', -s.taxable_total, 'INV', s.id, s.doc_no, s.customer_name FROM sales_invoices s WHERE s.status = 'POSTED'
  UNION ALL SELECT s.doc_date, '2200', '', -(s.cgst_total + s.sgst_total + s.igst_total), 'INV', s.id, s.doc_no, s.customer_name FROM sales_invoices s WHERE s.status = 'POSTED'

  -- Sales return: sales and GST reduced, customer's balance reduced; refund paid out of cash / bank.
  UNION ALL SELECT r.doc_date, '4010', '', r.taxable_total, 'SR', r.id, r.doc_no, r.reason FROM sales_returns r WHERE r.status = 'POSTED'
  UNION ALL SELECT r.doc_date, '2200', '', r.tax_total, 'SR', r.id, r.doc_no, r.reason FROM sales_returns r WHERE r.status = 'POSTED'
  UNION ALL SELECT r.doc_date, '1100', 'C' || COALESCE(r.customer_id, 0), -r.grand_total, 'SR', r.id, r.doc_no, r.reason FROM sales_returns r WHERE r.status = 'POSTED'
  UNION ALL SELECT r.doc_date, '1100', 'C' || COALESCE(r.customer_id, 0), r.refund_amount, 'SRF', r.id, r.doc_no, 'Refund' FROM sales_returns r WHERE r.status = 'POSTED' AND r.refund_amount > 0 AND r.refund_mode IS NOT NULL
  UNION ALL SELECT r.doc_date, ${cashOrBank(Prisma.sql`r.refund_mode::text`)}, '', -r.refund_amount, 'SRF', r.id, r.doc_no, 'Refund' FROM sales_returns r WHERE r.status = 'POSTED' AND r.refund_amount > 0 AND r.refund_mode IS NOT NULL

  -- Stitching job (booking date): stitching charges + their GST. Items sold on the job are posted on the day they were added.
  UNION ALL SELECT j.doc_date, '1100', 'C' || j.customer_id, j.grand_total - j.sold_amt, 'JOB', j.id, j.doc_no, j.customer_name FROM job_x j
  UNION ALL SELECT j.doc_date, '4100', '', -(j.taxable_total - j.sold_tx), 'JOB', j.id, j.doc_no, j.customer_name FROM job_x j
  UNION ALL SELECT j.doc_date, '2200', '', -(j.cgst_total + j.sgst_total + j.igst_total - j.sold_tax), 'JOB', j.id, j.doc_no, j.customer_name FROM job_x j
  UNION ALL SELECT (m.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date, '1100', 'C' || j.customer_id, m.amount, 'JOBI', j.id, j.doc_no, m.description
    FROM job_materials m JOIN job_x j ON j.id = m.job_id WHERE NOT m.included
  UNION ALL SELECT (m.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date, '4000', '', -m.taxable, 'JOBI', j.id, j.doc_no, m.description
    FROM job_materials m JOIN job_x j ON j.id = m.job_id WHERE NOT m.included
  UNION ALL SELECT (m.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date, '2200', '', -(m.cgst + m.sgst + m.igst), 'JOBI', j.id, j.doc_no, m.description
    FROM job_materials m JOIN job_x j ON j.id = m.job_id WHERE NOT m.included

  -- Stock moved by bills, jobs, brand orders (BRO: our cloth), returns, opening stock and adjustments: stock ↔ cost of goods / material used / adjustments.
  UNION ALL SELECT m.movement_date, '1200', '', m.value, m.ref_type, m.ref_id, m.ref_no, m.note FROM stock_movements m
    WHERE m.ref_type IN ('OPN', 'ADJ', 'INV', 'SR', 'JOB', 'BRO') AND NOT EXISTS (SELECT 1 FROM dead x WHERE x.ref_type = m.ref_type AND x.id = m.ref_id)
  UNION ALL SELECT m.movement_date,
      CASE WHEN m.ref_type = 'OPN' THEN '3010' WHEN m.ref_type = 'ADJ' THEN '5050' WHEN m.ref_type IN ('JOB', 'BRO') AND m.type NOT IN ('SALE', 'SALE_RETURN') THEN '5010' ELSE '5000' END,
      '', -m.value, m.ref_type, m.ref_id, m.ref_no, m.note FROM stock_movements m
    WHERE m.ref_type IN ('OPN', 'ADJ', 'INV', 'SR', 'JOB', 'BRO') AND NOT EXISTS (SELECT 1 FROM dead x WHERE x.ref_type = m.ref_type AND x.id = m.ref_id)

  -- Brand delivery bill: the brand owes the bill; brand stitching income (bill before GST, round off included) + GST.
  UNION ALL SELECT b.doc_date, '1110', 'B' || b.brand_id, b.grand_total, 'BD', b.id, b.doc_no, b.brand_name FROM brand_bills b WHERE b.status = 'POSTED'
  UNION ALL SELECT b.doc_date, '4110', '', -(b.grand_total - b.cgst_total - b.sgst_total - b.igst_total), 'BD', b.id, b.doc_no, b.brand_name FROM brand_bills b WHERE b.status = 'POSTED'
  UNION ALL SELECT b.doc_date, '2200', '', -(b.cgst_total + b.sgst_total + b.igst_total), 'BD', b.id, b.doc_no, b.brand_name FROM brand_bills b WHERE b.status = 'POSTED' AND b.cgst_total + b.sgst_total + b.igst_total <> 0

  -- Purchase bill: stock (at landed cost) + GST input; supplier owed the bill; separate freight owed to the transporter.
  UNION ALL SELECT p.doc_date, '1200', '', p.stock, 'PUR', p.id, p.doc_no, p.supplier_invoice_no FROM pur_x p
  UNION ALL SELECT p.doc_date, '1300', '', p.gst_in, 'PUR', p.id, p.doc_no, p.supplier_invoice_no FROM pur_x p
  UNION ALL SELECT p.doc_date, '2000', 'S' || p.supplier_id, -p.grand_total, 'PUR', p.id, p.doc_no, p.supplier_invoice_no FROM pur_x p
  UNION ALL SELECT p.doc_date, '2400', '', -p.freight_separate, 'PUR', p.id, p.doc_no, COALESCE(p.freight_note, 'Freight') FROM pur_x p
  -- …and when the transporter is paid: freight payable clears, cash / bank goes down.
  UNION ALL SELECT p.freight_paid_on, '2400', '', p.freight_separate, 'PUR', p.id, p.doc_no, 'Freight paid' FROM pur_x p WHERE p.freight_mode IS NOT NULL
  UNION ALL SELECT p.freight_paid_on, ${cashOrBank(Prisma.sql`p.freight_mode::text`)}, '', -p.freight_separate, 'PUR', p.id, p.doc_no, 'Freight paid' FROM pur_x p WHERE p.freight_mode IS NOT NULL
  -- Purchase return (debit note): supplier owes us less; stock and GST input go back.
  UNION ALL SELECT r.doc_date, '2000', 'S' || r.supplier_id, r.grand_total, 'DN', r.id, r.doc_no, r.reason FROM dn_x r
  UNION ALL SELECT r.doc_date, '1200', '', r.stock, 'DN', r.id, r.doc_no, r.reason FROM dn_x r
  UNION ALL SELECT r.doc_date, '1300', '', -r.gst_in, 'DN', r.id, r.doc_no, r.reason FROM dn_x r

  -- Making own products: pieces in at cost; tailor pay owed; outside work paid from cash / bank.
  UNION ALL SELECT o.doc_date, '1200', '', o.stock, 'PRD', o.id, o.doc_no, 'Made in the shop' FROM prd_x o
  UNION ALL SELECT o.doc_date, '2100', 'T' || c.tailor_id, -c.amount, 'PRD', o.id, o.doc_no, c.description FROM production_costs c JOIN prd_x o ON o.id = c.order_id WHERE c.kind = 'TAILOR'
  UNION ALL SELECT o.doc_date, ${cashOrBank(Prisma.sql`c.mode::text`)}, '', -c.amount, 'PRD', o.id, o.doc_no, c.description FROM production_costs c JOIN prd_x o ON o.id = c.order_id WHERE c.kind = 'PAID'

  -- Stock value check: the Stock account always equals the stock value on the Stock page (old direct corrections, if any).
  UNION ALL SELECT DATE '2000-01-01', '1200', '', f.fix, 'STKFIX', 0, 'Stock check', 'Stock value correction' FROM stock_fix f
  UNION ALL SELECT DATE '2000-01-01', '3010', '', -f.fix, 'STKFIX', 0, 'Stock check', 'Stock value correction' FROM stock_fix f`
