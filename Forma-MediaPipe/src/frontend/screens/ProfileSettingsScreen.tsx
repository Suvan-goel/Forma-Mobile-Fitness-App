import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Text,
  TouchableOpacity,
  ScrollView,
  Platform,
  Alert,
  Animated,
  TextInput,
  ActivityIndicator,
  Image,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, Camera, Mail, Calendar } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import {
  COLORS,
  SPACING,
  FONTS,
  CARD_GRADIENT_COLORS,
  CARD_GRADIENT_START,
  CARD_GRADIENT_END,
} from '../constants/theme';
import { useUser, useUpdateUser } from '../../backend/hooks';

interface ProfileSettingsScreenProps {
  navigation: any;
}

export const ProfileSettingsScreen: React.FC<ProfileSettingsScreenProps> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const { user, isLoading: userLoading, refetch } = useUser();
  const { updateProfile, uploadAvatar, isUpdating, error } = useUpdateUser();

  const [displayName, setDisplayName] = useState('');
  const [hasNameChanged, setHasNameChanged] = useState(false);

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName);
    }
  }, [user]);

  const handleNameChange = (text: string) => {
    setDisplayName(text);
    setHasNameChanged(text !== user?.displayName);
  };

  const handleSaveName = async () => {
    if (!hasNameChanged || !displayName.trim()) return;
    const result = await updateProfile({ displayName: displayName.trim() });
    if (result.success) {
      setHasNameChanged(false);
      await refetch();
      Alert.alert('Success', 'Display name updated.');
    } else {
      Alert.alert('Error', result.error ?? 'Failed to update name.');
    }
  };

  const handlePickAvatar = async () => {
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permissionResult.granted) {
      Alert.alert(
        'Permission Required',
        'Please allow photo library access in your device settings to change your avatar.',
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });

    if (result.canceled || !result.assets?.[0]?.uri) return;

    const uploadResult = await uploadAvatar(result.assets[0].uri);
    if (uploadResult.success) {
      await updateProfile({ avatarUrl: uploadResult.data });
      await refetch();
    } else {
      Alert.alert('Error', uploadResult.error ?? 'Failed to upload avatar.');
    }
  };

  const userInitial = (user?.displayName?.[0] ?? user?.email?.[0] ?? 'A').toUpperCase();
  const joinDate = user?.createdAt
    ? new Date(user.createdAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : '';

  if (userLoading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top, alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={COLORS.primary} size="large" />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
            activeOpacity={0.7}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <ChevronLeft size={22} color={COLORS.text} strokeWidth={1.5} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>PROFILE</Text>
          <View style={styles.placeholder} />
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Avatar */}
          <View style={styles.avatarSection}>
            <TouchableOpacity onPress={handlePickAvatar} activeOpacity={0.7} disabled={isUpdating}>
              <View style={styles.avatarContainer}>
                {user?.avatarUrl ? (
                  <Image source={{ uri: user.avatarUrl }} style={styles.avatarImage} />
                ) : (
                  <LinearGradient
                    colors={['#8B5CF6', '#7C3AED']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.avatarGradient}
                  >
                    <Text style={styles.avatarText}>{userInitial}</Text>
                  </LinearGradient>
                )}
                <View style={styles.cameraIconBadge}>
                  <Camera size={14} color={COLORS.text} strokeWidth={1.5} />
                </View>
              </View>
            </TouchableOpacity>
            {isUpdating && (
              <ActivityIndicator color={COLORS.primary} style={{ marginTop: SPACING.sm }} />
            )}
          </View>

          {/* Display Name */}
          <View style={styles.cardOuter}>
            <LinearGradient
              colors={[...CARD_GRADIENT_COLORS]}
              start={CARD_GRADIENT_START}
              end={CARD_GRADIENT_END}
              style={styles.cardGradient}
            >
              <View style={styles.cardGlassEdge}>
                <Text style={styles.fieldLabel}>Display Name</Text>
                <TextInput
                  style={styles.textInput}
                  value={displayName}
                  onChangeText={handleNameChange}
                  placeholder="Enter your name"
                  placeholderTextColor={COLORS.textTertiary}
                  autoCapitalize="words"
                  returnKeyType="done"
                  onSubmitEditing={handleSaveName}
                />
                {hasNameChanged && (
                  <TouchableOpacity
                    style={styles.saveButton}
                    onPress={handleSaveName}
                    activeOpacity={0.7}
                    disabled={isUpdating}
                  >
                    <Text style={styles.saveButtonText}>
                      {isUpdating ? 'Saving...' : 'Save'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </LinearGradient>
          </View>

          {/* Email (read-only) */}
          <View style={[styles.cardOuter, { marginTop: SPACING.md }]}>
            <LinearGradient
              colors={[...CARD_GRADIENT_COLORS]}
              start={CARD_GRADIENT_START}
              end={CARD_GRADIENT_END}
              style={styles.cardGradient}
            >
              <View style={styles.cardGlassEdge}>
                <View style={styles.infoRow}>
                  <Mail size={16} color="#A78BFA" strokeWidth={1.5} />
                  <View style={styles.infoContent}>
                    <Text style={styles.infoLabel}>Email</Text>
                    <Text style={styles.infoValue}>{user?.email ?? ''}</Text>
                  </View>
                </View>
                {joinDate ? (
                  <>
                    <View style={styles.separator} />
                    <View style={styles.infoRow}>
                      <Calendar size={16} color="#A78BFA" strokeWidth={1.5} />
                      <View style={styles.infoContent}>
                        <Text style={styles.infoLabel}>Member Since</Text>
                        <Text style={styles.infoValue}>{joinDate}</Text>
                      </View>
                    </View>
                  </>
                ) : null}
              </View>
            </LinearGradient>
          </View>

          {error ? (
            <Text style={styles.errorText}>{error}</Text>
          ) : null}
        </ScrollView>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.lg,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  headerTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 20,
    color: COLORS.text,
    letterSpacing: 2,
  },
  placeholder: {
    width: 40,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACING.screenHorizontal,
    paddingBottom: SPACING.xxxl,
  },
  avatarSection: {
    alignItems: 'center',
    marginBottom: SPACING.xl,
  },
  avatarContainer: {
    position: 'relative',
  },
  avatarImage: {
    width: 96,
    height: 96,
    borderRadius: 32,
  },
  avatarGradient: {
    width: 96,
    height: 96,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: FONTS.display.bold,
    fontSize: 36,
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  cameraIconBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.background,
  },
  cardOuter: {
    borderRadius: 19,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#8B5CF6',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.25,
        shadowRadius: 15,
      },
      android: { elevation: 6 },
    }),
  },
  cardGradient: {
    borderRadius: 19,
  },
  cardGlassEdge: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    padding: SPACING.lg,
    overflow: 'hidden',
  },
  fieldLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textSecondary,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: SPACING.xs,
  },
  textInput: {
    fontFamily: FONTS.ui.regular,
    fontSize: 16,
    color: COLORS.text,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
    paddingVertical: SPACING.sm,
  },
  saveButton: {
    alignSelf: 'flex-end',
    marginTop: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
  },
  saveButtonText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 14,
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 4,
  },
  infoContent: {
    flex: 1,
  },
  infoLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  infoValue: {
    fontFamily: FONTS.ui.regular,
    fontSize: 15,
    color: COLORS.text,
  },
  separator: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    marginVertical: SPACING.sm,
  },
  errorText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: '#EF4444',
    textAlign: 'center',
    marginTop: SPACING.md,
  },
});
