// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Cegin Contributors
// This file is part of Cegin — https://github.com/Callummadden/cegin
import { createContext, useContext, useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { AppState } from 'react-native';

import { scheduleNotification, cancelNotification } from './notifications';

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
  stopAlarm: () => {},
  registerStopAlarm: () => {},
});

export function useTimers() {
  return useContext(TimerContext);
}

export function TimerProvider({ children }) {
  const [timers, setTimers] = useState({});
  const [activeRecipe, setActiveRecipe] = useState(null);
  const [activeStep, setActiveStep] = useState(0);
  const intervalRef = useRef(null);
  const spokeRef = useRef(new Set());
  const vibratingRef = useRef({});
  const bgNotifIds = useRef([]);
  const backgroundAt = useRef(null);
  const stopAlarmRef = useRef(null);
  const timersRef = useRef(timers);
  timersRef.current = timers;

  const stopAlarm = useCallback((timerId) => {
    if (stopAlarmRef.current) stopAlarmRef.current(timerId);
  }, []);

  const registerStopAlarm = useCallback((fn) => {
    stopAlarmRef.current = fn;
  }, []);

  // ─── Tick: sync t.left to wall-clock time every 500ms ─────────
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      const now = Date.now();
      setTimers((prev) => {
        let changed = false;
        const next = {};
        for (const [id, t] of Object.entries(prev)) {
          if (t.running && t.endTime) {
            const remaining = Math.max(0, Math.ceil((t.endTime - now) / 1000));
            const wasRunning = t.left > 0;
            if (remaining !== t.left || (remaining <= 0 && wasRunning)) {
              changed = true;
              next[id] = { ...t, left: remaining, done: remaining <= 0, running: remaining > 0 };
            } else {
              next[id] = t;
            }
          } else {
            next[id] = t;
          }
        }
        return changed ? next : prev;
      });
    }, 500);
    return () => clearInterval(intervalRef.current);
  }, []);

  // ─── Background/foreground handling ───────────────────────────
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (nextState) => {
      if (nextState === 'background' || nextState === 'inactive') {
        backgroundAt.current = Date.now();
      } else if (nextState === 'active') {
        // Sync timers to wall-clock time immediately
        const now = Date.now();
        setTimers((prev) => {
          let changed = false;
          const next = {};
          for (const [id, t] of Object.entries(prev)) {
            if (t.running && t.endTime) {
              const remaining = Math.max(0, Math.ceil((t.endTime - now) / 1000));
              if (remaining !== t.left) {
                changed = true;
                next[id] = { ...t, left: remaining, done: remaining <= 0, running: remaining > 0 };
              } else {
                next[id] = t;
              }
            } else {
              next[id] = t;
            }
          }
          return changed ? next : prev;
        });
        backgroundAt.current = null;
        // Cancel background notifications (non-blocking)
        for (const id of bgNotifIds.current) {
          cancelNotification(id).catch(() => {});
        }
        bgNotifIds.current = [];
      }
    });

    return () => sub.remove();
  }, []);

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
    const endTime = Date.now() + seconds * 1000;
    // Schedule notification for exact wall-clock time
    const notifId = await scheduleNotification(seconds, 'Timer Done!', `${label || seconds + 's'} is finished.`);
    setTimers((prev) => ({
      ...prev,
      [timerId]: { left: seconds, total: seconds, running: true, done: false, label: label || `${Math.round(seconds / 60)} min`, notifId, endTime },
    }));
  }, []);

  const pauseTimer = useCallback((timerId) => {
    setTimers((prev) => {
      const t = prev[timerId];
      if (!t || !t.running) return prev;
      if (t.notifId) cancelNotification(t.notifId);
      // Store remaining seconds so we can resume
      return { ...prev, [timerId]: { ...t, running: false, notifId: null, endTime: null, pausedLeft: t.left } };
    });
  }, []);

  const resumeTimer = useCallback((timerId) => {
    setTimers((prev) => {
      const t = prev[timerId];
      if (!t || t.running || t.done) return prev;
      const remaining = t.pausedLeft || t.left;
      const endTime = Date.now() + remaining * 1000;
      scheduleNotification(remaining, 'Timer Done!', `${t.label} is finished.`).then((nid) => {
        setTimers((p) => {
          const cur = p[timerId];
          if (!cur) return p;
          return { ...p, [timerId]: { ...cur, notifId: nid } };
        });
      });
      return { ...prev, [timerId]: { ...t, running: true, endTime, pausedLeft: undefined } };
    });
  }, []);

  const cancelTimer = useCallback((timerId) => {
    stopAlarm(timerId);
    spokeRef.current.delete(timerId);
    setTimers((prev) => {
      const t = prev[timerId];
      if (!t) return prev;
      if (t.notifId) cancelNotification(t.notifId);
      const next = { ...prev };
      delete next[timerId];
      if (Object.keys(next).length === 0) setActiveRecipe(null);
      return next;
    });
  }, [stopAlarm]);

  const value = useMemo(() => ({
    timers, activeRecipe, activeStep, setActiveRecipe, setActiveStep,
    startTimer, pauseTimer, resumeTimer, cancelTimer, stopAlarm, registerStopAlarm,
  }), [timers, activeRecipe, activeStep, startTimer, pauseTimer, resumeTimer, cancelTimer, stopAlarm, registerStopAlarm]);

  return (
    <TimerContext.Provider value={value}>
      {children}
    </TimerContext.Provider>
  );
}
