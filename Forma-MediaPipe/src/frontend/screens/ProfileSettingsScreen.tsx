import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Text,
  TouchableOpacity,
  ScrollView,
  Platform,
  Animated,
  TextInput,
  ActivityIndicator,
  Image,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, Camera, Mail, Calendar, User, Shield } from 'lucide-react-native';
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
import { useAlert } from '../contexts/AlertContext';

interface ProfileSettingsScreenProps {
  navigation: any;
}

export const ProfileSettingsScreen: React.FC<ProfileSettingsScreenProps> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const { showAlert } = useAlert();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const { user, isLoading: userLoading, refetch } = useUser();
  const { updateProfile, uploadAvatar, isUpdating, error } = useUpdateUser();

  const [displayName, setDisplayName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');

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
      setFirstName(user.firstName ?? '');
      setLastName(user.lastName ?? '');
    }
  }, [user]);

  const hasNameChanged =
    firstName.trim() !== (user?.firstName ?? '') ||
    lastName.trim() !== (user?.lastName ?? '');
  const hasDisplayNameChanged = displayName.trim() !== (user?.displayName ?? '');

  const handleSaveDisplayName = async () => {
    if (!hasDisplayNameChanged || !displayName.trim()) return;
    const result = await updateProfile({ displayName: displayName.trim() });
    if (result.success) {
      await refetch();
      showAlert('Success', 'Display name updated.');
    } else {
      showAlert('Error', result.error ?? 'Failed to update display name.');
    }
  };

  const handleSaveName = async () => {
    const trimmedFirst = firstName.trim();
    if (!trimmedFirst) {
      showAlert('First name required', 'Please enter your first name.');
      return;
    }
    const result = await updateProfile({ firstName: trimmedFirst, lastName: lastName.trim() });
    if (result.success) {
      await refetch();
      showAlert('Success', 'Name updated.');
    } else {
      showAlert('Error', result.error ?? 'Failed to update name.');
    }
  };

  const handlePickAvatar = async () => {
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permissionResult.granted) {
      showAlert(
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
      showAlert('Error', uploadResult.error ?? 'Failed to upload avatar.');
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
            <ChevronLeft size={20} color={COLORS.text} strokeWidth={1.5} />
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Page Title */}
          <View style={styles.titleSection}>
            <Text style={styles.pageTitle}>Profile</Text>
            <Text style={styles.pageSubtitle}>Manage your personal information</Text>
          </View>

          {/* Avatar */}
          <View style={styles.avatarSection}>
            <TouchableOpacity onPress={handlePickAvatar} activeOpacity={0.7} disabled={isUpdating}>
              <View style={styles.avatarContainer}>
                <View style={styles.avatarRing}>
                  {user?.avatarUrl ? (
                    <Image source={{ uri: user.avatarUrl }} style={styles.avatarImage} />
                  ) : user ? (
                    <LinearGradient
                      colors={['#8B5CF6', '#7C3AED']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.avatarGradient}
                    >
                      <Text style={styles.avatarText}>{userInitial}</Text>
                    </LinearGradient>
                  ) : (
                    <View style={styles.avatarPlaceholder} />
                  )}
                </View>
                <View style={styles.cameraIconBadge}>
                  <Camera size={14} color={COLORS.text} strokeWidth={1.5} />
                </View>
              </View>
            </TouchableOpacity>
            <Text style={styles.tapToChange}>Tap to change photo</Text>
            {isUpdating && (
              <ActivityIndicator color={COLORS.primary} style={{ marginTop: SPACING.sm }} />
            )}
          </View>

          {/* Display Name Section */}
          <View style={styles.sectionHeader}>
            <View style={styles.sectionIconBadge}>
              <User size={12} color="#A78BFA" strokeWidth={1.5} />
            </View>
            <Text style={styles.sectionTitle}>Display Name</Text>
          </View>
          <View style={styles.cardOuter}>
            <LinearGradient
              colors={[...CARD_GRADIENT_COLORS]}
              start={CARD_GRADIENT_START}
              end={CARD_GRADIENT_END}
              style={styles.cardGradient}
            >
              <View style={styles.cardGlassEdge}>
                <TextInput
                  style={styles.textInput}
                  value={displayName}
                  onChangeText={setDisplayName}
                  placeholder="Enter your display name"
                  placeholderTextColor={COLORS.textTertiary}
                  autoCapitalize="words"
                  returnKeyType="done"
                  onSubmitEditing={handleSaveDisplayName}
                />
                {hasDisplayNameChanged && (
                  <TouchableOpacity
                    style={styles.saveButton}
                    onPress={handleSaveDisplayName}
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

          {/* Name Section */}
          <View style={styles.sectionHeader}>
            <View style={styles.sectionIconBadge}>
              <User size={12} color="#A78BFA" strokeWidth={1.5} />
            </View>
            <Text style={styles.sectionTitle}>Name</Text>
          </View>
          <View style={styles.cardOuter}>
            <LinearGradient
              colors={[...CARD_GRADIENT_COLORS]}
              start={CARD_GRADIENT_START}
              end={CARD_GRADIENT_END}
              style={styles.cardGradient}
            >
              <View style={styles.cardGlassEdge}>
                <View style={styles.infoRow}>
                  <View style={styles.infoIconBadge}>
                    <User size={14} color="#A78BFA" strokeWidth={1.5} />
                  </View>
                  <View style={styles.infoContent}>
                    <Text style={styles.infoLabel}>First name</Text>
                    <TextInput
                      style={styles.nameInput}
                      value={firstName}
                      onChangeText={setFirstName}
                      placeholder="First name"
                      placeholderTextColor={COLORS.textTertiary}
                      autoCapitalize="words"
                      returnKeyType="next"
                    />
                  </View>
                </View>
                <View style={styles.separator} />
                <View style={styles.infoRow}>
                  <View style={styles.infoIconBadge}>
                    <User size={14} color="#A78BFA" strokeWidth={1.5} />
                  </View>
                  <View style={styles.infoContent}>
                    <Text style={styles.infoLabel}>Last name</Text>
                    <TextInput
                      style={styles.nameInput}
                      value={lastName}
                      onChangeText={setLastName}
                      placeholder="Last name"
                      placeholderTextColor={COLORS.textTertiary}
                      autoCapitalize="words"
                      returnKeyType="done"
                      onSubmitEditing={handleSaveName}
                    />
                  </View>
                </View>
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

          {/* Account Details Section */}
          <View style={styles.sectionHeader}>
            <View style={styles.sectionIconBadge}>
              <Shield size={12} color="#A78BFA" strokeWidth={1.5} />
            </View>
            <Text style={styles.sectionTitle}>Account</Text>
          </View>
          <View style={styles.cardOuter}>
            <LinearGradient
              colors={[...CARD_GRADIENT_COLORS]}
              start={CARD_GRADIENT_START}
              end={CARD_GRADIENT_END}
              style={styles.cardGradient}
            >
              <View style={styles.cardGlassEdge}>
                <View style={styles.infoRow}>
                  <View style={styles.infoIconBadge}>
                    <Mail size={14} color="#A78BFA" strokeWidth={1.5} />
                  </View>
                  <View style={styles.infoContent}>
                    <Text style={styles.infoLabel}>Email</Text>
                    <Text style={styles.infoValue}>{user?.email ?? ''}</Text>
                  </View>
                </View>
                {joinDate ? (
                  <>
                    <View style={styles.separator} />
                    <View style={styles.infoRow}>
                      <View style={styles.infoIconBadge}>
                        <Calendar size={14} color="#A78BFA" strokeWidth={1.5} />
                      </View>
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

  /* ── Header ──────────────────────────────── */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.md,
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

  /* ── Scroll ─────────────────────────────── */
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACING.screenHorizontal,
    paddingBottom: SPACING.xxxl + 40,
  },

  /* ── Page Title ──────────────────────────── */
  titleSection: {
    marginBottom: SPACING.xxl,
  },
  pageTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 28,
    color: COLORS.text,
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  pageSubtitle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 20,
  },

  /* ── Avatar ──────────────────────────────── */
  avatarSection: {
    alignItems: 'center',
    marginBottom: SPACING.xxl,
  },
  avatarContainer: {
    position: 'relative',
  },
  avatarRing: {
    borderRadius: 9999,
    padding: 3,
    borderWidth: 2,
    borderColor: 'rgba(139, 92, 246, 0.25)',
  },
  avatarImage: {
    width: 96,
    height: 96,
    borderRadius: 48,
  },
  avatarGradient: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarPlaceholder: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#000000',
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
    right: -2,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: COLORS.background,
  },
  tapToChange: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: SPACING.sm + 2,
    letterSpacing: 0.3,
  },

  /* ── Section Headers ───────────────────── */
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm + 2,
  },
  sectionIconBadge: {
    width: 22,
    height: 22,
    borderRadius: 7,
    backgroundColor: 'rgba(139, 92, 246, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textSecondary,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },

  /* ── Shared Gradient Card ────────────── */
  cardOuter: {
    borderRadius: 19,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#8B5CF6',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
      },
      android: { elevation: 4 },
    }),
  },
  cardGradient: {
    borderRadius: 19,
  },
  cardGlassEdge: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    padding: SPACING.lg,
    overflow: 'hidden',
  },

  /* ── Text Input ──────────────────────── */
  textInput: {
    fontFamily: FONTS.ui.regular,
    fontSize: 16,
    color: COLORS.text,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
    paddingVertical: SPACING.sm + 2,
  },
  nameInput: {
    fontFamily: FONTS.ui.regular,
    fontSize: 15,
    color: COLORS.text,
    letterSpacing: 0.1,
    paddingVertical: 2,
    marginTop: 2,
  },
  saveButton: {
    alignSelf: 'flex-end',
    marginTop: SPACING.md,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: COLORS.primary,
  },
  saveButtonText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 14,
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },

  /* ── Info Rows ───────────────────────── */
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 6,
  },
  infoIconBadge: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgba(139, 92, 246, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoContent: {
    flex: 1,
  },
  infoLabel: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
    letterSpacing: 0.5,
    marginBottom: 3,
  },
  infoValue: {
    fontFamily: FONTS.ui.regular,
    fontSize: 15,
    color: COLORS.text,
    letterSpacing: 0.1,
  },
  separator: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    marginVertical: SPACING.sm + 2,
  },

  /* ── Error ──────────────────────────── */
  errorText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: '#EF4444',
    textAlign: 'center',
    marginTop: SPACING.md,
  },
});
