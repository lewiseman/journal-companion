// The single snapshot published by the main process, plus the few things only the window knows.
export const store = {
  state: null,
  pairing: null, // { code, qr, expires } from companion.pair()
  joined: null, // { name, at } right after this window approved a phone
  listeners: new Set(),
};

export function publish(next) {
  if (next) store.state = next;
  if (!store.state) return;
  for (const listener of store.listeners) listener(store.state);
}

export const subscribe = (listener) => { store.listeners.add(listener); if (store.state) listener(store.state); };

export const busy = (state) => ['loading', 'working'].includes(state.status) || state.activity?.some((job) => ['queued', 'running'].includes(job.state));
