export function productVariantRows(products = []) {
  return products.flatMap((product) => {
    const variants = product.variants?.length ? product.variants : [null];
    return variants.map((variant) => ({ key: variant?.id || product.id, product, variant }));
  });
}

export function rowImage(product, variant) {
  return variant?.imageUrl || (product?.images || [])[0];
}

export function variantLabel(variant) {
  const attrs = variant?.variantAttributes || {};
  return [attrs.color, attrs.size].filter(Boolean).join(' / ');
}
