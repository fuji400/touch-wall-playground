/* Keep an actively viewed effect awake when the browser grants a screen lock. */
'use strict';
window.WallWake = (() => {
  let enabled = true, started = false, running = false, pageActive = true;
  let lock = null, pending = null, generation = 0, state = 'idle';
  const supported = !!(window.isSecureContext && navigator.wakeLock?.request);
  const messages = {
    idle: 'Requested while an effect is running and this page is visible.',
    off: 'Screen wake prevention is off.',
    requesting: 'Requesting screen wake prevention…',
    active: 'Screen wake prevention is active.',
    paused: 'Paused while this page is hidden.',
    unsupported: 'This browser cannot request a screen wake lock. Use a current Safari tab, or adjust Auto-Lock in device settings if available.',
    denied: 'The browser or device declined screen wake prevention. You can retry; power-saving or device settings may prevent it.',
    released: 'The browser or device released screen wake prevention. You can retry; the screen may dim.'
  };
  function publish(next) {
    state = next;
    window.dispatchEvent(new Event('wall-wake'));
  }
  const wanted = () => enabled && started && running && pageActive && document.visibilityState === 'visible';
  function release(sentinel) {
    try { Promise.resolve(sentinel.release()).catch(() => {}); } catch {}
  }
  function reconcile() {
    if (!wanted()) {
      generation++;
      const old = lock; lock = null;
      if (old) release(old);
      publish(!enabled ? 'off' : !pageActive || document.visibilityState !== 'visible' ? 'paused' : 'idle');
      return Promise.resolve(false);
    }
    if (!supported) { publish('unsupported'); return Promise.resolve(false); }
    if (lock && !lock.released) { publish('active'); return Promise.resolve(true); }
    if (pending) return pending;
    const ticket = generation;
    publish('requesting');
    // Defer invocation so synchronous API failures use the same caught path.
    pending = Promise.resolve().then(() => navigator.wakeLock.request('screen')).then(sentinel => {
      if (ticket !== generation || !wanted()) { release(sentinel); return false; }
      if (sentinel.released) { publish('released'); return false; }
      lock = sentinel;
      sentinel.addEventListener('release', () => {
        if (lock !== sentinel) return;
        lock = null;
        // No retry loop: the OS may have released it for battery or policy reasons.
        if (wanted()) publish('released');
      });
      publish('active');
      return true;
    }).catch(() => {
      if (ticket === generation && wanted()) publish('denied');
      return false;
    }).finally(() => {
      pending = null;
      // A hidden/visible or stop/start transition may have invalidated this request.
      if (ticket !== generation && wanted()) reconcile();
    });
    return pending;
  }
  document.addEventListener('visibilitychange', reconcile);
  window.addEventListener('pagehide', () => { pageActive = false; reconcile(); });
  window.addEventListener('pageshow', () => { pageActive = true; reconcile(); });
  return {
    setStarted(value) { started = !!value; return reconcile(); },
    setRunning(value) { running = !!value; return reconcile(); },
    setEnabled(value) { enabled = !!value; return reconcile(); },
    retry: reconcile,
    status: () => ({supported, enabled, started, running, state, active: !!lock && !lock.released, message: messages[state]})
  };
})();
