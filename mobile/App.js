import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Pressable, Text } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import RecipeListScreen from './src/screens/RecipeListScreen';
import RecipeDetailScreen from './src/screens/RecipeDetailScreen';
import EditRecipeScreen from './src/screens/EditRecipeScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import { colors } from './src/theme';

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <StatusBar style="dark" />
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerShadowVisible: false,
        }}
      >
        <Stack.Screen
          name="RecipeList"
          component={RecipeListScreen}
          options={({ navigation }) => ({
            title: 'Recipes',
            headerRight: () => (
              <Pressable onPress={() => navigation.navigate('Settings')} hitSlop={10}>
                <Text style={{ fontSize: 20 }}>⚙️</Text>
              </Pressable>
            ),
          })}
        />
        <Stack.Screen name="RecipeDetail" component={RecipeDetailScreen} options={{ title: '' }} />
        <Stack.Screen
          name="EditRecipe"
          component={EditRecipeScreen}
          options={({ route }) => ({
            title: route.params?.recipe ? 'Edit recipe' : 'New recipe',
          })}
        />
        <Stack.Screen name="Settings" component={SettingsScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
