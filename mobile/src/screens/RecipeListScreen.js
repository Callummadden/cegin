import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  Dimensions,
  Easing,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { api, getServerUrl } from '../api';
import { getAppMode } from '../config';
import { MONO, useTheme } from '../theme';
import { isOnline as checkOnline, setOnline, getPendingChanges, syncPendingChanges, getCachedRecipesSync } from '../offlineCache';
import { subscribe } from '../wsSync';
import { getFavorites, toggleFavorite } from '../favorites';
import { getStats } from '../stats';
import BottomNav from '../components/BottomNav';
import AppModal from '../components/AppModal';
import { RecipeCardSkeleton } from '../components/Skeleton';
import { heroCardColors, hashStr } from '../utils/heroColors';
import { useToast } from '../components/Toast';
import TutorialOverlay, { shouldShowTutorial } from '../components/TutorialOverlay';
import VersionBanner from '../components/VersionBanner';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useResponsive } from '../utils/responsive';

const BASE_TABS = ['ALL', 'FAVES', 'QUICK'];
const SEARCH_HISTORY_KEY = 'cegin_search_history';
const MAX_SEARCH_HISTORY = 10;
const VIEW_MODE_KEY = 'cegin_view_mode';
const VIEW_MODES = [
  { key: 'cards', icon: 'square-outline', label: 'Cards' },
  { key: 'list', icon: 'list-outline', label: 'List' },
  { key: 'grid', icon: 'grid-outline', label: 'Grid' },
  { key: 'compact', icon: 'reorder-three-outline', label: 'Compact' },
];



function matchesTab(r, tab, favs, collections) {
  switch (tab) {
    case 'FAVES': return !!favs[r.id];
    case 'QUICK': return (r.prep_minutes + r.cook_minutes) <= 30;
    default:
      // Collection tab: "C:Name" → check if recipe is in that collection
      if (tab.startsWith('C:')) {
        const colName = tab.slice(2);
        const col = collections.find((c) => c.name === colName);
        return col ? col.recipe_ids.includes(r.id) : false;
      }
      // Tag tab: "T:tagname" → check if recipe has that tag
      if (tab.startsWith('T:')) {
        const tag = tab.slice(2).toLowerCase();
        return (r.tags || []).some((t) => t.toLowerCase() === tag);
      }
      return true;
  }
}

