import { prisma } from '../../config/prisma'

// Chart of accounts = built-in accounts (below, used by the automatic entries) + one account per expense type
// (code E<id>) + accounts the owner / CA added (ledger_accounts). Codes are what the postings use.

export type AccountKind = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'DIRECT_EXPENSE' | 'INDIRECT_EXPENSE'
export type Account = { id?: number; code: string; name: string; kind: AccountKind; hint: string; builtIn: boolean; party?: 'customer' | 'supplier' | 'tailor' | 'brand'; isActive: boolean }

const b = (code: string, name: string, kind: AccountKind, hint: string, party?: Account['party']): Account => ({ code, name, kind, hint, builtIn: true, party, isActive: true })

export const BUILT_IN: Account[] = [
  b('1000', 'Cash in hand', 'ASSET', 'Cash payments in and out'),
  b('1010', 'Bank (UPI / card / bank / cheque)', 'ASSET', 'Every payment that is not cash'),
  b('1100', 'Customers (sundry debtors)', 'ASSET', 'What customers owe — minus = advance we hold', 'customer'),
  b('1110', 'Brands — to receive', 'ASSET', 'What the brands we stitch for owe (delivery bills − money received)', 'brand'),
  b('1200', 'Stock', 'ASSET', 'Value of goods in the shop at cost'),
  b('1300', 'GST paid on purchases (input)', 'ASSET', 'GST on purchase bills — set off against GST collected'),
  b('2000', 'Suppliers (sundry creditors)', 'LIABILITY', 'What we owe suppliers', 'supplier'),
  b('2100', 'Workers — pay due', 'LIABILITY', 'Per-piece pay earned by tailors / workers, not yet paid', 'tailor'),
  b('2200', 'GST collected on sales (output)', 'LIABILITY', 'GST on bills — to pay the government'),
  b('2300', 'Salary payable', 'LIABILITY', 'Salary of a month not yet paid'),
  b('2400', 'Freight payable (to pay)', 'LIABILITY', 'Transport charge on purchases paid separately'),
  b('3000', 'Capital added', 'EQUITY', 'Money put into the shop from outside (Money in / out)'),
  b('3010', 'Opening balances (go-live)', 'EQUITY', 'Balances brought in on the first day: cash, bank, stock, dues'),
  b('3100', 'Owner drawings', 'EQUITY', 'Money the owner took out'),
  b('4000', 'Shop sales', 'INCOME', 'Readymade, fabric and materials sold (counter + on jobs), before GST'),
  b('4010', 'Sales returns', 'INCOME', 'Goods customers returned (reduces sales)'),
  b('4100', 'Stitching charges', 'INCOME', 'Stitching job charges, before GST'),
  b('4110', 'Brand stitching income', 'INCOME', 'Delivery bills to brands (stitching + our cloth on them), before GST'),
  b('4200', 'Training fees', 'INCOME', 'Fees received from students'),
  b('4300', 'Other income', 'INCOME', 'Money in that is not a sale'),
  b('4900', 'Round off', 'INCOME', 'Paise rounded on bills'),
  b('5000', 'Cost of goods sold', 'DIRECT_EXPENSE', 'Stock cost of what was sold'),
  b('5010', 'Material used for stitching', 'DIRECT_EXPENSE', 'Shop fabric / material used free on jobs'),
  b('5020', 'Worker pay (per piece)', 'DIRECT_EXPENSE', 'Per-piece pay to our tailors / workers, when a job is Ready'),
  b('5030', 'Job costs paid out', 'DIRECT_EXPENSE', 'Embroidery, hand work … paid for jobs'),
  b('5045', 'Salaried worker pay', 'DIRECT_EXPENSE', 'Worker payments to people on salary'),
  b('5050', 'Stock adjustments (damage / count)', 'DIRECT_EXPENSE', 'Stock written off or found (minus = gain)'),
  b('5060', 'Purchase charges & differences', 'DIRECT_EXPENSE', 'Purchase rounding and returned charges'),
  b('6000', 'Shop staff salary', 'INDIRECT_EXPENSE', 'Sales and counter staff'),
  b('6010', 'Workshop staff salary', 'INDIRECT_EXPENSE', 'Cutting master, salaried tailors … (only per-piece pay is a direct cost)'),
]

export const KIND_LABEL: Record<AccountKind, string> = {
  ASSET: 'What the shop owns (assets)',
  LIABILITY: 'What the shop owes (liabilities)',
  EQUITY: 'Net worth (capital)',
  INCOME: 'Income',
  DIRECT_EXPENSE: 'Direct costs',
  INDIRECT_EXPENSE: 'Shop expenses (indirect)',
}

// Normal side: assets and expenses grow on the debit side, the rest on the credit side.
export const debitNature = (k: AccountKind) => k === 'ASSET' || k === 'DIRECT_EXPENSE' || k === 'INDIRECT_EXPENSE'
export const isProfitAndLoss = (k: AccountKind) => k === 'INCOME' || k === 'DIRECT_EXPENSE' || k === 'INDIRECT_EXPENSE'

// Every account, in chart order.
export async function loadChart(): Promise<Account[]> {
  const [cats, own] = await Promise.all([
    prisma.expenseCategory.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    prisma.ledgerAccount.findMany({ orderBy: { code: 'asc' } }),
  ])
  // Expense types are accounts too (E<id>): direct / indirect cost — or an ASSET type (AC, machine …) = what the shop owns.
  const expenses: Account[] = cats.map((c) => ({
    code: `E${c.id}`, name: c.name, kind: c.kind === 'ASSET' ? 'ASSET' : c.kind === 'DIRECT' ? 'DIRECT_EXPENSE' : 'INDIRECT_EXPENSE',
    hint: c.kind === 'ASSET' ? 'Asset type — bought on the Expenses page (what the shop owns)' : 'Expense type — typed on the Expenses page', builtIn: true, isActive: c.isActive,
  }))
  const added: Account[] = own.map((a) => ({ id: a.id, code: a.code, name: a.name, kind: a.kind, hint: a.notes ?? 'Added by you', builtIn: false, isActive: a.isActive }))
  const order: AccountKind[] = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'DIRECT_EXPENSE', 'INDIRECT_EXPENSE']
  return [...BUILT_IN, ...expenses, ...added].sort((x, y) => order.indexOf(x.kind) - order.indexOf(y.kind))
}

export async function accountMap() {
  return new Map((await loadChart()).map((a) => [a.code, a]))
}
