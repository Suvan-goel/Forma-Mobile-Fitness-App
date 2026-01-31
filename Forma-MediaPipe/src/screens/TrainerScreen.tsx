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

// Mock workout data (same as LogbookScreen)
interface WorkoutSession {
  id: string;
  name: string;
  date: string;
  fullDate: Date;
  duration: string;
  totalSets: number;
  totalReps: number;
  formScore: number;
}

const mockWorkoutSessions: WorkoutSession[] = [
  {
    id: '1',
    name: 'Push Day - Strength',
    date: 'Oct 24',
    fullDate: new Date(2024, 9, 24),
    duration: '45 min',
    totalSets: 15,
    totalReps: 120,
    formScore: 87,
  },
  {
    id: '2',
    name: 'Leg Hypertrophy',
    date: 'Oct 22',
    fullDate: new Date(2024, 9, 22),
    duration: '60 min',
    totalSets: 18,
    totalReps: 210,
    formScore: 85,
  },
  {
    id: '3',
    name: 'Full Body Circuit',
    date: 'Oct 20',
    fullDate: new Date(2024, 9, 20),
    duration: '35 min',
    totalSets: 12,
    totalReps: 300,
    formScore: 82,
  },
  {
    id: '4',
    name: 'Morning Mobility',
    date: 'Oct 18',
    fullDate: new Date(2024, 9, 18),
    duration: '20 min',
    totalSets: 8,
    totalReps: 50,
    formScore: 75,
  },
  {
    id: '5',
    name: 'Upper Body Focus',
    date: 'Sep 15',
    fullDate: new Date(2024, 8, 15),
    duration: '50 min',
    totalSets: 16,
    totalReps: 180,
    formScore: 90,
  },
  {
    id: '6',
    name: 'Cardio Blast',
    date: 'Sep 10',
    fullDate: new Date(2024, 8, 10),
    duration: '30 min',
    totalSets: 10,
    totalReps: 200,
    formScore: 78,
  },
];

interface ChatMessage {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: Date;
}

// Calculate progress insights from workout data
const calculateProgress = () => {
  const recentWorkouts = mockWorkoutSessions.slice(0, 4);
  const olderWorkouts = mockWorkoutSessions.slice(4);
  
  const avgFormRecent = recentWorkouts.reduce((sum, w) => sum + w.formScore, 0) / recentWorkouts.length;
  const avgFormOlder = olderWorkouts.length > 0 
    ? olderWorkouts.reduce((sum, w) => sum + w.formScore, 0) / olderWorkouts.length 
    : avgFormRecent;
  
  const totalReps = recentWorkouts.reduce((sum, w) => sum + w.totalReps, 0);
  const avgDuration = recentWorkouts.reduce((sum, w) => {
    const mins = parseInt(w.duration.replace(' min', ''));
    return sum + mins;
  }, 0) / recentWorkouts.length;
  
  const formTrend = avgFormRecent - avgFormOlder;
  
  return {
    avgFormScore: Math.round(avgFormRecent),
    formTrend,
    totalReps,
    avgDuration: Math.round(avgDuration),
    workoutCount: recentWorkouts.length,
  };
};

// Generate AI recommendations
const generateRecommendations = (progress: ReturnType<typeof calculateProgress>) => {
  const recommendations = [];
  
  if (progress.formTrend < 0) {
    recommendations.push({
      type: 'warning',
      title: 'Form Score Declining',
      message: 'Your form scores have decreased recently. Focus on proper technique and consider reducing weight to maintain form.',
    });
  } else if (progress.formTrend > 0) {
    recommendations.push({
      type: 'success',
      title: 'Form Improving',
      message: 'Great job! Your form scores are trending upward. Keep focusing on technique.',
    });
  }
  
  if (progress.avgFormScore < 80) {
    recommendations.push({
      type: 'warning',
      title: 'Form Needs Attention',
      message: 'Your average form score is below 80. Consider working with lighter weights or focusing on form drills.',
    });
  }
  
  if (progress.workoutCount < 3) {
    recommendations.push({
      type: 'info',
      title: 'Increase Frequency',
      message: 'You\'ve been training less frequently. Aim for at least 3-4 workouts per week for optimal progress.',
    });
  }
  
  if (recommendations.length === 0) {
    recommendations.push({
      type: 'success',
      title: 'On Track',
      message: 'You\'re making excellent progress! Keep up the consistent training.',
    });
  }
  
  return recommendations;
};

