// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Cegin Contributors
// This file is part of Cegin — https://github.com/Callummadden/cegin
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
  Vibration,
} from 'react-native';
import { Image } from 'expo-image';
import { useFocusEffect } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { createAudioPlayer } from 'expo-audio';
import { api } from '../api';
import { MONO, useTheme } from '../theme';
import AppModal from '../components/AppModal';
import AiDisclaimer from '../components/AiDisclaimer';

import { getFavorites, toggleFavorite } from '../favorites';
import { scaleIngredients } from '../utils/scaleIngredients';
import { heroCardColors, hashStr } from '../utils/heroColors';
import { addItems } from '../shoppingList';
import { getDietaryProfiles } from '../dietProfiles';
import { getCachedAudit, setCachedAudit, getCachedNutrition, setCachedNutrition, getCachedPrep, setCachedPrep } from '../auditCache';
import { estimateNutrition as usdaEstimate, getAllergens } from '../usdaNutrition';
import { TextSkeleton } from '../components/Skeleton';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAi } from '../aiContext';
import { useResponsive } from '../utils/responsive';
import { fmtClock } from '../utils/timerUtils';



const UNIT_MODES = [
  { value: 'orig', label: 'ORIG' },
  { value: 'metric', label: 'G·ML' },
  { value: 'us', label: 'CUPS' },
];

// Parse a rough timer duration (minutes) from step text
function parseTimerMins(text) {
  const hourMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\b/i);
  if (hourMatch) return Math.round(parseFloat(hourMatch[1]) * 60);
  const minMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:minutes?|mins?)\b/i);
  if (minMatch) return Math.round(parseFloat(minMatch[1]));
  return null;
}





