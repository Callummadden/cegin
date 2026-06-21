// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Cegin Contributors
// This file is part of Cegin — https://github.com/Callummadden/cegin
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  AppState,
  Vibration,
} from 'react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Haptics from 'expo-haptics';
import { createAudioPlayer } from 'expo-audio';
import { requestPermissions, scheduleNotification, cancelNotification } from '../notifications';
import { useTimers } from '../timerContext';
import { MONO, useTheme } from '../theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api';
import { recordCook } from '../stats';
import { addCookbookEntry } from '../cookbook';
import * as ImagePicker from 'expo-image-picker';
import AiDisclaimer from '../components/AiDisclaimer';
import { useAi } from '../aiContext';
import { useResponsive } from '../utils/responsive';
import { fmtClock } from '../utils/timerUtils';


const fireImg = require('../../assets/fire.jpeg');
const thinkingImg = require('../../assets/thinking.jpeg');


// ─── Timer parsing ───────────────────────────────────────────────

/**
 * Find ALL time mentions in a string. Returns an array of
 * { match, minutes, index, length } objects sorted by position.
 * Handles: '25 minutes', '1 hour', '10 mins', '30-40 minutes' (first number),
 *          '1 hour 30 minutes', compound times, etc.
 */
function findAllTimers(text) {
  // Pattern: optional range, number, unit
  const re = /(\d+(?:\.\d+)?)\s*(?:-\s*\d+(?:\.\d+)?)?\s*(hours?|hrs?|minutes?|mins?)\b/gi;
  const results = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const num = parseFloat(m[1]);
    const unit = m[2].toLowerCase();
    let minutes;
    if (unit.startsWith('hour') || unit.startsWith('hr')) {
      minutes = Math.round(num * 60);
    } else {
      minutes = Math.round(num);
    }
    if (minutes > 0) {
      results.push({
        match: m[0],
        minutes,
        index: m.index,
        length: m[0].length,
      });
    }
  }
  return results;
}

/** Legacy single-match parser (kept for the big timer card fallback) */
function parseTimerMins(text) {
  const found = findAllTimers(text);
  return found.length > 0 ? found[0].minutes : null;
}



// ─── Constants ───────────────────────────────────────────────────

const PANIC_SHORTCUTS = [
  'Too salty', 'Burning', 'Too spicy', 'Overcooked',
  'Undercooked', 'Stuck to pan', 'Too thin/runny', 'Too dry',
];

const ADJUST_SHORTCUTS = [
  'Thicker cut', 'Thinner cut', 'Chicken thighs → breasts',
  'No oven — stovetop only', 'Double the batch', 'Half the batch',
  'Different protein', 'Lower heat',
];

// ─── Component ───────────────────────────────────────────────────

