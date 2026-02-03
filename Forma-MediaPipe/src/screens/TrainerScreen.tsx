import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  FlatList
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Send, Bot, TrendingUp, Target, AlertCircle, CheckCircle2 } from 'lucide-react-native';
import { COLORS, SPACING, FONTS, CARD_STYLE } from '../constants/theme';
import { useScroll } from '../contexts/ScrollContext';
import { useTrainer } from '../hooks';
import { LoadingSkeleton, ErrorState } from '../components/ui';
import { ChatMessage, Recommendation } from '../services/api';

const RecommendationCard: React.FC<{ recommendation: Recommendation }> = ({ recommendation }) => {
  const Icon = recommendation.type === 'success' ? CheckCircle2 
    : recommendation.type === 'warning' ? AlertCircle 
    : Target;
  
  const iconColor = recommendation.type === 'success' ? COLORS.primary
    : recommendation.type === 'warning' ? COLORS.orange
    : COLORS.textSecondary;
  
  return (
    <View style={styles.recommendationCard}>
      <Icon size={20} color={iconColor} style={styles.recommendationIcon} />
      <View style={styles.recommendationContent}>
        <Text style={styles.recommendationTitle}>{recommendation.title}</Text>
        <Text style={styles.recommendationMessage}>{recommendation.message}</Text>
      </View>
    </View>
  );
};

const ChatBubble: React.FC<{ message: ChatMessage }> = ({ message }) => {
  return (
    <View style={[styles.chatBubble, message.isUser ? styles.userBubble : styles.aiBubble]}>
      {!message.isUser && (
        <View style={styles.aiIcon}>
          <Bot size={16} color={COLORS.primary} />
        </View>
      )}
      <Text style={[styles.chatText, message.isUser && styles.userChatText]}>
        {message.text}
      </Text>
    </View>
  );
};

