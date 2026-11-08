import { router } from 'expo-router';
import { useCallback, useEffect, useRef, type ComponentRef } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { InformationBar } from '@/components/information-bar';
import { MeetingPlanner } from '@/components/meeting-planner';
import { BrandFooter } from '@/components/brand-footer';
import { colors } from '@/constants/palette';

export function WelcomeScreen({ onOpenCalls }: { onOpenCalls?: () => void }) {
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const contentRef = useRef<ComponentRef<typeof View>>(null);
  const focusedCode = useRef<ComponentRef<typeof View> | null>(null);
  const revealCode = useCallback(() => {
    const target = focusedCode.current;
    const content = contentRef.current;
    if (!target || !content) return;
    target.measureLayout(content, (_x, y) => {
      if (focusedCode.current === target) scrollRef.current?.scrollTo({ y: Math.max(0, y - 16), animated: false });
    }, () => undefined);
  }, []);
  useEffect(() => {
    const listener = Keyboard.addListener('keyboardDidShow', revealCode);
    return () => listener.remove();
  }, [revealCode]);
  return <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
    <KeyboardAvoidingView style={styles.scroll} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <InformationBar page="home" onHome={() => scrollRef.current?.scrollTo({ y: 0, animated: false })} />
      <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag" onLayout={revealCode}>
        <View ref={contentRef} collapsable={false} style={styles.body}>
          <View style={styles.planner}>
            <MeetingPlanner onInstantMeeting={onOpenCalls ?? (() => router.push('/call'))}
              onCodeFocus={(target) => { focusedCode.current = target; revealCode(); }} onCodeBlur={() => { focusedCode.current = null; }} />
          </View>
        </View>
        <BrandFooter />
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas }, scroll: { flex: 1 },
  content: { flexGrow: 1 }, body: { alignItems: 'center', padding: 20 },
  planner: { width: '100%', maxWidth: 760, paddingVertical: 16 },
});
