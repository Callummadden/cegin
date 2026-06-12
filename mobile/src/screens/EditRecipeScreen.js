import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
} from 'react-native';
import { api } from '../api';
import { colors } from '../theme';

export default function EditRecipeScreen({ route, navigation }) {
  const existing = route.params?.recipe;
  const [title, setTitle] = useState(existing?.title ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [ingredients, setIngredients] = useState(existing?.ingredients.join('\n') ?? '');
  const [steps, setSteps] = useState(existing?.steps.join('\n') ?? '');
  const [tags, setTags] = useState(existing?.tags.join(', ') ?? '');
  const [prepMinutes, setPrepMinutes] = useState(String(existing?.prep_minutes ?? ''));
  const [cookMinutes, setCookMinutes] = useState(String(existing?.cook_minutes ?? ''));
  const [servings, setServings] = useState(String(existing?.servings ?? ''));
  const [saving, setSaving] = useState(false);

  const splitLines = (text) =>
    text.split('\n').map((line) => line.trim()).filter(Boolean);

  const save = async () => {
    if (!title.trim()) {
      Alert.alert('Missing title', 'Give the recipe a name.');
      return;
    }
    const recipe = {
      title: title.trim(),
      description: description.trim(),
      ingredients: splitLines(ingredients),
      steps: splitLines(steps),
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      prep_minutes: parseInt(prepMinutes, 10) || 0,
      cook_minutes: parseInt(cookMinutes, 10) || 0,
      servings: parseInt(servings, 10) || 1,
    };
    setSaving(true);
    try {
      if (existing) {
        await api.updateRecipe(existing.id, recipe);
      } else {
        await api.createRecipe(recipe);
      }
      navigation.goBack();
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.label}>Title</Text>
        <TextInput style={styles.input} value={title} onChangeText={setTitle} />

        <Text style={styles.label}>Description</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={description}
          onChangeText={setDescription}
          multiline
        />

        <Text style={styles.label}>Ingredients (one per line)</Text>
        <TextInput
          style={[styles.input, styles.tall]}
          value={ingredients}
          onChangeText={setIngredients}
          multiline
        />

        <Text style={styles.label}>Steps (one per line)</Text>
        <TextInput
          style={[styles.input, styles.tall]}
          value={steps}
          onChangeText={setSteps}
          multiline
        />

        <Text style={styles.label}>Tags (comma separated)</Text>
        <TextInput style={styles.input} value={tags} onChangeText={setTags} />

        <Text style={styles.label}>Prep minutes</Text>
        <TextInput
          style={styles.input}
          value={prepMinutes}
          onChangeText={setPrepMinutes}
          keyboardType="number-pad"
        />

        <Text style={styles.label}>Cook minutes</Text>
        <TextInput
          style={styles.input}
          value={cookMinutes}
          onChangeText={setCookMinutes}
          keyboardType="number-pad"
        />

        <Text style={styles.label}>Servings</Text>
        <TextInput
          style={styles.input}
          value={servings}
          onChangeText={setServings}
          keyboardType="number-pad"
        />

        <Pressable
          style={[styles.saveButton, saving && styles.saveButtonDisabled]}
          onPress={save}
          disabled={saving}
        >
          <Text style={styles.saveButtonText}>
            {saving ? 'Saving…' : existing ? 'Save changes' : 'Add recipe'}
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 48 },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textMuted,
    marginBottom: 6,
    marginTop: 14,
  },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.text,
  },
  multiline: { minHeight: 60, textAlignVertical: 'top' },
  tall: { minHeight: 120, textAlignVertical: 'top' },
  saveButton: {
    marginTop: 28,
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  saveButtonDisabled: { opacity: 0.6 },
  saveButtonText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
