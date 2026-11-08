# Spoken output and personal voices

Open the translator, review a suggestion, and add it to the transcript. **Speak**
reads the current text out loud. **Speak accepted signs automatically** queues
each newly accepted word or sentence once. It does not speak candidate lists,
unfinished sentence drafts, or every keystroke. **Stop**, **Clear**, leaving the
translator, changing voices, and backgrounding the app cancel pending speech.
Speaking uses the existing recognition results; it does not expand ASL model
coverage or establish translation accuracy.

**Choose voice**, or **Settings → Voice & speaking**, opens the `/voice` screen.
The screen has a text field for testing speech without a camera:

- **Male AI voice** and **Female AI voice** are two distinct online ElevenLabs
  presets. The service discovers current available default voices using their
  gender labels instead of hard-coding retired voice IDs. Server environment
  variables can override each preset.
- **My personal voice** uses an authorized clone created from an uploaded video.
- **Device voice** uses the phone's installed speech engine without the TalkBridge
  voice service or an ElevenLabs API key. Install an English system voice for
  offline use. Its sound and network behavior depend on the phone's speech engine.

Voice choice, speed, and automatic-speech preference are saved locally. Automatic
speech starts off. The initial choice is Device voice so missing online service
credentials do not prevent spoken communication. Online speech is not silently
substituted with a different voice after a failure; the user can choose Device
voice explicitly. Speech plays on the phone's current audio output; adjust media
volume or disconnect headphones if speech should be heard by nearby listeners.

## Speak in a meeting

Start or join a call, then open **Meeting voice**. Choose **Male**, **Female**, or
**My voice** (when your personal voice is ready). Enter text under **Say it with
text** and tap **Speak to meeting**. Your guest hears the selected voice and sees
the caption, even while your microphone is off. **Send caption** still shares
text without speech. In Focus call view, tap the speaker icon to open these controls.
The Speak button is disabled while the text box is empty. Sending clears the box;
enter your next message to enable it again.

Enable **Speak reviewed signs** to speak each newly shared word or reviewed
sentence once. Unreviewed AI guesses, private previews, and unfinished drafts
remain silent. This meeting switch starts off and is separate from the
translator's automatic-speech preference. **Stop voice** cancels queued output
and asks the guest to stop your audio; **Hear guest's AI voice** controls incoming
playback. Hang-up, leaving the screen, and backgrounding stop meeting speech.

Both callers need the updated app. The speaking caller needs a configured voice
service; the guest can listen without ElevenLabs credentials or a personal voice
profile. The sender synthesizes the selected text using their own service access
and sends bounded MP3 chunks over the call's encrypted data channel. No voice
profile IDs, service credentials, or audio download URLs are sent to the guest.
The guest plays transient audio directly on their phone. It is independent of
the microphone track, so the microphone can stay muted. Each message is limited
to 280 characters and 512 KB of generated audio. Speech is queued one message
at a time with a bounded backlog; online generation can introduce a delay.

## Development setup

The feature adds Expo SDK 58-compatible `expo-speech`, `expo-audio`,
`expo-document-picker`, `expo-secure-store`, and `expo-crypto`. Install dependencies
with `npm install`, then **rebuild the native development app** with
`npm run android` or `npm run ios`. Reloading an old binary is insufficient.
No new microphone permission is requested for speaking or importing a video.
The existing optional call microphone permission is preserved.

1. Copy `server/.env.example` to `server/.env.local` and set `ELEVENLABS_API_KEY` to
   an account key with text-to-speech and voice permissions. Personal voice
   creation requires a provider account plan that supports instant voice cloning.
   Do not put the provider key in `.env.local` at the app root or in any
   `EXPO_PUBLIC_*` variable.
2. Install **FFmpeg** on the backend computer, or set `FFMPEG_PATH` to an installed
   executable. The server Docker image already installs FFmpeg. Device speech
   and the two online default presets do not require FFmpeg.
3. Restart `npm start`, `npm run android`, or `npm run ios`. The development startup
   script loads `server/.env.local` before starting the existing service on port
   8787. If another service instance already owns that port, restart that instance
   too so it receives the new routes and credentials.
4. Open Voice settings and tap **Refresh voices**. If `VOICE_SERVICE_TOKEN` is set,
   enter that access key under **Service connection**. It is saved in the OS
   secure store, outside the JavaScript bundle.
5. Select Male AI voice, play the sample text, then repeat with Female AI voice.
   Return to the translator and test both manual and automatic speech.

The mobile app uses `EXPO_PUBLIC_VOICE_SERVICE_URL` when set. Otherwise it uses the
HTTP(S) origin of `EXPO_PUBLIC_CALL_SIGNAL_URL`, or discovers the Metro computer
in local development. The origin must not contain a path. Packaged releases
require HTTPS. The existing USB connection script forwards port 8787 as well as
Metro, so both services work through the same Android USB connection.

## Create a personal voice

1. Choose a video containing the person's actual speaking voice, including an
   older recording from before they lost speech. Silent signing footage contains
   no vocal identity to clone. Prefer one speaker, 30–120 seconds of clear speech,
   no music, and no overlapping voices. Files must be no larger than 50 MB.
