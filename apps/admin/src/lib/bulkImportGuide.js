export const BULK_IMPORT_GUIDE = {
  purpose: [
    'Bring your whole product catalog into OMSKing in one go, instead of adding products one by one.',
    'Link the same product sold on Shopify, Myntra and Amazon to one Master SKU, so orders from every channel point at the same product and the same stock.',
    'Use it when you first set up OMSKing, when you add new products on a channel, or when channel SKUs show as Unmapped.',
  ],
  steps: [
    {
      title: 'Shopify first',
      text: 'Pull or upload the Shopify catalog. Each new row creates a Master SKU. Variants with the same channelProductId stay under one product.',
    },
    {
      title: 'Myntra next',
      text: 'A Myntra row with the same seller SKU or barcode as a Shopify product is linked to that Master SKU automatically (auto-mapped). No match stays Unmapped. If Shopify is not connected, Myntra rows create the Master SKUs instead.',
    },
    {
      title: 'Amazon last',
      text: 'A matching seller SKU or barcode is auto-mapped. Amazon never creates a new Master SKU, so a row with no match stays Unmapped.',
    },
    {
      title: 'Check and finish',
      text: 'Read the result table below. Open SKU mapping to link any Unmapped rows to the right Master SKU by hand.',
    },
  ],
  sources: [
    {
      label: 'Pull live catalog',
      text: 'Reads the products from a connected channel. Nothing is changed on the channel.',
    },
    {
      label: 'Upload CSV',
      text: 'For a channel that is not connected yet, or a file you exported. Use Download template for the column format.',
    },
  ],
  results: [
    { label: 'Created', text: 'A new Master SKU was made from this row.' },
    { label: 'Auto-mapped', text: 'Linked to an existing Master SKU by the same seller SKU or barcode.' },
    { label: 'Unmapped', text: 'No matching Master SKU was found. Link it in SKU mapping.' },
    { label: 'Exists', text: 'Already imported earlier. Title and price were updated, nothing new was created.' },
    { label: 'Failed', text: 'The row could not be imported. The reason is shown next to it.' },
  ],
  notes: [
    'Import never creates or changes stock. Set stock quantities in Inventory.',
    'Importing the same file again is safe: rows already imported are only updated.',
  ],
};
