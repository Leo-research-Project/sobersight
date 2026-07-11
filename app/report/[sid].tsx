import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { COLORS, MIN_TAP } from '@/lib/theme';
import { loadRuns, shareVideo } from '@/lib/storage';
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

// One protocol block: its video + event timeline. Own video player (hooks can't
// run in a loop, so each protocol is its own component).
function ProtocolBlock({ run }: { run: Run }) {
  const player = useVideoPlayer(run.video_uri ?? null, (p) => p.pause());
  const events = buildEvents(run);
  const videoStart = ms(run.video_started_at ?? run.timestamp);
  const json = JSON.stringify(run, null, 2);

  const seekTo = (offsetMs: number) => {
    if (!run.video_uri) return;
    player.currentTime = Math.max(0, offsetMs / 1000);
    player.play();
  };

  return (
    <View style={styles.block}>
      <View style={styles.blockHead}>
        <Text style={styles.blockTitle}>{PROTOCOL_LABEL[run.protocol]}</Text>
        <Text style={[styles.blockStatus, { color: run.completed ? COLORS.ok : COLORS.danger }]}>
          {run.completed ? 'Complete' : 'Partial'}
        </Text>
      </View>

      {run.video_uri ? (
        <>
          <VideoView style={styles.video} player={player} nativeControls contentFit="contain" />
          <View style={styles.mediaActions}>
            <Pressable
              style={styles.mediaBtn}
              onPress={() => shareVideo(run.video_uri!).catch((e) => Alert.alert('Share failed', String(e)))}>
              <Text style={styles.mediaBtnText}>Share video</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <View style={[styles.video, styles.noVideo]}>
          <Text style={styles.empty}>No video recorded.</Text>
        </View>
      )}

      <Text style={styles.hint}>
        {run.video_uri ? 'Tap any event to jump the video to that moment.' : 'Event timeline:'}
      </Text>

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

      <Text style={styles.sectionLabel}>RUN JSON</Text>
      <View style={styles.jsonWrap}>
        <Text style={styles.jsonStats}>{json.length} characters · stored in app session record</Text>
        <Text selectable style={styles.jsonText}>{json}</Text>
      </View>
    </View>
  );
}

export default function SessionReport() {
  const { sid } = useLocalSearchParams<{ sid: string }>();
  const router = useRouter();
  const [runs, setRuns] = useState<Run[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      loadRuns().then((all) => {
        const group = all.filter((r) => (r.session_id || r.run_id) === sid);
        group.sort((a, b) => (a.session_index ?? 0) - (b.session_index ?? 0));
        setRuns(group);
      });
    }, [sid]),
  );

  const startedAt = runs?.[0]?.session_started_at ?? runs?.[0]?.timestamp;
  const participantId = runs?.[0]?.participant_id;
  const tag = runs?.[0]?.tag;

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable style={styles.back} onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.backText}>‹ Back</Text>
        </Pressable>
        <Text style={styles.title}>Session Report</Text>
      </View>

      {!runs ? (
        <Text style={styles.empty}>Loading…</Text>
      ) : runs.length === 0 ? (
        <Text style={styles.empty}>Session not found.</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          <View style={styles.metaRow}>
            <Text style={styles.meta}>{startedAt ? new Date(startedAt).toLocaleString() : ''}</Text>
            <Text style={styles.meta}>{runs.length} test{runs.length === 1 ? '' : 's'}</Text>
          </View>
          {!!participantId && <Text style={styles.tag}>Participant: {participantId}</Text>}
          {!!tag && <Text style={styles.tag}>Tag: {tag}</Text>}

          {runs.map((r) => (
            <ProtocolBlock key={r.run_id} run={r} />
          ))}
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
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4, paddingTop: 4 },
  meta: { color: COLORS.subtle, fontSize: 13 },
  tag: { color: COLORS.subtle, fontSize: 13, paddingTop: 4 },
  list: { paddingHorizontal: 16, paddingBottom: 32, gap: 8 },
  block: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 12,
    marginTop: 12,
  },
  blockHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  blockTitle: { color: COLORS.text, fontSize: 18, fontWeight: '800' },
  blockStatus: { fontSize: 12, fontWeight: '700' },
  video: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000', borderRadius: 8 },
  noVideo: { alignItems: 'center', justifyContent: 'center' },
  mediaActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 },
  mediaBtn: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    justifyContent: 'center',
  },
  mediaBtnText: { color: COLORS.accent, fontSize: 13, fontWeight: '700' },
  hint: { color: COLORS.faint, fontSize: 12, paddingVertical: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.cardBorder,
  },
  rowTime: { color: COLORS.text, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'], width: 86 },
  rowBody: { flex: 1 },
  rowType: { fontSize: 14, fontWeight: '700' },
  rowDetail: { color: COLORS.subtle, fontSize: 12, marginTop: 1 },
  rowAbs: { color: COLORS.faint, fontSize: 11, fontVariant: ['tabular-nums'] },
  sectionLabel: { color: COLORS.faint, fontSize: 12, fontWeight: '800', letterSpacing: 1.5, marginTop: 14 },
  jsonWrap: {
    backgroundColor: '#08110F',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    padding: 12,
    marginTop: 8,
  },
  jsonStats: { color: COLORS.faint, fontSize: 11, marginBottom: 10 },
  jsonText: {
    color: COLORS.text,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: 'Courier New',
  },
  empty: { color: COLORS.faint, fontSize: 14, padding: 20 },
});
