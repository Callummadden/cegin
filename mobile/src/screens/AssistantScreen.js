import { useEffect, useMemo, useRef, useState, useCallback, memo } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Speech from 'expo-speech';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api';
import { MONO, useTheme } from '../theme';
import Markdown from '../components/Markdown';
import AppModal from '../components/AppModal';
import { getChatHistory, saveConversation, deleteConversation, formatRelativeTime } from '../chatHistory';
import { getMealPlan, MEALS } from '../mealPlan';
import { getDietaryProfiles } from '../dietProfiles';
import { getShoppingList } from '../shoppingList';
import { getCookbook } from '../cookbook';
import { getStats, getTopRecipes } from '../stats';
import BottomNav from '../components/BottomNav';
import AiDisclaimer from '../components/AiDisclaimer';
import { useAi } from '../aiContext';



// ─── Constants ───────────────────────────────────────────────────────────────

const TERRY_FRAMES = [
  require('../../assets/terry-closed.png'),
  require('../../assets/terry-half.png'),
  require('../../assets/terry-open.png'),
  require('../../assets/terry-half.png'),
];
const TERRY_THINKING = require('../../assets/terry-thinking.gif');
const TERRY_TALKING = require('../../assets/terry-talking.gif');
const TERRY_IDLE = require('../../assets/terry-idle.gif');

const QUICK_ACTIONS = [
  { label: '🍳 What can I make with what I have?', text: 'Based on my shopping list, what can I make with what I have?' },
  { label: '📅 Plan my week', text: 'Can you suggest a meal plan for the week based on my saved recipes and preferences?' },
  { label: '📊 What have I cooked the most?', text: 'What recipes have I cooked the most? Show me my cooking stats.' },
  { label: '🥗 Suggest something based on my diet', text: 'Suggest recipes that fit my dietary profiles and preferences.' },
  { label: '🎉 What should I bring to a potluck?', text: 'What should I bring to a potluck? Give me 3 crowd-pleasing ideas.' },
  { label: '🌡️ Convert 200°C to Fahrenheit', text: 'Convert 200°C to Fahrenheit' },
];

const TERRY_MOODS = [
  'Craving pasta today…',
  'Thinking about dessert…',
  'Hungry for tacos…',
  'Dreaming of sourdough…',
  'Wondering about curry…',
  'In the mood for stir-fry…',
  'Contemplating chocolate…',
  'Yearning for ramen…',
  'Pondering pizza toppings…',
  'Fantasizing about fresh bread…',
  'Craving something spicy…',
  'Thinking about brunch…',
];

const TERRY_FACTS = [
  '🍅 Tomatoes were once considered poisonous in Europe!',
  '🧅 Cutting onions under running water helps reduce tears.',
  '🍫 Chocolate was once used as currency by the Aztecs.',
  '🥕 Carrots were originally purple, not orange!',
  '🍯 Honey never spoils — 3000-year-old honey is still edible.',
  '🧀 There are over 1,800 types of cheese worldwide.',
  '🌶️ Capsaicin in chillis actually reduces inflammation.',
  '🥑 Avocados are technically berries!',
  '🍋 A lemon has more sugar than a strawberry.',
  '🧄 Garlic is a natural antibiotic used for thousands of years.',
  '🍳 The world record for omelette making is 427 in 30 minutes.',
  '🌽 Each ear of corn has an even number of rows — always!',
  '🫒 Olive oil can be used to polish furniture too.',
  '🥦 Broccoli contains more protein per calorie than steak.',
  '🧈 Butterflies taste with their feet — and so does Terry! 🐾',
  '🍞 Bread was so important in ancient Egypt it was used to pay workers.',
  '🥚 A hen can lay about 300 eggs per year.',
  '🍷 The oldest known recipe in the world is for beer.',
];

const GREETING = {
  role: 'assistant',
  content:
    "Meow~ I'm Chef Terry, your feline culinary companion! 🐾🍳\n\nI know my way around the kitchen — from tricky conversions to creative recipes. Ask me to suggest dishes, swap ingredients, plan your meals, or anything food-related. I'm always hungry for a good question!",
};

// ─── Utilities ───────────────────────────────────────────────────────────────

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function formatTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ─── Animated typing indicator ───────────────────────────────────────────────

function TypingDots({ color }) {
  const dots = [
    useRef(new Animated.Value(0)).current,
    useRef(new Animated.Value(0)).current,
    useRef(new Animated.Value(0)).current,
  ];
  useEffect(() => {
    const anims = dots.map((d, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 150),
          Animated.timing(d, { toValue: -6, duration: 200, useNativeDriver: true }),
          Animated.timing(d, { toValue: 0, duration: 200, useNativeDriver: true }),
        ]),
      ),
    );
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
  }, []);
  return (
    <View style={styles.dotsRow}>
      {dots.map((d, i) => (
        <Animated.View key={i} style={[styles.dot, { backgroundColor: color, transform: [{ translateY: d }] }]} />
      ))}
    </View>
  );
}

