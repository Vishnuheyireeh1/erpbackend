import { Prisma } from '../../generated/prisma/client'

// Automatic double entry — part 2: money in / out, tailor pay, salary, opening balances, journal entries.
// Same columns as postings.docs.ts. CASH = cash in hand (1000); UPI / card / bank / cheque = bank (1010).

const cb = (mode: Prisma.Sql) => Prisma.sql`CASE WHEN ${mode} = 'CASH' THEN '1000' ELSE '1010' END`
// Opening balances sit before every document.
export const OPENING_DATE = '2000-01-01'

export const MONEY_CTES = Prisma.sql`
  earned AS ( -- per-piece worker pay (stitching + other job work) counts on the day the job got Ready (same as the statement)
    SELECT w.tailor_id, j.id AS job_id, j.doc_no,
      COALESCE((SELECT (min(l.at) AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date FROM job_status_logs l
                WHERE l.job_id = j.id AND l.to_status IN ('READY', 'DELIVERED')), j.doc_date) AS d,
      SUM(w.labour) AS labour
    FROM (SELECT i.job_id, i.tailor_id, i.qty AS pieces, i.qty * i.labour_rate AS labour, i.qty || ' × ' || i.description AS what, i.sort_order AS so
          FROM job_items i WHERE i.tailor_id IS NOT NULL
        UNION ALL SELECT e.job_id, e.tailor_id, 0, e.amount, k.name || COALESCE(' · ' || e.description, ''), 1000 + e.id
          FROM job_cost_entries e JOIN job_cost_categories k ON k.id = e.category_id WHERE e.paid_by = 'WORKER') w JOIN stitching_jobs j ON j.id = w.job_id JOIN tailors t ON t.id = w.tailor_id AND t.pay_type = 'PIECE'
    WHERE j.status IN ('READY', 'DELIVERED') GROUP BY w.tailor_id, j.id
  ),
  brand_earned AS ( -- per-piece pay for brand-order pieces, on the day each piece got Ready
    SELECT i.tailor_id, o.id AS order_id, o.doc_no, i.ready_on AS d, SUM(i.qty * i.labour_rate) AS labour
    FROM brand_order_items i JOIN brand_orders o ON o.id = i.order_id JOIN tailors t ON t.id = i.tailor_id AND t.pay_type = 'PIECE'
    WHERE i.stage IN ('READY', 'DELIVERED') AND i.ready_on IS NOT NULL AND o.status <> 'CANCELLED'
    GROUP BY i.tailor_id, o.id, i.ready_on
  )`

