// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Cegin Contributors
// This file is part of Cegin — https://github.com/Callummadden/cegin
import { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MONO, useTheme, THEME_LIST, OLED_ACCENTS, M3_SEEDS } from '../theme';
import { setServerUrl, setCustomAIConfig, fetchAvailableModels } from '../config';
import { useAi } from '../aiContext';
import { addDietaryProfile, getDietaryProfiles, removeDietaryProfile } from '../dietProfiles';
import { getPermissionStatus, requestPermissionAndGetStatus, getPushToken } from '../notifications';
import * as ImagePicker from 'expo-image-picker';
import { api } from '../api';
import { useResponsive } from '../utils/responsive';

const { width: SCREEN_W } = Dimensions.get('window');

// Each theme's actual primary colour for preview swatches
const THEME_PREVIEWS = {
  'material-you': null, // dynamic — rendered as a special icon
  'open-flame': '#FF5A26',
  'ocean': '#4FC3F7',
  'forest': '#81C784',
  'berry': '#CE93D8',
  'midnight': '#7986CB',
  'sakura': '#F48FB1',
  'oled': '#000000',
};

const FEATURES = [
  { icon: '📖', title: 'YOUR RECIPES', desc: 'Import from any URL, scan photos, or type them in. Everything stored right here.' },
  { icon: '📅', title: 'MEAL PLANNING', desc: 'Plan your week with drag-and-drop. Let AI fill it in or do it yourself.' },
  { icon: '🛒', title: 'SHOPPING LIST', desc: 'Auto-generated from your meal plan. Smart categories, cross off as you go.' },
  { icon: '🐱', title: 'MEET TERRY', desc: 'Your AI kitchen assistant. Ask questions, scan your fridge, fix mistakes mid-cook.' },
];

