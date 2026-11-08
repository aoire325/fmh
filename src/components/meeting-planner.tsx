import { File, Paths } from 'expo-file-system';
import { router } from 'expo-router';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { dayKey, meetingTime, parseMeetings, weekDays, type ScheduledMeeting } from '@/calls/meeting-schedule';
import { parseInvite } from '@/calls/protocol';
import { colors } from '@/constants/palette';

const calendarFile = () => new File(Paths.document, 'talkbridge-meetings-v1.json');
const dateLabel = (date: Date) => date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });

function Button({ label, onPress, dark = false, disabled = false }: { label: string; onPress: () => void; dark?: boolean; disabled?: boolean }) {
  const [focused, setFocused] = useState(false);
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} accessibilityState={{ disabled }} onPress={onPress}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={({ pressed }) => [styles.button, dark && styles.darkButton, disabled && styles.disabled, pressed && styles.pressed, focused && styles.focused]}>
    <Text style={[styles.buttonText, dark && styles.white]}>{label}</Text>
  </Pressable>;
}

export function MeetingPlanner({ onInstantMeeting, onCodeFocus, onCodeBlur }: {
  onInstantMeeting: () => void;
  onCodeFocus?: (target: ComponentRef<typeof View>) => void;
  onCodeBlur?: () => void;
}) {
  const codeAreaRef = useRef<ComponentRef<typeof View>>(null);
  const [selected, setSelected] = useState(() => new Date());
  const [meetings, setMeetings] = useState<ScheduledMeeting[]>([]);
  const [ready, setReady] = useState(false);
  const [retry, setRetry] = useState(0);
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [time, setTime] = useState('09:00');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [storageError, setStorageError] = useState('');
  const [notice, setNotice] = useState('');
  const [focusedDay, setFocusedDay] = useState('');
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const file = calendarFile();
        const saved = file.exists ? parseMeetings(await file.text()) : [];
        if (active) { setMeetings(saved); setReady(true); }
      } catch { if (active) setStorageError('Could not load your saved calendar. Please retry.'); }
    })();
    return () => { active = false; };
  }, [retry]);
  const persist = (next: ScheduledMeeting[]) => {
    try {
      const file = calendarFile();
      if (!file.exists) file.create();
      file.writeSync(JSON.stringify(next));
      setMeetings(next); return true;
    } catch { setError('Could not save your calendar. Please try again.'); return false; }
  };
  const save = () => {
    setError(''); setNotice('');
    try {
      const startsAt = meetingTime(selected, time.trim()).toISOString();
      if (!title.trim()) throw new Error('Enter a meeting title.');
      if (meetings.length >= 1000) throw new Error('Your calendar is full. Remove older meetings first.');
      const meeting = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, title: title.trim(), startsAt };
      if (persist([...meetings, meeting].sort((a, b) => a.startsAt.localeCompare(b.startsAt)))) {
        setEditing(false); setTitle(''); setNotice('Meeting saved on this device.');
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not schedule this meeting.'); }
  };
  const join = () => {
    const invite = parseInvite(code);
    if (!invite) { setError('Enter a valid 12-character code or paste the complete invitation.'); return; }
    setError('');
    router.push({ pathname: '/call', params: { code: invite.code, ...(invite.serviceUrl ? { service: invite.serviceUrl } : {}) } });
  };
  const days = weekDays(selected);
  const agenda = meetings.filter((meeting) => dayKey(new Date(meeting.startsAt)) === dayKey(selected));
  const moveWeek = (offset: number) => {
    const next = new Date(selected); next.setDate(next.getDate() + offset * 7); setSelected(next); setNotice('');
  };
  return <View style={styles.planner}>
    <View style={styles.calendar}>
      <View style={styles.row}>
        <Button label="Previous week" onPress={() => moveWeek(-1)} />
        <Button label="Next week" onPress={() => moveWeek(1)} />
      </View>
      <Text style={styles.body}>{days[0].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – {days[6].toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.days}>
        {days.map((date) => {
          const active = dayKey(date) === dayKey(selected);
          const count = meetings.filter((meeting) => dayKey(new Date(meeting.startsAt)) === dayKey(date)).length;
          return <Pressable key={dayKey(date)} accessibilityRole="button" accessibilityLabel={`${dateLabel(date)}, ${count} meetings`}
            accessibilityState={{ selected: active }} onPress={() => { setSelected(date); setNotice(''); }}
            onFocus={() => setFocusedDay(dayKey(date))} onBlur={() => setFocusedDay('')}
            style={({ pressed }) => [styles.day, active && styles.darkButton, pressed && styles.pressed, focusedDay === dayKey(date) && styles.focused]}>
            <Text style={[styles.body, active && styles.white]}>{date.toLocaleDateString(undefined, { weekday: 'short' })}</Text>
            <Text style={[styles.dayNumber, active && styles.white]}>{date.getDate()}</Text>
            <View style={styles.dateSpacer} />
          </Pressable>;
        })}
      </ScrollView>
      <Text accessibilityRole="header" style={styles.dayTitle}>{dateLabel(selected)}</Text>
      {!ready && !storageError ? <Text style={styles.body}>Loading calendar…</Text> : null}
      {storageError ? <><Text accessibilityRole="alert" style={styles.error}>{storageError}</Text><Button label="Retry loading calendar" onPress={() => { setReady(false); setStorageError(''); setRetry((value) => value + 1); }} /></> : null}
      {ready && !agenda.length ? <View style={styles.empty}>
        <Text style={styles.dayTitle}>{dayKey(selected) === dayKey(new Date()) ? 'No calls planned for today' : 'No calls planned on this day.'}</Text>
        <Text style={styles.hint}>Pick a day, then press New to schedule a meeting.</Text>
      </View> : null}
      {agenda.map((meeting) => <View key={meeting.id} style={styles.meeting}>
        <Text style={styles.dayTitle}>{meeting.title}</Text>
        <Text style={styles.body}>{new Date(meeting.startsAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</Text>
        <View style={styles.row}><Button label={`Start ${meeting.title}`} dark onPress={onInstantMeeting} />
          <Button label={`Remove ${meeting.title}`} onPress={() => { setError(''); persist(meetings.filter((item) => item.id !== meeting.id)); }} /></View>
      </View>)}
    </View>
    <View ref={codeAreaRef} collapsable={false} style={styles.joinRow}>
      <View style={styles.joinBox}>
        <TextInput accessibilityLabel="Meeting code" placeholder="Enter code or paste invite" placeholderTextColor={colors.inkSoft} value={code} onChangeText={setCode}
          autoCapitalize="none" autoCorrect={false} maxLength={2048} returnKeyType="go" onSubmitEditing={join}
          onFocus={() => { if (codeAreaRef.current) onCodeFocus?.(codeAreaRef.current); }} onBlur={onCodeBlur} style={styles.input} />
        <Button label="Join" dark onPress={join} disabled={!code.trim()} />
      </View>
      <Button label="New" dark onPress={() => { setMenu(!menu); setError(''); setNotice(''); }} />
    </View>
    {menu ? <View style={styles.menu}>
      <Button label="Instant Meeting" onPress={() => { setMenu(false); onInstantMeeting(); }} />
      <Button label="Create a Meeting for Later" onPress={() => { setMenu(false); setEditing(true); setError(''); }} />
    </View> : null}
    {editing ? <View style={styles.calendar}>
      <Text accessibilityRole="header" style={styles.title}>Create a Meeting for Later</Text>
      <Text style={styles.body}>{dateLabel(selected)} · Select another day in the calendar to change the date.</Text>
      <TextInput accessibilityLabel="Meeting title" placeholder="Meeting title" placeholderTextColor={colors.inkSoft} value={title} onChangeText={setTitle} maxLength={80} style={styles.input} />
      <Text style={styles.body}>Local time (24-hour format)</Text>
      <TextInput accessibilityLabel="Meeting time" placeholder="HH:MM" placeholderTextColor={colors.inkSoft} value={time} onChangeText={setTime} maxLength={5} keyboardType="numbers-and-punctuation" style={styles.input} />
      <View style={styles.row}><Button label="Save meeting" dark disabled={!ready} onPress={save} /><Button label="Cancel scheduling" onPress={() => { setEditing(false); setError(''); }} /></View>
    </View> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.body}>{notice}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  planner: { width: '100%', gap: 14 }, calendar: { backgroundColor: '#FFFFFF', borderRadius: 24, padding: 18, gap: 14, borderWidth: 1, borderColor: colors.line },
  empty: { gap: 6 }, hint: { fontSize: 12, lineHeight: 18, color: colors.inkSoft },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { fontSize: 22, fontWeight: '800', color: colors.navy }, body: { fontSize: 14, lineHeight: 21, color: colors.inkSoft },
  days: { flexGrow: 1, justifyContent: 'space-between', gap: 6 },
  day: { minWidth: 50, minHeight: 92, borderRadius: 16, padding: 8, alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: colors.mintSoft },
  dayNumber: { color: colors.navy, fontSize: 22, fontWeight: '700' }, dayTitle: { color: colors.navy, fontSize: 16, fontWeight: '700' }, dateSpacer: { height: 21 },
  meeting: { borderTopWidth: 1, borderColor: colors.line, paddingTop: 12, gap: 8 },
  button: { minWidth: 48, minHeight: 48, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, backgroundColor: colors.mintSoft, justifyContent: 'center', alignItems: 'center', flexShrink: 1 },
  darkButton: { backgroundColor: colors.teal }, buttonText: { color: colors.navy, fontSize: 14, fontWeight: '700', textAlign: 'center' }, white: { color: '#FFFFFF' },
  pressed: { opacity: 0.75 }, disabled: { opacity: 0.45 }, focused: { outlineWidth: 2, outlineColor: colors.tealDeep, outlineOffset: 2 },
  joinRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 }, joinBox: { flex: 1, minWidth: 220, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  input: { flexGrow: 1, minWidth: 120, minHeight: 50, borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 12, backgroundColor: '#FFFFFF', fontSize: 16, color: colors.navy },
  menu: { alignSelf: 'flex-end', maxWidth: '100%', padding: 8, backgroundColor: '#FFFFFF', borderRadius: 16, gap: 6, borderWidth: 1, borderColor: colors.line },
  error: { color: '#9B302C', fontSize: 14, lineHeight: 21 },
});