export default function RecipeListScreen({ navigation }) {
  const { colors } = useTheme();
  const { s, fs } = useResponsive();
  const styles = useMemo(() => makeStyles(colors, s, fs), [colors, s, fs]);
  const cardBgs = useMemo(() => heroCardColors(colors), [colors]);
  const insets = useSafeAreaInsets();

  const [recipes, setRecipes] = useState(() => getCachedRecipesSync());
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [configured, setConfigured] = useState(true);
  const [tab, setTab] = useState('ALL');
  const [favs, setFavs] = useState({});
  const [menuRecipe, setMenuRecipe] = useState(null);
  const [sortBy, setSortBy] = useState('newest');
  const [viewMode, setViewMode] = useState('grid');
  const [collections, setCollections] = useState([]);
  const [recipeCollections, setRecipeCollections] = useState([]);
  const [selectedCollection, setSelectedCollection] = useState(null);
  const [newCollectionModal, setNewCollectionModal] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [modal, setModal] = useState(null);
  const [cookCounts, setCookCounts] = useState({});
  const [searchHistory, setSearchHistory] = useState([]);
  const [searchFocused, setSearchFocused] = useState(false);
  const clearingHistory = useRef(false);
  const { showToast } = useToast();

  // Tutorial
  const [showTutorial, setShowTutorial] = useState(false);
  const tutorialRefs = {
    fab: useRef(null),
    search: useRef(null),
    tabs: useRef(null),
    view: useRef(null),
    nav: useRef(null),
  };

  // Track online/offline state
  const [offline, setOffline] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const appStateRef = useRef(AppState.currentState);

  // Auto-sync when app comes back to foreground
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (next) => {
      if (appStateRef.current.match(/inactive|background/) && next === 'active') {
        const mode = await getAppMode();
        if (mode === 'local') {
          setOffline(false);
          setPendingCount(0);
        } else {
          const online = await checkOnline();
          setOffline(!online);
          if (online) {
            const pending = await getPendingChanges();
            if (pending.length > 0) {
              await syncPendingChanges();
              const after = await getPendingChanges();
              setPendingCount(after.length);
              if (after.length < pending.length) {
                load(search);
                showToast('Synced offline changes');
              }
            }
          }
        }
      }
      appStateRef.current = next;
    });
    return () => sub.remove();
  }, [load, search, showToast]);

  // Free image memory when this screen unmounts (biggest memory consumer)
  useEffect(() => {
    return () => { Image.clearMemoryCache().catch(() => {}); };
  }, []);

  // Load search history from AsyncStorage
  useEffect(() => {
    AsyncStorage.getItem(SEARCH_HISTORY_KEY).then((raw) => {
      if (raw) setSearchHistory(JSON.parse(raw));
    }).catch(() => {});
  }, []);

  // Load view mode from AsyncStorage
  useEffect(() => {
    AsyncStorage.getItem(VIEW_MODE_KEY).then((raw) => {
      if (raw && VIEW_MODES.some((m) => m.key === raw)) setViewMode(raw);
    }).catch(() => {});
  }, []);

  // Load cook counts from stats
  useEffect(() => {
    getStats().then((s) => setCookCounts(s.recipeCookCounts || {})).catch(() => {});
  }, []);

  // Show tutorial on first visit
  useEffect(() => {
    shouldShowTutorial().then((show) => {
      if (show) setTimeout(() => setShowTutorial(true), 600);
    });
  }, []);

  const saveSearchHistory = useCallback(async (term) => {
    if (!term.trim()) return;
    setSearchHistory((prev) => {
      const next = [term.trim(), ...prev.filter((s) => s !== term.trim())].slice(0, MAX_SEARCH_HISTORY);
      AsyncStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  // Collect unique tags from all recipes, sorted by frequency then alphabetically
  const TAG_TABS = useMemo(() => {
    const counts = {};
    for (const r of recipes) {
      for (const t of (r.tags || [])) {
        const lower = t.toLowerCase();
        counts[lower] = (counts[lower] || 0) + 1;
      }
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 20) // cap at 20 tag tabs
      .map(([t]) => `T:${t}`);
  }, [recipes]);

  const TABS = [...BASE_TABS, ...TAG_TABS, ...collections.map((c) => `C:${c.name}`)];

  // Refs to avoid stale closures in PanResponder / callbacks
  const tabRef = useRef(tab);
  useEffect(() => { tabRef.current = tab; }, [tab]);
  const tabsRef = useRef(TABS);
  useEffect(() => { tabsRef.current = TABS; }, [TABS]);
  const tabScrollRef = useRef(null);
  const animatingRef = useRef(false);

  // Animated values for the slide + fade transition
  const slideX = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(1)).current;

  // Slide out → swap tab → slide in from opposite side
  const changeTab = useCallback((newTab, dir = null) => {
    if (animatingRef.current) return;
    const tabs = tabsRef.current;
    const currentIdx = tabs.indexOf(tabRef.current);
    const nextIdx = tabs.indexOf(newTab);
    if (nextIdx === currentIdx) return;

    const slideDir = dir ?? (nextIdx > currentIdx ? -1 : 1);
    const offset = Dimensions.get('window').width * 0.15;

    animatingRef.current = true;

    // Scroll the pill bar to keep the active tab visible
    requestAnimationFrame(() => {
      tabScrollRef.current?.scrollTo({ x: Math.max(0, nextIdx * 80 - 100), animated: true });
    });

    Animated.parallel([
      Animated.timing(slideX, {
        toValue: slideDir * offset,
        duration: 60,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 0.5,
        duration: 50,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setTab(newTab);
      tabRef.current = newTab;
      slideX.setValue(-slideDir * offset);
      Animated.parallel([
        Animated.spring(slideX, {
          toValue: 0,
          speed: 50,
          bounciness: 0,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 60,
          useNativeDriver: true,
        }),
      ]).start(() => {
        animatingRef.current = false;
      });
    });
  }, []);

  // PanResponder: only claim horizontal swipes
  const swipePan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gs) =>
      Math.abs(gs.dx) > 8 && Math.abs(gs.dx) > Math.abs(gs.dy) && gs.moveX > 40,
    onPanResponderRelease: (_, gs) => {
      if (Math.abs(gs.dx) < 20 || Math.abs(gs.dx) < Math.abs(gs.dy)) return;
      const tabs = tabsRef.current;
      const idx = tabs.indexOf(tabRef.current);
      const next = gs.dx < 0
        ? Math.min(idx + 1, tabs.length - 1)
        : Math.max(idx - 1, 0);
      if (next !== idx) changeTab(tabs[next], gs.dx < 0 ? -1 : 1);
    },
  }), [changeTab]);

  const load = useCallback(async (query, forceRefresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const url = await getServerUrl();
      const mode = await getAppMode();
      const isLocal = mode === 'local';
      setConfigured(isLocal || !!url);
      if (!isLocal && !url) { setLoading(false); return; }

      // Show cached data instantly, update each as it arrives
      const [data, favorites] = await Promise.all([
        api.listRecipes(query, { forceRefresh }),
        getFavorites(),
      ]);
      setRecipes(data);
      setFavs(favorites);
      setLoading(false);

      // Non-blocking: fetch collections in background
      api.listCollections().then(setCollections).catch(() => {});
      api.listRecipeCollections().then(setRecipeCollections).catch(() => {});

      // Track connectivity (only relevant in server mode)
      if (!isLocal) {
        // Check real connectivity after load — api.listRecipes may have returned cache
        const online = await checkOnline();
        setOffline(!online);
        if (online) {
          setOnline(true);
          const pending = await getPendingChanges();
          setPendingCount(pending.length);
          if (pending.length > 0) {
            await syncPendingChanges();
            const after = await getPendingChanges();
            setPendingCount(after.length);
            if (after.length < pending.length) await load(query);
          }
        } else {
          const pending = await getPendingChanges();
          setPendingCount(pending.length);
        }
      } else {
        setOffline(false);
        setPendingCount(0);
      }
    } catch (e) {
      setError(e.message);
      setOffline(true);
      setLoading(false);
    }
  }, []);

  const firstEffectRef = useRef(true);
  useFocusEffect(useCallback(() => { load(search); }, [load])); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const unsub1 = subscribe('recipes', () => load('', true));
    const unsub2 = subscribe('collections', () => load('', true));
    return () => { unsub1(); unsub2(); };
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (firstEffectRef.current) { firstEffectRef.current = false; return; }
    // Client-side filtering handles search — no server fetch needed per keystroke
  }, [search]);

  const q = search.toLowerCase();
  const SORTERS = {
    newest: (a, b) => 0, // server already returns newest first
    quickest: (a, b) => (a.prep_minutes + a.cook_minutes) - (b.prep_minutes + b.cook_minutes),
    az: (a, b) => a.title.localeCompare(b.title),
    recently_cooked: (a, b) => {
      const ca = cookCounts[a.id]?.count || 0;
      const cb = cookCounts[b.id]?.count || 0;
      // Cooked items first (desc by count), then uncooked keep original order
      if (ca === 0 && cb === 0) return 0;
      if (ca === 0) return 1;
      if (cb === 0) return -1;
      return cb - ca;
    },
    most_cooked: (a, b) => (cookCounts[b.id]?.count || 0) - (cookCounts[a.id]?.count || 0),
  };
  const filtered = useMemo(
    () =>
      recipes
        .filter((r) =>
          matchesTab(r, tab, favs, collections) &&
          (!selectedCollection || r.collection === selectedCollection) &&
          (!q || r.title.toLowerCase().includes(q) || (r.tags || []).join(' ').toLowerCase().includes(q) || (r.ingredients || []).join(' ').toLowerCase().includes(q))
        )
        .sort(SORTERS[sortBy] || SORTERS.newest),
    [recipes, search, tab, favs, collections, selectedCollection, sortBy, cookCounts],
  );

  const cycleViewMode = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setViewMode((prev) => {
      const idx = VIEW_MODES.findIndex((m) => m.key === prev);
      const next = VIEW_MODES[(idx + 1) % VIEW_MODES.length].key;
      AsyncStorage.setItem(VIEW_MODE_KEY, next).catch(() => {});
      return next;
    });
  }, []);

  const onToggleFav = async (id) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const next = await toggleFavorite(id);
    setFavs(next);
  };

  const handleMenuEdit = () => {
    if (!menuRecipe) return;
    setMenuRecipe(null);
    navigation.navigate('EditRecipe', { recipe: menuRecipe });
  };

  const handleMenuDelete = () => {
    if (!menuRecipe) return;
    const recipe = menuRecipe;
    setMenuRecipe(null);
    setModal({
      title: 'Delete recipe',
      message: `Delete "${recipe.title}"?`,
      buttons: [
        { text: 'CANCEL' },
        {
          text: 'DELETE',
          destructive: true,
          filled: true,
          onPress: async () => {
            try {
              await api.deleteRecipe(recipe.id);
              load(search);
            } catch (e) {
              showToast(`Delete failed: ${e.message}`);
            }
          },
        },
      ],
    });
  };

  const renderCard = ({ item }) => {
    const bg = cardBgs[hashStr(item.title) % cardBgs.length];
    const isFav = !!favs[item.id];
    const total = (item.prep_minutes || 0) + (item.cook_minutes || 0);
    const meta = `${total} MIN — SERVES ${item.servings}${(item.tags || [])[0] ? ' — ' + (item.tags || [])[0].toUpperCase() : ''}`;
    const itemCollections = collections.filter((c) => c.recipe_ids?.includes(item.id));

    return (
      <Pressable
        onPress={() => navigation.navigate('RecipeDetail', { id: item.id })}
        onLongPress={() => setMenuRecipe(item)}
        delayLongPress={400}
      >
        {({ pressed }) => (
          <View style={[styles.card, pressed && styles.cardPressed]}>
            {item.image_url ? (
              <View style={[styles.cardBg, { overflow: 'hidden' }]}>
                <Image source={{ uri: item.image_url }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={`recipe-${item.id}`} transition={300} />
                <View style={styles.cardDark} />
                {/* Collection badges */}
                {itemCollections.length > 0 && (
                  <View style={styles.collectionBadges}>
                    {itemCollections.slice(0, 2).map((c) => (
                      <View key={c.name} style={[styles.collectionBadge, { backgroundColor: 'rgba(255,90,38,0.85)' }]}>
                        <Text style={styles.collectionBadgeText}>{c.name.toUpperCase()}</Text>
                      </View>
                    ))}
                  </View>
                )}
                {/* Favorite */}
                <Pressable
                  style={styles.heartBtn}
                  onPress={() => onToggleFav(item.id)}
                  hitSlop={10}
                >
                  <Text style={[styles.heart, isFav && { color: colors.primary }]}>
                    {isFav ? '♥' : '♡'}
                  </Text>
                </Pressable>
                {/* Bottom gradient footer */}
                <View style={styles.cardFooter}>
                  <Text style={styles.cardTitle} numberOfLines={2}>{item.title.toUpperCase()}</Text>
                  <Text style={styles.cardMeta}>{meta}</Text>
                </View>
              </View>
            ) : (
              <View style={[styles.cardBg, { backgroundColor: bg }]}>
                <View style={styles.cardDark} />
                {/* Collection badges */}
                {itemCollections.length > 0 && (
                  <View style={styles.collectionBadges}>
                    {itemCollections.slice(0, 2).map((c) => (
                      <View key={c.name} style={[styles.collectionBadge, { backgroundColor: 'rgba(255,90,38,0.85)' }]}>
                        <Text style={styles.collectionBadgeText}>{c.name.toUpperCase()}</Text>
                      </View>
                    ))}
                  </View>
                )}
                {/* Favorite */}
                <Pressable
                  style={styles.heartBtn}
                  onPress={() => onToggleFav(item.id)}
                  hitSlop={10}
                >
                  <Text style={[styles.heart, isFav && { color: colors.primary }]}>
                    {isFav ? '♥' : '♡'}
                  </Text>
                </Pressable>
                {/* Bottom gradient footer */}
                <View style={styles.cardFooter}>
                  <Text style={styles.cardTitle} numberOfLines={2}>{item.title.toUpperCase()}</Text>
                  <Text style={styles.cardMeta}>{meta}</Text>
                </View>
              </View>
            )}
          </View>
        )}
      </Pressable>
    );
  };

  // --- List view: horizontal row with thumbnail, dark overlay, accent strip ---
  const renderListItem = ({ item }) => {
    const bg = cardBgs[hashStr(item.title) % cardBgs.length];
    const isFav = !!favs[item.id];
    const total = (item.prep_minutes || 0) + (item.cook_minutes || 0);

    return (
      <Pressable
        onPress={() => navigation.navigate('RecipeDetail', { id: item.id })}
        onLongPress={() => setMenuRecipe(item)}
        delayLongPress={400}
      >
        {({ pressed }) => (
          <View style={[styles.listItem, pressed && styles.cardPressed]}>
            <View style={[styles.listAccent, { backgroundColor: colors.primary }]} />
            <View style={[styles.listThumb, { backgroundColor: bg }]}>
              {item.image_url ? (
                <Image source={{ uri: item.image_url }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={`list-${item.id}`} transition={300} />
              ) : null}
              <View style={styles.cardDark} />
            </View>
            <View style={styles.listInfo}>
              <Text style={[styles.listTitle, { color: colors.text }]} numberOfLines={1}>{item.title.toUpperCase()}</Text>
              <Text style={[styles.listMeta, { fontFamily: MONO, color: colors.textMuted }]}>
                {total} MIN — SERVES {item.servings}
              </Text>
              {(item.tags || []).length > 0 && (
                <View style={styles.listTagRow}>
                  {(item.tags || []).slice(0, 2).map((t) => (
                    <View key={t} style={[styles.listTag, { borderColor: colors.border }]}>
                      <Text style={[styles.listTagText, { fontFamily: MONO, color: colors.textMuted }]}>{t.toUpperCase()}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
            <Pressable onPress={() => onToggleFav(item.id)} hitSlop={8} style={styles.listFavBtn}>
              <Text style={[styles.heart, { fontSize: 14 }, isFav && { color: colors.primary }]}>
                {isFav ? '♥' : '♡'}
              </Text>
            </Pressable>
          </View>
        )}
      </Pressable>
    );
  };

  // --- Grid view: 2-column mini cards with gradient footer overlay ---
  const renderGridItem = ({ item }) => {
    const bg = cardBgs[hashStr(item.title) % cardBgs.length];
    const isFav = !!favs[item.id];
    const total = (item.prep_minutes || 0) + (item.cook_minutes || 0);

    return (
      <Pressable
        style={styles.gridCard}
        onPress={() => navigation.navigate('RecipeDetail', { id: item.id })}
        onLongPress={() => setMenuRecipe(item)}
        delayLongPress={400}
      >
        {({ pressed }) => (
          <View style={[styles.gridInner, pressed && styles.cardPressed]}>
            <View style={[styles.gridThumb, { backgroundColor: bg }]}>
              {item.image_url ? (
                <Image source={{ uri: item.image_url }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={`grid-${item.id}`} transition={300} />
              ) : null}
              <View style={styles.cardDark} />
              <Pressable onPress={() => onToggleFav(item.id)} hitSlop={8} style={styles.gridFavBtn}>
                <Text style={[styles.heart, { fontSize: 13 }, isFav && { color: colors.primary }]}>
                  {isFav ? '♥' : '♡'}
                </Text>
              </Pressable>
              <View style={styles.gridFooter}>
                <Text style={styles.gridTitle} numberOfLines={2}>{item.title.toUpperCase()}</Text>
                <Text style={[styles.gridMeta, { fontFamily: MONO }]}>{total} MIN — {item.servings} SERV</Text>
              </View>
            </View>
          </View>
        )}
      </Pressable>
    );
  };

  // --- Compact view: dense text rows with numbered index + primary accent ---
  const renderCompactItem = ({ item, index }) => {
    const isFav = !!favs[item.id];
    const total = (item.prep_minutes || 0) + (item.cook_minutes || 0);

    return (
      <Pressable
        onPress={() => navigation.navigate('RecipeDetail', { id: item.id })}
        onLongPress={() => setMenuRecipe(item)}
        delayLongPress={400}
      >
        {({ pressed }) => (
          <View style={[styles.compactRow, { borderBottomColor: colors.border }, pressed && { opacity: 0.6 }]}>
            <Text style={[styles.compactIndex, { fontFamily: MONO, color: colors.textMuted }]}>{String(index + 1).padStart(2, '0')}</Text>
            <View style={styles.compactBody}>
              <Text style={[styles.compactTitle, { color: colors.text }]} numberOfLines={1}>{item.title.toUpperCase()}</Text>
              <Text style={[styles.compactSub, { fontFamily: MONO, color: colors.textMuted }]}>
                {total} MIN{(item.tags || [])[0] ? ` · ${(item.tags || [])[0].toUpperCase()}` : ''}
              </Text>
            </View>
            <Text style={[styles.compactTime, { fontFamily: MONO, color: colors.primary }]}>{total}m</Text>
            <Pressable onPress={() => onToggleFav(item.id)} hitSlop={6}>
              <Text style={[styles.heart, { fontSize: 12 }, isFav && { color: colors.primary }]}>
                {isFav ? '♥' : '♡'}
              </Text>
            </Pressable>
          </View>
        )}
      </Pressable>
    );
  };

  // Pick the right renderItem + FlatList props based on viewMode
  const activeRenderItem = viewMode === 'list' ? renderListItem
    : viewMode === 'grid' ? renderGridItem
    : viewMode === 'compact' ? renderCompactItem
    : renderCard;

  const flatListExtraProps = viewMode === 'grid'
    ? { numColumns: 2, columnWrapperStyle: styles.gridRow }
    : {};

  return (
    <View style={styles.root}>
      {/* Offline indicator banner */}
      {offline && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineBannerText}>
            OFFLINE — showing cached data{pendingCount > 0 ? ` · ${pendingCount} pending change${pendingCount === 1 ? '' : 's'}` : ''}
          </Text>
        </View>
      )}

      {/* Version update banner */}
      <VersionBanner />

      {/* Floating top section — nav bar + tabs */}
      <View style={[styles.floatingTop, { paddingTop: 18 + insets.top }]}>

      {/* Top nav bar — matches bottom nav style */}
      <View style={[styles.topNav, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={styles.wordmark}>
            CEGIN<Text style={{ color: colors.primary }}>.</Text>
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Pressable
              style={styles.settingsBtn}
              onPress={() => navigation.navigate('Settings')}
              hitSlop={8}
            >
              <Ionicons name="settings-outline" size={18} color={colors.textMuted} />
            </Pressable>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 0 }}>
          <View style={[styles.searchRow, { borderColor: colors.border, marginHorizontal: 0, marginTop: 0, flex: 1 }]}>
            <TextInput
              style={[styles.searchInput, { fontFamily: MONO, color: colors.text }]}
              value={search}
              onChangeText={setSearch}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setTimeout(() => { if (!clearingHistory.current) setSearchFocused(false); }, 200)}
              onSubmitEditing={() => { if (search.trim()) saveSearchHistory(search); }}
              placeholder="/ search recipes"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          <Pressable
            style={[styles.sortBtn, { marginTop: 2 }]}
            onPress={() => {
              const opts = ['newest', 'quickest', 'az', 'recently_cooked', 'most_cooked'];
              setSortBy(opts[(opts.indexOf(sortBy) + 1) % opts.length]);
            }}
          >
            <Text style={[styles.sortLabel, { fontFamily: MONO, color: colors.textMuted }]}>
              {sortBy === 'newest' ? 'NEW' : sortBy === 'quickest' ? 'FAST' : sortBy === 'az' ? 'A-Z' : sortBy === 'recently_cooked' ? 'RECENT' : 'TOP'}
            </Text>
          </Pressable>
          <Pressable
            ref={tutorialRefs.view}
            style={[styles.viewBtn, { marginTop: 2 }]}
            onPress={cycleViewMode}
          >
            <Ionicons name={VIEW_MODES.find((m) => m.key === viewMode)?.icon || 'square-outline'} size={16} color={colors.textMuted} />
          </Pressable>
        </View>
      </View>

      {/* Search history chips */}
      {searchFocused && !search && searchHistory.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.searchHistoryRow}
          contentContainerStyle={styles.searchHistoryContent}
        >
          {searchHistory.map((term) => (
            <Pressable
              key={term}
              onPress={() => { setSearch(term); saveSearchHistory(term); }}
              style={[styles.searchHistoryChip, { backgroundColor: colors.surface2, borderColor: colors.border }]}
            >
              <Text style={[styles.searchHistoryLabel, { fontFamily: MONO, color: colors.textMuted }]}>{term}</Text>
            </Pressable>
          ))}
          <Pressable
            delayPressIn={0}
            onTouchStart={() => {
              clearingHistory.current = true;
              setSearchHistory([]);
              AsyncStorage.removeItem(SEARCH_HISTORY_KEY).catch(() => {});
              setTimeout(() => {
                clearingHistory.current = false;
                setSearchFocused(false);
              }, 300);
            }}
            style={[styles.searchHistoryChip, { borderColor: colors.border, backgroundColor: colors.surface }]}
          >
            <Text style={[styles.searchHistoryLabel, { fontFamily: MONO, color: colors.danger }]}>CLEAR</Text>
          </Pressable>
        </ScrollView>
      )}

      {/* Tabs */}
      <ScrollView
        ref={(el) => { tabScrollRef.current = el; if (tutorialRefs.tabs) tutorialRefs.tabs.current = el; }}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabsRow}
        contentContainerStyle={styles.tabsContent}
      >
        {TABS.map((t) => {
          const label = t.startsWith('T:') ? t.slice(2).toUpperCase()
            : t.startsWith('C:') ? t.slice(2)
            : t;
          return (
            <Pressable key={t} onPress={() => {
              changeTab(t);
              const idx = TABS.indexOf(t);
              requestAnimationFrame(() => {
                tabScrollRef.current?.scrollTo({ x: Math.max(0, idx * 80 - 100), animated: true });
              });
            }} style={[styles.tabItem, { borderColor: t === tab ? colors.primary : colors.border, backgroundColor: t === tab ? colors.primary : colors.surface }]}>
              <Text style={[
                styles.tabLabel,
                { fontFamily: MONO, color: t === tab ? colors.onPrimary : colors.textMuted },
              ]}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      </View>

      {/* List — outer View catches the swipe gesture, inner Animated.View carries the transition */}
      <View style={{ flex: 1 }} {...swipePan.panHandlers}>
      <Animated.View style={{ flex: 1, transform: [{ translateX: slideX }], opacity: fadeAnim }}>
      {!configured ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyTitle, { color: colors.textMuted }]}>NO SERVER</Text>
          <Text style={[styles.emptyHint, { color: colors.textMuted }]}>Configure your server URL in Settings.</Text>
          <Pressable
            style={[styles.emptyBtn, { borderColor: colors.primary }]}
            onPress={() => navigation.navigate('Settings')}
          >
            <Text style={[styles.emptyBtnText, { fontFamily: MONO, color: colors.primary }]}>OPEN SETTINGS</Text>
          </Pressable>
        </View>
      ) : error ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyHint, { color: colors.danger }]}>{error}</Text>
          <Pressable
            style={[styles.emptyBtn, { borderColor: colors.primary }]}
            onPress={() => load(search)}
          >
            <Text style={[styles.emptyBtnText, { fontFamily: MONO, color: colors.primary }]}>RETRY</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          key={viewMode}
          data={filtered}
          keyExtractor={(item) => String(item.id)}
          renderItem={activeRenderItem}
          initialNumToRender={viewMode === 'grid' ? 10 : 8}
          maxToRenderPerBatch={viewMode === 'grid' ? 10 : 8}
          windowSize={5}
          removeClippedSubviews={true}
          contentContainerStyle={[viewMode === 'grid' ? styles.gridList : viewMode === 'compact' ? styles.compactList : styles.list, searchFocused && searchHistory.length > 0 && { paddingTop: s(260) }]}
          {...flatListExtraProps}
          refreshControl={
            <RefreshControl
              refreshing={loading && filtered.length > 0}
              onRefresh={() => load(search, true)}
              tintColor={colors.primary}
            />
          }
          ListHeaderComponent={
            loading && filtered.length === 0 ? (
              <View>
                {[0,1,2,3,4].map((i) => <RecipeCardSkeleton key={i} />)}
              </View>
            ) : null
          }
          ListEmptyComponent={
            !loading ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyEmoji}>🍽️</Text>
                <Text style={[styles.emptyTitle, { color: colors.textMuted }]}>No recipes yet</Text>
                <Text style={[styles.emptyHint, { fontFamily: MONO, color: colors.textMuted }]}>
                  {search ? 'Try another search or tab'
                    : 'Tap the food button to add your first recipe'}
                </Text>
              </View>
            ) : null
          }
        />
      )}

      </Animated.View>
      </View>

      {/* FAB */}
      <Pressable
        style={[styles.fab, { backgroundColor: colors.primary }]}
        onPress={() => {
          setModal({
            title: 'Add Recipe',
            message: 'How would you like to add a recipe?',
            buttons: [
              { text: 'URL', onPress: () => { setModal(null); navigation.navigate('EditRecipe', { mode: 'url' }); } },
              { text: 'MANUAL', onPress: () => { setModal(null); navigation.navigate('EditRecipe', { mode: 'manual' }); } },
              { text: 'SCAN RECIPE', onPress: () => { setModal(null); navigation.navigate('ScanRecipe'); } },
              { text: 'CANCEL', primary: true, onPress: () => setModal(null) },
            ],
          });
        }}
      >
        <Ionicons name="fast-food-outline" size={24} color={colors.onPrimary} />
      </Pressable>

      <AppModal visible={!!modal} title={modal?.title} message={modal?.message} buttons={modal?.buttons ?? []} colors={colors} onClose={() => setModal(null)} />

      {/* Bottom nav */}
      <View ref={tutorialRefs.nav}>
        <BottomNav active="recipes" navigation={navigation} />
      </View>

      {/* New collection modal */}
      <Modal
        visible={newCollectionModal}
        transparent
        animationType="fade"
        onRequestClose={() => setNewCollectionModal(false)}
      >
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <View style={styles.newColOverlay}>
          <View style={[styles.newColCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.newColTitle, { color: colors.text }]}>NEW COLLECTION</Text>
            <TextInput
              style={[styles.newColInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface2 }]}
              value={newCollectionName}
              onChangeText={setNewCollectionName}
              placeholder="Collection name..."
              placeholderTextColor={colors.textMuted}
              autoFocus
            />
            <View style={styles.newColBtns}>
              <Pressable
                style={[styles.newColBtn, { borderColor: colors.border }]}
                onPress={() => { setNewCollectionModal(false); setNewCollectionName(''); }}
              >
                <Text style={[styles.newColBtnText, { color: colors.textMuted }]}>CANCEL</Text>
              </Pressable>
              <Pressable
                style={[styles.newColBtn, { backgroundColor: colors.primary, borderColor: colors.primary }]}
                onPress={async () => {
                  const name = newCollectionName.trim();
                  if (!name) return;
                  try {
                    await api.createCollection(name);
                    const [cols, recipeCols] = await Promise.all([
                      api.listCollections().catch(() => []),
                      api.listRecipeCollections().catch(() => []),
                    ]);
                    setCollections(cols);
                    setRecipeCollections(recipeCols);
                  } catch (e) {
                    showToast(`Failed: ${e.message}`);
                  }
                  setNewCollectionModal(false);
                  setNewCollectionName('');
                }}
              >
                <Text style={[styles.newColBtnText, { color: colors.onPrimary }]}>CREATE</Text>
              </Pressable>
            </View>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Long-press context menu */}
      <Modal
        visible={!!menuRecipe}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuRecipe(null)}
      >
        <Pressable style={styles.menuOverlay} onPress={() => setMenuRecipe(null)}>
          <Pressable style={[styles.menuSheet, { backgroundColor: colors.surface, borderColor: colors.border }]} onPress={() => {}}>
            <View style={styles.menuHandle} />
            <Text style={[styles.menuTitle, { color: colors.textMuted }]} numberOfLines={1}>
              {menuRecipe?.title?.toUpperCase()}
            </Text>
            <View style={[styles.menuActions, { borderColor: colors.border }]}>
              <Pressable style={[styles.menuItem]} onPress={handleMenuEdit}>
                <Text style={[styles.menuIcon]}>✎</Text>
                <Text style={[styles.menuItemText, { color: colors.text }]}>Edit Recipe</Text>
              </Pressable>
              <View style={[styles.menuDivider, { backgroundColor: colors.border }]} />
              <Pressable style={[styles.menuItem]} onPress={handleMenuDelete}>
                <Text style={[styles.menuIcon, { color: colors.danger }]}>✕</Text>
                <Text style={[styles.menuItemText, { color: colors.danger }]}>Delete</Text>
              </Pressable>
            </View>
            <Pressable style={[styles.menuCancel, { borderColor: colors.border, backgroundColor: colors.surface }]} onPress={() => setMenuRecipe(null)}>
              <Text style={[styles.menuCancelText, { color: colors.text }]}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {showTutorial && (
        <TutorialOverlay
          targetRefs={tutorialRefs}
          onComplete={() => setShowTutorial(false)}
        />
      )}
    </View>
  );
}

