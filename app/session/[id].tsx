import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { COLORS, MIN_TAP } from '@/lib/theme';
import { loadRuns } from '@/lib/storage';
import { buildEvents, type SessionEvent } from '@/lib/events';
import { PROTOCOL_LABEL, type Run } from '@/lib/types';

const ms = (iso: string) => new Date(iso).getTime();

// +mm:ss.mmm offset from the video start (negative clamps to 0).
function fmtOffset(offsetMs: number): string {
  const clamped = Math.max(0, offsetMs);
  const m = Math.floor(clamped / 60000);
  const s = Math.floor((clamped % 60000) / 1000);
  const millis = clamped % 1000;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

function eventColor(type: string): string {
  if (type === 'tap_response') return COLORS.accent;
  if (type.startsWith('flash')) return COLORS.ok;
  if (type.includes('move')) return COLORS.ok;
  return COLORS.subtle;
}

function detail(e: SessionEvent): string {
  const bits: string[] = [];
  if (e.repetition != null) bits.push(`rep ${e.repetition}`);
  if (e.direction) bits.push(e.direction);
  if (e.rep != null) bits.push(`rep ${e.rep}`);
  if (e.reactionTimeMs != null) bits.push(`RT ${e.reactionTimeMs} ms`);
  return bits.join(' · ');
}

export default function SessionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [run, setRun] = useState<Run | null>(null);

  useFocusEffect(
    useCallback(() => {
      loadRuns().then((runs) => setRun(runs.find((r) => r.run_id === id) ?? null));
    }, [id]),
  );

  const player = useVideoPlayer(run?.video_uri ?? null, (p) => {
    p.pause();
  });

  if (!run) {
    return (
      <SafeAreaView style={styles.screen}>
        <Header onBack={() => router.back()} title="Session" />
        <Text style={styles.empty}>Loading…</Text>
      </SafeAreaView>
    );
  }

  const events = buildEvents(run);
  // t=0 is when recording started; fall back to run start if unknown.
  const videoStart = ms(run.video_started_at ?? run.timestamp);

  const seekTo = (offsetMs: number) => {
    if (!run.video_uri) return;
    player.currentTime = Math.max(0, offsetMs / 1000);
    player.play();
  };

  return (
    <SafeAreaView style={styles.screen}>
      <Header onBack={() => router.back()} title={PROTOCOL_LABEL[run.protocol]} />

      {run.video_uri ? (
        <VideoView style={styles.video} player={player} nativeControls contentFit="contain" />
      ) : (
        <View style={[styles.video, styles.noVideo]}>
          <Text style={styles.empty}>No video recorded for this session.</Text>
        </View>
      )}

      <View style={styles.metaRow}>
        <Text style={styles.meta}>{new Date(run.timestamp).toLocaleString()}</Text>
        <Text style={[styles.meta, { color: run.completed ? COLORS.ok : COLORS.danger }]}>
          {run.completed ? 'Complete' : 'Partial'}
        </Text>
      </View>
      {!!run.participant_id && <Text style={styles.tag}>Participant: {run.participant_id}</Text>}
      {!!run.tag && <Text style={styles.tag}>Tag: {run.tag}</Text>}
      <Text style={styles.hint}>
        {run.video_uri ? 'Tap any event to jump the video to that moment.' : 'Event timeline:'}
      </Text>

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {events.map((e, i) => {
          const offset = ms(e.timestamp) - videoStart;
          return (
            <Pressable key={i} style={styles.row} onPress={() => seekTo(offset)} disabled={!run.video_uri}>
              <Text style={styles.rowTime}>{fmtOffset(offset)}</Text>
              <View style={styles.rowBody}>
                <Text style={[styles.rowType, { color: eventColor(e.type) }]}>{e.type}</Text>
                {!!detail(e) && <Text style={styles.rowDetail}>{detail(e)}</Text>}
              </View>
              <Text style={styles.rowAbs}>{new Date(e.timestamp).toLocaleTimeString([], { hour12: false })}</Text>
            </Pressable>
          );
        })}
        {events.length === 0 && <Text style={styles.empty}>No events.</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}

function Header({ onBack, title }: { onBack: () => void; title: string }) {
  return (
    <View style={styles.header}>
      <Pressable style={styles.back} onPress={onBack} hitSlop={12}>
        <Text style={styles.backText}>‹ Back</Text>
      </Pressable>
      <Text style={styles.title}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  header: { paddingHorizontal: 16, paddingTop: 4 },
  back: { minHeight: MIN_TAP, justifyContent: 'center' },
  backText: { color: COLORS.accent, fontSize: 16 },
  title: { color: COLORS.text, fontSize: 22, fontWeight: '800', paddingHorizontal: 8 },
  video: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000' },
  noVideo: { alignItems: 'center', justifyContent: 'center' },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 12 },
  meta: { color: COLORS.subtle, fontSize: 13 },
  tag: { color: COLORS.subtle, fontSize: 13, paddingHorizontal: 20, paddingTop: 4 },
  hint: { color: COLORS.faint, fontSize: 12, paddingHorizontal: 20, paddingVertical: 8 },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 16, paddingBottom: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.cardBorder,
  },
  rowTime: { color: COLORS.text, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'], width: 86 },
  rowBody: { flex: 1 },
  rowType: { fontSize: 14, fontWeight: '700' },
  rowDetail: { color: COLORS.subtle, fontSize: 12, marginTop: 1 },
  rowAbs: { color: COLORS.faint, fontSize: 11, fontVariant: ['tabular-nums'] },
  empty: { color: COLORS.faint, fontSize: 14, padding: 20 },
});
