import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Modal,
  PanResponder,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useFocusEffect } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { api } from '../api';
import { MONO, useTheme } from '../theme';
import { getMealPlan, setMeal, clearMeal, getWeekStart, formatDate, MEALS, MEAL_META, getCachedPlan } from '../mealPlan';
import { getCachedRecipesSync } from '../offlineCache';
import { getDietaryProfiles } from '../dietProfiles';
import BottomNav from '../components/BottomNav';
import AppModal from '../components/AppModal';
import { useToast } from '../components/Toast';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAi } from '../aiContext';


const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const FULL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const MEAL_GOALS = [
  { key: 'balanced', icon: '⚖️', label: 'Balanced', desc: 'Mix of everything, no restrictions' },
  { key: 'protein', icon: '💪', label: 'High Protein', desc: 'Prioritise protein-rich meals' },
  { key: 'loss', icon: '🔥', label: 'Weight Loss', desc: 'Lower calorie, lighter options' },
  { key: 'gain', icon: '🏋️', label: 'Muscle Gain', desc: 'Calorie-dense, high protein' },
  { key: 'quick', icon: '⚡', label: 'Quick & Easy', desc: 'Minimal cooking, fast meals' },
  { key: 'variety', icon: '🌍', label: 'Variety', desc: 'Maximise different cuisines' },
];

