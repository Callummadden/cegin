import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { api } from '../api';
import { MONO, useTheme } from '../theme';
import { subscribe } from '../wsSync';
import { getShoppingList, addItems, addItemsGrouped, toggleItem, deleteItem, removeChecked, clearList } from '../shoppingList';
import BottomNav from '../components/BottomNav';
import AppModal from '../components/AppModal';
import { useToast } from '../components/Toast';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAi } from '../aiContext';
import { useResponsive } from '../utils/responsive';
import SwipeableRow from '../components/SwipeableRow';

export default function ShoppingListScreen({ navigation }) {
  const { colors } = useTheme();
  const { s, fs } = useResponsive();
  const { noAI } = useAi();
  const styles = useMemo(() => makeStyles(colors, s, fs), [colors, s, fs]);
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();


  const [items, setItems] = useState([]);
  const pendingDeleteRef = useRef(null); // { timeoutId, item }
  const [refreshing, setRefreshing] = useState(false);
  const [input, setInput] = useState('');
  const [pickingRecipes, setPickingRecipes] = useState(false);
  const [pickSearch, setPickSearch] = useState('');
  const [recipes, setRecipes] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [aiLoading, setAiLoading] = useState(false);
  const [modal, setModal] = useState(null);
  const [quickItem, setQuickItem] = useState(null);
  const [quickItemCategory, setQuickItemCategory] = useState(null);
  const [quickQty, setQuickQty] = useState('');
  const [quickMenuOpen, setQuickMenuOpen] = useState(false);
  const [quickCustom, setQuickCustom] = useState('');
  const [myItems, setMyItems] = useState([]);
  const [quickCategory, setQuickCategory] = useState(null);
  const [editingItem, setEditingItem] = useState(null); // { name, category, isBuiltIn }
  const [editName, setEditName] = useState('');
  const [editCat, setEditCat] = useState('');
  const [overrides, setOverrides] = useState({}); // { [originalName]: { name?, category?, hidden? } }


  // Clean up pending delete timeout on unmount
  useEffect(() => {
    return () => {
      if (pendingDeleteRef.current?.timeoutId) {
        clearTimeout(pendingDeleteRef.current.timeoutId);
      }
    };
  }, []);

  const handleSwipeDelete = useCallback((item) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // If there's already a pending delete, finalize it immediately
    if (pendingDeleteRef.current) {
      clearTimeout(pendingDeleteRef.current.timeoutId);
      deleteItem(pendingDeleteRef.current.item.id);
    }

    // Capture original index before removing
    const originalIndex = items.findIndex((i) => i.id === item.id);

    // Optimistically remove from displayed list
    setItems((prev) => prev.filter((i) => i.id !== item.id));

    // Schedule actual deletion in 3 seconds
    const timeoutId = setTimeout(async () => {
      await deleteItem(item.id);
      pendingDeleteRef.current = null;
    }, 3000);

    pendingDeleteRef.current = { timeoutId, item };

    // Show undo toast
    showToast({
      message: `"${item.text}" removed`,
      actionLabel: 'UNDO',
      duration: 3500,
      onAction: () => {
        // Undo: cancel deletion, restore item at original position
        if (pendingDeleteRef.current?.timeoutId) {
          clearTimeout(pendingDeleteRef.current.timeoutId);
        }
        pendingDeleteRef.current = null;
        setItems((prev) => {
          const next = [...prev];
          const idx = Math.min(originalIndex, next.length);
          next.splice(idx, 0, item);
          return next;
        });
        showToast({ message: 'Restored', duration: 1500 });
      },
    });
  }, [showToast, items]);
  const loadMyItems = async () => {
    const raw = await AsyncStorage.getItem('cegin_quick_items');
    setMyItems(raw ? JSON.parse(raw) : []);
    const rawOvr = await AsyncStorage.getItem('cegin_quick_overrides');
    setOverrides(rawOvr ? JSON.parse(rawOvr) : {});
  };

  const saveMyItems = async (items) => {
    setMyItems(items);
    await AsyncStorage.setItem('cegin_quick_items', JSON.stringify(items));
  };

  const saveOverrides = async (ovr) => {
    setOverrides(ovr);
    await AsyncStorage.setItem('cegin_quick_overrides', JSON.stringify(ovr));
  };

  const ALL_BUILT_IN = ['Milk', 'Butter', 'Cheese', 'Eggs', 'Cream', 'Yoghurt', 'Sour cream', 'Cream cheese', 'Parmesan', 'Mozzarella', 'Chicken', 'Mince', 'Bacon', 'Sausages', 'Steak', 'Salmon', 'Prawns', 'Ham', 'Lamb', 'Turkey', 'Onions', 'Garlic', 'Tomatoes', 'Potatoes', 'Carrots', 'Peppers', 'Mushrooms', 'Broccoli', 'Spinach', 'Avocado', 'Lemons', 'Limes', 'Bananas', 'Apples', 'Berries', 'Ginger', 'Chillies', 'Courgette', 'Aubergine', 'Sweet potato', 'Rice', 'Pasta', 'Bread', 'Flour', 'Sugar', 'Olive oil', 'Vegetable oil', 'Tinned tomatoes', 'Passata', 'Stock cubes', 'Soy sauce', 'Vinegar', 'Honey', 'Tinned beans', 'Chickpeas', 'Lentils', 'Noodles', 'Couscous', 'Oats', 'Baking powder', 'Salt', 'Pepper', 'Oregano', 'Basil', 'Thyme', 'Cumin', 'Paprika', 'Cinnamon', 'Chilli powder', 'Turmeric', 'Bay leaves', 'Rosemary', 'Coriander', 'Mixed herbs', 'Garlic powder', 'Ketchup', 'Mayo', 'Mustard', 'Hot sauce', 'Worcestershire sauce', 'Pesto', 'Marmite', 'Jam', 'Peanut butter', 'Sweet chilli', 'Frozen peas', 'Frozen sweetcorn', 'Frozen pizza', 'Ice cream', 'Frozen chips', 'Frozen berries', 'Frozen garlic bread', 'Crisps', 'Biscuits', 'Chocolate', 'Nuts', 'Dried fruit', 'Cereal', 'Coffee', 'Tea', 'Tortilla wraps', 'Pitta bread'];

  const addMyItem = async (category) => {
    const name = quickCustom.trim();
    if (!name) return;
    // Check custom items
    if (myItems.some((i) => i.name.toLowerCase() === name.toLowerCase())) {
      setModal({ title: 'Already exists', message: `"${name}" is already in your items.`, buttons: [{ text: 'OK', primary: true }] });
      return;
    }
    // Check built-in items
    if (ALL_BUILT_IN.some((i) => i.toLowerCase() === name.toLowerCase())) {
      setModal({ title: 'Already exists', message: `"${name}" is already in the default list.`, buttons: [{ text: 'OK', primary: true }] });
      return;
    }
    await saveMyItems([...myItems, { name, category }]);
    setQuickCustom('');
    setQuickCategory(null);
  };

  const startEditItem = (item) => {
    setEditingItem(item);
    setEditName(item.name);
    setEditCat(item.category);
  };

  const saveEditItem = async () => {
    if (!editName.trim()) return;
    if (editingItem.isBuiltIn) {
      const ovr = { ...overrides };
      ovr[editingItem.originalName || editingItem.name] = { name: editName.trim(), category: editCat };
      await saveOverrides(ovr);
    } else {
      const updated = myItems.map((i) =>
        i.name === editingItem.name ? { name: editName.trim(), category: editCat } : i
      );
      await saveMyItems(updated);
    }
    setEditingItem(null);
  };

  const hideItem = async (name) => {
    const ovr = { ...overrides };
    ovr[name] = { hidden: true };
    await saveOverrides(ovr);
    setEditingItem(null);
  };

  const removeMyItem = async (name) => {
    await saveMyItems(myItems.filter((i) => i.name !== name));
  };

  const CATEGORIES = ['DAIRY & EGGS', 'MEAT & FISH', 'FRUIT & VEG', 'PANTRY', 'HERBS & SPICES', 'SAUCES & CONDIMENTS', 'FROZEN', 'DRY GOODS & SNACKS'];

  const load = useCallback(async (forceRefresh = false) => {
    const list = await getShoppingList(forceRefresh);
    setItems(list);
    loadMyItems();
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    const unsub = subscribe('shopping_list', () => load(true));
    return unsub;
  }, [load]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  }, [load]);

  const checkedCount = items.filter((i) => i.checked).length;

  const handleAdd = async () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    // Support adding multiple items separated by newlines
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const updated = await addItems(lines);
    setItems(updated);
  };

  const handleToggle = async (id) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const updated = await toggleItem(id);
    setItems(updated);
  };

  const handleClearChecked = async () => {
    if (!checkedCount) return;
    const updated = await removeChecked();
    setItems(updated);
  };

  const handleClearAll = () => {
    if (!items.length) return;
    setModal({
      title: 'Clear List',
      message: 'Remove all items?',
      buttons: [
        { text: 'CANCEL' },
        { text: 'CLEAR', destructive: true, filled: true, onPress: async () => setItems(await clearList()) },
      ],
    });
  };

  const startSmartList = async () => {
    try {
      const recs = await api.listRecipes();
      setRecipes(recs);
      setSelectedIds(new Set());
      setPickingRecipes(true);
    } catch (e) {
      setModal({ title: 'Error', message: e.message, buttons: [{ text: 'OK', primary: true }] });
    }
  };

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const generateSmartList = async () => {
    if (!selectedIds.size) return;
    setPickingRecipes(false);
    setAiLoading(true);
    try {
      const result = await api.aiShoppingList([...selectedIds]);
      if (result.categories?.length) {
        await addItemsGrouped(result.categories);
        setItems(await getShoppingList());
      }
      setModal({
        title: 'Shopping List Ready',
        message: (result.categories || []).map((c) => `${c.name}: ${c.items.length} items`).join('\n'),
        buttons: [{ text: 'OK', primary: true }],
      });
    } catch (e) {
      setModal({ title: 'Error', message: e.message, buttons: [{ text: 'OK', primary: true }] });
    } finally {
      setAiLoading(false);
    }
  };

  // Group unchecked items by category for display
  const listData = useMemo(() => {
    const unchecked = items.filter((i) => !i.checked);
    const checked = items.filter((i) => i.checked);

    if (!unchecked.length && !checked.length) return [];
    const result = [];
    // Group unchecked by category
    const byCat = {};
    for (const item of unchecked) {
      const cat = item.category || 'Other';
      if (!byCat[cat]) byCat[cat] = [];
      byCat[cat].push(item);
    }
    // If there are categories, show headers
    const hasCats = Object.keys(byCat).length > 1 || (Object.keys(byCat).length === 1 && Object.keys(byCat)[0] !== 'Other');
    if (hasCats) {
      for (const [cat, catItems] of Object.entries(byCat)) {
        result.push({ id: `cat-${cat}`, isHeader: true, label: cat });
        result.push(...catItems);
      }
    } else {
      result.push(...unchecked);
    }
    if (checked.length) {
      result.push({ id: 'cat-checked', isHeader: true, label: 'CHECKED' });
      result.push(...checked);
    }
    return result;
  }, [items]);

  if (pickingRecipes) {
    const q = pickSearch.toLowerCase().trim();
    const filteredRecipes = q
      ? recipes.filter(r => r.title.toLowerCase().includes(q) || (r.tags || []).some(t => t.toLowerCase().includes(q)))
      : recipes;
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <View style={[styles.floatingTop, { paddingTop: 20 + insets.top }]}>
          <View style={[styles.topNav, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Pressable style={[styles.backBtn, { borderColor: colors.border }]} onPress={() => { setPickingRecipes(false); setPickSearch(''); }}>
                <Text style={{ fontSize: 17, color: colors.text }}>←</Text>
              </Pressable>
              <Text style={[styles.title, { color: colors.text }]}>PICK RECIPES</Text>
            </View>
            <View style={[styles.searchBar, { borderColor: colors.border, backgroundColor: colors.surface, marginHorizontal: 0, marginTop: 8, marginBottom: 0 }]}>
              <Text style={{ color: colors.textMuted, fontSize: 14, marginRight: 6 }}>🔍</Text>
              <TextInput
                style={[styles.searchInput, { color: colors.text }]}
                placeholder="Search recipes..."
                placeholderTextColor={colors.textMuted}
                value={pickSearch}
                onChangeText={setPickSearch}
                autoCorrect={false}
              />
              {pickSearch.length > 0 && (
                <Pressable onPress={() => setPickSearch('')} hitSlop={8}>
                  <Text style={{ color: colors.textMuted, fontSize: 14 }}>✕</Text>
                </Pressable>
              )}
            </View>
          </View>
        </View>
        <FlatList
          data={filteredRecipes}
          keyExtractor={(r) => String(r.id)}
          contentContainerStyle={styles.pickList}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={5}
          removeClippedSubviews={true}
          renderItem={({ item }) => {
            const sel = selectedIds.has(item.id);
            return (
              <Pressable style={[styles.pickItem, { borderColor: sel ? colors.primary : colors.border }]} onPress={() => toggleSelect(item.id)}>
                <View style={[styles.checkbox, { borderColor: sel ? colors.primary : colors.border, backgroundColor: sel ? 'rgba(255,90,38,0.14)' : 'transparent' }]}>
                  {sel && <Text style={{ color: colors.primary, fontSize: 11, fontWeight: '700' }}>✓</Text>}
                </View>
                <Text style={[styles.pickTitle, { color: colors.text }]}>{item.title}</Text>
              </Pressable>
            );
          }}
        />
        {selectedIds.size > 0 && (
          <Pressable style={[styles.generateBtn, { backgroundColor: colors.primary }]} onPress={generateSmartList}>
            <Text style={[styles.generateBtnText, { color: colors.onPrimary }]}>
              GENERATE LIST ({selectedIds.size} recipes)
            </Text>
          </Pressable>
        )}
        <BottomNav active="shopping" navigation={navigation} />
      </View>
    );
  }

  if (aiLoading) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: 20 + insets.top }]}>
          <Text style={[styles.title, { color: colors.text }]}>SHOPPING LIST</Text>
        </View>
        <View style={styles.empty}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.emptyHint, { fontFamily: MONO, color: colors.textMuted, marginTop: 16 }]}>
            AI IS CONSOLIDATING INGREDIENTS...
          </Text>
        </View>
        <BottomNav active="shopping" navigation={navigation} />
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Floating top nav */}
      <View style={[styles.floatingTop, { paddingTop: 20 + insets.top }]}>
        <View style={[styles.topNav, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={[styles.title, { color: colors.text }]}>SHOPPING LIST</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {!noAI && (
                <Pressable onPress={startSmartList} style={[styles.smartBtn, { borderColor: colors.primary }]}>
                  <Text style={[styles.smartBtnText, { fontFamily: MONO, color: colors.primary }]}>AUTO</Text>
                </Pressable>
              )}
              <Pressable
                style={[styles.quickMenuBtn, { borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 14, paddingVertical: 8 }]}
                onPress={() => setQuickMenuOpen(true)}
              >
                <Text style={[styles.quickMenuBtnText, { fontFamily: MONO, color: colors.text2 }]}>⚡</Text>
              </Pressable>
            </View>
          </View>
          <View style={[styles.addRow, { borderColor: colors.border, marginHorizontal: 0, marginTop: 8 }]}>
            <TextInput
              style={[styles.addInput, { fontFamily: MONO, color: colors.text }]}
              value={input}
              onChangeText={setInput}
              placeholder="+ add items (one per line)"
              placeholderTextColor={colors.textMuted}
              onSubmitEditing={handleAdd}
              returnKeyType="done"
              multiline
            />
            <Pressable style={[styles.addBtn, { backgroundColor: colors.primary }]} onPress={handleAdd}>
              <Text style={[styles.addBtnText, { color: colors.onPrimary }]}>+</Text>
            </Pressable>
          </View>
        </View>
      </View>

      {/* List */}
      <FlatList
        data={listData}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={5}
        removeClippedSubviews={true}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
            progressViewOffset={175}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>🛒</Text>
            <Text style={[styles.emptyTitle, { color: colors.textMuted }]}>Your list is empty</Text>
            <Text style={[styles.emptyHint, { fontFamily: MONO, color: colors.textMuted }]}>
              Use Quick Add or add from recipes
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          if (item.isHeader) {
            return (
              <Text style={[styles.catHeader, { fontFamily: MONO, color: colors.primary }]}>
                {item.label.toUpperCase()}
              </Text>
            );
          }
          return (
            <SwipeableRow onDelete={() => handleSwipeDelete(item)} colors={colors}>
              <Pressable style={[styles.item, { borderBottomColor: colors.border }]} onPress={() => handleToggle(item.id)}>
                <View style={[styles.checkbox, {
                  borderColor: item.checked ? colors.primary : colors.border,
                  backgroundColor: item.checked ? 'rgba(255,90,38,0.14)' : 'transparent',
                }]}>
                  {item.checked && <Text style={{ color: colors.primary, fontSize: 11, fontWeight: '700' }}>✓</Text>}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.itemText, {
                    color: item.checked ? colors.textMuted : colors.text,
                    textDecorationLine: item.checked ? 'line-through' : 'none',
                  }]}>
                    {item.text}
                  </Text>
                  {!!item.source && (
                    <Text style={[styles.itemSource, { color: colors.textMuted }]}>{item.source}</Text>
                  )}
                </View>
              </Pressable>
            </SwipeableRow>
          );
        }}
        ListFooterComponent={
          checkedCount > 0 ? (
            <Pressable style={[styles.clearBtn, { borderColor: colors.border }]} onPress={handleClearChecked}>
              <Text style={[styles.clearText, { fontFamily: MONO, color: colors.textMuted }]}>
                CLEAR {checkedCount} CHECKED
              </Text>
            </Pressable>
          ) : null
        }
      />

      <AppModal
        visible={!!modal}
        title={modal?.title}
        message={modal?.message}
        buttons={modal?.buttons ?? []}
        colors={colors}
        onClose={() => setModal(null)}
      />

      {/* Quick add menu modal */}
      <Modal visible={quickMenuOpen} animationType="slide" transparent onRequestClose={() => setQuickMenuOpen(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <View style={styles.quickMenuOverlay}>
          <Pressable style={styles.quickMenuBg} onPress={() => setQuickMenuOpen(false)} />
          <View style={[styles.quickMenuPanel, { backgroundColor: colors.surface }]}>
            <View style={[styles.panelHandle, { backgroundColor: colors.border }]} />
            <Text style={[styles.quickMenuTitle, { color: colors.text }]}>QUICK ADD</Text>
            {/* Search / add input */}
            <View style={[styles.quickCustomRow, { borderColor: colors.border, backgroundColor: colors.background }]}>
              <TextInput
                style={[styles.quickCustomInput, { color: colors.text }]}
                value={quickCustom}
                onChangeText={setQuickCustom}
                placeholder="Search or add your own..."
                placeholderTextColor={colors.textMuted}
                returnKeyType="done"
                onSubmitEditing={() => { if (quickCustom.trim()) setQuickCategory('pick'); }}
              />
              <Pressable
                style={[styles.quickCustomBtn, { backgroundColor: quickCustom.trim() ? colors.primary : colors.border }]}
                onPress={() => { if (quickCustom.trim()) setQuickCategory('pick'); }}
              >
                <Text style={[styles.quickCustomBtnText, { color: quickCustom.trim() ? colors.onPrimary : colors.textMuted }]}>+</Text>
              </Pressable>
            </View>

            {/* Category picker */}
            {quickCategory === 'pick' && (
              <View style={styles.quickCatPick}>
                <Text style={[styles.quickCatPickLabel, { fontFamily: MONO, color: colors.textMuted }]}>CHOOSE A CATEGORY</Text>
                <View style={styles.quickCatPickChips}>
                  {CATEGORIES.map((cat) => (
                    <Pressable
                      key={cat}
                      style={[styles.quickCatPickChip, { borderColor: colors.primary, backgroundColor: colors.background }]}
                      onPress={() => addMyItem(cat)}
                    >
                      <Text style={[styles.quickCatPickText, { color: colors.primary }]}>{cat}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
              {[
                { label: 'DAIRY & EGGS', items: ['Milk', 'Butter', 'Cheese', 'Eggs', 'Cream', 'Yoghurt', 'Sour cream', 'Cream cheese', 'Parmesan', 'Mozzarella'] },
                { label: 'MEAT & FISH', items: ['Chicken', 'Mince', 'Bacon', 'Sausages', 'Steak', 'Salmon', 'Prawns', 'Ham', 'Lamb', 'Turkey'] },
                { label: 'FRUIT & VEG', items: ['Onions', 'Garlic', 'Tomatoes', 'Potatoes', 'Carrots', 'Peppers', 'Mushrooms', 'Broccoli', 'Spinach', 'Avocado', 'Lemons', 'Limes', 'Bananas', 'Apples', 'Berries', 'Ginger', 'Chillies', 'Courgette', 'Aubergine', 'Sweet potato'] },
                { label: 'PANTRY', items: ['Rice', 'Pasta', 'Bread', 'Flour', 'Sugar', 'Olive oil', 'Vegetable oil', 'Tinned tomatoes', 'Passata', 'Stock cubes', 'Soy sauce', 'Vinegar', 'Honey', 'Tinned beans', 'Chickpeas', 'Lentils', 'Noodles', 'Couscous', 'Oats', 'Baking powder'] },
                { label: 'HERBS & SPICES', items: ['Salt', 'Pepper', 'Oregano', 'Basil', 'Thyme', 'Cumin', 'Paprika', 'Cinnamon', 'Chilli powder', 'Turmeric', 'Bay leaves', 'Rosemary', 'Coriander', 'Mixed herbs', 'Garlic powder'] },
                { label: 'SAUCES & CONDIMENTS', items: ['Ketchup', 'Mayo', 'Mustard', 'Hot sauce', 'Worcestershire sauce', 'Pesto', 'Marmite', 'Jam', 'Peanut butter', 'Sweet chilli'] },
                { label: 'FROZEN', items: ['Frozen peas', 'Frozen sweetcorn', 'Frozen pizza', 'Ice cream', 'Frozen chips', 'Frozen berries', 'Frozen garlic bread'] },
                { label: 'DRY GOODS & SNACKS', items: ['Crisps', 'Biscuits', 'Chocolate', 'Nuts', 'Dried fruit', 'Cereal', 'Coffee', 'Tea', 'Tortilla wraps', 'Pitta bread'] },
              ].map((cat) => {
                // Get built-in items with overrides applied
                const builtInItems = cat.items
                  .filter((item) => !overrides[item]?.hidden)
                  .filter((item) => {
                    // Don't show items that were moved to a different category
                    const ovr = overrides[item];
                    return !ovr?.category || ovr.category === cat.label;
                  })
                  .map((item) => {
                    const ovr = overrides[item];
                    return {
                      name: ovr?.name || item,
                      originalName: item,
                      category: cat.label,
                      isBuiltIn: true,
                    };
                  });

                // Also show items moved TO this category from elsewhere
                const movedHere = Object.entries(overrides)
                  .filter(([orig, ovr]) => ovr.category === cat.label && ovr.name && !cat.items.includes(orig) && !ovr.hidden)
                  .map(([orig, ovr]) => ({ name: ovr.name, originalName: orig, category: cat.label, isBuiltIn: true }));

                // Custom items in this category
                const customInCat = myItems.filter((m) => m.category === cat.label);

                const allItems = [...builtInItems, ...movedHere, ...customInCat.map((m) => ({ ...m, isBuiltIn: false }))];

                // Filter by search text
                const q = quickCustom.trim().toLowerCase();
                const filtered = q ? allItems.filter((item) => item.name.toLowerCase().includes(q)) : allItems;
                if (filtered.length === 0) return null;

                return (
                  <View key={cat.label} style={styles.quickMenuCat}>
                    <Text style={[styles.quickMenuCatLabel, { fontFamily: MONO, color: colors.primary }]}>{cat.label}</Text>
                    <View style={styles.quickMenuChips}>
                      {filtered.map((item) => (
                        <Pressable
                          key={item.name}
                          style={[
                            styles.quickMenuChip,
                            { borderColor: item.isBuiltIn ? colors.border : colors.primary, backgroundColor: item.isBuiltIn ? colors.background : 'rgba(255,90,38,0.08)' },
                          ]}
                          onPress={() => { setQuickMenuOpen(false); setQuickItem(item.name); setQuickItemCategory(item.category || cat.label); setQuickQty(''); }}
                          onLongPress={() => startEditItem(item)}
                          delayLongPress={400}
                        >
                          <Text style={[styles.quickMenuChipText, { color: item.isBuiltIn ? colors.text2 : colors.primary }]}>{item.name}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Edit item modal */}
      <Modal visible={!!editingItem} transparent animationType="fade" onRequestClose={() => setEditingItem(null)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <Pressable style={styles.quickOverlay} onPress={() => setEditingItem(null)}>
          <Pressable style={[styles.quickCard, { backgroundColor: colors.surface, borderColor: colors.border }]} onPress={() => {}}>
            <View style={styles.editHeader}>
              <Text style={[styles.quickTitle, { color: colors.text, marginBottom: 0 }]}>Edit Item</Text>
              <Pressable onPress={() => setEditingItem(null)} hitSlop={8}>
                <Text style={{ color: colors.textMuted, fontSize: 18, fontWeight: '700' }}>✕</Text>
              </Pressable>
            </View>

            <Text style={[styles.editLabel, { fontFamily: MONO, color: colors.textMuted }]}>NAME</Text>
            <TextInput
              style={[styles.quickInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
              value={editName}
              onChangeText={setEditName}
              autoFocus
            />

            <Text style={[styles.editLabel, { fontFamily: MONO, color: colors.textMuted }]}>CATEGORY</Text>
            <View style={styles.editCatChips}>
              {CATEGORIES.map((cat) => (
                <Pressable
                  key={cat}
                  style={[styles.editCatChip, { borderColor: editCat === cat ? colors.primary : colors.border, backgroundColor: editCat === cat ? 'rgba(255,90,38,0.14)' : 'transparent' }]}
                  onPress={() => setEditCat(cat)}
                >
                  <Text style={[styles.editCatText, { fontFamily: MONO, color: editCat === cat ? colors.primary : colors.textMuted }]}>{cat}</Text>
                </Pressable>
              ))}
            </View>

            <View style={[styles.editActions, { borderTopColor: colors.border }]}>
              <Pressable
                style={[styles.editDeleteBtn, { borderColor: colors.danger }]}
                onPress={async () => {
                  if (editingItem?.isBuiltIn) {
                    await hideItem(editingItem.originalName || editingItem.name);
                  } else {
                    await removeMyItem(editingItem?.name);
                  }
                  setEditingItem(null);
                }}
              >
                <Text style={[styles.editDeleteText, { color: colors.danger }]}>DELETE</Text>
              </Pressable>
              <Pressable style={[styles.quickBtn, { backgroundColor: colors.primary }]} onPress={saveEditItem}>
                <Text style={[styles.quickBtnText, { color: colors.onPrimary }]}>SAVE</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      {/* Quick add quantity modal */}
      <Modal visible={!!quickItem} transparent animationType="fade" onRequestClose={() => setQuickItem(null)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <View style={styles.quickOverlay}>
          <View style={[styles.quickCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.quickTitle, { color: colors.text }]}>Add {quickItem}</Text>
            <Text style={[styles.quickHint, { color: colors.textMuted }]}>Tap a quick option or type below</Text>
            <ScrollView style={styles.quickQtyScroll} showsVerticalScrollIndicator={false}>
              {[
                { label: 'COUNT', items: ['1', '2', '3', '4', '5', '6', '12'] },
                { label: 'WEIGHT', items: ['100g', '250g', '500g', '1 kg', '2 kg'] },
                { label: 'VOLUME', items: ['100ml', '250ml', '500ml', '1 liter', '2 liters'] },
                { label: 'PACKAGING', items: ['1 pack', '1 tin', '1 jar', '1 bottle', '1 box', '1 bag', '1 can', '1 carton', '1 tub', '1 bar', '1 punnet', '1 bunch', '1 head'] },
                { label: 'COOKING', items: ['1 pinch', '1 tsp', '1 tbsp', '1 cup', '1 clove', '1 slice', '1 piece', '1 fillet'] },
              ].map((cat) => (
                <View key={cat.label} style={styles.quickCat}>
                  <Text style={[styles.quickCatLabel, { fontFamily: MONO, color: colors.textMuted }]}>{cat.label}</Text>
                  <View style={styles.quickCatChips}>
                    {cat.items.map((qty) => (
                      <Pressable
                        key={qty}
                        style={[styles.quickQtyChip, { borderColor: quickQty === qty ? colors.primary : colors.border, backgroundColor: quickQty === qty ? 'rgba(255,90,38,0.14)' : 'transparent' }]}
                        onPress={() => setQuickQty(qty)}
                      >
                        <Text style={[styles.quickQtyText, { fontFamily: MONO, color: quickQty === qty ? colors.primary : colors.textMuted }]}>{qty}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ))}
            </ScrollView>
            <TextInput
              style={[styles.quickInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
              value={quickQty}
              onChangeText={setQuickQty}
              placeholder="quantity"
              placeholderTextColor={colors.textMuted}
              autoFocus
            />
            <View style={styles.quickButtons}>
              <Pressable
                style={[styles.quickBtn, { borderColor: colors.border }]}
                onPress={() => setQuickItem(null)}
              >
                <Text style={[styles.quickBtnText, { color: colors.textMuted }]}>CANCEL</Text>
              </Pressable>
              <Pressable
                style={[styles.quickBtn, { backgroundColor: colors.primary }]}
                onPress={async () => {
                  const text = quickQty.trim() ? `${quickQty.trim()} ${quickItem}` : quickItem;
                  await addItemsGrouped([{ name: quickItemCategory || 'Other', items: [{ text }] }]);
                  setItems(await getShoppingList());
                  setQuickItem(null);
                }}
              >
                <Text style={[styles.quickBtnText, { color: colors.onPrimary }]}>ADD</Text>
              </Pressable>
            </View>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>

      <BottomNav active="shopping" navigation={navigation} />
    </View>
  );
}

const makeStyles = (colors, s, fs) => StyleSheet.create({
  root: { flex: 1 },
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
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20 },
  title: { fontSize: 18, fontWeight: '900', letterSpacing: 0.5 },
  smartBtn: {
    borderWidth: 1.5,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  smartBtnText: { fontSize: 11, letterSpacing: 1, fontWeight: '700' },
  backBtn: { width: 38, height: 38, borderRadius: 20, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1.5,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    padding: 0,
  },
  addRow: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginTop: 16,
    borderWidth: 1.5,
    borderRadius: 16,
    alignItems: 'center',
    paddingRight: 6,
  },
  addInput: { flex: 1, paddingHorizontal: 14, paddingVertical: 11, fontSize: 13 },
  addBtn: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  addBtnText: { fontSize: 20, fontWeight: '700' },
  quickBar: { paddingHorizontal: 20, marginTop: 10 },
  quickMenuBtn: { borderWidth: 1.5, borderRadius: 20, paddingVertical: 8, alignItems: 'center' },
  quickMenuBtnText: { fontSize: 12, letterSpacing: 1, fontWeight: '700' },
  quickMenuOverlay: { flex: 1 },
  quickMenuBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  quickMenuPanel: {
    maxHeight: '80%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    paddingHorizontal: 20,
  },
  panelHandle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 14 },
  quickMenuTitle: { fontSize: 18, fontWeight: '900', letterSpacing: 0.5, marginBottom: 14 },
  quickCustomRow: {
    flexDirection: 'row',
    borderWidth: 1.5,
    borderRadius: 12,
    marginBottom: 16,
    alignItems: 'center',
  },
  quickCustomInput: { flex: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14 },
  quickCustomBtn: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  quickCustomBtnText: { fontSize: 22, fontWeight: '700' },
  editLabel: { fontSize: 10, letterSpacing: 1.5, marginBottom: 6, marginTop: 4 },
  editHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  editCatChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 16 },
  editCatChip: { borderWidth: 1.5, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  editCatText: { fontSize: 10, letterSpacing: 0.5 },
  editActions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, paddingTop: 16 },
  editDeleteBtn: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12 },
  editDeleteText: { fontWeight: '900', fontSize: 12, letterSpacing: 1 },
  quickCatPick: { marginBottom: 16 },
  quickCatPickLabel: { fontSize: 10, letterSpacing: 1.5, marginBottom: 8 },
  quickCatPickChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  quickCatPickChip: { borderWidth: 1.5, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  quickCatPickText: { fontSize: 11, letterSpacing: 0.5, fontWeight: '600' },
  quickMenuCat: { marginBottom: 18 },
  quickMenuCatLabel: { fontSize: 10, letterSpacing: 1.5, marginBottom: 10 },
  quickMenuChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  quickMenuChip: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  quickMenuChipText: { fontSize: 13, fontWeight: '500' },
  list: { paddingHorizontal: 20, paddingTop: 175, paddingBottom: 100 },
  pickList: { paddingHorizontal: 20, paddingTop: 190, paddingBottom: 100 },
  catHeader: { fontSize: 11, letterSpacing: 1.5, marginTop: 16, marginBottom: 6 },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyState: { alignItems: 'center', paddingTop: 60, paddingBottom: 40 },
  emptyEmoji: { fontSize: 56, marginBottom: 16 },
  emptyTitle: { fontSize: 18, fontWeight: '900', letterSpacing: 0.5 },
  emptyHint: { fontSize: 11, marginTop: 8 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
    borderBottomWidth: 1,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  itemText: { fontSize: 15, lineHeight: 22 },
  itemSource: { fontSize: 11, marginTop: 1, fontStyle: 'italic' },
  clearBtn: {
    marginTop: 16,
    borderWidth: 1.5,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  clearText: { fontSize: 11, letterSpacing: 1 },
  pickItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1.5,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  pickTitle: { fontSize: 15, fontWeight: '600', flex: 1 },
  generateBtn: {
    marginHorizontal: 20,
    marginBottom: 70,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  generateBtnText: { fontWeight: '900', fontSize: 14, letterSpacing: 1 },
  // Quick add modal
  quickOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 30,
  },
  quickCard: {
    width: '100%',
    maxWidth: 320,
    borderWidth: 1.5,
    borderRadius: 20,
    padding: 24,
  },
  quickTitle: { fontSize: 20, fontWeight: '900', marginBottom: 8 },
  quickHint: { fontSize: 13, marginBottom: 12 },
  quickQtyScroll: { maxHeight: 280, marginBottom: 12 },
  quickCat: { marginBottom: 12 },
  quickCatLabel: { fontSize: 10, letterSpacing: 1.5, marginBottom: 6 },
  quickCatChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  quickQtyChip: { borderWidth: 1.5, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  quickQtyText: { fontSize: 12, letterSpacing: 0.5 },
  quickInput: {
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    marginBottom: 20,
  },
  quickButtons: { flexDirection: 'row', gap: 10 },
  quickBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  quickBtnText: { fontWeight: '900', fontSize: 13, letterSpacing: 1 },
});