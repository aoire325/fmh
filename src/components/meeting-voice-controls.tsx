import { useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import type { MeetingVoice } from '@/calls/use-meeting-voice';
import { colors } from '@/constants/palette';
import { ActionButton } from './action-button';
import { CallIconButton } from './call-icon-button';

export function MeetingVoiceControls({ voice, compact, composer }: { voice: MeetingVoice; compact: boolean; composer: ReactNode }) {
  const [open, setOpen] = useState(false);
  const panel = <View style={styles.content}>
    <View style={styles.card}>
      <Text style={styles.title}>Meeting voice</Text>
      <Text style={styles.body}>Your guest can hear the text you choose to speak, even with your microphone off.</Text>
      <View style={styles.choices}>{(['male', 'female', 'personal'] as const).map((choice) => <Pressable key={choice}
        accessibilityRole="radio" accessibilityLabel={`${choice === 'personal' ? 'Personal' : choice === 'male' ? 'Male' : 'Female'} meeting voice`}
        accessibilityState={{ checked: voice.voice === choice, disabled: choice === 'personal' && voice.settings.profile?.status !== 'ready' }}
        disabled={choice === 'personal' && voice.settings.profile?.status !== 'ready'} onPress={() => voice.chooseVoice(choice)}
        style={[styles.choice, voice.voice === choice && styles.selected, choice === 'personal' && voice.settings.profile?.status !== 'ready' && styles.disabled]}>
        <Text style={[styles.choiceText, voice.voice === choice && styles.selectedText]}>{choice === 'male' ? 'Male' : choice === 'female' ? 'Female' : 'My voice'}</Text>
      </Pressable>)}</View>
      <Text style={styles.hint}>{voice.voice === 'personal' ? voice.settings.profile?.name : voice.settings.defaults?.[voice.voice]}</Text>
      <View style={styles.row}><View style={styles.copy}><Text style={styles.label}>Speak recognized signs</Text>
        <Text style={styles.hint}>Automatically speak each recognized word or completed sentence in your selected AI voice.</Text></View>
        <Switch accessibilityLabel="Speak recognized signs in the meeting" value={voice.automatic} onValueChange={voice.setAutomatic}
          trackColor={{ false: colors.line, true: colors.accent }} />
      </View>
      <View style={styles.row}><View style={styles.copy}><Text style={styles.label}>Hear guest’s AI voice</Text>
        <Text style={styles.hint}>Play their spoken messages on this phone.</Text></View>
        <Switch accessibilityLabel="Hear guest meeting voice" value={voice.listen} onValueChange={voice.setListen}
          trackColor={{ false: colors.line, true: colors.accent }} />
      </View>
      <ActionButton label="Stop meeting voice" text="Stop voice" icon="■" onPress={voice.stop} />
      <Text style={styles.hint}>Speaking sends your chosen text to ElevenLabs through your voice service. Speech audio is shared privately with your guest. Both callers need the updated TalkBridge app.</Text>
      {!voice.connected ? <Text style={styles.hint}>Your voice will be ready after a guest connects.</Text>
        : voice.peerSpeech === 'unknown' ? <Text style={styles.hint}>Waiting for your guest’s meeting voice support. They may need to reload the updated app.</Text>
          : voice.peerSpeech === 'muted' ? <Text style={styles.hint}>Your guest has turned off AI voice playback.</Text> : null}
      {!voice.settings.service?.configured ? <>
        <Text style={styles.hint}>{voice.settings.connectionError || voice.settings.service?.message || 'Checking your AI voice connection…'}</Text>
        <ActionButton label="Refresh meeting voices" text="Refresh voices" disabled={voice.settings.refreshing} onPress={voice.settings.refresh} />
      </> : null}
      <View accessibilityLiveRegion="polite">
        {voice.outgoing.phase !== 'idle' ? <Text style={styles.status}>{voice.outgoing.phase === 'preparing' ? 'Preparing your voice…' : 'Sending voice to your guest…'}</Text> : null}
        {voice.incoming.phase !== 'idle' ? <Text style={styles.status}>Playing your guest’s voice…</Text> : null}
        {voice.outgoing.message || voice.incoming.message || voice.notice ? <Text style={styles.status}>{voice.outgoing.message || voice.incoming.message || voice.notice}</Text> : null}
      </View>
    </View>
    {composer}
  </View>;
  if (!compact) return panel;
  return <View>
    <CallIconButton label="Meeting voice and typed speech" hint="Choose your voice, type a message, or stop speech"
      icon={{ ios: 'speaker.wave.2.fill', android: 'record_voice_over', web: 'record_voice_over' }} onPress={() => setOpen(true)} />
    <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
      <View style={styles.modal}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close meeting voice" onPress={() => setOpen(false)} style={StyleSheet.absoluteFill} />
        <View style={styles.sheet}>
          <View style={styles.sheetHeading}><Text style={styles.title}>Speak in your meeting</Text>
            <CallIconButton label="Close meeting voice" icon={{ ios: 'xmark', android: 'close', web: 'close' }} onPress={() => setOpen(false)} /></View>
          <ScrollView keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets contentContainerStyle={styles.content}>{panel}</ScrollView>
        </View>
      </View>
    </Modal>
  </View>;
}
const styles = StyleSheet.create({
  content: { gap: 14 }, card: { padding: 18, borderRadius: 22, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, gap: 12 },
  title: { color: colors.navy, fontSize: 18, fontWeight: '700' }, body: { color: colors.inkSoft, fontSize: 14, lineHeight: 21 },
  hint: { color: colors.inkSoft, fontSize: 12, lineHeight: 18 }, label: { color: colors.navy, fontSize: 14, fontWeight: '700' },
  row: { flexDirection: 'row', gap: 12, alignItems: 'center' }, copy: { flex: 1, gap: 4 }, choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { flex: 1, minWidth: 74, minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', padding: 10 },
  selected: { backgroundColor: colors.navy, borderColor: colors.navy }, choiceText: { color: colors.navy, fontSize: 14, fontWeight: '700' }, selectedText: { color: colors.white }, disabled: { opacity: 0.4 },
  status: { color: colors.tealDeep, fontSize: 13, lineHeight: 19 }, modal: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '90%', padding: 18, paddingBottom: 28, backgroundColor: colors.canvas, borderTopLeftRadius: 24, borderTopRightRadius: 24, gap: 14 },
  sheetHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
});
