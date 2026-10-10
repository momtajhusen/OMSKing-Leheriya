import { useEffect } from 'react';
import api from '../../lib/api';
import useOrderStore from '../../stores/orderStore';
import useProductImageStore from '../../lib/productImageStore';

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
  const hydrateFromApi = useOrderStore((state) => state.hydrateFromApi);

  useEffect(() => {
    hydrateFromApi();
  }, [hydrateFromApi]);

  useEffect(() => {
    remember(pairsFromOrders(orders));
  }, [orders, remember]);

  useEffect(() => {
    let cancel = false;
    (async () => {
      const pairs = [];
      try {
        const { data } = await api.get('/products');
        for (const product of data.data || []) {
          const url = (product.images || [])[0];
          pairs.push([product.name, url]);
          for (const variant of product.variants || []) {
            pairs.push([variant.code, url]);
            pairs.push([variant.name, url]);
          }
        }
      } catch {
        // This role cannot open the catalog. Order lines still fill the index.
      }
      try {
        const { data } = await api.get('/master-skus');
        for (const sku of data.data || []) {
          pairs.push([sku.code, sku.imageUrl]);
          pairs.push([sku.name, sku.imageUrl]);
        }
      } catch {
        // Vendor stock uses the order lines already loaded.
      }
      if (!cancel) remember(pairs);
    })();
    return () => { cancel = true; };
  }, [remember]);

  return null;
}
