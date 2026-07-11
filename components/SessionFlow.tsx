import { ReactNode, useRef, useState, useEffect } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Crypto from 'expo-crypto';
import {
  CameraView,
  useCameraPermissions,
  useMicrophonePermissions,
  type CameraRecordingOptions,
} from 'expo-camera';
import { COLORS, MIN_TAP } from '@/lib/theme';
import { persistRun } from '@/lib/storage';
import { getAllParticipants } from '@/lib/participantRegistry';
import { isLedConnected, onLedConnectionChange } from '@/lib/ledDevice';
import { PLRRunner } from '@/components/PLRRunner';
import { GazeRunner } from '@/components/GazeRunner';
import { PROTOCOL_LABEL, type AnyTrial, type Protocol, type Run } from '@/lib/types';

type Stage = 'intro' | 'running' | 'between' | 'done';

const RECORD_OPTS: CameraRecordingOptions = { maxDuration: 600 };

// The session runs both protocols back-to-back, in this order.
const SEQUENCE: Protocol[] = ['PLR', 'horizontal_gaze'];

// Renders the active stimulus runner for a protocol. PLR stimulus comes
// from the BLE LED board (see lib/ledDevice), not the phone torch.
const RUNNERS: Record<Protocol, (onDone: (t: AnyTrial[], c: boolean) => void, setCameraActive: (active: boolean) => void) => ReactNode> = {
  PLR: (onDone) => <PLRRunner onDone={onDone} />,
  horizontal_gaze: (onDone, setCameraActive) => <GazeRunner onDone={onDone} setCameraActive={setCameraActive} />,
};

function durationMs(trials: AnyTrial[]): number {
  if (trials.length === 0) return 0;
  const first = trials[0].start_time;
  const last = [...trials].reverse().find((t) => t.end_time)?.end_time ?? first;
  return new Date(last).getTime() - new Date(first).getTime();
}

