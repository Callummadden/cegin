import { useState, useMemo, useEffect } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

const PHOTO_DIR = FileSystem.documentDirectory + 'terry-vision/';

// Ensure photo directory exists
async function ensurePhotoDir() {
  const info = await FileSystem.getInfoAsync(PHOTO_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(PHOTO_DIR, { intermediates: true });
  }
}

// Save a photo permanently and return the local URI
async function savePhoto(tempUri, sectionKey) {
  await ensurePhotoDir();
  const filename = `${sectionKey}_${Date.now()}.jpg`;
  const dest = PHOTO_DIR + filename;
  await FileSystem.copyAsync({ from: tempUri, to: dest });
  return dest;
}
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api';
import { MONO, useTheme } from '../theme';
import BottomNav from '../components/BottomNav';
import AiDisclaimer from '../components/AiDisclaimer';
import { useAi } from '../aiContext';
import { useToast } from '../components/Toast';
import { useResponsive } from '../utils/responsive';

const SECTIONS = [
  { key: 'fridge', label: 'FRIDGE', icon: '🧊', desc: 'Snap the inside of your fridge' },
  { key: 'ambient', label: 'AMBIENT', icon: '🍽️', desc: 'Counter, pantry, or table' },
  { key: 'freezer', label: 'FREEZER', icon: '❄️', desc: 'What\'s in the freezer' },
];

