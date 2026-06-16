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
import { setStringAsync as setClipboardString } from 'expo-clipboard';
import { getFavorites, toggleFavorite } from '../favorites';
import { scaleIngredients } from '../utils/scaleIngredients';
import { heroCardColors, hashStr } from '../utils/heroColors';
import { addItems } from '../shoppingList';
import { getDietaryProfiles } from '../dietProfiles';
import { TextSkeleton } from '../components/Skeleton';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAi } from '../aiContext';



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

function fmtClock(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}



export default function RecipeDetailScreen({ route, navigation }) {
  const { colors } = useTheme();
  const { noAI } = useAi();
  const styles = useMemo(() => makeStyles(colors), [colors]);
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

  // Step timers: { [stepIndex]: { left, total, running, done } }
  const [timers, setTimers] = useState({});
  const prevTimersRef = useRef({});
  const vibratingRef = useRef({}); // { [stepIndex]: intervalId }
  const [modal, setModal] = useState(null);
  const [notesModal, setNotesModal] = useState(false);
  const [notesDraft, setNotesDraft] = useState('');
  const intervalRef = useRef(null);

  useFocusEffect(
    useCallback(() => {
      api
        .getRecipe(id)
        .then(async (r) => {
          setRecipe(r);
          setServings(r.servings);
          const favs = await getFavorites();
          setIsFav(!!favs[id]);
          // Auto-trigger dietary audit if profiles exist (skip if AI disabled)
          if (!noAI) {
          const profiles = await getDietaryProfiles();
          if (profiles.length > 0) {
            setAuditing(true);
            setAuditError(null);
            setAuditResult(null);
            try {
              const result = await api.auditRecipe({ recipe: r, dietaryProfiles: profiles });
              setAuditResult(result);
            } catch (e) {
              setAuditError(e.message);
            } finally {
              setAuditing(false);
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

  const copyRecipe = async () => {
    try {
      await setClipboardString(buildRecipeText());
      setModal({
        title: 'Copied',
        message: 'Recipe copied to clipboard.',
        buttons: [{ text: 'OK', primary: true }],
      });
    } catch (e) {
      setModal({
        title: 'Error',
        message: e.message,
        buttons: [{ text: 'OK', primary: true }],
      });
    }
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
          {auditResult && (
            <View style={[styles.auditCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.auditTitle, { color: colors.text }]}>DIETARY AUDIT</Text>
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
              let label, bg;
              if (ings <= 5 && steps <= 5) { label = 'EASY'; bg = colors.success; }
              else if (ings <= 10 && steps <= 10) { label = 'MEDIUM'; bg = '#F57F17'; }
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

          {/* Share / Copy buttons near title */}
          <View style={styles.shareRow}>
            <Pressable
              style={[styles.shareBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}
              onPress={shareRecipe}
            >
              <Text style={[styles.shareBtnText, { fontFamily: MONO, color: colors.text2 }]}>↗ SHARE</Text>
            </Pressable>
            <Pressable
              style={[styles.shareBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}
              onPress={copyRecipe}
            >
              <Text style={[styles.shareBtnText, { fontFamily: MONO, color: colors.text2 }]}>⧉ COPY RECIPE</Text>
            </Pressable>
          </View>

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
                      const result = await api.estimateNutrition({ title: recipe.title, ingredients: recipe.ingredients, servings: recipe.servings });
                      setNutrition(result.nutrition);
                    } catch (e) { console.warn('Nutrition estimation failed:', e.message); }
                    setLoadingNutrition(false);
                  }}
                >
                  <Text style={[styles.nutritionBtnText, { color: colors.primary }]}>ESTIMATE</Text>
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
                    } catch (e) { console.warn('Prep step generation failed:', e.message); }
                    setLoadingPrep(false);
                  }}
                >
                  <Text style={[styles.prepGenBtnText, { color: colors.primary }]}>GENERATE</Text>
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
      <View style={[styles.ctaWrap, { backgroundColor: colors.background }]}>
        <Pressable
          style={[styles.cta, { backgroundColor: colors.primary }]}
          onPress={() => navigation.navigate('CookMode', { recipe })}
        >
          <Text style={[styles.ctaText, { color: colors.onPrimary }]}>START COOKING →</Text>
        </Pressable>
      </View>

      <AppModal visible={!!modal} title={modal?.title} message={modal?.message} buttons={modal?.buttons ?? []} colors={colors} onClose={() => setModal(null)} />



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

const makeStyles = (colors) => StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hero: { height: 250, position: 'relative', alignItems: 'center', justifyContent: 'center' },
  heroDark: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.3)' },
  heroPlaceholder: { fontSize: 10, letterSpacing: 1.5, color: 'rgba(255,255,255,0.4)' },
  backBtn: {
    position: 'absolute', top: 14, left: 14, width: 38, height: 38, borderRadius: 10,
    backgroundColor: 'rgba(19,16,16,0.65)', alignItems: 'center', justifyContent: 'center',
  },
  backText: { fontSize: 18, color: colors.text },
  favBtn: {
    position: 'absolute', top: 14, right: 14, width: 38, height: 38, borderRadius: 10,
    backgroundColor: 'rgba(19,16,16,0.65)', alignItems: 'center', justifyContent: 'center',
  },
  favText: { fontSize: 16, color: 'rgba(255,255,255,0.8)' },
  tags: { marginTop: 10, marginBottom: 6, fontSize: 11, letterSpacing: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 8 },
  title: { fontSize: 31, fontWeight: '900', lineHeight: 33, letterSpacing: -0.5, flex: 1 },
  difficultyBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, marginTop: 4 },
  difficultyText: { color: '#fff', fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  desc: { fontSize: 14, lineHeight: 22, marginTop: 10 },
  notesBox: {
    marginTop: 14,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  notesLabel: { fontSize: 10, letterSpacing: 1, marginBottom: 6 },
  notesText: { fontSize: 14, lineHeight: 21 },
  statsRow: {
    flexDirection: 'row',
    marginTop: 18,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  statBox: { flex: 1, paddingBottom: 0 },
  statDivider: { borderLeftWidth: 1, paddingLeft: 18 },
  statNum: { fontSize: 29, fontWeight: '900' },
  statLabel: { fontSize: 10, letterSpacing: 1, marginTop: 2 },
  servingsRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  servBtn: { fontSize: 22, fontWeight: '700' },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 20,
  },
  // Nutrition
  nutritionCard: { borderWidth: 1.5, borderRadius: 14, padding: 16, marginTop: 16 },
  nutritionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  nutritionTitle: { fontSize: 10, letterSpacing: 1.5 },
  nutritionBtn: { borderWidth: 1.5, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  nutritionBtnText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  nutritionLoading: { fontSize: 13, paddingVertical: 8 },
  nutritionGrid: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  nutritionItem: { alignItems: 'center', flex: 1 },
  nutritionValue: { fontSize: 18, fontWeight: '900' },
  nutritionLabel: { fontSize: 9, letterSpacing: 1, marginTop: 2 },
  nutritionSummary: { fontSize: 13, lineHeight: 20, marginTop: 14, fontStyle: 'italic' },
  // Prep section
  prepCard: { borderWidth: 1.5, borderRadius: 14, padding: 16, marginTop: 22 },
  prepHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  prepTitle: { fontSize: 10, letterSpacing: 1.5 },
  prepGenBtn: { borderWidth: 1.5, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  prepGenBtnText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  prepLoading: { fontSize: 13, paddingVertical: 8 },
  prepList: { marginTop: 8, gap: 8 },
  prepStep: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  prepStepNum: { fontSize: 13, fontWeight: '900', width: 20, textAlign: 'right' },
  prepStepText: { fontSize: 14, lineHeight: 20, flex: 1 },
  prepGrid: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  prepItem: { alignItems: 'center', flex: 1 },
  prepValue: { fontSize: 16, fontWeight: '900' },
  prepLabel: { fontSize: 9, letterSpacing: 1, marginTop: 2 },
  prepNotes: { marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' },
  prepNotesLabel: { fontSize: 9, letterSpacing: 1.5, marginBottom: 6 },
  prepNotesText: { fontSize: 14, lineHeight: 21 },
  // Serving adjuster
  servingAdjuster: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 18,
    marginBottom: 4,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1.5,
    borderRadius: 12,
  },
  servingAdjusterLabel: {
    fontSize: 10,
    letterSpacing: 1,
  },
  servingAdjusterControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  servingBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  servingBtnText: {
    fontSize: 20,
    fontWeight: '700',
  },
  servingCountWrap: {
    alignItems: 'center',
    minWidth: 44,
  },
  servingCount: {
    fontSize: 22,
    fontWeight: '900',
  },
  servingOriginal: {
    fontSize: 10,
    marginTop: 1,
  },
  sectionTitle: { fontSize: 17, fontWeight: '900', letterSpacing: 0.5 },
  unitPills: { flexDirection: 'row', gap: 6 },
  unitPill: { borderWidth: 1.5, borderRadius: 6, paddingHorizontal: 9, paddingVertical: 4 },
  unitPillText: { fontSize: 10, letterSpacing: 0.5 },
  convertingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 8 },
  ingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 11,
    borderBottomWidth: 1,
  },
  checkbox: {
    width: 19,
    height: 19,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
    flexShrink: 0,
  },
  ingText: { flex: 1, fontSize: 14, lineHeight: 21 },
  step: { flexDirection: 'row', gap: 16, paddingVertical: 12 },
  stepNum: { fontSize: 32, fontWeight: '900', lineHeight: 36, width: 48, flexShrink: 0 },
  stepText: { fontSize: 14, lineHeight: 22, flex: 1 },
  timerBtn: {
    alignSelf: 'flex-start',
    marginTop: 8,
    borderWidth: 1.5,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  timerBtnText: { fontSize: 11, letterSpacing: 1 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 28 },
  shoppingBtn: {
    marginTop: 20,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  shoppingBtnText: { fontWeight: '700', fontSize: 13, letterSpacing: 1 },
  auditCard: { borderWidth: 1.5, borderRadius: 16, padding: 16, marginTop: 14, marginBottom: 4 },
  auditLoading: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, marginBottom: 4 },
  auditLoadingText: { fontSize: 11, letterSpacing: 1 },
  auditTitle: { fontSize: 14, fontWeight: '900', letterSpacing: 1, marginBottom: 8 },
  auditOverall: { fontSize: 14, lineHeight: 21, marginBottom: 12 },
  auditPerson: { borderTopWidth: 1, paddingTop: 12, marginTop: 8 },
  auditPersonHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  auditPersonName: { fontSize: 15, fontWeight: '700' },
  auditBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  auditBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  auditFlag: { fontSize: 13, lineHeight: 20 },
  auditSubLabel: { fontSize: 10, letterSpacing: 1, marginBottom: 4 },
  auditSub: { fontSize: 13, lineHeight: 20 },
  auditNotes: { fontSize: 12, lineHeight: 18, marginTop: 6, fontStyle: 'italic' },
  actionBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  actionBtnText: { fontWeight: '700', fontSize: 13, letterSpacing: 1 },
  ctaWrap: { paddingHorizontal: 16, paddingVertical: 10 },
  cta: { borderRadius: 28, paddingVertical: 17, alignItems: 'center', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.1)', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  shareRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  shareBtn: {
    borderWidth: 1.5,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  shareBtnText: { fontSize: 11, letterSpacing: 1, fontWeight: '700' },
  ctaText: { fontWeight: '900', fontSize: 15, letterSpacing: 1 },
  notesQuickAdd: {
    marginTop: 8,
    paddingVertical: 8,
    borderWidth: 1.5,
    borderRadius: 10,
    borderStyle: 'dashed',
    alignItems: 'center',
  },
  notesQuickAddText: { fontSize: 11, letterSpacing: 0.8 },
  notesModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 30,
  },
  notesModalCard: {
    width: '100%',
    maxWidth: 340,
    borderWidth: 1.5,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
  },
  notesModalTitle: {
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.3,
    textAlign: 'center',
    marginBottom: 16,
  },
  notesInput: {
    width: '100%',
    minHeight: 100,
    borderWidth: 1.5,
    borderRadius: 12,
    padding: 14,
    fontSize: 14,
    lineHeight: 21,
    textAlignVertical: 'top',
    marginBottom: 16,
  },
  notesModalBtns: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  notesModalBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  notesModalBtnText: {
    fontWeight: '900',
    fontSize: 13,
    letterSpacing: 1,
  },
});
