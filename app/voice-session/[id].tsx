import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { COLORS, MIN_TAP } from '@/lib/theme';
import { TASK_TYPE_LABEL } from '@/lib/voiceTasks';
import { loadVoiceSessions, shareVoiceAudio, voiceSessionJsonPath, voiceSessionsIndexPath } from '@/lib/voiceStorage';
import type { VoiceRoundLog, VoiceSession, VoiceTaskLog } from '@/lib/voiceTypes';

function fmt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : 'not saved';
}

function fmtClock(iso: string | null): string {
  return iso ? new Date(iso).toLocaleTimeString([], { hour12: false }) : '--:--:--';
}

function fmtOffset(ms: number | null): string {
  if (ms === null) return '--:--.---';
  const clamped = Math.max(0, Math.round(ms));
  const minutes = Math.floor(clamped / 60000);
  const seconds = Math.floor((clamped % 60000) / 1000);
  const millis = clamped % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

function taskStatus(task: VoiceTaskLog): 'complete' | 'partial' {
  return task.visits.length > 0 && task.visits.every((visit) => visit.shownAt && visit.leftAt) ? 'complete' : 'partial';
}

function RoundBlock({ round }: { round: VoiceRoundLog }) {
  const eventCount = round.pageEvents.length;
  return (
    <View style={styles.roundBlock}>
      <View style={styles.roundHead}>
        <View>
          <Text style={styles.roundTitle}>Round {round.round} · {round.groupId ?? `G${round.group}`}</Text>
          <Text style={styles.roundMeta}>{round.tasks.length} tasks · {eventCount} events</Text>
        </View>
        <Text style={styles.roundGroup}>G{round.group}</Text>
      </View>

      {round.tasks.map((task) => (
        <TaskRow key={`${round.round}-${task.taskId}`} task={task} />
      ))}
    </View>
  );
}

function TaskRow({ task }: { task: VoiceTaskLog }) {
  const status = taskStatus(task);
  const latestVisit = task.visits[task.visits.length - 1];
  const firstLine = task.promptLines.find((line) => line.trim()) ?? 'No prompt text';

  return (
    <View style={styles.taskRow}>
      <View style={styles.taskTop}>
        <View style={styles.taskIdPill}>
          <Text style={styles.taskIdText}>{task.taskId}</Text>
        </View>
        <View style={styles.taskMain}>
          <Text style={styles.taskType}>{TASK_TYPE_LABEL[task.type]}</Text>
          <Text style={styles.taskPrompt} numberOfLines={2}>{firstLine}</Text>
        </View>
        <Text style={[styles.taskStatus, { color: status === 'complete' ? COLORS.ok : COLORS.danger }]}>
          {status === 'complete' ? 'Complete' : 'Partial'}
        </Text>
      </View>

      <View style={styles.taskMetaGrid}>
        <Text style={styles.taskMeta}>Shown {fmtClock(task.shownAt)}</Text>
        <Text style={styles.taskMeta}>Left {fmtClock(task.leftAt)}</Text>
        <Text style={styles.taskMeta}>Audio {fmtOffset(task.shownAtAudioMs)} → {fmtOffset(task.leftAtAudioMs)}</Text>
        <Text style={styles.taskMeta}>Visits {task.visits.length}</Text>
      </View>

      {latestVisit && (
        <Text style={styles.visitLine}>
          Last visit: {latestVisit.recordingState} · {latestVisit.leaveDirection ?? 'open'} · {fmtOffset(latestVisit.shownAtAudioMs)} → {fmtOffset(latestVisit.leftAtAudioMs)}
        </Text>
      )}
    </View>
  );
}

export default function VoiceSessionJson() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const router = useRouter();
  const [session, setSession] = useState<VoiceSession | null | undefined>(undefined);
  const [loadInfo, setLoadInfo] = useState<{ count: number; error: string | null }>({ count: 0, error: null });
  const [previewing, setPreviewing] = useState(false);
  const audioPlayerRef = useRef<AudioPlayer | null>(null);

  const stopPreview = useCallback(() => {
    const player = audioPlayerRef.current;
    if (player) {
      try {
        player.pause();
        player.remove();
      } catch {
        // Best-effort cleanup only.
      }
    }
    audioPlayerRef.current = null;
    setPreviewing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      setSession(undefined);
      loadVoiceSessions()
        .then((sessions) => {
          setLoadInfo({ count: sessions.length, error: null });
          setSession(sessions.find((s) => (s.session_id || s.started_at) === id) ?? null);
        })
        .catch((e) => {
          setLoadInfo({ count: 0, error: String(e) });
          setSession(null);
        });
    }, [id]),
  );

  useEffect(() => stopPreview, [stopPreview]);

  const previewAudio = async () => {
    if (!session?.audioUri) return;
    if (previewing) {
      stopPreview();
      return;
    }

    stopPreview();
    try {
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      const player = createAudioPlayer(session.audioUri, { keepAudioSessionActive: true });
      audioPlayerRef.current = player;
      setPreviewing(true);
      player.play();
    } catch (e) {
      stopPreview();
      Alert.alert('Preview failed', String(e));
    }
  };

  const json = useMemo(() => (session ? JSON.stringify(session, null, 2) : ''), [session]);
  const totalTasks = session?.rounds.filter(Boolean).reduce((sum, round) => sum + round!.tasks.length, 0) ?? 0;
  const totalEvents = session?.rounds.filter(Boolean).reduce((sum, round) => sum + round!.pageEvents.length, 0) ?? 0;

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable style={styles.back} onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.backText}>‹ Back</Text>
        </Pressable>
        <Text style={styles.title}>Voice Session JSON</Text>
      </View>

      {session === undefined ? (
        <Text style={styles.empty}>Loading…</Text>
      ) : session === null ? (
        <View style={styles.messageCard}>
          <Text style={styles.messageTitle}>Voice session not found</Text>
          <Text style={styles.messageText}>Route id: {id ?? 'missing'}</Text>
          <Text style={styles.messageText}>Voice sessions stored in app: {loadInfo.count}</Text>
          {!!loadInfo.error && <Text style={styles.messageText}>Load error: {loadInfo.error}</Text>}
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.summary}>
            <View style={styles.summaryTop}>
              <Text style={styles.summaryTitle}>Participant {session.participant}</Text>
              <Text style={[styles.status, { color: session.completed ? COLORS.ok : COLORS.danger }]}>
                {session.completed ? 'Complete' : 'Partial'}
              </Text>
            </View>
            <Text style={styles.meta}>Started: {fmt(session.started_at)}</Text>
            <Text style={styles.meta}>Ended: {fmt(session.ended_at)}</Text>
            <Text style={styles.meta}>Groups: {session.group_sequence.join(', ')}</Text>
            <Text style={styles.meta}>Rounds: {session.rounds.filter(Boolean).length} · Tasks: {totalTasks} · Events: {totalEvents}</Text>
            <Text style={styles.meta}>Audio: {session.audioUri ?? 'none'}</Text>
            <Text style={styles.meta}>JSON: {session.jsonUri ?? voiceSessionJsonPath(session)}</Text>
            <Text style={styles.meta}>All voice JSON: {voiceSessionsIndexPath()}</Text>
          </View>

          <View style={styles.mediaBlock}>
            <Text style={styles.mediaTitle}>Audio Preview</Text>
            {session.audioUri ? (
              <>
                <Text style={styles.meta} numberOfLines={2}>{session.audioUri}</Text>
                <View style={styles.mediaActions}>
                  <Pressable style={[styles.mediaBtn, previewing && styles.activeMediaBtn]} onPress={previewAudio}>
                    <Text style={styles.mediaBtnText}>{previewing ? 'Stop preview' : 'Preview audio'}</Text>
                  </Pressable>
                  <Pressable
                    style={styles.mediaBtn}
                    onPress={() => shareVoiceAudio(session.audioUri!).catch((e) => Alert.alert('Share failed', String(e)))}>
                    <Text style={styles.mediaBtnText}>Share audio</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <Text style={styles.emptyInline}>No audio file saved for this voice session.</Text>
            )}
          </View>

          {session.rounds.filter(Boolean).map((round) => (
            <RoundBlock key={`${round.round}-${round.group}`} round={round} />
          ))}

          <Text style={styles.sectionLabel}>SESSION.JSON</Text>
          <View style={styles.jsonWrap}>
            <Text style={styles.jsonStats}>{json.length} characters · stored in app session record</Text>
            <Text selectable style={styles.jsonText}>{json}</Text>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  header: { paddingHorizontal: 16, paddingTop: 4 },
  back: { minHeight: MIN_TAP, justifyContent: 'center' },
  backText: { color: COLORS.accent, fontSize: 16 },
  title: { color: COLORS.text, fontSize: 22, fontWeight: '800', paddingHorizontal: 8 },
  content: { paddingHorizontal: 16, paddingBottom: 32, gap: 12 },
  summary: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    padding: 14,
    gap: 6,
  },
  summaryTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  summaryTitle: { color: COLORS.text, fontSize: 18, fontWeight: '800' },
  status: { fontSize: 12, fontWeight: '800' },
  meta: { color: COLORS.subtle, fontSize: 12, lineHeight: 18 },
  mediaBlock: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    padding: 14,
    gap: 10,
  },
  mediaTitle: { color: COLORS.text, fontSize: 16, fontWeight: '800' },
  mediaActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  mediaBtn: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    justifyContent: 'center',
  },
  activeMediaBtn: { borderColor: COLORS.accent, backgroundColor: 'rgba(100, 255, 218, 0.08)' },
  mediaBtnText: { color: COLORS.accent, fontSize: 13, fontWeight: '700' },
  sectionLabel: { color: COLORS.faint, fontSize: 12, fontWeight: '800', letterSpacing: 1.5, marginTop: 4 },
  roundBlock: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    padding: 12,
    gap: 10,
  },
  roundHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  roundTitle: { color: COLORS.text, fontSize: 17, fontWeight: '800' },
  roundMeta: { color: COLORS.faint, fontSize: 12, marginTop: 2 },
  roundGroup: { color: COLORS.accent2, fontSize: 13, fontWeight: '800' },
  taskRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.cardBorder,
    paddingTop: 10,
    gap: 7,
  },
  taskTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  taskIdPill: {
    minWidth: 38,
    minHeight: 30,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskIdText: { color: COLORS.text, fontSize: 12, fontWeight: '800' },
  taskMain: { flex: 1, gap: 2 },
  taskType: { color: COLORS.accent2, fontSize: 12, fontWeight: '800' },
  taskPrompt: { color: COLORS.subtle, fontSize: 12, lineHeight: 17 },
  taskStatus: { fontSize: 11, fontWeight: '800', paddingTop: 2 },
  taskMetaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  taskMeta: { color: COLORS.faint, fontSize: 11, fontVariant: ['tabular-nums'] },
  visitLine: { color: COLORS.faint, fontSize: 11, lineHeight: 15 },
  jsonWrap: {
    backgroundColor: '#08110F',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    padding: 12,
  },
  jsonStats: { color: COLORS.faint, fontSize: 11, marginBottom: 10 },
  jsonText: {
    color: COLORS.text,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: 'Courier New',
  },
  messageCard: { margin: 16, padding: 16, borderRadius: 12, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.cardBorder, gap: 8 },
  messageTitle: { color: COLORS.text, fontSize: 17, fontWeight: '800' },
  messageText: { color: COLORS.subtle, fontSize: 13, lineHeight: 18 },
  empty: { color: COLORS.faint, fontSize: 14, padding: 20 },
  emptyInline: { color: COLORS.faint, fontSize: 13, lineHeight: 18 },
});