export default function RecipeDetailScreen({ route, navigation }) {
  const { colors } = useTheme();
  const { s, fs } = useResponsive();
  const { noAI } = useAi();
  const styles = useMemo(() => makeStyles(colors, s, fs), [colors, s, fs]);
  const insets = useSafeAreaInsets();


  const { id } = route.params;

  const [recipe, setRecipe] = useState(null);
  const [error, setError] = useState(null);
  const [isFav, setIsFav] = useState(false);

  // Unit conversion
  const [unitMode, setUnitMode] = useState('orig');
  const [convertedCache, setConvertedCache] = useState({});
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState(null);

  // Servings scaling (display only — text ingredients can't be auto-scaled)
  const [servings, setServings] = useState(null);
  const [nutrition, setNutrition] = useState(null);
  const [loadingNutrition, setLoadingNutrition] = useState(false);
  const [prepSteps, setPrepSteps] = useState(null);
  const [loadingPrep, setLoadingPrep] = useState(false);

  // Ingredient checklist
  const [checked, setChecked] = useState({});

  // Dietary audit
  const [auditing, setAuditing] = useState(false);
  const [auditResult, setAuditResult] = useState(null);
  const [auditError, setAuditError] = useState(null);
  const [allergenFlags, setAllergenFlags] = useState(null);
  const [subPickerVisible, setSubPickerVisible] = useState(false);
  const [subOptions, setSubOptions] = useState([]); // [{original, options: [str], selected: idx, custom: ''}]
  const [customSubText, setCustomSubText] = useState('');
  const [applyingSubs, setApplyingSubs] = useState(false);
  const [auditCollapsed, setAuditCollapsed] = useState(false);

  // Step timers: { [stepIndex]: { left, total, running, done } }
  const [timers, setTimers] = useState({});
  const prevTimersRef = useRef({});
  const vibratingRef = useRef({}); // { [stepIndex]: intervalId }
  const [modal, setModal] = useState(null);
  const [notesModal, setNotesModal] = useState(false);
  const [notesDraft, setNotesDraft] = useState('');
  const intervalRef = useRef(null);

  // Free image memory when screen unmounts
  useEffect(() => {
    return () => { Image.clearMemoryCache().catch(() => {}); };
  }, []);

  useFocusEffect(
    useCallback(() => {
      api
        .getRecipe(id)
        .then(async (r) => {
          setRecipe(r);
          setServings(r.servings);
          // Load cached nutrition and prep steps if available
          const [cachedNut, cachedPrep] = await Promise.all([
            getCachedNutrition(id, r.updated_at),
            getCachedPrep(id, r.updated_at),
          ]);
          if (cachedNut) setNutrition(cachedNut);
          if (cachedPrep) setPrepSteps(cachedPrep);
          const favs = await getFavorites();
          setIsFav(!!favs[id]);
          // Run local allergen check (instant, no API needed)
          try {
            const usdaResult = await usdaEstimate(r.ingredients);
            console.log('[Allergen] USDA matched:', usdaResult?.matched?.length || 0, 'ingredients');
            if (usdaResult && usdaResult.matched.length > 0) {
              const fdcIds = usdaResult.matched.map(m => m.fdc_id).filter(Boolean);
              console.log('[Allergen] fdcIds:', fdcIds.length);
              if (fdcIds.length > 0) {
                const flags = await getAllergens(fdcIds);
                console.log('[Allergen] flags:', JSON.stringify(flags));
                if (flags) setAllergenFlags(flags);
              }
            }
          } catch (e) { console.error('[Allergen] Error:', e.message); }

          // Auto-trigger dietary audit if profiles exist (skip if AI disabled)
          if (!noAI) {
          const profiles = await getDietaryProfiles();
          if (profiles.length > 0) {
            // Check cache first
            const cached = await getCachedAudit(id, profiles, r.updated_at);
            if (cached) {
              setAuditResult(cached);
              setAuditCollapsed(cached.audit?.every(e => e.rating === 'safe'));
            } else {
              setAuditing(true);
              setAuditError(null);
              setAuditResult(null);
              try {
                const result = await api.auditRecipe({ recipe: r, dietaryProfiles: profiles });
                setAuditResult(result);
                setAuditCollapsed(result.audit?.every(e => e.rating === 'safe'));
                setCachedAudit(id, profiles, r.updated_at, result);
              } catch (e) {
                setAuditError(e.message);
              } finally {
                setAuditing(false);
              }
            }
          }
          }
        })
        .catch((e) => setError(e.message));
    }, [id, noAI]),
  );

  // Countdown tick
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setTimers((prev) => {
        let changed = false;
        const next = {};
        for (const k in prev) {
          const t = prev[k];
          if (t.running && t.left > 0) {
            const left = t.left - 1;
            next[k] = { ...t, left, running: left > 0, done: left === 0 };
            changed = true;
          } else {
            next[k] = t;
          }
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(intervalRef.current);
  }, []);

  // Start repeating vibration when a timer reaches zero
  useEffect(() => {
    const prev = prevTimersRef.current;
    for (const k in timers) {
      if (timers[k].done && !prev[k]?.done && !vibratingRef.current[k]) {
        Vibration.vibrate([500, 200, 500, 200], true);
        vibratingRef.current[k] = true;
        const player = createAudioPlayer(require('../../assets/timer-alarm.wav'));
        player.loop = true;
        player.play();
        vibratingRef.current[k] = player;
      }
      // Stop vibration when timer is reset
      if (!timers[k].done && vibratingRef.current[k]) {
        Vibration.cancel();
        vibratingRef.current[k]?.release?.();
        delete vibratingRef.current[k];
      }
    }
    prevTimersRef.current = timers;
  }, [timers]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const player of Object.values(vibratingRef.current)) {
        player?.release?.();
      }
      Vibration.cancel();
    };
  }, []);

  const toggleCheck = (key) =>
    setChecked((prev) => ({ ...prev, [key]: !prev[key] }));

  const hitTimer = (idx, mins) => {
    setTimers((prev) => {
      const t = prev[idx];
      let next;
      if (!t || t.done) {
        next = { left: mins * 60, total: mins * 60, running: true, done: false };
      } else if (t.running) {
        next = { ...t, running: false };
      } else {
        next = { ...t, running: true };
      }
      return { ...prev, [idx]: next };
    });
  };

  const selectUnit = async (mode) => {
    setConvertError(null);
    if (mode === 'orig' || convertedCache[mode]) {
      setUnitMode(mode);
      return;
    }
    setConverting(true);
    try {
      const { ingredients } = await api.convertUnits({ ingredients: recipe.ingredients, system: mode });
      setConvertedCache((c) => ({ ...c, [mode]: ingredients }));
      setUnitMode(mode);
    } catch (e) {
      setConvertError(e.message);
    } finally {
      setConverting(false);
    }
  };

  const onToggleFav = async () => {
    const next = await toggleFavorite(id);
    setIsFav(!!next[id]);
  };

  const confirmDelete = () => {
    setModal({
      title: 'Delete recipe',
      message: `Delete "${recipe?.title}"? This cannot be undone.`,
      buttons: [
        { text: 'CANCEL' },
        {
          text: 'DELETE',
          destructive: true,
          filled: true,
          onPress: async () => {
            try {
              await api.deleteRecipe(id);
              navigation.goBack();
            } catch (e) {
              setModal({ title: 'Error', message: e.message, buttons: [{ text: 'OK', primary: true }] });
            }
          },
        },
      ],
    });
  };

  const buildRecipeText = () => {
    const lines = [];
    lines.push(recipe.title.toUpperCase());
    if (recipe.description) lines.push('', recipe.description);
    if (recipe.ingredients?.length) {
      lines.push('', 'INGREDIENTS');
      recipe.ingredients.forEach((i) => lines.push(`• ${i}`));
    }
    if (recipe.steps?.length) {
      lines.push('', 'METHOD');
      recipe.steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
    }
    const meta = [];
    if (recipe.prep_minutes) meta.push(`Prep: ${recipe.prep_minutes} min`);
    if (recipe.cook_minutes) meta.push(`Cook: ${recipe.cook_minutes} min`);
    if (recipe.servings) meta.push(`Serves: ${recipe.servings}`);
    if (meta.length) lines.push('', meta.join(' · '));
    return lines.join('\n');
  };

  const shareRecipe = async () => {
    try {
      await Share.share({ message: buildRecipeText() });
    } catch {}
  };


  const cardBgs = useMemo(() => heroCardColors(colors), [colors]);

  if (error) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.danger, padding: 24, textAlign: 'center' }}>{error}</Text>
      </View>
    );
  }
  if (!recipe && !error) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <View style={{ height: 280, backgroundColor: colors.surface2 }} />
        <View style={{ padding: 20, gap: 12 }}>
          <TextSkeleton width={120} height={10} />
          <TextSkeleton width="80%" height={22} />
          <TextSkeleton width="60%" height={14} />
          <View style={{ height: 12 }} />
          <View style={{ flexDirection: 'row', gap: 16 }}>
            <TextSkeleton width={60} height={32} />
            <TextSkeleton width={60} height={32} />
            <TextSkeleton width={60} height={32} />
          </View>
          <View style={{ height: 12 }} />
          <TextSkeleton width={100} height={10} />
          <TextSkeleton width="100%" height={14} />
          <TextSkeleton width="90%" height={14} />
          <TextSkeleton width="95%" height={14} />
          <TextSkeleton width="70%" height={14} />
          <View style={{ height: 12 }} />
          <TextSkeleton width={80} height={10} />
          <TextSkeleton width="100%" height={14} />
          <TextSkeleton width="100%" height={14} />
          <TextSkeleton width="85%" height={14} />
        </View>
      </View>
    );
  }

  const baseIngredients =
    unitMode === 'orig' ? recipe.ingredients : (convertedCache[unitMode] ?? recipe.ingredients);
  const shownIngredients = servings && servings !== recipe.servings
    ? scaleIngredients(baseIngredients, recipe.servings, servings)
    : baseIngredients;

  const heroBg = cardBgs[hashStr(recipe.title) % cardBgs.length];

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>
        {/* Hero */}
        {recipe.image_url ? (
          <View style={[styles.hero, { overflow: 'hidden' }]}>
            <Image source={{ uri: recipe.image_url }} style={StyleSheet.absoluteFill} contentFit="cover" />
            <View style={styles.heroDark} />
            <Pressable style={[styles.backBtn, { top: 14 + insets.top }]} onPress={() => navigation.goBack()}>
              <Text style={styles.backText}>←</Text>
            </Pressable>
            <Pressable style={[styles.favBtn, { top: 14 + insets.top }]} onPress={onToggleFav}>
              <Text style={[styles.favText, isFav && { color: colors.primary }]}>
                {isFav ? '♥' : '♡'}
              </Text>
            </Pressable>
          </View>
        ) : (
          <View style={[styles.hero, { backgroundColor: heroBg }]}>
            <View style={styles.heroDark} />
            <Text style={[styles.heroPlaceholder, { fontFamily: MONO }]}>[ PHOTO · HERO ]</Text>
            <Pressable style={[styles.backBtn, { top: 14 + insets.top }]} onPress={() => navigation.goBack()}>
              <Text style={styles.backText}>←</Text>
            </Pressable>
            <Pressable style={[styles.favBtn, { top: 14 + insets.top }]} onPress={onToggleFav}>
              <Text style={[styles.favText, isFav && { color: colors.primary }]}>
                {isFav ? '♥' : '♡'}
              </Text>
            </Pressable>
          </View>
        )}

        <View style={{ paddingHorizontal: 20, paddingTop: 16 }}>
          {/* Allergen flags — instant local check */}
          {allergenFlags && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              {allergenFlags.contains_gluten && (
                <View style={{ backgroundColor: '#F57F17', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
                  <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700', letterSpacing: 0.5 }}>🌾 GLUTEN</Text>
                </View>
              )}
              {allergenFlags.contains_dairy && (
                <View style={{ backgroundColor: '#F57F17', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
                  <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700', letterSpacing: 0.5 }}>🥛 DAIRY</Text>
                </View>
              )}
              {allergenFlags.contains_nuts && (
                <View style={{ backgroundColor: colors.danger, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
                  <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700', letterSpacing: 0.5 }}>🥜 NUTS</Text>
                </View>
              )}
              {allergenFlags.contains_soy && (
                <View style={{ backgroundColor: '#F57F17', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
                  <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700', letterSpacing: 0.5 }}>🫘 SOY</Text>
                </View>
              )}
              {allergenFlags.contains_eggs && (
                <View style={{ backgroundColor: '#F57F17', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
                  <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700', letterSpacing: 0.5 }}>🥚 EGGS</Text>
                </View>
              )}
              {allergenFlags.contains_shellfish && (
                <View style={{ backgroundColor: colors.danger, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
                  <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700', letterSpacing: 0.5 }}>🦐 SHELLFISH</Text>
                </View>
              )}
            </View>
          )}
          {/* Dietary audit */}
          {auditing && (
            <View style={styles.auditLoading}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={[styles.auditLoadingText, { fontFamily: MONO, color: colors.textMuted }]}>CHECKING DIETARY FIT…</Text>
            </View>
          )}
          {auditError && (
            <Text style={{ color: colors.danger, fontSize: 13, marginTop: 10 }}>{auditError}</Text>
          )}
          {auditResult && auditCollapsed && (
            <Pressable
              onPress={() => setAuditCollapsed(false)}
              style={[styles.auditCard, { backgroundColor: colors.surface, borderColor: colors.success, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 }]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontSize: 14, color: colors.success }}>✓</Text>
                <Text style={[styles.auditTitle, { color: colors.success, marginBottom: 0 }]}>DIETARY AUDIT — ALL SAFE</Text>
              </View>
              <Text style={{ fontSize: 12, color: colors.textMuted }}>TAP TO EXPAND</Text>
            </Pressable>
          )}
          {auditResult && !auditCollapsed && (
            <View style={[styles.auditCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Pressable onPress={() => auditResult.audit?.every(e => e.rating === 'safe') && setAuditCollapsed(true)} style={{ flex: 1 }}>
                  <Text style={[styles.auditTitle, { color: colors.text }]}>DIETARY AUDIT</Text>
                </Pressable>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  {auditResult.audit?.every(e => e.rating === 'safe') && (
                    <Pressable onPress={() => setAuditCollapsed(true)} hitSlop={8} style={{ padding: 4 }}>
                      <Text style={{ fontSize: 16, color: colors.textMuted }}>✕</Text>
                    </Pressable>
                  )}
                  <Pressable
                    onPress={async () => {
                      const profiles = await getDietaryProfiles();
                      if (!profiles.length || !recipe) return;
                      setAuditing(true);
                      setAuditError(null);
                      try {
                        const result = await api.auditRecipe({ recipe, dietaryProfiles: profiles });
                        setAuditResult(result);
                        setAuditCollapsed(result.audit?.every(e => e.rating === 'safe'));
                        setCachedAudit(recipe.id, profiles, recipe.updated_at, result);
                      } catch (e) {
                        setAuditError(e.message);
                      } finally {
                        setAuditing(false);
                      }
                    }}
                    hitSlop={8}
                    style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, borderColor: colors.textMuted, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Text style={{ fontSize: 14, color: colors.textMuted, lineHeight: 16, textAlign: 'center', includeFontPadding: false }}>↻</Text>
                  </Pressable>
                </View>
              </View>
              <Text style={[styles.auditOverall, { color: colors.text2 }]}>{auditResult.overall}</Text>
              {auditResult.audit?.map((entry, i) => {
                const ratingColor = entry.rating === 'safe' ? colors.success
                  : entry.rating === 'needs-modification' ? '#F57F17'
                  : entry.rating === 'not-suitable' ? colors.danger : colors.textMuted;
                const ratingLabel = entry.rating === 'safe' ? '✓ SAFE'
                  : entry.rating === 'needs-modification' ? '⚠ NEEDS MODS'
                  : entry.rating === 'not-suitable' ? '✗ NOT SUITABLE' : '?';
                return (
                  <View key={i} style={[styles.auditPerson, { borderTopColor: colors.border }]}>
                    <View style={styles.auditPersonHeader}>
                      <Text style={[styles.auditPersonName, { color: colors.text }]}>{entry.person}</Text>
                      <View style={[styles.auditBadge, { backgroundColor: ratingColor }]}>
                        <Text style={styles.auditBadgeText}>{ratingLabel}</Text>
                      </View>
                    </View>
                    {entry.flags?.length > 0 && (
                      <View style={{ marginTop: 6 }}>
                        {entry.flags.map((f, fi) => (
                          <Text key={fi} style={[styles.auditFlag, { color: colors.textMuted }]}>• {f}</Text>
                        ))}
                      </View>
                    )}
                    {entry.substitutions?.length > 0 && (
                      <View style={{ marginTop: 6 }}>
                        <Text style={[styles.auditSubLabel, { fontFamily: MONO, color: colors.primary }]}>SUBSTITUTIONS</Text>
                        {entry.substitutions.map((s, si) => (
                          <Text key={si} style={[styles.auditSub, { color: colors.text2 }]}>→ {s}</Text>
                        ))}
                      </View>
                    )}
                    {entry.notes ? (
                      <Text style={[styles.auditNotes, { color: colors.textMuted }]}>{entry.notes}</Text>
                    ) : null}
                  </View>
                );
              })}
            </View>
          )}
          {auditResult && auditResult.audit?.some(e => e.substitutions?.length > 0) && (
            <Pressable
              style={[styles.cta, { backgroundColor: colors.primary, marginTop: 12 }]}
              onPress={() => {
                const allSubs = auditResult.audit.flatMap(e => e.substitutions || []);
                // Parse each substitution into options (split on " or ", ", or ", " / ")
                const parsed = allSubs.map(sub => {
                  const parts = sub.split(/\s+or\s+|\s*\/\s*|,\s*or\s+/i).map(s => s.trim()).filter(Boolean);
                  return { original: sub, options: parts.length > 1 ? parts : [sub], selected: 0, custom: '' };
                });
                setSubOptions(parsed);
                setCustomSubText('');
                setSubPickerVisible(true);
              }}
            >
              <Text style={[styles.ctaText, { color: colors.onPrimary }]}>APPLY TERRY'S SUGGESTIONS</Text>
            </Pressable>
          )}
          {auditResult && <AiDisclaimer />}


          {/* Tags */}
          {(recipe.tags || []).length > 0 && (
            <Text style={[styles.tags, { fontFamily: MONO, color: colors.primary }]}>
              {recipe.tags.map((t) => `#${t.toUpperCase()}`).join('  ')}
            </Text>
          )}

          {/* Title + Difficulty Badge */}
          <View style={styles.titleRow}>
            <Text style={[styles.title, { color: colors.text }]}>{recipe.title.toUpperCase()}</Text>
            {(() => {
              const ings = recipe.ingredients?.length || 0;
              const steps = recipe.steps?.length || 0;
              const totalMin = (recipe.prep_minutes || 0) + (recipe.cook_minutes || 0);
              const score = ings + steps + (totalMin / 10);
              let label, bg;
              if (score <= 8) { label = 'EASY'; bg = colors.success; }
              else if (score <= 18) { label = 'MEDIUM'; bg = '#F57F17'; }
              else { label = 'HARD'; bg = colors.danger; }
              return (
                <View style={[styles.difficultyBadge, { backgroundColor: bg }]}>
                  <Text style={styles.difficultyText}>{label}</Text>
                </View>
              );
            })()}
          </View>

          {/* Description */}
          {!!recipe.description && (
            <Text style={[styles.desc, { color: colors.textMuted }]}>{recipe.description}</Text>
          )}

          {/* Share button */}
          <Pressable
            style={[styles.shareBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}
            onPress={shareRecipe}
          >
            <Text style={[styles.shareBtnText, { fontFamily: MONO, color: colors.text2 }]}>↗ SHARE</Text>
          </Pressable>

          {/* Notes */}
          {!!recipe.notes && (
            <View style={[styles.notesBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.notesLabel, { fontFamily: MONO, color: colors.primary }]}>NOTES</Text>
              <Text style={[styles.notesText, { color: colors.text2 }]}>{recipe.notes}</Text>
            </View>
          )}
          <Pressable
            style={[styles.notesQuickAdd, { borderColor: colors.border }]}
            onPress={() => { setNotesDraft(recipe.notes || ''); setNotesModal(true); }}
          >
            <Text style={[styles.notesQuickAddText, { fontFamily: MONO, color: colors.textMuted }]}>
              {recipe.notes ? '✎ EDIT NOTES' : '+ ADD NOTES…'}
            </Text>
          </Pressable>

          {/* Stats row */}
          <View style={[styles.statsRow, { borderBottomColor: colors.border }]}>
            <View style={styles.statBox}>
              <Text style={[styles.statNum, { fontFamily: MONO, color: colors.primary }]}>{recipe.prep_minutes || 0}</Text>
              <Text style={[styles.statLabel, { fontFamily: MONO, color: colors.textMuted }]}>PREP MIN</Text>
            </View>
            <View style={[styles.statBox, styles.statDivider, { borderLeftColor: colors.border }]}>
              <Text style={[styles.statNum, { fontFamily: MONO, color: colors.primary }]}>{recipe.cook_minutes || 0}</Text>
              <Text style={[styles.statLabel, { fontFamily: MONO, color: colors.textMuted }]}>COOK MIN</Text>
            </View>
            <View style={[styles.statBox, styles.statDivider, { borderLeftColor: colors.border }]}>
              <Text style={[styles.statNum, { fontFamily: MONO, color: colors.primary }]}>{(recipe.prep_minutes || 0) + (recipe.cook_minutes || 0)}</Text>
              <Text style={[styles.statLabel, { fontFamily: MONO, color: colors.textMuted }]}>TOTAL MIN</Text>
            </View>
          </View>

          {/* Nutrition */}
          {!noAI && (
          <View style={[styles.nutritionCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <View style={styles.nutritionHeader}>
              <Text style={[styles.nutritionTitle, { fontFamily: MONO, color: colors.textMuted }]}>NUTRITION PER SERVING</Text>
              {!nutrition && !loadingNutrition && (
                <Pressable
                  style={[styles.nutritionBtn, { borderColor: colors.primary }]}
                  onPress={async () => {
                    setLoadingNutrition(true);
                    try {
                      const s = recipe.servings || 1;
                      const usda = await usdaEstimate(recipe.ingredients);
                      let result;
                      if (usda && usda.matched.length > 0) {
                        result = {
                          calories: Math.round(usda.totals.calories / s),
                          protein_g: Math.round(usda.totals.protein_g / s),
                          carbs_g: Math.round(usda.totals.carbs_g / s),
                          fat_g: Math.round(usda.totals.fat_g / s),
                          fiber_g: Math.round(usda.totals.fiber_g / s),
                          source: 'usda',
                          matched: usda.matched.length,
                          total: usda.processedCount || recipe.ingredients.length,
                        };
                      } else {
                        const r = await api.estimateNutrition({ title: recipe.title, ingredients: recipe.ingredients, servings: recipe.servings });
                        result = { ...r, source: 'ai' };
                      }
                      setNutrition(result);
                      setCachedNutrition(recipe.id, recipe.updated_at, result);
                    } catch (e) { console.warn('Nutrition estimation failed:', e.message); }
                    setLoadingNutrition(false);
                  }}
                >
                  <Text style={[styles.nutritionBtnText, { color: colors.primary }]}>ESTIMATE</Text>
                </Pressable>
              )}
              {nutrition && !loadingNutrition && (
                <Pressable
                  onPress={async () => {
                    setLoadingNutrition(true);
                    try {
                      const s = recipe.servings || 1;
                      const usda = await usdaEstimate(recipe.ingredients);
                      let result;
                      if (usda && usda.matched.length > 0) {
                        result = {
                          calories: Math.round(usda.totals.calories / s),
                          protein_g: Math.round(usda.totals.protein_g / s),
                          carbs_g: Math.round(usda.totals.carbs_g / s),
                          fat_g: Math.round(usda.totals.fat_g / s),
                          fiber_g: Math.round(usda.totals.fiber_g / s),
                          source: 'usda',
                          matched: usda.matched.length,
                          total: usda.processedCount || recipe.ingredients.length,
                        };
                      } else {
                        const r = await api.estimateNutrition({ title: recipe.title, ingredients: recipe.ingredients, servings: recipe.servings });
                        result = { ...r, source: 'ai' };
                      }
                      setNutrition(result);
                      setCachedNutrition(recipe.id, recipe.updated_at, result);
                    } catch (e) { console.warn('Nutrition estimation failed:', e.message); }
                    setLoadingNutrition(false);
                  }}
                  hitSlop={8}
                  style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, borderColor: colors.textMuted, alignItems: 'center', justifyContent: 'center', marginTop: -8 }}
                >
                  <Text style={{ fontSize: 14, color: colors.textMuted, lineHeight: 16, textAlign: 'center', includeFontPadding: false }}>↻</Text>
                </Pressable>
              )}
            </View>
            {loadingNutrition && (
              <Text style={[styles.nutritionLoading, { color: colors.textMuted }]}>Calculating...</Text>
            )}
            {nutrition && (
              <>
                <View style={styles.nutritionGrid}>
                  {[
                    { label: 'CAL', value: nutrition.calories, unit: '' },
                    { label: 'PROTEIN', value: nutrition.protein_g, unit: 'g' },
                    { label: 'CARBS', value: nutrition.carbs_g, unit: 'g' },
                    { label: 'FAT', value: nutrition.fat_g, unit: 'g' },
                    { label: 'FIBER', value: nutrition.fiber_g, unit: 'g' },
                  ].map((n) => (
                    <View key={n.label} style={styles.nutritionItem}>
                      <Text style={[styles.nutritionValue, { fontFamily: MONO, color: colors.primary }]}>{n.value}{n.unit}</Text>
                      <Text style={[styles.nutritionLabel, { fontFamily: MONO, color: colors.textMuted }]}>{n.label}</Text>
                    </View>
                  ))}
                </View>
                {nutrition.summary ? (
                  <Text style={[styles.nutritionSummary, { color: colors.text2 }]}>{nutrition.summary}</Text>
                ) : null}
                <Text style={[styles.nutritionSummary, { color: colors.textMuted, fontSize: 10, marginTop: 6 }]}>
                  {nutrition.source === 'usda'
                    ? `📊 USDA Foundation Foods — ${nutrition.matched}/${nutrition.total} ingredients matched`
                    : '🤖 AI estimated — values are approximate'}
                </Text>
              </>
            )}
          </View>
          )}
          {nutrition && <AiDisclaimer />}


          {/* Serving adjuster — near ingredients */}
          {recipe.servings > 0 && (
            <View style={[styles.servingAdjuster, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <Text style={[styles.servingAdjusterLabel, { fontFamily: MONO, color: colors.textMuted }]}>
                SERVINGS
              </Text>
              <View style={styles.servingAdjusterControls}>
                <Pressable
                  style={[styles.servingBtn, { borderColor: colors.border }]}
                  onPress={() => setServings((s) => Math.max(1, s - 1))}
                  hitSlop={6}
                >
                  <Text style={[styles.servingBtnText, { color: servings > 1 ? colors.primary : colors.textMuted }]}>−</Text>
                </Pressable>
                <View style={styles.servingCountWrap}>
                  <Text style={[styles.servingCount, { color: colors.primary, fontFamily: MONO }]}>{servings}</Text>
                  {servings !== recipe.servings && (
                    <Text style={[styles.servingOriginal, { color: colors.textMuted, fontFamily: MONO }]}>
                      (from {recipe.servings})
                    </Text>
                  )}
                </View>
                <Pressable
                  style={[styles.servingBtn, { borderColor: colors.border }]}
                  onPress={() => setServings((s) => Math.min(99, s + 1))}
                  hitSlop={6}
                >
                  <Text style={[styles.servingBtnText, { color: colors.primary }]}>+</Text>
                </Pressable>
              </View>
            </View>
          )}

          {/* Ingredients */}
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>INGREDIENTS</Text>
            <View style={styles.unitPills}>
              {(noAI ? UNIT_MODES.filter((m) => m.value === 'orig') : UNIT_MODES).map((m) => (
                <Pressable
                  key={m.value}
                  style={[
                    styles.unitPill,
                    { borderColor: unitMode === m.value ? colors.primary : colors.border },
                  ]}
                  onPress={() => selectUnit(m.value)}
                  disabled={converting}
                >
                  <Text style={[
                    styles.unitPillText,
                    { fontFamily: MONO, color: unitMode === m.value ? colors.primary : colors.textMuted },
                  ]}>
                    {m.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {converting && (
            <View style={styles.convertingRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={[{ color: colors.textMuted, fontFamily: MONO, fontSize: 11 }]}>CONVERTING…</Text>
            </View>
          )}
          {convertError && <Text style={{ color: colors.danger, fontSize: 13, marginBottom: 8 }}>{convertError}</Text>}

          {shownIngredients.map((item, i) => {
            const key = `ing-${i}`;
            const ck = !!checked[key];
            return (
              <Pressable
                key={key}
                onPress={() => toggleCheck(key)}
                style={[styles.ingRow, { borderBottomColor: colors.border }]}
              >
                <View style={[styles.checkbox, { borderColor: ck ? colors.primary : colors.border, backgroundColor: ck ? 'rgba(255,90,38,0.14)' : 'transparent' }]}>
                  {ck && <Text style={{ color: colors.primary, fontSize: 11, fontWeight: '700' }}>✓</Text>}
                </View>
                <Text style={[styles.ingText, { color: ck ? colors.textMuted : colors.text2, textDecorationLine: ck ? 'line-through' : 'none' }]}>
                  {item}
                </Text>
              </Pressable>
            );
          })}

          {/* Steps */}
          {/* Prep section */}
          {!noAI && (
          <>
          <View style={[styles.prepCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <View style={styles.prepHeader}>
              <Text style={[styles.prepTitle, { fontFamily: MONO, color: colors.primary }]}>BEFORE YOU START</Text>
              {!prepSteps && !loadingPrep && (
                <Pressable
                  style={[styles.prepGenBtn, { borderColor: colors.primary }]}
                  onPress={async () => {
                    setLoadingPrep(true);
                    try {
                      const result = await api.generatePrepSteps({ title: recipe.title, ingredients: recipe.ingredients, steps: recipe.steps });
                      setPrepSteps(result.steps);
                      setCachedPrep(recipe.id, recipe.updated_at, result.steps);
                    } catch (e) { console.warn('Prep step generation failed:', e.message); }
                    setLoadingPrep(false);
                  }}
                >
                  <Text style={[styles.prepGenBtnText, { color: colors.primary }]}>GENERATE</Text>
                </Pressable>
              )}
              {prepSteps && !loadingPrep && (
                <Pressable
                  onPress={async () => {
                    setLoadingPrep(true);
                    try {
                      const result = await api.generatePrepSteps({ title: recipe.title, ingredients: recipe.ingredients, steps: recipe.steps });
                      setPrepSteps(result.steps);
                      setCachedPrep(recipe.id, recipe.updated_at, result.steps);
                    } catch (e) { console.warn('Prep step generation failed:', e.message); }
                    setLoadingPrep(false);
                  }}
                  hitSlop={8}
                  style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, borderColor: colors.textMuted, alignItems: 'center', justifyContent: 'center', marginTop: -8 }}
                >
                  <Text style={{ fontSize: 14, color: colors.textMuted, lineHeight: 16, textAlign: 'center', includeFontPadding: false }}>↻</Text>
                </Pressable>
              )}
            </View>

            {loadingPrep && (
              <Text style={[styles.prepLoading, { color: colors.textMuted }]}>Thinking about what to prep...</Text>
            )}

            {prepSteps && prepSteps.length > 0 && (
              <View style={styles.prepList}>
                {prepSteps.map((step, i) => (
                  <View key={i} style={styles.prepStep}>
                    <Text style={[styles.prepStepNum, { color: colors.primary }]}>{i + 1}</Text>
                    <Text style={[styles.prepStepText, { color: colors.text }]}>{step}</Text>
                  </View>
                ))}
              </View>
            )}

          </View>
          {prepSteps && <AiDisclaimer />}
          </>
          )}


          <Text style={[styles.sectionTitle, { color: colors.text, marginTop: 22 }]}>METHOD</Text>

          {(recipe.steps || []).map((step, i) => {
            const timerMins = parseTimerMins(step);
            const t = timers[i];
            let timerLabel = null;
            if (timerMins) {
              if (!t) timerLabel = `SET TIMER ${fmtClock(timerMins * 60)}`;
              else if (t.done) timerLabel = `✓ DONE — RESET`;
              else if (t.running) timerLabel = `${fmtClock(t.left)} · PAUSE`;
              else timerLabel = `${fmtClock(t.left)} · RESUME`;
            }
            return (
              <View key={i} style={styles.step}>
                <Text style={[styles.stepNum, { color: colors.primary }]}>
                  {String(i + 1).padStart(2, '0')}
                </Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.stepText, { color: colors.text2 }]}>{step}</Text>
                  {timerLabel && (
                    <Pressable
                      style={[styles.timerBtn, { borderColor: colors.primary, backgroundColor: t?.done ? colors.primary : 'transparent' }]}
                      onPress={() => hitTimer(i, timerMins)}
                    >
                      <Text style={[styles.timerBtnText, { fontFamily: MONO, color: t?.done ? colors.onPrimary : colors.primary }]}>
                        {timerLabel}
                      </Text>
                    </Pressable>
                  )}
                </View>
              </View>
            );
          })}

          {/* Ask Terry */}
          {!noAI && (
          <Pressable
            style={[styles.shoppingBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}
            onPress={() => navigation.navigate('Assistant', { recipe })}
          >
            <Text style={[styles.shoppingBtnText, { color: colors.text2 }]}>ASK TERRY ABOUT THIS</Text>
          </Pressable>
          )}

          {/* Add to shopping list */}
          <Pressable
            style={[styles.shoppingBtn, { borderColor: colors.primary, backgroundColor: colors.surface }]}
            onPress={async () => {
              await addItems(shownIngredients);
              setModal({ title: 'Added', message: `${shownIngredients.length} items added to your shopping list.`, buttons: [{ text: 'OK', primary: true }] });
            }}
          >
            <Text style={[styles.shoppingBtnText, { color: colors.primary }]}>ADD TO SHOPPING LIST</Text>
          </Pressable>

          {/* Edit / Share / Delete */}
          <View style={styles.actions}>
            <Pressable
              style={[styles.actionBtn, { borderColor: colors.border }]}
              onPress={() => navigation.navigate('EditRecipe', { recipe })}
            >
              <Text style={[styles.actionBtnText, { color: colors.text2 }]}>EDIT</Text>
            </Pressable>
            <Pressable
              style={[styles.actionBtn, { borderColor: colors.danger }]}
              onPress={confirmDelete}
            >
              <Text style={[styles.actionBtnText, { color: colors.danger }]}>DELETE</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>

      {/* Sticky CTA */}
      <View style={[styles.ctaWrap, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <Pressable
          style={[styles.cta, { backgroundColor: colors.primary }]}
          onPress={() => navigation.navigate('CookMode', { recipe })}
        >
          <Text style={[styles.ctaText, { color: colors.onPrimary }]}>START COOKING →</Text>
        </Pressable>
      </View>

      <AppModal visible={!!modal} title={modal?.title} message={modal?.message} buttons={modal?.buttons ?? []} colors={colors} onClose={() => setModal(null)} />

      {/* Applying substitutions loading overlay */}
      {applyingSubs && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', alignItems: 'center', zIndex: 100 }}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700', marginTop: 16, letterSpacing: 0.5 }}>APPLYING TERRY'S SUGGESTIONS…</Text>
          <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 8 }}>This may take a few seconds</Text>
          <Text style={{ color: '#D32F2F', fontSize: 12, marginTop: 16, fontWeight: '600' }}>Changes will be highlighted in red</Text>
        </View>
      )}

      {/* Substitution picker modal */}
      <Modal visible={subPickerVisible} transparent animationType="fade" onRequestClose={() => setSubPickerVisible(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 20 }}>
          <View style={{ backgroundColor: colors.surface, borderRadius: 20, borderWidth: 1.5, borderColor: colors.border, padding: 20, maxHeight: '80%' }}>
            <Text style={{ fontSize: 16, fontWeight: '900', letterSpacing: 0.5, marginBottom: 4, color: colors.text }}>TERRY'S SUGGESTIONS</Text>
            <Text style={{ fontSize: 11, color: colors.textMuted, marginBottom: 16, fontFamily: MONO }}>Pick your preferred swaps or add your own</Text>
            <ScrollView style={{ maxHeight: 400 }} showsVerticalScrollIndicator={false}>
              {subOptions.map((sub, i) => (
                <View key={i} style={{ marginBottom: 16, paddingBottom: 16, borderBottomWidth: i < subOptions.length - 1 ? 1 : 0, borderBottomColor: colors.border }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 1, color: colors.textMuted, marginBottom: 8 }}>SUGGESTION {i + 1}</Text>
                  {sub.options.map((opt, oi) => (
                    <Pressable
                      key={oi}
                      onPress={() => {
                        const next = [...subOptions];
                        next[i] = { ...next[i], selected: oi };
                        setSubOptions(next);
                      }}
                      style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 10 }}
                    >
                      <View style={{
                        width: 20, height: 20, borderRadius: 10, borderWidth: 2,
                        borderColor: sub.selected === oi ? colors.primary : colors.border,
                        alignItems: 'center', justifyContent: 'center',
                      }}>
                        {sub.selected === oi && (
                          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary }} />
                        )}
                      </View>
                      <Text style={{ flex: 1, fontSize: 14, color: colors.text, lineHeight: 20 }}>{opt}</Text>
                    </Pressable>
                  ))}
                </View>
              ))}
              {/* Custom entry */}
              <View style={{ marginBottom: 8 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 1, color: colors.textMuted, marginBottom: 8 }}>ADD YOUR OWN</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TextInput
                    style={{ flex: 1, borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: colors.text }}
                    placeholder="e.g. swap sugar for stevia"
                    placeholderTextColor={colors.textMuted}
                    value={customSubText}
                    onChangeText={setCustomSubText}
                  />
                  <Pressable
                    onPress={() => {
                      if (customSubText.trim()) {
                        setSubOptions(prev => [...prev, { original: customSubText.trim(), options: [customSubText.trim()], selected: 0, custom: customSubText.trim() }]);
                        setCustomSubText('');
                      }
                    }}
                    style={{ paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, backgroundColor: colors.primary, justifyContent: 'center' }}
                  >
                    <Text style={{ color: colors.onPrimary, fontWeight: '700', fontSize: 13 }}>ADD</Text>
                  </Pressable>
                </View>
              </View>
            </ScrollView>
            {/* Action buttons */}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              <Pressable
                onPress={() => setSubPickerVisible(false)}
                style={{ flex: 1, borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, paddingVertical: 14, alignItems: 'center' }}
              >
                <Text style={{ fontWeight: '700', fontSize: 13, color: colors.text }}>CANCEL</Text>
              </Pressable>
              <Pressable
                onPress={async () => {
                  setSubPickerVisible(false);
                  const selected = subOptions.map(s => s.options[s.selected]);
                  if (selected.length === 0) return;
                  setApplyingSubs(true);
                  try {
                    const result = await api.applySubstitutions({ recipe, substitutions: selected });
                    if (result?.recipe) {
                      // Preserve original image_url — AI doesn't return it
                      navigation.navigate('EditRecipe', { recipe: { ...result.recipe, id: recipe.id, image_url: result.recipe.image_url || recipe.image_url }, fromAudit: true, originalRecipe: recipe });
                    }
                  } catch (e) {
                    showToast({ message: 'Could not apply suggestions', duration: 3000 });
                  } finally {
                    setApplyingSubs(false);
                  }
                }}
                style={{ flex: 1.5, borderRadius: 12, paddingVertical: 14, alignItems: 'center', backgroundColor: colors.primary }}
              >
                {applyingSubs ? (
                  <ActivityIndicator size="small" color={colors.onPrimary} />
                ) : (
                  <Text style={{ fontWeight: '700', fontSize: 13, color: colors.onPrimary }}>APPLY SELECTED</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Quick notes modal */}
      <Modal visible={notesModal} transparent animationType="fade" onRequestClose={() => setNotesModal(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <View style={styles.notesModalOverlay}>
          <View style={[styles.notesModalCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.notesModalTitle, { color: colors.text }]}>RECIPE NOTES</Text>
            <TextInput
              style={[styles.notesInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface2 }]}
              value={notesDraft}
              onChangeText={setNotesDraft}
              placeholder="Add your notes..."
              placeholderTextColor={colors.textMuted}
              multiline
              autoFocus
            />
            <View style={styles.notesModalBtns}>
              <Pressable
                style={[styles.notesModalBtn, { borderColor: colors.border }]}
                onPress={() => setNotesModal(false)}
              >
                <Text style={[styles.notesModalBtnText, { color: colors.textMuted }]}>CANCEL</Text>
              </Pressable>
              <Pressable
                style={[styles.notesModalBtn, { backgroundColor: colors.primary, borderColor: colors.primary }]}
                onPress={async () => {
                  try {
                    await api.updateRecipe(id, { ...recipe, notes: notesDraft });
                    setRecipe({ ...recipe, notes: notesDraft });
                  } catch (e) {
                    setModal({ title: 'Error', message: e.message, buttons: [{ text: 'OK', primary: true }] });
                  }
                  setNotesModal(false);
                }}
              >
                <Text style={[styles.notesModalBtnText, { color: colors.onPrimary }]}>SAVE</Text>
              </Pressable>
            </View>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const makeStyles = (colors, s, fs) => StyleSheet.create({

  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hero: { height: s(250), position: 'relative', alignItems: 'center', justifyContent: 'center' },
  heroDark: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.3)' },
  heroPlaceholder: { fontSize: fs(10), letterSpacing: 1.5, color: 'rgba(255,255,255,0.4)' },
  backBtn: {
    position: 'absolute', top: s(14), left: s(14), width: s(38), height: s(38), borderRadius: s(20),
    backgroundColor: 'rgba(19,16,16,0.65)', alignItems: 'center', justifyContent: 'center',
  },
  backText: { fontSize: fs(18), color: colors.text },
  favBtn: {
    position: 'absolute', top: s(14), right: s(14), width: s(38), height: s(38), borderRadius: s(10),
    backgroundColor: 'rgba(19,16,16,0.65)', alignItems: 'center', justifyContent: 'center',
  },
  favText: { fontSize: fs(16), color: 'rgba(255,255,255,0.8)' },
  tags: { marginTop: s(10), marginBottom: s(6), fontSize: fs(11), letterSpacing: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: s(10), marginTop: s(8) },
  title: { fontSize: fs(31), fontWeight: '900', lineHeight: fs(33), letterSpacing: -0.5, flex: 1 },
  difficultyBadge: { borderRadius: s(6), paddingHorizontal: s(8), paddingVertical: s(4), marginTop: s(4) },
  difficultyText: { color: '#fff', fontSize: fs(10), fontWeight: '700', letterSpacing: 0.5 },
  desc: { fontSize: fs(14), lineHeight: fs(22), marginTop: s(10) },
  notesBox: {
    marginTop: s(14),
    padding: s(14),
    borderRadius: s(12),
    borderWidth: 1.5,
  },
  notesLabel: { fontSize: fs(10), letterSpacing: 1, marginBottom: s(6) },
  notesText: { fontSize: fs(14), lineHeight: fs(21) },
  statsRow: {
    flexDirection: 'row',
    marginTop: s(18),
    paddingBottom: s(16),
    borderBottomWidth: 1,
  },
  statBox: { flex: 1, paddingBottom: 0 },
  statDivider: { borderLeftWidth: 1, paddingLeft: s(18) },
  statNum: { fontSize: fs(29), fontWeight: '900' },
  statLabel: { fontSize: fs(10), letterSpacing: 1, marginTop: s(2) },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: s(20),
  },
  // Nutrition
  nutritionCard: { borderWidth: 1.5, borderRadius: s(14), padding: s(16), marginTop: s(16) },
  nutritionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: s(4) },
  nutritionTitle: { fontSize: fs(10), letterSpacing: 1.5 },
  nutritionBtn: { borderWidth: 1.5, borderRadius: s(8), paddingHorizontal: s(12), paddingVertical: s(6) },
  nutritionBtnText: { fontSize: fs(11), fontWeight: '700', letterSpacing: 0.5 },
  nutritionLoading: { fontSize: fs(13), paddingVertical: s(8) },
  nutritionGrid: { flexDirection: 'row', justifyContent: 'space-between', marginTop: s(10) },
  nutritionItem: { alignItems: 'center', flex: 1 },
  nutritionValue: { fontSize: fs(18), fontWeight: '900' },
  nutritionLabel: { fontSize: fs(9), letterSpacing: 1, marginTop: s(2) },
  nutritionSummary: { fontSize: fs(13), lineHeight: fs(20), marginTop: s(14), fontStyle: 'italic' },
  // Prep section
  prepCard: { borderWidth: 1.5, borderRadius: s(14), padding: s(16), marginTop: s(22) },
  prepHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: s(4) },
  prepTitle: { fontSize: fs(10), letterSpacing: 1.5 },
  prepGenBtn: { borderWidth: 1.5, borderRadius: s(8), paddingHorizontal: s(12), paddingVertical: s(6) },
  prepGenBtnText: { fontSize: fs(11), fontWeight: '700', letterSpacing: 0.5 },
  prepLoading: { fontSize: fs(13), paddingVertical: s(8) },
  prepList: { marginTop: s(8), gap: s(8) },
  prepStep: { flexDirection: 'row', alignItems: 'flex-start', gap: s(10) },
  prepStepNum: { fontSize: fs(13), fontWeight: '900', width: s(20), textAlign: 'right' },
  prepStepText: { fontSize: fs(14), lineHeight: fs(20), flex: 1 },
  // Serving adjuster
  servingAdjuster: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: s(18),
    marginBottom: s(4),
    paddingVertical: s(12),
    paddingHorizontal: s(14),
    borderWidth: 1.5,
    borderRadius: s(12),
  },
  servingAdjusterLabel: {
    fontSize: fs(10),
    letterSpacing: 1,
  },
  servingAdjusterControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(12),
  },
  servingBtn: {
    width: s(34),
    height: s(34),
    borderRadius: s(8),
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  servingBtnText: {
    fontSize: fs(20),
    fontWeight: '700',
  },
  servingCountWrap: {
    alignItems: 'center',
    minWidth: s(44),
  },
  servingCount: {
    fontSize: fs(22),
    fontWeight: '900',
  },
  servingOriginal: {
    fontSize: fs(10),
    marginTop: s(1),
  },
  sectionTitle: { fontSize: fs(17), fontWeight: '900', letterSpacing: 0.5 },
  unitPills: { flexDirection: 'row', gap: s(6) },
  unitPill: { borderWidth: 1.5, borderRadius: s(6), paddingHorizontal: s(9), paddingVertical: s(4) },
  unitPillText: { fontSize: fs(10), letterSpacing: 0.5 },
  convertingRow: { flexDirection: 'row', alignItems: 'center', gap: s(8), marginVertical: s(8) },
  ingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: s(12),
    paddingVertical: s(11),
    borderBottomWidth: 1,
  },
  checkbox: {
    width: s(19),
    height: s(19),
    borderRadius: s(6),
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: s(1),
    flexShrink: 0,
  },
  ingText: { flex: 1, fontSize: fs(14), lineHeight: fs(21) },
  step: { flexDirection: 'row', gap: s(16), paddingVertical: s(12) },
  stepNum: { fontSize: fs(32), fontWeight: '900', lineHeight: fs(36), width: s(48), flexShrink: 0 },
  stepText: { fontSize: fs(14), lineHeight: fs(22), flex: 1 },
  timerBtn: {
    alignSelf: 'flex-start',
    marginTop: s(8),
    borderWidth: 1.5,
    borderRadius: s(6),
    paddingHorizontal: s(12),
    paddingVertical: s(6),
  },
  timerBtnText: { fontSize: fs(11), letterSpacing: 1 },
  actions: { flexDirection: 'row', gap: s(12), marginTop: s(28) },
  shoppingBtn: {
    marginTop: s(20),
    borderWidth: 1.5,
    borderRadius: s(12),
    paddingVertical: s(13),
    alignItems: 'center',
  },
  shoppingBtnText: { fontWeight: '700', fontSize: fs(13), letterSpacing: 1 },
  auditCard: { borderWidth: 1.5, borderRadius: s(16), padding: s(16), marginTop: s(14), marginBottom: s(4) },
  auditLoading: { flexDirection: 'row', alignItems: 'center', gap: s(10), marginTop: s(14), marginBottom: s(4) },
  auditLoadingText: { fontSize: fs(11), letterSpacing: 1 },
  auditTitle: { fontSize: fs(14), fontWeight: '900', letterSpacing: 1, marginBottom: s(8) },
  auditOverall: { fontSize: fs(14), lineHeight: fs(21), marginBottom: s(12) },
  auditPerson: { borderTopWidth: 1, paddingTop: s(12), marginTop: s(8) },
  auditPersonHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  auditPersonName: { fontSize: fs(15), fontWeight: '700' },
  auditBadge: { borderRadius: s(6), paddingHorizontal: s(8), paddingVertical: s(4) },
  auditBadgeText: { color: '#fff', fontSize: fs(10), fontWeight: '700', letterSpacing: 0.5 },
  auditFlag: { fontSize: fs(13), lineHeight: fs(20) },
  auditSubLabel: { fontSize: fs(10), letterSpacing: 1, marginBottom: s(4) },
  auditSub: { fontSize: fs(13), lineHeight: fs(20) },
  auditNotes: { fontSize: fs(12), lineHeight: fs(18), marginTop: s(6), fontStyle: 'italic' },
  actionBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: s(10),
    paddingVertical: s(13),
    alignItems: 'center',
  },
  actionBtnText: { fontWeight: '700', fontSize: fs(13), letterSpacing: 1 },
  ctaWrap: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: s(16), paddingVertical: s(10), zIndex: 20 },
  cta: { borderRadius: s(28), paddingVertical: s(17), alignItems: 'center', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.1)', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: s(4) }, elevation: 6, marginHorizontal: s(20) },

  shareBtn: {
    borderWidth: 1.5,
    borderRadius: s(8),
    paddingHorizontal: s(14),
    paddingVertical: s(8),
  },
  shareBtnText: { fontSize: fs(11), letterSpacing: 1, fontWeight: '700' },
  ctaText: { fontWeight: '900', fontSize: fs(15), letterSpacing: 1 },
  notesQuickAdd: {
    marginTop: s(8),
    paddingVertical: s(8),
    borderWidth: 1.5,
    borderRadius: s(10),
    borderStyle: 'dashed',
    alignItems: 'center',
  },
  notesQuickAddText: { fontSize: fs(11), letterSpacing: 0.8 },
  notesModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: s(30),
  },
  notesModalCard: {
    width: '100%',
    maxWidth: s(340),
    borderWidth: 1.5,
    borderRadius: s(20),
    padding: s(24),
    alignItems: 'center',
  },
  notesModalTitle: {
    fontSize: fs(18),
    fontWeight: '900',
    letterSpacing: -0.3,
    textAlign: 'center',
    marginBottom: s(16),
  },
  notesInput: {
    width: '100%',
    minHeight: s(100),
    borderWidth: 1.5,
    borderRadius: s(12),
    padding: s(14),
    fontSize: fs(14),
    lineHeight: fs(21),
    textAlignVertical: 'top',
    marginBottom: s(16),
  },
  notesModalBtns: {
    flexDirection: 'row',
    gap: s(12),
    width: '100%',
  },
  notesModalBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: s(12),
    paddingVertical: s(14),
    alignItems: 'center',
  },
  notesModalBtnText: {
    fontWeight: '900',
    fontSize: fs(13),
    letterSpacing: 1,
  },

  });