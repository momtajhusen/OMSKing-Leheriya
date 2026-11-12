import { useCallback, useEffect, useState } from 'react';

// Safari before 16.4 only has the webkit-prefixed Fullscreen API.
function fullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

function fullscreenSupported() {
  return typeof document !== 'undefined' && Boolean(document.fullscreenEnabled || document.webkitFullscreenEnabled);
}

export default function useFullscreen() {
  const [active, setActive] = useState(() => fullscreenSupported() && Boolean(fullscreenElement()));

  useEffect(() => {
    if (!fullscreenSupported()) return undefined;
    const sync = () => setActive(Boolean(fullscreenElement()));
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
    };
  }, []);

  const toggle = useCallback(async () => {
    try {
      if (fullscreenElement()) {
        await (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      } else {
        const root = document.documentElement;
        await (root.requestFullscreen || root.webkitRequestFullscreen).call(root);
      }
    } catch {
      // The browser refused (e.g. not triggered by a click); leave the page as it is.
    }
  }, []);

  return { supported: fullscreenSupported(), active, toggle };
}
