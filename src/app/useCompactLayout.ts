import { useEffect, useState } from 'react';

// Keep a phone's controls compact when it rotates into a short landscape viewport.
export const compactLayoutQuery = '(max-width: 640px), (max-width: 1000px) and (max-height: 500px)';

export function useCompactLayout() {
  const [compact, setCompact] = useState(() => window.matchMedia(compactLayoutQuery).matches);
  useEffect(() => {
    const media = window.matchMedia(compactLayoutQuery);
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return compact;
}
