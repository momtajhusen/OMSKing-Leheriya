import { useEffect, useMemo } from 'react';
import api from '../lib/api';
import { connectedCatalog } from '../lib/connectedChannels';
import { orderChannelLabel } from '../constants/channelCatalog';
import useChannelStore from '../stores/channelStore';

let inflight = null;

/** Load / refresh channel connection status. force=true always hits the API (Dashboard / Orders). */
export function loadConnectedChannels({ force = false } = {}) {
  const state = useChannelStore.getState();
  if (!force && state.loaded) return Promise.resolve();
  if (!force && inflight) return inflight;

  const req = api.get('/channels/status')
    .then(({ data }) => useChannelStore.getState().hydrateFromServer(data.data || [], { partial: true }))
    .catch(() => {
      if (!useChannelStore.getState().full) useChannelStore.setState({ loaded: true, statusError: true });
    })
    .finally(() => { if (inflight === req) inflight = null; });

  if (!force) inflight = req;
  return req;
}

export default function useConnectedChannels({ refresh = false } = {}) {
  const connections = useChannelStore((s) => s.connections);
  const loaded = useChannelStore((s) => s.loaded);

  useEffect(() => {
    loadConnectedChannels({ force: refresh });
  }, [refresh]);

  const channels = useMemo(
    () => (loaded ? connectedCatalog(connections) : []),
    [connections, loaded],
  );

  return {
    channels,
    loaded,
    labels: channels.map(orderChannelLabel),
    ids: channels.map((channel) => channel.id),
  };
}
