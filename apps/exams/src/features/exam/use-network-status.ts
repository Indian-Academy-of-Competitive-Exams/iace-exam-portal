import { useEffect, useState } from 'react';

export function useNetworkStatus(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const wentOnline = () => setOnline(true);
    const wentOffline = () => setOnline(false);
    window.addEventListener('online', wentOnline);
    window.addEventListener('offline', wentOffline);
    return () => {
      window.removeEventListener('online', wentOnline);
      window.removeEventListener('offline', wentOffline);
    };
  }, []);

  return online;
}
