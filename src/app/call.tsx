import { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { useKeepAwake } from 'expo-keep-awake';
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useVideoCall } from '@/calls/use-video-call';
import { CAPTION_LIMIT, createInvite, displayInvite } from '@/calls/protocol';
import { CallVideoTile } from '@/components/call-video-tile';
import { CallCaptionComposer, type CallCaptionFeedback } from '@/components/call-caption-composer';
import { colors } from '@/constants/palette';
import { CallIconButton } from '@/components/call-icon-button';
import { StatusBar } from 'expo-status-bar';
import { useMeetingVoice } from '@/calls/use-meeting-voice';
import { MeetingVoiceControls } from '@/components/meeting-voice-controls';
import { InformationBar } from '@/components/information-bar';

function KeepCallAwake() { useKeepAwake('signbridge-call', { suppressDeactivateWarnings: true }); return null; }

function CallButton({ title, subtitle, onPress, disabled, danger, dark }: {
  title: string; subtitle?: string; onPress: () => void; disabled?: boolean; danger?: boolean; dark?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled: !!disabled }} disabled={disabled}
    onPress={onPress} style={({ pressed }) => [styles.button, dark && styles.darkButton, danger && styles.dangerButton, disabled && styles.disabled, pressed && styles.pressed]}>
    <Text style={[styles.buttonTitle, (dark || danger) && styles.white]}>{title}</Text>
    {subtitle ? <Text style={[styles.buttonSubtitle, dark && styles.softWhite]}>{subtitle}</Text> : null}
  </Pressable>;
}

