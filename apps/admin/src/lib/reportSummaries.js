import { useEffect, useState } from 'react';
import api from './api';
import { isLocalApp } from './reportChat.js';

const REFRESH_MS = 30000;

/** Issue / fix summary of each completed Report task, by message id, from the local TASKS.md (localhost only). */
export function useTaskSummaries() {
  const [summaries, setSummaries] = useState({});

  useEffect(() => {
    if (!isLocalApp()) return undefined;
    let alive = true;
    const load = () => api.get('/dev/report-autofix/summaries')
      .then((res) => { if (alive) setSummaries(res.data?.data || {}); })
      .catch(() => {});
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  return summaries;
}


/** Stage and English reason of every open report task, from the local task list (localhost only); {} elsewhere. */
export function useTaskReasons() {
  const [reasons, setReasons] = useState({});

  useEffect(() => {
    if (!isLocalApp()) return undefined;
    let alive = true;
    const load = () => api.get('/dev/report-autofix/reasons')
      .then((res) => { if (alive) setReasons(res.data?.data || {}); })
      .catch(() => {});
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  return reasons;
}
