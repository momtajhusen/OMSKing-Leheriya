import ProductThumb from '../ui/ProductThumb';

export default function VendorProductThumb({ name, src, size = 'sm', className }) {
  return <ProductThumb name={name} src={src} size={size} className={className} />;
}
