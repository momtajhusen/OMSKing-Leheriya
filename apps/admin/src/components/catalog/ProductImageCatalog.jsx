import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import useOrderStore from '../../stores/orderStore';
import useProductImageStore, { pageShowsProductPhotos } from '../../lib/productImageStore';

function pairsFromOrders(orders) {
  const pairs = [];
  const add = (key, url) => { if (key && url) pairs.push([key, url]); };
  for (const order of orders || []) {
    for (const item of order.items || []) {
      add(item.sku, item.imageUrl || item.image);
      add(item.name, item.imageUrl || item.image);
    }
    for (const sub of order.subOrders || []) {
      add(sub.sku, sub.imageUrl);
      add(sub.title, sub.imageUrl);
    }
    for (const line of order.channelLines || []) add(line.sku, line.imageUrl);
  }
  return pairs;
}

/** Loads one photo per SKU so every screen can show it, whichever channel or role opened the page. */
export default function ProductImageCatalog() {
  const remember = useProductImageStore((state) => state.remember);
  const orders = useOrderStore((state) => state.orders);
  const { pathname } = useLocation();
  const showPhotos = pageShowsProductPhotos(pathname);

  useEffect(() => {
    if (!showPhotos) return;
    remember(pairsFromOrders(orders));
  }, [orders, remember, showPhotos]);

  return null;
}