export default function TerryVisionScreen({ route, navigation }) {
  const { colors } = useTheme();
  const { s, fs } = useResponsive();
  const { noAI } = useAi();
  const { showToast } = useToast();
  const styles = useMemo(() => makeStyles(colors, s, fs), [colors, s, fs]);
  const insets = useSafeAreaInsets();

  const SCAN_KEY = 'terry_vision_scans';

  // Migrate old single-scan format to array format
  const migrateScans = (raw) => {
    const migrated = {};
    for (const key in raw) {
      const val = raw[key];
      if (Array.isArray(val)) {
        migrated[key] = val;
      } else if (val?.photo) {
        // Old format: single object → wrap in array
        migrated[key] = [val];
      }
    }
    return migrated;
  };

  // Load saved scans on focus
  useFocusEffect(
    useMemo(() => () => {
      let cancelled = false;
      (async () => {
        try {
          const raw = await AsyncStorage.getItem(SCAN_KEY);
          if (raw) {
            const data = JSON.parse(raw);
            const saved = data.scans || data; // backward compat
            const migrated = migrateScans(saved);
            // Verify photos still exist
            const verified = {};
            for (const key in migrated) {
              const validScans = [];
              for (const scan of migrated[key]) {
                if (scan?.photo) {
                  const info = await FileSystem.getInfoAsync(scan.photo);
                  if (info.exists) validScans.push({ ...scan, loading: false, error: null });
                }
              }
              if (validScans.length) verified[key] = validScans;
            }
            if (cancelled) return;
            if (Object.keys(verified).length) setScans(verified);
            if (data.suggestions) setSuggestions(data.suggestions);
          }
        } catch {}
      })();
      return () => { cancelled = true; };
    }, [])
  );

  // Each section: array of { photo, ingredients, loading, error }
  const [scans, setScans] = useState({});
  // Terry's combined suggestions
  const [suggestions, setSuggestions] = useState(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState(null);
  const [savedRecipes, setSavedRecipes] = useState({});
  const [previewRecipe, setPreviewRecipe] = useState(null);
  // All user recipes for matching
  const [allUserRecipes, setAllUserRecipes] = useState([]);
  const [showAllMatches, setShowAllMatches] = useState(false);

  // Mark recipe as saved when returning from EditRecipeScreen
  useEffect(() => {
    if (route.params?.savedIndex !== undefined) {
      setSavedRecipes((prev) => ({ ...prev, [route.params.savedIndex]: true }));
      navigation.setParams({ savedIndex: undefined });
    }
  }, [route.params?.savedIndex]);

  // Save scans + suggestions whenever they change
  useEffect(() => {
    const toSave = {};
    for (const key in scans) {
      const withIngredients = scans[key].filter((s) => s.ingredients);
      if (withIngredients.length) {
        toSave[key] = withIngredients.map((s) => ({ photo: s.photo, ingredients: s.ingredients }));
      }
    }
    const data = { scans: toSave, suggestions };
    AsyncStorage.setItem(SCAN_KEY, JSON.stringify(data)).catch(() => {});
  }, [scans, suggestions]);

  const allIngredients = useMemo(() => {
    const set = new Set();
    for (const key in scans) {
      for (const scan of scans[key]) {
        if (scan.ingredients) scan.ingredients.forEach((i) => set.add(i));
      }
    }
    return [...set];
  }, [scans]);

  const scannedCount = useMemo(() => {
    let count = 0;
    for (const key in scans) {
      count += scans[key].filter((s) => s.ingredients?.length > 0).length;
    }
    return count;
  }, [scans]);

  // Fetch all user recipes when we have ingredients to match against
  useEffect(() => {
    if (allIngredients.length === 0) { setAllUserRecipes([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const recipes = await api.listRecipes();
        if (!cancelled) setAllUserRecipes(recipes || []);
      } catch {
        // Offline — no matching available
      }
    })();
    return () => { cancelled = true; };
  }, [allIngredients.length]);

  // Match saved recipes against scanned ingredients
  const matchedRecipes = useMemo(() => {
    if (!allIngredients.length || !allUserRecipes.length) return [];
    const scanned = allIngredients.map((i) => i.toLowerCase());
    const scored = [];
    for (const recipe of allUserRecipes) {
      const recipeIngs = (recipe.ingredients || []).map((i) => i.toLowerCase());
      let matchCount = 0;
      for (const si of scanned) {
        if (recipeIngs.some((ri) => ri.includes(si) || si.includes(ri))) matchCount++;
      }
      if (matchCount > 0) {
        scored.push({ recipe, matchCount, recipeTotal: recipeIngs.length });
      }
    }
    // Sort by match count descending, then by % matched
    scored.sort((a, b) => b.matchCount - a.matchCount || (b.matchCount / b.recipeTotal) - (a.matchCount / a.recipeTotal));
    return scored; // Return all matches
  }, [allIngredients, allUserRecipes]);

  const captureAndScan = async (sectionKey, fromGallery = false) => {
    try {
      const result = fromGallery
        ? await ImagePicker.launchImageLibraryAsync({ quality: 0.5, base64: false })
        : await ImagePicker.launchCameraAsync({ quality: 0.5, base64: false });
      if (result.canceled || !result.assets?.[0]) return;

      // Add new scan entry to the section array
      const newScan = { photo: result.assets[0].uri, loading: true, error: null, ingredients: null };
      setScans((prev) => ({
        ...prev,
        [sectionKey]: [...(prev[sectionKey] || []), newScan],
      }));
      const scanIndex = (scans[sectionKey] || []).length;

      // Compress and resize
      const compressed = await manipulateAsync(
        result.assets[0].uri,
        [{ resize: { width: 1024 } }],
        { compress: 0.6, format: SaveFormat.JPEG }
      );

      // Save photo permanently
      const savedUri = await savePhoto(compressed.uri, sectionKey);

      setScans((prev) => {
        const arr = [...(prev[sectionKey] || [])];
        arr[scanIndex] = { ...arr[scanIndex], photo: savedUri };
        return { ...prev, [sectionKey]: arr };
      });

      const base64 = await FileSystem.readAsStringAsync(compressed.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const { ingredients } = await api.scanFridge(base64);

      if (!ingredients.length) {
        // Remove the photo since nothing was found
        setScans((prev) => {
          const arr = [...(prev[sectionKey] || [])];
          arr.splice(scanIndex, 1);
          if (arr.length === 0) {
            const next = { ...prev };
            delete next[sectionKey];
            return next;
          }
          return { ...prev, [sectionKey]: arr };
        });
        // Clean up the saved photo file
        try { await FileSystem.deleteAsync(savedUri, { idempotent: true }); } catch {}
        showToast({ message: 'Couldn\'t identify any items — try a clearer photo', color: '#ff4444', duration: 4000 });
        return;
      }

      setScans((prev) => {
        const arr = [...(prev[sectionKey] || [])];
        arr[scanIndex] = { ...arr[scanIndex], ingredients, loading: false };
        return { ...prev, [sectionKey]: arr };
      });

      // Sync scanned items to server for perishable tracking
      try {
        await api.addScannedItems(ingredients);
      } catch {
        // Server offline — items still saved locally
      }

      // Clear previous suggestions when new scan comes in
      setSuggestions(null);
      setSavedRecipes({});
      setSuggestError(null);

    } catch (e) {
      // If scan array entry doesn't exist yet, add error directly
      setScans((prev) => {
        const arr = [...(prev[sectionKey] || [])];
        const idx = arr.length - 1;
        if (idx >= 0 && arr[idx].loading) {
          arr[idx] = { ...arr[idx], loading: false, error: e.message };
        }
        return { ...prev, [sectionKey]: arr };
      });
    }
  };

  const removeScan = (sectionKey, scanIndex) => {
    setScans((prev) => {
      const arr = [...(prev[sectionKey] || [])];
      arr.splice(scanIndex, 1);
      if (arr.length === 0) {
        const next = { ...prev };
        delete next[sectionKey];
        return next;
      }
      return { ...prev, [sectionKey]: arr };
    });
    setSuggestions(null);
    setSavedRecipes({});
  };

  const askTerry = async (more = false) => {
    if (!allIngredients.length) return;
    setSuggesting(true);
    setSuggestError(null);
    if (!more) setSuggestions(null);

    try {
      // Build context about where items came from
      const locationParts = [];
      for (const key in scans) {
        const section = SECTIONS.find((s) => s.key === key);
        for (const scan of scans[key]) {
          if (scan.ingredients?.length) {
            locationParts.push(`${section.label}: ${scan.ingredients.join(', ')}`);
          }
        }
      }

      const existingTitles = (more && suggestions) ? suggestions.map((r) => r.title) : [];
      const moreHint = more && existingTitles.length
        ? `\n\nIMPORTANT: Suggest COMPLETELY DIFFERENT recipes from these already suggested: ${existingTitles.join(', ')}. Try different cuisines or cooking styles.`
        : '';

      const prompt = `I scanned my kitchen and found these ingredients:\n\n${locationParts.join('\n')}\n\nCombined: ${allIngredients.join(', ')}.\n\nWhat can I make? Suggest 2-3 practical recipes using what I have.${moreHint} Return ONLY a JSON object: { "recipes": [{ "title": "...", "description": "...", "ingredients": ["...", "..."], "steps": ["step 1", "step 2"], "difficulty": "easy|medium|hard", "prep_minutes": 10, "cook_minutes": 20 }] }. Keep descriptions under 30 words. List only the key ingredients used. Steps should be brief (under 15 words each). Don't suggest recipes needing major ingredients I don't have.`;

      const { reply } = await api.aiChat([{ role: 'user', content: prompt }]);

      // Parse JSON from the response
      let parsed;
      try {
        parsed = JSON.parse(reply);
      } catch {
        const match = reply.match(/\{[\s\S]*\}/);
        parsed = match ? JSON.parse(match[0]) : null;
      }

      if (parsed?.recipes?.length) {
        setSuggestions((prev) => more && prev ? [...prev, ...parsed.recipes] : parsed.recipes);
      } else {
        setSuggestions([{ title: 'Recipe Suggestion', description: reply, ingredients: allIngredients }]);
      }
    } catch (e) {
      setSuggestError(e.message);
    } finally {
      setSuggesting(false);
    }
  };

  const generateFullRecipe = async (index) => {
    if (!suggestions?.[index]) return null;
    const recipe = suggestions[index];
    try {
      const { recipe: fullRecipe } = await api.aiRecipe({
        prompt: `Generate a complete recipe in JSON format for: "${recipe.title}". Description: ${recipe.description}. Key ingredients: ${recipe.ingredients.join(', ')}. Include: title, description, ingredients (array of strings), steps (array of strings), tags (array), prep_minutes, cook_minutes, servings.`,
      });
      if (fullRecipe) {
        const saved = await api.createRecipe(fullRecipe);
        setSavedRecipes((prev) => ({ ...prev, [index]: saved.id }));
        return saved;
      }
    } catch (e) {
      // Silently fail
    }
    return null;
  };

  const saveRecipe = async (index) => {
    if (!suggestions?.[index]) return;
    const recipe = suggestions[index];
    navigation.navigate('EditRecipe', {
      draft: {
        title: recipe.title || '',
        description: recipe.description || '',
        ingredients: recipe.ingredients || [],
        steps: recipe.steps || [],
        tags: [],
        prep_minutes: recipe.prep_minutes || 0,
        cook_minutes: recipe.cook_minutes || 0,
        servings: 1,
      },
    });
  };

  const openRecipe = async (index) => {
    if (!suggestions?.[index]) return;
    if (savedRecipes[index]) {
      navigation.navigate('RecipeDetail', { id: savedRecipes[index] });
      return;
    }
    setPreviewRecipe({ ...suggestions[index], index });
  };

  const saveFromPreview = async () => {
    if (!previewRecipe) return;
    const recipe = previewRecipe;
    setPreviewRecipe(null);
    navigation.navigate('EditRecipe', {
      draft: {
        title: recipe.title || '',
        description: recipe.description || '',
        ingredients: recipe.ingredients || [],
        steps: recipe.steps || [],
        tags: [],
        prep_minutes: recipe.prep_minutes || 0,
        cook_minutes: recipe.cook_minutes || 0,
        servings: 1,
      },
      fromVision: recipe.index,
    });
  };

  const renderSection = (section) => {
    const sectionScans = scans[section.key] || [];
    // Merge all ingredients from all scans in this section
    const sectionIngredients = [];
    for (const scan of sectionScans) {
      if (scan.ingredients) sectionIngredients.push(...scan.ingredients);
    }
    const isLoading = sectionScans.some((s) => s.loading);
    const hasScans = sectionScans.length > 0;

    return (
      <View key={section.key} style={[styles.section, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionIcon}>{section.icon}</Text>
          <View style={{ flex: 1 }}>
            <Text style={[styles.sectionLabel, { fontFamily: MONO, color: colors.primary }]}>{section.label}</Text>
            <Text style={[styles.sectionDesc, { color: colors.textMuted }]}>{section.desc}</Text>
          </View>
          {sectionIngredients.length > 0 && (
            <View style={[styles.countBadge, { backgroundColor: colors.primary }]}>
              <Text style={styles.countBadgeText}>{sectionIngredients.length}</Text>
            </View>
          )}
        </View>

        {/* Photos — horizontal scroll when multiple */}
        {hasScans && (
          <View style={styles.photoScrollWrap}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.photoScroll}
              contentContainerStyle={styles.photoScrollContent}
            >
              {/* Add more button — always first */}
              <View style={styles.addMoreWrap}>
                <View style={styles.addMoreRow}>
                  <Pressable
                    style={[styles.addMoreBtn, { borderColor: colors.primary, backgroundColor: colors.background }]}
                    onPress={() => captureAndScan(section.key)}
                  >
                    <Text style={styles.addMoreIcon}>📷</Text>
                    <Text style={[styles.addMoreLabel, { color: colors.text }]}>CAMERA</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.addMoreBtn, { borderColor: colors.border, backgroundColor: colors.background }]}
                    onPress={() => captureAndScan(section.key, true)}
                  >
                    <Text style={styles.addMoreIcon}>🖼️</Text>
                    <Text style={[styles.addMoreLabel, { color: colors.text }]}>GALLERY</Text>
                  </Pressable>
              </View>
            </View>

              {/* Photos */}
              {sectionScans.map((scan, i) => (
                <View key={i} style={[styles.photoWrap, { marginLeft: i === 0 ? s(10) : 0, marginRight: s(10) }]}>
                  <Image source={{ uri: scan.photo }} style={styles.photo} contentFit="cover" />
                  <Pressable style={styles.retakeBtn} onPress={() => removeScan(section.key, i)}>
                    <Text style={styles.retakeBtnText}>✕</Text>
                  </Pressable>
                  {scan.loading && (
                    <View style={styles.photoLoadingOverlay}>
                      <ActivityIndicator size="small" color="#fff" />
                    </View>
                  )}
                </View>
              ))}

            </ScrollView>
          </View>
        )}

        {/* Initial capture buttons — no scans yet */}
        {!hasScans && (
          <View style={styles.captureRow}>
            <Pressable
              style={[styles.captureBtn, { borderColor: colors.primary, backgroundColor: colors.background }]}
              onPress={() => captureAndScan(section.key)}
            >
              <Text style={styles.captureBtnIcon}>📷</Text>
              <Text style={[styles.captureBtnLabel, { color: colors.text }]}>CAMERA</Text>
            </Pressable>
            <Pressable
              style={[styles.captureBtn, { borderColor: colors.border, backgroundColor: colors.background }]}
              onPress={() => captureAndScan(section.key, true)}
            >
              <Text style={styles.captureBtnIcon}>🖼️</Text>
              <Text style={[styles.captureBtnLabel, { color: colors.text }]}>GALLERY</Text>
            </Pressable>
          </View>
        )}

        {/* Per-scan errors */}
        {sectionScans.map((scan, i) => scan.error ? (
          <Text key={`err-${i}`} style={[styles.errorText, { color: colors.danger }]}>
            {scan.error}
          </Text>
        ) : null)}

        {/* Merged ingredients for the section */}
        {sectionIngredients.length > 0 && (
          <View style={styles.ingredientChips}>
            {sectionIngredients.map((ing, i) => (
              <View key={i} style={[styles.ingredientChip, { borderColor: colors.border, backgroundColor: colors.background }]}>
                <Text style={[styles.ingredientText, { color: colors.text2 }]}>{ing}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    );
  };

  if (noAI) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center', padding: 40 }]}>
        <Text style={{ fontSize: 40, marginBottom: 16 }}>🚫</Text>
        <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text, textAlign: 'center', marginBottom: 8 }}>AI IS DISABLED</Text>
        <Text style={{ fontSize: 14, color: colors.textMuted, textAlign: 'center', lineHeight: 20 }}>
          Turn off NO AI MODE in Settings to use Terry Vision.
        </Text>
        <Pressable
          style={{ marginTop: 24, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10, borderWidth: 1.5, borderColor: colors.border }}
          onPress={() => navigation.goBack()}
        >
          <Text style={{ fontFamily: MONO, color: colors.text, fontSize: 12, letterSpacing: 1 }}>BACK TO RECIPES</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: 20 + insets.top }]}>
        <Pressable style={[styles.backBtn, { borderColor: colors.border }]} onPress={() => navigation.goBack()}>
          <Text style={{ fontSize: 17, color: colors.text }}>←</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.text }]}>TERRY VISION</Text>
          <Text style={[styles.subtitle, { fontFamily: MONO, color: colors.textMuted }]}>BETA</Text>
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>

        {/* Terry's combined suggestion — always at top */}
        <View style={[styles.topCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <View style={styles.topHeader}>
            <Text style={styles.topIcon}>🐱</Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.topTitle, { color: colors.text }]}>WHAT CAN I MAKE?</Text>
              <Text style={[styles.topDesc, { fontFamily: MONO, color: colors.textMuted }]}>
                {allIngredients.length > 0
                  ? `${allIngredients.length} items across ${scannedCount} scan${scannedCount !== 1 ? 's' : ''}`
                  : 'Scan your kitchen sections below first'}
              </Text>
            </View>
          </View>

          {allIngredients.length > 0 && (
            <View style={styles.allIngredientsWrap}>
              {allIngredients.map((ing, i) => (
                <View key={i} style={[styles.miniChip, { borderColor: colors.border }]}>
                  <Text style={[styles.miniChipText, { color: colors.text2 }]}>{ing}</Text>
                </View>
              ))}
            </View>
          )}

          {allIngredients.length > 0 && matchedRecipes.length > 0 && (
            <View style={styles.matchedSection}>
              <Text style={[styles.matchedLabel, { fontFamily: MONO, color: colors.primary }]}>🍳 FROM YOUR RECIPES</Text>
              {(showAllMatches ? matchedRecipes : matchedRecipes.slice(0, 3)).map(({ recipe, matchCount, recipeTotal }) => (
                <Pressable
                  key={recipe.id}
                  style={[styles.matchedCard, { borderColor: colors.border, backgroundColor: colors.background }]}
                  onPress={() => navigation.navigate('RecipeDetail', { id: recipe.id })}
                >
                  <Text style={[styles.matchedCardTitle, { color: colors.text }]} numberOfLines={1}>{recipe.title}</Text>
                  <Text style={[styles.matchedCardBadge, { fontFamily: MONO, color: colors.primary }]}>
                    {matchCount}/{recipeTotal}
                  </Text>
                </Pressable>
              ))}
              {matchedRecipes.length > 3 && (
                <Pressable onPress={() => setShowAllMatches((v) => !v)}>
                  <Text style={[styles.showAllBtn, { fontFamily: MONO, color: colors.textMuted }]}>
                    {showAllMatches ? 'SHOW LESS' : `SHOW ALL ${matchedRecipes.length}`}
                  </Text>
                </Pressable>
              )}
            </View>
          )}

          {allIngredients.length > 0 && (
            <Pressable
              style={[styles.askBtn, { backgroundColor: colors.primary }, suggesting && { opacity: 0.6 }]}
              onPress={askTerry}
              disabled={suggesting}
            >
              {suggesting ? (
                <ActivityIndicator size="small" color={colors.onPrimary} />
              ) : (
                <Text style={[styles.askBtnText, { color: colors.onPrimary }]}>🐾 ASK TERRY</Text>
              )}
            </Pressable>
          )}

          {suggestError && (
            <Text style={[styles.errorText, { color: colors.danger }]}>{suggestError}</Text>
          )}

          {suggestions && (
            <View style={styles.suggestionsList}>
              <Text style={[styles.matchedLabel, { fontFamily: MONO, color: colors.primary, marginBottom: s(4) }]}>🐾 TERRY SUGGESTS</Text>
              {suggestions.map((recipe, i) => (
                <View
                  key={i}
                  style={[styles.recipeCard, { borderColor: colors.border, backgroundColor: colors.background }]}
                >
                  <Pressable onPress={() => openRecipe(i)}>
                    <View style={styles.recipeCardHeader}>
                      <Text style={[styles.recipeCardTitle, { color: colors.text }]}>{recipe.title}</Text>
                      {savedRecipes[i] && (
                        <Text style={[styles.recipeCardSaved, { fontFamily: MONO, color: colors.primary }]}>✓ SAVED</Text>
                      )}
                    </View>
                    <Text style={[styles.recipeCardDesc, { color: colors.text2 }]}>{recipe.description}</Text>
                    {recipe.ingredients?.length > 0 && (
                      <View style={styles.recipeCardIngredients}>
                        {recipe.ingredients.map((ing, j) => (
                          <View key={j} style={[styles.miniChip, { borderColor: colors.border }]}>
                            <Text style={[styles.miniChipText, { color: colors.text2 }]}>{ing}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                    {savedRecipes[i] && (
                      <Text style={[styles.tapHint, { fontFamily: MONO, color: colors.textMuted }]}>TAP TO VIEW →</Text>
                    )}
                  </Pressable>
                  {!savedRecipes[i] && (
                    <Pressable
                      style={[styles.saveBtn, { borderColor: colors.primary }]}
                      onPress={() => saveRecipe(i)}
                    >
                      <Text style={[styles.saveBtnText, { fontFamily: MONO, color: colors.primary }]}>🍳 SAVE</Text>
                    </Pressable>
                  )}
                </View>
              ))}
              <AiDisclaimer />
              <Pressable
                style={[styles.moreBtn, { borderColor: colors.border }, suggesting && { opacity: 0.6 }]}
                onPress={() => askTerry(true)}
                disabled={suggesting}
              >
                {suggesting ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Text style={[styles.moreBtnText, { fontFamily: MONO, color: colors.textMuted }]}>🔄 GENERATE MORE</Text>
                )}
              </Pressable>
            </View>
          )}
        </View>

        {/* Divider */}
        <View style={styles.dividerRow}>
          <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
          <Text style={[styles.dividerLabel, { fontFamily: MONO, color: colors.textMuted }]}>SCAN SECTIONS</Text>
          <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
        </View>

        {/* Sections */}
        {SECTIONS.map(renderSection)}

      </ScrollView>

      <BottomNav active="assistant" navigation={navigation} />

      {/* Preview modal */}
      <Modal visible={!!previewRecipe} transparent animationType="fade" onRequestClose={() => setPreviewRecipe(null)}>
        <Pressable style={styles.previewOverlay} onPress={() => setPreviewRecipe(null)}>
          <Pressable style={[styles.previewCard, { backgroundColor: colors.surface, borderColor: colors.border }]} onPress={() => {}}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 10 }}>
              <Text style={[styles.previewTitle, { color: colors.text }]}>{previewRecipe?.title}</Text>
              <Text style={[styles.previewDesc, { color: colors.text2 }]}>{previewRecipe?.description}</Text>

              {/* Stats row */}
              <View style={styles.previewStats}>
                {previewRecipe?.difficulty && (
                  <View style={[styles.previewStatChip, { borderColor: colors.border }]}>
                    <Text style={[styles.previewStatText, { fontFamily: MONO, color: colors.text }]}>
                      {previewRecipe.difficulty === 'easy' ? '🟢' : previewRecipe.difficulty === 'medium' ? '🟡' : '🔴'} {previewRecipe.difficulty.toUpperCase()}
                    </Text>
                  </View>
                )}
                {previewRecipe?.prep_minutes > 0 && (
                  <View style={[styles.previewStatChip, { borderColor: colors.border }]}>
                    <Text style={[styles.previewStatText, { fontFamily: MONO, color: colors.text }]}>⏱ PREP {previewRecipe.prep_minutes}m</Text>
                  </View>
                )}
                {previewRecipe?.cook_minutes > 0 && (
                  <View style={[styles.previewStatChip, { borderColor: colors.border }]}>
                    <Text style={[styles.previewStatText, { fontFamily: MONO, color: colors.text }]}>🔥 COOK {previewRecipe.cook_minutes}m</Text>
                  </View>
                )}
                {(previewRecipe?.prep_minutes > 0 || previewRecipe?.cook_minutes > 0) && (
                  <View style={[styles.previewStatChip, { borderColor: colors.primary }]}>
                    <Text style={[styles.previewStatText, { fontFamily: MONO, color: colors.primary }]}>Σ {(previewRecipe?.prep_minutes || 0) + (previewRecipe?.cook_minutes || 0)}m</Text>
                  </View>
                )}
              </View>

              {/* Ingredients */}
              {previewRecipe?.ingredients?.length > 0 && (
                <View style={styles.previewIngredients}>
                  <Text style={[styles.previewLabel, { fontFamily: MONO, color: colors.primary }]}>INGREDIENTS</Text>
                  <View style={styles.previewChips}>
                    {previewRecipe.ingredients.map((ing, i) => (
                      <View key={i} style={[styles.miniChip, { borderColor: colors.border }]}>
                        <Text style={[styles.miniChipText, { color: colors.text2 }]}>{ing}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {/* Method */}
              {previewRecipe?.steps?.length > 0 && (
                <View style={styles.previewSteps}>
                  <Text style={[styles.previewLabel, { fontFamily: MONO, color: colors.primary }]}>METHOD</Text>
                  {previewRecipe.steps.map((step, i) => (
                    <View key={i} style={styles.previewStep}>
                      <Text style={[styles.previewStepNum, { color: colors.primary }]}>{i + 1}</Text>
                      <Text style={[styles.previewStepText, { color: colors.text2 }]}>{step}</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Actions */}
              <View style={styles.previewActions}>
                <Pressable style={[styles.previewCancel, { borderColor: colors.border }]} onPress={() => setPreviewRecipe(null)}>
                  <Text style={[styles.previewCancelText, { fontFamily: MONO, color: colors.textMuted }]}>CLOSE</Text>
                </Pressable>
                <Pressable style={[styles.previewSave, { backgroundColor: colors.primary }]} onPress={saveFromPreview}>
                  <Text style={[styles.previewSaveText, { color: colors.onPrimary }]}>🍳 SAVE AS RECIPE</Text>
                </Pressable>
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const makeStyles = (colors, s, fs) => StyleSheet.create({

  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(14),
    paddingHorizontal: s(20),
    paddingBottom: s(12),
  },
  backBtn: { width: s(38), height: s(38), borderRadius: s(20), borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: fs(18), fontWeight: '900', letterSpacing: 0.5 },
  subtitle: { fontSize: fs(9), letterSpacing: 2, marginTop: s(1) },
  list: { paddingBottom: s(100) },

  // Top card — Terry's suggestion
  topCard: {
    marginHorizontal: s(20),
    marginBottom: s(8),
    borderRadius: s(20),
    borderWidth: 1.5,
    padding: s(18),
  },
  topHeader: { flexDirection: 'row', alignItems: 'center', gap: s(12), marginBottom: s(4) },
  topIcon: { fontSize: fs(28) },
  topTitle: { fontSize: fs(13), fontWeight: '900', letterSpacing: 0.5 },
  topDesc: { fontSize: fs(10), letterSpacing: 0.3, marginTop: s(2) },
  allIngredientsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: s(5), marginTop: s(12), marginBottom: s(14) },
  miniChip: { borderWidth: 1, borderRadius: s(10), paddingHorizontal: s(8), paddingVertical: s(3) },
  miniChipText: { fontSize: fs(10), fontWeight: '600' },
  askBtn: { borderRadius: s(16), paddingVertical: s(14), alignItems: 'center' },
  askBtnText: { fontWeight: '900', fontSize: fs(13), letterSpacing: 1 },
  suggestionsList: { marginTop: s(14), paddingTop: s(14), borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)', gap: s(12) },

  // Matched recipes from user's collection
  matchedSection: { marginTop: s(10), paddingTop: s(10), borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)', gap: s(6) },
  matchedLabel: { fontSize: fs(10), letterSpacing: 1.5, fontWeight: '700', marginBottom: s(2) },
  matchedCard: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderRadius: s(12), paddingHorizontal: s(12), paddingVertical: s(10), gap: s(8) },
  matchedCardTitle: { fontSize: fs(13), fontWeight: '700', flex: 1 },
  matchedCardBadge: { fontSize: fs(10), fontWeight: '700', letterSpacing: 0.5 },
  showAllBtn: { fontSize: fs(10), letterSpacing: 1, textAlign: 'center', paddingVertical: s(6) },
  recipeCard: { borderWidth: 1.5, borderRadius: s(16), padding: s(14) },
  recipeCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: s(6) },
  recipeCardTitle: { fontSize: fs(16), fontWeight: '900', flex: 1 },
  recipeCardSaved: { fontSize: fs(10), letterSpacing: 0.5, fontWeight: '700', marginLeft: s(10) },
  recipeCardDesc: { fontSize: fs(13), lineHeight: fs(19), marginBottom: s(10) },
  recipeCardIngredients: { flexDirection: 'row', flexWrap: 'wrap', gap: s(5), marginBottom: s(12) },
  recipeCardFooter: { flexDirection: 'row', alignItems: 'center', gap: s(12) },
  saveBtn: { borderWidth: 1.5, borderRadius: s(14), paddingHorizontal: s(16), paddingVertical: s(10), marginTop: s(10) },
  saveBtnText: { fontSize: fs(12), fontWeight: '700', letterSpacing: 0.5 },
  tapHint: { fontSize: fs(10), letterSpacing: 0.5 },
  // Generate more button
  moreBtn: { borderWidth: 1.5, borderRadius: s(12), paddingVertical: s(12), alignItems: 'center', marginTop: s(4) },
  moreBtnText: { fontSize: fs(11), letterSpacing: 1 },
  // Preview modal
  previewOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', paddingHorizontal: s(20) },
  previewCard: { borderRadius: s(24), borderWidth: 1.5, padding: s(24) },
  previewTitle: { fontSize: fs(22), fontWeight: '900', marginBottom: s(10) },
  previewDesc: { fontSize: fs(14), lineHeight: fs(21), marginBottom: s(16) },
  previewIngredients: { marginBottom: s(16) },
  previewLabel: { fontSize: fs(10), letterSpacing: 1.5, marginBottom: s(8) },
  previewChips: { flexDirection: 'row', flexWrap: 'wrap', gap: s(6) },
  previewStats: { flexDirection: 'row', flexWrap: 'wrap', gap: s(8), marginBottom: s(16) },
  previewStatChip: { borderWidth: 1.5, borderRadius: s(12), paddingHorizontal: s(10), paddingVertical: s(6) },
  previewStatText: { fontSize: fs(11), fontWeight: '600', letterSpacing: 0.3 },
  previewSteps: { marginBottom: s(16) },
  previewStep: { flexDirection: 'row', gap: s(10), marginTop: s(8) },
  previewStepNum: { fontSize: fs(13), fontWeight: '900', width: s(20), textAlign: 'right' },
  previewStepText: { fontSize: fs(13), lineHeight: fs(19), flex: 1 },
  previewActions: { flexDirection: 'row', gap: s(12) },
  previewCancel: { flex: 1, borderWidth: 1.5, borderRadius: s(16), paddingVertical: s(14), alignItems: 'center' },
  previewCancelText: { fontSize: fs(11), letterSpacing: 1 },
  previewSave: { flex: 1, borderRadius: s(16), paddingVertical: s(14), alignItems: 'center' },
  previewSaveText: { fontWeight: '900', fontSize: fs(12), letterSpacing: 0.5 },

  // Divider
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: s(14), paddingHorizontal: s(20), marginVertical: s(14) },
  dividerLine: { flex: 1, height: s(1) },
  dividerLabel: { fontSize: fs(9), letterSpacing: 1.5 },

  // Section card
  section: {
    marginHorizontal: s(20),
    marginBottom: s(14),
    borderRadius: s(20),
    borderWidth: 1.5,
    padding: s(18),
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: s(12), marginBottom: s(14) },
  sectionIcon: { fontSize: fs(28) },
  sectionLabel: { fontSize: fs(11), letterSpacing: 1.5, fontWeight: '700' },
  sectionDesc: { fontSize: fs(12), marginTop: s(2) },
  countBadge: { borderRadius: s(10), paddingHorizontal: s(8), paddingVertical: s(3) },
  countBadgeText: { color: '#fff', fontSize: fs(11), fontWeight: '900' },

  // Capture buttons
  captureRow: { flexDirection: 'row', gap: s(10) },
  captureBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: s(8),
    borderWidth: 1.5,
    borderRadius: s(14),
    paddingVertical: s(14),
  },
  captureBtnIcon: { fontSize: fs(18) },
  captureBtnLabel: { fontSize: fs(12), fontWeight: '700', letterSpacing: 0.5 },

  // Photo scroll (multi-photo)
  photoScrollWrap: { position: 'relative', marginBottom: s(10) },
  photoScroll: {},
  photoScrollContent: { alignItems: 'flex-start' },
  photoWrap: { borderRadius: s(14), overflow: 'hidden', position: 'relative', width: s(200) },
  photo: { width: s(200), height: s(160), borderRadius: s(14) },
  photoLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: s(14),
  },
  retakeBtn: { position: 'absolute', top: s(10), right: s(10), width: s(28), height: s(28), borderRadius: s(14), backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  retakeBtnText: { color: '#fff', fontSize: fs(14), fontWeight: '700' },

  // Add more buttons (in scroll)
  addMoreWrap: { justifyContent: 'center' },
  addMoreRow: { gap: s(8) },
  addMoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: s(6),
    borderWidth: 1.5,
    borderRadius: s(12),
    paddingVertical: s(12),
    paddingHorizontal: s(14),
    width: s(120),
  },
  addMoreIcon: { fontSize: fs(16) },
  addMoreLabel: { fontSize: fs(11), fontWeight: '700', letterSpacing: 0.5 },

  // Loading
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: s(10), marginTop: s(12) },
  loadingText: { fontSize: fs(12), fontFamily: MONO },

  // Error
  errorText: { fontSize: fs(12), marginTop: s(10) },

  // Ingredients
  ingredientChips: { flexDirection: 'row', flexWrap: 'wrap', gap: s(6), marginTop: s(12) },
  ingredientChip: { borderWidth: 1.5, borderRadius: s(14), paddingHorizontal: s(10), paddingVertical: s(5) },
  ingredientText: { fontSize: fs(12), fontWeight: '600' },

  });
