import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import { useAi } from '../aiContext';

const TABS = [
  { key: 'assistant', label: 'Terry', screen: 'Assistant', icon: 'chatbubble-outline', iconActive: 'chatbubble', aiOnly: true },
  { key: 'shopping', label: 'Shop', screen: 'ShoppingList', icon: 'cart-outline', iconActive: 'cart' },
  { key: 'recipes', label: 'Recipes', screen: 'RecipeList', icon: 'restaurant-outline', iconActive: 'restaurant' },
  { key: 'planner', label: 'Plan', screen: 'MealPlanner', icon: 'calendar-outline', iconActive: 'calendar' },
  { key: 'cookbook', label: 'Kitchen Log', screen: 'Cookbook', icon: 'book-outline', iconActive: 'book' },
];

export default function BottomNav({ active, navigation }) {
  const { colors } = useTheme();
  const { noAI } = useAi();
  const insets = useSafeAreaInsets();
  const tabs = noAI ? TABS.filter((t) => !t.aiOnly) : TABS;

  return (
    <View style={[styles.wrapper, { paddingBottom: Math.max(12, insets.bottom - 8) }]}>
      <View style={[
        styles.nav,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
        },
      ]}>
        {tabs.map((t) => {
          const isActive = t.key === active;
          return (
            <Pressable
              key={t.key}
              style={styles.tab}
              onPress={() => {
                if (!isActive) {
                  navigation.navigate(t.screen);
                }
              }}
              hitSlop={6}
            >
              <Ionicons
                name={isActive ? t.iconActive : t.icon}
                size={22}
                color={isActive ? colors.primary : colors.textMuted}
              />
              <Text style={[
                styles.label,
                {
                  color: isActive ? colors.primary : colors.textMuted,
                  opacity: isActive ? 1 : 0.6,
                },
              ]}>
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  nav: {
    flexDirection: 'row',
    borderWidth: 1.5,
    borderRadius: 28,
    paddingTop: 10,
    paddingBottom: 8,
    paddingHorizontal: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
  },
  label: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
});
