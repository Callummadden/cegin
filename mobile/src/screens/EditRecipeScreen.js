import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { api } from '../api';
import { MONO, useTheme } from '../theme';
import AppModal from '../components/AppModal';
import AiDisclaimer from '../components/AiDisclaimer';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAi } from '../aiContext';


export default function EditRecipeScreen({ route, navigation }) {
  const { colors } = useTheme();
  const { noAI } = useAi();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();



  const existing = route.params?.recipe;
  const source = existing ?? route.params?.draft;
  const [title, setTitle] = useState(source?.title ?? '');
  const [description, setDescription] = useState(source?.description ?? '');
  const [ingredients, setIngredients] = useState(source?.ingredients?.join('\n') ?? '');
  const [steps, setSteps] = useState(source?.steps?.join('\n') ?? '');
  const [tags, setTags] = useState(source?.tags?.join(', ') ?? '');
  const [prepMinutes, setPrepMinutes] = useState(String(source?.prep_minutes ?? ''));
  const [cookMinutes, setCookMinutes] = useState(String(source?.cook_minutes ?? ''));
  const [servings, setServings] = useState(String(source?.servings ?? ''));
  const [imageUrl, setImageUrl] = useState(source?.image_url ?? '');
  const [notes, setNotes] = useState(source?.notes ?? '');
  const [collection, setCollection] = useState(source?.collection ?? '');
  const [saving, setSaving] = useState(false);

  const showImport = !source;
  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState(null);

  const [cleaning, setCleaning] = useState(false);
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
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
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
        </View>

        {/* Import section */}
        {showImport && !noAI && (
          <View style={styles.importSection}>
            <Text style={[styles.fieldLabel, { fontFamily: MONO, color: colors.textMuted }]}>
              IMPORT FROM A RECIPE URL
            </Text>
            <TextInput
              style={[styles.input, { fontFamily: MONO, fontSize: 13, backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
              value={importUrl}
              onChangeText={setImportUrl}
              placeholder="https://example.com/best-lasagna"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <Pressable
              style={[styles.importBtn, { backgroundColor: colors.primary }, importing && styles.disabled]}
              onPress={importFromUrl}
              disabled={importing}
            >
              {importing ? (
                <ActivityIndicator size="small" color={colors.onPrimary} />
              ) : (
                <Text style={[styles.importBtnText, { fontFamily: MONO, color: colors.onPrimary }]}>
                  IMPORT & FILL IN
                </Text>
              )}
            </Pressable>
            {importError && <Text style={[styles.errorText, { color: colors.danger }]}>{importError}</Text>}
            <Text style={[styles.hint, { color: colors.textMuted }]}>
              Pulls the title, ingredients and steps from the page so you can review and save.
            </Text>
            <View style={[styles.divider, { borderColor: colors.border }]} />
          </View>
        )}

        {/* Form fields */}
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
          <Text style={[styles.fieldLabel, { fontFamily: MONO, color: colors.textMuted }]}>IMAGE URL</Text>
          <TextInput
            style={[styles.input, { fontFamily: MONO, fontSize: 13, backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
            value={imageUrl}
            onChangeText={setImageUrl}
            placeholder="https://example.com/photo.jpg"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="next"
          />
          <Text style={[styles.hint, { color: colors.textMuted }]}>
            Paste a direct link to a photo. Filled automatically when importing from a URL.
          </Text>
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

        <View style={{ marginBottom: 16 }}>
          <Text style={[styles.fieldLabel, { fontFamily: MONO, color: colors.textMuted }]}>INGREDIENTS · ONE PER LINE</Text>
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
                <Text style={[styles.cleanBtnText, { color: colors.primary }]}>✨ CLEAN UP WITH AI</Text>
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
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 20, paddingBottom: 48 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 0, marginBottom: 22 },
  backBtn: {
    width: 38, height: 38, borderRadius: 10, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  screenTitle: { fontSize: 19, fontWeight: '900', letterSpacing: 0.5 },
  importSection: { marginBottom: 4 },
  divider: { borderTopWidth: 1.5, borderStyle: 'dashed', marginVertical: 20 },
  fieldWrap: { marginBottom: 16 },
  fieldLabel: { fontSize: 10, letterSpacing: 1, marginBottom: 8 },
  input: {
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 14,
  },
  multiline: { minHeight: 60, textAlignVertical: 'top' },
  tall: { minHeight: 120, textAlignVertical: 'top' },
  rowFields: { flexDirection: 'row', gap: 12 },
  importBtn: {
    marginTop: 10,
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
  },
  importBtnText: { fontSize: 13, letterSpacing: 1 },
  hint: { fontSize: 12.5, lineHeight: 19, marginTop: 8 },
  errorText: { fontSize: 14, marginTop: 8 },
  cleanBtn: {
    marginTop: 28,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  cleanBtnText: { fontSize: 15, fontWeight: '700' },
  saveBtn: {
    marginTop: 16,
    borderRadius: 12,
    paddingVertical: 17,
    alignItems: 'center',
  },
  saveBtnText: { fontSize: 15, fontWeight: '900', letterSpacing: 1 },
  disabled: { opacity: 0.6 },
});
