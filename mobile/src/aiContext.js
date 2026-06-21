// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Cegin Contributors
// This file is part of Cegin — https://github.com/Callummadden/cegin
import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const NO_AI_KEY = 'noAI';

const AiContext = createContext({
  noAI: false,
  setNoAI: () => {},
});

export function AiProvider({ children }) {
  const [noAI, setNoAIState] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(NO_AI_KEY).then((v) => {
      if (v === 'true') setNoAIState(true);
    });
  }, []);

  const setNoAI = useCallback((val) => {
    setNoAIState(val);
    AsyncStorage.setItem(NO_AI_KEY, String(val));
  }, []);

  const value = useMemo(() => ({ noAI, setNoAI }), [noAI, setNoAI]);

  return <AiContext.Provider value={value}>{children}</AiContext.Provider>;
}

export function useAi() {
  return useContext(AiContext);
}
