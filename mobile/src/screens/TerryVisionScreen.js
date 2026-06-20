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
  const styles = useMemo(() => makeStyles(colors, s, fs), [colors, s, fs]);
  const insets = useSafeAreaInsets();

  const SCAN_KEY = 'terry_vision_scans';

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
            // Verify photos still exist
            const verified = {};
            for (const key in saved) {
              if (saved[key]?.photo) {
                const info = await FileSystem.getInfoAsync(saved[key].photo);
                if (info.exists) verified[key] = { ...saved[key], loading: false, error: null };
              }
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

  // Each section: { photo, ingredients, loading, error }
  const [scans, setScans] = useState({});
  // Terry's combined suggestions
  const [suggestions, setSuggestions] = useState(null); // array of { title, description, ingredients }
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState(null);
  const [savedRecipes, setSavedRecipes] = useState({}); // { [index]: recipeId }
  const [previewRecipe, setPreviewRecipe] = useState(null);

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
      if (scans[key].ingredients) {
        toSave[key] = { photo: scans[key].photo, ingredients: scans[key].ingredients };
      }
    }
    const data = { scans: toSave, suggestions };
    AsyncStorage.setItem(SCAN_KEY, JSON.stringify(data)).catch(() => {});
  }, [scans, suggestions]);

  const allIngredients = useMemo(() => {
    const set = new Set();
    for (const key in scans) {
      if (scans[key].ingredients) {
        scans[key].ingredients.forEach((i) => set.add(i));
      }
    }
    return [...set];
  }, [scans]);

  const scannedCount = useMemo(() =>
    Object.values(scans).filter((s) => s.ingredients?.length > 0).length,
    [scans]
  );

  const captureAndScan = async (sectionKey, fromGallery = false) => {
    try {
      const launcher = fromGallery
        ? ImagePicker.launchImageLibraryAsync
        : ImagePicker.launchCameraAsync;

      const result = await launcher({ quality: 0.5, base64: false });
      if (result.canceled || !result.assets?.[0]) return;

      setScans((prev) => ({
        ...prev,
        [sectionKey]: { photo: result.assets[0].uri, loading: true, error: null, ingredients: null },
      }));

      // Compress and resize
      const compressed = await manipulateAsync(
        result.assets[0].uri,
        [{ resize: { width: 1024 } }],
        { compress: 0.6, format: SaveFormat.JPEG }
      );

      // Save photo permanently
      const savedUri = await savePhoto(compressed.uri, sectionKey);

      setScans((prev) => ({
        ...prev,
        [sectionKey]: { ...prev[sectionKey], photo: savedUri },
      }));

      const base64 = await FileSystem.readAsStringAsync(compressed.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const { ingredients } = await api.scanFridge(base64);

      if (!ingredients.length) {
        setScans((prev) => ({
          ...prev,
          [sectionKey]: { ...prev[sectionKey], loading: false, error: 'Couldn\'t identify any items. Try a clearer photo.' },
        }));
        return;
      }

      setScans((prev) => ({
        ...prev,
        [sectionKey]: { ...prev[sectionKey], ingredients, loading: false },
      }));

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
      setScans((prev) => ({
        ...prev,
        [sectionKey]: { ...prev[sectionKey], loading: false, error: e.message },
      }));
    }
  };

  const clearScan = (sectionKey) => {
    setScans((prev) => {
      const next = { ...prev };
      delete next[sectionKey];
      return next;
    });
    setSuggestions(null);
    setSavedRecipes({});
  };

  const askTerry = async () => {
    if (!allIngredients.length) return;
    setSuggesting(true);
    setSuggestError(null);
    setSuggestions(null);

    try {
      // Build context about where items came from
      const locationParts = [];
      for (const key in scans) {
        if (scans[key].ingredients?.length) {
          const section = SECTIONS.find((s) => s.key === key);
          locationParts.push(`${section.label}: ${scans[key].ingredients.join(', ')}`);
        }
      }

      const prompt = `I scanned my kitchen and found these ingredients:\n\n${locationParts.join('\n')}\n\nCombined: ${allIngredients.join(', ')}.\n\nWhat can I make? Suggest 2-3 practical recipes using what I have. Return ONLY a JSON object: { "recipes": [{ "title": "...", "description": "...", "ingredients": ["...", "..."], "steps": ["step 1", "step 2"], "difficulty": "easy|medium|hard", "prep_minutes": 10, "cook_minutes": 20 }] }. Keep descriptions under 30 words. List only the key ingredients used. Steps should be brief (under 15 words each). Don't suggest recipes needing major ingredients I don't have.`;

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
        setSuggestions(parsed.recipes);
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
    // If already saved, navigate to detail
    if (savedRecipes[index]) {
      navigation.navigate('RecipeDetail', { id: savedRecipes[index] });
      return;
    }
    // Show preview popup
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
    const scan = scans[section.key];

    return (
      <View key={section.key} style={[styles.section, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionIcon}>{section.icon}</Text>
          <View style={{ flex: 1 }}>
            <Text style={[styles.sectionLabel, { fontFamily: MONO, color: colors.primary }]}>{section.label}</Text>
            <Text style={[styles.sectionDesc, { color: colors.textMuted }]}>{section.desc}</Text>
          </View>
          {scan?.ingredients && (
            <View style={[styles.countBadge, { backgroundColor: colors.primary }]}>
              <Text style={styles.countBadgeText}>{scan.ingredients.length}</Text>
            </View>
          )}
        </View>

        {/* Photo / capture area */}
        {scan?.photo ? (
          <View style={styles.photoWrap}>
            <Image source={{ uri: scan.photo }} style={styles.photo} contentFit="cover" />
            <Pressable style={styles.retakeBtn} onPress={() => clearScan(section.key)}>
              <Text style={styles.retakeBtnText}>✕</Text>
            </Pressable>
          </View>
        ) : (
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

        {scan?.loading && (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.textMuted }]}>Scanning...</Text>
          </View>
        )}

        {scan?.error && (
          <Text style={[styles.errorText, { color: colors.danger }]}>{scan.error}</Text>
        )}

        {scan?.ingredients && (
          <View style={styles.ingredientChips}>
            {scan.ingredients.map((ing, i) => (
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

  // Photo
  photoWrap: { borderRadius: s(14), overflow: 'hidden', position: 'relative' },
  photo: { width: '100%', height: s(160), borderRadius: s(14) },
  retakeBtn: { position: 'absolute', top: s(10), right: s(10), width: s(28), height: s(28), borderRadius: s(14), backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  retakeBtnText: { color: '#fff', fontSize: fs(14), fontWeight: '700' },

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