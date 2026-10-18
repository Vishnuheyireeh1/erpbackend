// Generated codes: product code, SKU and EAN-13 barcode.

// P000001
export function productCode(n: number) {
  return `P${String(n).padStart(6, '0')}`
}

// "Navy blue" → "NAVYBLUE"; keeps SKUs short and scanner-friendly.
function skuPart(text: string) {
  return text.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10)
}

// P000001 · P000001-M · P000001-M-RED · P000001-RED
export function variantSku(code: string, sizeName?: string | null, colourName?: string | null) {
  return [code, sizeName && skuPart(sizeName), colourName && skuPart(colourName)]
    .filter(Boolean)
    .join('-')
}

// EAN-13 check digit (weights 1,3,1,3 … on the first 12 digits).
export function ean13CheckDigit(first12: string) {
  const sum = [...first12].reduce((acc, d, i) => acc + Number(d) * (i % 2 === 0 ? 1 : 3), 0)
  return String((10 - (sum % 10)) % 10)
}

// In-store barcode: prefix "20" (reserved for internal use, never clashes with
// real brand barcodes) + 10-digit running number + check digit.
export function internalEan13(n: number) {
  const first12 = `20${String(n).padStart(10, '0')}`
  return first12 + ean13CheckDigit(first12)
}
