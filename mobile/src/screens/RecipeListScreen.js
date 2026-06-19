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
  const styles = useMemo(() => makeStyles(colors), [colors]);
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
  const [viewMode, setViewMode] = useState('cards');
  const [collections, setCollections] = useState([]);
  const [recipeCollections, setRecipeCollections] = useState([]);
  const [selectedCollection, setSelectedCollection] = useState(null);
  const [newCollectionModal, setNewCollectionModal] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [modal, setModal] = useState(null);
  const [cookCounts, setCookCounts] = useState({});
  const [searchHistory, setSearchHistory] = useState([]);
  const [searchFocused, setSearchFocused] = useState(false);
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

  const load = useCallback(async (query) => {
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
        api.listRecipes(query),
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
  useFocusEffect(useCallback(() => { load(search); }, [load, search]));
  useEffect(() => {
    if (firstEffectRef.current) { firstEffectRef.current = false; return; }
    const t = setTimeout(() => {
      load(search);
      if (search.trim()) saveSearchHistory(search);
    }, 300);
    return () => clearTimeout(t);
  }, [search, load, saveSearchHistory]);

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
                <Image source={{ uri: item.image_url }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={`recipe-${item.id}`} />
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
                <Image source={{ uri: item.image_url }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={`list-${item.id}`} />
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
                <Image source={{ uri: item.image_url }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={`grid-${item.id}`} />
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

      {/* Header */}
      <View style={[styles.header, { paddingTop: 18 + insets.top }]}>
        <Text style={styles.wordmark}>
          CEGIN<Text style={{ color: colors.primary }}>.</Text>
        </Text>
        <View style={styles.headerRight}>
          <Text style={[styles.recipeCount, { fontFamily: MONO, color: colors.textMuted }]}>
            {`${recipes.length} RECIPES`}
          </Text>
          <Pressable
            style={[styles.settingsBtn, { borderColor: colors.border }]}
            onPress={() => navigation.navigate('Settings')}
            hitSlop={8}
          >
            <Ionicons name="settings-outline" size={18} color={colors.textMuted} />
          </Pressable>
        </View>
      </View>

      {/* Search + Sort */}
      <View ref={tutorialRefs.search} style={styles.searchSortRow}>
        <View style={[styles.searchRow, { borderColor: colors.border }]}>
          <TextInput
            style={[styles.searchInput, { fontFamily: MONO, color: colors.text }]}
            value={search}
            onChangeText={setSearch}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setTimeout(() => setSearchFocused(false), 200)}
            onSubmitEditing={() => { if (search.trim()) saveSearchHistory(search); }}
            placeholder="/ search recipes"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={[styles.searchIcon, { color: colors.textMuted }]}>○</Text>
        </View>
        <Pressable
          style={[styles.sortBtn, { borderColor: colors.border }]}
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
          style={[styles.viewBtn, { borderColor: colors.border }]}
          onPress={cycleViewMode}
        >
          <Ionicons name={VIEW_MODES.find((m) => m.key === viewMode)?.icon || 'square-outline'} size={16} color={colors.textMuted} />
        </Pressable>
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
            }} style={[styles.tabItem, { borderColor: t === tab ? colors.primary : colors.border }, t === tab && { backgroundColor: colors.primary }]}>
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
          contentContainerStyle={viewMode === 'grid' ? styles.gridList : viewMode === 'compact' ? styles.compactList : styles.list}
          {...flatListExtraProps}
          refreshControl={
            <RefreshControl
              refreshing={loading && filtered.length > 0}
              onRefresh={() => load(search)}
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
        onPress={() => navigation.navigate('EditRecipe', {})}
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

const makeStyles = (colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  offlineBanner: {
    backgroundColor: '#c0392b',
    paddingVertical: 6,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  offlineBannerText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    fontFamily: MONO,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  wordmark: { fontSize: 18, fontWeight: '900', letterSpacing: 1, color: colors.text },
  recipeCount: { fontSize: 11, letterSpacing: 2 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  settingsBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hero: { paddingHorizontal: 20, paddingTop: 18 },
  heroText: {
    fontSize: 40,
    fontWeight: '900',
    lineHeight: 40,
    letterSpacing: -1,
    color: colors.text,
  },
  heroOutline: { fontSize: 40, fontWeight: '900' },
  searchSortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 20,
    gap: 8,
  },
  searchRow: {
    marginHorizontal: 20,
    marginTop: 18,
    borderWidth: 1.5,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 14,
    flex: 1,
  },
  searchInput: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 13,
  },
  searchIcon: { fontSize: 16 },
  sortBtn: {
    marginTop: 18,
    borderWidth: 1.5,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  sortLabel: { fontSize: 10, letterSpacing: 1 },
  tabsRow: { marginTop: 14, marginBottom: 10, flexGrow: 0 },
  tabsContent: { paddingHorizontal: 20, gap: 8 },
  tabItem: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5 },
  tabLabel: { fontSize: 11, letterSpacing: 0.5, fontWeight: '600' },
  tabActive: {},
  tabUnderline: { display: 'none' },
  chipsRow: { marginTop: 8, flexGrow: 0 },
  chipsContent: { paddingHorizontal: 20, gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1.5,
  },
  chipLabel: { fontSize: 10, letterSpacing: 0.8 },
  searchHistoryRow: { marginTop: 6, flexGrow: 0 },
  searchHistoryContent: { paddingHorizontal: 20, gap: 8 },
  searchHistoryChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
  },
  searchHistoryLabel: { fontSize: 10, letterSpacing: 0.5 },
  list: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 100 },
  card: {
    height: 200,
    borderRadius: 18,
    marginBottom: 14,
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
    top: 12,
    right: 14,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(19,16,16,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heart: { fontSize: 16, color: 'rgba(255,255,255,0.8)' },
  cardFooter: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 44,
    paddingBottom: 13,
    backgroundColor: 'rgba(10,8,8,0.75)',
  },
  cardTitle: {
    fontSize: 21,
    fontWeight: '900',
    letterSpacing: -0.3,
    color: '#fff',
    textTransform: 'uppercase',
    lineHeight: 22,
  },
  cardMeta: {
    fontFamily: MONO,
    fontSize: 10.5,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 6,
  },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyCard: {
    alignItems: 'center',
    marginTop: 20,
    padding: 40,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderRadius: 18,
  },
  emptyState: {
    alignItems: 'center',
    marginTop: 40,
    padding: 40,
  },
  emptyEmoji: { fontSize: 56, marginBottom: 16 },
  emptyTitle: { fontSize: 18, fontWeight: '900', letterSpacing: 0.5 },
  emptyHint: { fontFamily: MONO, fontSize: 11, marginTop: 8 },
  emptyBtn: {
    marginTop: 20,
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  emptyBtnText: { fontSize: 13, letterSpacing: 1 },
  fab: {
    position: 'absolute',
    right: 18,
    bottom: 100,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.15)',
    elevation: 8,
    shadowColor: colors.primary,
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  fabText: { fontSize: 24 },
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
    paddingHorizontal: 12,
    paddingBottom: 24,
  },
  menuSheet: {
    borderRadius: 24,
    borderWidth: 1.5,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  menuHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignSelf: 'center',
    marginBottom: 12,
  },
  menuTitle: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    textAlign: 'center',
    paddingBottom: 14,
    fontFamily: MONO,
  },
  menuActions: {
    borderWidth: 1.5,
    borderRadius: 16,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  menuIcon: {
    fontSize: 16,
    width: 22,
    textAlign: 'center',
  },
  menuItemText: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  menuDivider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 16,
  },
  menuCancel: {
    marginTop: 10,
    borderWidth: 1.5,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  menuCancelText: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  // View mode toggle button
  viewBtn: {
    marginTop: 18,
    borderWidth: 1.5,
    borderRadius: 20,
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // List view styles
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  listAccent: {
    width: 4,
    alignSelf: 'stretch',
  },
  listThumb: {
    width: 80,
    height: '100%',
    minHeight: 72,
    overflow: 'hidden',
  },
  listInfo: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  listTitle: {
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.5,
    lineHeight: 16,
  },
  listMeta: {
    fontSize: 10,
    marginTop: 5,
    letterSpacing: 1,
  },
  listTagRow: {
    flexDirection: 'row',
    gap: 5,
    marginTop: 6,
  },
  listTag: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  listTagText: {
    fontSize: 8,
    letterSpacing: 0.5,
  },
  listFavBtn: {
    paddingRight: 14,
    paddingLeft: 8,
  },

  // Grid view styles
  gridList: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 100 },
  gridRow: { gap: 10, marginBottom: 0 },
  gridCard: {
    flex: 1,
    marginBottom: 12,
  },
  gridInner: {
    borderRadius: 18,
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
    top: 8,
    right: 8,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(19,16,16,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridFooter: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 12,
    paddingTop: 36,
    paddingBottom: 10,
    backgroundColor: 'rgba(10,8,8,0.80)',
  },
  gridTitle: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.3,
    color: '#fff',
    lineHeight: 14,
  },
  gridMeta: {
    fontSize: 9,
    marginTop: 4,
    letterSpacing: 1,
    color: 'rgba(255,255,255,0.7)',
  },

  // Compact view styles
  compactList: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 100 },
  compactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  compactIndex: {
    fontSize: 11,
    letterSpacing: 1,
    width: 24,
  },
  compactBody: {
    flex: 1,
  },
  compactTitle: {
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.5,
    lineHeight: 16,
  },
  compactSub: {
    fontSize: 9,
    marginTop: 3,
    letterSpacing: 1,
  },
  compactTime: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  collectionBadges: {
    position: 'absolute',
    top: 12,
    right: 14,
    flexDirection: 'row',
    gap: 4,
  },
  collectionBadge: {
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  collectionBadgeText: {
    color: '#fff',
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  newColOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 30,
  },
  newColCard: {
    width: '100%',
    maxWidth: 340,
    borderWidth: 1.5,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
  },
  newColTitle: {
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.3,
    textAlign: 'center',
    marginBottom: 16,
  },
  newColInput: {
    width: '100%',
    borderWidth: 1.5,
    borderRadius: 12,
    padding: 14,
    fontSize: 14,
    marginBottom: 16,
  },
  newColBtns: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  newColBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  newColBtnText: {
    fontWeight: '900',
    fontSize: 13,
    letterSpacing: 1,
  },
});
