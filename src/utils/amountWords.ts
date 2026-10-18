// ₹ amount in Indian words (lakh / crore), as printed on bills:
// 3310 → "Three Thousand Three Hundred Ten Only", 125000.5 → "One Lakh Twenty Five Thousand Rupees and Fifty Paise Only"

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

function twoDigits(n: number) {
  return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`
}

function threeDigits(n: number) {
  const h = Math.floor(n / 100)
  const rest = n % 100
  return [h ? `${ONES[h]} Hundred` : '', rest ? twoDigits(rest) : ''].filter(Boolean).join(' ')
}

function wholeWords(n: number): string {
  if (n === 0) return 'Zero'
  const parts: string[] = []
  const crore = Math.floor(n / 10_000_000)
  const lakh = Math.floor((n % 10_000_000) / 100_000)
  const thousand = Math.floor((n % 100_000) / 1000)
  const rest = n % 1000
  if (crore) parts.push(`${wholeWords(crore)} Crore`)
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`)
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`)
  if (rest) parts.push(threeDigits(rest))
  return parts.join(' ')
}

export function amountInWords(amount: number) {
  const abs = Math.abs(Math.round(amount * 100))
  const rupees = Math.floor(abs / 100)
  const paise = abs % 100
  const sign = amount < 0 ? 'Minus ' : ''
  if (!paise) return `${sign}${wholeWords(rupees)} Only`
  return `${sign}${wholeWords(rupees)} Rupees and ${twoDigits(paise)} Paise Only`
}
