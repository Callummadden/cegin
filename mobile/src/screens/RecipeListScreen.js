import { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api, getServerUrl } from '../api';
import { colors } from '../theme';

export default function RecipeListScreen({ navigation }) {
  const [recipes, setRecipes] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [configured, setConfigured] = useState(true);

  const load = useCallback(async (query) => {
    setLoading(true);
    setError(null);
    try {
      const url = await getServerUrl();
      setConfigured(!!url);
      if (!url) return;
      setRecipes(await api.listRecipes(query));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load(search);
    }, [load])
  );

  useEffect(() => {
    const t = setTimeout(() => load(search), 300);
    return () => clearTimeout(t);
  }, [search, load]);

  const renderItem = ({ item }) => (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={() => navigation.navigate('RecipeDetail', { id: item.id, title: item.title })}
    >
      <Text style={styles.cardTitle}>{item.title}</Text>
      {!!item.description && (
        <Text style={styles.cardDescription} numberOfLines={2}>
          {item.description}
        </Text>
      )}
      <View style={styles.cardMeta}>
        <Text style={styles.metaText}>
          ⏱ {item.prep_minutes + item.cook_minutes} min · 🍽 {item.servings}
        </Text>
        {item.tags.length > 0 && (
          <Text style={styles.metaText} numberOfLines={1}>
            {item.tags.map((t) => `#${t}`).join(' ')}
          </Text>
        )}
      </View>
    </Pressable>
  );

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.search}
        placeholder="Search recipes…"
        placeholderTextColor={colors.textMuted}
        value={search}
        onChangeText={setSearch}
      />
      {!configured ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No server configured.</Text>
          <Pressable style={styles.button} onPress={() => navigation.navigate('Settings')}>
            <Text style={styles.buttonText}>Open Settings</Text>
          </Pressable>
        </View>
      ) : error ? (
        <View style={styles.empty}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.button} onPress={() => load(search)}>
            <Text style={styles.buttonText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={recipes}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={() => load(search)} />
          }
          ListEmptyComponent={
            !loading && (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>
                  {search ? 'No recipes match your search.' : 'No recipes yet — add your first!'}
                </Text>
              </View>
            )
          }
        />
      )}
      <Pressable
        style={styles.fab}
        onPress={() => navigation.navigate('EditRecipe', {})}
      >
        <Text style={styles.fabText}>＋</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  search: {
    margin: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    fontSize: 16,
    color: colors.text,
  },
  list: { paddingHorizontal: 12, paddingBottom: 90 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardPressed: { opacity: 0.7 },
  cardTitle: { fontSize: 18, fontWeight: '600', color: colors.text },
  cardDescription: { marginTop: 4, color: colors.textMuted },
  cardMeta: {
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  metaText: { color: colors.textMuted, fontSize: 13, flexShrink: 1 },
  empty: { alignItems: 'center', marginTop: 48, paddingHorizontal: 24 },
  emptyText: { color: colors.textMuted, fontSize: 16, textAlign: 'center' },
  errorText: { color: colors.danger, fontSize: 15, textAlign: 'center' },
  button: {
    marginTop: 16,
    backgroundColor: colors.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
  },
  buttonText: { color: '#fff', fontWeight: '600' },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  fabText: { color: '#fff', fontSize: 28, lineHeight: 32 },
});
