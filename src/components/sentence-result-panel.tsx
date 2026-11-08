import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors } from '@/constants/palette';
import type { SentenceResult } from '@/recognition/use-sentence-translator';
import { ActionButton } from './action-button';

type Props = {
  result: SentenceResult | null;
  message: string;
  draft: string;
  busy: boolean;
  onChangeText: (text: string) => void;
  onAccept: () => void;
  onDiscard: () => void;
  acceptLabel?: string;
  acceptText?: string;
  acceptDisabled?: boolean;
};

const titles: Record<SentenceResult, string> = {
  processing: 'Processing… Translating your recording',
  translated: 'Translation draft',
  unverified: 'Unverified draft',
  unrecognized: 'No clear sentence detected',
};

export function SentenceResultPanel({ result, message, draft, busy, onChangeText, onAccept, onDiscard,
  acceptLabel = 'Add sentence to transcript', acceptText = acceptLabel, acceptDisabled = false }: Props) {
  if (!result) return null;
  return <View testID="sentence-result" style={styles.panel}>
    <View accessibilityLiveRegion="polite" style={styles.status}>
      <Text accessibilityRole="header" style={styles.title}>{titles[result]}</Text>
      {busy ? <ActivityIndicator color={colors.teal} accessibilityLabel="Translating your recorded sentence" /> : null}
      <Text style={styles.body}>{message}</Text>
    </View>
    {result === 'unverified' ? <Text style={styles.body}>This is an uncertain or incomplete AI guess. It may not match your signing. Review and edit it before using it.</Text>
      : result === 'unrecognized' ? <Text style={styles.body}>No translation was recovered. Type what you meant below, or record again.</Text>
        : <Text style={styles.body}>Review and edit the draft before using it.</Text>}
    <TextInput accessibilityLabel="Review and edit sentence translation" multiline textAlignVertical="top"
      value={draft} onChangeText={onChangeText} editable={!busy}
      placeholder={busy ? 'Waiting for the first words…' : 'Type the sentence you meant…'}
      placeholderTextColor={colors.inkSoft} style={styles.input} />
    <ActionButton label={acceptLabel} text={acceptText} icon="+" variant="primary"
      disabled={busy || acceptDisabled || !draft.trim()} onPress={onAccept} />
    <ActionButton label="Discard draft" text="Discard draft" icon="⌫" variant="quiet" disabled={busy} onPress={onDiscard} />
  </View>;
}

const styles = StyleSheet.create({
  panel: { padding: 14, borderRadius: 16, gap: 12, borderWidth: 2, borderColor: colors.teal, backgroundColor: colors.field },
  status: { gap: 8 },
  title: { color: colors.navy, fontSize: 20, fontWeight: '700' },
  body: { color: colors.inkSoft, fontSize: 15, lineHeight: 22 },
  input: { minHeight: 100, borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 12,
    color: colors.navy, backgroundColor: colors.white, fontSize: 18, lineHeight: 26 },
});
