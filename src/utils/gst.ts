// GST helpers: state codes (first 2 digits of a GSTIN) and GSTIN validation.

export const gstStates: Record<string, string> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh',
  '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh',
  '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur',
  '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal',
  '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
  '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka',
  '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh',
}

const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/
const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'

// Official GSTIN check character (base-36 weighted sum of the first 14 characters).
function checkChar(first14: string) {
  let sum = 0
  for (let i = 0; i < 14; i++) {
    const product = CHARS.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2)
    sum += Math.floor(product / 36) + (product % 36)
  }
  return CHARS[(36 - (sum % 36)) % 36]
}

// Returns an error message, or null when the GSTIN is valid.
export function gstinError(gstin: string) {
  if (!GSTIN_PATTERN.test(gstin)) return 'GSTIN must be 15 characters like 32ABCDE1234F1Z5'
  if (!gstStates[gstin.slice(0, 2)]) return `GSTIN starts with an unknown state code (${gstin.slice(0, 2)})`
  if (checkChar(gstin.slice(0, 14)) !== gstin[14]) return 'GSTIN check digit is wrong — please re-check it'
  return null
}

// Same state → CGST + SGST; different state → IGST.
export function taxModeFor(businessState: string, partyState: string | null | undefined) {
  return !partyState || partyState === businessState ? 'INTRA' : 'INTER'
}
