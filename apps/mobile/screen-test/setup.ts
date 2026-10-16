// The API client takes `fetch` when its module loads, so the stub has to be in place before any test imports it.
process.env.EXPO_PUBLIC_API_URL = 'http://api.test';
globalThis.fetch = jest.fn();
// The question page is a native view jest has no binary for; the screen around it is what these tests read.
jest.mock('react-native-webview', () => ({ WebView: () => null }));
// The generic native-module stub reports no connection state at all; a phone online reports one.
jest.mock('expo-network', () => ({
  useNetworkState: () => ({ isConnected: true, isInternetReachable: true }),
}));
// The answer queue's synchronous SQLite store, held in memory for the length of a test file.
jest.mock('expo-sqlite/kv-store', () => {
  const held = new Map<string, string>();
  return {
    getItemSync: (key: string) => held.get(key) ?? null,
    setItemSync: (key: string, value: string) => void held.set(key, value),
    removeItemSync: (key: string) => held.delete(key),
  };
});
