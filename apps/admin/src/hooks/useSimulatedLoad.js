import { useEffect, useState } from 'react';

export function useSimulatedLoad(key, ms = 420) {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const timer = setTimeout(() => setLoading(false), ms);
    return () => clearTimeout(timer);
  }, [key, ms]);

  return loading;
}
