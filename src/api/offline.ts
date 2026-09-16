/**
 * Offline detection.
 *
 * Office wifi in the brief drops for ~20s at a time. When that happens the client
 * must STOP hammering (every failed request still costs rate-limit budget and
 * battery), TELL the user, and RECOVER when the link returns. This is a small
 * framework-agnostic observable of online state; TanStack Query's `onlineManager`
 * is wired to it (see ./queryClient) so queries pause and resume automatically,
 * and the UI can subscribe for a banner.
 *
 * Deliberate scope: we trust the browser's `online`/`offline` events and
 * `navigator.onLine`, and do NOT flip to "offline" on an isolated fetch failure.
 * A single 503 or 500 is chaos, not a dropped link; treating every network error
 * as offline would false-positive constantly and hide real backend errors behind
 * an offline banner. Queueing writes made while offline is a bonus and is NOT
 * implemented here (see SUBMISSION.md).
 */

type Listener = (online: boolean) => void;

class OnlineState {
  private online: boolean;
  private readonly listeners = new Set<Listener>();

  constructor() {
    this.online = typeof navigator === 'undefined' ? true : navigator.onLine;
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.set(true));
      window.addEventListener('offline', () => this.set(false));
    }
  }

  get isOnline(): boolean {
    return this.online;
  }

  get isOffline(): boolean {
    return !this.online;
  }

  /** Update state and notify only on an actual transition. */
  set(online: boolean): void {
    if (online === this.online) return;
    this.online = online;
    for (const listener of this.listeners) listener(online);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

/** Singleton online-state observable for the whole client. */
export const onlineState = new OnlineState();

export const isOffline = (): boolean => onlineState.isOffline;
export const isOnline = (): boolean => onlineState.isOnline;

/** Subscribe to online/offline transitions; returns an unsubscribe fn. */
export const subscribeOnline = (listener: Listener): (() => void) => onlineState.subscribe(listener);
