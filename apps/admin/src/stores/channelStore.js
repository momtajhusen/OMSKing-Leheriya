import { create } from 'zustand';
import { CHANNEL_CATALOG } from '../constants/channelCatalog';

const emptyCreds = (channel) =>
  Object.fromEntries((channel.fields || []).map((f) => [f.key, '']));

function mapConnection(row, catalog, prev = {}) {
  const channel = catalog.find((c) => c.id === row.channel);
  return {
    status: row.status,
    lastTestOk: Boolean(row.lastTestOk),
    lastTestMode: row.lastTestMode || '',
    lastSync: row.lastTestAt || prev.lastSync || 'Never',
    lastTestMessage: row.lastTestMessage,
    failedJobs: prev.failedJobs || 0,
    savedSecretKeys: row.savedSecretKeys || prev.savedSecretKeys || [],
    credentials: {
      ...(channel ? Object.fromEntries(channel.fields.map((f) => [f.key, ''])) : {}),
      ...(prev.credentials || {}),
      ...(row.credentials || {}),
      warehouseCode: row.warehouseCode || row.credentials?.warehouseCode || prev.credentials?.warehouseCode || '',
      importOrdersFrom: row.importOrdersFrom
        ? String(row.importOrdersFrom).slice(0, 10)
        : (row.credentials?.importOrdersFrom || prev.credentials?.importOrdersFrom || ''),
    },
  };
}

const useChannelStore = create((set, get) => ({
  planId: 'enterprise',
  enabledIds: [],
  connections: {},
  catalog: CHANNEL_CATALOG,
  loaded: false,
  full: false,
  statusError: false,

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

  clearCompany() {
    set({ enabledIds: [], connections: {}, loaded: false, full: false, statusError: false });
  },

  /**
   * partial: merge rows (status poll, save, test) so one channel never wipes the others.
   * full list (GET /channels): replace so disconnects disappear.
   * An empty full replace is ignored when we already have connections (failed/blank response).
   */
  hydrateFromServer: (rows, { partial = false } = {}) => {
    const list = rows || [];
    const { catalog, connections, enabledIds, full } = get();
    if (!partial && !list.length && Object.keys(connections).length) return;
    const nextConn = partial ? { ...connections } : {};
    const nextEnabled = partial ? [...enabledIds] : [];
    list.forEach((row) => {
      if (!row?.channel) return;
      if (!nextEnabled.includes(row.channel)) nextEnabled.push(row.channel);
      nextConn[row.channel] = mapConnection(row, catalog, nextConn[row.channel] || {});
    });
    set({
      connections: nextConn,
      enabledIds: nextEnabled,
      loaded: true,
      full: partial ? full : true,
      statusError: false,
    });
  },
}));

export default useChannelStore;
