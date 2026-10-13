import { useCallback, useEffect, useState } from 'react';
import api, { apiError } from '../../lib/api';
import SetupGuide from '../../components/setup/SetupGuide';

export default function SetupGuidePage() {
  const [checklist, setChecklist] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api.get('/setup/checklist')
      .then(({ data }) => setChecklist(data.data))
      .catch((err) => setError(apiError(err, 'Could not check setup')))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <SetupGuide
      title="Merchant setup"
      subtitle="Work from the top. Each tick is checked from this company’s saved profile, warehouses, channels, catalog, and stock."
      loading={loading}
      error={error}
      checklist={checklist}
      onRefresh={load}
    />
  );
}
