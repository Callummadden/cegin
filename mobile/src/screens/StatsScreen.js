import { useCallback, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api';
import { MONO, useTheme } from '../theme';
import { getStats, getTopRecipes, clearStats } from '../stats';
import { getDietaryProfiles } from '../dietProfiles';
import { getShoppingList } from '../shoppingList';
import AppModal from '../components/AppModal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function StatsScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();

  const [recipes, setRecipes] = useState([]);
  const [stats, setStats] = useState(null);
  const [topRecipes, setTopRecipes] = useState([]);
  const [shopItems, setShopItems] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [modal, setModal] = useState(null);

  const load = useCallback(async () => {
    try {
      const [r, s, t, sh, p] = await Promise.all([
        api.listRecipes().catch(() => []),
        getStats(),
        getTopRecipes(5),
        getShoppingList(),
        getDietaryProfiles(),
      ]);
      setRecipes(r);
      setStats(s);
      setTopRecipes(t);
      setShopItems(sh);
      setProfiles(p);
    } catch (e) { console.warn('Stats load failed:', e.message); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Tag breakdown
  const tagCounts = useMemo(() => {
    const counts = {};
    for (const r of recipes) {
      for (const t of (r.tags || [])) {
        const lower = t.toLowerCase();
        counts[lower] = (counts[lower] || 0) + 1;
      }
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 12);
  }, [recipes]);

  const totalIngredients = recipes.reduce((sum, r) => sum + (r.ingredients?.length || 0), 0);
  const totalSteps = recipes.reduce((sum, r) => sum + (r.steps?.length || 0), 0);
  const avgCookTime = recipes.length
    ? Math.round(recipes.reduce((sum, r) => sum + (r.prep_minutes || 0) + (r.cook_minutes || 0), 0) / recipes.length)
    : 0;
  const uncheckedShop = shopItems.filter((i) => !i.checked).length;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 20 }}>
        {/* Header */}
        <View style={[styles.header, { paddingTop: 20 + insets.top }]}>
          <Pressable
            style={[styles.backBtn, { borderColor: colors.border }]}
            onPress={() => navigation.goBack()}
          >
            <Text style={{ fontSize: 17, color: colors.text }}>←</Text>
          </Pressable>
          <Text style={[styles.screenTitle, { color: colors.text }]}>STATS</Text>
        </View>

        {/* Hero stats */}
        <View style={styles.heroRow}>
          <View style={[styles.heroCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.heroNum, { color: colors.primary }]}>{recipes.length}</Text>
            <Text style={[styles.heroLabel, { fontFamily: MONO, color: colors.textMuted }]}>RECIPES</Text>
          </View>
          <View style={[styles.heroCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.heroNum, { color: colors.primary }]}>{stats?.cookCount || 0}</Text>
            <Text style={[styles.heroLabel, { fontFamily: MONO, color: colors.textMuted }]}>COOKED</Text>
          </View>
          <View style={[styles.heroCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.heroNum, { color: colors.primary }]}>{stats?.totalSteps || 0}</Text>
            <Text style={[styles.heroLabel, { fontFamily: MONO, color: colors.textMuted }]}>STEPS</Text>
          </View>
        </View>

        {/* Quick stats */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { fontFamily: MONO, color: colors.textMuted }]}>OVERVIEW</Text>
          <View style={[styles.statList, { borderColor: colors.border }]}>
            <View style={[styles.statRow, { borderBottomColor: colors.border }]}>
              <Text style={[styles.statKey, { color: colors.text2 }]}>Total ingredients across all recipes</Text>
              <Text style={[styles.statVal, { fontFamily: MONO, color: colors.primary }]}>{totalIngredients}</Text>
            </View>
            <View style={[styles.statRow, { borderBottomColor: colors.border }]}>
              <Text style={[styles.statKey, { color: colors.text2 }]}>Total method steps</Text>
              <Text style={[styles.statVal, { fontFamily: MONO, color: colors.primary }]}>{totalSteps}</Text>
            </View>
            <View style={[styles.statRow, { borderBottomColor: colors.border }]}>
              <Text style={[styles.statKey, { color: colors.text2 }]}>Average cook time</Text>
              <Text style={[styles.statVal, { fontFamily: MONO, color: colors.primary }]}>{avgCookTime} min</Text>
            </View>
            <View style={[styles.statRow, { borderBottomColor: colors.border }]}>
              <Text style={[styles.statKey, { color: colors.text2 }]}>Shopping list items</Text>
              <Text style={[styles.statVal, { fontFamily: MONO, color: colors.primary }]}>{uncheckedShop} pending</Text>
            </View>
            <View style={[styles.statRow, { borderBottomColor: colors.border }]}>
              <Text style={[styles.statKey, { color: colors.text2 }]}>Dietary profiles</Text>
              <Text style={[styles.statVal, { fontFamily: MONO, color: colors.primary }]}>{profiles.length}</Text>
            </View>
            <View style={styles.statRow}>
              <Text style={[styles.statKey, { color: colors.text2 }]}>Unique tags</Text>
              <Text style={[styles.statVal, { fontFamily: MONO, color: colors.primary }]}>{tagCounts.length}</Text>
            </View>
          </View>
        </View>

        {/* Most cooked */}
        {topRecipes.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { fontFamily: MONO, color: colors.textMuted }]}>MOST COOKED</Text>
            <View style={[styles.statList, { borderColor: colors.border }]}>
              {topRecipes.map((r, i) => (
                <View key={r.id} style={[styles.statRow, i < topRecipes.length - 1 && { borderBottomColor: colors.border }]}>
                  <View style={styles.topRow}>
                    <Text style={[styles.topRank, { color: colors.primary }]}>#{i + 1}</Text>
                    <Text style={[styles.topTitle, { color: colors.text2 }]}>{r.title}</Text>
                  </View>
                  <Text style={[styles.statVal, { fontFamily: MONO, color: colors.primary }]}>{r.count}x</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Tag breakdown */}
        {tagCounts.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { fontFamily: MONO, color: colors.textMuted }]}>TOP TAGS</Text>
            <View style={styles.tagGrid}>
              {tagCounts.map(([tag, count]) => (
                <View key={tag} style={[styles.tagChip, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                  <Text style={[styles.tagName, { color: colors.text2 }]}>#{tag}</Text>
                  <Text style={[styles.tagCount, { fontFamily: MONO, color: colors.primary }]}>{count}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Reset */}
        <View style={styles.section}>
          <Pressable
            style={[styles.resetBtn, { borderColor: colors.border }]}
            onPress={() => {
              setModal({
                title: 'Reset Stats',
                message: 'This will reset your cooking stats (recipes cooked, steps completed). Recipe data is not affected.',
                buttons: [
                  { text: 'CANCEL' },
                  {
                    text: 'RESET',
                    destructive: true,
                    filled: true,
                    onPress: async () => {
                      await clearStats();
                      load();
                    },
                  },
                ],
              });
            }}
          >
            <Text style={[styles.resetText, { color: colors.textMuted }]}>Reset Cooking Stats</Text>
          </Pressable>
        </View>
      </ScrollView>

      <AppModal
        visible={!!modal}
        title={modal?.title}
        message={modal?.message}
        buttons={modal?.buttons ?? []}
        colors={colors}
        onClose={() => setModal(null)}
      />
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingBottom: 0 },
  backBtn: { width: 38, height: 38, borderRadius: 10, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  screenTitle: { fontSize: 19, fontWeight: '900', letterSpacing: 0.5 },
  heroRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, marginTop: 20 },
  heroCard: { flex: 1, borderWidth: 1.5, borderRadius: 16, padding: 16, alignItems: 'center' },
  heroNum: { fontSize: 32, fontWeight: '900' },
  heroLabel: { fontSize: 10, letterSpacing: 1.5, marginTop: 4 },
  section: { paddingHorizontal: 20, marginTop: 24 },
  sectionLabel: { fontSize: 10, letterSpacing: 1, marginBottom: 10 },
  statList: { borderWidth: 1.5, borderRadius: 12, overflow: 'hidden' },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1 },
  statKey: { fontSize: 14, flex: 1 },
  statVal: { fontSize: 14, fontWeight: '700' },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  topRank: { fontSize: 14, fontWeight: '900', width: 28 },
  topTitle: { fontSize: 14, flex: 1 },
  tagGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tagChip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  tagName: { fontSize: 13 },
  tagCount: { fontSize: 11, fontWeight: '700' },
  resetBtn: { borderWidth: 1.5, borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  resetText: { fontSize: 14, fontWeight: '500' },
});
