import { Prisma } from '../../generated/prisma/client'

// GST lines read straight from the documents (nothing copied). Cancelled documents never count.
// Every line: d (date), ref_id, kind, doc_no, party, gstin, hsn, qty, rate, taxable, cgst, sgst, igst.
// Returns (credit / debit notes) come in as NEGATIVE lines so totals are net.

// Return lines keep one "tax" figure — split like the original bill (IGST if it was inter-state, else half CGST + half SGST).
const split = (tax: string, inter: string) => Prisma.raw(`
  CASE WHEN ${inter} THEN 0 ELSE -ROUND(${tax} / 2, 2) END,
  CASE WHEN ${inter} THEN 0 ELSE -(${tax} - ROUND(${tax} / 2, 2)) END,
  CASE WHEN ${inter} THEN -${tax} ELSE 0 END`)

/** Stitching charges carry this SAC (tailoring = job work on the customer's cloth). Confirm with the accountant. */
export const STITCHING_SAC = '9988'

// Outward supplies: counter bills, items sold on jobs, stitching charges, brand delivery bills (one line per bill at
// its GST %, SAC 9988 — stitching with our cloth as one supply), sales returns.
export const OUTWARD = Prisma.sql`
  SELECT i.doc_date AS d, i.id AS ref_id, 'BILL' AS kind, i.doc_no, i.customer_name AS party, i.customer_gstin AS gstin,
         COALESCE(l.hsn_code, '') AS hsn, l.qty, l.gst_rate AS rate, l.taxable, l.cgst, l.sgst, l.igst
    FROM sales_lines l JOIN sales_invoices i ON i.id = l.invoice_id WHERE i.status = 'POSTED'
  UNION ALL
  SELECT j.doc_date, j.id, 'JOB', j.doc_no, j.customer_name, c.gstin, COALESCE(m.hsn_code, ''), m.qty, m.gst_rate, m.taxable, m.cgst, m.sgst, m.igst
    FROM job_materials m JOIN stitching_jobs j ON j.id = m.job_id LEFT JOIN customers c ON c.id = j.customer_id
    WHERE NOT m.included AND j.status <> 'CANCELLED'
  UNION ALL
  SELECT j.doc_date, j.id, 'JOB', j.doc_no, j.customer_name, c.gstin, '9988', jq.pieces, j.gst_rate,
         j.taxable_total - ms.taxable, j.cgst_total - ms.cgst, j.sgst_total - ms.sgst, j.igst_total - ms.igst
    FROM stitching_jobs j LEFT JOIN customers c ON c.id = j.customer_id
    CROSS JOIN LATERAL (SELECT COALESCE(SUM(taxable), 0) AS taxable, COALESCE(SUM(cgst), 0) AS cgst, COALESCE(SUM(sgst), 0) AS sgst, COALESCE(SUM(igst), 0) AS igst
                          FROM job_materials WHERE job_id = j.id AND NOT included) ms
    CROSS JOIN LATERAL (SELECT COALESCE(SUM(qty), 0)::numeric AS pieces FROM job_items WHERE job_id = j.id) jq
    WHERE j.status <> 'CANCELLED' AND j.taxable_total - ms.taxable <> 0
  UNION ALL
  SELECT b.doc_date, b.id, 'BRAND', b.doc_no, b.brand_name, b.brand_gstin, '9988', bq.pieces, b.gst_rate,
         b.taxable_total, b.cgst_total, b.sgst_total, b.igst_total
    FROM brand_bills b CROSS JOIN LATERAL (SELECT COALESCE(SUM(qty), 0) AS pieces FROM brand_bill_lines WHERE bill_id = b.id AND kind = 'PIECE') bq
    WHERE b.status = 'POSTED'
  UNION ALL
  SELECT r.doc_date, r.id, 'RETURN', r.doc_no, COALESCE(c.name, 'Walk-in customer'), c.gstin, COALESCE(sl.hsn_code, jm.hsn_code, ''),
         -rl.qty, COALESCE(sl.gst_rate, jm.gst_rate, 0), -rl.taxable, ${split('rl.tax', 'COALESCE(si.igst_total, sj.igst_total, 0) > 0')}
    FROM sales_return_lines rl JOIN sales_returns r ON r.id = rl.return_id LEFT JOIN customers c ON c.id = r.customer_id
    LEFT JOIN sales_lines sl ON sl.id = rl.sales_line_id LEFT JOIN sales_invoices si ON si.id = sl.invoice_id
    LEFT JOIN job_materials jm ON jm.id = rl.job_material_id LEFT JOIN stitching_jobs sj ON sj.id = jm.job_id
    WHERE r.status = 'POSTED'`

// Inward supplies (input tax credit): purchase lines, GST on packing / other charges, purchase returns.
export const INWARD = Prisma.sql`
  SELECT p.doc_date AS d, p.id AS ref_id, 'PURCHASE' AS kind, p.doc_no, s.name AS party, s.gstin, p.supplier_invoice_no AS bill_no,
         l.gst_rate AS rate, l.taxable, l.cgst, l.sgst, l.igst
    FROM purchase_lines l JOIN purchase_invoices p ON p.id = l.invoice_id JOIN suppliers s ON s.id = p.supplier_id WHERE p.status = 'POSTED'
  UNION ALL
  SELECT p.doc_date, p.id, 'PURCHASE', p.doc_no, s.name, s.gstin, p.supplier_invoice_no, p.charges_gst_rate, p.other_charges,
         CASE WHEN p.tax_mode = 'INTER' THEN 0 ELSE ROUND(p.charges_tax / 2, 2) END,
         CASE WHEN p.tax_mode = 'INTER' THEN 0 ELSE p.charges_tax - ROUND(p.charges_tax / 2, 2) END,
         CASE WHEN p.tax_mode = 'INTER' THEN p.charges_tax ELSE 0 END
    FROM purchase_invoices p JOIN suppliers s ON s.id = p.supplier_id WHERE p.status = 'POSTED' AND p.charges_tax <> 0
  UNION ALL
  SELECT r.doc_date, r.id, 'PURCHASE_RETURN', r.doc_no, s.name, s.gstin, p.supplier_invoice_no, pl.gst_rate, -rl.taxable, ${split('rl.tax', "p.tax_mode = 'INTER'")}
    FROM purchase_return_lines rl JOIN purchase_returns r ON r.id = rl.return_id JOIN suppliers s ON s.id = r.supplier_id
    JOIN purchase_lines pl ON pl.id = rl.purchase_line_id JOIN purchase_invoices p ON p.id = r.invoice_id
    WHERE r.status = 'POSTED'`

export const inRange = (from: string, to: string) => Prisma.sql`d BETWEEN ${from}::date AND ${to}::date`
