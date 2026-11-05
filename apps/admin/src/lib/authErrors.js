/** Only the server saying no ends the session; an unreachable or restarting backend keeps the login. */
export function sessionRejected(err) {
  const status = err?.response?.status;
  return status === 401 || status === 403;
}

/** No answer, or a 5xx without the API's own JSON message: the backend is down or restarting (e.g. after Apply fix). */
export function serverRestarting(err) {
  if (!err?.response) return true;
  const { status, data } = err.response;
  return status >= 500 && !(data && typeof data === 'object' && data.message);
}
