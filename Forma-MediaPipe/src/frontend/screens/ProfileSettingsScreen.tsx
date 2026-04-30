import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Text,
  TouchableOpacity,
  ScrollView,
  Animated,
  TextInput,
  ActivityIndicator,
  Image,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, Camera, Mail, Calendar, LogOut, User, AlignLeft, Shield } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import {
  COLORS,
  SPACING,
  FONTS,
  CARD_GRADIENT_COLORS,
  CARD_GRADIENT_START,
  CARD_GRADIENT_END,
  CARD_SHADOW
} from '../constants/theme';
import { useUser, useUpdateUser } from '../../backend/hooks';
import { useAuth } from '../../backend/contexts/AuthContext';
import { useAlert } from '../contexts/AlertContext';

interface ProfileSettingsScreenProps {
  navigation: any;
}

export const ProfileSettingsScreen: React.FC<ProfileSettingsScreenProps> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const { showAlert } = useAlert();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;
  const { user, isLoading: userLoading, refetch } = useUser();
  const { updateProfile, uploadAvatar, isUpdating, error } = useUpdateUser();
  const { signOut } = useAuth();

  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 700,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 700,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName);
      setBio(user.bio ?? '');
      setFirstName(user.firstName ?? '');
      setLastName(user.lastName ?? '');
    }
  }, [user]);

  const hasDisplayNameChanged = displayName.trim() !== (user?.displayName ?? '');
  const hasBioChanged = bio.trim() !== (user?.bio ?? '');
  const hasNameChanged =
    firstName.trim() !== (user?.firstName ?? '') ||
    lastName.trim() !== (user?.lastName ?? '');

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

  const handleSaveBio = async () => {
    if (!hasBioChanged) return;
    const result = await updateProfile({ bio: bio.trim() });
    if (result.success) {
      await refetch();
      showAlert('Success', 'Bio updated.');
    } else {
      showAlert('Error', result.error ?? 'Failed to update bio.');
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

  const handleLogout = () => {
    showAlert('Log Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log Out',
        style: 'destructive',
        onPress: async () => {
          try {
            await signOut();
          } catch (logoutError) {
            showAlert('Error', 'Failed to log out. Please try again.');
          }
        },
      },
    ]);
  };

  if (userLoading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top, alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={COLORS.primary} size="large" />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <ChevronLeft size={22} color={COLORS.textSecondary} strokeWidth={1.5} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Profile</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
          {/* Avatar */}
          <View style={styles.avatarSection}>
            <TouchableOpacity onPress={handlePickAvatar} activeOpacity={0.7} disabled={isUpdating}>
              <View style={styles.avatarWrapper}>
                {user?.avatarUrl ? (
                  <Image source={{ uri: user.avatarUrl }} style={styles.avatarImage} />
                ) : user ? (
                  <LinearGradient
                    colors={['#7C5CFF', '#6746E8']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.avatarGradient}
                  >
                    <Text style={styles.avatarText}>{userInitial}</Text>
                  </LinearGradient>
                ) : (
                  <View style={styles.avatarPlaceholder} />
                )}
                <View style={styles.cameraBadge}>
                  <Camera size={13} color="#FFFFFF" strokeWidth={2} />
                </View>
              </View>
            </TouchableOpacity>
            <Text style={styles.tapToChange}>Tap to change photo</Text>
            {isUpdating && (
              <ActivityIndicator color={COLORS.primary} style={{ marginTop: SPACING.sm }} />
            )}
          </View>

          {/* Display Name */}
          <View style={styles.sectionRow}>
            <View style={styles.sectionLabelRow}>
              <User size={13} color={COLORS.accent} strokeWidth={1.5} />
              <Text style={styles.sectionLabel}>DISPLAY NAME</Text>
            </View>
          </View>
          <LinearGradient
            colors={[...CARD_GRADIENT_COLORS]}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.cardGradient}
          >
            <View style={styles.cardEdge}>
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
                  style={styles.saveBtn}
                  onPress={handleSaveDisplayName}
                  activeOpacity={0.7}
                  disabled={isUpdating}
                >
                  <Text style={styles.saveBtnText}>{isUpdating ? 'Saving...' : 'Save'}</Text>
                </TouchableOpacity>
              )}
            </View>
          </LinearGradient>

          {/* Bio */}
          <View style={styles.sectionRow}>
            <View style={styles.sectionLabelRow}>
              <AlignLeft size={13} color={COLORS.accent} strokeWidth={1.5} />
              <Text style={styles.sectionLabel}>BIO</Text>
            </View>
          </View>
          <LinearGradient
            colors={[...CARD_GRADIENT_COLORS]}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.cardGradient}
          >
            <View style={styles.cardEdge}>
              <TextInput
                style={styles.bioInput}
                value={bio}
                onChangeText={setBio}
                placeholder="Tell people a little about yourself..."
                placeholderTextColor={COLORS.textTertiary}
                multiline
                numberOfLines={3}
                maxLength={160}
                returnKeyType="default"
                textAlignVertical="top"
              />
              <View style={styles.bioFooter}>
                <Text style={styles.bioCharCount}>{bio.length}/160</Text>
                {hasBioChanged && (
                  <TouchableOpacity
                    style={styles.saveBtn}
                    onPress={handleSaveBio}
                    activeOpacity={0.7}
                    disabled={isUpdating}
                  >
                    <Text style={styles.saveBtnText}>{isUpdating ? 'Saving...' : 'Save'}</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </LinearGradient>

          {/* Name */}
          <View style={styles.sectionRow}>
            <View style={styles.sectionLabelRow}>
              <User size={13} color={COLORS.accent} strokeWidth={1.5} />
              <Text style={styles.sectionLabel}>NAME</Text>
            </View>
          </View>
          <LinearGradient
            colors={[...CARD_GRADIENT_COLORS]}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.cardGradient}
          >
            <View style={styles.cardEdge}>
              <View style={styles.infoRow}>
                <User size={14} color="#A78BFA" strokeWidth={1.5} />
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
              <View style={styles.divider} />
              <View style={styles.infoRow}>
                <User size={14} color="#A78BFA" strokeWidth={1.5} />
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
                  style={styles.saveBtn}
                  onPress={handleSaveName}
                  activeOpacity={0.7}
                  disabled={isUpdating}
                >
                  <Text style={styles.saveBtnText}>{isUpdating ? 'Saving...' : 'Save'}</Text>
                </TouchableOpacity>
              )}
            </View>
          </LinearGradient>

          {/* Account Details */}
          <View style={styles.sectionRow}>
            <View style={styles.sectionLabelRow}>
              <Shield size={13} color={COLORS.accent} strokeWidth={1.5} />
              <Text style={styles.sectionLabel}>ACCOUNT</Text>
            </View>
          </View>
          <LinearGradient
            colors={[...CARD_GRADIENT_COLORS]}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.cardGradient}
          >
            <View style={styles.cardEdge}>
              <View style={styles.infoRow}>
                <Mail size={14} color="#A78BFA" strokeWidth={1.5} />
                <View style={styles.infoContent}>
                  <Text style={styles.infoLabel}>Email</Text>
                  <Text style={styles.infoValue}>{user?.email ?? ''}</Text>
                </View>
              </View>
              {joinDate ? (
                <>
                  <View style={styles.divider} />
                  <View style={styles.infoRow}>
                    <Calendar size={14} color="#34D399" strokeWidth={1.5} />
                    <View style={styles.infoContent}>
                      <Text style={styles.infoLabel}>Member Since</Text>
                      <Text style={styles.infoValue}>{joinDate}</Text>
                    </View>
                  </View>
                </>
              ) : null}
            </View>
          </LinearGradient>

          {/* Logout */}
          <TouchableOpacity
            style={styles.logoutBtn}
            activeOpacity={0.7}
            onPress={handleLogout}
          >
            <View style={styles.logoutInner}>
              <LogOut size={16} color="#EF4444" strokeWidth={1.5} />
              <Text style={styles.logoutText}>Log Out</Text>
            </View>
          </TouchableOpacity>

          {error ? (
            <Text style={styles.errorText}>{error}</Text>
          ) : null}
        </Animated.View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },

  /* Header */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: 6,
    paddingBottom: 12,
  },
  backBtn: {
    width: 28,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -6,
  },
  headerTitle: {
    fontFamily: FONTS.display.bold,
    fontSize: 18,
    color: COLORS.text,
    letterSpacing: -0.4,
    flex: 1,
  },
  headerSpacer: {
    width: 28,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACING.screenHorizontal,
    paddingBottom: 150,
    paddingTop: 4,
  },

  /* Avatar */
  avatarSection: {
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 8,
  },
  avatarWrapper: {
    position: 'relative',
  },
  avatarImage: {
    width: 90,
    height: 90,
    borderRadius: 45,
  },
  avatarGradient: {
    width: 90,
    height: 90,
    borderRadius: 45,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarPlaceholder: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: '#27272A',
  },
  avatarText: {
    fontFamily: FONTS.display.bold,
    fontSize: 36,
    color: '#FFFFFF',
  },
  cameraBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: COLORS.background,
  },
  tapToChange: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
    marginTop: SPACING.sm,
  },

  /* Section Headers (matches Home) */
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
    marginBottom: 7,
  },
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionLabel: {
    fontFamily: FONTS.display.bold,
    fontSize: 9.5,
    color: COLORS.textSecondary,
    letterSpacing: 1.3,
  },

  /* Cards (matches Home) */
  cardGradient: {
    borderRadius: 8,

    ...CARD_SHADOW,
    overflow: 'hidden',
},
  cardEdge: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.11)',
    borderTopColor: 'rgba(255, 255, 255, 0.15)',
    padding: 12,
  },

  /* Inputs */
  textInput: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.text,
    paddingVertical: SPACING.sm,
  },
  nameInput: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.text,
    paddingVertical: 2,
    marginTop: 2,
  },
  bioInput: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: COLORS.text,
    lineHeight: 22,
    minHeight: 72,
    paddingVertical: SPACING.sm,
  },
  bioFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: SPACING.xs,
  },
  bioCharCount: {
    fontFamily: FONTS.mono.regular,
    fontSize: 10,
    color: COLORS.textTertiary,
  },
  saveBtn: {
    alignSelf: 'flex-end',
    marginTop: SPACING.sm,
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.3)',
  },
  saveBtnText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 13,
    color: '#A78BFA',
    letterSpacing: 0.3,
  },

  /* Info Rows */
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 10,
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
    fontSize: 12.5,
    color: COLORS.text,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    marginVertical: 8,
  },

  /* Logout */
  logoutBtn: {
    marginTop: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.12)',
    backgroundColor: 'rgba(239, 68, 68, 0.04)',
  },
  logoutInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 16,
  },
  logoutText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 15,
    color: '#EF4444',
    letterSpacing: 0.3,
  },

  /* Error */
  errorText: {
    fontFamily: FONTS.ui.regular,
    fontSize: 13,
    color: '#EF4444',
    textAlign: 'center',
    marginTop: SPACING.md,
  },
});
