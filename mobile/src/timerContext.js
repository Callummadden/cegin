import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { AppState } from 'react-native';
import { requestPermissions, scheduleNotification, cancelNotification } from './notifications';

const TimerContext = createContext({
  timers: {},
  activeRecipe: null,
  activeStep: 0,
  setActiveRecipe: () => {},
  setActiveStep: () => {},
  startTimer: () => {},
  pauseTimer: () => {},
  resumeTimer: () => {},
  cancelTimer: () => {},
});

export function useTimers() {
  return useContext(TimerContext);
}

export function TimerProvider({ children }) {
  // Map of timerId -> { left, total, running, done, label, notifId }
  const [timers, setTimers] = useState({});
  const [activeRecipe, setActiveRecipe] = useState(null);
  const [activeStep, setActiveStep] = useState(0);
  const intervalRef = useRef(null);
  const spokeRef = useRef(new Set());
  const vibratingRef = useRef({});
  const bgNotifIds = useRef([]);

  // ─── Tick all running timers every second ─────────────────────
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setTimers((prev) => {
        let changed = false;
        const next = {};
        for (const [id, t] of Object.entries(prev)) {
          if (t.running && t.left > 0) {
            changed = true;
            next[id] = { ...t, left: t.left - 1, done: t.left - 1 <= 0, running: t.left - 1 > 0 };
          } else {
            next[id] = t;
          }
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(intervalRef.current);
  }, []);

  // ─── Background timer notifications ───────────────────────────
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (nextState) => {
      if (nextState === 'background' || nextState === 'inactive') {
        const activeTimers = Object.entries(timers)
          .filter(([, t]) => t.running && !t.done && t.left > 0);
        if (activeTimers.length === 0) return;

        await requestPermissions();

        for (const id of bgNotifIds.current) {
          await cancelNotification(id);
        }
        bgNotifIds.current = [];

        for (const [id, t] of activeTimers) {
          const mins = Math.floor(t.left / 60);
          const secs = t.left % 60;
          const timeStr = secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
          const notifId = await scheduleNotification(
            t.left,
            `${t.label} — ${timeStr} left`,
            'Timer still running. Come back to check!'
          );
          if (notifId) bgNotifIds.current.push(notifId);
        }
      } else if (nextState === 'active') {
        for (const id of bgNotifIds.current) {
          await cancelNotification(id);
        }
        bgNotifIds.current = [];
      }
    });

    return () => sub.remove();
  }, [timers]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const id of bgNotifIds.current) {
        cancelNotification(id);
      }
      clearInterval(intervalRef.current);
    };
  }, []);

  // ─── Timer actions ────────────────────────────────────────────
  const startTimer = useCallback(async (timerId, seconds, label) => {
    spokeRef.current.delete(timerId);
    const notifId = await scheduleNotification(seconds, 'Timer Done!', `${label || seconds + 's'} is finished.`);
    setTimers((prev) => ({
      ...prev,
      [timerId]: { left: seconds, total: seconds, running: true, done: false, label: label || `${Math.round(seconds / 60)} min`, notifId },
    }));
  }, []);

  const pauseTimer = useCallback((timerId) => {
    setTimers((prev) => {
      const t = prev[timerId];
      if (!t || !t.running) return prev;
      if (t.notifId) cancelNotification(t.notifId);
      return { ...prev, [timerId]: { ...t, running: false, notifId: null } };
    });
  }, []);

  const resumeTimer = useCallback((timerId) => {
    setTimers((prev) => {
      const t = prev[timerId];
      if (!t || t.running || t.done) return prev;
      scheduleNotification(t.left, 'Timer Done!', `${t.label} is finished.`).then((nid) => {
        setTimers((p) => {
          const cur = p[timerId];
          if (!cur) return p;
          return { ...p, [timerId]: { ...cur, notifId: nid } };
        });
      });
      return { ...prev, [timerId]: { ...t, running: true } };
    });
  }, []);

  const cancelTimer = useCallback((timerId) => {
    if (vibratingRef.current[timerId]) {
      vibratingRef.current[timerId]?.release?.();
      delete vibratingRef.current[timerId];
    }
    spokeRef.current.delete(timerId);
    setTimers((prev) => {
      const t = prev[timerId];
      if (!t) return prev;
      if (t.notifId) cancelNotification(t.notifId);
      const next = { ...prev };
      delete next[timerId];
      // Clear active recipe when no timers remain
      if (Object.keys(next).length === 0) setActiveRecipe(null);
      return next;
    });
  }, []);

  const value = { timers, activeRecipe, activeStep, setActiveRecipe, setActiveStep, startTimer, pauseTimer, resumeTimer, cancelTimer };

  return (
    <TimerContext.Provider value={value}>
      {children}
    </TimerContext.Provider>
  );
}
