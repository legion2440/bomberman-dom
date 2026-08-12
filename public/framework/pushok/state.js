/**
 * PushOK state store. Notifications are coalesced into one microtask.
 */
export function createStore(initialState = {}) {
  let state = { ...initialState };
  const listeners = new Set();
  let notificationScheduled = false;

  function scheduleNotification() {
    if (notificationScheduled) return;
    notificationScheduled = true;
    queueMicrotask(() => {
      notificationScheduled = false;
      for (const listener of [...listeners]) listener(state);
    });
  }

  return {
    getState() {
      return state;
    },

    setState(update) {
      const patch = typeof update === "function" ? update(state) : update;
      if (!patch) return;

      const next = { ...state, ...patch };
      if (isShallowEqual(state, next)) return;

      state = next;
      scheduleNotification();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function isShallowEqual(a, b) {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => a[key] === b[key]);
}
