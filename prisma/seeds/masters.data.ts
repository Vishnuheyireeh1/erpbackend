// SAMPLE master data for a boutique — edit or delete freely in the app (Masters page).

export const categoryTree: Record<string, string[]> = {
  Sarees: ['Silk sarees', 'Cotton sarees', 'Designer sarees'],
  Kurtis: ['Casual kurtis', 'Party wear kurtis'],
  'Churidar and salwar': ['Churidar sets', 'Salwar sets'],
  Blouses: ['Readymade blouses', 'Blouse materials'],
  Fabrics: ['Cotton', 'Silk', 'Georgette', 'Lining'],
  Accessories: ['Buttons', 'Zips', 'Laces', 'Threads'],
  'Kids wear': ['Frocks', 'Pavada sets'],
  Services: ['Stitching', 'Alteration', 'Embroidery'],
}

export const brands = ['Sairandhri Originals', 'Unbranded']

export const units = [
  { name: 'Piece', code: 'pc', allowDecimal: false },
  { name: 'Metre', code: 'm', allowDecimal: true },
  { name: 'Kilogram', code: 'kg', allowDecimal: true },
  { name: 'Set', code: 'set', allowDecimal: false },
  { name: 'Pair', code: 'pair', allowDecimal: false },
  { name: 'Box', code: 'box', allowDecimal: false },
  { name: 'Roll', code: 'roll', allowDecimal: false },
]

export const sizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', 'Free size'].map((name, i) => ({
  name,
  sortOrder: (i + 1) * 10,
}))

export const colours = [
  { name: 'Red', hexCode: '#C62828' },
  { name: 'Maroon', hexCode: '#7A1E3A' },
  { name: 'Pink', hexCode: '#E91E63' },
  { name: 'Orange', hexCode: '#EF6C00' },
  { name: 'Yellow', hexCode: '#FBC02D' },
  { name: 'Gold', hexCode: '#C9A24A' },
  { name: 'Cream', hexCode: '#F3E5C8' },
  { name: 'White', hexCode: '#FFFFFF' },
  { name: 'Black', hexCode: '#1A1A1D' },
  { name: 'Navy blue', hexCode: '#1A237E' },
  { name: 'Green', hexCode: '#2E7D32' },
  { name: 'Purple', hexCode: '#6A1B9A' },
  { name: 'Multicolour', hexCode: null },
]

// GST slabs after the Sept 2025 rate change (12% and 28% removed).
// Verify with the client's accountant before go-live.
export const taxRates = [
  { name: 'GST 0%', rate: 0 },
  { name: 'GST 5%', rate: 5 },
  { name: 'GST 18%', rate: 18 },
]
