import { Prisma } from '../../generated/prisma/client'
import { DOC_CTES, DOC_LINES } from './postings.docs'
import { MONEY_CTES, MONEY_LINES } from './postings.money'

// Every accounting entry of the shop, made on the fly from the documents (nothing is copied, so the books can
// never disagree with the bills). Each document's rows add up to zero; paise left over by rounding go to
// Round off (4900) — or Purchase charges & differences (5060) for purchases and their returns.
//
// Use as a table: SELECT … FROM (${POSTINGS}) p WHERE …   Columns: d, acct, party, amt (+ debit / − credit),
// src, ref_id, doc_no, memo.

export const POSTINGS = Prisma.sql`
  WITH ${DOC_CTES}, ${MONEY_CTES},
  base AS (
    ${DOC_LINES}
    UNION ALL
    ${MONEY_LINES}
  )
  SELECT d, acct, party, amt, src, ref_id, doc_no, memo FROM base WHERE amt <> 0
  UNION ALL
  SELECT d, CASE WHEN src IN ('PUR', 'DN') THEN '5060' ELSE '4900' END, '', -SUM(amt), src, ref_id, MAX(doc_no), 'Rounding'
    FROM base GROUP BY d, src, ref_id HAVING ABS(SUM(amt)) >= 0.005`

export type PostingRow = { d: Date; acct: string; party: string; amt: Prisma.Decimal; src: string; ref_id: number; doc_no: string; memo: string | null }