// Mock AI response generator
const generateAIResponse = (userMessage: string, progress: ReturnType<typeof calculateProgress>): string => {
  const lowerMessage = userMessage.toLowerCase();
  
  // Form-related questions
  if (lowerMessage.includes('form') || lowerMessage.includes('technique')) {
    if (progress.avgFormScore < 80) {
      return `Based on your recent workouts, your average form score is ${progress.avgFormScore}%, which is below optimal. I recommend focusing on proper technique by:\n\n1. Reducing weight by 10-15% to perfect form\n2. Recording yourself to identify form issues\n3. Slowing down your reps to maintain control\n\nYour form has ${progress.formTrend > 0 ? 'improved' : 'declined'} recently, so let's get it back on track!`;
    }
    return `Your form scores are looking good at ${progress.avgFormScore}% average! Keep focusing on controlled movements and full range of motion. Your form has been ${progress.formTrend > 0 ? 'improving' : 'stable'} recently.`;
  }
  
  // Progress questions
  if (lowerMessage.includes('progress') || lowerMessage.includes('improve') || lowerMessage.includes('better')) {
    const formTrend = progress.formTrend > 0 ? 'improving' : progress.formTrend < 0 ? 'declining' : 'stable';
    
    return `Here's your progress overview:\n\n📊 Form Score: ${progress.avgFormScore}% (${formTrend})\n🏋️ Total Reps (recent): ${progress.totalReps}\n⏱️ Avg Duration: ${progress.avgDuration} min\n\n${progress.formTrend > 0 ? 'You\'re making great progress! Keep it up!' : 'Focus on maintaining consistent form to see better results.'}`;
  }
  
  // Workout frequency
  if (lowerMessage.includes('frequency') || lowerMessage.includes('often') || lowerMessage.includes('times')) {
    return `You've completed ${progress.workoutCount} workouts recently. For optimal progress, aim for 3-4 workouts per week. ${progress.workoutCount < 3 ? 'Try to increase your training frequency!' : 'You\'re on track with your frequency!'}`;
  }
  
  // Nutrition questions
  if (lowerMessage.includes('nutrition') || lowerMessage.includes('diet') || lowerMessage.includes('eat') || lowerMessage.includes('food')) {
    return `Here are my nutrition recommendations:\n\n1. Protein: Aim for 0.8-1g per lb of bodyweight daily\n2. Carbs: Focus on complex carbs pre-workout for energy\n3. Hydration: Drink 0.5-1L water during workouts\n4. Recovery: Post-workout meal within 30-60 minutes\n\nProper nutrition supports recovery and performance!`;
  }
  
  // Recovery questions
  if (lowerMessage.includes('recovery') || lowerMessage.includes('rest') || lowerMessage.includes('sleep')) {
    return `Recovery is crucial for your progress! Based on your ${progress.avgDuration}-minute average workout duration:\n\n1. Sleep: Aim for 7-9 hours nightly\n2. Rest Days: Take 1-2 rest days between intense sessions\n3. Active Recovery: Light walks or stretching on rest days\n4. Hydration: Stay hydrated throughout the day\n\nWith your current training intensity, proper recovery will maximize your gains!`;
  }
  
  // General fitness advice
  if (lowerMessage.includes('workout') || lowerMessage.includes('exercise') || lowerMessage.includes('routine')) {
    return `Based on your workout history, I see you're doing a mix of strength and cardio. Here's what I recommend:\n\n1. Continue your current split (Push, Legs, Full Body)\n2. Add 1-2 mobility sessions per week (like your Morning Mobility)\n3. Focus on progressive overload - gradually increase weight or reps\n4. Track your form scores to ensure quality over quantity\n\nYour recent workouts show good variety - keep it up!`;
  }
  
  // Default response
  return `I'm here to help with your fitness journey! Based on your recent workouts:\n\n• Average Form: ${progress.avgFormScore}%\n• Recent Workouts: ${progress.workoutCount}\n\nYou can ask me about:\n- Form and technique\n- Progress tracking\n- Nutrition\n- Recovery\n- Workout planning\n\nWhat would you like to know?`;
};

const RecommendationCard: React.FC<{ recommendation: any }> = ({ recommendation }) => {
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
  
  const progress = calculateProgress();
  const recommendations = generateRecommendations(progress);
  
  const handleSendMessage = () => {
    if (!inputText.trim()) return;
    
    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      text: inputText.trim(),
      isUser: true,
      timestamp: new Date(),
    };
    
    setChatMessages(prev => [...prev, userMessage]);
    setInputText('');
    
    // Simulate AI thinking delay
    setTimeout(() => {
      const aiResponse: ChatMessage = {
        id: (Date.now() + 1).toString(),
        text: generateAIResponse(userMessage.text, progress),
        isUser: false,
        timestamp: new Date(),
      };
      setChatMessages(prev => [...prev, aiResponse]);
    }, 500);
  };
  
  useEffect(() => {
    if (activeTab === 'chat' && chatListRef.current) {
      setTimeout(() => {
        chatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [chatMessages, activeTab]);
  
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