export default function CallScreen() {
  const params = useLocalSearchParams<{ code?: string | string[]; service?: string | string[] }>();
  const call = useVideoCall();
  const meetingVoice = useMeetingVoice(call);
  const [name, setName] = useState('');
  const [microphone, setMicrophone] = useState(false);
  const [captions, setCaptions] = useState(true);
  const [typed, setTyped] = useState('');
  const [notice, setNotice] = useState('');
  const [captionFeedback, setCaptionFeedback] = useState<CallCaptionFeedback | null>(null);
  const [videoLayout, setVideoLayout] = useState<'both' | 'guest' | 'me'>('both');
  const [focusMode, setFocusMode] = useState(false);
  const [clock, setClock] = useState(Date.now);
  const inviteCode = typeof params.code === 'string' ? params.code : '';
  const inviteServiceUrl = typeof params.service === 'string' ? params.service : undefined;
  const { width, fontScale } = useWindowDimensions();
  const wide = width >= 760 && fontScale < 1.5;
  const inCall = ['starting', 'waiting', 'connecting', 'connected', 'reconnecting'].includes(call.phase);
  const connected = call.phase === 'connected';
  const waitingRoom = inCall && !connected && !call.startedAt;
  const focusedCall = inCall && !waitingRoom && focusMode;
  const canSend = connected && call.channelReady;
  const elapsed = call.startedAt ? Math.max(0, Math.floor((clock - call.startedAt) / 1000)) : 0;
  useEffect(() => {
    if (!call.startedAt || !inCall) return;
    const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer);
  }, [call.startedAt, inCall]);
  const start = (action: 'create' | 'join') => {
    Keyboard.dismiss(); setNotice(''); setTyped(''); setClock(Date.now());
    call.start({ action, name, ...(action === 'join' ? { code: inviteCode, serviceUrl: inviteServiceUrl } : {}), microphone, captions });
  };
  const copyInvite = async () => {
    try { await Clipboard.setStringAsync(createInvite(call.code, call.inviteServiceUrl || call.serviceUrl)); setNotice('Invite copied. Paste the complete invite on the other phone, then return here.'); }
    catch { setNotice('Could not copy. You can select the code below.'); }
  };
  const textComposer = <View style={styles.card}>
    <View style={styles.row}><Text style={styles.cardTitle}>Say it with text</Text><Text style={styles.characterCount}>{typed.length}/{CAPTION_LIMIT}</Text></View>
    <TextInput accessibilityLabel="Type a caption" value={typed} onChangeText={setTyped} placeholder="Type what you want your guest to hear…"
      placeholderTextColor={colors.inkSoft} maxLength={CAPTION_LIMIT} multiline style={[styles.input, styles.messageInput]} />
    {!typed.trim() ? <Text style={styles.body}>Type a message to enable Speak to meeting or Send caption.</Text> : null}
    <View style={styles.controls}>
      <CallButton title="Speak to meeting" dark disabled={!meetingVoice.canSpeak || !typed.trim()} onPress={() => {
        if (!call.sendCaption(typed, 'typed')) { setNotice('Message could not be sent. Wait for the connection, then try again.'); return; }
        if (meetingVoice.speak(typed)) { setTyped(''); setNotice(''); Keyboard.dismiss(); }
      }} />
      <CallButton title="Send caption" disabled={!canSend || !typed.trim()} onPress={() => {
        if (call.sendCaption(typed, 'typed')) { setTyped(''); setNotice(''); Keyboard.dismiss(); }
        else setNotice('Caption could not be sent. Wait for the connection, then try again.');
      }} />
      {call.localCaption?.text ? <CallButton title="Clear my caption" disabled={!canSend} onPress={() => call.sendCaption('', 'typed')} /> : null}
    </View>
  </View>;
  return <SafeAreaView style={[styles.screen, focusedCall && styles.focusScreen]} edges={['top', 'bottom']}>
    <StatusBar style={focusedCall ? 'light' : 'dark'} />
    {inCall ? <KeepCallAwake /> : null}
    {!inCall || waitingRoom ? <InformationBar page="call" brandOnly={waitingRoom} /> : null}
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.flex} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={!focusedCall}
        contentContainerStyle={[styles.content, wide && styles.wideContent, focusedCall && styles.focusContent,
          focusedCall && fontScale >= 1.5 && styles.focusScrollable]}>
        {focusedCall ? <View pointerEvents="box-none" style={styles.focusHeader}>
          <CallIconButton label="Exit focus view" icon={{ ios: 'arrow.down.right.and.arrow.up.left', android: 'fullscreen_exit', web: 'fullscreen_exit' }} onPress={() => setFocusMode(false)} />
          {call.phase === 'waiting' ? <Pressable accessibilityRole="button" accessibilityLabel="Copy private call invite" onPress={() => void copyInvite()} style={styles.focusInvite}>
            <Text selectable style={styles.focusInviteText}>{displayInvite(call.code)}</Text>
          </Pressable> : null}
          <CallIconButton label={videoLayout === 'both' ? 'Enlarge guest video' : videoLayout === 'guest' ? 'Enlarge my video' : 'Show both videos'}
            icon={{ ios: 'rectangle.2.swap', android: 'view_agenda', web: 'view_agenda' }}
            onPress={() => setVideoLayout(videoLayout === 'both' ? 'guest' : videoLayout === 'guest' ? 'me' : 'both')} />
        </View> : inCall ? <View style={styles.topBar}>
          <Pressable accessibilityRole="button" accessibilityLabel={inCall ? 'Leave call and go home' : 'Back to home'}
            onPress={() => { call.end(); if (router.canGoBack()) router.back(); else router.replace('/'); }} style={styles.back}>
            <Text style={styles.backText}>‹</Text>
          </Pressable>
          <View style={styles.flex}><Text style={styles.brand}>SIGNBRIDGE</Text><Text style={styles.topTitle}>Conversations</Text></View>
          <View style={styles.statusPill}><View style={[styles.statusDot, connected && styles.liveDot]} />
            <Text style={styles.statusText}>{connected ? `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}` : inCall ? 'Connecting' : 'ONE TO ONE'}</Text></View>
        </View> : null}

        {!inCall ? <>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Before you join</Text>
            <Text style={styles.label}>Your name</Text>
            <TextInput accessibilityLabel="Your display name" value={name} onChangeText={setName} placeholder="What should they call you?" placeholderTextColor={colors.inkSoft}
              autoCapitalize="words" maxLength={40} style={styles.input} />
            <View style={styles.preference}><View style={styles.flex}><Text style={styles.preferenceTitle}>AI sign captions</Text>
              <Text style={styles.body}>Recognize your signing on this phone. Recognized words appear automatically on both screens as AI captions.</Text></View>
              <Switch accessibilityLabel="Enable AI sign captions for my call" value={captions} onValueChange={setCaptions} trackColor={{ false: colors.line, true: colors.teal }} /></View>
            <View style={styles.separator} />
            <View style={styles.preference}><View style={styles.flex}><Text style={styles.preferenceTitle}>Start with microphone on</Text>
              <Text style={styles.body}>Optional. Signing and typed captions work with your microphone off.</Text></View>
              <Switch accessibilityLabel="Start with microphone on" value={microphone} onValueChange={setMicrophone} trackColor={{ false: colors.line, true: colors.teal }} /></View>
            <View style={styles.separator} />
            <View style={styles.preference}><View style={styles.flex}><Text style={styles.preferenceTitle}>Focus call view</Text>
              <Text style={styles.body}>Keep just the video, captions, and small call controls on screen.</Text></View>
              <Switch accessibilityLabel="Start in focus call view" value={focusMode} onValueChange={setFocusMode} trackColor={{ false: colors.line, true: colors.teal }} /></View>
          </View>
          <View style={styles.startActions}>
            {inviteCode ? <CallButton title="Join this meeting" subtitle={`Invitation ${displayInvite(inviteCode)}`} dark
              disabled={!name.trim()} onPress={() => start('join')} />
              : <CallButton title="Create a new call" subtitle="Create a private invitation" dark disabled={!name.trim()} onPress={() => start('create')} />}
          </View>
          {call.message ? <View style={styles.notice} accessibilityRole={call.phase === 'error' ? 'alert' : undefined}>
            <Text style={styles.noticeTitle}>{call.phase === 'error' ? 'We couldn’t start this call' : 'Your call has ended'}</Text>
            <Text style={styles.body}>{call.message}</Text></View> : null}
          <Text style={styles.footnote}>Calls share your live video and any enabled audio with your guest. AI sign captions are shared automatically when enabled. AI recognition is experimental and can miss or change meaning.</Text>
        </> : waitingRoom ? <>
          {call.code ? <View style={styles.inviteCard}>
            <Text style={styles.eyebrow}>PRIVATE CALL CODE</Text>
            <Text selectable style={styles.invite}>{displayInvite(call.code)}</Text>
            <CallButton title="Copy invite" onPress={() => void copyInvite()} />
          </View> : null}
          <CallButton title="Cancel call" onPress={call.end} />
          <Text style={styles.cardTitle}>My Video</Text>
          <CallVideoTile name={name || 'You'} local streamURL={call.localStream?.toURL()} mirrored={call.frontCamera}
            camera={call.camera} microphone={call.microphone} caption={null} compact height={320} />
          <View style={styles.joinStatus} accessibilityLiveRegion="polite">
            <Text style={styles.callTitle}>Join the Call</Text>
            <Text style={styles.body}>{call.peerName ? `${call.peerName} has joined. Connecting your call…`
              : call.phase === 'starting' ? 'Preparing your camera…' : 'The other person has not joined yet.'}</Text>
          </View>
        </> : <>
          {!focusedCall ? <View accessibilityLiveRegion="polite" style={styles.callHeading}><Text style={styles.callTitle}>{connected ? `You + ${call.peerName}` : 'Bringing you together…'}</Text>
            <Text style={styles.body}>{call.message}</Text></View>
            : null}
          {!focusedCall ? <View style={styles.videoSelector} accessibilityRole="tablist">
            {(['both', 'guest', 'me'] as const).map((layout) => <Pressable key={layout} accessibilityRole="tab"
              accessibilityLabel={layout === 'both' ? 'Show both videos' : layout === 'guest' ? 'Enlarge guest video' : 'Enlarge my video'}
              accessibilityState={{ selected: videoLayout === layout }} onPress={() => setVideoLayout(layout)}
              style={[styles.videoTab, videoLayout === layout && styles.videoTabSelected]}>
              <Text style={[styles.videoTabText, videoLayout === layout && styles.white]}>{layout === 'both' ? 'Both' : layout === 'guest' ? 'Their video' : 'My video'}</Text>
            </Pressable>)}
          </View> : null}
          <View style={[styles.tiles, videoLayout === 'both' && fontScale < 1.5 && (!focusedCall || wide) && styles.tilesWide,
            focusedCall && styles.focusTiles, focusedCall && fontScale >= 1.5 && styles.focusTilesScrollable]}>
            {videoLayout !== 'me' ? <View style={styles.flex}><CallVideoTile name={call.peerName || 'Your guest'} streamURL={call.remoteStream?.toURL()} camera={call.peerMedia.camera}
              microphone={call.peerMedia.microphone} caption={call.remoteCaption} waiting={!call.remoteStream}
              fill={focusedCall} compact={focusedCall} height={wide || videoLayout !== 'both' ? 320 : 220} /></View> : null}
            {videoLayout !== 'guest' ? <View style={styles.flex}><CallVideoTile name={name || 'You'} local streamURL={call.localStream?.toURL()} mirrored={call.frontCamera}
              camera={call.camera} microphone={call.microphone} caption={call.localCaption}
              feedback={call.captions ? captionFeedback : null} fill={focusedCall} compact={focusedCall} height={wide || videoLayout !== 'both' ? 320 : 220} /></View> : null}
          </View>
          {!focusedCall ? <View style={styles.controls}>
            <CallButton title={call.microphone ? 'Mute mic' : 'Turn on mic'} disabled={!call.localStream} onPress={call.toggleMicrophone} />
            <CallButton title={call.camera ? 'Camera off' : 'Camera on'} disabled={!call.localStream} onPress={call.toggleCamera} />
            <CallButton title="Flip camera" disabled={!call.localStream || !call.camera} onPress={call.switchCamera} />
            <CallButton title="End call" danger onPress={call.end} />
            <CallButton title="Focus call" onPress={() => { Keyboard.dismiss(); setFocusMode(true); }} />
          </View> : null}
          {!focusedCall ? <View style={styles.preferenceCard}><View style={styles.flex}><Text style={styles.preferenceTitle}>AI sign captions</Text>
            <Text style={styles.body}>{call.captions ? 'Your gestures can become captions under your video.' : 'You can sign freely or send a typed caption.'}</Text></View>
            <Switch accessibilityLabel="AI sign captions during call" value={call.captions} onValueChange={call.setCaptions} trackColor={{ false: colors.line, true: colors.teal }} /></View> : null}
          {call.captions && call.localStream ? <CallCaptionComposer stream={call.localStream} active={call.camera} canSend={canSend}
            frontCamera={call.frontCamera} onCaption={call.sendCaption} onReviewedSpeech={meetingVoice.speakReviewed} onFeedback={setCaptionFeedback} compact={focusedCall} /> : null}
          <MeetingVoiceControls voice={meetingVoice} compact={focusedCall} composer={textComposer} />
          {!focusedCall ? <Text style={styles.footnote}>Keep TalkBridge open during your call. Caption processing happens on your phone; shared captions travel with the call. Calls and captions are not saved by TalkBridge.</Text> : null}
        </>}
          {notice && !focusedCall ? <Text accessibilityLiveRegion="polite" style={styles.noticeText}>{notice}</Text> : null}
      </ScrollView>
      {focusedCall ? <View style={styles.focusControls}>
            <CallIconButton label={call.microphone ? 'Mute mic' : 'Turn on mic'} active={call.microphone} disabled={!call.localStream}
              icon={{ ios: call.microphone ? 'mic.fill' : 'mic.slash.fill', android: call.microphone ? 'mic' : 'mic_off', web: call.microphone ? 'mic' : 'mic_off' }} onPress={call.toggleMicrophone} />
            <CallIconButton label={call.camera ? 'Camera off' : 'Camera on'} active={call.camera} disabled={!call.localStream}
              icon={{ ios: call.camera ? 'video.fill' : 'video.slash.fill', android: call.camera ? 'videocam' : 'videocam_off', web: call.camera ? 'videocam' : 'videocam_off' }} onPress={call.toggleCamera} />
            <CallIconButton label="Flip camera" disabled={!call.localStream || !call.camera}
              icon={{ ios: 'camera.rotate.fill', android: 'flip_camera_ios', web: 'flip_camera_ios' }} onPress={call.switchCamera} />
            <CallIconButton label={call.captions ? 'Turn off AI sign captions' : 'Turn on AI sign captions'} active={call.captions}
              hint="Recognize your ASL signing and show caption options" icon={{ ios: 'hands.sparkles.fill', android: 'sign_language', web: 'sign_language' }} onPress={() => call.setCaptions(!call.captions)} />
            <CallIconButton label="End call" danger icon={{ ios: 'phone.down.fill', android: 'call_end', web: 'call_end' }} onPress={call.end} />
          </View> : null}
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  joinStatus: { alignItems: 'center', gap: 8, paddingVertical: 12 },
  focusScreen: { backgroundColor: '#0D2029' }, focusContent: { flexGrow: 1, maxWidth: '100%', padding: 6, paddingBottom: 0, gap: 6 },
  focusScrollable: { flex: undefined, flexGrow: 1 },
  focusHeader: { position: 'absolute', top: 12, left: 12, right: 12, zIndex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  focusInvite: { minHeight: 44, flexShrink: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#203743', borderRadius: 14, paddingHorizontal: 10 },
  focusInviteText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700', letterSpacing: 0.5 },
  focusTiles: { flex: 1, minHeight: 400, gap: 6 }, focusTilesScrollable: { minHeight: 620 },
  focusControls: { flexDirection: 'row', justifyContent: 'space-evenly', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 12 },
  screen: { flex: 1, backgroundColor: '#ECF4F7' }, flex: { flex: 1 }, content: { padding: 20, gap: 18, width: '100%', maxWidth: 620, alignSelf: 'center', paddingBottom: 36 },
  wideContent: { maxWidth: 1120, paddingHorizontal: 32 }, topBar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  back: { width: 48, height: 48, borderRadius: 16, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#D3E1E7' },
  backText: { color: colors.navy, fontSize: 32, lineHeight: 36 }, brand: { fontSize: 9, fontWeight: '800', letterSpacing: 2, color: colors.teal },
  topTitle: { fontSize: 18, fontWeight: '700', color: colors.navy, marginTop: 3 }, statusPill: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 9, backgroundColor: '#DEEAF0', borderRadius: 20 },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#839CA8' }, liveDot: { backgroundColor: '#267D5B' }, statusText: { color: colors.tealDeep, fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  intro: { paddingVertical: 15, gap: 14 }, eyebrow: { color: colors.teal, fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  hero: { color: colors.navy, fontSize: 38, lineHeight: 43, fontWeight: '800', letterSpacing: -1.4 }, description: { color: colors.inkSoft, fontSize: 16, lineHeight: 25, maxWidth: 480 },
  card: { padding: 20, borderRadius: 24, backgroundColor: '#FFFFFF', gap: 14, borderWidth: 1, borderColor: '#D3E1E7' }, cardTitle: { color: colors.navy, fontSize: 18, fontWeight: '700' },
  label: { color: colors.inkSoft, fontSize: 13, fontWeight: '600' }, input: { minHeight: 54, borderRadius: 14, borderWidth: 1, borderColor: '#AFC4CD', backgroundColor: '#F5F9FA', padding: 14, fontSize: 16, color: colors.navy },
  preference: { flexDirection: 'row', alignItems: 'center', gap: 16 }, preferenceTitle: { color: colors.navy, fontSize: 15, fontWeight: '700', marginBottom: 5 },
  body: { color: colors.inkSoft, fontSize: 13, lineHeight: 20 }, separator: { height: 1, backgroundColor: '#E3ECF0' }, startActions: { gap: 12 },
  button: { flexGrow: 1, minHeight: 50, justifyContent: 'center', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 14, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#BDD1DA', borderRadius: 16, gap: 4 },
  darkButton: { backgroundColor: colors.navy, borderColor: colors.navy }, dangerButton: { backgroundColor: '#A8414D', borderColor: '#A8414D' },
  buttonTitle: { fontSize: 14, fontWeight: '700', color: colors.navy }, buttonSubtitle: { fontSize: 12, color: colors.inkSoft }, white: { color: '#FFFFFF' }, softWhite: { color: '#B8D2DD' },
  disabled: { opacity: 0.4 }, pressed: { opacity: 0.75 }, codeInput: { fontWeight: '700', letterSpacing: 2 }, footnote: { fontSize: 12, lineHeight: 19, color: colors.inkSoft, paddingHorizontal: 4 },
  notice: { padding: 16, backgroundColor: '#FBEDE9', borderRadius: 18, gap: 6 }, noticeTitle: { color: '#8B3D3A', fontWeight: '700', fontSize: 15 }, noticeText: { color: colors.tealDeep, fontSize: 14, lineHeight: 20 },
  callHeading: { gap: 5 }, callTitle: { color: colors.navy, fontSize: 26, fontWeight: '700', letterSpacing: -0.6 }, inviteCard: { backgroundColor: '#D9EAF1', borderRadius: 20, padding: 18, gap: 14 },
  invite: { fontSize: 25, fontWeight: '800', letterSpacing: 1.5, color: colors.navy, marginVertical: 8 }, tiles: { gap: 14 }, tilesWide: { flexDirection: 'row' },
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, preferenceCard: { flexDirection: 'row', alignItems: 'center', gap: 16, backgroundColor: '#DFEBF0', borderRadius: 20, padding: 18 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, characterCount: { fontSize: 11, color: colors.inkSoft }, messageInput: { minHeight: 80, textAlignVertical: 'top' },
  videoSelector: { flexDirection: 'row', backgroundColor: '#DFEBF0', borderRadius: 14, padding: 4, gap: 4 },
  videoTab: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 11 },
  videoTabSelected: { backgroundColor: colors.navy }, videoTabText: { color: colors.tealDeep, fontSize: 13, fontWeight: '600' },
});
