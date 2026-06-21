// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Cegin Contributors
// This file is part of Cegin — https://github.com/Callummadden/cegin
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { api } from '../api';
import { invalidateRecipeAudits, invalidateRecipeNutrition, invalidateRecipePrep } from '../auditCache';
import { MONO, useTheme } from '../theme';
import AppModal from '../components/AppModal';
import AiDisclaimer from '../components/AiDisclaimer';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAi } from '../aiContext';
import { useResponsive } from '../utils/responsive';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';


export default function EditRecipeScreen({ route, navigation }) {
  const { colors } = useTheme();
  const { s, fs } = useResponsive();
  const { noAI } = useAi();
  const styles = useMemo(() => makeStyles(colors, s, fs), [colors, s, fs]);
  const insets = useSafeAreaInsets();



  const existing = route.params?.recipe;
  const source = existing ?? route.params?.draft;
  const mode = route.params?.mode; // 'url' | 'manual' | undefined
  const fromAudit = route.params?.fromAudit;
  const originalRecipe = route.params?.originalRecipe;

  // Compute changed fields and specific changed lines
  const { changedFields, changedIngredients, changedSteps } = useMemo(() => {
    if (!fromAudit || !originalRecipe || !source) return { changedFields: new Set(), changedIngredients: [], changedSteps: [] };
    const changes = new Set();
    const origIng = originalRecipe.ingredients || [];
    const newIng = source.ingredients || [];
    const origSteps = originalRecipe.steps || [];
    const newSteps = source.steps || [];

    // Find lines that are new or modified
    const origIngSet = new Set(origIng.map(s => s.toLowerCase().trim()));
    const changedIng = newIng.filter(s => !origIngSet.has(s.toLowerCase().trim()));
    const origStepSet = new Set(origSteps.map(s => s.toLowerCase().trim()));
    const changedStp = newSteps.filter(s => !origStepSet.has(s.toLowerCase().trim()));

    if (changedIng.length > 0) changes.add('ingredients');
    if (changedStp.length > 0) changes.add('steps');
    if (source.title !== originalRecipe.title) changes.add('title');
    if (source.description !== originalRecipe.description) changes.add('description');

    return { changedFields: changes, changedIngredients: changedIng, changedSteps: changedStp };
  }, [fromAudit, originalRecipe, source]);
  const isUrlMode = mode === 'url' && !source;
  const [title, setTitle] = useState(source?.title ?? '');
  const [description, setDescription] = useState(source?.description ?? '');
  const [ingredients, setIngredients] = useState(source?.ingredients?.join('\n') ?? '');
  const [steps, setSteps] = useState(source?.steps?.join('\n') ?? '');
  const [tags, setTags] = useState(source?.tags?.join(', ') ?? '');
  const [prepMinutes, setPrepMinutes] = useState(String(source?.prep_minutes ?? ''));
  const [cookMinutes, setCookMinutes] = useState(String(source?.cook_minutes ?? ''));
  const [servings, setServings] = useState(String(source?.servings ?? ''));
  const [editedFields, setEditedFields] = useState(new Set());
  const [imageUrl, setImageUrl] = useState(source?.image_url ?? '');
  const [notes, setNotes] = useState(source?.notes ?? '');
  const [collection, setCollection] = useState(source?.collection ?? '');
  const [saving, setSaving] = useState(false);
  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState(null);

  const [cleaning, setCleaning] = useState(false);
  const [hasImported, setHasImported] = useState(false);
  const [cleanError, setCleanError] = useState(null);
  const [modal, setModal] = useState(null);

  const fillFrom = (r) => {
    setTitle(r.title ?? '');
    setDescription(r.description ?? '');
    setIngredients((r.ingredients ?? []).join('\n'));
    setSteps((r.steps ?? []).join('\n'));
    setTags((r.tags ?? []).join(', '));
    setPrepMinutes(String(r.prep_minutes ?? ''));
    setCookMinutes(String(r.cook_minutes ?? ''));
    setServings(String(r.servings ?? ''));
    setImageUrl(r.image_url ?? '');
    setNotes(r.notes ?? '');
    setCollection(r.collection ?? '');
  };

  const importFromUrl = async () => {
    const trimmed = importUrl.trim();
    if (!trimmed) { setImportError('Paste a recipe page URL first.'); return; }
    setImporting(true);
    setImportError(null);
    try {
      const { recipe } = await api.importRecipe(trimmed);
      fillFrom(recipe);
      setHasImported(true);
    } catch (e) {
      setImportError(e.message);
    } finally {
      setImporting(false);
    }
  };

  const splitLines = (text) => text.split('\n').map((l) => l.trim()).filter(Boolean);

  const buildRecipe = () => ({
    title: title.trim(),
    description: description.trim(),
    ingredients: splitLines(ingredients),
    steps: splitLines(steps),
    tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
    prep_minutes: parseInt(prepMinutes, 10) || 0,
    cook_minutes: parseInt(cookMinutes, 10) || 0,
    servings: parseInt(servings, 10) || 1,
    image_url: imageUrl.trim(),
    notes: notes.trim(),
    collection: collection.trim(),
  });

  const [wasTidied, setWasTidied] = useState(false);

  const cleanUp = async () => {
    const current = buildRecipe();
    if (!current.title && !current.ingredients.length && !current.steps.length) {
      setCleanError('Add some recipe details first.');
      return;
    }
    const savedImageUrl = current.image_url;
    setCleaning(true);
    setCleanError(null);
    try {
      const { recipe } = await api.tidyRecipe(current);
      fillFrom(recipe);
      if (savedImageUrl) setImageUrl(savedImageUrl);
      setWasTidied(true);
    } catch (e) {
      setCleanError(e.message);
    } finally {
      setCleaning(false);
    }
  };

  const save = async () => {
    if (!title.trim()) { setModal({ title: 'Missing title', message: 'Give the recipe a name.', buttons: [{ text: 'OK', primary: true }] }); return; }
    const recipe = buildRecipe();
    setSaving(true);
    try {
      if (existing) {
        await api.updateRecipe(existing.id, recipe);
        invalidateRecipeAudits(existing.id);
        invalidateRecipeNutrition(existing.id);
        invalidateRecipePrep(existing.id);
      } else {
        await api.createRecipe(recipe);
      }
      const fromVision = route.params?.fromVision;
      if (fromVision !== undefined) {
        navigation.navigate('TerryVision', { savedIndex: fromVision });
      } else {
        navigation.goBack();
      }
    } catch (e) {
      setModal({ title: 'Error', message: e.message, buttons: [{ text: 'OK', primary: true }] });
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.background }]}
      behavior="padding"
    >
      <AppModal visible={!!modal} title={modal?.title} message={modal?.message} buttons={modal?.buttons ?? []} colors={colors} onClose={() => setModal(null)} />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {/* Header */}
        <View style={[styles.header, { paddingTop: 20 + insets.top }]}>
          <Pressable
            style={[styles.backBtn, { borderColor: colors.border }]}
            onPress={() => navigation.goBack()}
          >
            <Text style={{ fontSize: 17, color: colors.text }}>←</Text>
          </Pressable>
          <Text style={[styles.screenTitle, { color: colors.text }]}>
            {existing ? 'EDIT RECIPE' : 'NEW RECIPE'}
          </Text>
          <Pressable
            style={{ marginLeft: 'auto', padding: 4 }}
            onPress={() => setModal({
              title: 'How it works',
              message: 'TITLE — Give your recipe a name.\n\nPHOTO — Take a photo or pick from gallery.\n\nPREP/COOK TIME — How long it takes (in minutes).\n\nSERVINGS — How many people it feeds.\n\nINGREDIENTS — One per line (e.g. "2 cups flour").\n\nINSTRUCTIONS — One step per line.\n\nTIMERS — Write times in your instructions (e.g. "Bake for 30 minutes" or "Simmer for 1 hour"). When you cook the recipe, these become tappable countdown timers with alerts.\n\nTAGS — Comma-separated (e.g. "dinner, quick, veggie").\n\nNOTES — Personal tweaks or reminders.',
              buttons: [{ text: 'GOT IT', primary: true }],
            })}
          >
            <Ionicons name="help-circle-outline" size={28} color={colors.textMuted} />
          </Pressable>
        </View>

        {/* URL Import — only in URL mode */}
        {isUrlMode && (
          <View style={[styles.importSection, { marginBottom: s(20) }]}>
            <Text style={[styles.fieldLabel, { fontFamily: MONO, color: colors.textMuted }]}>IMPORT FROM URL</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
              value={importUrl}
              onChangeText={setImportUrl}
              placeholder="Paste a recipe page URL..."
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="go"
              onSubmitEditing={importFromUrl}
            />
            <Pressable
              style={[styles.importBtn, { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1.5 }, importing && styles.disabled]}
              onPress={importFromUrl}
              disabled={importing}
            >
              {importing ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Text style={[styles.importBtnText, { fontFamily: MONO, color: colors.text }]}>🔗 IMPORT</Text>
              )}
            </Pressable>
            {importError && <Text style={[styles.errorText, { color: colors.danger }]}>{importError}</Text>}
          </View>
        )}

        {/* Form fields — always visible except URL mode before import */}
        {(!isUrlMode || hasImported) && (
        <>
        {isUrlMode && hasImported && (
          <View style={[styles.divider, { borderColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { fontFamily: MONO, color: colors.textMuted }]}>MAKE EDITS</Text>
          </View>
        )}
        <View style={{ marginBottom: 16 }}>
          <Text style={[styles.fieldLabel, { fontFamily: MONO, color: colors.textMuted }]}>TITLE</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
            value={title}
            onChangeText={setTitle}
            returnKeyType="next"
          />
        </View>

        <View style={{ marginBottom: 16 }}>
          <Text style={[styles.fieldLabel, { fontFamily: MONO, color: colors.textMuted }]}>DESCRIPTION</Text>
          <TextInput
            style={[styles.input, styles.multiline, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
            value={description}
            onChangeText={setDescription}
            multiline
            returnKeyType="next"
          />
        </View>

        <View style={{ marginBottom: 16 }}>
          <Text style={[styles.fieldLabel, { fontFamily: MONO, color: colors.textMuted }]}>PHOTO</Text>
          {imageUrl ? (
            <View style={{ marginBottom: 8 }}>
              <Image source={{ uri: imageUrl }} style={{ width: '100%', height: 200, borderRadius: 16 }} contentFit="cover" />
              <Pressable
                style={[styles.importBtn, { backgroundColor: colors.danger, marginTop: 8 }]}
                onPress={() => setImageUrl('')}
              >
                <Text style={[styles.importBtnText, { fontFamily: MONO, color: '#fff' }]}>REMOVE</Text>
              </Pressable>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable
                style={[styles.importBtn, { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1.5, flex: 1 }]}
                onPress={async () => {
                  const { status } = await ImagePicker.requestCameraPermissionsAsync();
                  if (status !== 'granted') return;
                  const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
                  if (!result.canceled && result.assets[0]) setImageUrl(result.assets[0].uri);
                }}
              >
                <Text style={[styles.importBtnText, { fontFamily: MONO, color: colors.text }]}>CAMERA</Text>
              </Pressable>
              <Pressable
                style={[styles.importBtn, { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1.5, flex: 1 }]}
                onPress={async () => {
                  const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.8 });
                  if (!result.canceled && result.assets[0]) setImageUrl(result.assets[0].uri);
                }}
              >
                <Text style={[styles.importBtnText, { fontFamily: MONO, color: colors.text }]}>GALLERY</Text>
              </Pressable>
            </View>
          )}
        </View>

        <View style={{ marginBottom: 16 }}>
          <Text style={[styles.fieldLabel, { fontFamily: MONO, color: colors.textMuted }]}>NOTES · PERSONAL TWEAKS</Text>
          <TextInput
            style={[styles.input, styles.tall, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
            value={notes}
            onChangeText={setNotes}
            placeholder="e.g. use less salt next time, kids loved this"
            placeholderTextColor={colors.textMuted}
            multiline
            returnKeyType="done"
            blurOnSubmit
            onSubmitEditing={() => {}}
          />
        </View>

        {fromAudit && changedFields.size > 0 && (
          <View style={{ backgroundColor: '#D32F2F15', borderRadius: 12, borderWidth: 1.5, borderColor: '#D32F2F40', padding: 12, marginBottom: 16 }}>
            <Text style={{ fontSize: 12, fontWeight: '700', color: '#D32F2F', letterSpacing: 0.5 }}>
              ✏️ TERRY CHANGED: {[...changedFields].map(f => f.toUpperCase()).join(', ')}
            </Text>
            <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 4 }}>Highlighted fields have been modified — review and save</Text>
          </View>
        )}

        <View style={{ marginBottom: 16 }}>
          <Text style={[styles.fieldLabel, { fontFamily: MONO, color: colors.textMuted }]}>INGREDIENTS · ONE PER LINE</Text>
          {changedIngredients.length > 0 && (
            <View style={{ marginBottom: 8, backgroundColor: '#D32F2F10', borderRadius: 8, padding: 10, borderWidth: 1, borderColor: '#D32F2F30' }}>
              <Text style={{ fontSize: 10, fontWeight: '700', color: '#D32F2F', letterSpacing: 0.5, marginBottom: 4 }}>TERRY ADDED:</Text>
              {changedIngredients.map((ing, i) => (
                <Text key={i} style={{ fontSize: 13, fontWeight: '700', color: '#D32F2F', lineHeight: 20 }}>• {ing}</Text>
              ))}
            </View>
          )}
          <TextInput
            style={[styles.input, styles.tall, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
            value={ingredients}
            onChangeText={setIngredients}
            multiline
            returnKeyType="next"
          />
        </View>

        <View style={{ marginBottom: 16 }}>
          <Text style={[styles.fieldLabel, { fontFamily: MONO, color: colors.textMuted }]}>STEPS · ONE PER LINE</Text>
          {changedSteps.length > 0 && (
            <View style={{ marginBottom: 8, backgroundColor: '#D32F2F10', borderRadius: 8, padding: 10, borderWidth: 1, borderColor: '#D32F2F30' }}>
              <Text style={{ fontSize: 10, fontWeight: '700', color: '#D32F2F', letterSpacing: 0.5, marginBottom: 4 }}>TERRY ADDED:</Text>
              {changedSteps.map((step, i) => (
                <Text key={i} style={{ fontSize: 13, fontWeight: '700', color: '#D32F2F', lineHeight: 20 }}>• {step}</Text>
              ))}
            </View>
          )}
          <TextInput
            style={[styles.input, styles.tall, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
            value={steps}
            onChangeText={setSteps}
            multiline
            returnKeyType="next"
          />
        </View>

        <View style={{ marginBottom: 16 }}>
          <Text style={[styles.fieldLabel, { fontFamily: MONO, color: colors.textMuted }]}>TAGS · COMMA SEPARATED</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
            value={tags}
            onChangeText={setTags}
            placeholder="pasta, italian"
            placeholderTextColor={colors.textMuted}
            returnKeyType="next"
          />
        </View>

        <View style={{ marginBottom: 16 }}>
          <Text style={[styles.fieldLabel, { fontFamily: MONO, color: colors.textMuted }]}>COLLECTION / CATEGORY</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
            value={collection}
            onChangeText={setCollection}
            placeholder="e.g. Weeknight Dinners, Desserts"
            placeholderTextColor={colors.textMuted}
            returnKeyType="next"
          />
          <Text style={[styles.hint, { color: colors.textMuted }]}>
            Group this recipe into a category for easy filtering.
          </Text>
        </View>

        <View style={styles.rowFields}>
          <View style={{ flex: 1, marginBottom: 16 }}>
            <Text style={[styles.fieldLabel, { fontFamily: MONO, color: colors.textMuted }]}>PREP MIN</Text>
            <TextInput
              style={[styles.input, { fontFamily: MONO, backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
              value={prepMinutes}
              onChangeText={setPrepMinutes}
              keyboardType="number-pad"
              returnKeyType="next"
            />
          </View>
          <View style={{ flex: 1, marginBottom: 16 }}>
            <Text style={[styles.fieldLabel, { fontFamily: MONO, color: colors.textMuted }]}>COOK MIN</Text>
            <TextInput
              style={[styles.input, { fontFamily: MONO, backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
              value={cookMinutes}
              onChangeText={setCookMinutes}
              keyboardType="number-pad"
              returnKeyType="next"
            />
          </View>
          <View style={{ flex: 1, marginBottom: 16 }}>
            <Text style={[styles.fieldLabel, { fontFamily: MONO, color: colors.textMuted }]}>SERVES</Text>
            <TextInput
              style={[styles.input, { fontFamily: MONO, backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
              value={servings}
              onChangeText={setServings}
              keyboardType="number-pad"
              returnKeyType="next"
            />
          </View>
        </View>

        {/* AI clean up */}
        {!noAI && (
        <>
        <Pressable
              style={[styles.cleanBtn, { borderColor: colors.primary, backgroundColor: colors.surface }, cleaning && styles.disabled]}
              onPress={cleanUp}
              disabled={cleaning}
            >
              {cleaning ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Text style={[styles.cleanBtnText, { color: colors.primary }]}>✨ CLEAN UP WITH TERRY</Text>
              )}
            </Pressable>
            <Text style={[styles.hint, { color: colors.textMuted }]}>
              Tidies formatting, splits steps and removes junk tags — without changing the recipe.
            </Text>
            {cleanError && <Text style={[styles.errorText, { color: colors.danger }]}>{cleanError}</Text>}
        {wasTidied && <AiDisclaimer style={{ marginTop: 8 }} />}
        </>
        )}

        {/* Save */}
        <Pressable
          style={[styles.saveBtn, { backgroundColor: colors.primary }, saving && styles.disabled]}
          onPress={save}
          disabled={saving}
        >
          <Text style={[styles.saveBtnText, { fontFamily: 'System', color: colors.onPrimary }]}>
            {saving ? 'SAVING…' : existing ? 'SAVE CHANGES' : 'SAVE RECIPE'}
          </Text>
        </Pressable>
        </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (colors, s, fs) => StyleSheet.create({

  root: { flex: 1 },
  content: { padding: s(20), paddingBottom: s(48) },
  header: { flexDirection: 'row', alignItems: 'center', gap: s(14), paddingHorizontal: 0, marginBottom: s(22) },
  backBtn: {
    width: s(38), height: s(38), borderRadius: s(20), borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  screenTitle: { fontSize: fs(19), fontWeight: '900', letterSpacing: 0.5 },
  importSection: { marginBottom: s(4) },
  divider: { borderTopWidth: 1.5, borderStyle: 'dashed', marginVertical: s(20) },
  fieldWrap: { marginBottom: s(16) },
  fieldLabel: { fontSize: fs(10), letterSpacing: 1, marginBottom: s(8) },
  input: {
    borderWidth: 1.5,
    borderRadius: s(16),
    paddingHorizontal: s(14),
    paddingVertical: s(14),
    fontSize: fs(14),
  },
  multiline: { minHeight: s(60), textAlignVertical: 'top' },
  tall: { minHeight: s(120), textAlignVertical: 'top' },
  rowFields: { flexDirection: 'row', gap: s(12) },
  importBtn: {
    marginTop: s(10),
    borderRadius: s(10),
    paddingVertical: s(15),
    alignItems: 'center',
  },
  importBtnText: { fontSize: fs(13), letterSpacing: 1 },
  hint: { fontSize: fs(12.5), lineHeight: fs(19), marginTop: s(8) },
  errorText: { fontSize: fs(14), marginTop: s(8) },
  cleanBtn: {
    marginTop: s(28),
    borderWidth: 1.5,
    borderRadius: s(12),
    paddingVertical: s(13),
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: s(48),
  },
  cleanBtnText: { fontSize: fs(15), fontWeight: '700' },
  saveBtn: {
    marginTop: s(16),
    borderRadius: s(12),
    paddingVertical: s(17),
    alignItems: 'center',
  },
  saveBtnText: { fontSize: fs(15), fontWeight: '900', letterSpacing: 1 },
  disabled: { opacity: 0.6 },

  });