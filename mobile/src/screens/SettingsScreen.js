import { useEffect, useRef, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { getPermissionStatus, requestPermissionAndGetStatus, getPushToken } from '../notifications';
import { api, getServerUrl, setServerUrl } from '../api';
import { getAppMode, getDeepSeekKey, setDeepSeekKey, getGoogleKey, setGoogleKey, getCustomAIConfig, setCustomAIConfig, fetchAvailableModels } from '../config';
import { clearCache as clearMealPlanCache } from '../mealPlan';
import { clearCache as clearCookbookCache } from '../cookbook';
import { clearCache as clearShoppingListCache } from '../shoppingList';
import { clearCache as clearStatsCache } from '../stats';
import { clearCache as clearDietProfilesCache } from '../dietProfiles';
import { MONO, useTheme, THEME_LIST, OLED_ACCENTS } from '../theme';
import Constants from 'expo-constants';
import { checkVersions, getVersionStatus, CLIENT_VERSION } from '../versionCheck';

// Preview swatch colors for each theme
const THEME_PREVIEWS = {
  'open-flame': { primary: '#FF5A26', background: '#131010', surface: '#1C1715' },
  'ocean': { primary: '#4FC3F7', background: '#0A1628', surface: '#111D33' },
  'forest': { primary: '#81C784', background: '#0E1510', surface: '#151E16' },
  'berry': { primary: '#CE93D8', background: '#140E18', surface: '#1D1523' },
  'midnight': { primary: '#7986CB', background: '#0B0E1A', surface: '#121628' },
  'sakura': { primary: '#F48FB1', background: '#180E12', surface: '#221519' },
  'oled': { primary: '#FF5A26', background: '#000000', surface: '#0A0A0A' },
};
function getThemePreview(key, prop) { return THEME_PREVIEWS[key]?.[prop] || '#666'; }
import { clearList } from '../shoppingList';
import { clearHistory } from '../chatHistory';
import { clearMealPlan } from '../mealPlan';
import { clearStats } from '../stats';
import { clearCookbook } from '../cookbook';
import { resetApp } from '../resetApp';
import {
  getDietaryProfiles, addDietaryProfile,
  removeDietaryProfile,
} from '../dietProfiles';
import AppModal from '../components/AppModal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAi } from '../aiContext';

const terryImg = require('../../assets/terry1.jpg');

const THEME_OPTIONS = [
  { value: 'system', label: 'SYSTEM' },
  { value: 'light', label: 'LIGHT' },
  { value: 'dark', label: 'DARK' },
];

const UNIT_OPTIONS = [
  { value: 'metric', label: 'METRIC' },
  { value: 'us', label: 'US' },
];

// ─── Section icons (emoji, matching the app's playful vibe) ────────────────
const SECTION_ICONS = {
  appearance: '🎨',
  features: '✨',
  notifications: '🔔',
  diet: '🥗',
  data: '📦',
  developer: '⚙️',
};

function ProfileEditor({ colors, onSave, onCancel, initial }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [needs, setNeeds] = useState(initial?.needs ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');

  return (
    <View style={[peStyles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[peStyles.title, { color: colors.text }]}>
        {initial ? 'EDIT PROFILE' : 'NEW PROFILE'}
      </Text>
      <TextInput
        style={[peStyles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
        value={name}
        onChangeText={setName}
        placeholder="Name (e.g. Sarah)"
        placeholderTextColor={colors.textMuted}
      />
      <TextInput
        style={[peStyles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
        value={needs}
        onChangeText={setNeeds}
        placeholder="Dietary needs (e.g. gluten-free, dairy-free)"
        placeholderTextColor={colors.textMuted}
        multiline
      />
      <TextInput
        style={[peStyles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
        value={notes}
        onChangeText={setNotes}
        placeholder="Notes (e.g. IBS triggers, allergies)"
        placeholderTextColor={colors.textMuted}
        multiline
      />
      <View style={peStyles.row}>
        <Pressable style={[peStyles.btn, { borderColor: colors.border }]} onPress={onCancel}>
          <Text style={[peStyles.btnText, { color: colors.textMuted }]}>CANCEL</Text>
        </Pressable>
        <Pressable
          style={[peStyles.btn, { backgroundColor: colors.primary }]}
          onPress={() => {
            if (!name.trim() || !needs.trim()) return;
            onSave({ name: name.trim(), needs: needs.trim(), notes: notes.trim() });
          }}
        >
          <Text style={[peStyles.btnText, { color: colors.onPrimary }]}>SAVE</Text>
        </Pressable>
      </View>
    </View>
  );
}

const peStyles = StyleSheet.create({
  card: { borderWidth: 1.5, borderRadius: 12, padding: 16, marginTop: 10 },
  title: { fontSize: 13, fontWeight: '900', letterSpacing: 1, marginBottom: 12 },
  input: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, marginBottom: 10 },
  row: { flexDirection: 'row', gap: 10, marginTop: 4 },
  btn: { flex: 1, borderWidth: 1.5, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  btnText: { fontWeight: '900', fontSize: 12, letterSpacing: 1 },
});

// ─── Reusable toggle row ──────────────────────────────────────────────────
function ToggleRow({ colors, label, hint, value, onToggle }) {
  return (
    <Pressable style={styles.toggleRow} onPress={onToggle}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.toggleLabel, { color: colors.text }]}>{label}</Text>
        {hint ? <Text style={[styles.hint, { color: colors.textMuted, marginTop: 2 }]}>{hint}</Text> : null}
      </View>
      <View style={{
        width: 48, height: 28, borderRadius: 14, borderWidth: 2,
        borderColor: value ? colors.primary : colors.border,
        backgroundColor: value ? colors.primary : 'transparent',
        justifyContent: 'center', alignItems: value ? 'flex-end' : 'flex-start',
        paddingHorizontal: 3,
      }}>
        <View style={{
          width: 20, height: 20, borderRadius: 10,
          backgroundColor: value ? colors.onPrimary : colors.textMuted,
        }} />
      </View>
    </Pressable>
  );
}

export default function SettingsScreen({ navigation }) {
  const { colors, mode, scheme, setMode, palette, setPalette, oledAccent, setOledAccent, materialYouSeed, setMaterialYouSeed } = useTheme();
  const { noAI, setNoAI } = useAi();
  const insets = useSafeAreaInsets();
  const [url, setUrl] = useState('');
  const [savedServers, setSavedServers] = useState([]);
  const [status, setStatus] = useState(null);
  const [testing, setTesting] = useState(false);
  const [aiStatus, setAiStatus] = useState(null);
  const [versionInfo, setVersionInfo] = useState(null);
  const [unitPref, setUnitPref] = useState('metric');
  const [devOpen, setDevOpen] = useState(false);
  const [dataOpen, setDataOpen] = useState(false);

  // Health & Diet state
  const [profiles, setProfiles] = useState([]);
  const [editingProfile, setEditingProfile] = useState(null);

  // Mode state
  const [appMode, setAppModeState] = useState('server');
  const [deepseekKey, setDeepseekKeyState] = useState('');
  const [googleKey, setGoogleKeyState] = useState('');

  // Custom AI Providers
  const [useCustomAI, setUseCustomAI] = useState(false);
  const [textProvider, setTextProvider] = useState({
    type: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    model: 'deepseek-chat',
  });
  const [visionProvider, setVisionProvider] = useState({
    type: 'gemini',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gemini-2.5-flash',
  });

  // Model discovery
  const [textModels, setTextModels] = useState([]);
  const [visionModels, setVisionModels] = useState([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(null); // 'text' | 'vision' | null

  // Permissions state
  const [notifPermission, setNotifPermission] = useState(null);
  const [cameraPermission, setCameraPermission] = useState(null);

  // Notification toggle state
  const [morningDigest, setMorningDigest] = useState(true);
  const [perishableAlerts, setPerishableAlerts] = useState(true);

  // Modal state
  const [modal, setModal] = useState(null);

  // Terry's Crib Easter egg
  const [terryTaps, setTerryTaps] = useState(0);
  const [terryCrib, setTerryCrib] = useState(false);
  const terryTimer = useRef(null);

  useEffect(() => () => clearTimeout(terryTimer.current), []);

  const handleVersionTap = () => {
    clearTimeout(terryTimer.current);
    setTerryTaps((prev) => {
      const next = prev + 1;
      if (next >= 5) {
        setTerryCrib(true);
        return 0;
      }
      terryTimer.current = setTimeout(() => setTerryTaps(0), 2000);
      return next;
    });
  };

  useEffect(() => {
    getServerUrl().then(setUrl);
    AsyncStorage.getItem('saved_servers').then((v) => {
      try { if (v) setSavedServers(JSON.parse(v)); } catch {}
    });
    api.aiStatus().then(setAiStatus).catch(() => {});
    checkVersions().then(setVersionInfo).catch(() => {});
    AsyncStorage.getItem('unitPreference').then((v) => { if (v) setUnitPref(v); });
    getDietaryProfiles().then(setProfiles);
    getAppMode().then(setAppModeState);
    getDeepSeekKey().then(setDeepseekKeyState);
    getGoogleKey().then(setGoogleKeyState);
    getCustomAIConfig().then((cfg) => {
      if (cfg.text || cfg.vision) {
        setUseCustomAI(true);
      }
      if (cfg.text) {
        setTextProvider({
          type: cfg.text.type || 'openai-compatible',
          baseUrl: cfg.text.baseUrl || 'https://api.deepseek.com/v1',
          apiKey: cfg.text.apiKey || '',
          model: cfg.text.model || 'deepseek-chat',
        });
      }
      if (cfg.vision) {
        setVisionProvider({
          type: cfg.vision.type || 'gemini',
          apiKey: cfg.vision.apiKey || '',
          model: cfg.vision.model || 'gemini-2.5-flash',
        });
      }
    });
    getPermissionStatus().then((status) => {
      setNotifPermission(status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined');
    }).catch(() => {});
    ImagePicker.getCameraPermissionsAsync().then((r) => {
      setCameraPermission(r.status === 'granted' ? 'granted' : r.status === 'denied' ? 'denied' : 'undetermined');
    }).catch(() => {});
    api.getNotificationSettings().then((s) => {
      setMorningDigest(!!s.morning_digest);
      setPerishableAlerts(!!s.perishable_alerts);
    }).catch(() => {});
  }, []);

  const saveAndTest = async () => {
    const trimmed = url.trim().replace(/\/+$/, '');
    if (!trimmed) { setStatus({ ok: false, message: 'Enter a server URL first.' }); return; }
    setTesting(true);
    setStatus(null);
    try {
      await setServerUrl(trimmed);
      setUrl(trimmed);
      await api.health();
      const ai = await api.aiStatus().catch(() => null);
      setAiStatus(ai);
      setStatus({ ok: true, message: '● CONNECTED' });
    } catch (e) {
      setStatus({ ok: false, message: `Saved, but could not connect: ${e.message}` });
    } finally {
      setTesting(false);
    }
  };

  const saveCurrentServer = async () => {
    const trimmed = url.trim().replace(/\/+$/, '');
    if (!trimmed) return;
    // Don't add duplicates
    if (savedServers.some((s) => s.url === trimmed)) {
      showModal('Already Saved', 'This server is already in your list.', [{ text: 'OK', primary: true }]);
      return;
    }
    // Try to get a label from the server
    let label = trimmed;
    try {
      const res = await fetch(`${trimmed}/api/health`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) label = trimmed;
    } catch {}
    const updated = [...savedServers, { url: trimmed, label, addedAt: Date.now() }];
    setSavedServers(updated);
    await AsyncStorage.setItem('saved_servers', JSON.stringify(updated));
  };

  const connectToServer = async (serverUrl) => {
    setUrl(serverUrl);
    setTesting(true);
    setStatus(null);
    try {
      // Clear in-memory caches so the new server's data is fetched fresh
      clearMealPlanCache();
      clearCookbookCache();
      clearShoppingListCache();
      clearStatsCache();
      clearDietProfilesCache();

      await setServerUrl(serverUrl);
      await api.health();
      const ai = await api.aiStatus().catch(() => null);
      setAiStatus(ai);
      setStatus({ ok: true, message: '● CONNECTED' });
    } catch (e) {
      setStatus({ ok: false, message: `Saved, but could not connect: ${e.message}` });
    } finally {
      setTesting(false);
    }
  };

  const removeSavedServer = async (serverUrl) => {
    const updated = savedServers.filter((s) => s.url !== serverUrl);
    setSavedServers(updated);
    await AsyncStorage.setItem('saved_servers', JSON.stringify(updated));
  };

  const saveUnitPref = async (val) => {
    setUnitPref(val);
    await AsyncStorage.setItem('unitPreference', val);
  };

  const discoverModels = async (type) => {
    setLoadingModels(true);
    try {
      let models;
      if (appMode === 'server') {
        // Use server endpoint — it has the API keys
        const data = await api.aiModels(type);
        models = data.models || [];
      } else {
        // Local mode — use client-side discovery
        const provider = type === 'text' ? textProvider : visionProvider;
        models = await fetchAvailableModels(provider.baseUrl, provider.apiKey);
      }
      if (type === 'text') setTextModels(models);
      else setVisionModels(models);
      setShowModelPicker(type);
    } catch {
      showModal('Error', 'Could not fetch models. Check your API key and URL.', [{ text: 'OK' }]);
    } finally {
      setLoadingModels(false);
    }
  };

  const selectModel = async (type, modelId) => {
    if (appMode === 'server' && !useCustomAI) {
      // Update model on the server
      await api.aiSetModel(type, modelId);
    } else {
      // Update local custom AI config
      if (type === 'text') {
        const updated = { ...textProvider, model: modelId };
        setTextProvider(updated);
        await setCustomAIConfig({ text: updated, vision: visionProvider.apiKey ? visionProvider : null });
      } else {
        const updated = { ...visionProvider, model: modelId };
        setVisionProvider(updated);
        await setCustomAIConfig({ text: textProvider.apiKey ? textProvider : null, vision: updated });
      }
    }
    setShowModelPicker(null);
    api.aiStatus().then(setAiStatus).catch(() => {});
  };

  const showModal = (title, message, buttons) => {
    setModal({ title, message, buttons });
  };

  const confirmClear = (label, fn) => {
    showModal(
      `Clear ${label}`,
      'This cannot be undone.',
      [
        { text: 'CANCEL' },
        { text: 'CLEAR', destructive: true, filled: true, onPress: fn },
      ],
    );
  };

  const handleDevToggle = async () => {
    setDevOpen(!devOpen);
  };

  const handleAddProfile = async (data) => {
    const p = await addDietaryProfile(data);
    setProfiles((prev) => [...prev, p]);
    setEditingProfile(null);
  };

  const handleRemoveProfile = (id) => {
    showModal(
      'Remove Profile',
      'Remove this dietary profile?',
      [
        { text: 'CANCEL' },
        { text: 'REMOVE', destructive: true, filled: true, onPress: async () => {
          const updated = await removeDietaryProfile(id);
          setProfiles(updated);
        }},
      ],
    );
  };

  return (
    <KeyboardAvoidingView style={[styles.root, { backgroundColor: colors.background }]} behavior="padding" keyboardVerticalOffset={0}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        {/* ─── Header ──────────────────────────────────────────────── */}
        <View style={[styles.header, { paddingTop: 20 + insets.top }]}>
          <Pressable
            style={[styles.backBtn, { borderColor: colors.border }]}
            onPress={() => navigation.goBack()}
          >
            <Text style={{ fontSize: 17, color: colors.text }}>←</Text>
          </Pressable>
          <Text style={[styles.screenTitle, { color: colors.text }]}>SETTINGS</Text>
        </View>

        {/* ─── About card (hero) ──────────────────────────────────── */}
        <View style={styles.section}>
          <View style={[styles.aboutCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.aboutRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.aboutName, { color: colors.text }]}>Cegin</Text>
                <Text style={[styles.aboutTagline, { color: colors.textMuted }]}>
                  Your personal recipe app with an AI cooking assistant.
                </Text>
              </View>
              <Pressable onPress={handleVersionTap} style={[styles.versionBadge, { borderColor: colors.border }]}>
                <Text style={[styles.versionText, { fontFamily: MONO, color: colors.primary }]}>v{Constants.expoConfig?.version || '1.1.5'}</Text>
                {versionInfo?.serverVersion && (
                  <Text style={[styles.versionText, { fontFamily: MONO, color: versionInfo.serverOutdated ? '#FF9800' : '#4CAF50', fontSize: 9 }]}>
                    Server: {versionInfo.serverOutdated ? 'Outdated' : 'Updated'}
                  </Text>
                )}
              </Pressable>
            </View>
            <View style={[styles.aboutMeta, { borderTopColor: colors.border }]}>
              <Text style={[styles.aboutMetaText, { color: colors.textMuted }]}>
                {appMode === 'server' ? '📡 Server mode' : '📱 Local mode'}
                {aiStatus?.configured ? ' · 🤖 AI connected' : ''}
              </Text>
            </View>
            <Pressable
              onPress={() => Linking.openURL('https://cegin.kitchen/privacy.html')}
              style={[styles.aboutMeta, { borderTopColor: colors.border }]}
            >
              <Text style={[styles.aboutMetaText, { color: colors.primary }]}>
                Privacy Policy
              </Text>
            </Pressable>
          </View>
        </View>

        {/* ─── Terry's Crib (Easter egg) ─────────────────────────── */}
        {terryCrib && (
          <View style={styles.section}>
            <View style={[styles.terryCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Image source={terryImg} style={styles.terryPhoto} resizeMode="cover" />
              <View style={styles.terryInfo}>
                <Text style={[styles.terryName, { color: colors.text }]}>CHEF TERRY</Text>
                <Text style={[styles.terryTitle, { fontFamily: MONO, color: colors.primary }]}>HEAD OF KITCHEN OPERATIONS</Text>
              </View>
              <View style={[styles.terryStats, { borderTopColor: colors.border }]}>
                <View style={styles.terryStat}>
                  <Text style={[styles.terryStatNum, { color: colors.primary }]}>∞</Text>
                  <Text style={[styles.terryStatLabel, { color: colors.textMuted }]}>LIVES USED</Text>
                </View>
                <View style={styles.terryStat}>
                  <Text style={[styles.terryStatNum, { color: colors.primary }]}>0</Text>
                  <Text style={[styles.terryStatLabel, { color: colors.textMuted }]}>RECIPES COOKED</Text>
                </View>
                <View style={styles.terryStat}>
                  <Text style={[styles.terryStatNum, { color: colors.primary }]}>47</Text>
                  <Text style={[styles.terryStatLabel, { color: colors.textMuted }]}>KEYBOARDS SLEPT ON</Text>
                </View>
              </View>
              <View style={[styles.terryDiary, { borderTopColor: colors.border }]}>
                <Text style={[styles.terryDiaryLabel, { fontFamily: MONO, color: colors.primary }]}>TERRY'S DIARY — TODAY</Text>
                <Text style={[styles.terryDiaryText, { color: colors.text2 }]}>
                  "8:03 AM — Knocked a glass off the counter. Zero regrets.{'\n'}
                  9:17 AM — Sat on the keyboard during a recipe import. Somehow added 'meow' to the ingredients.{'\n'}
                  11:45 AM — User asked me to suggest a fish recipe. Obviously I suggested tuna.{'\n'}
                  2:00 PM — Nap time. Chose the cutting board.{'\n'}
                  5:30 PM — Judged the user's plating. Silently.{'\n'}
                  7:00 PM — Chewed some grass. Don't ask why.{'\n'}
                  9:00 PM — Typed 'aaaaaaaaaaaa' into the chat while user wasn't looking. Sent it."
                </Text>
              </View>
              <View style={[styles.terryReviews, { borderTopColor: colors.border }]}>
                <Text style={[styles.terryDiaryLabel, { fontFamily: MONO, color: colors.primary }]}>TERRY'S YELP REVIEWS</Text>
                <Text style={[styles.terryReview, { color: colors.text2 }]}>
                  ⭐⭐⭐⭐⭐ "The human opened a can of tuna. I approved. Would supervise again." — Terry
                </Text>
                <Text style={[styles.terryReview, { color: colors.text2 }]}>
                  ⭐⭐⭐ "They burned the toast. I stared at them for 4 minutes straight." — Terry
                </Text>
                <Text style={[styles.terryReview, { color: colors.text2 }]}>
                  ⭐⭐⭐⭐⭐ "Sat on the warm laptop during meal planning. 10/10 would recommend." — Terry
                </Text>
              </View>
              <Pressable
                style={[styles.terryClose, { borderColor: colors.border }]}
                onPress={() => setTerryCrib(false)}
              >
                <Text style={[styles.terryCloseText, { fontFamily: MONO, color: colors.textMuted }]}>CLOSE TERRY'S CRIB</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* ═══════════════════════════════════════════════════════════
            1. APPEARANCE — themes, units
            ═══════════════════════════════════════════════════════════ */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionIcon}>{SECTION_ICONS.appearance}</Text>
            <Text style={[styles.sectionLabel, { fontFamily: MONO, color: colors.textMuted }]}>APPEARANCE</Text>
          </View>

          {/* Light / Dark / System */}
          <View style={[styles.segment, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {THEME_OPTIONS.map((opt) => {
              const active = mode === opt.value;
              return (
                <Pressable key={opt.value} style={[styles.segmentItem, active && { backgroundColor: colors.primary }]} onPress={() => setMode(opt.value)}>
                  <Text style={[styles.segmentText, { fontFamily: MONO, color: active ? colors.onPrimary : colors.textMuted }]}>
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Theme palette */}
          <Text style={[styles.subLabel, { fontFamily: MONO, color: colors.textMuted, marginTop: 16 }]}>THEME</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.themeScroll}>
            {THEME_LIST.filter((t) => scheme !== 'light' || t.key !== 'oled').map((t) => {
              const active = palette === t.key;
              const preview = THEME_PREVIEWS[t.key] || null;
              return (
                <Pressable
                  key={t.key}
                  style={[
                    styles.themeCard,
                    { borderColor: active ? colors.primary : colors.border },
                  ]}
                  onPress={() => setPalette(t.key)}
                >
                  <View style={[styles.themePreview, { backgroundColor: preview?.background || colors.background }]}>
                    {preview ? (
                      <>
                        <View style={[styles.previewBar, { backgroundColor: preview.surface, borderBottomColor: preview.background }]}>
                          <View style={{ width: 20, height: 4, borderRadius: 2, backgroundColor: preview.primary }} />
                        </View>
                        <View style={styles.previewContent}>
                          <View style={[styles.previewLine, { backgroundColor: preview.surface, width: '80%' }]} />
                          <View style={[styles.previewLine, { backgroundColor: preview.surface, width: '60%' }]} />
                          <View style={[styles.previewDot, { backgroundColor: preview.primary }]} />
                        </View>
                      </>
                    ) : (
                      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ fontSize: 20 }}>📱</Text>
                      </View>
                    )}
                  </View>
                  <Text style={[styles.themeName, { fontFamily: MONO, color: active ? colors.primary : colors.textMuted }]}>
                    {t.name}
                  </Text>
                  {active && <View style={[styles.themeCheck, { backgroundColor: colors.primary }]}>
                    <Text style={{ color: '#fff', fontSize: 10, fontWeight: '900' }}>✓</Text>
                  </View>}
                </Pressable>
              );
            })}
          </ScrollView>

          {/* OLED accent picker */}
          {palette === 'oled' && scheme !== 'light' && (
            <View style={styles.oledSection}>
              <Text style={[styles.subLabel, { fontFamily: MONO, color: colors.textMuted }]}>ACCENT COLOR</Text>
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

          {/* Material You info */}
          {palette === 'material-you' && (
            <View style={styles.oledSection}>
              <Text style={[styles.subLabel, { fontFamily: MONO, color: colors.textMuted }]}>MATCHES YOUR WALLPAPER AUTOMATICALLY</Text>
            </View>
          )}

          {/* Units */}
          <Text style={[styles.subLabel, { fontFamily: MONO, color: colors.textMuted, marginTop: 20 }]}>DEFAULT UNITS</Text>
          <View style={[styles.segment, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {UNIT_OPTIONS.map((opt) => {
              const active = unitPref === opt.value;
              return (
                <Pressable key={opt.value} style={[styles.segmentItem, active && { backgroundColor: colors.primary }]} onPress={() => saveUnitPref(opt.value)}>
                  <Text style={[styles.segmentText, { fontFamily: MONO, color: active ? colors.onPrimary : colors.textMuted }]}>
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={[styles.hint, { color: colors.textMuted }]}>
            Used as the default when viewing recipe ingredients.
          </Text>
        </View>

        {/* ═══════════════════════════════════════════════════════════
            2. FEATURES
            ═══════════════════════════════════════════════════════════ */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionIcon}>{SECTION_ICONS.features}</Text>
            <Text style={[styles.sectionLabel, { fontFamily: MONO, color: colors.textMuted }]}>FEATURES</Text>
          </View>
          <View style={[styles.infoCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <ToggleRow
              colors={colors}
              label="No AI Mode"
              hint="Hides all AI features — Terry, vision, smart lists, meal planning, and more."
              value={noAI}
              onToggle={() => setNoAI(!noAI)}
            />
          </View>
        </View>

        {/* ═══════════════════════════════════════════════════════════
            3. NOTIFICATIONS — permissions + toggles together
            ═══════════════════════════════════════════════════════════ */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionIcon}>{SECTION_ICONS.notifications}</Text>
            <Text style={[styles.sectionLabel, { fontFamily: MONO, color: colors.textMuted }]}>NOTIFICATIONS</Text>
          </View>

          <View style={[styles.infoCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {/* Notification permission */}
            <View style={[styles.infoRow, { marginBottom: 14 }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.infoLabel, { color: colors.text }]}>Push Notifications</Text>
                <Text style={[styles.hint, { color: colors.textMuted, marginTop: 2 }]}>
                  {notifPermission === 'granted' ? 'Enabled — Terry can send you alerts' : notifPermission === 'denied' ? 'Denied — enable in system settings' : 'Not yet requested'}
                </Text>
              </View>
              {notifPermission === 'granted' ? (
                <View style={[styles.permBadge, { borderColor: colors.primary }]}>
                  <Text style={[styles.permBadgeText, { fontFamily: MONO, color: colors.primary }]}>ON</Text>
                </View>
              ) : (
                <Pressable
                  style={[styles.permBtn, { backgroundColor: colors.primary }]}
                  onPress={async () => {
                    const status = await requestPermissionAndGetStatus();
                    setNotifPermission(status);
                    if (status === 'granted') {
                      try {
                        const token = await getPushToken();
                        if (token) await api.registerPushToken(token);
                      } catch {}
                    }
                  }}
                >
                  <Text style={[styles.permBtnText, { fontFamily: MONO, color: colors.onPrimary }]}>ENABLE</Text>
                </Pressable>
              )}
            </View>

            {/* Camera permission */}
            <View style={[styles.infoRow, { marginBottom: 14 }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.infoLabel, { color: colors.text }]}>Camera</Text>
                <Text style={[styles.hint, { color: colors.textMuted, marginTop: 2 }]}>
                  {cameraPermission === 'granted' ? 'Enabled — scan recipes and fridge items' : cameraPermission === 'denied' ? 'Denied — enable in system settings' : 'Not yet requested'}
                </Text>
              </View>
              {cameraPermission === 'granted' ? (
                <View style={[styles.permBadge, { borderColor: colors.primary }]}>
                  <Text style={[styles.permBadgeText, { fontFamily: MONO, color: colors.primary }]}>ON</Text>
                </View>
              ) : (
                <Pressable
                  style={[styles.permBtn, { backgroundColor: colors.primary }]}
                  onPress={async () => {
                    const { status } = await ImagePicker.requestCameraPermissionsAsync();
                    setCameraPermission(status === 'granted' ? 'granted' : 'denied');
                  }}
                >
                  <Text style={[styles.permBtnText, { fontFamily: MONO, color: colors.onPrimary }]}>ENABLE</Text>
                </Pressable>
              )}
            </View>

            {/* Divider */}
            {notifPermission === 'granted' && (
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
            )}

            {/* Morning Digest toggle */}
            {notifPermission === 'granted' && (
              <ToggleRow
                colors={colors}
                label="Morning Digest"
                hint="8:00 AM — today's meals + prep reminders"
                value={morningDigest}
                onToggle={async () => {
                  const next = !morningDigest;
                  setMorningDigest(next);
                  await api.updateNotificationSettings({ morning_digest: next });
                }}
              />
            )}

            {/* Perishable Alerts toggle */}
            {notifPermission === 'granted' && (
              <ToggleRow
                colors={colors}
                label="Perishable Alerts"
                hint="Every 6h — warns about expiring fridge items"
                value={perishableAlerts}
                onToggle={async () => {
                  const next = !perishableAlerts;
                  setPerishableAlerts(next);
                  await api.updateNotificationSettings({ perishable_alerts: next });
                }}
              />
            )}
          </View>

          {notifPermission === 'denied' && (
            <Text style={[styles.hint, { color: colors.textMuted, marginTop: 8 }]}>
              To change permissions, open your phone's Settings → Apps → Cegin → Permissions.
            </Text>
          )}
        </View>

        {/* ═══════════════════════════════════════════════════════════
            4. HEALTH & DIET
            ═══════════════════════════════════════════════════════════ */}
        {!noAI && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionIcon}>{SECTION_ICONS.diet}</Text>
            <Text style={[styles.sectionLabel, { fontFamily: MONO, color: colors.textMuted }]}>HEALTH & DIET</Text>
          </View>

          <Text style={[styles.hint, { color: colors.textMuted, marginTop: 0, marginBottom: 12 }]}>
            Add family members with dietary needs. Terry will audit recipes and adjust meal plans to fit everyone.
          </Text>

          {profiles.map((p) => (
            <View key={p.id} style={[styles.profileCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.profileHeader}>
                <Text style={[styles.profileName, { color: colors.text }]}>{p.name}</Text>
                <Pressable onPress={() => handleRemoveProfile(p.id)} hitSlop={8}>
                  <Text style={{ color: colors.danger, fontSize: 14, fontWeight: '700' }}>✕</Text>
                </Pressable>
              </View>
              <Text style={[styles.profileNeeds, { fontFamily: MONO, color: colors.primary }]}>{p.needs}</Text>
              {p.notes ? <Text style={[styles.profileNotes, { color: colors.textMuted }]}>{p.notes}</Text> : null}
            </View>
          ))}

          {editingProfile === 'new' ? (
            <ProfileEditor
              colors={colors}
              onSave={handleAddProfile}
              onCancel={() => setEditingProfile(null)}
            />
          ) : (
            <Pressable
              style={[styles.addProfileBtn, { borderColor: colors.primary }]}
              onPress={() => setEditingProfile('new')}
            >
              <Text style={[styles.addProfileText, { fontFamily: MONO, color: colors.primary }]}>+ ADD PROFILE</Text>
            </Pressable>
          )}
        </View>
        )}

        {/* ═══════════════════════════════════════════════════════════
            5. DATA
            ═══════════════════════════════════════════════════════════ */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionIcon}>{SECTION_ICONS.data}</Text>
            <Text style={[styles.sectionLabel, { fontFamily: MONO, color: colors.textMuted }]}>DATA</Text>
          </View>

          <Pressable
            style={[styles.collapseCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={() => setDataOpen(!dataOpen)}
          >
            <View style={styles.collapseRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.collapseTitle, { color: colors.text }]}>Manage stored data</Text>
                <Text style={[styles.collapseHint, { color: colors.textMuted }]}>
                  {appMode === 'server'
                    ? 'Clear data from this device and the server'
                    : 'Clear local data from this device'}
                </Text>
              </View>
              <Text style={[styles.collapseArrow, { color: colors.textMuted }]}>{dataOpen ? '▲' : '▼'}</Text>
            </View>
          </Pressable>

          {dataOpen && (
            <View style={[styles.collapseContent, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Pressable
                style={[styles.dataRow, { borderBottomColor: colors.border }]}
                onPress={() => confirmClear('shopping list', async () => { await clearList(); showModal('Done', 'Shopping list cleared.', [{ text: 'OK', primary: true }]); })}
              >
                <Text style={[styles.dataRowText, { color: colors.text }]}>Clear Shopping List</Text>
                <Text style={[styles.dataRowArrow, { color: colors.textMuted }]}>›</Text>
              </Pressable>
              <Pressable
                style={[styles.dataRow, { borderBottomColor: colors.border }]}
                onPress={() => confirmClear('chat history', async () => { await clearHistory(); showModal('Done', 'Chat history cleared.', [{ text: 'OK', primary: true }]); })}
              >
                <Text style={[styles.dataRowText, { color: colors.text }]}>Clear Chat History</Text>
                <Text style={[styles.dataRowArrow, { color: colors.textMuted }]}>›</Text>
              </Pressable>
              <Pressable
                style={[styles.dataRow, { borderBottomColor: colors.border }]}
                onPress={() => confirmClear('meal plan', async () => { await clearMealPlan(); showModal('Done', 'Meal plan cleared.', [{ text: 'OK', primary: true }]); })}
              >
                <Text style={[styles.dataRowText, { color: colors.text }]}>Clear Meal Plan</Text>
                <Text style={[styles.dataRowArrow, { color: colors.textMuted }]}>›</Text>
              </Pressable>
              <Pressable
                style={[styles.dataRow, { borderBottomColor: colors.border }]}
                onPress={() => confirmClear('cooking stats', async () => { await clearStats(); showModal('Done', 'Cooking stats cleared.', [{ text: 'OK', primary: true }]); })}
              >
                <Text style={[styles.dataRowText, { color: colors.text }]}>Clear Cooking Stats</Text>
                <Text style={[styles.dataRowArrow, { color: colors.textMuted }]}>›</Text>
              </Pressable>
              <Pressable
                style={styles.dataRow}
                onPress={() => confirmClear('kitchen log', async () => { await clearCookbook(); showModal('Done', 'Kitchen log cleared.', [{ text: 'OK', primary: true }]); })}
              >
                <Text style={[styles.dataRowText, { color: colors.text }]}>Clear Kitchen Log</Text>
                <Text style={[styles.dataRowArrow, { color: colors.textMuted }]}>›</Text>
              </Pressable>
              <View style={{ marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: colors.border }}>
                <Text style={[styles.collapseHint, { color: colors.textMuted, marginBottom: 12, paddingHorizontal: 4 }]}>
                  {appMode === 'server'
                    ? 'Permanently remove all recipes, meal plans, chat history, shopping lists, dietary profiles, cooking stats, and settings from this device and the server.'
                    : 'Permanently remove all recipes, meal plans, chat history, shopping lists, dietary profiles, cooking stats, and settings from this device.'}
                </Text>
                <Pressable
                  style={[styles.dataRow, { borderBottomWidth: 0 }]}
                  onPress={() => {
                    showModal(
                      'Delete All Data?',
                      appMode === 'server'
                        ? 'This will permanently remove all your data from this device AND the server. This cannot be undone.'
                        : 'This will permanently remove all your data from this device. This cannot be undone.',
                      [
                        { text: 'Cancel', onPress: () => {} },
                        {
                          text: 'DELETE EVERYTHING',
                          primary: true,
                          onPress: async () => {
                            try {
                              await resetApp();
                              showModal('Done', appMode === 'server' ? 'All data has been deleted from this device and the server.' : 'All data has been deleted from this device.', [{ text: 'OK', primary: true }]);
                            } catch (e) {
                              showModal('Error', String(e?.message || e), [{ text: 'OK', primary: true }]);
                            }
                          },
                        },
                      ]
                    );
                  }}
                >
                  <Text style={[styles.dataRowText, { color: colors.danger || '#FF4444', fontWeight: '900', letterSpacing: 0.5 }]}>
                    Delete All Data
                  </Text>
                  <Text style={[styles.dataRowArrow, { color: colors.danger || '#FF4444' }]}>›</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>

        {/* ═══════════════════════════════════════════════════════════
            6. DEVELOPER
            ═══════════════════════════════════════════════════════════ */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionIcon}>{SECTION_ICONS.developer}</Text>
            <Text style={[styles.sectionLabel, { fontFamily: MONO, color: colors.textMuted }]}>DEVELOPER</Text>
          </View>

          <Pressable
            style={[styles.collapseCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={handleDevToggle}
          >
            <View style={styles.collapseRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.collapseTitle, { color: colors.text }]}>Server & AI configuration</Text>
                <Text style={[styles.collapseHint, { color: colors.textMuted }]}>Connection, model settings, and app reset</Text>
              </View>
              <Text style={[styles.collapseArrow, { color: colors.textMuted }]}>{devOpen ? '▲' : '▼'}</Text>
            </View>
          </Pressable>
          {devOpen && (
            <>
              {/* Server */}
              <View style={{ marginTop: 16 }}>
                <Text style={[styles.subLabel, { color: colors.text2 }]}>SERVER</Text>
                <View style={[styles.infoCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <View style={styles.infoRow}>
                    <Text style={[styles.infoLabel, { color: colors.textMuted }]}>Mode</Text>
                    <Text style={[styles.infoValue, { fontFamily: MONO, color: colors.primary }]}>
                      {appMode === 'local' ? '● LOCAL' : '● SERVER'}
                    </Text>
                  </View>
                  {appMode === 'server' && (
                    <View style={styles.infoRow}>
                      <Text style={[styles.infoLabel, { color: colors.textMuted }]}>URL</Text>
                      <Text style={[styles.infoValue, { fontFamily: MONO, fontSize: 12, color: colors.text }]} numberOfLines={1}>
                        {url || 'Not set'}
                      </Text>
                    </View>
                  )}
                </View>

                <TextInput
                  style={[styles.input, { fontFamily: MONO, fontSize: 13, backgroundColor: colors.surface, borderColor: colors.border, color: colors.text, marginTop: 10 }]}
                  value={url}
                  onChangeText={setUrl}
                  placeholder="http://192.168.1.50:3000"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                />
                <Pressable
                  style={[styles.testBtn, { backgroundColor: colors.primary }, testing && styles.disabled]}
                  onPress={saveAndTest}
                  disabled={testing}
                >
                  <Text style={[styles.testBtnText, { fontFamily: MONO, color: colors.onPrimary }]}>
                    {testing ? 'TESTING…' : 'SAVE & TEST CONNECTION'}
                  </Text>
                </Pressable>
                {status && (
                  <Text style={[styles.statusText, { fontFamily: MONO, color: status.ok ? colors.primary : colors.danger }]}>
                    {status.message}
                  </Text>
                )}
                <Pressable
                  style={[styles.testBtn, { borderColor: colors.border, borderWidth: 1.5, backgroundColor: 'transparent', marginTop: 8 }]}
                  onPress={saveCurrentServer}
                >
                  <Text style={[styles.testBtnText, { fontFamily: MONO, color: colors.text }]}>SAVE THIS SERVER</Text>
                </Pressable>

                {/* Saved Servers */}
                {savedServers.length > 0 && (
                  <View style={{ marginTop: 16 }}>
                    <Text style={[styles.subLabel, { color: colors.text2, marginBottom: 8 }]}>SAVED SERVERS</Text>
                    {savedServers.map((server) => {
                      const isActive = url === server.url;
                      return (
                        <View
                          key={server.url}
                          style={[styles.infoCard, {
                            backgroundColor: isActive ? (colors.primary + '15') : colors.surface,
                            borderColor: isActive ? colors.primary : colors.border,
                            marginBottom: 8,
                          }]}
                        >
                          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                            <View style={{ flex: 1, marginRight: 8 }}>
                              <Text style={[styles.infoValue, { fontFamily: MONO, fontSize: 12, color: isActive ? colors.primary : colors.text }]} numberOfLines={1}>
                                {server.url}
                              </Text>
                              {isActive && (
                                <Text style={[styles.statusText, { fontFamily: MONO, color: colors.primary, marginTop: 2 }]}>● ACTIVE</Text>
                              )}
                            </View>
                            <View style={{ flexDirection: 'row', gap: 6 }}>
                              {!isActive && (
                                <Pressable
                                  style={[styles.testBtn, { backgroundColor: colors.primary, paddingHorizontal: 12, paddingVertical: 6, marginTop: 0 }]}
                                  onPress={() => connectToServer(server.url)}
                                >
                                  <Text style={[styles.testBtnText, { fontFamily: MONO, color: colors.onPrimary, fontSize: 11 }]}>CONNECT</Text>
                                </Pressable>
                              )}
                              <Pressable
                                style={[styles.testBtn, { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border, paddingHorizontal: 8, paddingVertical: 6, marginTop: 0 }]}
                                onPress={() => removeSavedServer(server.url)}
                              >
                                <Text style={[styles.testBtnText, { fontFamily: MONO, color: colors.textMuted, fontSize: 11 }]}>✕</Text>
                              </Pressable>
                            </View>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}

                <Pressable
                  style={[styles.testBtn, { borderColor: colors.border, borderWidth: 1.5, backgroundColor: 'transparent', marginTop: 8 }]}
                  onPress={() => navigation.navigate('Setup', { switching: true })}
                >
                  <Text style={[styles.testBtnText, { fontFamily: MONO, color: colors.text }]}>SWITCH MODE</Text>
                </Pressable>
              </View>

              {/* AI Status */}
              {!noAI && (
              <View style={{ marginTop: 20 }}>
                <Text style={[styles.subLabel, { color: colors.text2 }]}>AI ASSISTANT</Text>
                <View style={[styles.infoCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <View style={styles.infoRow}>
                    <Text style={[styles.infoLabel, { color: colors.textMuted }]}>Status</Text>
                    <Text style={[styles.infoValue, { color: aiStatus?.configured ? colors.primary : colors.danger }]}>
                      {aiStatus?.configured ? '● Connected' : '○ Not configured'}
                    </Text>
                  </View>

                  {/* Server mode: show server's configured models (only when not using custom AI) */}
                  {appMode === 'server' && !useCustomAI && (
                    <>
                      <View style={[styles.infoRow, { marginTop: 6 }]}>
                        <Text style={[styles.infoLabel, { color: colors.textMuted }]}>Text Model</Text>
                        <Text style={[styles.infoValue, { fontFamily: MONO, color: colors.text, fontSize: 12 }]}>{aiStatus?.textModel || 'not set'}</Text>
                      </View>
                      <View style={styles.infoRow}>
                        <Text style={[styles.infoLabel, { color: colors.textMuted }]}>Vision Model</Text>
                        <Text style={[styles.infoValue, { fontFamily: MONO, color: colors.text, fontSize: 12 }]}>{aiStatus?.visionModel || 'not set'}</Text>
                      </View>
                      <Pressable
                        style={[styles.modelChangeBtn, { borderColor: colors.primary, marginTop: 12 }]}
                        onPress={() => discoverModels('text')}
                        disabled={loadingModels}
                      >
                        <Text style={[styles.modelChangeText, { fontFamily: MONO, color: colors.primary }]}>
                          {loadingModels && showModelPicker !== 'vision' ? 'DISCOVERING…' : 'CHANGE TEXT MODEL'}
                        </Text>
                      </Pressable>
                      <Pressable
                        style={[styles.modelChangeBtn, { borderColor: colors.primary, marginTop: 8 }]}
                        onPress={() => discoverModels('vision')}
                        disabled={loadingModels}
                      >
                        <Text style={[styles.modelChangeText, { fontFamily: MONO, color: colors.primary }]}>
                          {loadingModels && showModelPicker !== 'text' ? 'DISCOVERING…' : 'CHANGE VISION MODEL'}
                        </Text>
                      </Pressable>
                    </>
                  )}

                  {/* Custom AI: show models with change buttons */}
                  {useCustomAI && (
                    <>
                      <View style={[styles.divider, { backgroundColor: colors.border }]} />
                      <View style={styles.infoRow}>
                        <Text style={[styles.infoLabel, { color: colors.textMuted }]}>Text Model</Text>
                        <Text style={[styles.infoValue, { fontFamily: MONO, color: colors.text, fontSize: 12 }]}>{textProvider.model}</Text>
                      </View>
                      <View style={styles.infoRow}>
                        <Text style={[styles.infoLabel, { color: colors.textMuted }]}>Vision Model</Text>
                        <Text style={[styles.infoValue, { fontFamily: MONO, color: colors.text, fontSize: 12 }]}>{visionProvider.model}</Text>
                      </View>
                      <Pressable
                        style={[styles.modelChangeBtn, { borderColor: colors.primary, marginTop: 10 }]}
                        onPress={() => discoverModels('text')}
                        disabled={loadingModels}
                      >
                        <Text style={[styles.modelChangeText, { fontFamily: MONO, color: colors.primary }]}>
                          {loadingModels ? 'DISCOVERING…' : 'CHANGE MODELS'}
                        </Text>
                      </Pressable>
                    </>
                  )}

                  {/* Legacy keys fallback */}
                  {!aiStatus?.configured && !useCustomAI && (
                    <Text style={[styles.hint, { color: colors.textMuted, marginTop: 8 }]}>
                      Set DEEPSEEK_API_KEY in server/.env (or provide keys in Local mode) to enable AI.
                    </Text>
                  )}
                </View>

                {/* Model picker dropdown */}
                {showModelPicker && (
                  <View style={[styles.modelPicker, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <View style={styles.modelPickerHeader}>
                      <Text style={[styles.subLabel, { color: colors.text2, marginBottom: 0 }]}>
                        SELECT {showModelPicker === 'text' ? 'TEXT' : 'VISION'} MODEL
                      </Text>
                      <Pressable onPress={() => setShowModelPicker(null)} hitSlop={12} style={{ padding: 4 }}>
                        <Text style={{ color: colors.textMuted, fontSize: 18, fontWeight: '700' }}>✕</Text>
                      </Pressable>
                    </View>
                    <ScrollView style={{ maxHeight: 250 }} nestedScrollEnabled>
                      {(showModelPicker === 'text' ? textModels : visionModels).map((m) => {
                        // In server mode, compare against server's model; in local/custom mode, against provider state
                        const current = appMode === 'server' && !useCustomAI
                          ? (showModelPicker === 'text' ? aiStatus?.textModel : aiStatus?.visionModel)
                          : (showModelPicker === 'text' ? textProvider.model : visionProvider.model);
                        const active = m.id === current;
                        return (
                          <Pressable
                            key={m.id}
                            style={[styles.modelItem, { borderBottomColor: colors.border }, active && { backgroundColor: colors.primary + '15' }]}
                            onPress={() => selectModel(showModelPicker, m.id)}
                          >
                            <Text style={[styles.modelItemText, { fontFamily: MONO, color: active ? colors.primary : colors.text }]} numberOfLines={1}>
                              {m.name}
                            </Text>
                            {active && <Text style={{ color: colors.primary, fontWeight: '900', fontSize: 12 }}>✓</Text>}
                          </Pressable>
                        );
                      })}
                      {(showModelPicker === 'text' ? textModels : visionModels).length === 0 && (
                        <Text style={[styles.hint, { color: colors.textMuted, padding: 16 }]}>
                          No models found. Check your API key and URL.
                        </Text>
                      )}
                    </ScrollView>
                  </View>
                )}
              </View>
              )}

              {/* Local mode API keys */}
              {appMode === 'local' && !noAI && (
                <View style={{ marginTop: 20 }}>
                  <Text style={[styles.subLabel, { color: colors.text2 }]}>API KEYS (LOCAL MODE)</Text>
                  <View style={[styles.infoCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <Text style={[styles.subLabel, { color: colors.text2, marginTop: 0 }]}>DEEPSEEK API KEY</Text>
                    <TextInput
                      style={[styles.input, { fontFamily: MONO, fontSize: 13, backgroundColor: colors.background, borderColor: colors.border, color: colors.text }]}
                      value={deepseekKey}
                      onChangeText={setDeepseekKeyState}
                      placeholder="sk-..."
                      placeholderTextColor={colors.textMuted}
                      autoCapitalize="none"
                      autoCorrect={false}
                      secureTextEntry
                    />
                    <Text style={[styles.subLabel, { color: colors.text2, marginTop: 10 }]}>GOOGLE API KEY (VISION)</Text>
                    <TextInput
                      style={[styles.input, { fontFamily: MONO, fontSize: 13, backgroundColor: colors.background, borderColor: colors.border, color: colors.text }]}
                      value={googleKey}
                      onChangeText={setGoogleKeyState}
                      placeholder="AIza..."
                      placeholderTextColor={colors.textMuted}
                      autoCapitalize="none"
                      autoCorrect={false}
                      secureTextEntry
                    />
                    <Pressable
                      style={[styles.testBtn, { backgroundColor: colors.primary }]}
                      onPress={async () => {
                        await setDeepSeekKey(deepseekKey.trim());
                        await setGoogleKey(googleKey.trim());
                        showModal('Saved', 'API keys updated.', [{ text: 'OK', primary: true }]);
                      }}
                    >
                      <Text style={[styles.testBtnText, { fontFamily: MONO, color: colors.onPrimary }]}>SAVE API KEYS</Text>
                    </Pressable>
                  </View>
                </View>
              )}

              {/* Reset App */}
              <View style={{ marginTop: 24 }}>
                <Pressable
                  style={[styles.dangerBtn, { backgroundColor: colors.danger, borderWidth: 0 }]}
                  onPress={() => {
                    showModal(
                      'Reset Entire App?',
                      appMode === 'server'
                        ? 'This wipes everything — setup, server URL, themes, data, local DB, and all server data. The app will restart fresh.'
                        : 'This wipes everything — setup, server URL, themes, data, local DB. The app will restart fresh.',
                      [
                        { text: 'CANCEL' },
                        {
                          text: 'RESET',
                          destructive: true,
                          filled: true,
                          onPress: async () => {
                            try {
                              await resetApp();
                              showModal('Done', 'All data cleared. Close and reopen the app.', [{ text: 'OK', primary: true }]);
                            } catch (e) {
                              showModal('Reset Failed', String(e?.message || e), [{ text: 'OK' }]);
                            }
                          },
                        },
                      ]
                    );
                  }}
                >
                  <Text style={[styles.testBtnText, { fontFamily: MONO, color: '#fff' }]}>RESET APP</Text>
                </Pressable>
              </View>
            </>
          )}
        </View>
      </ScrollView>

      {/* Custom confirm/alert modal */}
      <AppModal
        visible={!!modal}
        title={modal?.title}
        message={modal?.message}
        buttons={modal?.buttons ?? []}
        colors={colors}
        onClose={() => setModal(null)}
      />

    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingBottom: 0 },
  backBtn: { width: 38, height: 38, borderRadius: 10, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  screenTitle: { fontSize: 19, fontWeight: '900', letterSpacing: 0.5 },
  section: { paddingHorizontal: 20, paddingTop: 24 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  sectionIcon: { fontSize: 14 },
  sectionLabel: { fontSize: 10, letterSpacing: 1, marginBottom: 0 },
  sectionToggle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  subLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, marginBottom: 8 },
  segment: { flexDirection: 'row', borderWidth: 1.5, borderRadius: 12, padding: 4, gap: 4 },
  segmentItem: { flex: 1, paddingVertical: 12, borderRadius: 9, alignItems: 'center' },
  segmentText: { fontSize: 11, letterSpacing: 1 },
  themeScroll: { gap: 10, paddingVertical: 4 },
  themeCard: {
    width: 120,
    borderWidth: 1.5,
    borderRadius: 14,
    padding: 8,
    alignItems: 'center',
    gap: 8,
    position: 'relative',
  },
  themePreview: {
    width: '100%',
    height: 70,
    borderRadius: 8,
    overflow: 'hidden',
  },
  previewBar: { height: 16, paddingHorizontal: 6, justifyContent: 'center', borderBottomWidth: 1 },
  previewContent: { flex: 1, padding: 6, gap: 4, justifyContent: 'center', alignItems: 'center' },
  previewLine: { height: 4, borderRadius: 2 },
  previewDot: { width: 10, height: 10, borderRadius: 5 },
  themeName: { fontSize: 10, letterSpacing: 0.5 },
  themeCheck: { position: 'absolute', top: 6, right: 6, width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  oledSection: { marginTop: 14 },
  oledGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  oledDot: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 3 },
  input: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 14 },
  hint: { fontSize: 12, lineHeight: 19, marginTop: 8 },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  toggleLabel: { fontSize: 13, fontWeight: '600' },
  divider: { height: 1, marginVertical: 12 },
  testBtn: { marginTop: 12, borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  testBtnText: { fontSize: 12, letterSpacing: 1 },
  statusText: { marginTop: 10, fontSize: 12, letterSpacing: 1, textAlign: 'center' },
  disabled: { opacity: 0.6 },
  infoCard: { borderWidth: 1.5, borderRadius: 12, padding: 16 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  infoLabel: { fontSize: 13 },
  infoValue: { fontSize: 13, fontWeight: '600' },
  dangerBtn: { borderWidth: 1.5, borderRadius: 10, paddingVertical: 14, paddingHorizontal: 16, marginBottom: 8 },
  dangerBtnText: { fontSize: 14, fontWeight: '500' },
  // Collapsible sections
  collapseCard: { borderWidth: 1.5, borderRadius: 12, padding: 14 },
  collapseRow: { flexDirection: 'row', alignItems: 'center' },
  collapseTitle: { fontSize: 13, fontWeight: '600' },
  collapseHint: { fontSize: 11, marginTop: 2 },
  collapseArrow: { fontSize: 11, marginLeft: 10 },
  collapseContent: { borderWidth: 1.5, borderRadius: 12, marginTop: 8, overflow: 'hidden' },
  dataRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1 },
  dataRowText: { fontSize: 14, fontWeight: '500' },
  dataRowArrow: { fontSize: 18, fontWeight: '300' },
  // About card
  aboutCard: { borderWidth: 1.5, borderRadius: 14, overflow: 'hidden' },
  aboutRow: { flexDirection: 'row', alignItems: 'center', padding: 16 },
  aboutName: { fontSize: 24, fontWeight: '900', letterSpacing: -0.5 },
  aboutTagline: { fontSize: 13, lineHeight: 20, marginTop: 4 },
  versionBadge: { borderWidth: 1.5, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  versionText: { fontSize: 11, letterSpacing: 1, fontWeight: '700' },
  aboutMeta: { borderTopWidth: 1, paddingHorizontal: 16, paddingVertical: 10 },
  aboutMetaText: { fontSize: 12, letterSpacing: 0.5 },
  // Profile
  profileCard: { borderWidth: 1.5, borderRadius: 12, padding: 14, marginBottom: 8 },
  profileHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  profileName: { fontSize: 15, fontWeight: '900' },
  profileNeeds: { fontSize: 12, letterSpacing: 0.5, marginTop: 4 },
  profileNotes: { fontSize: 12, lineHeight: 18, marginTop: 4 },
  addProfileBtn: { borderWidth: 1.5, borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  addProfileText: { fontSize: 11, letterSpacing: 1 },
  // Permissions
  permBadge: { borderWidth: 1.5, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 5 },
  permBadgeText: { fontSize: 11, letterSpacing: 1, fontWeight: '900' },
  permBtn: { borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  permBtnText: { fontSize: 11, letterSpacing: 1, fontWeight: '900' },
  // Model picker
  modelChangeBtn: { borderWidth: 1.5, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  modelChangeText: { fontSize: 11, letterSpacing: 1, fontWeight: '700' },
  modelPicker: { borderWidth: 1.5, borderRadius: 14, marginTop: 10, overflow: 'hidden' },
  modelPickerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, paddingBottom: 8 },
  modelItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 14, borderBottomWidth: 1 },
  modelItemText: { fontSize: 13, flex: 1, marginRight: 8 },
  // Terry's Crib
  terryCard: { borderWidth: 1.5, borderRadius: 16, overflow: 'hidden' },
  terryPhoto: { width: '100%', height: 300 },
  terryInfo: { padding: 16, paddingBottom: 0 },
  terryName: { fontSize: 22, fontWeight: '900', letterSpacing: -0.5 },
  terryTitle: { fontSize: 10, letterSpacing: 1, marginTop: 4 },
  terryStats: { flexDirection: 'row', padding: 16, borderTopWidth: 1, gap: 12 },
  terryStat: { flex: 1, alignItems: 'center' },
  terryStatNum: { fontSize: 28, fontWeight: '900' },
  terryStatLabel: { fontSize: 9, letterSpacing: 1, marginTop: 2, textAlign: 'center' },
  terryDiary: { padding: 16, borderTopWidth: 1 },
  terryDiaryLabel: { fontSize: 10, letterSpacing: 1, marginBottom: 10 },
  terryDiaryText: { fontSize: 13, lineHeight: 22, fontStyle: 'italic' },
  terryReviews: { padding: 16, borderTopWidth: 1, gap: 10 },
  terryReview: { fontSize: 13, lineHeight: 20, fontStyle: 'italic' },
  terryClose: { margin: 16, borderWidth: 1.5, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  terryCloseText: { fontSize: 10, letterSpacing: 1 },
});
