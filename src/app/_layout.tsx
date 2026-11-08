import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { AccessibilitySettingsProvider } from '@/state/accessibility-settings';
import { VoiceSettingsProvider } from '@/state/voice-settings';
import { colors } from '@/constants/palette';

export default function RootLayout() {
  return (
    <AccessibilitySettingsProvider>
      <VoiceSettingsProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.canvas },
            animation: 'slide_from_right',
          }}
        />
      </VoiceSettingsProvider>
    </AccessibilitySettingsProvider>
  );
} 

