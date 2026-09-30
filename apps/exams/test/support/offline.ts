/** Imported FIRST by every component test: the API client captures `globalThis.fetch` as the app's client module is built, so an unmocked call has to be refused before that happens. */
const NO_NETWORK = 'A component test reached the network. Mock the api method the screen calls.';

Object.defineProperty(globalThis, 'fetch', {
  value: () => Promise.reject(new Error(NO_NETWORK)),
  writable: true,
  configurable: true,
});
