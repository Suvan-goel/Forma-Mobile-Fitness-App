import React from 'react';
import { View, StyleSheet, Text, TouchableOpacity, ScrollView, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, ChevronRight, User, Bell, Lock, HelpCircle, LogOut } from 'lucide-react-native';
import { COLORS, SPACING, FONTS } from '../constants/theme';

const CARD_GRADIENT_COLORS: [string, string, string] = ['#1A1A1A', '#0F0F0F', '#0A0A0A'];

interface SettingsScreenProps {
  navigation: any;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({ navigation }) => {
  const insets = useSafeAreaInsets();

  const SettingItem = ({ icon: Icon, label, onPress, isLast }: { icon: any; label: string; onPress?: () => void; isLast?: boolean }) => (
    <TouchableOpacity style={[styles.settingItem, isLast && styles.settingItemLast]} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.settingLeft}>
        <Icon size={22} color={COLORS.textSecondary} strokeWidth={1.5} />
        <Text style={styles.settingLabel}>{label}</Text>
      </View>
      <ChevronRight size={20} color={COLORS.textTertiary} strokeWidth={1.5} />
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <ChevronLeft size={24} color={COLORS.text} strokeWidth={1.5} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentInner} showsVerticalScrollIndicator={false}>
        {/* Account Section */}
        <Text style={styles.sectionTitle}>ACCOUNT</Text>
        <View style={styles.cardOuter}>
          <LinearGradient colors={CARD_GRADIENT_COLORS} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.cardGradient}>
            <View style={styles.cardGlass}>
              <SettingItem icon={User} label="Profile" />
              <SettingItem icon={Bell} label="Notifications" />
              <SettingItem icon={Lock} label="Privacy" isLast />
            </View>
          </LinearGradient>
        </View>

        {/* Support Section */}
        <Text style={styles.sectionTitle}>SUPPORT</Text>
        <View style={styles.cardOuter}>
          <LinearGradient colors={CARD_GRADIENT_COLORS} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.cardGradient}>
            <View style={styles.cardGlass}>
              <SettingItem icon={HelpCircle} label="Help Center" isLast />
            </View>
          </LinearGradient>
        </View>

        {/* Logout */}
        <TouchableOpacity style={styles.logoutButton} activeOpacity={0.7}>
          <LogOut size={22} color="#EF4444" strokeWidth={1.5} />
          <Text style={styles.logoutText}>Log Out</Text>
        </TouchableOpacity>
      </ScrollView>
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
    paddingVertical: SPACING.md,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#27272A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: 20,
    fontFamily: FONTS.display.semibold,
    color: COLORS.text,
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  placeholder: {
    width: 40,
  },
  content: {
    flex: 1,
  },
  contentInner: {
    paddingHorizontal: SPACING.screenHorizontal,
    paddingBottom: SPACING.xxl,
  },
  sectionTitle: {
    fontSize: 11,
    fontFamily: FONTS.ui.regular,
    color: COLORS.textTertiary,
    marginTop: SPACING.xl,
    marginBottom: SPACING.sm,
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  cardOuter: {
    borderRadius: 22,
    overflow: 'hidden',
    marginBottom: SPACING.md,
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
    borderRadius: 22,
  },
  cardGlass: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    overflow: 'hidden',
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  settingItemLast: {
    borderBottomWidth: 0,
  },
  settingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  settingLabel: {
    fontSize: 16,
    fontFamily: FONTS.ui.regular,
    color: COLORS.text,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: SPACING.xxl,
    paddingVertical: SPACING.md,
  },
  logoutText: {
    fontSize: 16,
    fontFamily: FONTS.ui.bold,
    color: '#EF4444',
  },
});

