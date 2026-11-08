import { StyleSheet, Text } from 'react-native';

export function TalkBridgeWordmark() {
  return <Text accessibilityLabel="TalkBridge" style={styles.brand}><Text style={styles.talk}>talk</Text><Text style={styles.bridge}>bridge</Text></Text>;
}

const styles = StyleSheet.create({
  brand: { maxWidth: '100%', fontSize: 24, fontWeight: '800', letterSpacing: -0.8 },
  talk: { color: '#A8D67F' }, bridge: { color: '#FFFFFF' },
});