export default function MealPlannerScreen({ navigation }) {
  const { colors } = useTheme();
  const { noAI } = useAi();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();


  const [plan, setPlan] = useState(() => getCachedPlan());
  const [recipes, setRecipes] = useState(() => getCachedRecipesSync());
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDay, setSelectedDay] = useState(0); // 0-6 index into week
  const [picking, setPicking] = useState(null); // { date, meal }
  const [suggesting, setSuggesting] = useState(false);
  const [modal, setModal] = useState(null);
  const [goalPicker, setGoalPicker] = useState(false);
  const [selectedGoal, setSelectedGoal] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const { showToast } = useToast();
  const swipeStartX = useRef(0);
  const slideAnim = useRef(new Animated.Value(0)).current;

  // Free image memory when screen unmounts
  useEffect(() => {
    return () => { Image.clearMemoryCache().catch(() => {}); };
  }, []);

  const weekStart = getWeekStart(weekOffset);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  const load = useCallback(async () => {
    const [p, recs] = await Promise.all([
      getMealPlan(),
      api.listRecipes().catch(() => []),
    ]);
    setPlan(p);
    setRecipes(recs);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const weekLabel = () => {
    const first = days[0];
    const last = days[6];
    const f = `${first.getDate()} ${first.toLocaleString('default', { month: 'short' })}`;
    const l = `${last.getDate()} ${last.toLocaleString('default', { month: 'short' })}`;
    return `${f} – ${l}`;
  };

  const getRecipe = (id) => recipes.find((r) => r.id === id);

  const handleSlotPress = (date, meal) => {
    const key = formatDate(date);
    if (plan[key]?.[meal]) {
      clearMeal(key, meal).then(setPlan);
    } else {
      setPicking({ date: key, meal });
    }
  };

  const handlePick = async (recipeId) => {
    if (!picking) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await setMeal(picking.date, picking.meal, recipeId);
    setPicking(null);
    load();
  };

  const handleAiSuggest = () => {
    if (!recipes.length) {
      showToast('Add some recipes first');
      return;
    }
    setGoalPicker(true);
  };

  const runAiPlan = async (goal) => {
    setGoalPicker(false);
    setSuggesting(true);
    try {
      const dietaryProfiles = await getDietaryProfiles();
      const body = {
        goal,
        recipes: recipes.map((r) => ({
          id: r.id,
          title: r.title,
          tags: r.tags,
          ingredients: r.ingredients,
          servings: r.servings,
          prep_minutes: r.prep_minutes,
          cook_minutes: r.cook_minutes,
        })),
      };
      if (dietaryProfiles?.length) body.dietaryProfiles = dietaryProfiles;
      const result = await api.aiMealPlan(body);
      if (!result.days?.length) {
        showToast('Could not generate a meal plan');
        return;
      }
      const DAY_MAP = { Monday: 0, Tuesday: 1, Wednesday: 2, Thursday: 3, Friday: 4, Saturday: 5, Sunday: 6 };
      for (const day of result.days) {
        const offset = DAY_MAP[day.day];
        if (offset === undefined) continue;
        const d = new Date(weekStart);
        d.setDate(d.getDate() + offset);
        const key = formatDate(d);
        for (const meal of MEALS) {
          const entry = day.meals?.[meal];
          if (entry?.id) {
            await setMeal(key, meal, entry.id);
          }
        }
      }
      load();
    } catch (e) {
      setModal({ title: 'Error', message: e.message, buttons: [{ text: 'OK', primary: true }] });
    } finally {
      setSuggesting(false);
    }
  };

  // Swipe between days
  const daySwipe = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dx) > 20 && Math.abs(gs.dx) > Math.abs(gs.dy) * 1.5,
    onPanResponderMove: (_, gs) => {
      slideAnim.setValue(gs.dx * 0.3);
    },
    onPanResponderRelease: (_, gs) => {
      if (gs.dx < -40 || gs.vx < -0.3) {
        // Swipe left → next day
        Animated.timing(slideAnim, { toValue: -50, duration: 120, useNativeDriver: true }).start(() => {
          setSelectedDay((d) => Math.min(6, d + 1));
          slideAnim.setValue(50);
          Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 200, friction: 20 }).start();
        });
      } else if (gs.dx > 40 || gs.vx > 0.3) {
        // Swipe right → prev day
        Animated.timing(slideAnim, { toValue: 50, duration: 120, useNativeDriver: true }).start(() => {
          setSelectedDay((d) => Math.max(0, d - 1));
          slideAnim.setValue(-50);
          Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 200, friction: 20 }).start();
        });
      } else {
        // Snap back
        Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 200, friction: 20 }).start();
      }
    },
  })).current;

  // Recipe picker view
  if (picking) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: 20 + insets.top }]}>
          <Pressable style={[styles.backBtn, { borderColor: colors.border }]} onPress={() => setPicking(null)}>
            <Text style={{ fontSize: 17, color: colors.text }}>←</Text>
          </Pressable>
          <Text style={[styles.title, { color: colors.text }]}>
            {MEAL_META[picking.meal]?.icon} {MEAL_META[picking.meal]?.label?.toUpperCase()}
          </Text>
        </View>
        <FlatList
          data={recipes}
          keyExtractor={(r) => String(r.id)}
          contentContainerStyle={styles.list}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={5}
          removeClippedSubviews={true}
          renderItem={({ item }) => (
            <Pressable
              style={[styles.pickCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
              onPress={() => handlePick(item.id)}
            >
              {item.image_url ? (
                <Image source={{ uri: item.image_url }} style={styles.pickImg} contentFit="cover" />
              ) : (
                <View style={[styles.pickImgPlaceholder, { backgroundColor: colors.background }]}>
                  <Text style={{ color: colors.textMuted, fontSize: 10 }}>NO PHOTO</Text>
                </View>
              )}
              <View style={styles.pickInfo}>
                <Text style={[styles.pickTitle, { color: colors.text }]}>{item.title}</Text>
                <Text style={[styles.pickMeta, { fontFamily: MONO, color: colors.textMuted }]}>
                  {(item.prep_minutes || 0) + (item.cook_minutes || 0)} min · {item.servings || 1} servings
                </Text>
              </View>
            </Pressable>
          )}
          ListEmptyComponent={
            <View style={styles.emptyPick}>
              <Text style={[styles.emptyTitle, { color: colors.textMuted }]}>NO RECIPES YET</Text>
              <Text style={[styles.emptyHint, { fontFamily: MONO, color: colors.textMuted }]}>Add some recipes first.</Text>
            </View>
          }
        />
        <BottomNav active="planner" navigation={navigation} />
      </View>
    );
  }

  const currentDate = days[selectedDay];
  const currentKey = formatDate(currentDate);
  const isToday = formatDate(new Date()) === currentKey;
  const dayMeals = plan[currentKey] || {};

  // Count meals this week
  const weekMealCount = days.reduce((sum, d) => {
    const key = formatDate(d);
    return sum + Object.keys(plan[key] || {}).length;
  }, 0);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: 20 + insets.top }]}>
        <Text style={[styles.title, { color: colors.text }]}>MEAL PLAN</Text>
        {!noAI && (
        <Pressable onPress={handleAiSuggest} disabled={suggesting} style={[styles.aiBtn, { borderColor: colors.primary }]}>
          {suggesting ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Text style={[styles.aiBtnText, { fontFamily: MONO, color: colors.primary }]}>FILL WEEK</Text>
          )}
        </Pressable>
        )}
      </View>

      {/* Week nav */}
      <View style={styles.weekNav}>
        <Pressable onPress={() => setWeekOffset((o) => o - 1)} hitSlop={10} style={styles.weekArrowBtn}>
          <Text style={[styles.weekArrow, { color: colors.textMuted }]}>←</Text>
        </Pressable>
        <Text style={[styles.weekLabel, { fontFamily: MONO, color: colors.primary }]}>{weekLabel()}</Text>
        <Pressable onPress={() => setWeekOffset((o) => o + 1)} hitSlop={10} style={styles.weekArrowBtn}>
          <Text style={[styles.weekArrow, { color: colors.textMuted }]}>→</Text>
        </Pressable>
      </View>

      {/* Day selector strip */}
      <View style={styles.dayStrip}>
        {days.map((date, i) => {
          const key = formatDate(date);
          const active = i === selectedDay;
          const today = formatDate(new Date()) === key;
          const mealCount = Object.keys(plan[key] || {}).length;
          return (
            <Pressable
              key={key}
              style={[
                styles.dayChip,
                { borderColor: colors.border },
                active && { backgroundColor: colors.primary, borderColor: colors.primary },
                today && !active && { borderColor: colors.primary },
              ]}
              onPress={() => setSelectedDay(i)}
            >
              <Text style={[styles.dayChipName, { color: active ? colors.onPrimary : colors.textMuted }]}>
                {DAYS[i]}
              </Text>
              <Text style={[styles.dayChipDate, { color: active ? colors.onPrimary : colors.text }]}>
                {date.getDate()}
              </Text>
              {mealCount > 0 && (
                <View style={[styles.dayDot, { backgroundColor: active ? colors.onPrimary : colors.primary }]} />
              )}
            </Pressable>
          );
        })}
      </View>

      {/* Swipeable day area */}
      <View style={{ flex: 1 }} {...daySwipe.panHandlers}>
        <Animated.View style={{ flex: 1, transform: [{ translateX: slideAnim }] }}>
        {/* Day label */}
        <View style={styles.dayLabelRow}>
          <Text style={[styles.dayLabel, { color: colors.text }]}>
            {FULL_DAYS[selectedDay]}{isToday ? ' · TODAY' : ''}
          </Text>
          <Text style={[styles.dayStats, { fontFamily: MONO, color: colors.textMuted }]}>
            {weekMealCount} meals this week
          </Text>
        </View>

        {/* Meal cards */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.mealList}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
            />
          }
        >
        {MEALS.map((meal) => {
            const meta = MEAL_META[meal];
            const recipeId = dayMeals[meal];
            const recipe = recipeId ? getRecipe(recipeId) : null;

            if (recipe) {
              return (
                <View
                  key={meal}
                  style={[styles.mealCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
                >
                  <View style={[styles.mealCardAccent, { backgroundColor: meta.color }]} />
                  <Pressable style={styles.mealCardPressable} onPress={() => navigation.navigate('RecipeDetail', { id: recipe.id })}>
                    <View style={styles.mealCardLeft}>
                      <Text style={styles.mealCardIcon}>{meta.icon}</Text>
                    </View>
                    <View style={styles.mealCardBody}>
                      <Text style={[styles.mealCardLabel, { fontFamily: MONO, color: meta.color }]}>{meta.label.toUpperCase()}</Text>
                      <Text style={[styles.mealCardTitle, { color: colors.text }]} numberOfLines={2}>{recipe.title}</Text>
                      <Text style={[styles.mealCardMeta, { color: colors.textMuted }]}>
                        {(recipe.prep_minutes || 0) + (recipe.cook_minutes || 0)} min · {recipe.servings || 1} servings
                      </Text>
                    </View>
                  </Pressable>
                  <Pressable style={styles.mealCardClear} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); clearMeal(currentKey, meal).then(setPlan); }} hitSlop={12}>
                    <Text style={{ color: colors.textMuted, fontSize: 14, fontWeight: '700' }}>✕</Text>
                  </Pressable>
                </View>
              );
            }

            return (
              <Pressable
                key={meal}
                style={[styles.mealCardEmpty, { borderColor: meta.color, backgroundColor: colors.surface }]}
                onPress={() => handleSlotPress(currentDate, meal)}
              >
                <Text style={[styles.mealCardEmptyIcon]}>{meta.icon}</Text>
                <View>
                  <Text style={[styles.mealCardEmptyLabel, { color: meta.color }]}>{meta.label}</Text>
                  <Text style={[styles.mealCardEmptyHint, { color: colors.textMuted }]}>Tap to add a recipe</Text>
                </View>
                <Text style={[styles.mealCardAdd, { color: meta.color }]}>+</Text>
              </Pressable>
            );
          })}
      </ScrollView>
        </Animated.View>
      </View>

      <AppModal visible={!!modal} title={modal?.title} message={modal?.message} buttons={modal?.buttons ?? []} colors={colors} onClose={() => setModal(null)} />

      {/* Goal picker modal */}
      <Modal visible={goalPicker} transparent animationType="fade" onRequestClose={() => setGoalPicker(false)}>
        <Pressable style={styles.goalOverlay} onPress={() => setGoalPicker(false)}>
          <Pressable style={[styles.goalSheet, { backgroundColor: colors.surface, borderColor: colors.border }]} onPress={() => {}}>
            <View style={styles.goalHandle} />
            <Text style={[styles.goalTitle, { color: colors.text }]}>WHAT'S THE FOCUS?</Text>
            <Text style={[styles.goalSub, { fontFamily: MONO, color: colors.textMuted }]}>Pick a goal for this week's meals</Text>
            <View style={styles.goalGrid}>
              {MEAL_GOALS.map((g) => (
                <Pressable
                  key={g.key}
                  style={[styles.goalCard, { borderColor: selectedGoal === g.key ? colors.primary : colors.border, backgroundColor: selectedGoal === g.key ? colors.primary + '15' : colors.surface }]}
                  onPress={() => runAiPlan(g.key)}
                >
                  <Text style={styles.goalIcon}>{g.icon}</Text>
                  <Text style={[styles.goalLabel, { color: colors.text }]}>{g.label}</Text>
                  <Text style={[styles.goalDesc, { fontFamily: MONO, color: colors.textMuted }]}>{g.desc}</Text>
                </Pressable>
              ))}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <BottomNav active="planner" navigation={navigation} />
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  backBtn: { width: 38, height: 38, borderRadius: 10, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '900', letterSpacing: 0.5 },
  aiBtn: {
    borderWidth: 1.5,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  aiBtnText: { fontSize: 11, letterSpacing: 1, fontWeight: '700' },

  // Goal picker
  goalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  goalSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1.5,
    borderBottomWidth: 0,
    padding: 20,
    paddingBottom: 36,
  },
  goalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignSelf: 'center',
    marginBottom: 16,
  },
  goalTitle: {
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  goalSub: {
    fontSize: 11,
    letterSpacing: 0.5,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 20,
  },
  goalGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  goalCard: {
    width: '47.5%',
    borderWidth: 1.5,
    borderRadius: 16,
    padding: 14,
  },
  goalIcon: { fontSize: 24, marginBottom: 6 },
  goalLabel: { fontSize: 14, fontWeight: '900', letterSpacing: -0.2 },
  goalDesc: { fontSize: 10, marginTop: 4, letterSpacing: 0.3, lineHeight: 14 },
  weekNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    paddingVertical: 8,
  },
  weekArrowBtn: { padding: 4 },
  weekArrow: { fontSize: 20, fontWeight: '700' },
  weekLabel: { fontSize: 13, letterSpacing: 1 },

  // Day strip
  dayStrip: { flexDirection: 'row', paddingHorizontal: 20, gap: 6, paddingVertical: 10, justifyContent: 'space-between' },
  dayChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
    gap: 2,
  },
  dayChipName: { fontSize: 10, fontWeight: '600', letterSpacing: 0.5 },
  dayChipDate: { fontSize: 18, fontWeight: '900' },
  dayDot: { width: 5, height: 5, borderRadius: 3, marginTop: 2 },

  // Day label
  dayLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  dayLabel: { fontSize: 16, fontWeight: '900' },
  dayStats: { fontSize: 11, letterSpacing: 0.5 },

  // Meal cards
  mealList: { paddingHorizontal: 20, paddingBottom: 100, gap: 10 },
  mealCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1.5,
    overflow: 'hidden',
  },
  mealCardPressable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 12,
  },
  mealCardAccent: { width: 4, height: '100%', borderRadius: 2, position: 'absolute', left: 0, top: 0, bottom: 0 },
  mealCardLeft: { width: 40, alignItems: 'center' },
  mealCardIcon: { fontSize: 28 },
  mealCardBody: { flex: 1 },
  mealCardLabel: { fontSize: 10, letterSpacing: 1.5, marginBottom: 2 },
  mealCardTitle: { fontSize: 16, fontWeight: '900', lineHeight: 20 },
  mealCardMeta: { fontSize: 12, marginTop: 4 },
  mealCardClear: { padding: 14 },

  // Empty meal card
  mealCardEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    padding: 16,
  },
  mealCardEmptyIcon: { fontSize: 28 },
  mealCardEmptyLabel: { fontSize: 15, fontWeight: '900' },
  mealCardEmptyHint: { fontSize: 12, marginTop: 2 },
  mealCardAdd: { marginLeft: 'auto', fontSize: 24, fontWeight: '700' },

  // Recipe picker
  list: { padding: 20, paddingBottom: 100 },
  pickCard: {
    flexDirection: 'row',
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1.5,
    marginBottom: 10,
  },
  pickImg: { width: 80, height: 80 },
  pickImgPlaceholder: { width: 80, height: 80, alignItems: 'center', justifyContent: 'center' },
  pickInfo: { flex: 1, padding: 12, justifyContent: 'center' },
  pickTitle: { fontSize: 15, fontWeight: '700' },
  pickMeta: { fontSize: 11, marginTop: 4 },
  emptyPick: { alignItems: 'center', paddingTop: 60 },
  emptyState: { alignItems: 'center', paddingTop: 40, paddingBottom: 20 },
  emptyEmoji: { fontSize: 56, marginBottom: 16 },
  emptyTitle: { fontSize: 18, fontWeight: '900', letterSpacing: 0.5 },
  emptyHint: { fontSize: 11, marginTop: 8 },
});
