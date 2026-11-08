import { requireOptionalNativeModule } from 'expo';

export function requireVoiceNativeSupport(...names: string[]) {
  if (names.some((name) => !requireOptionalNativeModule(name))) {
    throw new Error('Voice features need an updated native app. Rebuild and reopen TalkBridge to enable them.');
  }
}
