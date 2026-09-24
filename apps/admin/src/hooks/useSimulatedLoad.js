import { useEffect, useState } from 'react';

export function useSimulatedLoad(key, ms = 260) {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const timer = setTimeout(() => setLoading(false), ms);
    return () => clearTimeout(timer);
  }, [key, ms]);

  return loading;
}
