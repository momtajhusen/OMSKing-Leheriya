export const PACKAGE_SOURCE = { order: 'This order', product: 'Product', default: 'Default' };

export function packageWeight(pack) {
  return Number(pack?.weightKg) > 0 ? `${pack.weightKg} kg` : '—';
}

export function packageSize(pack) {
  if (!pack || !(Number(pack.lengthCm) || Number(pack.breadthCm) || Number(pack.heightCm))) return '—';
  return `${pack.lengthCm || 0} × ${pack.breadthCm || 0} × ${pack.heightCm || 0} cm`;
}

export function packageForm(pack) {
  const value = (num) => (Number(num) > 0 ? String(num) : '');
  return {
    weightKg: value(pack?.weightKg),
    lengthCm: value(pack?.lengthCm),
    breadthCm: value(pack?.breadthCm),
    heightCm: value(pack?.heightCm),
  };
}
