import { useCallback, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api';
import { colors } from '../theme';

export default function RecipeDetailScreen({ route, navigation }) {
  const { id } = route.params;
  const [recipe, setRecipe] = useState(null);
  const [error, setError] = useState(null);

  useFocusEffect(
    useCallback(() => {
      api
        .getRecipe(id)
        .then((r) => {
          setRecipe(r);
          navigation.setOptions({ title: r.title });
        })
        .catch((e) => setError(e.message));
    }, [id])
  );

  const confirmDelete = () => {
    Alert.alert('Delete recipe', `Delete "${recipe.title}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteRecipe(id);
            navigation.goBack();
          } catch (e) {
            Alert.alert('Error', e.message);
          }
        },
      },
    ]);
  };

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }
  if (!recipe) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Loading…</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {!!recipe.description && <Text style={styles.description}>{recipe.description}</Text>}

      <View style={styles.metaRow}>
        <View style={styles.metaBox}>
          <Text style={styles.metaValue}>{recipe.prep_minutes}m</Text>
          <Text style={styles.metaLabel}>prep</Text>
        </View>
        <View style={styles.metaBox}>
          <Text style={styles.metaValue}>{recipe.cook_minutes}m</Text>
          <Text style={styles.metaLabel}>cook</Text>
        </View>
        <View style={styles.metaBox}>
          <Text style={styles.metaValue}>{recipe.servings}</Text>
          <Text style={styles.metaLabel}>serves</Text>
        </View>
      </View>

      {recipe.tags.length > 0 && (
        <View style={styles.tags}>
          {recipe.tags.map((tag) => (
            <View key={tag} style={styles.tag}>
              <Text style={styles.tagText}>{tag}</Text>
            </View>
          ))}
        </View>
      )}

      <Text style={styles.sectionTitle}>Ingredients</Text>
      {recipe.ingredients.map((item, i) => (
        <Text key={i} style={styles.listItem}>
          • {item}
        </Text>
      ))}

      <Text style={styles.sectionTitle}>Steps</Text>
      {recipe.steps.map((step, i) => (
        <View key={i} style={styles.step}>
          <Text style={styles.stepNumber}>{i + 1}</Text>
          <Text style={styles.stepText}>{step}</Text>
        </View>
      ))}

      <View style={styles.actions}>
        <Pressable
          style={[styles.button, styles.editButton]}
          onPress={() => navigation.navigate('EditRecipe', { recipe })}
        >
          <Text style={styles.buttonText}>Edit</Text>
        </Pressable>
        <Pressable style={[styles.button, styles.deleteButton]} onPress={confirmDelete}>
          <Text style={styles.buttonText}>Delete</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  muted: { color: colors.textMuted },
  errorText: { color: colors.danger, padding: 24, textAlign: 'center' },
  description: { fontSize: 16, color: colors.text, marginBottom: 16, lineHeight: 22 },
  metaRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  metaBox: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    paddingVertical: 10,
  },
  metaValue: { fontSize: 18, fontWeight: '700', color: colors.primary },
  metaLabel: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  tag: {
    backgroundColor: '#f3e3dc',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  tagText: { color: colors.primaryDark, fontSize: 13 },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
    marginTop: 20,
    marginBottom: 8,
  },
  listItem: { fontSize: 16, color: colors.text, lineHeight: 26 },
  step: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  stepNumber: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.primary,
    color: '#fff',
    textAlign: 'center',
    lineHeight: 26,
    fontWeight: '700',
    overflow: 'hidden',
  },
  stepText: { flex: 1, fontSize: 16, color: colors.text, lineHeight: 24 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 28 },
  button: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  editButton: { backgroundColor: colors.primary },
  deleteButton: { backgroundColor: colors.danger },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});