2. Name the voice, choose the video, and confirm that it is your own voice or that
   the speaker authorized this use. Choosing the file alone does not upload it.
3. Tap **Create my voice** and keep the screen open. The service extracts up to
   120 seconds of mono audio, removes silence, and requires at least 10 seconds
   of audible output before contacting ElevenLabs. A video with music or another
   speaker can still be an unsuitable sample; these checks do not prove that the
   audio contains the intended speaker or high-quality speech.
4. A successful provider response creates a persistent personal voice. If the
   provider requires verification, the app shows **Verification needed** and
   prevents personal synthesis. Complete the provider's required process in the
   connected account, then tap **Refresh voices**. TalkBridge cannot bypass a
   provider's verification requirements or guarantee the speaker's eligibility.
5. Preview the result using any text. A ready personal voice becomes the selected
   output voice. The same choice is used for accepted signs in the translator.

This is a provider-backed instant voice clone, not on-device fine-tuning of the
ASL models. No voice was created or trained during implementation: a provider key
and an authorized speaking recording must be supplied at runtime. Audio quality,
voice similarity, service latency, and signing accuracy require device evaluation
with the intended user.

If a request times out or the screen is closed mid-upload, refresh before trying
again: server processing may already have completed. There is at most one
personal voice per device credential. Delete it before creating a replacement.
Deletion removes the provider voice first, then the local service record. Failed
provider deletion retains the profile for retry; a voice already deleted in the
provider dashboard can also be removed locally.

## Service storage and deployment

The existing call service hosts `/voice/status`, `/voice/voices`, `/voice/profile`,
and `/voice/speech`. Calls still use `/calls`, and signaling behavior is unchanged.
Voice endpoints accept only the two configured presets or the requesting
device's own profile, never an arbitrary provider voice ID. Each device creates a
random 256-bit capability stored in the OS secure store. Its SHA-256 hash names a
private JSON profile on the server. The JSON stores provider voice ID, display
name, consent version, creation time, and verification status. Server restarts
preserve the profile; the provider key and device secret are not returned in API
responses. Losing the device credential loses in-app access to that profile;
the service operator can still remove the voice through the provider account.
There is no account-based voice recovery or cross-device profile migration yet.

Production AI endpoints require both `ELEVENLABS_API_KEY` and
`VOICE_SERVICE_TOKEN`. Supply the service key to authorized testers through a
private channel; they enter it in the app. This shared access key is suitable for
controlled testing, not a replacement for user authentication and billing quotas
in a public rollout. Add authenticated user accounts and per-user quotas before
opening the paid voice service to unrestricted visitors. Never embed the service
key in the mobile bundle. The service also limits requests by socket address and
device capability, bounds concurrent jobs and uploaded bytes, and serializes
profile changes for a device. Run a single service instance per profile volume;
multi-instance deployments need shared storage and distributed locking.

Set `VOICE_DATA_DIR` to a private persistent directory. For Docker, mount a volume
at `/app/voice-data`, writable by the image's `node` user. Also retain the existing
production TURN configuration for calls. Terminate TLS at your reverse proxy and
allow 50 MB request bodies and at least 240 seconds for voice creation. Configure
proxy limits and restrict logs so authorization headers, device capabilities,
request bodies, and voice recordings are not logged.

Original videos and extracted audio are held only in temporary service files and
removed on completion or failure. The mobile picker copy is also removed after
upload attempts or leaving the screen; the user's original recording is never
deleted. Generated MP3 files exist in the app cache only for playback and are
deleted afterward. The server does not store synthesized audio or transcript
text. ElevenLabs retains the clone and samples until deletion; provider request
logging/retention follows the connected account's policy. No zero-retention
provider mode is claimed.

## Verification

```bash
npm run typecheck
npm run lint
npm test
npm run test:voice-server
npm run test:calls-server
```

Server tests use an actual loopback HTTP listener with mocked provider responses:
default-voice resolution, synthesis, upload/extraction boundary, private ownership,
restart recovery, consent, verification, deletion/retry, quotas, and cleanup.
Meeting tests cover bounded audio transfer, capability negotiation (including an
already-open guest data channel), malformed packets, mute, cancellation, and
hang-up. Android device testing with a local WebRTC guest verified male and female
incoming playback and typed male speech generated by ElevenLabs and played on the
guest side, with the phone's microphone off. A ready personal clone and physical
iOS call audio have not been tested in a meeting.
Queue tests cover sequencing, cancellation, stale completions, errors, and bounded
backlogs. Translator tests verify that only accepted signs reach automatic speech,
typed edits wait for Speak, and Clear stops output. These checks do not verify
live provider cloning or real-speaker similarity.

Implementation references: [Expo SDK 58 speech](https://docs.expo.dev/versions/v58.0.0/sdk/speech/),
[Expo audio](https://docs.expo.dev/versions/v58.0.0/sdk/audio/),
[document picker](https://docs.expo.dev/versions/v58.0.0/sdk/document-picker/),
[ElevenLabs instant voice cloning](https://elevenlabs.io/docs/api-reference/voices/ivc/create),
[available voices](https://elevenlabs.io/docs/api-reference/voices/search), and
[speech synthesis](https://elevenlabs.io/docs/api-reference/text-to-speech/convert).
