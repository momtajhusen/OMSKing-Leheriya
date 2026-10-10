import { useEffect, useMemo } from 'react';
import api from '../lib/api';
import { connectedCatalog } from '../lib/connectedChannels';
import { orderChannelLabel } from '../constants/channelCatalog';
import useChannelStore from '../stores/channelStore';

let inflight = null;

export function loadConnectedChannels() {
  const state = useChannelStore.getState();
  if (state.loaded) return Promise.resolve();
  if (!inflight) {
    inflight = api.get('/channels/status')
      .then(({ data }) => useChannelStore.getState().hydrateFromServer(data.data || [], { partial: true }))
      .catch(() => {
        if (!useChannelStore.getState().full) useChannelStore.setState({ loaded: true, statusError: true });
      })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

export default function useConnectedChannels() {
  const connections = useChannelStore((s) => s.connections);
  const loaded = useChannelStore((s) => s.loaded);

  useEffect(() => {
    loadConnectedChannels();
  }, []);

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
