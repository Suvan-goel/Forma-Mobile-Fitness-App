import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

// Minimal test app to verify Expo Go works
export default function TestApp() {
  return (
    <SafeAreaProvider>
      <View style={styles.container}>
        <Text style={styles.text}>Expo Go Test - If you see this, it works!</Text>
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    color: '#FFFFFF',
    fontSize: 20,
  },
});



