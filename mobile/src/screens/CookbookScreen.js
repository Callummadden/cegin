import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useFocusEffect } from '@react-navigation/native';
import { MONO, useTheme } from '../theme';
import { getCookbook, deleteCookbookEntry, updateCookbookEntry, clearCookbook } from '../cookbook';
import { getStats, getTopRecipes, getCookingStreak } from '../stats';
import { api } from '../api';
import AppModal from '../components/AppModal';
import BottomNav from '../components/BottomNav';
import { useToast } from '../components/Toast';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';

const DELETE_WIDTH = 80;

const swipeStyles = StyleSheet.create({
  outer: { position: 'relative', overflow: 'hidden' },
  deleteBg: {
    position: 'absolute', top: 0, right: 0, bottom: 0,
    width: DELETE_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E5645B',
    borderRadius: 16,
    zIndex: 0,
  },
  deleteBtn: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
  },
  deleteText: { color: '#fff', fontWeight: '700', fontSize: 11 },
});

function SwipeableRow({ onDelete, children, colors }) {
  const translateX = useRef(new Animated.Value(0)).current;
  const isOpen = useRef(false);
  const onDeleteRef = useRef(onDelete);
  useEffect(() => { onDeleteRef.current = onDelete; }, [onDelete]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dx) > 12 && Math.abs(gs.dx) > Math.abs(gs.dy) * 1.5,
      onPanResponderMove: (_, gs) => {
        const next = isOpen.current ? -DELETE_WIDTH + gs.dx : gs.dx;
        translateX.setValue(Math.min(0, Math.max(-DELETE_WIDTH, next)));
      },
      onPanResponderRelease: (_, gs) => {
        const dx = isOpen.current ? -DELETE_WIDTH + gs.dx : gs.dx;
        if (dx < -60 || gs.vx < -0.5) {
          Animated.timing(translateX, { toValue: -DELETE_WIDTH, duration: 150, useNativeDriver: false }).start(() => {
            isOpen.current = false;
            translateX.setValue(0);
            onDeleteRef.current();
          });
        } else {
          Animated.spring(translateX, { toValue: 0, useNativeDriver: false, tension: 200, friction: 20 }).start();
          isOpen.current = false;
        }
      },
    })
  ).current;

  const closeAndDelete = () => {
    Animated.timing(translateX, { toValue: 0, duration: 200, useNativeDriver: false }).start(() => {
      isOpen.current = false;
      onDeleteRef.current();
    });
  };

  return (
    <View style={swipeStyles.outer}>
      <View style={swipeStyles.deleteBg}>
        <TouchableOpacity style={swipeStyles.deleteBtn} onPress={closeAndDelete} activeOpacity={0.7}>
          <Text style={swipeStyles.deleteText}>Delete</Text>
        </TouchableOpacity>
      </View>
      <Animated.View
        style={{ transform: [{ translateX }], backgroundColor: colors?.background || '#131010', zIndex: 1 }}
        {...panResponder.panHandlers}
      >
        {children}
      </Animated.View>
    </View>
  );
}

