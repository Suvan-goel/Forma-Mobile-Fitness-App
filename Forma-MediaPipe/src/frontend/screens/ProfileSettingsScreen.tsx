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
import { Camera, Mail, Calendar, LogOut, User, AlignLeft } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import {
  COLORS,
  SPACING,
  FONTS,
  CARD_GRADIENT_COLORS,
  CARD_GRADIENT_START,
  CARD_GRADIENT_END,
  CARD_RADIUS,
  CARD_RADIUS_SM,
  CARD_VERTICAL_GAP,
  CARD_SHADOW,
} from '../constants/theme';
import { ScreenBackground } from '../components/ui/ScreenBackground';
import { SettingsHeader } from '../components/ui/SettingsHeader';
import { useUpdateUser } from '../../backend/hooks/useUpdateUser';
import { useUser } from '../../backend/hooks/useUser';
import { useAuth } from '../../backend/contexts/AuthContext';
import { useAlert } from '../contexts/AlertContext';
import { getBottomOverlayPadding } from '../utils/safeAreaSpacing';

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
  const profileHandle = `@${(displayName || user?.displayName || 'forma')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 18) || 'forma'}`;
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
      <ScreenBackground style={[styles.container, { paddingTop: insets.top }]}>
        <SettingsHeader title="EDIT PROFILE" onBack={() => navigation.goBack()} />
        <View style={styles.loadingCenter}>
          <ActivityIndicator color={COLORS.primary} size="large" />
        </View>
      </ScreenBackground>
    );
  }

  return (
    <ScreenBackground style={[styles.container, { paddingTop: insets.top }]}>
      <SettingsHeader title="EDIT PROFILE" onBack={() => navigation.goBack()} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: getBottomOverlayPadding(insets.bottom, 112) },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
          <LinearGradient
            colors={[...CARD_GRADIENT_COLORS]}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.heroCard}
          >
            <View style={styles.heroInner}>
              <TouchableOpacity
                onPress={handlePickAvatar}
                activeOpacity={0.8}
                disabled={isUpdating}
                style={styles.avatarTouch}
              >
                <View style={styles.avatarRing}>
                  {user?.avatarUrl ? (
                    <Image source={{ uri: user.avatarUrl }} style={styles.avatarImage} />
                  ) : user ? (
                    <LinearGradient
                      colors={['#F3F4F6', '#B8BCC5']}
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
                    {isUpdating ? (
                      <ActivityIndicator color="#FFFFFF" size="small" />
                    ) : (
                      <Camera size={13} color="#FFFFFF" strokeWidth={2.2} />
                    )}
                  </View>
                </View>
              </TouchableOpacity>

              <View style={styles.heroCopy}>
                <Text style={styles.displayName} numberOfLines={1}>
                  {displayName || user?.displayName || 'Forma Athlete'}
                </Text>
                <Text style={styles.handle} numberOfLines={1}>
                  {profileHandle}
                </Text>
                <TouchableOpacity
                  style={styles.changePhotoPill}
                  onPress={handlePickAvatar}
                  activeOpacity={0.75}
                  disabled={isUpdating}
                >
                  <Camera size={13} color={COLORS.primary} strokeWidth={2} />
                  <Text style={styles.changePhotoText}>Change photo</Text>
                </TouchableOpacity>
              </View>
            </View>
          </LinearGradient>

          {/* Display Name */}
          <View style={styles.sectionRow}>
            <View style={styles.sectionLabelRow}>
              <Text style={styles.sectionLabel}>PUBLIC PROFILE</Text>
            </View>
          </View>
          <LinearGradient
            colors={[...CARD_GRADIENT_COLORS]}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.cardGradient}
          >
            <View style={styles.groupEdge}>
              <View style={styles.fieldRow}>
                <View style={styles.iconBubble}>
                  <User size={16} color={COLORS.textSecondary} strokeWidth={1.8} />
                </View>
                <View style={styles.fieldContent}>
                  <Text style={styles.fieldLabel}>Display name</Text>
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
                </View>
                {hasDisplayNameChanged && (
                  <TouchableOpacity
                    style={[styles.compactSaveBtn, (!displayName.trim() || isUpdating) && styles.saveBtnDisabled]}
                    onPress={handleSaveDisplayName}
                    activeOpacity={0.75}
                    disabled={!displayName.trim() || isUpdating}
                  >
                    <Text style={styles.compactSaveText}>{isUpdating ? 'Saving' : 'Save'}</Text>
                  </TouchableOpacity>
                )}
              </View>

              <View style={styles.rowDivider} />

              <View style={styles.bioBlock}>
                <View style={styles.bioHeader}>
                  <View style={styles.bioLabelRow}>
                    <View style={styles.iconBubble}>
                      <AlignLeft size={16} color={COLORS.textSecondary} strokeWidth={1.8} />
                    </View>
                    <View>
                      <Text style={styles.fieldLabel}>Bio</Text>
                      <Text style={styles.fieldHint}>Shown on your public profile</Text>
                    </View>
                  </View>
                  <Text style={styles.bioCharCount}>{bio.length}/160</Text>
                </View>
                <TextInput
                  style={styles.bioInput}
                  value={bio}
                  onChangeText={setBio}
                  placeholder="Tell people a little about your training..."
                  placeholderTextColor={COLORS.textTertiary}
                  multiline
                  numberOfLines={3}
                  maxLength={160}
                  returnKeyType="default"
                  textAlignVertical="top"
                />
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
              <Text style={styles.sectionLabel}>PERSONAL DETAILS</Text>
            </View>
          </View>
          <LinearGradient
            colors={[...CARD_GRADIENT_COLORS]}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.cardGradient}
          >
            <View style={styles.groupEdge}>
              <View style={styles.fieldRow}>
                <View style={styles.iconBubble}>
                  <User size={16} color={COLORS.textSecondary} strokeWidth={1.8} />
                </View>
                <View style={styles.fieldContent}>
                  <Text style={styles.fieldLabel}>First name</Text>
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
              <View style={styles.rowDivider} />
              <View style={styles.fieldRow}>
                <View style={styles.iconBubble}>
                  <User size={16} color={COLORS.textSecondary} strokeWidth={1.8} />
                </View>
                <View style={styles.fieldContent}>
                  <Text style={styles.fieldLabel}>Last name</Text>
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
                  style={styles.groupSaveBtn}
                  onPress={handleSaveName}
                  activeOpacity={0.7}
                  disabled={isUpdating}
                >
                  <Text style={styles.groupSaveText}>{isUpdating ? 'Saving...' : 'Save personal details'}</Text>
                </TouchableOpacity>
              )}
            </View>
          </LinearGradient>

          {/* Account Details */}
          <View style={styles.sectionRow}>
            <View style={styles.sectionLabelRow}>
              <Text style={styles.sectionLabel}>ACCOUNT</Text>
            </View>
          </View>
          <LinearGradient
            colors={[...CARD_GRADIENT_COLORS]}
            start={CARD_GRADIENT_START}
            end={CARD_GRADIENT_END}
            style={styles.cardGradient}
          >
            <View style={styles.groupEdge}>
              <View style={styles.infoRow}>
                <View style={styles.iconBubble}>
                  <Mail size={16} color={COLORS.textSecondary} strokeWidth={1.8} />
                </View>
                <View style={styles.infoContent}>
                  <Text style={styles.infoLabel}>Email</Text>
                  <Text style={styles.infoValue} numberOfLines={1}>{user?.email ?? ''}</Text>
                </View>
              </View>
              {joinDate ? (
                <>
                  <View style={styles.rowDivider} />
                  <View style={styles.infoRow}>
                    <View style={[styles.iconBubble, styles.greenIconBubble]}>
                      <Calendar size={16} color={COLORS.green} strokeWidth={1.8} />
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
            <Text style={styles.errorText} selectable>{error}</Text>
          ) : null}
        </Animated.View>
      </ScrollView>
    </ScreenBackground>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  loadingCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACING.screenHorizontal,
    paddingTop: 4,
  },

  /* Profile hero */
  heroCard: {
    borderRadius: CARD_RADIUS,
    ...CARD_SHADOW,
    overflow: 'hidden',
    marginBottom: CARD_VERTICAL_GAP,
  },
  heroInner: {
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 14,
  },
  avatarTouch: {
    borderRadius: 46,
  },
  avatarRing: {
    width: 84,
    height: 84,
    borderRadius: 42,
    padding: 1,
    backgroundColor: 'rgba(255,255,255,0.58)',
    position: 'relative',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 41,
  },
  avatarGradient: {
    width: '100%',
    height: '100%',
    borderRadius: 41,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarPlaceholder: {
    width: '100%',
    height: '100%',
    borderRadius: 41,
    backgroundColor: '#27272A',
  },
  avatarText: {
    fontFamily: FONTS.display.bold,
    fontSize: 32,
    color: '#101418',
  },
  cameraBadge: {
    position: 'absolute',
    bottom: -1,
    right: -1,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: COLORS.background,
  },
  heroCopy: {
    flex: 1,
    gap: 4,
  },
  displayName: {
    fontFamily: FONTS.display.semibold,
    fontSize: 23,
    color: COLORS.text,
    letterSpacing: 0,
  },
  handle: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12.5,
    color: COLORS.textSecondary,
  },
  changePhotoPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 7,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: CARD_RADIUS_SM,
    backgroundColor: 'rgba(122, 85, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(122, 85, 255, 0.24)',
  },
  changePhotoText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 12,
    color: COLORS.primary,
  },

  /* Section Headers (matches Home) */
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 18,
    marginBottom: 8,
  },
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionLabel: {
    fontFamily: FONTS.display.semibold,
    fontSize: 11,
    color: COLORS.textSecondary,
    letterSpacing: 1.6,
  },

  /* Cards (matches Home) */
  cardGradient: {
    backgroundColor: COLORS.cardBackground,
    borderRadius: CARD_RADIUS,
    ...CARD_SHADOW,
    overflow: 'hidden',
  },
  groupEdge: {
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 64,
    paddingVertical: 10,
  },
  fieldContent: {
    flex: 1,
    gap: 3,
  },
  fieldLabel: {
    fontFamily: FONTS.display.regular,
    fontSize: 14,
    color: COLORS.text,
  },
  fieldHint: {
    fontFamily: FONTS.ui.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
    marginTop: 2,
  },
  rowDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.055)',
    marginLeft: 42,
  },
  iconBubble: {
    width: 30,
    height: 30,
    borderRadius: CARD_RADIUS_SM,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.055)',
  },
  greenIconBubble: {
    backgroundColor: 'rgba(52, 224, 166, 0.12)',
  },

  /* Inputs */
  textInput: {
    fontFamily: FONTS.ui.regular,
    fontSize: 14,
    color: COLORS.text,
    paddingVertical: 1,
  },
  nameInput: {
    fontFamily: FONTS.ui.regular,
    fontSize: 14,
    color: COLORS.text,
    paddingVertical: 1,
  },
  bioBlock: {
    paddingVertical: 13,
    gap: 11,
  },
  bioHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  bioLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  bioInput: {
    fontFamily: FONTS.ui.regular,
    fontSize: 14,
    color: COLORS.text,
    lineHeight: 21,
    minHeight: 86,
    padding: 12,
    borderRadius: CARD_RADIUS_SM,
    backgroundColor: 'rgba(255, 255, 255, 0.035)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  bioCharCount: {
    fontFamily: FONTS.mono.regular,
    fontVariant: ['tabular-nums'],
    fontSize: 10,
    color: COLORS.textTertiary,
  },
  compactSaveBtn: {
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: CARD_RADIUS_SM,
    backgroundColor: 'rgba(122, 85, 255, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(122, 85, 255, 0.30)',
  },
  compactSaveText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 12,
    color: COLORS.primary,
  },
  saveBtn: {
    alignSelf: 'flex-end',
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: CARD_RADIUS_SM,
    backgroundColor: COLORS.primary,
  },
  saveBtnText: {
    fontFamily: FONTS.display.regular,
    fontSize: 14,
    color: COLORS.text,
  },
  saveBtnDisabled: {
    opacity: 0.45,
  },
  groupSaveBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
    marginBottom: 10,
    paddingVertical: 12,
    borderRadius: CARD_RADIUS_SM,
    backgroundColor: 'rgba(122, 85, 255, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(122, 85, 255, 0.30)',
  },
  groupSaveText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 13,
    color: COLORS.primary,
  },

  /* Info Rows */
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 58,
    paddingVertical: 10,
  },
  infoContent: {
    flex: 1,
    gap: 3,
  },
  infoLabel: {
    fontFamily: FONTS.display.regular,
    fontSize: 14,
    color: COLORS.text,
  },
  infoValue: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12.5,
    color: COLORS.textTertiary,
  },

  /* Logout */
  logoutBtn: {
    marginTop: 16,
    borderRadius: CARD_RADIUS_SM,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.28)',
    backgroundColor: 'rgba(239, 68, 68, 0.16)',
  },
  logoutInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 13,
  },
  logoutText: {
    fontFamily: FONTS.display.semibold,
    fontSize: 13,
    color: COLORS.red,
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
