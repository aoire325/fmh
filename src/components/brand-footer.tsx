import { StyleSheet, Text, View } from 'react-native';
import { TalkBridgeWordmark } from '@/components/talkbridge-wordmark';
import { colors } from '@/constants/palette';

export function BrandFooter() {
  return <View testID="brand-footer" style={styles.footer}>
    <View style={styles.content}>
      <TalkBridgeWordmark />
      <Text style={styles.tagline}>Communication Without Barriers</Text>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  footer: { width: '100%', backgroundColor: colors.tealDeep, marginTop: 'auto' },
  content: { width: '100%', maxWidth: 1120, alignSelf: 'center', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 24, gap: 8 },
  tagline: { color: '#FFFFFF', fontSize: 14, lineHeight: 22, textAlign: 'center' },
});
