import { router } from 'expo-router';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { ActionButton } from './action-button';
import { colors } from '@/constants/palette';
import { useVoiceSettings } from '@/state/voice-settings';
import { VOICE_LABELS } from '@/voice/types';

export function SpeechControls({ text, onBeforeSpeak }: { text: string; onBeforeSpeak: () => void }) {
  const voice = useVoiceSettings();
  const busy = voice.speech.phase !== 'idle';
  return <View style={styles.card}>
    <View style={styles.heading}>
      <Text style={styles.title}>Speak out loud</Text>
      <Text style={styles.label}>{VOICE_LABELS[voice.preferences.voice]}</Text>
    </View>
    <View style={styles.actions}>
      <ActionButton label="Speak transcript out loud" text={voice.speech.phase === 'preparing' ? 'Preparing voice…' : 'Speak'}
        icon="◖" variant="dark" disabled={!text.trim() || busy} onPress={() => { onBeforeSpeak(); voice.speak(text); }} />
      {busy ? <ActionButton label="Stop speaking" text="Stop" icon="■" onPress={voice.stop} /> : null}
      <ActionButton label="Choose a voice or upload a voice video" text="Choose voice" onPress={() => router.push('/voice')} />
    </View>
    <View style={styles.row}>
      <View style={styles.copy}><Text style={styles.settingTitle}>Speak accepted signs automatically</Text>
        <Text style={styles.hint}>Reads each word or sentence after you add it. Review AI suggestions before adding them.</Text></View>
      <Switch accessibilityLabel="Speak accepted signs automatically" value={voice.preferences.autoSpeak}
        onValueChange={(autoSpeak) => voice.setPreferences({ autoSpeak })} trackColor={{ false: colors.line, true: colors.accent }} />
    </View>
    {voice.preferences.voice !== 'device' ? <Text style={styles.hint}>AI speech sends the accepted text to the online voice service and ElevenLabs.</Text> : null}
    {busy || voice.speech.message ? <Text accessibilityLiveRegion="polite" style={styles.hint}>
      {voice.speech.message || (voice.speech.phase === 'preparing' ? 'Preparing your speech…' : `Speaking${voice.speech.queued ? ` · ${voice.speech.queued} waiting` : ''}`)}
    </Text> : null}
  </View>;
}
const styles = StyleSheet.create({
  card: { gap: 12, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 14 },
  heading: { gap: 4 }, title: { color: colors.navy, fontSize: 16, fontWeight: '800' },
  label: { color: colors.tealDeep, fontSize: 12, fontWeight: '600' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'center' }, copy: { flex: 1, gap: 4 },
  settingTitle: { color: colors.navy, fontSize: 13, fontWeight: '700' },
  hint: { color: colors.inkSoft, fontSize: 12, lineHeight: 18 },
});
