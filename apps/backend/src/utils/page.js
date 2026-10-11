const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/** Page only when the client asks. Callers that omit page still receive the full list. */
function pageOf(rows, query = {}) {
  const list = rows || [];
  const total = list.length;
  const asked = query.page !== undefined && query.page !== null && String(query.page) !== '';
  if (!asked) return { rows: list, page: 1, limit: total || DEFAULT_LIMIT, total };
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(query.limit, 10) || DEFAULT_LIMIT));
  const start = (page - 1) * limit;
  return { rows: list.slice(start, start + limit), page, limit, total };
}

function pageRequest(query = {}) {
  const asked = query.page !== undefined && query.page !== null && String(query.page) !== '';
  if (!asked) return null;
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(query.limit, 10) || DEFAULT_LIMIT));
  return { page, limit, skip: (page - 1) * limit };
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { pageOf, pageRequest, escapeRegex, DEFAULT_LIMIT, MAX_LIMIT };
