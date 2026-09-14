/**
 * One-way channel from "the refresh token is gone" to "show the login screen".
 * An interface, not a window event: both ends live in the DOM-free tier.
 */
export interface SignOutSignal {
  emit(): void;
  subscribe(handler: () => void): () => void;
}