function formatDate(iso) {
  const d = new Date(iso);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

export default function CookbookScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();
  const pendingDeleteRef = useRef(null);

  const [entries, setEntries] = useState([]);
  const [modal, setModal] = useState(null);
  const [editingNotes, setEditingNotes] = useState(null); // entry id
  const [notesText, setNotesText] = useState('');
  const [fullscreenImage, setFullscreenImage] = useState(null);
  const [editEntry, setEditEntry] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [editPhotoUri, setEditPhotoUri] = useState(null);
  const [stats, setStats] = useState(null);
  const [recipes, setRecipes] = useState([]);
  const [topRecipes, setTopRecipes] = useState([]);
  const [streak, setStreak] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // Clean up pending delete timeout on unmount
  useEffect(() => {
    return () => {
      if (pendingDeleteRef.current?.timeoutId) {
        clearTimeout(pendingDeleteRef.current.timeoutId);
      }
    };
  }, []);

  const handleSwipeDelete = useCallback((entry) => {
    // If there's already a pending delete, finalize it immediately
    if (pendingDeleteRef.current) {
      clearTimeout(pendingDeleteRef.current.timeoutId);
      deleteCookbookEntry(pendingDeleteRef.current.entry.id);
    }

    // Optimistically remove from displayed list, capture index for undo
    let originalIndex = -1;
    setEntries((prev) => {
      originalIndex = prev.findIndex((e) => e.id === entry.id);
      return prev.filter((e) => e.id !== entry.id);
    });

    // Schedule actual deletion in 3 seconds
    const timeoutId = setTimeout(async () => {
      await deleteCookbookEntry(entry.id);
      pendingDeleteRef.current = null;
    }, 3000);

    pendingDeleteRef.current = { timeoutId, entry };

    // Show undo toast
    showToast({
      message: `"${entry.recipeTitle}" removed`,
      actionLabel: 'UNDO',
      duration: 3500,
      onAction: () => {
        // Undo: cancel deletion, restore entry
        if (pendingDeleteRef.current?.timeoutId) {
          clearTimeout(pendingDeleteRef.current.timeoutId);
        }
        pendingDeleteRef.current = null;
        setEntries((prev) => {
          const next = [...prev];
          const idx = originalIndex >= 0 && originalIndex <= next.length ? originalIndex : next.length;
          next.splice(idx, 0, entry);
          return next;
        });
        showToast({ message: 'Restored', duration: 1500 });
      },
    });
  }, [showToast]);

  const load = useCallback(async () => {
    const [list, s, r, t, st] = await Promise.all([
      getCookbook(),
      getStats(),
      api.listRecipes().catch(() => []),
      getTopRecipes(3),
      getCookingStreak(),
    ]);
    setEntries(list);
    setStats(s);
    setRecipes(r);
    setTopRecipes(t);
    setStreak(st);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const handleDelete = (entry) => {
    handleSwipeDelete(entry);
  };

  const startEditNotes = (entry) => {
    setEditingNotes(entry.id);
    setNotesText(entry.notes || '');
  };

  const saveNotes = async () => {
    await updateCookbookEntry(editingNotes, { notes: notesText.trim() });
    setEditingNotes(null);
    load();
  };

  const openEdit = (entry) => {
    setEditEntry(entry);
    setEditTitle(entry.recipeTitle);
    setEditPhotoUri(entry.imageUri || null);
  };

  const pickNewPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.8 });
    if (!result.canceled && result.assets?.[0]) {
      setEditPhotoUri(result.assets[0].uri);
    }
  };

  const saveEdit = async () => {
    if (!editEntry) return;
    await updateCookbookEntry(editEntry.id, {
      recipeTitle: editTitle.trim() || editEntry.recipeTitle,
      imageUri: editPhotoUri,
    });
    setEditEntry(null);
    load();
  };


  const handleClear = () => {
    setModal({
      title: 'Clear Cookbook',
      message: 'This will remove all entries. Photos will be kept on your device.',
      buttons: [
        { text: 'CANCEL' },
        {
          text: 'CLEAR ALL',
          destructive: true,
          filled: true,
          onPress: async () => {
            await clearCookbook();
            load();
          },
        },
      ],
    });
  };

  const renderEntry = ({ item }) => (
    <SwipeableRow onDelete={() => handleSwipeDelete(item)} colors={colors}>
      <Pressable onLongPress={() => openEdit(item)} delayLongPress={400}>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {item.imageUri ? (
          <Pressable onPress={() => setFullscreenImage(item.imageUri)}>
            <Image source={{ uri: item.imageUri }} style={styles.photo} contentFit="cover" />
          </Pressable>
        ) : (
          <View style={[styles.photoPlaceholder, { backgroundColor: colors.background }]}>
            <Text style={[styles.photoPlaceholderText, { color: colors.textMuted }]}>NO PHOTO</Text>
          </View>
        )}
        <View style={styles.cardContent}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>{item.recipeTitle}</Text>
          <Text style={[styles.cardDate, { fontFamily: MONO, color: colors.textMuted }]}>{formatDate(item.date)}</Text>
          {editingNotes === item.id ? (
            <View style={styles.notesEdit}>
              <TextInput
                style={[styles.notesInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
                value={notesText}
                onChangeText={setNotesText}
                placeholder="How did it turn out?"
                placeholderTextColor={colors.textMuted}
                multiline
                autoFocus
              />
              <Pressable style={[styles.notesSaveBtn, { backgroundColor: colors.primary }]} onPress={saveNotes}>
                <Text style={[styles.notesSaveText, { color: colors.onPrimary }]}>SAVE</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable onPress={() => startEditNotes(item)}>
              <Text style={[styles.cardNotes, { color: colors.text2 }]}>
                {item.notes || 'Tap to add notes...'}
              </Text>
            </Pressable>
          )}
        </View>
      </View>
      </Pressable>
    </SwipeableRow>
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: 20 + insets.top }]}>
        <Text style={[styles.screenTitle, { color: colors.text }]}>KITCHEN LOG</Text>
        <View style={[styles.streakBadge, { borderColor: streak > 0 ? colors.success : colors.border, backgroundColor: colors.surface }]}>
          <Text style={styles.streakEmoji}>🔥</Text>
          <Text style={[styles.streakNum, { fontFamily: MONO, color: streak > 0 ? colors.success : colors.textMuted }]}>{streak}</Text>
        </View>
      </View>

      {/* Stats row */}
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
          <Text style={[styles.heroNum, { color: colors.primary }]}>{entries.length}</Text>
          <Text style={[styles.heroLabel, { fontFamily: MONO, color: colors.textMuted }]}>PHOTOS</Text>
        </View>
      </View>

      {/* Top cooked */}
      {topRecipes.length > 0 && (
        <View style={styles.topSection}>
          <Text style={[styles.topSectionLabel, { fontFamily: MONO, color: colors.textMuted }]}>MOST COOKED</Text>
          {topRecipes.map((r, i) => (
            <View key={r.id} style={[styles.topRow, { borderBottomColor: colors.border }]}>
              <Text style={[styles.topRank, { color: colors.primary }]}>#{i + 1}</Text>
              <Text style={[styles.topTitle, { color: colors.text2 }]}>{r.title}</Text>
              <Text style={[styles.topCount, { fontFamily: MONO, color: colors.primary }]}>{r.count}x</Text>
            </View>
          ))}
        </View>
      )}

      {entries.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>🍽️</Text>
          <Text style={[styles.emptyTitle, { color: colors.textMuted }]}>NO MEALS YET</Text>
          <Text style={[styles.emptyHint, { fontFamily: MONO, color: colors.textMuted }]}>
            Complete a recipe and take a photo to start your cookbook.
          </Text>
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          renderItem={renderEntry}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          initialNumToRender={6}
          maxToRenderPerBatch={6}
          windowSize={5}
          removeClippedSubviews={true}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
            />
          }
        />
      )}

      <AppModal
        visible={!!modal}
        title={modal?.title}
        message={modal?.message}
        buttons={modal?.buttons ?? []}
        colors={colors}
        onClose={() => setModal(null)}
      />

      {/* Fullscreen image viewer */}
      <Modal visible={!!fullscreenImage} transparent animationType="fade" onRequestClose={() => setFullscreenImage(null)}>
        <Pressable style={styles.fullscreenOverlay} onPress={() => setFullscreenImage(null)}>
          <Image source={{ uri: fullscreenImage }} style={styles.fullscreenImage} contentFit="contain" />
        </Pressable>
      </Modal>
      {/* Edit entry modal */}
      <Modal visible={!!editEntry} transparent animationType="fade" onRequestClose={() => setEditEntry(null)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <Pressable style={styles.fullscreenOverlay} onPress={() => setEditEntry(null)}>
          <Pressable style={[styles.editCard, { backgroundColor: colors.surface, borderColor: colors.border }]} onPress={() => {}}>
            <Text style={[styles.editTitle, { fontFamily: MONO, color: colors.text }]}>EDIT ENTRY</Text>

            {editPhotoUri ? (
              <Image source={{ uri: editPhotoUri }} style={styles.editPhoto} contentFit="cover" />
            ) : (
              <View style={[styles.editPhotoPlaceholder, { backgroundColor: colors.background }]}>
                <Text style={{ color: colors.textMuted, fontSize: 11, letterSpacing: 1 }}>NO PHOTO</Text>
              </View>
            )}

            <Pressable style={[styles.editPhotoBtn, { borderColor: colors.primary }]} onPress={pickNewPhoto}>
              <Text style={[styles.editPhotoBtnText, { fontFamily: MONO, color: colors.primary }]}>CHANGE PHOTO</Text>
            </Pressable>

            <Text style={[styles.editLabel, { fontFamily: MONO, color: colors.textMuted }]}>TITLE</Text>
            <TextInput
              style={[styles.editInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
              value={editTitle}
              onChangeText={setEditTitle}
              placeholder="Recipe title"
              placeholderTextColor={colors.textMuted}
            />

            <View style={styles.editActions}>
              <Pressable style={[styles.editCancelBtn, { borderColor: colors.border }]} onPress={() => setEditEntry(null)}>
                <Text style={[styles.editCancelText, { fontFamily: MONO, color: colors.textMuted }]}>CANCEL</Text>
              </Pressable>
              <Pressable style={[styles.editSaveBtn, { backgroundColor: colors.primary }]} onPress={saveEdit}>
                <Text style={[styles.editSaveText, { color: colors.onPrimary }]}>SAVE</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
        </KeyboardAvoidingView>
      </Modal>


      <BottomNav active="cookbook" navigation={navigation} />
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 0,
  },
  backBtn: { width: 38, height: 38, borderRadius: 10, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  screenTitle: { fontSize: 19, fontWeight: '900', letterSpacing: 0.5 },
  clearBtn: { fontSize: 11, letterSpacing: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 80 },
  emptyEmoji: { fontSize: 64, marginBottom: 16 },
  emptyTitle: { fontSize: 18, fontWeight: '900', letterSpacing: 0.5 },
  emptyHint: { fontSize: 11, marginTop: 8, textAlign: 'center', paddingHorizontal: 40 },
  list: { padding: 20, paddingBottom: 100 },
  card: {
    borderWidth: 1.5,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 16,
  },
  photo: { width: '100%', height: 200 },
  photoPlaceholder: {
    width: '100%',
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoPlaceholderText: { fontSize: 10, letterSpacing: 1.5, fontWeight: '600' },
  cardContent: { padding: 16 },
  cardTitle: { fontSize: 18, fontWeight: '900' },
  cardDate: { fontSize: 11, letterSpacing: 1, marginTop: 4 },
  cardNotes: { fontSize: 14, lineHeight: 21, marginTop: 10, fontStyle: 'italic' },
  deleteBtn: { position: 'absolute', top: 12, right: 12, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 12, width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  notesEdit: { marginTop: 10 },
  notesInput: { borderWidth: 1.5, borderRadius: 10, padding: 12, fontSize: 14, minHeight: 60, textAlignVertical: 'top' },
  notesSaveBtn: { marginTop: 8, borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  notesSaveText: { fontWeight: '900', fontSize: 12, letterSpacing: 1 },
  // Stats
  heroRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, marginTop: 16 },
  heroCard: { flex: 1, borderWidth: 1.5, borderRadius: 14, padding: 14, alignItems: 'center' },
  heroNum: { fontSize: 28, fontWeight: '900' },
  heroLabel: { fontSize: 9, letterSpacing: 1.5, marginTop: 4 },
  streakBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1.5,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  streakEmoji: { fontSize: 14 },
  streakNum: { fontSize: 14, fontWeight: '900' },
  topSection: { paddingHorizontal: 20, marginTop: 16 },
  topSectionLabel: { fontSize: 10, letterSpacing: 1, marginBottom: 8 },
  topRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1 },
  topRank: { fontSize: 14, fontWeight: '900', width: 28 },
  topTitle: { fontSize: 14, flex: 1 },
  topCount: { fontSize: 13, fontWeight: '700' },
  // Fullscreen image
  fullscreenOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullscreenImage: {
    width: '100%',
    height: '100%',
  },
  // Edit modal
  editCard: {
    width: '85%',
    maxWidth: 360,
    borderRadius: 20,
    borderWidth: 1.5,
    padding: 24,
    alignItems: 'center',
  },
  editTitle: { fontSize: 11, letterSpacing: 1.5, fontWeight: '700', marginBottom: 20 },
  editPhoto: { width: '100%', height: 160, borderRadius: 12, marginBottom: 12 },
  editPhotoPlaceholder: {
    width: '100%',
    height: 160,
    borderRadius: 12,
    marginBottom: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editPhotoBtn: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10, marginBottom: 20 },
  editPhotoBtnText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  editLabel: { fontSize: 10, letterSpacing: 1.5, alignSelf: 'flex-start', marginBottom: 6 },
  editInput: { width: '100%', borderWidth: 1.5, borderRadius: 10, padding: 12, fontSize: 15, marginBottom: 20 },
  editActions: { flexDirection: 'row', gap: 12, width: '100%' },
  editCancelBtn: { flex: 1, borderWidth: 1.5, borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  editCancelText: { fontSize: 11, letterSpacing: 1 },
  editSaveBtn: { flex: 1, borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  editSaveText: { fontWeight: '900', fontSize: 12, letterSpacing: 1 },
});
