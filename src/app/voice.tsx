import { useCallback, useEffect, useRef, useState } from 'react';
import { router, useIsFocused } from 'expo-router';
import type * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import { ActivityIndicator, Alert, Keyboard, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ActionButton } from '@/components/action-button';
import { colors } from '@/constants/palette';
import { useVoiceSettings } from '@/state/voice-settings';
import { VoiceClient } from '@/voice/voice-client';
import { VOICE_LABELS, type VoiceChoice } from '@/voice/types';
import { requireVoiceNativeSupport } from '@/voice/native-support';

type Video = Pick<DocumentPicker.DocumentPickerAsset, 'uri' | 'name' | 'size' | 'mimeType'>;
function removeCachedVideo(video: Video | null) {
  if (!video || !video.uri.startsWith(`${Paths.cache.uri.replace(/\/$/, '')}/`)) return;
  try { const file = new File(video.uri); if (file.exists) file.delete(); } catch { /* The OS also expires its cache. */ }
}

export default function VoiceScreen() {
  const voice = useVoiceSettings();
  const { refresh, stop } = voice;
  const focused = useIsFocused();
  const [video, setVideo] = useState<Video | null>(null);
  const selectedVideo = useRef<Video | null>(null);
  const [name, setName] = useState('My voice');
  const [consent, setConsent] = useState(false);
  const [working, setWorking] = useState<'creating' | 'deleting' | 'connecting' | 'picking' | null>(null);
  const [notice, setNotice] = useState('');
  const [testText, setTestText] = useState('Hello. This is my voice. Thank you for listening.');
  const [accessKey, setAccessKey] = useState('');
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const busy = voice.speech.phase !== 'idle';
  const online = voice.service?.configured === true;
  const locked = !!working || voice.refreshing;

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { if (!focused) stop(); }, [focused, stop]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current?.abort(); removeCachedVideo(selectedVideo.current); stop(); };
  }, [stop]);
  const select = (choice: VoiceChoice) => {
    Keyboard.dismiss(); voice.setPreferences({ voice: choice }); setNotice('');
  };
  const pickVideo = async () => {
    setNotice(''); setWorking('picking');
    try {
      requireVoiceNativeSupport('ExpoDocumentPicker');
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Keep older native builds usable until the picker is requested.
      const DocumentPicker = require('expo-document-picker') as typeof import('expo-document-picker');
      const result = await DocumentPicker.getDocumentAsync({ type: 'video/*', copyToCacheDirectory: true, multiple: false });
      if (result.canceled) return;
      const next = result.assets[0];
      if (!mounted.current) { removeCachedVideo(next); return; }
      if (new File(next.uri).size > 50 * 1024 * 1024) {
        removeCachedVideo(next); setNotice('Choose a video smaller than 50 MB. A short clip with clear speech works best.'); return;
      }
      removeCachedVideo(selectedVideo.current); selectedVideo.current = next;
      setVideo(next); setConsent(false);
    } catch (error) { if (mounted.current) setNotice(error instanceof Error ? error.message : 'The video picker could not open. Try again.'); }
    finally { if (mounted.current) setWorking(null); }
  };
  const createVoice = async () => {
    if (!video || !consent || !name.trim() || locked) return;
    Keyboard.dismiss(); voice.stop(); setWorking('creating'); setNotice('');
    const controller = new AbortController(); request.current = controller;
    const timer = setTimeout(() => controller.abort(), 240000);
    try {
      const profile = await VoiceClient.createVoice(video, name, controller.signal);
      voice.setProfile(profile);
      if (profile.status === 'ready') voice.setPreferences({ voice: 'personal' });
      if (mounted.current) {
        setNotice(profile.status === 'ready' ? 'Your personal voice is ready. Try it below.'
          : 'Your voice was created and needs verification in the connected ElevenLabs account. After verification, tap Refresh voices.');
        setVideo(null); setConsent(false);
      }
    } catch (error) {
      if (mounted.current) setNotice(controller.signal.aborted
        ? 'The request timed out. Tap Refresh voices to check whether creation completed before uploading again.'
        : error instanceof Error ? error.message : 'Your personal voice could not be created. Try another recording.');
    } finally {
      clearTimeout(timer); request.current = null;
      removeCachedVideo(selectedVideo.current); selectedVideo.current = null;
      if (mounted.current) { setWorking(null); setVideo(null); setConsent(false); }
    }
  };
  const deleteVoice = useCallback(() => {
    Alert.alert('Delete your personal voice?', 'This removes the saved voice from TalkBridge and the connected voice provider. You can create it again from your original video.', [
      { text: 'Keep voice', style: 'cancel' },
      { text: 'Delete voice', style: 'destructive', onPress: () => {
        voice.stop(); setWorking('deleting'); setNotice('');
        void VoiceClient.deleteVoice().then(() => {
          voice.setProfile(null);
          if (mounted.current) setNotice('Your personal voice was deleted.');
        }).catch((error: unknown) => {
          if (mounted.current) setNotice(error instanceof Error ? error.message : 'Could not delete your voice. It is still saved; try again.');
        }).finally(() => { if (mounted.current) setWorking(null); });
      } },
    ]);
  }, [voice]);
  const choices: { id: VoiceChoice; title: string; detail: string; disabled?: boolean }[] = [
    { id: 'male', title: 'Male AI voice', detail: voice.defaults?.male ?? 'Default voice for testing · online', disabled: !online || !voice.defaults },
    { id: 'female', title: 'Female AI voice', detail: voice.defaults?.female ?? 'Default voice for testing · online', disabled: !online || !voice.defaults },
    { id: 'personal', title: voice.profile?.name || 'My personal voice', detail: voice.profile?.status === 'ready'
      ? 'Created from your recording · online' : voice.profile ? 'Verification needed' : 'Create it from a video below', disabled: !online || voice.profile?.status !== 'ready' },
    { id: 'device', title: 'Device voice', detail: 'Uses your phone’s installed text-to-speech voice' },
  ];
  return <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => { voice.stop(); router.back(); }} style={styles.back}>
          <Text style={styles.backText} aria-hidden>‹</Text>
        </Pressable>
        <View style={styles.flex}><Text style={styles.eyebrow}>TALKBRIDGE VOICE</Text><Text style={styles.title}>Your voice, out loud.</Text></View>
      </View>
      <Text style={styles.intro}>Sign, review your words, and let your voice say them. Choose a default voice or bring back your own from a recording.</Text>

      <View style={styles.card}>
        <View style={styles.row}><Text style={styles.cardTitle}>Choose your voice</Text>
          <Text style={styles.badge}>{online ? 'AI CONNECTED' : 'DEVICE SPEECH READY'}</Text></View>
        {choices.map((choice) => <Pressable key={choice.id} accessibilityRole="radio" accessibilityLabel={choice.title}
          accessibilityState={{ checked: voice.preferences.voice === choice.id, disabled: !!choice.disabled || locked }}
          disabled={!!choice.disabled || locked} onPress={() => select(choice.id)}
          style={[styles.choice, voice.preferences.voice === choice.id && styles.selected, choice.disabled && styles.disabled]}>
          <View style={[styles.radio, voice.preferences.voice === choice.id && styles.radioSelected]}><Text style={styles.check}>{voice.preferences.voice === choice.id ? '✓' : ''}</Text></View>
          <View style={styles.flex}><Text style={styles.choiceTitle}>{choice.title}</Text><Text style={styles.hint}>{choice.detail}</Text></View>
        </Pressable>)}
        <Text style={styles.hint}>Male and female are separate AI voices. Device voice uses the voice installed on this phone. AI voices require an internet connection.</Text>
        <View style={styles.switchRow}><View style={styles.flex}><Text style={styles.choiceTitle}>Speak accepted signs automatically</Text>
          <Text style={styles.hint}>Each accepted word or sentence is spoken once. Typed edits are spoken when you tap Speak.</Text></View>
          <Switch accessibilityLabel="Speak accepted signs automatically" value={voice.preferences.autoSpeak}
            onValueChange={(autoSpeak) => voice.setPreferences({ autoSpeak })} trackColor={{ false: colors.line, true: colors.accent }} />
        </View>
        <Text style={styles.label}>Speaking speed</Text>
        <View style={styles.actions}>{[0.8, 1, 1.2].map((rate) => <ActionButton key={rate}
          label={`Speaking speed ${rate}`} text={rate === 0.8 ? 'Slower' : rate === 1 ? 'Normal' : 'Faster'}
          variant={voice.preferences.rate === rate ? 'primary' : 'secondary'} onPress={() => voice.setPreferences({ rate })} />)}</View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Create your personal voice</Text>
        <Text style={styles.body}>Choose a video where you can hear the person speaking clearly, including an older recording from before speech was lost. Use one speaker, without music or overlapping voices.</Text>
        <Text style={styles.hint}>Best with 30–120 seconds of clear speech · at least 10 seconds of audible speech · up to 50 MB. Silent signing videos do not contain a voice to recreate.</Text>
        {voice.profile ? <View style={styles.profile}>
          <Text style={styles.choiceTitle}>{voice.profile.name}</Text>
          <Text accessibilityLiveRegion="polite" style={styles.body}>{voice.profile.status === 'ready' ? 'Ready to speak your accepted signs and any text you type.'
            : 'Verification is required in the connected ElevenLabs account. Refresh after completing it. TalkBridge cannot skip provider verification.'}</Text>
          <ActionButton label="Delete my personal voice" text={working === 'deleting' ? 'Deleting voice…' : 'Delete personal voice'} variant="quiet" disabled={locked} onPress={deleteVoice} />
        </View> : <>
          <Text style={styles.label}>Voice name</Text>
          <TextInput accessibilityLabel="Personal voice name" value={name} onChangeText={setName} editable={!locked} maxLength={60}
            placeholder="My voice" style={styles.input} returnKeyType="done" />
          <ActionButton label="Choose a speaking video" text={video ? 'Choose a different video' : 'Choose video'} icon="＋" disabled={locked || !online} onPress={pickVideo} />
          {video ? <View style={styles.profile}><Text style={styles.choiceTitle} numberOfLines={2}>{video.name}</Text>
            <Text style={styles.hint}>{video.size ? `${(video.size / 1024 / 1024).toFixed(1)} MB · ` : ''}Selected on this phone; upload starts when you tap Create my voice.</Text></View> : null}
          <View style={styles.switchRow}><View style={styles.flex}>
            <Text style={styles.choiceTitle}>I have permission to use this voice</Text>
            <Text style={styles.hint}>This is my voice, or the speaker has authorized me to create and use it for communication.</Text></View>
            <Switch accessibilityLabel="I have permission to use this voice" value={consent} disabled={locked || !video}
              onValueChange={setConsent} trackColor={{ false: colors.line, true: colors.accent }} />
          </View>
          <ActionButton label="Create my voice from the selected video" text={working === 'creating' ? 'Creating your voice…' : 'Create my voice'}
            variant="dark" disabled={locked || !online || !video || !consent || !name.trim()} onPress={createVoice} />
        </>}
        <Text style={styles.hint}>Your selected video is uploaded to TalkBridge’s voice service. Only its extracted audio goes to ElevenLabs to create your voice. Temporary video and audio files are removed after processing; the voice and its training sample stay with the provider until deleted.</Text>
        {working === 'creating' || working === 'deleting' ? <View accessibilityLiveRegion="polite" style={styles.progress}>
          <ActivityIndicator color={colors.teal} /><Text style={styles.body}>{working === 'creating'
            ? 'Uploading and creating your voice. This may take a few minutes. Keep this screen open.' : 'Removing your personal voice…'}</Text>
        </View> : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Try your voice</Text>
        <Text style={styles.hint}>Test speech without the camera. The same voice speaks your accepted signs in the translator.</Text>
        <TextInput accessibilityLabel="Text to test your voice" multiline maxLength={1200} value={testText} onChangeText={setTestText}
          style={[styles.input, styles.testInput]} textAlignVertical="top" />
        <Text style={styles.label}>{VOICE_LABELS[voice.preferences.voice]}{voice.preferences.voice === 'personal' && voice.profile ? ` · ${voice.profile.name}` : ''}</Text>
        <View style={styles.actions}>
          <ActionButton label="Preview selected voice" text={voice.speech.phase === 'preparing' ? 'Preparing voice…' : 'Play voice'} icon="▶" variant="dark"
            disabled={!testText.trim() || busy || !!working || (voice.preferences.voice !== 'device' && !online)}
            onPress={() => { Keyboard.dismiss(); voice.speak(testText); }} />
          {busy ? <ActionButton label="Stop voice preview" text="Stop" icon="■" onPress={voice.stop} /> : null}
        </View>
        <Text style={styles.hint}>{voice.preferences.voice === 'device' ? 'Uses your phone’s speech engine. No text is sent to the TalkBridge voice service.'
          : 'Tapping Play voice sends this text to the online voice service and ElevenLabs to generate speech.'}</Text>
        {voice.speech.message || busy ? <Text accessibilityLiveRegion="polite" style={styles.body}>
          {voice.speech.message || (voice.speech.phase === 'preparing' ? 'Preparing speech…' : 'Speaking…')}</Text> : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Service connection</Text>
        <Text style={styles.body}>{voice.connectionError || voice.service?.message || 'Checking the online voice service. Device voice is available while offline.'}</Text>
        {voice.service?.requiresAccessKey ? <>
          <Text style={styles.hint}>Enter the access key supplied by your TalkBridge service administrator. It is stored securely on this phone.</Text>
          <TextInput accessibilityLabel="Voice service access key" placeholder="Service access key" secureTextEntry autoCapitalize="none"
            autoCorrect={false} value={accessKey} onChangeText={setAccessKey} style={styles.input} />
          <ActionButton label="Save voice service access key" text="Save access key" disabled={locked} onPress={async () => {
            setWorking('connecting'); setNotice('');
            try { await VoiceClient.setAccessKey(accessKey); setAccessKey(''); await voice.refresh(); }
            catch { setNotice('The access key could not be saved. Try again.'); }
            finally { if (mounted.current) setWorking(null); }
          }} />
        </> : null}
        <ActionButton label="Refresh voices" text={voice.refreshing ? 'Checking voices…' : 'Refresh voices'} disabled={locked} onPress={voice.refresh} />
        {voice.refreshing ? <ActivityIndicator accessibilityLabel="Checking voice service" color={colors.teal} /> : null}
      </View>
      {notice ? <View accessibilityLiveRegion="polite" style={styles.notice}><Text style={styles.body}>{notice}</Text></View> : null}
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: 22, paddingBottom: 42, gap: 18, width: '100%', maxWidth: 620, alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14 }, flex: { flex: 1, gap: 4 },
  back: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line },
  backText: { fontSize: 32, color: colors.navy, lineHeight: 36 },
  eyebrow: { color: colors.teal, fontSize: 10, letterSpacing: 1.4, fontWeight: '800' },
  title: { color: colors.navy, fontSize: 26, fontWeight: '800', letterSpacing: -0.6 },
  intro: { color: colors.inkSoft, fontSize: 16, lineHeight: 24 },
  card: { backgroundColor: colors.white, borderRadius: 22, borderWidth: 1, borderColor: colors.line, padding: 18, gap: 14 },
  cardTitle: { color: colors.navy, fontSize: 18, fontWeight: '800', flexShrink: 1 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 9 },
  badge: { color: colors.tealDeep, fontSize: 9, letterSpacing: 0.7, fontWeight: '800', backgroundColor: colors.mintSoft, padding: 8, borderRadius: 9 },
  choice: { flexDirection: 'row', gap: 12, alignItems: 'center', minHeight: 72, padding: 13, borderWidth: 1, borderColor: colors.line, borderRadius: 16 },
  selected: { borderColor: colors.teal, borderWidth: 2, padding: 12, backgroundColor: colors.mintSoft },
  radio: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  radioSelected: { backgroundColor: colors.teal, borderColor: colors.teal }, check: { color: colors.white, fontSize: 17, fontWeight: '800' },
  choiceTitle: { color: colors.navy, fontSize: 14, fontWeight: '700' }, body: { color: colors.inkSoft, fontSize: 14, lineHeight: 21 },
  hint: { color: colors.inkSoft, fontSize: 12, lineHeight: 18 }, label: { color: colors.navy, fontSize: 13, fontWeight: '700' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 6 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 }, disabled: { opacity: 0.48 },
  input: { minHeight: 50, borderWidth: 1, borderColor: colors.line, borderRadius: 14, padding: 13, color: colors.navy, fontSize: 16, backgroundColor: colors.field },
  testInput: { minHeight: 110 }, profile: { borderRadius: 14, padding: 13, backgroundColor: colors.mintSoft, gap: 10 },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  notice: { padding: 16, borderRadius: 16, backgroundColor: colors.mintSoft, borderWidth: 1, borderColor: colors.teal },
});
