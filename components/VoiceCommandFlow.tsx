import React, { useRef, useState, useEffect } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import * as Crypto from 'expo-crypto';
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';
import { File } from 'expo-file-system';
import { COLORS, MIN_TAP } from '@/lib/theme';
import {
  GROUP_IMAGE,
  groupSequenceFor,
  NUM_GROUPS,
  TASK_TYPE_LABEL,
  tasksForGroup,
  type VoiceTask,
} from '@/lib/voiceTasks';
import { validateVoiceSessionProcedure } from '@/lib/voiceProcedure';
import { copySessionAudio, persistVoiceSession, voiceSessionJsonPath } from '@/lib/voiceStorage';
import type { VoiceRecordingState, VoiceRoundLog, VoiceSession, VoiceTransitionDirection } from '@/lib/voiceTypes';
import { getParticipantNumber, peekParticipantNumber, getParticipantRunCount, incrementParticipantRunCount, getAllParticipants } from '@/lib/participantRegistry';

type Stage = 'setup' | 'roundIntro' | 'task' | 'done';

const nowISO = () => new Date().toISOString();
const relAudioMs = (session: VoiceSession | null, timestamp: string): number | null =>
  session?.audioStartedAt ? Math.max(0, new Date(timestamp).getTime() - new Date(session.audioStartedAt).getTime()) : null;

const audioFileExists = (uri: string | null): boolean => {
  if (!uri) return false;
  try {
    return new File(uri).exists;
  } catch {
    return false;
  }
};