const makeStyles = (colors, s, fs) => StyleSheet.create({

  root: { flex: 1, backgroundColor: colors.background },
  floatingTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  topNav: {
    borderWidth: 1.5,
    borderRadius: 28,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginHorizontal: 32,
    marginTop: -20,
    gap: 8,
  },
  offlineBanner: {
    backgroundColor: '#c0392b',
    paddingVertical: s(6),
    paddingHorizontal: s(20),
    alignItems: 'center',
  },
  offlineBannerText: {
    color: '#fff',
    fontSize: fs(11),
    fontWeight: '700',
    letterSpacing: 0.8,
    fontFamily: MONO,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: s(20),
  },
  wordmark: { fontSize: fs(18), fontWeight: '900', letterSpacing: 1, color: colors.text },
  recipeCount: { fontSize: fs(11), letterSpacing: 2 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: s(12) },
  settingsBtn: {
    width: s(34),
    height: s(34),
    borderRadius: s(17),
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hero: { paddingHorizontal: s(20), paddingTop: s(18) },
  heroText: {
    fontSize: fs(40),
    fontWeight: '900',
    lineHeight: fs(40),
    letterSpacing: -1,
    color: colors.text,
  },
  heroOutline: { fontSize: fs(40), fontWeight: '900' },
  searchSortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: s(20),
    gap: s(8),
  },
  searchRow: {
    marginHorizontal: s(20),
    marginTop: s(18),
    borderWidth: 1.5,
    borderRadius: s(28),
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: s(14),
    flex: 1,
  },
  searchInput: {
    flex: 1,
    paddingHorizontal: s(14),
    paddingVertical: s(14),
    fontSize: fs(13),
  },
  searchIcon: { fontSize: fs(16) },
  sortBtn: {
    marginTop: s(18),
    borderWidth: 1.5,
    borderRadius: s(28),
    paddingHorizontal: s(12),
    paddingVertical: s(11),
  },
  sortLabel: { fontSize: fs(10), letterSpacing: 1 },
  tabsRow: { marginTop: s(14), marginBottom: s(10), flexGrow: 0 },
  tabsContent: { paddingHorizontal: s(20), gap: s(8) },
  tabItem: { paddingHorizontal: s(14), paddingVertical: s(7), borderRadius: s(20), borderWidth: 1.5 },
  tabLabel: { fontSize: fs(11), letterSpacing: 0.5, fontWeight: '600' },
  tabActive: {},
  tabUnderline: { display: 'none' },
  chipsRow: { marginTop: s(8), flexGrow: 0 },
  chipsContent: { paddingHorizontal: s(20), gap: s(8) },
  chip: {
    paddingHorizontal: s(12),
    paddingVertical: s(6),
    borderRadius: s(20),
    borderWidth: 1.5,
  },
  chipLabel: { fontSize: fs(10), letterSpacing: 0.8 },
  searchHistoryRow: { marginTop: s(6), flexGrow: 0 },
  searchHistoryContent: { paddingHorizontal: s(20), gap: s(8) },
  searchHistoryChip: {
    paddingHorizontal: s(12),
    paddingVertical: s(6),
    borderRadius: s(20),
    borderWidth: 1,
  },
  searchHistoryLabel: { fontSize: fs(10), letterSpacing: 0.5 },
  list: { paddingHorizontal: s(20), paddingTop: s(220), paddingBottom: s(100) },
  card: {
    height: s(200),
    borderRadius: s(20),
    marginBottom: s(14),
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  cardBg: {
    flex: 1,
  },
  cardDark: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  cardPressed: { opacity: 0.85 },
  heartBtn: {
    position: 'absolute',
    top: s(12),
    right: s(14),
    width: s(34),
    height: s(34),
    borderRadius: s(17),
    backgroundColor: 'rgba(19,16,16,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heart: { fontSize: fs(16), color: 'rgba(255,255,255,0.8)' },
  cardFooter: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: s(16),
    paddingTop: s(44),
    paddingBottom: s(13),
    backgroundColor: 'rgba(10,8,8,0.75)',
  },
  cardTitle: {
    fontSize: fs(21),
    fontWeight: '900',
    letterSpacing: -0.3,
    color: '#fff',
    textTransform: 'uppercase',
    lineHeight: fs(22),
  },
  cardMeta: {
    fontFamily: MONO,
    fontSize: fs(10.5),
    color: 'rgba(255,255,255,0.8)',
    marginTop: s(6),
  },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: s(32) },
  emptyCard: {
    alignItems: 'center',
    marginTop: s(20),
    padding: s(40),
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderRadius: s(18),
  },
  emptyState: {
    alignItems: 'center',
    marginTop: s(40),
    padding: s(40),
  },
  emptyEmoji: { fontSize: fs(56), marginBottom: s(16) },
  emptyTitle: { fontSize: fs(18), fontWeight: '900', letterSpacing: 0.5 },
  emptyHint: { fontFamily: MONO, fontSize: fs(11), marginTop: s(8) },
  emptyBtn: {
    marginTop: s(20),
    borderWidth: 1.5,
    borderRadius: s(10),
    paddingHorizontal: s(20),
    paddingVertical: s(12),
  },
  emptyBtnText: { fontSize: fs(13), letterSpacing: 1 },
  fabScan: {
    position: 'absolute',
    right: s(18),
    bottom: s(168),
    width: s(48),
    height: s(48),
    borderRadius: s(24),
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: s(3) },
  },
  fab: {
    position: 'absolute',
    right: s(18),
    bottom: s(100),
    width: s(56),
    height: s(56),
    borderRadius: s(28),
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.15)',
    elevation: 8,
    shadowColor: colors.primary,
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: s(4) },
  },
  fabText: { fontSize: fs(24) },
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
    paddingHorizontal: s(12),
    paddingBottom: s(24),
  },
  menuSheet: {
    borderRadius: s(24),
    borderWidth: 1.5,
    padding: s(16),
    shadowColor: '#000',
    shadowOffset: { width: 0, height: s(-4) },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  menuHandle: {
    width: s(36),
    height: s(4),
    borderRadius: s(2),
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignSelf: 'center',
    marginBottom: s(12),
  },
  menuTitle: {
    fontSize: fs(10),
    fontWeight: '700',
    letterSpacing: 1.5,
    textAlign: 'center',
    paddingBottom: s(14),
    fontFamily: MONO,
  },
  menuActions: {
    borderWidth: 1.5,
    borderRadius: s(16),
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(14),
    paddingVertical: s(16),
    paddingHorizontal: s(20),
  },
  menuIcon: {
    fontSize: fs(16),
    width: s(22),
    textAlign: 'center',
  },
  menuItemText: {
    fontSize: fs(15),
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  menuDivider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: s(16),
  },
  menuCancel: {
    marginTop: s(10),
    borderWidth: 1.5,
    borderRadius: s(16),
    paddingVertical: s(16),
    alignItems: 'center',
  },
  menuCancelText: {
    fontSize: fs(15),
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  // View mode toggle button
  viewBtn: {
    marginTop: s(18),
    borderWidth: 1.5,
    borderRadius: s(20),
    width: s(38),
    height: s(38),
    alignItems: 'center',
    justifyContent: 'center',
  },

  // List view styles
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: s(10),
    borderRadius: s(18),
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  listAccent: {
    width: s(4),
    alignSelf: 'stretch',
  },
  listThumb: {
    width: s(80),
    height: '100%',
    minHeight: s(72),
    overflow: 'hidden',
  },
  listInfo: {
    flex: 1,
    paddingVertical: s(12),
    paddingHorizontal: s(14),
  },
  listTitle: {
    fontSize: fs(13),
    fontWeight: '900',
    letterSpacing: 0.5,
    lineHeight: fs(16),
  },
  listMeta: {
    fontSize: fs(10),
    marginTop: s(5),
    letterSpacing: 1,
  },
  listTagRow: {
    flexDirection: 'row',
    gap: s(5),
    marginTop: s(6),
  },
  listTag: {
    borderWidth: 1,
    borderRadius: s(6),
    paddingHorizontal: s(6),
    paddingVertical: s(2),
  },
  listTagText: {
    fontSize: fs(8),
    letterSpacing: 0.5,
  },
  listFavBtn: {
    paddingRight: s(14),
    paddingLeft: s(8),
  },

  // Grid view styles
  gridList: { paddingHorizontal: s(16), paddingTop: s(220), paddingBottom: s(100) },
  gridRow: { gap: s(10), marginBottom: 0 },
  gridCard: {
    flex: 1,
    marginBottom: s(12),
  },
  gridInner: {
    borderRadius: s(18),
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  gridThumb: {
    width: '100%',
    aspectRatio: 0.9,
    overflow: 'hidden',
  },
  gridFavBtn: {
    position: 'absolute',
    top: s(8),
    right: s(8),
    width: s(30),
    height: s(30),
    borderRadius: s(15),
    backgroundColor: 'rgba(19,16,16,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridFooter: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: s(12),
    paddingTop: s(36),
    paddingBottom: s(10),
    backgroundColor: 'rgba(10,8,8,0.80)',
  },
  gridTitle: {
    fontSize: fs(11),
    fontWeight: '900',
    letterSpacing: 0.3,
    color: '#fff',
    lineHeight: fs(14),
  },
  gridMeta: {
    fontSize: fs(9),
    marginTop: s(4),
    letterSpacing: 1,
    color: 'rgba(255,255,255,0.7)',
  },

  // Compact view styles
  compactList: { paddingHorizontal: s(20), paddingTop: s(220), paddingBottom: s(100) },
  compactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(14),
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: s(12),
  },
  compactIndex: {
    fontSize: fs(11),
    letterSpacing: 1,
    width: s(24),
  },
  compactBody: {
    flex: 1,
  },
  compactTitle: {
    fontSize: fs(13),
    fontWeight: '900',
    letterSpacing: 0.5,
    lineHeight: fs(16),
  },
  compactSub: {
    fontSize: fs(9),
    marginTop: s(3),
    letterSpacing: 1,
  },
  compactTime: {
    fontSize: fs(11),
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  collectionBadges: {
    position: 'absolute',
    top: s(12),
    right: s(14),
    flexDirection: 'row',
    gap: s(4),
  },
  collectionBadge: {
    borderRadius: s(6),
    paddingHorizontal: s(7),
    paddingVertical: s(3),
  },
  collectionBadgeText: {
    color: '#fff',
    fontSize: fs(8),
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  newColOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: s(30),
  },
  newColCard: {
    width: '100%',
    maxWidth: s(340),
    borderWidth: 1.5,
    borderRadius: s(20),
    padding: s(24),
    alignItems: 'center',
  },
  newColTitle: {
    fontSize: fs(18),
    fontWeight: '900',
    letterSpacing: -0.3,
    textAlign: 'center',
    marginBottom: s(16),
  },
  newColInput: {
    width: '100%',
    borderWidth: 1.5,
    borderRadius: s(12),
    padding: s(14),
    fontSize: fs(14),
    marginBottom: s(16),
  },
  newColBtns: {
    flexDirection: 'row',
    gap: s(12),
    width: '100%',
  },
  newColBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: s(12),
    paddingVertical: s(14),
    alignItems: 'center',
  },
  newColBtnText: {
    fontWeight: '900',
    fontSize: fs(13),
    letterSpacing: 1,
  },

  });