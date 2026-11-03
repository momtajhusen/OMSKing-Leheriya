const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** True when the app is opened on this machine (localhost / 127.0.0.1 / ::1); developer-only tools render only then. */
export function isLocalHost(hostname) {
  return LOCAL_HOSTS.has(String(hostname || '').toLowerCase());
}
