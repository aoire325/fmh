import { useState } from 'react';
import { useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { ScrollView, StyleSheet, Switch, Text, View, Pressable, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '@/constants/palette';
import { useAccessibilitySettings } from '@/state/accessibility-settings';
import { InformationBar } from '@/components/information-bar';

export default function SettingsScreen() {
  const { largeText, highContrast, setLargeText, setHighContrast } = useAccessibilitySettings();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [microphonePermission, requestMicrophonePermission] = useMicrophonePermissions();
  const [permissionMessage, setPermissionMessage] = useState('');

  const askFor = async (kind: 'camera' | 'microphone') => {
    setPermissionMessage('');
    const current = kind === 'camera' ? cameraPermission : microphonePermission;
    const request = kind === 'camera' ? requestCameraPermission : requestMicrophonePermission;
    if (current && !current.granted && !current.canAskAgain) {
      setPermissionMessage(`Allow ${kind} access in your device settings to use it with TalkBridge.`);
      await Linking.openSettings();
      return;
    }
    const result = await request();
    setPermissionMessage(result.granted ? `${kind === 'camera' ? 'Camera' : 'Microphone'} access is allowed.` : `${kind === 'camera' ? 'Camera' : 'Microphone'} access was not allowed.`);
  };

  return <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
    <InformationBar page="settings" />
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text accessibilityRole="header" style={styles.title}>Setting</Text>

      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.cardTitle}>Accessibility</Text>
        <Text style={styles.bodyText}>Adjust the reading experience for this session.</Text>
        <SettingSwitch label="Larger transcript text" description="Increase the transcript and heading size." value={largeText} onValueChange={setLargeText} />
        <View style={styles.separator} />
        <SettingSwitch label="Higher contrast transcript" description="Use darker text in the introduction and transcript." value={highContrast} onValueChange={setHighContrast} />
      </View>

      <PermissionCard title="Microphone access" description="Allow TalkBridge to use your microphone during calls when you choose to turn it on."
        status={microphonePermission?.granted ? 'Allowed' : 'Not allowed'} onPress={() => void askFor('microphone')} />
      <PermissionCard title="Camera access" description="Allow TalkBridge to use your camera for calls and sign recognition."
        status={cameraPermission?.granted ? 'Allowed' : 'Not allowed'} onPress={() => void askFor('camera')} />
      {permissionMessage ? <Text accessibilityLiveRegion="polite" style={styles.permissionMessage}>{permissionMessage}</Text> : null}
    </ScrollView>
  </SafeAreaView>;
}

function SettingSwitch({ label, description, value, onValueChange }: {
  label: string; description: string; value: boolean; onValueChange: (value: boolean) => void;
}) {
  return <View style={styles.settingRow}>
    <View style={styles.settingCopy}><Text style={styles.settingTitle}>{label}</Text><Text style={styles.settingDescription}>{description}</Text></View>
    <Switch accessibilityLabel={label} accessibilityHint={description} accessibilityRole="switch" accessibilityState={{ checked: value }}
      value={value} onValueChange={onValueChange} trackColor={{ false: colors.line, true: colors.accent }} thumbColor={value ? colors.teal : colors.white} />
  </View>;
}

function PermissionCard({ title, description, status, onPress }: { title: string; description: string; status: string; onPress: () => void }) {
  return <View style={styles.card}>
    <View style={styles.permissionHeading}><Text accessibilityRole="header" style={styles.cardTitle}>{title}</Text><Text style={styles.status}>{status}</Text></View>
    <Text style={styles.bodyText}>{description}</Text>
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.permissionButton, pressed && styles.pressed]}>
      <Text style={styles.permissionButtonText}>{status === 'Allowed' ? 'Check permission' : 'Allow access'}</Text>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.canvas },
  content: { width: '100%', maxWidth: 860, alignSelf: 'center', paddingHorizontal: 22, paddingTop: 20, paddingBottom: 32, gap: 16 },
  title: { color: colors.navy, fontSize: 36, fontWeight: '800', letterSpacing: -1, marginVertical: 8 },
  card: { borderRadius: 20, padding: 18, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, gap: 11 },
  cardTitle: { color: colors.navy, fontSize: 19, fontWeight: '800' }, bodyText: { color: colors.inkSoft, fontSize: 14, lineHeight: 21 },
  separator: { height: 1, backgroundColor: colors.line, marginVertical: 2 },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 }, settingCopy: { flex: 1, gap: 3 },
  settingTitle: { color: colors.navy, fontSize: 14, fontWeight: '700' }, settingDescription: { color: colors.inkSoft, fontSize: 12, lineHeight: 17 },
  permissionHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  status: { color: colors.tealDeep, fontSize: 12, fontWeight: '700' },
  permissionButton: { minHeight: 48, paddingHorizontal: 16, borderRadius: 13, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  permissionButtonText: { color: colors.tealDeep, fontSize: 14, fontWeight: '800' }, permissionMessage: { color: colors.tealDeep, fontSize: 13, lineHeight: 19 }, pressed: { opacity: 0.75 },
});