export function VoiceCommandFlow() {
  const router = useRouter();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  const [stage, setStage] = useState<Stage>('setup');
  const [participantText, setParticipantText] = useState('');
  const [selectedRoundText, setSelectedRoundText] = useState('1'); // '1'..'10'
  const [micGranted, setMicGranted] = useState(false);

  const [roundIdx, setRoundIdx] = useState(0); // 0..9 — index into the sequence
  const [taskIdx, setTaskIdx] = useState(0); // 0..4 — task within the round
  const [recording, setRecording] = useState(false);
  const [preview, setPreview] = useState<number[] | null>(null);
  const [runCount, setRunCount] = useState<number>(0);
  const [pNumPreview, setPNumPreview] = useState<number>(1);
  const [existingParticipants, setExistingParticipants] = useState<string[]>([]);

  useEffect(() => {
    getAllParticipants().then(setExistingParticipants);
  }, []);

  const sessionRef = useRef<VoiceSession | null>(null);
  const sequence = sessionRef.current?.group_sequence ?? [];
  const isSingleRoundMode = true;
  const targetRound = parseInt(selectedRoundText, 10);

  // Update preview asynchronously
  useEffect(() => {
    const p = participantText.trim();
    if (!p) {
      setPreview(null);
      setRunCount(0);
      return;
    }
    Promise.all([
      peekParticipantNumber(p),
      getParticipantRunCount(p)
    ]).then(([num, rc]) => {
      setPreview(groupSequenceFor(p, num ?? undefined));
      setRunCount(rc);
      setPNumPreview(num ?? 1);
    });
  }, [participantText]);

  const currentRecordingState = (): VoiceRecordingState => (recording ? 'recording' : 'not_recording');

  // ---- permissions ----
  const requestMic = async () => {
    const status = await AudioModule.requestRecordingPermissionsAsync();
    setMicGranted(status.granted);
    if (!status.granted) {
      Alert.alert(
        'Microphone needed',
        'Microphone access is required to record the spoken commands. Enable it in Settings if the prompt no longer appears.',
      );
    }
  };

  // ---- session lifecycle ----
  const beginSession = async () => {
    const participant = participantText.trim();
    if (!participant) {
      Alert.alert('Participant ID', 'Enter a participant identifier (text or number).');
      return;
    }

    const pNum = await getParticipantNumber(participant);
    const rc = await getParticipantRunCount(participant);
    const seqIdx = targetRound - 1;
    const fullSeq = groupSequenceFor(participant, pNum);
    const assignedGroup = fullSeq[seqIdx];

    const status = await AudioModule.requestRecordingPermissionsAsync();
    setMicGranted(status.granted);
    if (!status.granted) {
      Alert.alert('Microphone needed', 'Microphone access is required. The task cannot start without audio recording.');
      return;
    }

    const session: VoiceSession = {
      kind: 'voice_command',
      session_id: Crypto.randomUUID(),
      participant,
      participant_number: pNum,
      group_sequence: [assignedGroup],
      started_at: nowISO(),
      ended_at: null,
      audioStartedAt: null,
      audioStoppedAt: null,
      audioUri: null,
      jsonUri: null,
      completed: false,
      rounds: [],
    };

    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      session.audioStartedAt = nowISO();
      setRecording(true);
    } catch (e) {
      setRecording(false);
      Alert.alert('Recording problem', `Could not start the microphone: ${String(e)}. The task cannot continue without audio.`);
      return;
    }

    sessionRef.current = session;
    setRoundIdx(0);
    setStage('roundIntro');
  };

  const currentRoundTasks = (): VoiceTask[] => tasksForGroup(sequence[roundIdx]);

  const stampShown = (rIdx: number, tIdx: number) => {
    const session = sessionRef.current;
    const round = session?.rounds[rIdx];
    const log = round?.tasks[tIdx];
    if (!round || !log) return;
    const shownAt = nowISO();
    const shownAtAudioMs = relAudioMs(session, shownAt);
    const recordingState = currentRecordingState();
    if (!log.shownAt) {
      log.shownAt = shownAt;
      log.shownAtAudioMs = shownAtAudioMs;
    }
    log.visits.push({ shownAt, leftAt: null, shownAtAudioMs, leftAtAudioMs: null, leaveDirection: null, recordingState });
    round.pageEvents.push({
      event: 'shown',
      timestamp: shownAt,
      audioMs: shownAtAudioMs,
      participant: session.participant,
      groupSequence: [...session.group_sequence],
      round: log.round,
      group: log.group,
      groupId: log.groupId,
      taskCode: log.taskCode,
      taskId: log.taskId,
      taskIndex: log.taskIndex,
      type: log.type,
      sceneId: log.sceneId,
      imageAsset: log.imageAsset,
      transitionDirection: null,
      recordingState,
    });
  };
  const stampLeft = (rIdx: number, tIdx: number, direction: VoiceTransitionDirection) => {
    const session = sessionRef.current;
    const round = session?.rounds[rIdx];
    const log = round?.tasks[tIdx];
    if (!round || !log) return;
    const openVisit = [...log.visits].reverse().find((visit) => visit.leftAt === null);
    if (!openVisit) return;
    const leftAt = nowISO();
    const leftAtAudioMs = relAudioMs(session, leftAt);
    const recordingState = currentRecordingState();
    log.leftAt = leftAt;
    log.leftAtAudioMs = leftAtAudioMs;
    openVisit.leftAt = leftAt;
    openVisit.leftAtAudioMs = leftAtAudioMs;
    openVisit.leaveDirection = direction;
    openVisit.recordingState = recordingState;
    round.pageEvents.push({
      event: 'left',
      timestamp: leftAt,
      audioMs: leftAtAudioMs,
      participant: session.participant,
      groupSequence: [...session.group_sequence],
      round: log.round,
      group: log.group,
      groupId: log.groupId,
      taskCode: log.taskCode,
      taskId: log.taskId,
      taskIndex: log.taskIndex,
      type: log.type,
      sceneId: log.sceneId,
      imageAsset: log.imageAsset,
      transitionDirection: direction,
      recordingState,
    });
  };

  const startRound = async (rIdx: number) => {
    const session = sessionRef.current;
    if (!session) return;
    const group = session.group_sequence[rIdx];
    const tasks = tasksForGroup(group);
    const roundLog: VoiceRoundLog = {
      round: targetRound,
      group,
      groupId: `G${group}`,
      audioStartedAt: session.audioStartedAt,
      audioStoppedAt: null,
      audioUri: null,
      pageEvents: [],
      tasks: tasks.map((t, i) => ({
        taskCode: t.taskCode,
        taskId: t.taskCode,
        group: t.group,
        groupId: t.groupId,
        round: targetRound,
        taskIndex: i + 1,
        type: t.type,
        sceneId: t.sceneId,
        imageAsset: t.imageAsset,
        promptLines: t.promptLines,
        shownAt: '',
        leftAt: null,
        shownAtAudioMs: null,
        leftAtAudioMs: null,
        visits: [],
      })),
    };
    session.rounds[rIdx] = roundLog;

    setRoundIdx(rIdx);
    setTaskIdx(0);
    stampShown(rIdx, 0);
    setStage('task');
  };

  const stopSessionRecording = async (session: VoiceSession) => {
    if (!recording) return;
    let uri: string | null = null;
    try {
      await recorder.stop();
      uri = recorder.uri ?? null;
    } catch {
      // keep whatever the recorder produced
    }
    session.audioStoppedAt = nowISO();
    setRecording(false);
    if (uri) session.audioUri = await copySessionAudio(session, uri);
    for (const round of session.rounds) {
      if (!round) continue;
      round.audioStartedAt = session.audioStartedAt;
      round.audioStoppedAt = session.audioStoppedAt;
      round.audioUri = null;
    }
  };

  // Checkpoint after each round, then advance to the next round. The one session
  // recording is stopped only when the whole test ends or the user exits early.
  const finishRound = async (early: boolean) => {
    const session = sessionRef.current;
    if (!session) return;
    const rIdx = roundIdx;
    const isLast = rIdx >= NUM_GROUPS - 1 || isSingleRoundMode;
    stampLeft(rIdx, taskIdx, early ? 'end_session' : 'end_round');

    if (early || isLast) {
      session.ended_at = nowISO();
      await stopSessionRecording(session);
      if (!early && isLast) {
        // If single round, we consider it completed if that round is done
        const result = validateVoiceSessionProcedure(session, { audioFileExists: audioFileExists(session.audioUri) });
        session.completed = result.valid;
        if (!result.valid) {
          Alert.alert('Procedure incomplete', `Session saved as partial because validation failed:\n${result.errors.slice(0, 4).join('\n')}`);
        }
      } else {
        session.completed = false;
      }
    }
    try {
      await persistVoiceSession(session);
      if (!early && isLast) {
        await incrementParticipantRunCount(session.participant);
      }
    } catch (e) {
      Alert.alert('Save warning', `Could not fully save: ${String(e)}`);
    }

    if (early || isLast) {
      setStage('done');
    } else {
      setRoundIdx(rIdx + 1);
      setStage('roundIntro');
    }
  };

  const confirmEndSession = () => {
    Alert.alert('End session?', 'This stops recording and ends the session early. Completed rounds are saved.', [
      { text: 'Keep going', style: 'cancel' },
      { text: 'End session', style: 'destructive', onPress: () => void finishRound(true) },
    ]);
  };

  const goNext = () => {
    const rIdx = roundIdx;
    if (taskIdx < currentRoundTasks().length - 1) {
      stampLeft(rIdx, taskIdx, 'next');
      const next = taskIdx + 1;
      setTaskIdx(next);
      stampShown(rIdx, next);
    } else {
      void finishRound(false);
    }
  };

  const goPrev = () => {
    if (taskIdx === 0) return;
    stampLeft(roundIdx, taskIdx, 'previous');
    const prev = taskIdx - 1;
    setTaskIdx(prev);
    stampShown(roundIdx, prev);
  };

  // ============================== RENDER ==============================

  if (stage === 'roundIntro') {
    const round = targetRound;
    const group = sequence[roundIdx];
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.centerBody}>
          <View style={styles.roundTag}>
            <Text style={styles.roundTagText}>ROUND {round}</Text>
          </View>
          <Text style={styles.roundTitle}>5 voice commands</Text>
          <Text style={styles.roundSub}>
            For each card: imagine you are driving, then say the command out loud.
          </Text>
          <View style={styles.metaCard}>
            <Text style={styles.metaText}>Participant ID: {sessionRef.current?.participant}</Text>
            <Text style={styles.metaSub}>Group {group} · Sequence Order {roundIdx + 1}</Text>
          </View>
          <Pressable style={styles.primary} onPress={() => void startRound(roundIdx)}>
            <Text style={styles.primaryText}>Start round  ●</Text>
          </Pressable>
          <Pressable style={styles.ghost} onPress={confirmEndSession}>
            <Text style={styles.ghostText}>End session</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (stage === 'task') {
    const tasks = currentRoundTasks();
    const t = tasks[taskIdx];
    const last = taskIdx === tasks.length - 1;
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.taskHeader}>
          <View style={styles.headerLeft}>
            <View style={styles.inlineRoundTag}>
              <Text style={styles.inlineRoundTagText}>R{targetRound}</Text>
            </View>
            <Text style={styles.crumb}>
              P{sessionRef.current?.participant} · {t.groupId} · Task {taskIdx + 1}/5
            </Text>
          </View>
          <View style={styles.recPill}>
            <View style={[styles.recDot, !recording && styles.recDotOff]} />
            <Text style={[styles.recText, !recording && styles.recTextOff]}>{recording ? 'REC' : 'NO AUDIO'}</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.taskBody}>
          <Image source={GROUP_IMAGE[t.group]} style={styles.picture} contentFit="cover" transition={120} />
          <Text style={styles.taskType}>{TASK_TYPE_LABEL[t.type]}</Text>
          <View style={styles.promptCard}>
            {t.promptLines.map((line, i) => (
              <Text key={i} style={[styles.promptLine, i === 0 && styles.promptIntro]}>{line}</Text>
            ))}
          </View>
        </ScrollView>

        <View style={styles.navBar}>
          <Pressable
            style={[styles.navBtn, taskIdx === 0 && styles.navBtnDisabled]}
            onPress={goPrev}
            disabled={taskIdx === 0}
          >
            <Text style={[styles.navText, taskIdx === 0 && styles.navTextDisabled]}>‹ Prev</Text>
          </Pressable>
          <Pressable style={[styles.navBtn, styles.navNext]} onPress={goNext}>
            <Text style={styles.navNextText}>{last ? 'Finish round ✓' : 'Next ›'}</Text>
          </Pressable>
        </View>
        <Pressable style={styles.endStrip} onLongPress={confirmEndSession} delayLongPress={800}>
          <Text style={styles.endStripText}>Hold to end session</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  if (stage === 'done') {
    const session = sessionRef.current;
    const doneRounds = session?.rounds.filter(Boolean).length ?? 0;
    return (
      <SafeAreaView style={styles.screen}>
        <ScrollView contentContainerStyle={styles.centerBody}>
          <Text style={styles.checkmark}>✓</Text>
          <Text style={styles.roundTitle}>{session?.completed ? 'Session complete' : 'Session ended'}</Text>
          <Text style={styles.roundSub}>
            Participant {session?.participant} · {doneRounds} round{doneRounds === 1 ? '' : 's'} logged · {session?.audioUri ? '1 audio file' : 'no audio'}
          </Text>
          <Text style={styles.seqLine}>Group order: {session?.group_sequence.join(', ')}</Text>
          {!!session && <Text style={styles.seqLine}>JSON: {voiceSessionJsonPath(session)}</Text>}
          <Pressable style={styles.primary} onPress={() => router.replace('/' as any)}>
            <Text style={styles.primaryText}>Done</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ---- setup ----
  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.setupBody}>
        <Pressable style={styles.backLink} onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.backLinkText}>‹ Back</Text>
        </Pressable>
        <Text style={styles.bigTitle}>In-Vehicle Voice Command Task</Text>
        <Text style={styles.roundSub}>
          {NUM_GROUPS} rounds · 5 spoken commands per round. The group order rotates per participant; round 1 is the
          sober baseline.
        </Text>

        <View style={styles.inputGroup}>
          <Text style={styles.fieldLabel}>Participant ID</Text>
          <TextInput
            style={styles.input}
            value={participantText}
            onChangeText={setParticipantText}
            placeholder="e.g. P1 or 123"
            placeholderTextColor={COLORS.faint}
            keyboardType="default"
            autoCapitalize="characters"
            returnKeyType="done"
          />
          {existingParticipants.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.existingScroll}>
              {existingParticipants.map(p => (
                <Pressable key={p} style={styles.existingPill} onPress={() => setParticipantText(p)}>
                  <Text style={styles.existingPillText}>{p}</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.fieldLabel}>Round Selection</Text>
          <View style={styles.roundButtons}>
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'].map((r) => (
              <Pressable
                key={r}
                style={[styles.roundBtn, selectedRoundText === r && styles.roundBtnActive]}
                onPress={() => setSelectedRoundText(r)}
              >
                <Text style={[styles.roundBtnText, selectedRoundText === r && styles.roundBtnTextActive]}>{r}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {preview && targetRound ? (
          <Text style={styles.seqLine}>Targeting Round {targetRound} (Group {preview[targetRound - 1]}, Participant No. {pNumPreview})</Text>
        ) : null}

        <Text style={[styles.permLine, { color: micGranted ? COLORS.ok : COLORS.subtle }]}>
          {micGranted ? '✓ Microphone ready' : 'Microphone permission needed to record'}
        </Text>

        {micGranted ? (
          <Pressable style={styles.primary} onPress={beginSession}>
            <Text style={styles.primaryText}>Begin  →</Text>
          </Pressable>
        ) : (
          <Pressable style={styles.primary} onPress={requestMic}>
            <Text style={styles.primaryText}>Grant microphone</Text>
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  centerBody: { flexGrow: 1, paddingHorizontal: 24, justifyContent: 'center', alignItems: 'center', gap: 12 },
  setupBody: { paddingHorizontal: 22, paddingTop: 16, paddingBottom: 40, gap: 12 },
  backLink: { minHeight: 36, justifyContent: 'center' },
  backLinkText: { color: COLORS.accent2, fontSize: 16, fontWeight: '600' },
  bigTitle: { color: COLORS.text, fontSize: 30, fontWeight: '800' },

  // round intro / done
  roundTag: {
    backgroundColor: COLORS.accent,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 4,
  },
  roundTagText: { color: '#06281F', fontSize: 18, fontWeight: '900' },
  roundKicker: { color: COLORS.accent2, fontSize: 14, fontWeight: '800', letterSpacing: 2 },
  baseline: { color: COLORS.accent, fontSize: 13, fontWeight: '700', letterSpacing: 1 },
  roundTitle: { color: COLORS.text, fontSize: 26, fontWeight: '800', textAlign: 'center' },
  roundSub: { color: COLORS.subtle, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  metaCard: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    paddingHorizontal: 18,
    paddingVertical: 12,
    alignItems: 'center',
  },
  metaText: { color: COLORS.text, fontSize: 16, fontWeight: '800' },
  metaSub: { color: COLORS.subtle, fontSize: 13, fontWeight: '500', marginTop: 2 },
  checkmark: { color: COLORS.ok, fontSize: 56, fontWeight: '900' },
  seqLine: { color: COLORS.faint, fontSize: 13, textAlign: 'center' },

  // task page
  taskHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  inlineRoundTag: {
    backgroundColor: COLORS.accent,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  inlineRoundTagText: { color: '#06281F', fontSize: 12, fontWeight: '900' },
  crumb: { color: COLORS.subtle, fontSize: 14, fontWeight: '700' },
  recPill: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: COLORS.danger },
  recDotOff: { backgroundColor: COLORS.faint },
  recText: { color: COLORS.danger, fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  recTextOff: { color: COLORS.faint },
  taskBody: { paddingHorizontal: 18, paddingBottom: 20, gap: 14 },
  picture: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: 16,
    backgroundColor: COLORS.card,
  },
  taskType: { color: COLORS.accent2, fontSize: 13, fontWeight: '800', letterSpacing: 1 },
  promptCard: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    padding: 18,
    gap: 10,
  },
  promptLine: { color: COLORS.text, fontSize: 18, lineHeight: 26, fontWeight: '600' },
  promptIntro: { color: COLORS.subtle, fontSize: 15, fontWeight: '500' },

  navBar: { flexDirection: 'row', gap: 12, paddingHorizontal: 18 },
  navBtn: {
    flex: 1,
    minHeight: 56,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  navBtnDisabled: { opacity: 0.4 },
  navText: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  navTextDisabled: { color: COLORS.faint },
  navNext: { flex: 2, backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  navNextText: { color: '#06281F', fontSize: 17, fontWeight: '800' },
  endStrip: { minHeight: MIN_TAP, alignItems: 'center', justifyContent: 'center' },
  endStripText: { color: COLORS.faint, fontSize: 13 },

  // shared
  inputGroup: { gap: 4 },
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
  existingScroll: { marginTop: 4, flexDirection: 'row' },
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
  roundButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  roundBtn: {
    minWidth: 44,
    height: 38,
    borderRadius: 8,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundBtnActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  roundBtnText: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
  roundBtnTextActive: { color: '#06281F' },
  permLine: { fontSize: 13, marginTop: 4 },
  primary: {
    minHeight: 56,
    minWidth: 220,
    backgroundColor: COLORS.accent,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
    paddingHorizontal: 24,
  },
  primaryText: { color: '#06281F', fontSize: 17, fontWeight: '800' },
  ghost: { minHeight: MIN_TAP, alignItems: 'center', justifyContent: 'center' },
  ghostText: { color: COLORS.faint, fontSize: 15 },
});
