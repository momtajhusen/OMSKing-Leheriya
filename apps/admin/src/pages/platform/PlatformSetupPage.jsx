import { useCallback, useEffect, useState } from 'react';
import api, { apiError } from '../../lib/api';
import SetupGuide from '../../components/setup/SetupGuide';

export default function PlatformSetupPage() {
  const [checklist, setChecklist] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api.get('/tenants/setup-checklist')
      .then(({ data }) => setChecklist(data.data))
      .catch((err) => setError(apiError(err, 'Could not check platform setup')))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-4 sm:p-6">
      <SetupGuide
      title="Platform setup"
      subtitle="These checks cover the shared server: database, encryption, queue, mail, and the first subscriber. Open a merchant to finish that company’s own guide."
      loading={loading}
      error={error}
      checklist={checklist}
      onRefresh={load}
    />
    </div>
  );
}
