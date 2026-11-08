import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { TalkBridgeWordmark } from '@/components/talkbridge-wordmark';
import { colors } from '@/constants/palette';

export function InformationBar({ page, onHome }: { page: 'home' | 'about' | 'call' | 'settings'; onHome?: () => void }) {
  const [focused, setFocused] = useState('');
  const help = () => Alert.alert('TalkBridge help',
    'Choose New for an Instant Meeting or to create a meeting for later. Select a date in the weekly calendar to view or schedule calls.\n\nEnter an invitation in the code box and choose Join to open the call lobby.\n\nOpen Setting to adjust text size and contrast.', [{ text: 'Got it' }]);
  const links = [
    { label: 'Homepage', action: () => page === 'home' ? onHome?.() : router.navigate({ pathname: '/', params: { view: 'welcome' } }) },
    ...(page === 'home' ? [{ label: 'About Us', action: () => router.push('/about') }] : []),
    ...(page === 'home' || page === 'about' || page === 'settings' ? [{ label: 'Setting', action: () => router.push('/settings') }] : []),
    ...(page === 'home' ? [{ label: 'Help', action: help }] : []),
  ];
  return <View style={styles.bar}>
    <View style={styles.content}>
      <TalkBridgeWordmark />
      <View style={styles.navigation}>
        {links.map(({ label, action }) => <Pressable key={label} accessibilityRole="button" accessibilityLabel={label}
          accessibilityState={{ selected: label === 'Homepage' && page === 'home' || label === 'Setting' && page === 'settings' }}
          onPress={action} onFocus={() => setFocused(label)} onBlur={() => setFocused('')}
          style={({ pressed }) => [styles.button, (label === 'Homepage' && page === 'home' || label === 'Setting' && page === 'settings') && styles.active, focused === label && styles.focused, pressed && styles.pressed]}>
          {label === 'Help' ? <Text style={styles.helpIcon} allowFontScaling={false} aria-hidden>?</Text> : <Text style={styles.buttonText}>{label}</Text>}
        </Pressable>)}
      </View>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  bar: { backgroundColor: colors.tealDeep },
  content: { width: '100%', maxWidth: 1120, alignSelf: 'center', paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: 16, rowGap: 8 },
  navigation: { maxWidth: '100%', marginLeft: 'auto', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', gap: 4 },
  button: { minWidth: 48, minHeight: 48, paddingHorizontal: 10, paddingVertical: 10, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  active: { backgroundColor: 'rgba(255, 255, 255, 0.1)' }, pressed: { backgroundColor: colors.teal },
  focused: { outlineWidth: 2, outlineColor: '#FFFFFF', outlineOffset: 2 }, buttonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700', textAlign: 'center' },
  helpIcon: { color: '#FFFFFF', width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, borderColor: '#FFFFFF', fontSize: 20, lineHeight: 25, fontWeight: '700', textAlign: 'center' },
});
