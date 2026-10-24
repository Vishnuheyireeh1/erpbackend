import { prisma } from '../../config/prisma'
import type { Prisma } from '../../generated/prisma/client'
import { monthRange } from '../reports/workshop.report'
import { earnedRows } from '../workshop/tailor.statement'

// Shop profit & loss for a period (all amounts before GST — GST is not the shop's money).
//   Income        = goods sold (counter + items sold on jobs − returns) + stitching charges + brand stitching (delivery bills)
//                   + training fees received + other income
//   Cost of goods = stock cost of what was sold (− returned)
//   Direct costs  = per-piece worker pay + shop material used for stitching + job costs paid out + direct expenses
//   Shop expenses = indirect expenses by type + ALL staff salary (owner's choice: shop and workshop staff alike)
// Salaried staff (cutting master, hand work …) are NOT counted from jobs — their salary paid is the cost, as a shop
// expense in the month it is for. Only per-piece pay is a direct cost.

const r2 = (n: number) => Math.round(n * 100) / 100
const num = (v: Prisma.Decimal | number | null | undefined) => Number(v ?? 0)
type Sum = { v: Prisma.Decimal | null }[]

export async function profitAndLoss(q: { from?: string; to?: string }) {
  const { from, to } = monthRange(q)
  const range = { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) }

  const [sales, returns, returnCost, jobs, jobItems, used, entries, expenses, other, earned, pieceTailors, salaries, fees, adjust, brandBills, brandCloth] = await Promise.all([
    prisma.salesInvoice.aggregate({ where: { status: 'POSTED', docDate: range }, _sum: { taxableTotal: true, costTotal: true } }),
    prisma.salesReturn.aggregate({ where: { status: 'POSTED', docDate: range }, _sum: { taxableTotal: true } }),
    prisma.$queryRaw<Sum>`SELECT SUM(l.qty * l.unit_cost) AS v FROM sales_return_lines l JOIN sales_returns r ON r.id = l.return_id
      WHERE r.status = 'POSTED' AND r.doc_date BETWEEN ${from}::date AND ${to}::date`,
    // Stitching charges only (job total before GST minus the items sold on it) for jobs booked in the period.
    prisma.$queryRaw<Sum>`SELECT SUM(j.taxable_total - COALESCE((SELECT SUM(m.taxable) FROM job_materials m WHERE m.job_id = j.id AND NOT m.included), 0)) AS v
      FROM stitching_jobs j WHERE j.status <> 'CANCELLED' AND j.doc_date BETWEEN ${from}::date AND ${to}::date`,
    prisma.$queryRaw<{ taxable: Prisma.Decimal | null; cost: Prisma.Decimal | null }[]>`SELECT SUM(m.taxable) AS taxable, SUM(m.qty * m.unit_cost) AS cost
      FROM job_materials m JOIN stitching_jobs j ON j.id = m.job_id
      WHERE NOT m.included AND j.status <> 'CANCELLED' AND (m.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${from}::date AND ${to}::date`,
    prisma.$queryRaw<Sum>`SELECT SUM(m.qty * m.unit_cost) AS v FROM job_materials m JOIN stitching_jobs j ON j.id = m.job_id
      WHERE m.included AND j.status <> 'CANCELLED' AND (m.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${from}::date AND ${to}::date`,
    prisma.$queryRaw<Sum>`SELECT (SELECT COALESCE(SUM(amount), 0) FROM job_cost_entries WHERE paid_by = 'PAID' AND date BETWEEN ${from}::date AND ${to}::date)
      + (SELECT COALESCE(SUM(amount), 0) FROM brand_order_costs WHERE paid_by = 'PAID' AND date BETWEEN ${from}::date AND ${to}::date) AS v`,
    prisma.expense.groupBy({ by: ['categoryId'], where: { status: 'POSTED', docDate: range }, _sum: { amount: true } }),
    prisma.moneyMovement.aggregate({ where: { status: 'POSTED', kind: 'OTHER_INCOME', docDate: range }, _sum: { amount: true } }),
    earnedRows({ from, to, kind: ['JOB', 'BRD'] }), // production labour sits in stock cost until sold
    prisma.tailor.findMany({ where: { payType: 'PIECE' }, select: { id: true } }),
    prisma.$queryRaw<{ dept: string; v: Prisma.Decimal | null }[]>`SELECT s.dept::text AS dept, SUM(p.amount) AS v FROM salary_payments p JOIN staff s ON s.id = p.staff_id
      WHERE p.status = 'POSTED' AND p.month BETWEEN date_trunc('month', ${from}::date)::date AND ${to}::date GROUP BY 1`,
    prisma.feeReceipt.aggregate({ where: { status: 'POSTED', docDate: range }, _sum: { amount: true } }),
    // Stock written off (damaged, lost …) or found on a count — same figure as the books (Accounts).
    prisma.$queryRaw<Sum>`SELECT -SUM(m.value) AS v FROM stock_movements m JOIN stock_documents d ON d.id = m.ref_id AND d.status = 'POSTED'
      WHERE m.ref_type = 'ADJ' AND m.movement_date BETWEEN ${from}::date AND ${to}::date`,
    // Brands: delivery bills before GST (round off included, like the books) and our cloth used on brand orders.
    prisma.$queryRaw<Sum>`SELECT SUM(grand_total - cgst_total - sgst_total - igst_total) AS v FROM brand_bills
      WHERE status = 'POSTED' AND doc_date BETWEEN ${from}::date AND ${to}::date`,
    prisma.$queryRaw<{ sold: Prisma.Decimal | null; used: Prisma.Decimal | null }[]>`SELECT
        -SUM(value) FILTER (WHERE type IN ('SALE', 'SALE_RETURN')) AS sold, -SUM(value) FILTER (WHERE type NOT IN ('SALE', 'SALE_RETURN')) AS used
      FROM stock_movements WHERE ref_type = 'BRO' AND movement_date BETWEEN ${from}::date AND ${to}::date`,
  ])
  const salary = (d: string) => r2(num(salaries.find((s) => s.dept === d)?.v))

  const cats = await prisma.expenseCategory.findMany({ select: { id: true, name: true, kind: true } })
  const exp = expenses.map((e) => ({ ...cats.find((c) => c.id === e.categoryId)!, amount: num(e._sum.amount) }))
  const piece = new Set(pieceTailors.map((t) => t.id))

  const goodsSold = r2(num(sales._sum.taxableTotal) + num(jobItems[0]?.taxable) - num(returns._sum.taxableTotal))
  const stitching = r2(num(jobs[0]?.v))
  const otherIncome = r2(num(other._sum.amount))
  const training = r2(num(fees._sum.amount))
  const brands = r2(num(brandBills[0]?.v))
  const income = r2(goodsSold + stitching + brands + training + otherIncome)
  const costOfGoods = r2(num(sales._sum.costTotal) + num(jobItems[0]?.cost) - num(returnCost[0]?.v) + num(brandCloth[0]?.sold))

  const direct = [
    { name: 'Worker pay (per piece)', amount: r2(earned.filter((e) => piece.has(e.tailor_id)).reduce((s, e) => s + Number(e.labour), 0)) },
    { name: 'Shop material used for stitching', amount: r2(num(used[0]?.v) + num(brandCloth[0]?.used)) },
    { name: 'Job costs paid out', amount: r2(num(entries[0]?.v)) },
    { name: 'Stock adjustments (damage / count)', amount: r2(num(adjust[0]?.v)) },
    ...exp.filter((e) => e.kind === 'DIRECT').map((e) => ({ name: e.name, amount: r2(e.amount) })),
  ].filter((d) => d.amount !== 0)
  const directTotal = r2(direct.reduce((s, d) => s + d.amount, 0))
  const grossProfit = r2(income - costOfGoods - directTotal)

  const indirect = [{ name: 'Shop staff salary', amount: salary('SHOP') }, { name: 'Workshop staff salary', amount: salary('WORKSHOP') }, ...exp.filter((e) => e.kind === 'INDIRECT').map((e) => ({ name: e.name, amount: r2(e.amount) }))]
    .filter((d) => d.amount !== 0).sort((a, b) => b.amount - a.amount)
  const indirectTotal = r2(indirect.reduce((s, d) => s + d.amount, 0))
  const netProfit = r2(grossProfit - indirectTotal)

  return {
    from, to,
    income: { goodsSold, stitching, brands, training, otherIncome, total: income },
    costOfGoods,
    direct, directTotal,
    grossProfit,
    indirect, indirectTotal,
    netProfit,
    marginPct: income > 0 ? r2((netProfit / income) * 100) : 0,
  }
}
