import ProductThumb from '../ui/ProductThumb';

export default function VendorProductThumb({ name, src, sku, size = 'sm', className }) {
  return <ProductThumb name={name} src={src} sku={sku} size={size} className={className} />;
}