// ─── Terry avatar ────────────────────────────────────────────────────────────

function TerryAvatar({ style, onPress, showGif, small }) {
  const gifSource = showGif === 'talking' ? TERRY_TALKING : showGif === 'thinking' ? TERRY_THINKING : TERRY_IDLE;

  return (
    <Pressable style={style} onPress={onPress} hitSlop={8}>
      <Image source={gifSource} style={[styles.terryGifImg, small && styles.terryGifImgSmall]} contentFit="cover" />
    </Pressable>
  );
}

// ─── History picker modal ────────────────────────────────────────────────────

function HistoryModal({ visible, onClose, history, onSelect, onDelete, colors }) {
  const [confirmDelete, setConfirmDelete] = useState(null);
  const renderHistoryItem = useCallback(({ item }) => (
    <View style={[styles.historyItem, { borderBottomColor: colors.border }]}>
      <Pressable style={{ flex: 1 }} onPress={() => { onSelect(item); onClose(); }}>
        <Text style={[styles.historyItemTitle, { color: colors.text }]} numberOfLines={1}>
          {item.title}
        </Text>
        <View style={styles.historyMeta}>
          <Text style={[styles.historyItemDate, { fontFamily: MONO, color: colors.textMuted }]}>
            {formatRelativeTime(item.timestamp)}
          </Text>
          <Text style={[styles.historyItemDate, { fontFamily: MONO, color: colors.textMuted }]}>
            {item.messages?.length || 0} messages
          </Text>
        </View>
      </Pressable>
      <Pressable hitSlop={12} onPress={() => setConfirmDelete(item)} style={{ padding: 6 }}>
        <Text style={{ color: colors.danger, fontSize: 18 }}>×</Text>
      </Pressable>
    </View>
  ), [colors, onSelect, onClose]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.menuOverlay} onPress={onClose}>
        <Pressable style={[styles.historySheet, { backgroundColor: colors.surface, borderColor: colors.border }]} onPress={(e) => e.stopPropagation()}>
          <Text style={[styles.historyTitle, { color: colors.text }]}>PAST CONVERSATIONS</Text>
          <FlatList
            data={history}
            keyExtractor={(c) => c.id}
            style={{ maxHeight: 400 }}
            keyboardShouldPersistTaps="handled"
            renderItem={renderHistoryItem}
            ListEmptyComponent={
              <Text style={[styles.historyEmpty, { fontFamily: MONO, color: colors.textMuted }]}>
                No saved conversations
              </Text>
            }
          />
        </Pressable>
      </Pressable>

      <AppModal
        visible={!!confirmDelete}
        title="Delete Conversation?"
        message={`"${confirmDelete?.title}" will be permanently removed.`}
        onClose={() => setConfirmDelete(null)}
        colors={colors}
        buttons={[
          { text: 'CANCEL', onPress: () => {} },
          { text: 'DELETE', destructive: true, filled: true, onPress: () => { onDelete(confirmDelete.id); setConfirmDelete(null); } },
        ]}
      />
    </Modal>
  );
}

// ─── Message bubble (memoized) ───────────────────────────────────────────────

function looksLikeRecipe(text) {
  const lower = text.toLowerCase();
  const hasIngredients = lower.includes('ingredient');
  const hasSteps = lower.includes('step') || lower.includes('instruction') || lower.includes('method') || lower.includes('direction');
  return hasIngredients && hasSteps;
}