export default function SetupScreen({ route, navigation }) {
  const { colors, palette, setPalette, mode, setMode, scheme, oledAccent, setOledAccent, materialYouSeed, setMaterialYouSeed } = useTheme();
  const { setNoAI } = useAi();
  const { s, fs } = useResponsive();
  const styles = useMemo(() => makeStyles(colors, s, fs), [colors, s, fs]);
  const insets = useSafeAreaInsets();
  const switching = route.params?.switching;

  // Wizard state — skip welcome/features when switching modes from Settings
  const [step, setStep] = useState(switching ? 'mode' : 'welcome'); // welcome | features | mode | ai | theme | ready
  const slideAnim = useRef(new Animated.Value(0)).current;

  // Feature carousel
  const [featureIdx, setFeatureIdx] = useState(0);
  const featureScrollRef = useRef(null);

  // Mode & AI
  const [serverUrlInput, setServerUrlInput] = useState('');
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [textProvider, setTextProvider] = useState({
    type: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    model: 'deepseek-chat',
  });
  const [visionProvider, setVisionProvider] = useState({
    type: 'gemini',
    apiKey: '',
    model: 'gemini-2.5-flash',
  });

  // Diet profiles
  const [profiles, setProfiles] = useState([]);
  const [dietName, setDietName] = useState('');
  const [dietNeeds, setDietNeeds] = useState('');
  const [dietNotes, setDietNotes] = useState('');

  // Model discovery
  const [textModels, setTextModels] = useState([]);
  const [visionModels, setVisionModels] = useState([]);
  const [discoveringText, setDiscoveringText] = useState(false);
  const [discoveringVision, setDiscoveringVision] = useState(false);

  // Permissions
  const [notifStatus, setNotifStatus] = useState('undetermined');
  const [cameraStatus, setCameraStatus] = useState('undetermined');

  // ── Navigation helpers ─────────────────────────────────────────────────
  const goNext = (next) => {
    Animated.timing(slideAnim, { toValue: -SCREEN_W * 0.15, duration: 120, useNativeDriver: true }).start(() => {
      setStep(next);
      slideAnim.setValue(SCREEN_W * 0.15);
      Animated.spring(slideAnim, { toValue: 0, speed: 20, bounciness: 0, useNativeDriver: true }).start();
    });
  };

  const finish = async () => {
    await AsyncStorage.setItem('setup_complete', 'true');
    navigation.reset({ index: 0, routes: [{ name: 'RecipeList' }] });
  };

  // ── Mode handlers ──────────────────────────────────────────────────────
  const handleNoAI = async () => {
    setNoAI(true);
    await AsyncStorage.setItem('app_mode', 'local');
    goNext('permissions');
  };

  const handleLocalPick = () => { setNoAI(false); goNext('ai'); };

  const handleLocalSave = async () => {
    setSaving(true);
    try {
      await setCustomAIConfig({
        text: textProvider.apiKey ? textProvider : null,
        vision: visionProvider.apiKey ? visionProvider : null,
      });
      await AsyncStorage.setItem('app_mode', 'local');
      goNext('diet');
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const discoverModels = async (type) => {
    const provider = type === 'text' ? textProvider : visionProvider;
    const setDiscovering = type === 'text' ? setDiscoveringText : setDiscoveringVision;
    const setModels = type === 'text' ? setTextModels : setVisionModels;

    setDiscovering(true);
    try {
      const models = await fetchAvailableModels(provider.baseUrl, provider.apiKey);
      setModels(models);
    } catch {
      setModels([]);
    } finally {
      setDiscovering(false);
    }
  };

  const handleServerPick = () => {
    setNoAI(false);
    setStep('server');
  };

  const handleServerSave = async () => {
    const url = serverUrlInput.trim().replace(/\/+$/, '');
    if (!url) { setError('Enter a server URL.'); return; }
    setError('');
    setTesting(true);
    try {
      await setServerUrl(url);
      const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      await AsyncStorage.setItem('app_mode', 'server');

      // Check if server already has data — skip setup if so
      try {
        const recipesRes = await fetch(`${url}/api/recipes`, { signal: AbortSignal.timeout(5000) });
        if (recipesRes.ok) {
          const recipes = await recipesRes.json();
          if (Array.isArray(recipes) && recipes.length > 0) {
            // Server has existing data — skip setup, go straight to app
            finish();
            return;
          }
        }
      } catch {
        // Can't check recipes — continue with setup
      }

      goNext('diet');
    } catch (e) {
      setError(`Could not connect: ${e.message}`);
    } finally {
      setTesting(false);
    }
  };

  // ── Step: Welcome ──────────────────────────────────────────────────────
  if (step === 'welcome') {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.welcomeCenter}>
          <Text style={styles.welcomeEmoji}>🐱</Text>
          <Text style={styles.welcomeTitle}>CEGIN</Text>
          <Text style={[styles.welcomeTagline, { fontFamily: MONO, color: colors.textMuted }]}>
            your kitchen, organised
          </Text>
        </View>
        <View style={[styles.welcomeBottom, { paddingBottom: insets.bottom + 24 }]}>
          <Pressable style={[styles.primaryBtn, { backgroundColor: colors.primary }]} onPress={() => goNext('features')}>
            <Text style={[styles.primaryBtnText, { color: colors.onPrimary }]}>GET STARTED</Text>
          </Pressable>
          <Pressable onPress={() => { setNoAI(true); AsyncStorage.setItem('app_mode', 'local'); finish(); }} style={styles.skipBtn}>
            <Text style={[styles.skipText, { fontFamily: MONO, color: colors.textMuted }]}>SKIP SETUP</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ── Step: Features ─────────────────────────────────────────────────────
  if (step === 'features') {
    return (
      <View style={[styles.root, { paddingTop: insets.top + 20 }]}>
        <View style={styles.featuresTop}>
          <ScrollView
            ref={featureScrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) => {
              const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W);
              setFeatureIdx(idx);
            }}
          >
            {FEATURES.map((f, i) => (
              <View key={i} style={[styles.featureSlide, { width: SCREEN_W - 48 }]}>
                <Text style={styles.featureIcon}>{f.icon}</Text>
                <Text style={[styles.featureTitle, { color: colors.text }]}>{f.title}</Text>
                <Text style={[styles.featureDesc, { color: colors.textMuted }]}>{f.desc}</Text>
              </View>
            ))}
          </ScrollView>
          <View style={styles.dots}>
            {FEATURES.map((_, i) => (
              <View key={i} style={[styles.dot, { backgroundColor: i === featureIdx ? colors.primary : colors.border }]} />
            ))}
          </View>
        </View>
        <View style={[styles.featuresBottom, { paddingBottom: insets.bottom + 24 }]}>
          <Pressable
            style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
            onPress={() => {
              if (featureIdx < FEATURES.length - 1) {
                featureScrollRef.current?.scrollTo({ x: (featureIdx + 1) * (SCREEN_W - 48), animated: true });
                setFeatureIdx(featureIdx + 1);
              } else {
                goNext('mode');
              }
            }}
          >
            <Text style={[styles.primaryBtnText, { color: colors.onPrimary }]}>
              {featureIdx < FEATURES.length - 1 ? 'NEXT' : 'CONTINUE'}
            </Text>
          </Pressable>
          <Pressable onPress={() => goNext('mode')} style={styles.skipBtn}>
            <Text style={[styles.skipText, { fontFamily: MONO, color: colors.textMuted }]}>SKIP</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ── Step: Mode ─────────────────────────────────────────────────────────
  if (step === 'mode') {
    return (
      <ScrollView
        style={[styles.root, { paddingTop: insets.top + 20 }]}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
      >
        <Pressable style={styles.backBtn} onPress={() => switching ? navigation.goBack() : goNext('features')}>
          <Text style={[styles.backText, { color: colors.primary }]}>← Back</Text>
        </Pressable>

        <Text style={[styles.stepTitle, { color: colors.text }]}>HOW DO YOU WANT TO USE CEGIN?</Text>
        <Text style={[styles.stepSub, { fontFamily: MONO, color: colors.textMuted }]}>
          You can change this later in Settings
        </Text>

        <View style={styles.modeCards}>
          <Pressable style={[styles.modeCard, { backgroundColor: colors.surface, borderColor: colors.border }]} onPress={handleLocalPick}>
            <Text style={styles.modeIcon}>📱</Text>
            <Text style={[styles.modeTitle, { color: colors.text }]}>KEEP ON DEVICE</Text>
            <Text style={[styles.modeDesc, { color: colors.textMuted }]}>
              Data stays on your phone. Connect any AI model you want (DeepSeek, Gemini, Ollama, etc).
            </Text>
          </Pressable>

          <Pressable style={[styles.modeCard, { backgroundColor: colors.surface, borderColor: colors.border }]} onPress={handleServerPick}>
            <Text style={styles.modeIcon}>🖥️</Text>
            <Text style={[styles.modeTitle, { color: colors.text }]}>USE A SERVER</Text>
            <Text style={[styles.modeDesc, { color: colors.textMuted }]}>
              Connect to a Cegin Docker server. AI comes built in, or bring your own.
            </Text>
          </Pressable>

          <Pressable style={[styles.modeCard, { backgroundColor: colors.surface, borderColor: colors.textMuted }]} onPress={handleNoAI}>
            <Text style={styles.modeIcon}>🚫</Text>
            <Text style={[styles.modeTitle, { color: colors.text }]}>NO AI</Text>
            <Text style={[styles.modeDesc, { color: colors.textMuted }]}>
              Simple recipe manager. No API keys, no server, no accounts.
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  // ── Step: Server ───────────────────────────────────────────────────────
  if (step === 'server') {
    return (
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <ScrollView
        style={[styles.root, { paddingTop: insets.top + 20 }]}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable style={styles.backBtn} onPress={() => setStep('mode')}>
          <Text style={[styles.backText, { color: colors.primary }]}>← Back</Text>
        </Pressable>

        <Text style={[styles.stepTitle, { color: colors.text }]}>CONNECT TO SERVER</Text>
        <Text style={[styles.stepSub, { color: colors.textMuted }]}>
          Enter the URL of your Cegin Docker server.
        </Text>

        <View style={styles.fieldGroup}>
          <Text style={[styles.label, { color: colors.textMuted }]}>SERVER URL</Text>
          <TextInput
            style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
            value={serverUrlInput}
            onChangeText={setServerUrlInput}
            placeholder="http://192.168.1.50:3000"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
        </View>

        {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}

        <Pressable
          style={[styles.primaryBtn, { backgroundColor: colors.primary }, testing && { opacity: 0.6 }]}
          onPress={handleServerSave}
          disabled={testing}
        >
          {testing ? (
            <ActivityIndicator color={colors.onPrimary} />
          ) : (
            <Text style={[styles.primaryBtnText, { color: colors.onPrimary }]}>TEST & CONNECT</Text>
          )}
        </Pressable>
      </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ── Step: AI Config ────────────────────────────────────────────────────
  if (step === 'ai') {
    return (
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <ScrollView
        style={[styles.root, { paddingTop: insets.top + 20 }]}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable style={styles.backBtn} onPress={() => setStep('mode')}>
          <Text style={[styles.backText, { color: colors.primary }]}>← Back</Text>
        </Pressable>

        <Text style={[styles.stepTitle, { color: colors.text }]}>SET UP AI</Text>
        <Text style={[styles.stepSub, { color: colors.textMuted }]}>
          Connect any text and vision model. Skip to configure later in Settings.
        </Text>

        {/* Text provider */}
        <View style={styles.fieldGroup}>
          <Text style={[styles.label, { color: colors.textMuted }]}>TEXT / CHAT MODEL</Text>
          <Text style={[styles.hint, { color: colors.textMuted }]}>Terry chat, recipe generation, meal plans</Text>

          <View style={styles.segmentRow}>
            {['openai-compatible', 'gemini'].map((t) => (
              <Pressable
                key={t}
                style={[styles.segmentItem, { borderColor: colors.border, backgroundColor: colors.surface }, textProvider.type === t && { backgroundColor: colors.primary, borderColor: colors.primary }]}
                onPress={() => setTextProvider((p) => ({ ...p, type: t }))}
              >
                <Text style={[styles.segmentText, { color: textProvider.type === t ? colors.onPrimary : colors.textMuted }]}>
                  {t === 'openai-compatible' ? 'OpenAI Compatible' : 'Gemini'}
                </Text>
              </Pressable>
            ))}
          </View>

          {textProvider.type === 'openai-compatible' && (
            <>
              <Text style={[styles.label, { color: colors.textMuted }]}>BASE URL</Text>
              <TextInput
                style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
                value={textProvider.baseUrl}
                onChangeText={(v) => setTextProvider((p) => ({ ...p, baseUrl: v }))}
                placeholder="https://api.deepseek.com/v1"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </>
          )}

          <Text style={[styles.label, { color: colors.textMuted }]}>API KEY</Text>
          <TextInput
            style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
            value={textProvider.apiKey}
            onChangeText={(v) => setTextProvider((p) => ({ ...p, apiKey: v }))}
            placeholder="sk-... or AIza..."
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />

          <Text style={[styles.label, { color: colors.textMuted }]}>MODEL NAME</Text>
          {textModels.length > 0 ? (
            <View style={[styles.modelDropdown, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <ScrollView style={{ maxHeight: 180 }} nestedScrollEnabled>
                {textModels.map((m) => {
                  const active = textProvider.model === m.id;
                  return (
                    <Pressable
                      key={m.id}
                      style={[styles.modelOption, { borderBottomColor: colors.border }, active && { backgroundColor: colors.primary + '15' }]}
                      onPress={() => setTextProvider((p) => ({ ...p, model: m.id }))}
                    >
                      <Text style={[styles.modelOptionText, { fontFamily: MONO, color: active ? colors.primary : colors.text }]} numberOfLines={1}>
                        {m.id}
                      </Text>
                      {active && <Text style={{ color: colors.primary, fontWeight: '900', fontSize: 12 }}>✓</Text>}
                    </Pressable>
                  );
                })}
              </ScrollView>
              <Pressable style={styles.modelDropdownClose} onPress={() => setTextModels([])}>
                <Text style={[styles.label, { color: colors.textMuted, marginBottom: 0 }]}>TYPE MANUALLY</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <TextInput
                style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
                value={textProvider.model}
                onChangeText={(v) => setTextProvider((p) => ({ ...p, model: v }))}
                placeholder="deepseek-chat, gpt-4o-mini, gemini-2.5-flash..."
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {textProvider.apiKey && (
                <Pressable
                  style={[styles.discoverBtn, { borderColor: colors.border }]}
                  onPress={() => discoverModels('text')}
                  disabled={discoveringText}
                >
                  <Text style={[styles.discoverBtnText, { fontFamily: MONO, color: colors.primary }]}>
                    {discoveringText ? 'SEARCHING…' : '🔍 FIND AVAILABLE MODELS'}
                  </Text>
                </Pressable>
              )}
            </>
          )}
        </View>

        {/* Vision provider */}
        <View style={styles.fieldGroup}>
          <Text style={[styles.label, { color: colors.textMuted }]}>VISION MODEL (optional)</Text>
          <Text style={[styles.hint, { color: colors.textMuted }]}>For fridge/pantry scanning</Text>

          <View style={styles.segmentRow}>
            {['openai-compatible', 'gemini'].map((t) => (
              <Pressable
                key={t}
                style={[styles.segmentItem, { borderColor: colors.border, backgroundColor: colors.surface }, visionProvider.type === t && { backgroundColor: colors.primary, borderColor: colors.primary }]}
                onPress={() => setVisionProvider((p) => ({ ...p, type: t }))}
              >
                <Text style={[styles.segmentText, { color: visionProvider.type === t ? colors.onPrimary : colors.textMuted }]}>
                  {t === 'openai-compatible' ? 'OpenAI Compatible' : 'Gemini'}
                </Text>
              </Pressable>
            ))}
          </View>

          {visionProvider.type === 'openai-compatible' && (
            <>
              <Text style={[styles.label, { color: colors.textMuted }]}>BASE URL</Text>
              <TextInput
                style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
                value={visionProvider.baseUrl || 'https://api.openai.com/v1'}
                onChangeText={(v) => setVisionProvider((p) => ({ ...p, baseUrl: v }))}
                placeholder="https://api.openai.com/v1"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </>
          )}

          <Text style={[styles.label, { color: colors.textMuted }]}>API KEY</Text>
          <TextInput
            style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
            value={visionProvider.apiKey}
            onChangeText={(v) => setVisionProvider((p) => ({ ...p, apiKey: v }))}
            placeholder="sk-... or AIza..."
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />

          <Text style={[styles.label, { color: colors.textMuted }]}>MODEL NAME</Text>
          {visionModels.length > 0 ? (
            <View style={[styles.modelDropdown, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <ScrollView style={{ maxHeight: 180 }} nestedScrollEnabled>
                {visionModels.map((m) => {
                  const active = visionProvider.model === m.id;
                  return (
                    <Pressable
                      key={m.id}
                      style={[styles.modelOption, { borderBottomColor: colors.border }, active && { backgroundColor: colors.primary + '15' }]}
                      onPress={() => setVisionProvider((p) => ({ ...p, model: m.id }))}
                    >
                      <Text style={[styles.modelOptionText, { fontFamily: MONO, color: active ? colors.primary : colors.text }]} numberOfLines={1}>
                        {m.id}
                      </Text>
                      {active && <Text style={{ color: colors.primary, fontWeight: '900', fontSize: 12 }}>✓</Text>}
                    </Pressable>
                  );
                })}
              </ScrollView>
              <Pressable style={styles.modelDropdownClose} onPress={() => setVisionModels([])}>
                <Text style={[styles.label, { color: colors.textMuted, marginBottom: 0 }]}>TYPE MANUALLY</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <TextInput
                style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
                value={visionProvider.model}
                onChangeText={(v) => setVisionProvider((p) => ({ ...p, model: v }))}
                placeholder="gpt-4o-mini, gemini-2.5-flash, llava..."
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {visionProvider.apiKey && (
                <Pressable
                  style={[styles.discoverBtn, { borderColor: colors.border }]}
                  onPress={() => discoverModels('vision')}
                  disabled={discoveringVision}
                >
                  <Text style={[styles.discoverBtnText, { fontFamily: MONO, color: colors.primary }]}>
                    {discoveringVision ? 'SEARCHING…' : '🔍 FIND AVAILABLE MODELS'}
                  </Text>
                </Pressable>
              )}
            </>
          )}
        </View>

        {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}

        <Pressable
          style={[styles.primaryBtn, { backgroundColor: colors.primary }, saving && { opacity: 0.6 }]}
          onPress={handleLocalSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color={colors.onPrimary} />
          ) : (
            <Text style={[styles.primaryBtnText, { color: colors.onPrimary }]}>CONTINUE</Text>
          )}
        </Pressable>

        <Pressable onPress={handleLocalSave} style={styles.skipBtn}>
          <Text style={[styles.skipText, { fontFamily: MONO, color: colors.textMuted }]}>SKIP FOR NOW</Text>
        </Pressable>
      </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ── Step: Diet ─────────────────────────────────────────────────────────
  if (step === 'diet') {
    const addProfile = async () => {
      if (!dietName.trim() || !dietNeeds.trim()) return;
      const p = await addDietaryProfile({ name: dietName.trim(), needs: dietNeeds.trim(), notes: dietNotes.trim() });
      setProfiles((prev) => [...prev, p]);
      setDietName('');
      setDietNeeds('');
      setDietNotes('');
    };

    return (
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <ScrollView
        style={[styles.root, { paddingTop: insets.top + 20 }]}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.stepTitle, { color: colors.text }]}>WHO'S EATING?</Text>
        <Text style={[styles.stepSub, { color: colors.textMuted }]}>
          Add yourself and household members with dietary needs. Terry will adjust recipes and meal plans to fit everyone. Skip if you and your household don't have any dietary needs.
        </Text>

        {/* Existing profiles */}
        {profiles.map((p) => (
          <View key={p.id} style={[styles.profileCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.profileHeader}>
              <Text style={[styles.profileName, { color: colors.text }]}>{p.name}</Text>
              <Pressable onPress={async () => {
                const updated = await removeDietaryProfile(p.id);
                setProfiles(updated);
              }} hitSlop={8}>
                <Text style={{ color: colors.danger, fontSize: 16, fontWeight: '700' }}>✕</Text>
              </Pressable>
            </View>
            <Text style={[styles.profileNeeds, { fontFamily: MONO, color: colors.primary }]}>{p.needs}</Text>
            {p.notes ? <Text style={[styles.profileNotes, { color: colors.textMuted }]}>{p.notes}</Text> : null}
          </View>
        ))}

        {/* Add new */}
        <View style={[styles.dietForm, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.label, { color: colors.textMuted }]}>NAME</Text>
          <TextInput
            style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
            value={dietName}
            onChangeText={setDietName}
            placeholder="e.g. Sarah"
            placeholderTextColor={colors.textMuted}
          />
          <Text style={[styles.label, { color: colors.textMuted }]}>DIETARY NEEDS</Text>
          <TextInput
            style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
            value={dietNeeds}
            onChangeText={setDietNeeds}
            placeholder="e.g. gluten-free, dairy-free"
            placeholderTextColor={colors.textMuted}
            multiline
          />
          <Text style={[styles.label, { color: colors.textMuted }]}>NOTES (optional)</Text>
          <TextInput
            style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
            value={dietNotes}
            onChangeText={setDietNotes}
            placeholder="e.g. allergies, dislikes"
            placeholderTextColor={colors.textMuted}
            multiline
          />
          <Pressable
            style={[styles.addBtn, { borderColor: colors.primary }]}
            onPress={addProfile}
          >
            <Text style={[styles.addBtnText, { fontFamily: MONO, color: colors.primary }]}>+ ADD PERSON</Text>
          </Pressable>
        </View>

        <Pressable style={[styles.primaryBtn, { backgroundColor: colors.primary, marginTop: 20 }]} onPress={() => goNext('permissions')}>
          <Text style={[styles.primaryBtnText, { color: colors.onPrimary }]}>CONTINUE</Text>
        </Pressable>
        <Pressable onPress={() => goNext('permissions')} style={styles.skipBtn}>
          <Text style={[styles.skipText, { fontFamily: MONO, color: colors.textMuted }]}>SKIP FOR NOW</Text>
        </Pressable>
      </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ── Step: Permissions ──────────────────────────────────────────────────
  if (step === 'permissions') {
    const requestNotif = async () => {
      const status = await requestPermissionAndGetStatus();
      setNotifStatus(status);
      if (status === 'granted') {
        try {
          const token = await getPushToken();
          if (token) await api.registerPushToken(token);
        } catch (_e) { if (__DEV__) console.warn('[SetupScreen] Caught error:', _e.message); }
      }
    };
    const requestCamera = async () => {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      setCameraStatus(status === 'granted' ? 'granted' : 'denied');
    };

    return (
      <ScrollView
        style={[styles.root, { paddingTop: insets.top + 20 }]}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
      >
        <Text style={[styles.stepTitle, { color: colors.text }]}>ALLOW PERMISSIONS</Text>
        <Text style={[styles.stepSub, { color: colors.textMuted }]}>
          Cegin needs a couple of permissions to work its best. You can change these later in Settings.
        </Text>

        {/* Notifications */}
        <View style={[styles.permCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.permCardHeader}>
            <Text style={styles.permIcon}>🔔</Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.permTitle, { color: colors.text }]}>Notifications</Text>
              <Text style={[styles.permDesc, { color: colors.textMuted }]}>
                Morning meal prep reminders and perishable ingredient alerts from Chef Terry.
              </Text>
            </View>
          </View>
          {notifStatus === 'granted' ? (
            <View style={[styles.permBadge, { borderColor: colors.primary }]}>
              <Text style={[styles.permBadgeText, { fontFamily: MONO, color: colors.primary }]}>ENABLED</Text>
            </View>
          ) : (
            <Pressable style={[styles.permBtn, { backgroundColor: colors.primary }]} onPress={requestNotif}>
              <Text style={[styles.permBtnText, { color: colors.onPrimary }]}>ENABLE</Text>
            </Pressable>
          )}
        </View>

        {/* Camera */}
        <View style={[styles.permCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.permCardHeader}>
            <Text style={styles.permIcon}>📷</Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.permTitle, { color: colors.text }]}>Camera</Text>
              <Text style={[styles.permDesc, { color: colors.textMuted }]}>
                Scan recipes from photos and identify fridge items with Terry Vision.
              </Text>
            </View>
          </View>
          {cameraStatus === 'granted' ? (
            <View style={[styles.permBadge, { borderColor: colors.primary }]}>
              <Text style={[styles.permBadgeText, { fontFamily: MONO, color: colors.primary }]}>ENABLED</Text>
            </View>
          ) : (
            <Pressable style={[styles.permBtn, { backgroundColor: colors.primary }]} onPress={requestCamera}>
              <Text style={[styles.permBtnText, { color: colors.onPrimary }]}>ENABLE</Text>
            </Pressable>
          )}
        </View>

        <Pressable style={[styles.primaryBtn, { backgroundColor: colors.primary, marginTop: 24 }]} onPress={() => goNext('theme')}>
          <Text style={[styles.primaryBtnText, { color: colors.onPrimary }]}>CONTINUE</Text>
        </Pressable>
        <Pressable onPress={() => goNext('theme')} style={styles.skipBtn}>
          <Text style={[styles.skipText, { fontFamily: MONO, color: colors.textMuted }]}>SKIP FOR NOW</Text>
        </Pressable>
      </ScrollView>
    );
  }

  // ── Step: Theme ────────────────────────────────────────────────────────
  if (step === 'theme') {
    return (
      <ScrollView
        style={[styles.root, { paddingTop: insets.top + 20 }]}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
      >
        <Text style={[styles.stepTitle, { color: colors.text }]}>PICK YOUR VIBE</Text>
        <Text style={[styles.stepSub, { fontFamily: MONO, color: colors.textMuted }]}>
          Choose a colour palette. Change anytime in Settings.
        </Text>

        <View style={styles.themeGrid}>
          {THEME_LIST.filter((t) => scheme !== 'light' || t.key !== 'oled').map((t) => {
            const active = palette === t.key;
            return (
              <Pressable
                key={t.key}
                style={[
                  styles.themeCard,
                  { borderColor: active ? colors.primary : colors.border, backgroundColor: colors.surface },
                ]}
                onPress={() => setPalette(t.key)}
              >
                <View style={[styles.themeSwatch, t.key === 'material-you' ? { backgroundColor: colors.primary + '30', alignItems: 'center', justifyContent: 'center' } : { backgroundColor: THEME_PREVIEWS[t.key] || colors.textMuted }]}>
                  {t.key === 'material-you' && <Text style={{ fontSize: 16 }}>📱</Text>}
                </View>
                <Text style={[styles.themeName, { color: active ? colors.primary : colors.text }]}>{t.name.toUpperCase()}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* OLED accent picker */}
        {palette === 'oled' && scheme !== 'light' && (
          <View style={[styles.oledSection, { marginTop: 12 }]}>
            <Text style={[styles.label, { color: colors.textMuted }]}>ACCENT COLOR</Text>
            <View style={styles.oledGrid}>
              {OLED_ACCENTS.map((accent, i) => {
                const active = oledAccent === i;
                return (
                  <Pressable
                    key={i}
                    style={[styles.oledDot, { backgroundColor: accent.primary, borderColor: active ? '#fff' : 'transparent' }]}
                    onPress={() => setOledAccent(i)}
                  >
                    {active && <Text style={{ color: '#000', fontSize: 10, fontWeight: '900' }}>✓</Text>}
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}

        {/* Light / Dark toggle */}
        <View style={[styles.modeToggle, { borderColor: colors.border }]}>
          {['dark', 'light', 'system'].map((m) => (
            <Pressable
              key={m}
              style={[styles.modeToggleItem, mode === m && { backgroundColor: colors.primary }]}
              onPress={() => {
                setMode(m);
                // OLED doesn't have a light variant — switch to open-flame
                if (m === 'light' && palette === 'oled') setPalette('open-flame');
              }}
            >
              <Text style={[styles.modeToggleText, { fontFamily: MONO, color: mode === m ? colors.onPrimary : colors.textMuted }]}>
                {m.toUpperCase()}
              </Text>
            </Pressable>
          ))}
        </View>

        <Pressable style={[styles.primaryBtn, { backgroundColor: colors.primary }]} onPress={() => goNext('ready')}>
          <Text style={[styles.primaryBtnText, { color: colors.onPrimary }]}>CONTINUE</Text>
        </Pressable>
      </ScrollView>
    );
  }

  // ── Step: Ready ────────────────────────────────────────────────────────
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.readyCenter}>
        <Text style={styles.readyEmoji}>🍳</Text>
        <Text style={[styles.readyTitle, { color: colors.text }]}>YOU'RE ALL SET</Text>
        <Text style={[styles.readySub, { fontFamily: MONO, color: colors.textMuted }]}>
          Time to add your first recipe
        </Text>
      </View>
      <View style={[styles.readyBottom, { paddingBottom: insets.bottom + 24 }]}>
        <Pressable style={[styles.primaryBtn, { backgroundColor: colors.primary }]} onPress={finish}>
          <Text style={[styles.primaryBtnText, { color: colors.onPrimary }]}>START COOKING</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

function makeStyles(c, s, fs) {
  return StyleSheet.create({

    root: {
      flex: 1,
      backgroundColor: c.background,
      paddingHorizontal: s(24),
    },

    // Welcome
    welcomeCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    welcomeEmoji: { fontSize: fs(72), marginBottom: s(16) },
    welcomeTitle: { fontSize: fs(32), fontWeight: '900', color: c.text, letterSpacing: 2 },
    welcomeTagline: { fontSize: fs(13), letterSpacing: 2, marginTop: s(8) },
    welcomeBottom: { alignItems: 'center' },

    // Features
    featuresTop: { flex: 1, justifyContent: 'center' },
    featureSlide: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: s(20) },
    featureIcon: { fontSize: fs(56), marginBottom: s(20) },
    featureTitle: { fontSize: fs(20), fontWeight: '900', letterSpacing: 1, marginBottom: s(12), textAlign: 'center' },
    featureDesc: { fontSize: fs(15), textAlign: 'center', lineHeight: fs(22), paddingHorizontal: s(10) },
    dots: { flexDirection: 'row', justifyContent: 'center', gap: s(8), marginTop: s(24) },
    dot: { width: s(8), height: s(8), borderRadius: s(4) },
    featuresBottom: { alignItems: 'center' },

    // Common buttons
    primaryBtn: {
      borderRadius: s(20),
      paddingVertical: s(16),
      alignItems: 'center',
      width: '100%',
    },
    primaryBtnText: {
      fontSize: fs(14),
      fontWeight: '900',
      letterSpacing: 1.5,
    },
    skipBtn: { marginTop: s(16), padding: s(8) },
    skipText: { fontSize: fs(11), letterSpacing: 1.5 },
    backBtn: { alignSelf: 'flex-start', marginBottom: s(16), paddingVertical: s(6), paddingHorizontal: s(2) },
    backText: { fontSize: fs(15), fontWeight: '600' },

    // Step headers
    stepTitle: { fontSize: fs(22), fontWeight: '900', letterSpacing: 0.5, textAlign: 'center', marginBottom: s(6) },
    stepSub: { fontSize: fs(12), textAlign: 'center', marginBottom: s(28), lineHeight: fs(18), paddingHorizontal: s(8) },

    // Mode cards
    modeCards: { gap: s(14) },
    modeCard: {
      borderRadius: s(18),
      borderWidth: 1.5,
      padding: s(24),
      alignItems: 'center',
    },
    modeIcon: { fontSize: fs(36), marginBottom: s(10) },
    modeTitle: { fontSize: fs(15), fontWeight: '900', letterSpacing: 0.5, marginBottom: s(6) },
    modeDesc: { fontSize: fs(13), textAlign: 'center', lineHeight: fs(19) },

    // Form
    fieldGroup: { marginBottom: s(20) },
    label: { fontFamily: MONO, fontSize: fs(11), fontWeight: '900', letterSpacing: 1, marginBottom: s(4) },
    hint: { fontSize: fs(12), marginBottom: s(8) },
    input: {
      borderWidth: 1.5,
      borderRadius: s(16),
      paddingHorizontal: s(16),
      paddingVertical: s(14),
      fontSize: fs(15),
      marginBottom: s(8),
    },
    error: { fontSize: fs(13), textAlign: 'center', marginBottom: s(12) },
    segmentRow: { flexDirection: 'row', gap: s(8), marginBottom: s(10) },
    segmentItem: {
      flex: 1,
      borderWidth: 1.5,
      borderRadius: s(10),
      paddingVertical: s(8),
      alignItems: 'center',
    },
    segmentText: { fontFamily: MONO, fontSize: fs(12), fontWeight: '700' },

    // Theme
    themeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: s(10), marginBottom: s(20) },
    themeCard: {
      width: '30%',
      borderWidth: 1.5,
      borderRadius: s(18),
      padding: s(14),
      alignItems: 'center',
    },
    themeSwatch: { width: s(28), height: s(28), borderRadius: s(14), marginBottom: s(8) },
    themeName: { fontSize: fs(10), fontWeight: '900', letterSpacing: 0.5 },
    oledSection: { marginBottom: s(20) },
    oledGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: s(10), marginTop: s(8) },
    oledDot: {
      width: s(36), height: s(36), borderRadius: s(18),
      alignItems: 'center', justifyContent: 'center',
      borderWidth: 3,
    },
    modeToggle: {
      flexDirection: 'row',
      borderWidth: 1.5,
      borderRadius: s(12),
      overflow: 'hidden',
      marginBottom: s(24),
    },
    modeToggleItem: { flex: 1, paddingVertical: s(12), alignItems: 'center' },
    modeToggleText: { fontSize: fs(11), fontWeight: '700', letterSpacing: 1 },

    // Ready
    readyCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    readyEmoji: { fontSize: fs(72), marginBottom: s(16) },
    readyTitle: { fontSize: fs(26), fontWeight: '900', letterSpacing: 1, marginBottom: s(8) },
    readySub: { fontSize: fs(13), letterSpacing: 1 },
    readyBottom: { alignItems: 'center' },

    // Diet
    profileCard: { borderWidth: 1.5, borderRadius: s(18), padding: s(14), marginBottom: s(8) },
    profileHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    profileName: { fontSize: fs(15), fontWeight: '900' },
    profileNeeds: { fontSize: fs(12), letterSpacing: 0.5, marginTop: s(4) },
    profileNotes: { fontSize: fs(12), lineHeight: fs(18), marginTop: s(4) },
    dietForm: { borderWidth: 1.5, borderRadius: s(14), padding: s(16), marginTop: s(12) },
    addBtn: { borderWidth: 1.5, borderRadius: s(20), paddingVertical: s(12), alignItems: 'center', marginTop: s(4) },
    addBtnText: { fontSize: fs(11), letterSpacing: 1 },

    // Permissions
    permCard: { borderWidth: 1.5, borderRadius: s(14), padding: s(18), marginBottom: s(12) },
    permCardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: s(12), marginBottom: s(14) },
    permIcon: { fontSize: fs(28) },
    permTitle: { fontSize: fs(15), fontWeight: '900' },
    permDesc: { fontSize: fs(12), lineHeight: fs(18), marginTop: s(4) },
    permBadge: { borderWidth: 1.5, borderRadius: s(12), paddingVertical: s(8), alignItems: 'center' },
    permBadgeText: { fontSize: fs(11), letterSpacing: 1, fontWeight: '900' },
    permBtn: { borderRadius: s(20), paddingVertical: s(12), alignItems: 'center' },
    permBtnText: { fontSize: fs(12), fontWeight: '900', letterSpacing: 1 },

    // Model discovery
    discoverBtn: { borderWidth: 1.5, borderRadius: s(20), paddingVertical: s(10), alignItems: 'center', marginTop: s(4), marginBottom: s(8) },
    discoverBtnText: { fontSize: fs(11), letterSpacing: 1, fontWeight: '700' },
    modelDropdown: { borderWidth: 1.5, borderRadius: s(12), overflow: 'hidden', marginBottom: s(8) },
    modelOption: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: s(12), paddingHorizontal: s(14), borderBottomWidth: 1 },
    modelOptionText: { fontSize: fs(13), flex: 1, marginRight: s(8) },
    modelDropdownClose: { paddingVertical: s(10), alignItems: 'center', borderTopWidth: 1 },
  
  });
}