export const TrainerScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { onScroll } = useScroll();
  const [activeTab, setActiveTab] = useState<'overview' | 'chat'>('overview');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      text: 'Hi! I\'m your AI fitness trainer. I\'ve analyzed your workout history and I\'m here to help you reach your goals. Ask me anything about fitness, nutrition, or your progress!',
      isUser: false,
      timestamp: new Date(),
    },
  ]);
  const [inputText, setInputText] = useState('');
  const scrollViewRef = useRef<ScrollView>(null);
  const chatListRef = useRef<FlatList>(null);
  const navBarMargin = insets.bottom > 0 ? insets.bottom - 20 : 0;
  const footerHeight = 80 + navBarMargin + 20; // tab bar height + margin + extra space

  // Fetch trainer data from API service
  const { progress, recommendations, isLoading, error, refetch, sendMessage } = useTrainer();

  const handleSendMessage = async () => {
    if (!inputText.trim()) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      text: inputText.trim(),
      isUser: true,
      timestamp: new Date(),
    };

    setChatMessages(prev => [...prev, userMessage]);
    setInputText('');

    // Get AI response from service
    const responseText = await sendMessage(userMessage.text);
    const aiResponse: ChatMessage = {
      id: (Date.now() + 1).toString(),
      text: responseText,
      isUser: false,
      timestamp: new Date(),
    };
    setChatMessages(prev => [...prev, aiResponse]);
  };

  useEffect(() => {
    if (activeTab === 'chat' && chatListRef.current) {
      setTimeout(() => {
        chatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [chatMessages, activeTab]);

  // Loading state
  if (isLoading) {
    return (
      <View style={styles.container}>
        <View style={styles.tabSelector}>
          <TouchableOpacity style={[styles.tab, styles.tabActive]}>
            <TrendingUp size={18} color={COLORS.primary} />
            <Text style={[styles.tabText, styles.tabTextActive]}>Overview</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.tab}>
            <Bot size={18} color={COLORS.textSecondary} />
            <Text style={styles.tabText}>Chat</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.loadingContainer}>
          <LoadingSkeleton variant="card" height={100} style={{ marginBottom: SPACING.md }} />
          <LoadingSkeleton variant="card" height={100} style={{ marginBottom: SPACING.md }} />
          <LoadingSkeleton variant="card" height={100} />
        </View>
      </View>
    );
  }

  // Error state
  if (error) {
    return (
      <View style={styles.container}>
        <View style={styles.tabSelector}>
          <TouchableOpacity style={[styles.tab, styles.tabActive]}>
            <TrendingUp size={18} color={COLORS.primary} />
            <Text style={[styles.tabText, styles.tabTextActive]}>Overview</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.tab}>
            <Bot size={18} color={COLORS.textSecondary} />
            <Text style={styles.tabText}>Chat</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.errorContainer}>
          <ErrorState message={error} onRetry={refetch} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Tab Selector */}
      <View style={styles.tabSelector}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'overview' && styles.tabActive]}
          onPress={() => setActiveTab('overview')}
        >
          <TrendingUp size={18} color={activeTab === 'overview' ? COLORS.primary : COLORS.textSecondary} />
          <Text style={[styles.tabText, activeTab === 'overview' && styles.tabTextActive]}>
            Overview
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'chat' && styles.tabActive]}
          onPress={() => setActiveTab('chat')}
        >
          <Bot size={18} color={activeTab === 'chat' ? COLORS.primary : COLORS.textSecondary} />
          <Text style={[styles.tabText, activeTab === 'chat' && styles.tabTextActive]}>
            Chat
          </Text>
        </TouchableOpacity>
      </View>
      
      {activeTab === 'overview' ? (
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: 200 }]}
          showsVerticalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={16}
        >
          {/* Recommendations */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>AI Recommendations</Text>
            {recommendations.map((rec, index) => (
              <RecommendationCard key={index} recommendation={rec} />
            ))}
          </View>
        </ScrollView>
      ) : (
        <View style={styles.chatContainer}>
          <FlatList
            ref={chatListRef}
            data={chatMessages}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => <ChatBubble message={item} />}
            contentContainerStyle={styles.chatList}
            onContentSizeChange={() => chatListRef.current?.scrollToEnd({ animated: true })}
            showsVerticalScrollIndicator={false}
            style={styles.chatFlatList}
          />
          
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
          >
            <View style={[styles.inputContainer, { bottom: footerHeight }]}>
              <TextInput
                style={styles.input}
                value={inputText}
                onChangeText={setInputText}
                placeholder="Ask me anything about fitness..."
                placeholderTextColor={COLORS.textTertiary}
                multiline
                onSubmitEditing={handleSendMessage}
                returnKeyType="send"
              />
              <TouchableOpacity
                style={[styles.sendButton, !inputText.trim() && styles.sendButtonDisabled]}
                onPress={handleSendMessage}
                disabled={!inputText.trim()}
                activeOpacity={0.7}
              >
                <Send size={20} color={inputText.trim() ? COLORS.text : COLORS.textTertiary} />
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  loadingContainer: {
    flex: 1,
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: SPACING.md,
  },
  errorContainer: {
    flex: 1,
    paddingHorizontal: SPACING.screenHorizontal,
    justifyContent: 'center',
  },
  tabSelector: {
    flexDirection: 'row',
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.md,
    gap: SPACING.sm,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.screenHorizontal,
    borderRadius: 25,
    backgroundColor: COLORS.cardBackground,
    gap: SPACING.sm,
  },
  tabActive: {
    backgroundColor: COLORS.cardBackgroundLight,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  tabText: {
    fontSize: 14,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
  },
  tabTextActive: {
    color: COLORS.text,
    fontFamily: FONTS.ui.bold,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: SPACING.lg,
  },
  section: {
    marginBottom: SPACING.xl,
  },
  sectionTitle: {
    fontSize: 20,
    fontFamily: FONTS.ui.bold,
    color: COLORS.text,
    marginBottom: SPACING.md,
  },
  progressGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.md,
  },
  progressCard: {
    width: '48%',
    ...CARD_STYLE,
    padding: SPACING.md,
  },
  progressLabel: {
    fontSize: 12,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
    marginBottom: SPACING.xs,
  },
  progressValue: {
    fontSize: 28,
    fontFamily: FONTS.mono.bold,
    color: COLORS.text,
    marginBottom: SPACING.xs,
  },
  progressSubtext: {
    fontSize: 11,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textTertiary,
  },
  trendContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: SPACING.xs,
  },
  trendText: {
    fontSize: 12,
    fontFamily: FONTS.ui.regular,
  },
  recommendationCard: {
    flexDirection: 'row',
    ...CARD_STYLE,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  recommendationIcon: {
    marginRight: SPACING.md,
  },
  recommendationContent: {
    flex: 1,
  },
  recommendationTitle: {
    fontSize: 14,
    fontFamily: FONTS.ui.bold,
    color: COLORS.text,
    marginBottom: SPACING.xs,
  },
  recommendationMessage: {
    fontSize: 13,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
    lineHeight: 20,
  },
  chatContainer: {
    flex: 1,
    position: 'relative',
  },
  chatFlatList: {
    flex: 1,
  },
  chatList: {
    padding: SPACING.lg,
    paddingBottom: 120,
  },
  chatBubble: {
    maxWidth: '85%',
    marginBottom: SPACING.md,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: COLORS.primary,
    borderRadius: 20,
    borderTopRightRadius: 4,
    padding: SPACING.md,
  },
  aiBubble: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.cardBackground,
    borderRadius: 20,
    borderTopLeftRadius: 4,
    padding: SPACING.md,
  },
  aiIcon: {
    marginRight: SPACING.sm,
    marginTop: 2,
  },
  chatText: {
    fontSize: 14,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textSecondary,
    lineHeight: 20,
    flex: 1,
  },
  userChatText: {
    color: COLORS.background,
  },
  inputContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    padding: SPACING.lg,
    backgroundColor: 'transparent',
    alignItems: 'flex-end',
    gap: SPACING.sm,
    paddingBottom: SPACING.lg,
    zIndex: 10,
  },
  input: {
    flex: 1,
    backgroundColor: COLORS.background,
    borderRadius: 20,
    paddingHorizontal: SPACING.screenHorizontal,
    paddingVertical: SPACING.md,
    fontSize: 14,
    fontFamily: FONTS.ui.regular,
    color: COLORS.text,
    maxHeight: 100,
    minHeight: 48,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: COLORS.cardBackgroundLight,
    opacity: 0.5,
  },
});
