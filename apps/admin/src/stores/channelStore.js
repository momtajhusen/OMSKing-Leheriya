import { create } from 'zustand';
import { CHANNEL_CATALOG } from '../mocks/channels';

const emptyCreds = (channel) =>
  Object.fromEntries((channel.fields || []).map((f) => [f.key, '']));

const useChannelStore = create((set, get) => ({
  planId: 'enterprise',
  enabledIds: [],
  connections: {},
  catalog: CHANNEL_CATALOG,

  enabledChannels: () => CHANNEL_CATALOG.filter((c) => get().enabledIds.includes(c.id)),

  addChannel: (id) => {
    const { enabledIds, connections, catalog } = get();
    if (!id || enabledIds.includes(id)) return;
    const channel = catalog.find((c) => c.id === id);
    if (!channel) return;
    set({
      enabledIds: [...enabledIds, id],
      connections: {
        ...connections,
        [id]: connections[id] || {
          status: 'Not configured',
          lastSync: 'Never',
          failedJobs: 0,
          credentials: emptyCreds(channel),
        },
      },
    });
  },

  removeChannel: (id) => {
    set({ enabledIds: get().enabledIds.filter((x) => x !== id) });
  },

  saveCredentials: (id, credentials) => {
    const { connections } = get();
    set({
      connections: {
        ...connections,
        [id]: {
          ...(connections[id] || {}),
          credentials,
          status: 'saved',
        },
      },
    });
  },

  hydrateFromServer: (rows) => {
    const { connections, enabledIds, catalog } = get();
    const nextConn = { ...connections };
    const nextEnabled = [...enabledIds];
    (rows || []).forEach((row) => {
      if (!row?.channel) return;
      if (!nextEnabled.includes(row.channel)) nextEnabled.push(row.channel);
      const channel = catalog.find((c) => c.id === row.channel);
      nextConn[row.channel] = {
        status: row.status,
        lastSync: row.lastTestAt || 'Never',
        lastTestMessage: row.lastTestMessage,
        failedJobs: 0,
        credentials: {
          ...(channel ? Object.fromEntries(channel.fields.map((f) => [f.key, ''])) : {}),
          ...(row.credentials || {}),
          warehouseCode: row.warehouseCode || row.credentials?.warehouseCode || '',
          importOrdersFrom: row.importOrdersFrom ? String(row.importOrdersFrom).slice(0, 10) : '',
        },
      };
    });
    set({ connections: nextConn, enabledIds: nextEnabled });
  },
}));

export default useChannelStore;