export default function CookModeScreen({ route, navigation }) {
  const { colors } = useTheme();
  const { s, fs } = useResponsive();
  const { noAI } = useAi();
  const styles = useMemo(() => makeStyles(colors, s, fs), [colors, s, fs]);
  const insets = useSafeAreaInsets();
  const { recipe: originalRecipe } = route.params;



  const [stepOverrides, setStepOverrides] = useState(null);
  const activeSteps = stepOverrides || originalRecipe.steps || [];
  const len = activeSteps.length;

  const [step, setStep] = useState(route.params?.step ?? 0);
  // Panel state
  const [panel, setPanel] = useState(null);
  const [showCongrats, setShowCongrats] = useState(false);

  // Panic state
  const [panicSelected, setPanicSelected] = useState([]);
  const [panicText, setPanicText] = useState('');
  const [panicLoading, setPanicLoading] = useState(false);
  const [panicResult, setPanicResult] = useState(null);
  const [panicError, setPanicError] = useState(null);

  // Adjust state
  const [adjustSelected, setAdjustSelected] = useState([]);
  const [adjustText, setAdjustText] = useState('');
  const [adjustLoading, setAdjustLoading] = useState(false);
  const [adjustResult, setAdjustResult] = useState(null);
  const [adjustError, setAdjustError] = useState(null);

  // ─── Multi-timer state (from global context) ─────────────────
  const { timers, startTimer, pauseTimer, resumeTimer, cancelTimer, setActiveRecipe, setActiveStep, registerStopAlarm } = useTimers();
  // Track which timers we already spoke on, so we don't repeat
  const spokeRef = useRef(new Set());
  const vibratingRef = useRef({}); // { [timerId]: audioPlayer }

  // Register alarm stopper so cancelTimer can call it before removing from state
  useEffect(() => {
    registerStopAlarm((timerId) => {
      Vibration.cancel();
      const player = vibratingRef.current[timerId];
      if (player) {
        try { player.stop(); } catch {}
        try { player.release(); } catch {}
        delete vibratingRef.current[timerId];
      }
    });
  }, [registerStopAlarm]);

  const ci = Math.min(step, len - 1);
  const currentStep = activeSteps[ci] || '';

  // All timer mentions in the current step
  const detectedTimers = useMemo(() => findAllTimers(currentStep), [currentStep]);

  // ─── Register active recipe for global timer bar ──────────────
  useEffect(() => {
    setActiveRecipe(originalRecipe);
  }, [originalRecipe]);

  // ─── Sync current step to timer context ──────────────────────
  useEffect(() => {
    setActiveStep(ci);
  }, [ci]);

  // ─── Re-sync step from route params when screen regains focus ─
  // (e.g. user taps RETURN on the global timer bar)
  useEffect(() => {
    const unsub = navigation.addListener('focus', () => {
      const paramStep = route.params?.step;
      if (paramStep != null && paramStep !== step) {
        setStep(paramStep);
      }
    });
    return unsub;
  }, [navigation, route.params?.step, step]);

  // ─── Keep awake only when focused ────────────────────────────
  useEffect(() => {
    const unsub = navigation.addListener('focus', () => {
      activateKeepAwakeAsync();
    });
    // Activate on initial mount if already focused
    activateKeepAwakeAsync();
    return () => {
      unsub();
      deactivateKeepAwake();
    };
  }, [navigation]);

  // ─── Request notification permissions ─────────────────────────
  useEffect(() => {
    requestPermissions();
  }, []);

  // ─── Vibrate when a timer finishes ───────────────────────────
  useEffect(() => {
    for (const [id, t] of Object.entries(timers)) {
      if (t.done && !spokeRef.current.has(id)) {
        spokeRef.current.add(id);
        Vibration.vibrate([500, 200, 500, 200], true);
        const player = createAudioPlayer(require('../../assets/timer-alarm.wav'));
        player.loop = true;
        player.play();
        vibratingRef.current[id] = player;
      }
    }
  }, [timers]);

  // Cleanup vibration on unmount
  useEffect(() => {
    return () => {
      for (const player of Object.values(vibratingRef.current)) {
        try { player?.stop?.(); } catch {}
        try { player?.release?.(); } catch {}
      }
      Vibration.cancel();
    };
  }, []);

  // ─── Timer actions (startTimer takes seconds via context) ────
  const startTimerFromStep = useCallback(async (timerId, minutes, label) => {
    await startTimer(timerId, minutes * 60, label || `${minutes} min`);
  }, [startTimer]);

  const progress = Math.round(((ci + 1) / len) * 100);

  const goNext = () => {
    if (ci >= len - 1) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      recordCook(originalRecipe.id || 0, originalRecipe.title, len);
      setShowCongrats(true);
    } else setStep(ci + 1);
  };

  const takePhotoAndSave = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') return;
    const result = await ImagePicker.launchCameraAsync({
      quality: 0.8,
    });
    if (!result.canceled && result.assets?.[0]) {
      await addCookbookEntry({
        recipeId: originalRecipe.id,
        recipeTitle: originalRecipe.title,
        imageUri: result.assets[0].uri,
      });
      setShowCongrats(false);
      navigation.reset({ index: 0, routes: [{ name: 'Cookbook' }] });
    }
  };

  const skipPhoto = async () => {
    await addCookbookEntry({
      recipeId: originalRecipe.id,
      recipeTitle: originalRecipe.title,
      imageUri: null,
    });
    setShowCongrats(false);
    navigation.reset({ index: 0, routes: [{ name: 'Cookbook' }] });
  };
  const goPrev = () => { if (ci > 0) setStep(ci - 1); };

  const openPanel = (type) => {
    setPanel(type);
    setPanicSelected([]); setPanicText(''); setPanicResult(null); setPanicError(null);
    setAdjustSelected([]); setAdjustText(''); setAdjustResult(null); setAdjustError(null);
  };

  const closePanel = () => setPanel(null);

  const toggleChip = (label, type) => {
    if (type === 'panic') {
      setPanicSelected((prev) => prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]);
    } else {
      setAdjustSelected((prev) => prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]);
    }
  };

  const buildProblemText = () => {
    const parts = [];
    if (panicText.trim()) parts.push(panicText.trim());
    if (panicSelected.length) parts.push(panicSelected.join('. '));
    return parts.join('. ');
  };

  const buildAdjustText = () => {
    const parts = [];
    if (adjustText.trim()) parts.push(adjustText.trim());
    if (adjustSelected.length) parts.push(adjustSelected.join('. '));
    return parts.join('. ');
  };

  const submitPanic = async () => {
    const combined = buildProblemText();
    if (!combined) return;
    setPanicLoading(true); setPanicError(null); setPanicResult(null);
    try {
      const result = await api.fixMistake({ recipe: originalRecipe, currentStep, problem: combined });
      setPanicResult(result);
    } catch (e) {
      setPanicError(e.message);
    } finally {
      setPanicLoading(false);
    }
  };

  const submitAdjust = async () => {
    const combined = buildAdjustText();
    if (!combined) return;
    setAdjustLoading(true); setAdjustError(null); setAdjustResult(null);
    try {
      const result = await api.adjustCooking({ recipe: originalRecipe, modifications: combined });
      setAdjustResult(result);
    } catch (e) {
      setAdjustError(e.message);
    } finally {
      setAdjustLoading(false);
    }
  };

  const applyAdjusted = () => {
    if (adjustResult?.adjusted_steps?.length) {
      setStepOverrides(adjustResult.adjusted_steps);
      setStep(0);
      closePanel();
    }
  };

  const revertSteps = () => {
    setStepOverrides(null);
    setStep(Math.min(ci, (originalRecipe.steps || []).length - 1));
  };

  const shortcuts = panel === 'panic' ? PANIC_SHORTCUTS : ADJUST_SHORTCUTS;
  const selected = panel === 'panic' ? panicSelected : adjustSelected;
  const canSubmit = panel === 'panic'
    ? (panicSelected.length > 0 || panicText.trim().length > 0)
    : (adjustSelected.length > 0 || adjustText.trim().length > 0);

  // ─── Render step text (plain, no inline timer chips) ──────────
  const renderStepWithChips = () => {
    return <Text style={[styles.stepText, { color: colors.text }]}>{currentStep}</Text>;
  };

  if (!len) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center', padding: 32 }]}>
        <Text style={[styles.stepLabel, { fontFamily: MONO, color: colors.textMuted, fontSize: 14, textAlign: 'center' }]}>NO STEPS FOUND</Text>
        <Text style={[styles.stepLabel, { color: colors.textMuted, fontSize: 13, marginTop: 8, textAlign: 'center' }]}>This recipe has no steps to cook.</Text>
        <Pressable style={[styles.closeBtn, { borderColor: colors.border, marginTop: 20 }]} onPress={() => navigation.goBack()}>
          <Text style={[styles.closeBtnText, { color: colors.textMuted }]}>✕</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>

      {/* Header */}
      <View style={[styles.header, { paddingTop: 16 + insets.top + (Object.keys(timers).length > 0 ? 44 : 0) }]}>
        <Pressable style={[styles.closeBtn, { borderColor: colors.border }]} onPress={() => navigation.goBack()}>
          <Text style={[styles.closeBtnText, { color: colors.textMuted }]}>✕</Text>
        </Pressable>
        <Text style={[styles.stepLabel, { fontFamily: MONO, color: colors.textMuted }]}>
          STEP {String(ci + 1).padStart(2, '0')} / {String(len).padStart(2, '0')}
        </Text>
        <View style={{ width: 38 }} />
      </View>

      {/* Progress bar */}
      <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
        <View style={[styles.progressFill, { backgroundColor: colors.primary, width: `${progress}%` }]} />
      </View>

      {/* Recipe name + adjusted badge */}
      <View style={styles.recipeLabelRow}>
        <Text style={[styles.recipeLabel, { fontFamily: MONO, color: colors.primary }]}>
          COOKING · {originalRecipe.title.toUpperCase()}
        </Text>
        {stepOverrides && (
          <Pressable onPress={revertSteps} style={[styles.adjustedBadge, { borderColor: colors.primary }]}>
            <Text style={[styles.adjustedBadgeText, { fontFamily: MONO, color: colors.primary }]}>ADJUSTED ✕</Text>
          </Pressable>
        )}
      </View>

      {/* Step text */}
      <ScrollView style={styles.stepBody} contentContainerStyle={{ paddingBottom: 14 }}>
        {renderStepWithChips()}

        {/* Timer card — shows before and during timer */}
        {detectedTimers.length >= 1 && (() => {
          const timerId = `${ci}-0`;
          const t = timers[timerId];
          const dt = detectedTimers[0];
          if (!t) {
            // Not started yet — show START button
            return (
              <View style={[styles.timerCard, { borderColor: colors.border }]}>
                <Text style={[styles.timerBig, { fontFamily: MONO, color: colors.text }]}>
                  {fmtClock(dt.minutes * 60)}
                </Text>
                <Pressable
                  style={[styles.timerBtn, { borderColor: colors.primary }]}
                  onPress={() => startTimerFromStep(timerId, dt.minutes, dt.match)}
                >
                  <Text style={[styles.timerBtnText, { fontFamily: MONO, color: colors.primary }]}>
                    START TIMER
                  </Text>
                </Pressable>
              </View>
            );
          }
          // Running or done — show countdown in same position
          return (
            <View style={[styles.timerCard, { borderColor: t.done ? colors.success : t.running ? colors.primary : colors.border }]}>
              <Text style={[styles.timerBig, { fontFamily: MONO, color: t.done ? colors.success : colors.text }]}>
                {t.done ? '✓ DONE' : fmtClock(t.left)}
              </Text>
              <View style={styles.timerCardActions}>
                {!t.done && (
                  <Pressable
                    style={[styles.timerBtn, { borderColor: t.running ? colors.textMuted : colors.primary }]}
                    onPress={() => t.running ? pauseTimer(timerId) : resumeTimer(timerId)}
                  >
                    <Text style={[styles.timerBtnText, { fontFamily: MONO, color: t.running ? colors.textMuted : colors.primary }]}>
                      {t.running ? 'PAUSE' : 'RESUME'}
                    </Text>
                  </Pressable>
                )}
                <Pressable
                  style={[styles.timerBtn, { borderColor: colors.danger }]}
                  onPress={() => cancelTimer(timerId)}
                >
                  <Text style={[styles.timerBtnText, { fontFamily: MONO, color: colors.danger }]}>
                    {t.done ? 'DISMISS' : 'CANCEL'}
                  </Text>
                </Pressable>
              </View>
            </View>
          );
        })()}
      </ScrollView>

      <Text style={[styles.awakeNote, { fontFamily: MONO, color: colors.textMuted }]}>
        SCREEN STAYS AWAKE IN COOK MODE
      </Text>

      {/* Nav buttons */}
      <View style={[styles.navRow, { paddingBottom: 90 + insets.bottom }]}>
        <Pressable
          style={[styles.prevBtn, { borderColor: colors.border }, ci === 0 && { opacity: 0.3 }]}
          onPress={goPrev}
          disabled={ci === 0}
        >
          <Text style={[styles.prevBtnText, { color: colors.text2 }]}>← PREV</Text>
        </Pressable>
        <Pressable style={[styles.nextBtn, { backgroundColor: colors.primary }]} onPress={goNext}>
          <Text style={[styles.nextBtnText, { color: colors.onPrimary }]}>
            {ci >= len - 1 ? 'FINISH ✓' : 'NEXT →'}
          </Text>
        </Pressable>
      </View>

      {/* AI action bar + panel — hidden when AI disabled */}
      {!noAI && (
      <>
      <View style={[styles.aiBar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <View style={[styles.aiBarPill, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Pressable
            style={[styles.panicBtn, { backgroundColor: '#DC2626', borderColor: '#DC2626' }]}
            onPress={() => openPanel('panic')}
          >
            <Text style={styles.panicBtnText}>🔥 SOMETHING'S WRONG</Text>
          </Pressable>
          <Pressable
            style={[styles.adjustBtn, { borderColor: colors.border, backgroundColor: colors.background }]}
            onPress={() => openPanel('adjust')}
          >
            <Text style={[styles.adjustBtnText, { fontFamily: MONO, color: colors.primary }]}>⚙ ADJUST</Text>
          </Pressable>
        </View>
      </View>

      {/* Panel Modal */}
      <Modal visible={!!panel} animationType="slide" transparent onRequestClose={closePanel}>
        <KeyboardAvoidingView
          style={styles.modalFlex}
          behavior="padding"
        >
          <Pressable style={styles.modalOverlay} onPress={closePanel} />
          <View style={[styles.panel, { backgroundColor: colors.surface }]}>
            <ScrollView
              contentContainerStyle={{ paddingBottom: 20 }}
              keyboardShouldPersistTaps="always"
              showsVerticalScrollIndicator={false}
            >
              {/* Handle */}
              <View style={[styles.panelHandle, { backgroundColor: colors.border }]} />

              {/* Panic header image */}
              {panel === 'panic' && (
                <View style={styles.panicHeaderImg}>
                  <Image source={fireImg} style={styles.panicHeaderImgInner} resizeMode="cover" />
                </View>
              )}

              {/* Adjust header image */}
              {panel === 'adjust' && (
                <View style={styles.panicHeaderImg}>
                  <Image source={thinkingImg} style={styles.panicHeaderImgInner} resizeMode="cover" />
                </View>
              )}

              {/* Title */}
              <Text style={[styles.panelTitle, { color: colors.text }]}>
                {panel === 'panic' ? "WHAT HAPPENED?" : "⚙ ADJUST COOKING"}
              </Text>
              <Text style={[styles.panelSubtitle, { color: colors.textMuted }]}>
                {panel === 'panic'
                  ? "Tap all that apply, then describe anything else below."
                  : "Tell me what you're changing and I'll recalculate times & temps."
                }
              </Text>

              {/* Chip selector */}
              <View style={styles.shortcutsRow}>
                {shortcuts.map((label) => {
                  const isActive = selected.includes(label);
                  return (
                    <Pressable
                      key={label}
                      style={[
                        styles.shortcutChip,
                        {
                          borderColor: isActive ? colors.primary : colors.border,
                          backgroundColor: isActive ? 'rgba(255,90,38,0.15)' : colors.background,
                        },
                      ]}
                      onPress={() => toggleChip(label, panel)}
                    >
                      <Text style={[
                        styles.shortcutText,
                        { fontFamily: MONO, color: isActive ? colors.primary : colors.text2 },
                      ]}>
                        {isActive ? `✓ ${label}` : label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* Text input for extra detail */}
              <TextInput
                style={[styles.panelInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
                placeholder={panel === 'panic' ? "Anything else? Describe it here..." : "Any other details..."}
                placeholderTextColor={colors.textMuted}
                value={panel === 'panic' ? panicText : adjustText}
                onChangeText={panel === 'panic' ? setPanicText : setAdjustText}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />

              {/* Submit */}
              <Pressable
                style={[
                  styles.panelSubmit,
                  { backgroundColor: panel === 'panic' ? colors.danger : colors.primary },
                  !canSubmit && { opacity: 0.4 },
                  ((panel === 'panic' ? panicLoading : adjustLoading)) && { opacity: 0.6 },
                ]}
                onPress={panel === 'panic' ? submitPanic : submitAdjust}
                disabled={!canSubmit || (panel === 'panic' ? panicLoading : adjustLoading)}
              >
                {(panel === 'panic' ? panicLoading : adjustLoading) ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.panelSubmitText}>
                    {panel === 'panic' ? 'GET FIX' : 'RECALCULATE'}
                  </Text>
                )}
              </Pressable>

              {/* Error */}
              {(panel === 'panic' ? panicError : adjustError) && (
                <Text style={{ color: colors.danger, fontSize: 13, marginTop: 10 }}>
                  {panel === 'panic' ? panicError : adjustError}
                </Text>
              )}

              {/* Panic result */}
              {panel === 'panic' && panicResult && (
                <View style={[styles.resultCard, { borderColor: colors.border, backgroundColor: colors.background }]}>
                  <View style={styles.resultHeader}>
                    <Text style={[styles.resultTitle, { color: colors.text }]}>FIX</Text>
                    <View style={[
                      styles.confidenceBadge,
                      { backgroundColor: panicResult.confidence === 'high' ? colors.success : panicResult.confidence === 'medium' ? '#F57F17' : colors.danger },
                    ]}>
                      <Text style={styles.confidenceText}>
                        {panicResult.salvageable ? '✓ SALVAGEABLE' : '✗ TOUGH CALL'}
                      </Text>
                    </View>
                  </View>
                  <Text style={[styles.fixText, { color: colors.text2 }]}>{panicResult.fix}</Text>
                  {panicResult.steps?.length > 0 && (
                    <View style={styles.fixSteps}>
                      {panicResult.steps.map((s, i) => (
                        <View key={i} style={styles.fixStepRow}>
                          <Text style={[styles.fixStepNum, { color: colors.primary }]}>{i + 1}.</Text>
                          <Text style={[styles.fixStepText, { color: colors.text2 }]}>{s}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                  {panicResult.prevention && (
                    <View style={[styles.preventionBox, { borderColor: colors.border }]}>
                      <Text style={[styles.preventionLabel, { fontFamily: MONO, color: colors.primary }]}>NEXT TIME</Text>
                      <Text style={[styles.preventionText, { color: colors.textMuted }]}>{panicResult.prevention}</Text>
                    </View>
                  )}
                </View>
              )}

              {/* Adjust result */}
              {panel === 'adjust' && adjustResult && (
                <View style={[styles.resultCard, { borderColor: colors.border, backgroundColor: colors.background }]}>
                  <Text style={[styles.resultTitle, { color: colors.text }]}>WHAT CHANGED</Text>
                  <Text style={[styles.fixText, { color: colors.text2, marginTop: 8 }]}>{adjustResult.summary}</Text>

                  {adjustResult.key_changes?.length > 0 && (
                    <View style={styles.fixSteps}>
                      {adjustResult.key_changes.map((c, i) => (
                        <View key={i} style={styles.fixStepRow}>
                          <Text style={[styles.fixStepNum, { color: colors.primary }]}>•</Text>
                          <Text style={[styles.fixStepText, { color: colors.text2 }]}>{c}</Text>
                        </View>
                      ))}
                    </View>
                  )}

                  {adjustResult.internal_temp && (
                    <View style={[styles.tempBox, { borderColor: colors.primary }]}>
                      <Text style={[styles.tempLabel, { fontFamily: MONO, color: colors.primary }]}>TARGET INTERNAL TEMP</Text>
                      <Text style={[styles.tempValue, { color: colors.text }]}>{adjustResult.internal_temp}</Text>
                    </View>
                  )}

                  <Pressable style={[styles.applyBtn, { backgroundColor: colors.primary }]} onPress={applyAdjusted}>
                    <Text style={styles.applyBtnText}>APPLY ADJUSTED STEPS</Text>
                  </Pressable>
                </View>
              )}

              {/* Close */}
              {(panicResult || adjustResult) && <AiDisclaimer style={{ marginHorizontal: 16, marginTop: 4 }} />}
              <Pressable style={styles.panelClose} onPress={closePanel}>
                <Text style={[styles.panelCloseText, { fontFamily: MONO, color: colors.textMuted }]}>CLOSE</Text>
              </Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      </>
      )}

      {/* Congratulations modal */}

      <Modal visible={showCongrats} transparent animationType="fade" onRequestClose={() => { setShowCongrats(false); navigation.goBack(); }}>
        <View style={styles.congratsOverlay}>
          <View style={[styles.congratsCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={styles.congratsEmoji}>🎉</Text>
            <Text style={[styles.congratsTitle, { color: colors.text }]}>RECIPE COMPLETE!</Text>
            <Text style={[styles.congratsRecipe, { fontFamily: MONO, color: colors.primary }]}>{originalRecipe.title.toUpperCase()}</Text>
            <Text style={[styles.congratsMessage, { color: colors.textMuted }]}>
              You just cooked {originalRecipe.title} from scratch. That's {len} steps of pure effort. Time to eat!
            </Text>
            <Pressable
              style={[styles.congratsBtn, { backgroundColor: colors.primary }]}
              onPress={takePhotoAndSave}
            >
              <Text style={[styles.congratsBtnText, { color: colors.onPrimary }]}>📸 TAKE A PHOTO</Text>
            </Pressable>
            <Pressable
              style={[styles.congratsSkipBtn, { borderColor: colors.border }]}
              onPress={skipPhoto}
            >
              <Text style={[styles.congratsSkipText, { fontFamily: MONO, color: colors.textMuted }]}>SAVE WITHOUT PHOTO</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (colors, s, fs) => StyleSheet.create({

  root: { flex: 1 },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: s(20),
  },
  closeBtn: {
    width: s(38), height: s(38), borderRadius: s(20), borderWidth: 1.5, alignItems: 'center', justifyContent: 'center',
  },
  closeBtnText: { fontSize: fs(16) },
  stepLabel: { fontSize: fs(12), letterSpacing: 2 },
  progressTrack: { marginHorizontal: s(20), marginTop: s(16), height: s(3), borderRadius: s(2) },
  progressFill: { height: s(3), borderRadius: s(2) },
  recipeLabelRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: s(24), marginTop: s(22),
  },
  recipeLabel: { fontSize: fs(11), letterSpacing: 1 },
  adjustedBadge: { borderWidth: 1.5, borderRadius: s(6), paddingHorizontal: s(8), paddingVertical: s(3) },
  adjustedBadgeText: { fontSize: fs(9), letterSpacing: 1 },
  stepBody: { flex: 1, paddingHorizontal: s(24), paddingTop: s(14) },
  stepText: { fontSize: fs(26), lineHeight: fs(38), fontWeight: '500', letterSpacing: -0.2 },

  // Legacy big timer card (fallback for single-timer steps)
  timerCard: {
    marginTop: s(28), borderWidth: 1.5, borderRadius: s(16), padding: s(20),
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  timerBig: { fontSize: fs(36), fontWeight: '700' },
  timerCardActions: { flexDirection: 'row', gap: s(10), marginTop: s(10) },
  timerBtn: { borderWidth: 1.5, borderRadius: s(8), paddingHorizontal: s(16), paddingVertical: s(10) },
  timerBtnText: { fontSize: fs(11), letterSpacing: 1 },

  awakeNote: { textAlign: 'center', paddingBottom: s(8), fontSize: fs(10), letterSpacing: 1 },
  navRow: { flexDirection: 'row', gap: s(12), paddingHorizontal: s(20), paddingBottom: s(80) },
  prevBtn: { flex: 1, borderWidth: 1.5, borderRadius: s(12), paddingVertical: s(17), alignItems: 'center' },
  prevBtnText: { fontWeight: '900', fontSize: fs(14), letterSpacing: 1 },
  nextBtn: { flex: 1.4, borderRadius: s(12), paddingVertical: s(17), alignItems: 'center' },
  nextBtnText: { fontWeight: '900', fontSize: fs(14), letterSpacing: 1 },

  // AI action bar — floating pill like bottom nav
  aiBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: s(40),
    paddingTop: s(10),
    zIndex: 10,
  },
  aiBarPill: {
    flexDirection: 'row',
    gap: s(10),
    borderWidth: 1.5,
    borderRadius: s(28),
    paddingHorizontal: s(6),
    paddingVertical: s(6),
  },
  panicBtn: {
    flex: 1.4,
    borderWidth: 1.5,
    borderRadius: s(28),
    paddingVertical: s(14),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DC2626',
    borderColor: '#DC2626',
  },
  panicImg: { width: s(64), height: s(64), borderRadius: s(8), marginBottom: s(4) },
  panicBtnText: { color: '#fff', fontWeight: '900', fontSize: fs(11), letterSpacing: 0.5 },
  adjustBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: s(28),
    paddingVertical: s(14),
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  adjustBtnText: { fontWeight: '900', fontSize: fs(12), letterSpacing: 1 },

  // Modal
  modalFlex: { flex: 1 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  panel: {
    maxHeight: '85%',
    borderTopLeftRadius: s(24),
    borderTopRightRadius: s(24),
    paddingTop: s(12),
    paddingHorizontal: s(20),
  },
  panelHandle: { width: s(40), height: s(4), borderRadius: s(2), alignSelf: 'center', marginBottom: s(16) },
  panicHeaderImg: { alignItems: 'center', marginBottom: s(12) },
  panicHeaderImgInner: { width: s(160), height: s(160), borderRadius: s(16) },
  panelTitle: { fontSize: fs(22), fontWeight: '900', letterSpacing: -0.3 },
  panelSubtitle: { fontSize: fs(13), lineHeight: fs(20), marginTop: s(6), marginBottom: s(16) },
  shortcutsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: s(8), marginBottom: s(14) },
  shortcutChip: { borderWidth: 1.5, borderRadius: s(8), paddingHorizontal: s(10), paddingVertical: s(6) },
  shortcutText: { fontSize: fs(11), letterSpacing: 0.3 },
  panelInput: {
    borderWidth: 1.5, borderRadius: s(12), padding: s(14), fontSize: fs(15), minHeight: s(80), lineHeight: fs(22),
  },
  panelSubmit: { marginTop: s(14), borderRadius: s(12), paddingVertical: s(16), alignItems: 'center' },
  panelSubmitText: { color: '#fff', fontWeight: '900', fontSize: fs(14), letterSpacing: 1 },

  // Results
  resultCard: { marginTop: s(18), borderWidth: 1.5, borderRadius: s(16), padding: s(16) },
  resultHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: s(10) },
  resultTitle: { fontSize: fs(14), fontWeight: '900', letterSpacing: 1 },
  confidenceBadge: { borderRadius: s(6), paddingHorizontal: s(8), paddingVertical: s(4) },
  confidenceText: { color: '#fff', fontSize: fs(10), fontWeight: '700', letterSpacing: 0.5 },
  fixText: { fontSize: fs(15), lineHeight: fs(23) },
  fixSteps: { marginTop: s(12), gap: s(8) },
  fixStepRow: { flexDirection: 'row', gap: s(8) },
  fixStepNum: { fontSize: fs(14), fontWeight: '700', width: s(20) },
  fixStepText: { flex: 1, fontSize: fs(14), lineHeight: fs(21) },
  preventionBox: { marginTop: s(14), borderTopWidth: 1, paddingTop: s(12) },
  preventionLabel: { fontSize: fs(10), letterSpacing: 1, marginBottom: s(4) },
  preventionText: { fontSize: fs(13), lineHeight: fs(20), fontStyle: 'italic' },
  tempBox: { marginTop: s(14), borderWidth: 1.5, borderRadius: s(10), padding: s(12) },
  tempLabel: { fontSize: fs(10), letterSpacing: 1, marginBottom: s(4) },
  tempValue: { fontSize: fs(20), fontWeight: '700' },
  applyBtn: { marginTop: s(16), borderRadius: s(12), paddingVertical: s(14), alignItems: 'center' },
  applyBtnText: { color: '#fff', fontWeight: '900', fontSize: fs(13), letterSpacing: 1 },
  panelClose: { alignSelf: 'center', paddingVertical: s(14) },
  panelCloseText: { fontSize: fs(11), letterSpacing: 1 },
  // Congrats modal
  congratsOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: s(30),
  },
  congratsCard: {
    width: '100%',
    maxWidth: s(340),
    borderWidth: 1.5,
    borderRadius: s(24),
    padding: s(32),
    alignItems: 'center',
  },
  congratsEmoji: { fontSize: fs(64), marginBottom: s(16) },
  congratsTitle: { fontSize: fs(24), fontWeight: '900', letterSpacing: 1, textAlign: 'center' },
  congratsRecipe: { fontSize: fs(11), letterSpacing: 1.5, marginTop: s(8), textAlign: 'center' },
  congratsMessage: { fontSize: fs(14), lineHeight: fs(22), textAlign: 'center', marginTop: s(14), marginBottom: s(24) },
  congratsBtn: { width: '100%', borderRadius: s(14), paddingVertical: s(16), alignItems: 'center' },
  congratsBtnText: { fontWeight: '900', fontSize: fs(14), letterSpacing: 1 },
  congratsSkipBtn: { width: '100%', borderWidth: 1.5, borderRadius: s(14), paddingVertical: s(14), alignItems: 'center', marginTop: s(10) },
  congratsSkipText: { fontSize: fs(11), letterSpacing: 1 },

  });