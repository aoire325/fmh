import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { InformationBar } from '@/components/information-bar';
import { BrandFooter } from '@/components/brand-footer';

const values = [
  ['Inclusivity', 'Everyone deserves equal opportunities to communicate.'],
  ['Accessibility', 'Making communication easier and more accessible.'],
  ['Understanding', 'Encouraging mutual understanding and connection.'],
  ['Respect', 'Recognizing and respecting different ways of communicating.'],
];

export default function AboutScreen() {
  return <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
    <InformationBar page="about" />
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      <View style={styles.content}>
      <Text accessibilityRole="header" style={styles.title}>About TalkBridge</Text>
      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.heading}>Who We Are</Text>
        <Text style={styles.body}>TalkBridge is a video communication platform designed to connect sign language users with people who are not familiar with sign language.</Text>
      </View>
      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.heading}>Our Mission</Text>
        <Text style={styles.body}>Communication should never be a barrier to human connection. However, people who use sign language often face challenges when communicating with those who do not understand it. TalkBridge aims to make these interactions easier by providing a platform that brings people closer together.</Text>
      </View>
      <Text accessibilityRole="header" style={styles.heading}>Our Values</Text>
      <View style={styles.values}>
        {values.map(([name, description]) => <View key={name} style={[styles.card, styles.value]}>
          <Text style={styles.body}><Text style={styles.valueName}>{name}: </Text>{description}</Text>
        </View>)}
      </View>
      </View>
      <BrandFooter />
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#E5F2E8' }, scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  content: { width: '100%', maxWidth: 860, alignSelf: 'center', padding: 24, gap: 22, paddingBottom: 40 },
  title: { color: '#163D2A', fontSize: 36, fontWeight: '800', letterSpacing: -1, marginVertical: 10 },
  heading: { color: '#237449', fontSize: 23, fontWeight: '700' },
  card: { backgroundColor: '#FFFFFF', borderRadius: 22, padding: 22, gap: 12, borderWidth: 1, borderColor: '#B7D5C0' },
  body: { color: '#456452', fontSize: 16, lineHeight: 27 },
  values: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 }, value: { flexGrow: 1, flexBasis: 280 },
  valueName: { color: '#163D2A', fontWeight: '800' },
});