export const MONEY_LINES = Prisma.sql`
  -- Money received from customers (bills, job balances, advances).
  SELECT r.doc_date, ${cb(Prisma.sql`tn.mode::text`)}, '', tn.amount, 'RCP', r.id, r.doc_no, COALESCE(c.name, 'Cash customer')
    FROM receipt_tenders tn JOIN customer_receipts r ON r.id = tn.receipt_id LEFT JOIN customers c ON c.id = r.customer_id WHERE r.status = 'POSTED'
  UNION ALL SELECT r.doc_date, '1100', 'C' || COALESCE(r.customer_id, 0), -tn.amount, 'RCP', r.id, r.doc_no, COALESCE(c.name, 'Cash customer')
    FROM receipt_tenders tn JOIN customer_receipts r ON r.id = tn.receipt_id LEFT JOIN customers c ON c.id = r.customer_id WHERE r.status = 'POSTED'

  -- Training fees received.
  UNION ALL SELECT f.doc_date, ${cb(Prisma.sql`f.mode::text`)}, '', f.amount, 'FEE', f.id, f.doc_no, 'Fee' FROM fee_receipts f WHERE f.status = 'POSTED'
  UNION ALL SELECT f.doc_date, '4200', '', -f.amount, 'FEE', f.id, f.doc_no, 'Fee' FROM fee_receipts f WHERE f.status = 'POSTED'

  -- Money received from brands.
  UNION ALL SELECT p.doc_date, ${cb(Prisma.sql`p.mode::text`)}, '', p.amount, 'BRP', p.id, p.doc_no, br.name FROM brand_payments p JOIN partner_brands br ON br.id = p.brand_id WHERE p.status = 'POSTED'
  UNION ALL SELECT p.doc_date, '1110', 'B' || p.brand_id, -p.amount, 'BRP', p.id, p.doc_no, br.name FROM brand_payments p JOIN partner_brands br ON br.id = p.brand_id WHERE p.status = 'POSTED'

  -- Suppliers paid.
  UNION ALL SELECT p.doc_date, '2000', 'S' || p.supplier_id, p.amount, 'PAY', p.id, p.doc_no, 'Paid' FROM supplier_payments p WHERE p.status = 'POSTED'
  UNION ALL SELECT p.doc_date, ${cb(Prisma.sql`p.mode::text`)}, '', -p.amount, 'PAY', p.id, p.doc_no, 'Paid' FROM supplier_payments p WHERE p.status = 'POSTED'

  -- Tailor pay earned (per piece) and paid. Salaried tailors: what is paid is the cost.
  UNION ALL SELECT e.d, '5020', '', e.labour, 'TE', e.job_id, e.doc_no, 'Tailor pay' FROM earned e
  UNION ALL SELECT e.d, '2100', 'T' || e.tailor_id, -e.labour, 'TE', e.job_id, e.doc_no, 'Tailor pay' FROM earned e
  UNION ALL SELECT e.d, '5020', '', e.labour, 'BRO', e.order_id, e.doc_no, 'Tailor pay (brand order)' FROM brand_earned e
  UNION ALL SELECT e.d, '2100', 'T' || e.tailor_id, -e.labour, 'BRO', e.order_id, e.doc_no, 'Tailor pay (brand order)' FROM brand_earned e
  UNION ALL SELECT p.doc_date, CASE WHEN t.pay_type = 'PIECE' THEN '2100' ELSE '5045' END, 'T' || p.tailor_id, p.amount, 'TP', p.id, p.doc_no, t.name
    FROM tailor_payments p JOIN tailors t ON t.id = p.tailor_id WHERE p.status = 'POSTED'
  UNION ALL SELECT p.doc_date, ${cb(Prisma.sql`p.mode::text`)}, '', -p.amount, 'TP', p.id, p.doc_no, t.name
    FROM tailor_payments p JOIN tailors t ON t.id = p.tailor_id WHERE p.status = 'POSTED'

  -- Job costs paid out (embroidery, hand work …). Salaried job costs are for job profit only — no money moves.
  UNION ALL SELECT e.date, '5030', '', e.amount, 'JC', e.job_id, j.doc_no, k.name
    FROM job_cost_entries e JOIN stitching_jobs j ON j.id = e.job_id JOIN job_cost_categories k ON k.id = e.category_id WHERE e.paid_by = 'PAID' AND e.mode IS NOT NULL
  UNION ALL SELECT e.date, ${cb(Prisma.sql`e.mode::text`)}, '', -e.amount, 'JC', e.job_id, j.doc_no, k.name
    FROM job_cost_entries e JOIN stitching_jobs j ON j.id = e.job_id JOIN job_cost_categories k ON k.id = e.category_id WHERE e.paid_by = 'PAID' AND e.mode IS NOT NULL

  -- Salary: the cost belongs to the month it is for (salary payable), the money goes out on the paid day.
  UNION ALL SELECT p.month, CASE WHEN st.dept = 'WORKSHOP' THEN '6010' ELSE '6000' END, '', p.amount, 'SALM', p.id, p.doc_no, st.name
    FROM salary_payments p JOIN staff st ON st.id = p.staff_id WHERE p.status = 'POSTED'
  UNION ALL SELECT p.month, '2300', '', -p.amount, 'SALM', p.id, p.doc_no, st.name FROM salary_payments p JOIN staff st ON st.id = p.staff_id WHERE p.status = 'POSTED'
  UNION ALL SELECT p.doc_date, '2300', '', p.amount, 'SAL', p.id, p.doc_no, st.name FROM salary_payments p JOIN staff st ON st.id = p.staff_id WHERE p.status = 'POSTED'
  UNION ALL SELECT p.doc_date, ${cb(Prisma.sql`p.mode::text`)}, '', -p.amount, 'SAL', p.id, p.doc_no, st.name
    FROM salary_payments p JOIN staff st ON st.id = p.staff_id WHERE p.status = 'POSTED'

  -- Shop expenses (each expense type is its own account).
  UNION ALL SELECT x.doc_date, 'E' || x.category_id, '', x.amount, 'EXP', x.id, x.doc_no, COALESCE(x.paid_to, '') FROM expenses x WHERE x.status = 'POSTED'
  UNION ALL SELECT x.doc_date, ${cb(Prisma.sql`x.mode::text`)}, '', -x.amount, 'EXP', x.id, x.doc_no, COALESCE(x.paid_to, '') FROM expenses x WHERE x.status = 'POSTED'

  -- Cash ↔ bank, owner money in / out, other income.
  UNION ALL SELECT m.doc_date,
      CASE m.kind WHEN 'WITHDRAW' THEN '1000' WHEN 'OWNER_OUT' THEN '3100' ELSE ${cb(Prisma.sql`m.mode::text`)} END, '', m.amount, 'MOV', m.id, m.doc_no, m.kind::text
    FROM money_movements m WHERE m.status = 'POSTED'
  UNION ALL SELECT m.doc_date,
      CASE m.kind WHEN 'DEPOSIT' THEN '1000' WHEN 'OWNER_IN' THEN '3000' WHEN 'OTHER_INCOME' THEN '4300' ELSE ${cb(Prisma.sql`m.mode::text`)} END, '', -m.amount, 'MOV', m.id, m.doc_no, m.kind::text
    FROM money_movements m WHERE m.status = 'POSTED'

  -- Opening balances (go-live): cash / bank (Settings), customer / supplier / tailor dues.
  UNION ALL SELECT ${OPENING_DATE}::date, '1000', '', (s.value->>'cash')::numeric, 'OPEN', 0, 'Opening', 'Cash in hand' FROM app_settings s WHERE s.key = 'money.opening'
  UNION ALL SELECT ${OPENING_DATE}::date, '1010', '', (s.value->>'bank')::numeric, 'OPEN', 0, 'Opening', 'Bank' FROM app_settings s WHERE s.key = 'money.opening'
  UNION ALL SELECT ${OPENING_DATE}::date, '3010', '', -((s.value->>'cash')::numeric + (s.value->>'bank')::numeric), 'OPEN', 0, 'Opening', 'Cash and bank' FROM app_settings s WHERE s.key = 'money.opening'
  UNION ALL SELECT ${OPENING_DATE}::date, '1100', 'C' || c.id, c.opening_balance, 'OPENC', c.id, 'Opening', c.name FROM customers c WHERE c.opening_balance <> 0
  UNION ALL SELECT ${OPENING_DATE}::date, '3010', '', -c.opening_balance, 'OPENC', c.id, 'Opening', c.name FROM customers c WHERE c.opening_balance <> 0
  UNION ALL SELECT ${OPENING_DATE}::date, '1110', 'B' || b.id, b.opening_balance, 'OPENB', b.id, 'Opening', b.name FROM partner_brands b WHERE b.opening_balance <> 0
  UNION ALL SELECT ${OPENING_DATE}::date, '3010', '', -b.opening_balance, 'OPENB', b.id, 'Opening', b.name FROM partner_brands b WHERE b.opening_balance <> 0
  UNION ALL SELECT ${OPENING_DATE}::date, '2000', 'S' || s.id, -s.opening_balance, 'OPENS', s.id, 'Opening', s.name FROM suppliers s WHERE s.opening_balance <> 0
  UNION ALL SELECT ${OPENING_DATE}::date, '3010', '', s.opening_balance, 'OPENS', s.id, 'Opening', s.name FROM suppliers s WHERE s.opening_balance <> 0
  UNION ALL SELECT ${OPENING_DATE}::date, '2100', 'T' || t.id, -t.opening_balance, 'OPENT', t.id, 'Opening', t.name FROM tailors t WHERE t.opening_balance <> 0
  UNION ALL SELECT ${OPENING_DATE}::date, '3010', '', t.opening_balance, 'OPENT', t.id, 'Opening', t.name FROM tailors t WHERE t.opening_balance <> 0

  -- Journal entries by the owner / CA.
  UNION ALL SELECT e.doc_date, l.account_code, '', l.debit - l.credit, 'JV', e.id, e.doc_no, COALESCE(l.note, e.narration)
    FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE e.status = 'POSTED'`
