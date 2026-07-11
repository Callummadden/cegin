// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Cegin Contributors
// This file is part of Cegin — https://github.com/Callummadden/cegin
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image as RNImage,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { api } from '../api';
import { MONO, useTheme } from '../theme';
import AppModal from '../components/AppModal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useResponsive } from '../utils/responsive';
import { buildRecipeObject } from '../utils/recipeUtils';
import { parseRecipeText } from '../utils/recipeParser';
import { Ionicons } from '@expo/vector-icons';


export default function ScanRecipeScreen({ navigation }) {
  const { colors } = useTheme();
  const { s, fs } = useResponsive();
  const styles = useMemo(() => makeStyles(colors, s, fs), [colors, s, fs]);
  const insets = useSafeAreaInsets();

  const [imageUri, setImageUri] = useState(null);
  const [rawText, setRawText] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState(null);
  const [parsed, setParsed] = useState(false);

  // Editable fields
  const [title, setTitle] = useState('');
  const [ingredients, setIngredients] = useState('');
  const [instructions, setInstructions] = useState('');
  const [prepTime, setPrepTime] = useState('');
  const [cookTime, setCookTime] = useState('');
  const [servings, setServings] = useState('');
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);
  const [modal, setModal] = useState(null);
  const [cleaning, setCleaning] = useState(false);

  const cleanWithTerry = async () => {
    if (!imageUri) return;
    setCleaning(true);
    try {
      // Compress and resize for faster upload
      const manipulated = await manipulateAsync(imageUri, [{ resize: { width: 1024 } }], { compress: 0.7, format: SaveFormat.JPEG, base64: true });
      const recipe = await api.scanRecipe(manipulated.base64);
      // Fill in the fields with AI results
      if (recipe.title) setTitle(recipe.title);
      if (recipe.ingredients?.length) setIngredients(recipe.ingredients.join('\n'));
      if (recipe.steps?.length) setInstructions(recipe.steps.join('\n'));
      if (recipe.prep_minutes) setPrepTime(String(recipe.prep_minutes));
      if (recipe.cook_minutes) setCookTime(String(recipe.cook_minutes));
      if (recipe.servings) setServings(String(recipe.servings));
      if (recipe.tags?.length) setTags(recipe.tags.join(', '));
      setParsed(true);
    } catch (e) {
      setModal({
        title: 'Terry couldn\'t read it',
        message: e.message || 'Make sure your vision AI is configured in Settings.',
        buttons: [{ text: 'OK', primary: true }],
      });
    } finally {
      setCleaning(false);
    }
  };

  const processImage = async (uri) => {
    setImageUri(uri);
    setScanning(true);
    setScanError(null);
    setParsed(false);

    try {
      const { recognizeText } = require('@infinitered/react-native-mlkit-text-recognition');
      const result = await recognizeText(uri);
      // recognizeText returns { text, blocks } on some versions, or just a string
      const text = typeof result === 'string' ? result : result?.text ?? '';

      if (!text.trim()) {
        setScanError('No text detected. Try a clearer photo or different angle.');
        setRawText('');
        setScanning(false);
        return;
      }

      setRawText(text);

      // Parse the text
      const recipe = parseRecipeText(text);
      setTitle(recipe.title);
      setIngredients(recipe.ingredients.join('\n'));
      setInstructions(recipe.instructions.join('\n'));
      setPrepTime(recipe.prepTime);
      setCookTime(recipe.cookTime);
      setServings(recipe.servings);
      setTags(recipe.tags.join(', '));
      setParsed(true);
    } catch (e) {
      setScanError(`OCR failed: ${e.message}`);
      setRawText('');
    } finally {
      setScanning(false);
    }
  };

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      setModal({
        title: 'Permission needed',
        message: 'Camera permission is required to take a photo of the recipe.',
        buttons: [{ text: 'OK', primary: true }],
      });
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      quality: 0.8,
      allowsEditing: false,
    });

    if (!result.canceled && result.assets?.[0]?.uri) {
      processImage(result.assets[0].uri);
    }
  };

  const pickFromGallery = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setModal({
        title: 'Permission needed',
        message: 'Photo library permission is required to choose an image.',
        buttons: [{ text: 'OK', primary: true }],
      });
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      quality: 0.8,
      allowsEditing: false,
    });

    if (!result.canceled && result.assets?.[0]?.uri) {
      processImage(result.assets[0].uri);
    }
  };

  const buildRecipe = () => buildRecipeObject({
    title,
    ingredients,
    steps: instructions,
    tags,
    prepMinutes: prepTime,
    cookMinutes: cookTime,
    servings,
  });

  const save = async () => {
    if (!title.trim()) {
      setModal({
        title: 'Missing title',
        message: 'Give the recipe a name.',
        buttons: [{ text: 'OK', primary: true }],
      });
      return;
    }

    setSaving(true);
    try {
      await api.createRecipe(buildRecipe());
      navigation.goBack();
    } catch (e) {
      setModal({
        title: 'Error',
        message: e.message,
        buttons: [{ text: 'OK', primary: true }],
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.background }]}
      behavior="padding"
    >
      <AppModal
        visible={!!modal}
        title={modal?.title}
        message={modal?.message}
        buttons={modal?.buttons ?? []}
        colors={colors}
        onClose={() => setModal(null)}
      />

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {/* Header */}
        <View style={[styles.header, { paddingTop: 20 + insets.top }]}>
          <Pressable
            style={[styles.backBtn, { borderColor: colors.border }]}
            onPress={() => navigation.goBack()}
          >
            <Text style={{ fontSize: 17, color: colors.text }}>←</Text>
          </Pressable>
          <Text style={[styles.screenTitle, { color: colors.text }]}>
            SCAN RECIPE
          </Text>
          <Pressable
            style={{ marginLeft: 'auto', padding: 4 }}
            onPress={() => setModal({
              title: 'How it works',
              message: 'TAKE PHOTO — Point your camera at a printed recipe, cookbook page, or recipe from a screen.\n\nGALLERY — Pick an existing photo of a recipe from your gallery.\n\nThe app reads the text from the photo using on-device OCR (no internet needed).\n\nIt tries to extract the title, ingredients, and instructions automatically.\n\nReview and edit the results before saving.',
              buttons: [{ text: 'GOT IT', primary: true }],
            })}
          >
            <Ionicons name="help-circle-outline" size={28} color={colors.textMuted} />
          </Pressable>
        </View>

        {/* Capture buttons */}
        <View style={styles.captureRow}>
          <Pressable
            style={[styles.captureBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}
            onPress={takePhoto}
            disabled={scanning}
          >
            <Text style={[styles.captureIcon]}>📷</Text>
            <Text style={[styles.captureLabel, { fontFamily: MONO, color: colors.text }]}>
              TAKE PHOTO
            </Text>
          </Pressable>
          <Pressable
            style={[styles.captureBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}
            onPress={pickFromGallery}
            disabled={scanning}
          >
            <Text style={[styles.captureIcon]}>🖼️</Text>
            <Text style={[styles.captureLabel, { fontFamily: MONO, color: colors.text }]}>
              GALLERY
            </Text>
          </Pressable>
        </View>

        {/* Loading */}
        {scanning && (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[styles.loadingText, { fontFamily: MONO, color: colors.textMuted }]}>
              RECOGNIZING TEXT…
            </Text>
          </View>
        )}

        {/* Error */}
        {scanError && (
          <Text style={[styles.errorText, { color: colors.danger }]}>{scanError}</Text>
        )}

        {/* Image preview */}
        {imageUri && !scanning && (
          <View style={[styles.imageCard, { borderColor: colors.border }]}>
            <RNImage
              source={{ uri: imageUri }}
              style={styles.imagePreview}
              resizeMode="cover"
            />
          </View>
        )}

        {/* Raw OCR text (collapsed by default) */}
        {rawText.length > 0 && !scanning && (
          <View style={[styles.ocrCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <Text style={[styles.fieldLabel, { fontFamily: MONO, color: colors.textMuted }]}>
              RAW OCR TEXT
            </Text>
            <Text style={[styles.ocrText, { fontFamily: MONO, color: colors.text2 }]}>
              {rawText.length > 600 ? rawText.slice(0, 600) + '…' : rawText}
            </Text>
          </View>
        )}

        {/* Parsed + editable fields */}
        {parsed && !scanning && (
          <>
            <View style={[styles.divider, { borderColor: colors.border }]} />

            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              PARSED RECIPE — EDIT BELOW
            </Text>

            <View style={{ marginBottom: 16 }}>
              <Text style={[styles.fieldLabel, { fontFamily: MONO, color: colors.textMuted }]}>TITLE</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
                value={title}
                onChangeText={setTitle}
                returnKeyType="next"
              />
            </View>

            <View style={styles.rowFields}>
              <View style={{ flex: 1, marginBottom: 16 }}>
                <Text style={[styles.fieldLabel, { fontFamily: MONO, color: colors.textMuted }]}>PREP MIN</Text>
                <TextInput
                  style={[styles.input, { fontFamily: MONO, backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
                  value={prepTime}
                  onChangeText={setPrepTime}
                  keyboardType="number-pad"
                  returnKeyType="next"
                />
              </View>
              <View style={{ flex: 1, marginBottom: 16 }}>
                <Text style={[styles.fieldLabel, { fontFamily: MONO, color: colors.textMuted }]}>COOK MIN</Text>
                <TextInput
                  style={[styles.input, { fontFamily: MONO, backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
                  value={cookTime}
                  onChangeText={setCookTime}
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
              <Text style={[styles.fieldLabel, { fontFamily: MONO, color: colors.textMuted }]}>INSTRUCTIONS · ONE PER LINE</Text>
              <TextInput
                style={[styles.input, styles.tall, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
                value={instructions}
                onChangeText={setInstructions}
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

            {/* Clean with Terry */}
            {imageUri && (
              <View style={{ marginBottom: 16 }}>
                <Pressable
                  style={[styles.saveBtn, { borderColor: colors.primary, backgroundColor: colors.surface, borderWidth: 1.5 }, cleaning && styles.disabled]}
                  onPress={cleanWithTerry}
                  disabled={cleaning}
                >
                  {cleaning ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Text style={[styles.saveBtnText, { color: colors.primary }]}>✨ CLEAN & FIX WITH TERRY</Text>
                  )}
                </Pressable>
                <Text style={[styles.hint, { color: colors.textMuted, textAlign: 'center', marginTop: 8 }]}>
                  Your photo will be shared with your configured vision AI to extract the recipe.
                </Text>
              </View>
            )}

            {/* Save */}
            <Pressable
              style={[styles.saveBtn, { backgroundColor: colors.primary }, saving && styles.disabled]}
              onPress={save}
              disabled={saving}
            >
              <Text style={[styles.saveBtnText, { fontFamily: 'System', color: colors.onPrimary }]}>
                {saving ? 'SAVING…' : 'SAVE RECIPE'}
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
  header: {
    flexDirection: 'row', alignItems: 'center', gap: s(14),
    paddingHorizontal: 0, marginBottom: s(22),
  },
  backBtn: {
    width: s(38), height: s(38), borderRadius: s(20), borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  screenTitle: { fontSize: fs(19), fontWeight: '900', letterSpacing: 0.5 },

  captureRow: {
    flexDirection: 'row', gap: s(12), marginBottom: s(20),
  },
  captureBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: s(20),
    paddingVertical: s(18),
    alignItems: 'center',
    justifyContent: 'center',
    gap: s(6),
  },
  captureIcon: { fontSize: 28 },
  captureLabel: { fontSize: fs(11), letterSpacing: 1 },

  loadingWrap: {
    alignItems: 'center', justifyContent: 'center',
    paddingVertical: s(40), gap: s(14),
  },
  loadingText: { fontSize: fs(12), letterSpacing: 1 },
  errorText: { fontSize: fs(14), marginBottom: s(16) },

  imageCard: {
    borderWidth: 1.5, borderRadius: s(16),
    overflow: 'hidden', marginBottom: s(16),
  },
  imagePreview: {
    width: '100%', height: s(200),
  },

  ocrCard: {
    borderWidth: 1.5, borderRadius: s(16),
    padding: s(14), marginBottom: s(16),
  },
  ocrText: { fontSize: fs(12), lineHeight: fs(18) },

  divider: { borderTopWidth: 1.5, borderStyle: 'dashed', marginVertical: s(20) },
  sectionTitle: { fontSize: fs(14), fontWeight: '900', letterSpacing: 0.5, marginBottom: s(16) },

  fieldLabel: { fontSize: fs(10), letterSpacing: 1, marginBottom: s(8) },
  input: {
    borderWidth: 1.5,
    borderRadius: s(16),
    paddingHorizontal: s(14),
    paddingVertical: s(14),
    fontSize: fs(14),
  },
  tall: { minHeight: s(120), textAlignVertical: 'top' },
  rowFields: { flexDirection: 'row', gap: s(12) },

  saveBtn: {
    marginTop: s(16),
    borderRadius: s(12),
    paddingVertical: s(17),
    alignItems: 'center',
  },
  saveBtnText: { fontSize: fs(15), fontWeight: '900', letterSpacing: 1 },
  disabled: { opacity: 0.6 },
  hint: { fontSize: 12, lineHeight: 18, marginTop: 4 },
});