const MessageBubble = memo(function MessageBubble({ item, index, colors, speakingMsgIdx, speakMessage, onSaveRecipe, savingRecipe, userRecipes, onNavigateRecipe }) {
  const isUser = item.role === 'user';
  const showSaveBtn = !isUser && looksLikeRecipe(item.content);

  // Find matching saved recipes mentioned in Terry's message
  const matchedRecipes = [];
  if (!isUser && userRecipes?.length) {
    const lower = item.content.toLowerCase();
    for (const r of userRecipes) {
      if (r.title && lower.includes(r.title.toLowerCase()) && !matchedRecipes.find((m) => m.id === r.id)) {
        matchedRecipes.push(r);
      }
    }
  }

  return (
    <View style={[styles.bubbleRow, isUser && { justifyContent: 'flex-end' }]}>
      {!isUser && (
        <Image
          source={TERRY_FRAMES[0]}
          style={[styles.msgAvatar, { borderColor: colors.border }]}
        />
      )}
      <View style={{ flex: 1, alignItems: isUser ? 'flex-end' : 'flex-start' }}>
        <View
          style={[
            styles.bubble,
            isUser
              ? [styles.userBubble, { backgroundColor: colors.primary }]
              : [styles.aiBubble, { backgroundColor: colors.surface, borderLeftColor: colors.primary, borderLeftWidth: 3 }],
          ]}
        >
          {isUser ? (
            <Text style={[styles.bubbleText, { color: colors.onPrimary }]}>{item.content}</Text>
          ) : (
            <Markdown colors={colors}>{item.content}</Markdown>
          )}
        </View>
        {showSaveBtn && (
          <Pressable
            style={[styles.saveRecipeBtn, { borderColor: colors.primary }]}
            onPress={onSaveRecipe}
            disabled={savingRecipe}
          >
            <Text style={[styles.saveRecipeBtnText, { color: colors.primary }]}>
              {savingRecipe ? 'SAVING…' : '🍳 SAVE AS RECIPE'}
            </Text>
          </Pressable>
        )}
        {matchedRecipes.map((r) => (
          <Pressable
            key={r.id}
            style={[styles.saveRecipeBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}
            onPress={() => onNavigateRecipe(r.id)}
          >
            <Text style={[styles.saveRecipeBtnText, { color: colors.text2 }]}>📖 {r.title}</Text>
          </Pressable>
        ))}
        <View style={[styles.bubbleMeta, isUser && { justifyContent: 'flex-end' }]}>
          {item.timestamp && (
            <Text style={[styles.timestamp, { fontFamily: MONO, color: colors.textMuted }]}>
              {formatTime(item.timestamp)}
            </Text>
          )}
          {!isUser && (
            <Pressable
              hitSlop={8}
              onPress={() => speakMessage(item.content, index)}
              style={styles.speakBtn}
            >
              <Text style={[styles.speakBtnText, { color: speakingMsgIdx === index ? colors.primary : colors.textMuted }]}>
                {speakingMsgIdx === index ? '🔊' : '🔈'}
              </Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
});

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function AssistantScreen({ navigation, route }) {
  const { colors } = useTheme();
  const { noAI } = useAi();
  const insets = useSafeAreaInsets();

  const [messages, setMessages] = useState([GREETING]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [savingRecipe, setSavingRecipe] = useState(false);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const listRef = useRef(null);
  const [followUps, setFollowUps] = useState([]);
  const [userRecipes, setUserRecipes] = useState([]);
  const [historyVisible, setHistoryVisible] = useState(false);
  const [chatHistory, setChatHistory] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [speaking, setSpeaking] = useState(false);
  const [speakingMsgIdx, setSpeakingMsgIdx] = useState(null);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);
  const lastSpokeRef = useRef(null);
  const [mood, setMood] = useState(() => pickRandom(TERRY_MOODS));
  const [terryFact, setTerryFact] = useState(null);
  const [deleteModal, setDeleteModal] = useState(null);

  // Cleanup Speech on unmount
  useEffect(() => {
    return () => { Speech.stop(); };
  }, []);

  // Rotate mood every 8 seconds
  useEffect(() => {
    const id = setInterval(() => setMood(pickRandom(TERRY_MOODS)), 8000);
    return () => clearInterval(id);
  }, []);

  const conversation = useMemo(() => messages.filter((m) => m !== GREETING), [messages]);
  const hasConversation = conversation.length > 0;

  // Load history + check for incoming recipe context
  const pendingSendRef = useRef(null);

  useEffect(() => {
    api.aiStatus().then(setStatus).catch((e) => setError(e.message));
    getChatHistory().then(setChatHistory);

    // "Send recipe to chat" from detail screen
    const recipe = route.params?.recipe;
    if (recipe) {
      const contextMsg = {
        role: 'user',
        content:
          `I'm looking at this recipe — can you tell me about it, suggest improvements, or help me modify it?\n\n` +
          `${recipe.title}\n${recipe.description}\n\nIngredients: ${recipe.ingredients.join(', ')}\nSteps: ${recipe.steps.join(' | ')}`,
      };
      setMessages([GREETING, contextMsg]);
      pendingSendRef.current = contextMsg.content;
    }
  }, []);

  useEffect(() => {
    if (pendingSendRef.current) {
      const text = pendingSendRef.current;
      pendingSendRef.current = null;
      send(text);
    }
  }, [messages]);


  // ─── Build context-aware prompt prefix ───────────────────────────────────

  const buildContext = async () => {
    try {
      const [recipes, mealPlan, profiles, shoppingList, cookbook, stats, topRecipes] = await Promise.all([
        api.listRecipes().catch(() => []),
        getMealPlan(),
        getDietaryProfiles().catch(() => []),
        getShoppingList().catch(() => []),
        getCookbook().catch(() => []),
        getStats().catch(() => ({ cookCount: 0 })),
        getTopRecipes(5).catch(() => []),
      ]);

      setUserRecipes(recipes);

      const parts = [];

      // Saved recipes
      if (recipes.length) {
        parts.push(`The user has ${recipes.length} saved recipes: ${recipes.slice(0, 10).map((r) => r.title).join(', ')}`);
      }

      // Meal plan
      const planned = Object.entries(mealPlan).flatMap(([date, meals]) =>
        MEALS.filter((m) => meals[m]).map((m) => `${date} ${m}: recipe #${meals[m]}`),
      );
      if (planned.length) {
        parts.push(`Their meal plan has: ${planned.slice(0, 7).join('; ')}`);
      }

      // Dietary profiles
      if (profiles.length) {
        const profileDescs = profiles.map((p) => {
          let desc = p.name ? `${p.name}` : 'Someone';
          if (p.needs) desc += ` (${p.needs})`;
          if (p.notes) desc += ` — ${p.notes}`;
          return desc;
        });
        parts.push(`Dietary profiles: ${profileDescs.join('; ')}`);
      }

      // Shopping list
      if (shoppingList.length) {
        const unchecked = shoppingList.filter((i) => !i.checked);
        if (unchecked.length) {
          parts.push(`Their shopping list has ${unchecked.length} unchecked items: ${unchecked.slice(0, 15).map((i) => i.text).join(', ')}`);
        }
      }

      // Cookbook (completed recipes)
      if (cookbook.length) {
        parts.push(`They've cooked and logged ${cookbook.length} recipes in their cookbook: ${cookbook.slice(0, 5).map((e) => e.recipeTitle || 'a recipe').join(', ')}`);
      }

      // Cooking stats
      if (stats.cookCount > 0) {
        parts.push(`Total cooking sessions: ${stats.cookCount}`);
      }

      // Top cooked recipes
      if (topRecipes.length) {
        parts.push(`Most cooked recipes: ${topRecipes.map((r) => `${r.title} (${r.count}x)`).join(', ')}`);
      }

      return parts.length ? `\n\nAdditional context about the user's cooking life: ${parts.join('. ')}.` : '';
    } catch {
      return '';
    }
  };

  // ─── Generate contextual follow-up suggestions ──────────────────────────

  const generateFollowUps = async (lastReply, userMsg) => {
    try {
      // Use AI to generate contextual follow-ups
      const prompt = [
        { role: 'system', content: 'You are a reply suggestion generator. Based on the conversation, suggest exactly 3 short follow-up questions or requests the user might want to ask next. Return ONLY a JSON array of 3 strings, nothing else. Each suggestion should be under 40 chars. Make them specific to the conversation context.' },
        { role: 'user', content: `User said: "${userMsg || ''}"` },
        { role: 'assistant', content: `Chef Terry replied: "${lastReply.slice(0, 500)}"` },
        { role: 'user', content: 'Suggest 3 follow-up questions. Return ONLY a JSON array like ["question1", "question2", "question3"]' },
      ];
      const { reply } = await api.aiChat(prompt);
      const parsed = JSON.parse(reply.trim().match(/\[.*\]/s)?.[0] || '[]');
      if (Array.isArray(parsed) && parsed.length > 0) {
        setFollowUps(parsed.filter((s) => typeof s === 'string').slice(0, 3));
        return;
      }
    } catch {
      // Fall through to pattern-based fallback
    }

    // Fallback: pattern-based suggestions
    const r = lastReply.toLowerCase();
    const u = (userMsg || '').toLowerCase();
    const s = new Set();

    if (r.includes('ingredient') && (r.includes('step') || r.includes('instruction') || r.includes('method'))) {
      s.add('Save that as a recipe');
      s.add('Make it vegetarian');
      s.add('Scale to 6 servings');
    } else if (u.includes('instead') || u.includes('substitute') || r.includes('substitute')) {
      s.add('What else can I swap?');
      s.add('Will it change the flavour?');
    } else if (r.includes('suggest') || r.includes('recommend') || r.includes('try')) {
      s.add('Give me 3 more options');
      s.add('Something quicker');
    } else {
      s.add('Tell me more about that');
      s.add('Suggest a side dish');
      s.add('What should I cook tonight?');
    }

    setFollowUps([...s].slice(0, 3));
  };

  // ─── Send message ───────────────────────────────────────────────────────
  const send = async (text) => {
    const content = (text || input).trim();
    if (!content || sending) return;
    setInput('');
    setError(null);
    setFollowUps([]);
    setTerryFact(null);

    // On first message, inject context
    const isFirstUserMsg = conversation.length === 0;
    const contextSuffix = isFirstUserMsg ? await buildContext() : '';
    const msgContent = content + contextSuffix;

    const next = [
      ...messages.filter((m) => m !== GREETING || messages.indexOf(m) === 0),
      { role: 'user', content: msgContent },
    ];
    setMessages([...messages, { role: 'user', content, timestamp: Date.now() }]);
    setSending(true);
    try {
      const { reply } = await api.aiChat(next.filter((m) => m !== GREETING));

      // 20% chance to append a fun food fact
      let finalReply = reply;
      if (Math.random() < 0.2) {
        const fact = pickRandom(TERRY_FACTS);
        finalReply = reply + '\n\n' + fact;
        setTerryFact(fact);
      }

      setMessages((cur) => [...cur, { role: 'assistant', content: finalReply, timestamp: Date.now() }]);
      generateFollowUps(reply, content);
    } catch (e) {
      setError(e.message);
      setMessages((cur) => cur.slice(0, -1));
      setInput(content);
    } finally {
      setSending(false);
    }
  };

  // ─── Speak a specific message ───────────────────────────────────────────

  const speakMessage = useCallback((text, index) => {
    if (speaking) {
      Speech.stop();
      setSpeaking(false);
      setSpeakingMsgIdx(null);
      return;
    }
    setSpeaking(true);
    setSpeakingMsgIdx(index);
    Speech.speak(text, {
      rate: 0.95,
      onDone: () => { setSpeaking(false); setSpeakingMsgIdx(null); },
      onError: () => { setSpeaking(false); setSpeakingMsgIdx(null); },
    });
  }, [speaking]);

  // ─── Load / delete history ──────────────────────────────────────────────

  const loadConversation = (entry) => {
    setMessages([GREETING, ...entry.messages]);
    setConversationId(entry.id);
    setFollowUps([]);
    setTerryFact(null);
  };

  const handleDeleteHistory = async (id) => {
    const updated = await deleteConversation(id);
    setChatHistory(updated);
  };

  // Keep refs in sync for cleanup
  const convRef = useRef(conversation);
  const convIdRef = useRef(conversationId);
  convRef.current = conversation;
  convIdRef.current = conversationId;

  // Save conversation when navigating away
  useEffect(() => {
    const unsubscribe = navigation.addListener('blur', () => {
      const msgs = convRef.current.filter((m) => m !== GREETING);
      if (msgs.length >= 2) {
        saveConversation(msgs, convIdRef.current);
      }
    });
    return unsubscribe;
  }, [navigation]);

  useEffect(() => {
    if (messages.length > 1) listRef.current?.scrollToEnd({ animated: true });
  }, [messages, sending]);

  const topBarStyle = [styles.topBar, { paddingTop: 16 + insets.top, paddingRight: 128 }];
  const terryCircleStyle = [styles.terryCircle, { top: insets.top + 4, borderColor: colors.primary }];

  // ─── Not configured state ───────────────────────────────────────────────

  if (status && !status.configured) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <View style={topBarStyle}>
          <Text style={[styles.screenTitle, { color: colors.text }]}>CHEF TERRY</Text>
        </View>
        <View style={styles.notConfigured}>
          <TerryAvatar style={[styles.terryLarge, { borderColor: colors.primary }]} />
          <Text style={[styles.ncTitle, { color: colors.text }]}>AI ASSISTANT IS OFF</Text>
          <Text style={[styles.ncText, { color: colors.textMuted }]}>
            Add your DeepSeek API key to the server (set DEEPSEEK_API_KEY in server/.env and
            rebuild) to enable recipe suggestions and cooking help.
          </Text>
        </View>
        <BottomNav active="assistant" navigation={navigation} />
      </View>
    );
  }
  const stableSaveAsRecipe = useCallback(() => {
    if (!hasConversation || savingRecipe) return;
    setSavingRecipe(true);
    setError(null);
    api.aiRecipe({ messages: conversation }).then(({ recipe: r }) => {
      navigation.navigate('EditRecipe', { draft: r });
    }).catch((e) => {
      setError(e.message);
    }).finally(() => {
      setSavingRecipe(false);
    });
  }, [hasConversation, savingRecipe, conversation, navigation]);

  const navigateToRecipe = useCallback((recipeId) => {
    navigation.navigate('RecipeDetail', { id: recipeId });
  }, [navigation]);

  const renderItem = useCallback(({ item, index }) => {
    if (item === GREETING) return null;
    return (
      <MessageBubble
        item={item}
        index={index}
        colors={colors}
        speakingMsgIdx={speakingMsgIdx}
        speakMessage={speakMessage}
        onSaveRecipe={stableSaveAsRecipe}
        savingRecipe={savingRecipe}
        userRecipes={userRecipes}
        onNavigateRecipe={navigateToRecipe}
      />
    );
  }, [colors, speakingMsgIdx, speakMessage, stableSaveAsRecipe, savingRecipe, userRecipes, navigateToRecipe]);
  // ─── Welcome / empty state ──────────────────────────────────────────────

  const ListHeaderComponent = !hasConversation && !sending ? (
    <View style={styles.welcomeContainer}>
      <TerryAvatar
        style={[styles.terryWelcome, { borderColor: colors.primary, backgroundColor: colors.surface }]}
      />
      <Text style={[styles.welcomeTitle, { color: colors.text }]}>Chef Terry at your service</Text>
      <Text style={[styles.welcomeMood, { fontFamily: MONO, color: colors.primary }]}>{mood}</Text>
      <Text style={[styles.welcomeSub, { color: colors.textMuted }]}>
        Your feline culinary companion 🐾{'\n'}Ask me about recipes, meal plans, conversions & more!
      </Text>

      <View style={styles.quickActionsGrid}>
        {QUICK_ACTIONS.map((action, i) => (
          <Pressable
            key={i}
            style={[styles.quickActionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={() => send(action.text)}
          >
            <Text style={[styles.quickActionText, { color: colors.text }]}>{action.label}</Text>
          </Pressable>
        ))}
      </View>

      {/* Terry Vision entry */}
      <Pressable
        style={[styles.visionCard, { borderColor: colors.primary, backgroundColor: colors.surface }]}
        onPress={() => navigation.navigate('TerryVision')}
      >
        <Text style={styles.visionIcon}>👁️</Text>
        <View style={{ flex: 1 }}>
          <Text style={[styles.visionTitle, { color: colors.text }]}>TERRY VISION</Text>
          <Text style={[styles.visionDesc, { fontFamily: MONO, color: colors.textMuted }]}>Scan your fridge, freezer, or counter • BETA</Text>
        </View>
        <Text style={[styles.visionArrow, { color: colors.primary }]}>→</Text>
      </Pressable>

      {terryFact && (
        <View style={[styles.factBanner, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.factText, { color: colors.text2, fontFamily: MONO }]}>{terryFact}</Text>
        </View>
      )}
    </View>
  ) : null;

  // ─── No AI state ────────────────────────────────────────────────────

  if (noAI) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center', padding: 40 }]}>
        <Text style={{ fontSize: 40, marginBottom: 16 }}>🚫</Text>
        <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text, textAlign: 'center', marginBottom: 8 }}>AI IS DISABLED</Text>
        <Text style={{ fontSize: 14, color: colors.textMuted, textAlign: 'center', lineHeight: 20 }}>
          Turn off NO AI MODE in Settings to use Terry and other AI features.
        </Text>
        <Pressable
          style={{ marginTop: 24, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10, borderWidth: 1.5, borderColor: colors.border }}
          onPress={() => navigation.goBack()}
        >
          <Text style={{ fontFamily: MONO, color: colors.text, fontSize: 12, letterSpacing: 1 }}>BACK TO RECIPES</Text>
        </Pressable>
        <BottomNav active="recipes" navigation={navigation} />
      </View>
    );
  }

  // ─── Main render ────────────────────────────────────────────────────────

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        {/* Header */}
        <View style={topBarStyle}>
          <Text style={[styles.screenTitle, { color: colors.text }]}>CHEF TERRY</Text>
          {hasConversation && (
            <Pressable
              onPress={() => {
                setMessages([GREETING]);
                setConversationId(null);
                setFollowUps([]);
                setTerryFact(null);
              }}
              style={[styles.headerBtn, { borderColor: colors.primary, backgroundColor: 'rgba(255,90,38,0.08)' }]}
            >
              <Text style={[styles.headerBtnText, { fontFamily: MONO, color: colors.primary }]}>+ NEW</Text>
            </Pressable>
          )}
          <Pressable
            onPress={() => { getChatHistory().then(setChatHistory); setHistoryVisible(true); }}
            style={[styles.headerBtn, { borderColor: colors.border }]}
          >
            <Text style={[styles.headerBtnText, { fontFamily: MONO, color: colors.textMuted }]}>HISTORY</Text>
          </Pressable>
        </View>

        {/* Chat */}
        <View style={{ flex: 1 }}>
          <FlatList
            ref={listRef}
            data={hasConversation ? messages.filter((m) => m !== GREETING) : []}
            keyExtractor={(_, i) => String(i)}
            renderItem={renderItem}
            ListHeaderComponent={ListHeaderComponent}
            contentContainerStyle={[
              styles.list,
              !hasConversation && { paddingBottom: 100 },
            ]}
            keyboardShouldPersistTaps="handled"
            initialNumToRender={15}
            maxToRenderPerBatch={10}
            windowSize={10}
            removeClippedSubviews={true}
            ListFooterComponent={
              <>
                {sending && (
                  <View style={[styles.bubbleRow]}>
                    <Image source={TERRY_FRAMES[0]} style={[styles.msgAvatar, { borderColor: colors.border }]} />
                    <View style={[styles.bubble, styles.aiBubble, { backgroundColor: colors.surface, borderLeftColor: colors.primary, borderLeftWidth: 3 }]}>
                      <TypingDots color={colors.textMuted} />
                    </View>
                  </View>
                )}
                {/* Follow-up chips after Terry replies */}
                {!sending && followUps.length > 0 && hasConversation && (
                  <View style={styles.chips}>
                    {followUps.map((q, i) => (
                      <Pressable key={i} style={[styles.chip, { borderColor: colors.border, backgroundColor: colors.surface }]} onPress={() => send(q)}>
                        <Text style={[styles.chipText, { color: colors.primary }]}>{q}</Text>
                      </Pressable>
                    ))}
                  </View>
                )}
                {/* Terry fact banner in chat mode */}
                {!sending && terryFact && hasConversation && (
                  <View style={[styles.factBanner, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <Text style={[styles.factText, { color: colors.text2, fontFamily: MONO }]}>💡 {terryFact}</Text>
                  </View>
                )}
                {hasConversation && (
                  <AiDisclaimer style={{ paddingHorizontal: 16, marginBottom: 8 }} />
                )}
              </>
            }
          />

          {error && (
            <Pressable onPress={() => setError(null)} style={[styles.errorBar, { backgroundColor: colors.danger + '18' }]}>
              <Text style={[styles.error, { color: colors.danger }]}>{error}</Text>
            </Pressable>
          )}

          {/* Mood indicator bar when chatting */}
          {hasConversation && (
            <View style={[styles.moodBar, { borderTopColor: colors.border }]}>
              <Text style={[styles.moodText, { fontFamily: MONO, color: colors.textMuted }]}>🐾 Terry: {mood}</Text>
            </View>
          )}

          <View style={[styles.composer, { backgroundColor: colors.background, borderTopColor: colors.border }]}>
            <TextInput
              style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
              value={input}
              onChangeText={setInput}
              placeholder="Ask about recipes, conversions…"
              placeholderTextColor={colors.textMuted}
              onSubmitEditing={() => send(input)}
              returnKeyType="send"
            />
            <Pressable
              style={[styles.sendBtn, { backgroundColor: colors.primary }, (sending || !input.trim()) && styles.sendBtnOff]}
              onPress={() => send(input)}
              disabled={sending || !input.trim()}
            >
              <Text style={[styles.sendBtnText, { color: colors.onPrimary }]}>→</Text>
            </Pressable>
          </View>
        </View>

        {/* Floating Terry avatar - only when chatting */}
        {hasConversation && (
          <TerryAvatar style={terryCircleStyle} showGif={sending ? 'thinking' : speaking ? 'talking' : null} small />
        )}

        <HistoryModal
          visible={historyVisible}
          onClose={() => setHistoryVisible(false)}
          history={chatHistory}
          onSelect={loadConversation}
          onDelete={handleDeleteHistory}
          colors={colors}
        />
      </KeyboardAvoidingView>

      <BottomNav active="assistant" navigation={navigation} />
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },

  // Terry avatar
  terryCircle: {
    position: 'absolute', right: 14, width: 80, height: 80,
    borderRadius: 40, overflow: 'hidden', borderWidth: 2, zIndex: 10,
  },
  terryFaceImg: { position: 'absolute', width: 190, height: 245, left: -50, top: -28 },
  terryFaceImgSmall: { width: 130, height: 168, left: -40, top: -24 },
  terryGifImg: { position: 'absolute', width: 170, height: 225, left: -30, top: -15 },
  terryGifImgSmall: { width: 110, height: 146, left: -25, top: -12 },
  terryLarge: {
    width: 120, height: 120, borderRadius: 60, overflow: 'hidden', borderWidth: 2,
    alignSelf: 'center', marginBottom: 16,
  },
  terryWelcome: {
    width: 140, height: 140, borderRadius: 70, overflow: 'hidden', borderWidth: 3,
    alignSelf: 'center', marginBottom: 16,
  },
  msgAvatar: {
    width: 28, height: 28, borderRadius: 14, overflow: 'hidden',
    borderWidth: 1, marginRight: 8, marginTop: 2, flexShrink: 0,
  },

  // Header
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 20, paddingBottom: 8 },
  backBtn: { width: 38, height: 38, borderRadius: 10, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  screenTitle: { flex: 1, fontSize: 19, fontWeight: '900', letterSpacing: 0.5 },
  headerBtn: {
    borderWidth: 1.5,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  headerBtnText: { fontSize: 11, letterSpacing: 0.5, fontWeight: '600' },

  // List
  list: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16 },

  // Bubbles
  bubbleRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 10 },
  bubble: { maxWidth: '85%', borderRadius: 16, paddingHorizontal: 15, paddingVertical: 11 },
  userBubble: { borderBottomRightRadius: 4 },
  aiBubble: { borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 14, lineHeight: 21 },
  bubbleMeta: { flexDirection: 'row', alignItems: 'center', marginTop: 3, gap: 8, paddingHorizontal: 4 },
  saveRecipeBtn: {
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginTop: 6,
    alignSelf: 'flex-start',
  },
  saveRecipeBtnText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  timestamp: { fontSize: 10 },
  speakBtn: { padding: 2 },
  speakBtnText: { fontSize: 14 },

  // Typing dots
  dotsRow: { flexDirection: 'row', gap: 6, paddingVertical: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },

  // Follow-up chips
  chips: { marginTop: 8, gap: 8 },
  chip: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12 },
  chipText: { fontSize: 13 },

  // Welcome screen
  welcomeContainer: {
    alignItems: 'center', paddingTop: 30, paddingBottom: 20, paddingHorizontal: 20,
  },
  welcomeTitle: {
    fontSize: 22, fontWeight: '900', letterSpacing: 0.3, marginBottom: 4,
  },
  welcomeMood: {
    fontSize: 13, letterSpacing: 0.3, marginBottom: 10, fontStyle: 'italic',
  },
  welcomeSub: {
    fontSize: 14, lineHeight: 21, textAlign: 'center', marginBottom: 24,
  },

  // Quick actions grid
  // Terry Vision card
  visionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginHorizontal: 20,
    marginTop: 14,
    padding: 16,
    borderRadius: 18,
    borderWidth: 1.5,
  },
  visionIcon: { fontSize: 28 },
  visionTitle: { fontSize: 14, fontWeight: '900', letterSpacing: 0.5 },
  visionDesc: { fontSize: 10, letterSpacing: 0.3, marginTop: 3 },
  visionArrow: { fontSize: 20, fontWeight: '700' },

  quickActionsGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center',
    paddingHorizontal: 4,
  },
  quickActionCard: {
    borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14,
    width: '47%', minHeight: 56, justifyContent: 'center',
  },
  quickActionText: {
    fontSize: 13, lineHeight: 18, fontWeight: '600',
  },

  // Fact banner
  factBanner: {
    marginTop: 14, borderRadius: 12, borderWidth: 1, paddingHorizontal: 14,
    paddingVertical: 10, width: '100%',
  },
  factText: { fontSize: 12, lineHeight: 18 },

  // Mood bar
  moodBar: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 4, paddingHorizontal: 16 },
  moodText: { fontSize: 11, textAlign: 'center' },

  // Error
  errorBar: { marginHorizontal: 16, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  error: { fontSize: 13 },

  // Composer
  composer: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1 },
  input: { flex: 1, borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 13, fontSize: 14 },
  sendBtn: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  sendBtnOff: { opacity: 0.4 },
  sendBtnText: { fontSize: 18, fontWeight: '700' },

  // Not configured
  notConfigured: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  ncTitle: { fontSize: 18, fontWeight: '900', letterSpacing: 0.5, marginBottom: 12 },
  ncText: { fontSize: 15, lineHeight: 22, textAlign: 'center' },
  subscribeBtn: {
    marginTop: 20,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 16,
  },
  subscribeText: {
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1,
  },

  // History modal
  menuOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  historySheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 8, paddingBottom: 20, borderWidth: 1, borderBottomWidth: 0, paddingHorizontal: 20 },
  historyTitle: { fontSize: 13, fontWeight: '900', letterSpacing: 1, textAlign: 'center', paddingVertical: 14 },
  historyItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  historyItemTitle: { fontSize: 14, fontWeight: '600' },
  historyMeta: { flexDirection: 'row', gap: 12, marginTop: 2 },
  historyItemDate: { fontSize: 11, marginTop: 0 },
  historyEmpty: { textAlign: 'center', paddingVertical: 30, fontSize: 12 },
});