export function SessionFlow() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>('intro');
  const [participantId, setParticipantId] = useState('');
  const [tag, setTag] = useState('');
  const [index, setIndex] = useState(0); // which protocol in SEQUENCE
  const [runKey, setRunKey] = useState(0); // bump to remount runner + camera per protocol
  const [completed, setCompleted] = useState<Run[]>([]); // finished runs this session
  const [existingParticipants, setExistingParticipants] = useState<string[]>([]);
  const [cameraActive, setCameraActive] = useState(true);
  const [ledConnected, setLedConnected] = useState(isLedConnected());

  useEffect(() => {
    getAllParticipants().then(setExistingParticipants);
  }, []);

  // PLR stimulus comes from the BLE LED board — surface its link state.
  useEffect(() => onLedConnectionChange(setLedConnected), []);

  const sessionId = useRef('');
  const sessionStartedAt = useRef('');
  const startedAt = useRef(''); // current protocol start

  // Camera/mic permissions — back-camera video records every protocol.
  const [camPerm, requestCam] = useCameraPermissions();
  const [micPerm, requestMic] = useMicrophonePermissions();
  const canRecord = !!camPerm?.granted && !!micPerm?.granted;

  const cameraRef = useRef<CameraView>(null);
  const recording = useRef(false);
  const recordPromise = useRef<Promise<{ uri: string } | undefined> | null>(null);
  const videoStartedAt = useRef<string | null>(null);
  const videoStoppedAt = useRef<string | null>(null);

  // Start recording AFTER onCameraReady — iOS often still reports "Camera is not
  // ready yet" if recordAsync is called immediately, so delay + retry.
  const startRecording = () => {
    if (!canRecord || recording.current) return;
    recording.current = true;

    let attempts = 0;
    const tryStart = () => {
      attempts += 1;
      const cam = cameraRef.current;
      if (!cam) {
        if (attempts < 8) return void setTimeout(tryStart, 400);
        recording.current = false;
        return;
      }
      videoStartedAt.current = new Date().toISOString(); // event↔video alignment
      recordPromise.current = cam
        .recordAsync(RECORD_OPTS)
        .catch((e) => {
          if (/not ready/i.test(String(e)) && attempts < 8) {
            videoStartedAt.current = null;
            setTimeout(tryStart, 400);
          }
          return undefined;
        }) as any;
    };

    setTimeout(tryStart, 600);
  };

  const stopRecording = async (): Promise<string | null> => {
    if (!recording.current) return null;
    videoStoppedAt.current = new Date().toISOString(); // end of the video timeline
    try {
      cameraRef.current?.stopRecording();
      const r = await recordPromise.current;
      return r?.uri ?? null;
    } catch {
      return null;
    } finally {
      recording.current = false;
    }
  };

  // Video needs BOTH camera and mic (expo-camera puts the audio session into
  // record mode for video). Request and report the result.
  const requestPerms = async () => {
    const cam = camPerm?.granted ? camPerm : await requestCam();
    const mic = micPerm?.granted ? micPerm : await requestMic();
    if (!cam?.granted || !mic?.granted) {
      Alert.alert(
        'Permission needed',
        'Camera and microphone are required to record the session. Enable them in Settings if the prompt no longer appears.',
      );
    }
  };

  // Begin the whole session at the first protocol.
  const beginSession = () => {
    const participant = participantId.trim();
    if (!participant) {
      Alert.alert('Participant ID required', 'Enter a participant ID before starting the session.');
      return;
    }
    sessionId.current = Crypto.randomUUID();
    sessionStartedAt.current = new Date().toISOString();
    setCompleted([]);
    setIndex(0);
    startProtocol(0);
  };

  const startProtocol = (i: number) => {
    startedAt.current = new Date().toISOString();
    videoStartedAt.current = null;
    videoStoppedAt.current = null;
    recording.current = false;
    setIndex(i);
    setCameraActive(true);
    setRunKey((k) => k + 1);
    setStage('running');
  };

  const onDone = async (trials: AnyTrial[], didComplete: boolean) => {
    const rawUri = await stopRecording();
    const protocol = SEQUENCE[index];
    const run: Run = {
      run_id: Crypto.randomUUID(),
      session_id: sessionId.current,
      session_index: index,
      session_started_at: sessionStartedAt.current,
      participant_id: participantId.trim(),
      protocol,
      timestamp: startedAt.current,
      tag: tag.trim(),
      trials,
      completed: didComplete,
      video_uri: null,
      video_started_at: videoStartedAt.current,
      video_stopped_at: videoStoppedAt.current,
    };

    // AUTO-SAVE after each protocol — completion AND mid-protocol exit.
    // persistRun never throws (data is saved to AsyncStorage even if file
    // export fails); guard anyway so the flow always advances.
    try {
      await persistRun(run, rawUri);
    } catch (e) {
      Alert.alert('Save warning', `Could not fully save this test: ${String(e)}`);
    }
    const done = [...completed, run];
    setCompleted(done);

    // Exit mid-protocol ends the whole session.
    if (!didComplete) {
      setStage('done');
      return;
    }
    if (index < SEQUENCE.length - 1) {
      setStage('between');
    } else {
      setStage('done');
    }
  };

  if (stage === 'running') {
    // Full-screen back camera behind the runner (single proven recording path).
    return (
      <View key={runKey} style={styles.full}>
        {canRecord && cameraActive && (
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing="back"
            mode="video"
            active
            onCameraReady={startRecording}
            pointerEvents="none"
          />
        )}
        {RUNNERS[SEQUENCE[index]](onDone, setCameraActive)}
      </View>
    );
  }

  if (stage === 'between') {
    const justDone = SEQUENCE[index];
    const next = SEQUENCE[index + 1];
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.body}>
          <Text style={styles.checkmark}>✓</Text>
          <Text style={styles.title}>{PROTOCOL_LABEL[justDone]} complete</Text>
          <Text style={styles.progressLine}>
            Test {index + 1} of {SEQUENCE.length} done · saved automatically
          </Text>

          <View style={styles.nextCard}>
            <Text style={styles.nextLabel}>NEXT TEST</Text>
            <Text style={styles.nextName}>{PROTOCOL_LABEL[next]}</Text>
          </View>

          <Pressable style={styles.primary} onPress={() => startProtocol(index + 1)}>
            <Text style={styles.primaryText}>Start {PROTOCOL_LABEL[next]}  →</Text>
          </Pressable>
          <Pressable style={styles.ghost} onPress={() => setStage('done')}>
            <Text style={styles.ghostText}>End session here</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (stage === 'done') {
    return (
      <SafeAreaView style={styles.screen}>
        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.title}>Session complete</Text>
          <Text style={[styles.progressLine, { color: COLORS.ok }]}>
            ✓ {completed.length} test{completed.length === 1 ? '' : 's'} saved for participant {participantId.trim()}
          </Text>

          {completed.map((r) => {
            const secs = Math.round(durationMs(r.trials) / 1000);
            return (
              <View key={r.run_id} style={styles.doneRow}>
                <Text style={styles.doneProtocol}>{PROTOCOL_LABEL[r.protocol]}</Text>
                <Text style={styles.doneMeta}>
                  {secs}s · {r.trials.length} trials · {r.video_uri ? '🎥' : 'no video'}
                </Text>
                <Text style={[styles.doneStatus, { color: r.completed ? COLORS.ok : COLORS.danger }]}>
                  {r.completed ? 'Complete' : 'Partial'}
                </Text>
              </View>
            );
          })}

          <Pressable style={styles.primary} onPress={() => router.replace('/history' as any)}>
            <Text style={styles.primaryText}>View in History</Text>
          </Pressable>
          <Pressable style={styles.secondary} onPress={() => router.back()}>
            <Text style={styles.secondaryText}>Done</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // Intro — one Pre-Session Setup for the whole 2-test session.
  const permLine = canRecord ? '✓ Camera & mic ready' : 'Camera & mic permission needed to record';
  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView style={styles.screen} behavior="padding" keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 25}>
        <ScrollView contentContainerStyle={styles.introBody} keyboardShouldPersistTaps="handled">
        <Pressable style={styles.backLink} onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.backLinkText}>‹ Back</Text>
        </Pressable>
        <Text style={styles.bigTitle}>Pre-Session Setup</Text>
        <Text style={styles.instructions}>
          One session runs both tests back-to-back. After each test finishes you continue to the next.
        </Text>

        <View style={styles.summaryCard}>
          {[
            { label: 'Test 1', value: 'PLR (BLE LED board)' },
            { label: 'Test 2', value: 'Horizontal gaze (self-test)' },
            { label: 'Recording', value: 'Rear camera · one eye', highlight: true },
          ].map((row, i, arr) => (
            <View key={i} style={[styles.summaryRow, i < arr.length - 1 && styles.summaryRowDivider]}>
              <Text style={styles.summaryLabel}>{row.label}</Text>
              <Text style={[styles.summaryValue, row.highlight && { color: COLORS.accent }]}>{row.value}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.sectionLabel}>CHECKLIST</Text>
        <View style={styles.steps}>
          {[
            'PLR: fit the phone into the eye attachment so the REAR camera sits against the eye. The LED board will flash — keep the eye open and looking into the camera.',
            'Horizontal gaze: hold the phone with the rear-camera attachment recording ONE eye.',
            'Use your free hand as the target: extend your arm, make a fist, and raise one finger for the other eye to follow.',
            'Start at center. Move your finger center → right over 3s, hold 1s, return center, move center → left over 3s, hold 1s, return center. Repeat 3 times.',
            'Both tests record automatically and save as one grouped session.',
          ].map((s, i) => (
            <View key={i} style={styles.stepRow}>
              <Text style={styles.stepNum}>{String(i + 1).padStart(2, '0')}</Text>
              <Text style={styles.stepText}>{s}</Text>
            </View>
          ))}
        </View>

        <Text style={[styles.permLine, { color: canRecord ? COLORS.ok : COLORS.subtle }]}>{permLine}</Text>
        <Text style={[styles.permLine, { color: ledConnected ? COLORS.ok : COLORS.subtle }]}>
          {ledConnected ? '✓ LED board connected' : 'Searching for LED board…'}
        </Text>

        <Text style={styles.fieldLabel}>Participant ID</Text>
        <TextInput
          style={styles.input}
          value={participantId}
          onChangeText={setParticipantId}
          placeholder="e.g. P001"
          placeholderTextColor={COLORS.faint}
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="next"
        />
        {existingParticipants.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.existingScroll}>
            {existingParticipants.map(p => (
              <Pressable key={p} style={styles.existingPill} onPress={() => setParticipantId(p)}>
                <Text style={styles.existingPillText}>{p}</Text>
              </Pressable>
            ))}
          </ScrollView>
        )}

        <Text style={styles.fieldLabel}>Session (optional)</Text>
        <TextInput
          style={styles.input}
          value={tag}
          onChangeText={setTag}
          placeholder="e.g. session 1"
          placeholderTextColor={COLORS.faint}
          returnKeyType="done"
        />

        {canRecord ? (
          <Pressable style={styles.primary} onPress={beginSession}>
            <Text style={styles.primaryText}>Begin Session  →</Text>
          </Pressable>
        ) : (
          <Pressable style={styles.primary} onPress={requestPerms}>
            <Text style={styles.primaryText}>Grant camera & mic</Text>
          </Pressable>
        )}
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  full: { flex: 1, backgroundColor: COLORS.bg },
  screen: { flex: 1, backgroundColor: COLORS.bg },
  body: { flexGrow: 1, paddingHorizontal: 24, justifyContent: 'center', gap: 14 },
  introBody: { paddingHorizontal: 22, paddingTop: 16, paddingBottom: 40, gap: 12 },
  backLink: { minHeight: 36, justifyContent: 'center' },
  backLinkText: { color: COLORS.accent2, fontSize: 16, fontWeight: '600' },
  bigTitle: { color: COLORS.text, fontSize: 30, fontWeight: '800' },
  checkmark: { color: COLORS.ok, fontSize: 56, fontWeight: '900', textAlign: 'center' },
  summaryCard: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    paddingHorizontal: 16,
    marginTop: 8,
  },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14 },
  summaryRowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.cardBorder },
  summaryLabel: { color: COLORS.subtle, fontSize: 14 },
  summaryValue: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  sectionLabel: { color: COLORS.faint, fontSize: 12, fontWeight: '800', letterSpacing: 1.5, marginTop: 14 },
  steps: { gap: 14, marginTop: 2 },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  stepNum: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: COLORS.bg,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    color: COLORS.accent2,
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 32,
    overflow: 'hidden',
  },
  stepText: { flex: 1, color: COLORS.subtle, fontSize: 14, lineHeight: 21 },
  title: { color: COLORS.text, fontSize: 28, fontWeight: '700', textAlign: 'center' },
  instructions: { color: COLORS.subtle, fontSize: 15, lineHeight: 22 },
  progressLine: { color: COLORS.subtle, fontSize: 14, textAlign: 'center' },
  permLine: { fontSize: 13 },
  fieldLabel: { color: COLORS.subtle, fontSize: 13, marginTop: 8 },
  input: {
    minHeight: MIN_TAP,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    borderRadius: 12,
    paddingHorizontal: 14,
    color: COLORS.text,
    fontSize: 16,
    backgroundColor: COLORS.card,
  },
  existingScroll: { marginTop: 4, flexDirection: 'row', marginBottom: 4 },
  existingPill: {
    backgroundColor: 'rgba(100, 255, 218, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(100, 255, 218, 0.3)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 6,
  },
  existingPillText: { color: COLORS.accent, fontSize: 13, fontWeight: '700' },
  nextCard: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.accent2,
    padding: 18,
    alignItems: 'center',
    gap: 4,
  },
  nextLabel: { color: COLORS.faint, fontSize: 12, fontWeight: '800', letterSpacing: 1.5 },
  nextName: { color: COLORS.text, fontSize: 22, fontWeight: '800' },
  doneRow: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 14,
    gap: 2,
  },
  doneProtocol: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  doneMeta: { color: COLORS.faint, fontSize: 13 },
  doneStatus: { fontSize: 12, fontWeight: '700', position: 'absolute', right: 14, top: 14 },
  primary: {
    minHeight: 56,
    backgroundColor: COLORS.accent,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  primaryText: { color: '#06281F', fontSize: 17, fontWeight: '800' },
  secondary: {
    minHeight: MIN_TAP,
    borderWidth: 1,
    borderColor: COLORS.accent,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { color: COLORS.accent, fontSize: 16, fontWeight: '600' },
  ghost: { minHeight: MIN_TAP, alignItems: 'center', justifyContent: 'center' },
  ghostText: { color: COLORS.faint, fontSize: 15 },
});
