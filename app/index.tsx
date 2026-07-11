import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { COLORS, MIN_TAP } from '@/lib/theme';
import { loadRuns } from '@/lib/storage';
import { PROTOCOL_LABEL, type Run } from '@/lib/types';

function fmt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Group runs into sessions (newest first), ordered protocols within each.
function groupSessions(runs: Run[]): { sessionId: string; startedAt: string; participantId?: string; tag: string; runs: Run[] }[] {
  const map = new Map<string, Run[]>();
  for (const r of runs) {
    const key = r.session_id || r.run_id; // legacy runs have no session_id
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  }
  return [...map.entries()]
    .map(([sessionId, rs]) => {
      const ordered = [...rs].sort((a, b) => (a.session_index ?? 0) - (b.session_index ?? 0));
      return {
        sessionId,
        startedAt: ordered[0].session_started_at || ordered[0].timestamp,
        participantId: ordered[0].participant_id,
        tag: ordered[0].tag,
        runs: ordered,
      };
    })
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
}

export default function Home() {
  const router = useRouter();
  const [runs, setRuns] = useState<Run[]>([]);

  useFocusEffect(
    useCallback(() => {
      loadRuns().then(setRuns);
    }, []),
  );

  const sessions = groupSessions(runs).slice(0, 4);

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.brand}>Sober Sight</Text>
        <Text style={styles.subtitle}>Eye-tracking data collection</Text>

        <Pressable style={styles.runBtn} onPress={() => router.push('/run' as any)}>
          <Text style={styles.runBtnText}>Start Session</Text>
          <Text style={styles.runBtnSub}>PLR → Horizontal gaze</Text>
        </Pressable>

        <Pressable style={styles.voiceBtn} onPress={() => router.push('/voice' as any)}>
          <Text style={styles.voiceBtnText}>Start In-Vehicle Voice Command Task</Text>
          <Text style={styles.voiceBtnSub}>10 rounds · in-vehicle spoken commands</Text>
        </Pressable>

        <Pressable style={styles.historyBtn} onPress={() => router.push('/history')}>
          <Text style={styles.historyBtnText}>Session History</Text>
        </Pressable>

        <Text style={styles.sectionTitle}>Recent</Text>
        {sessions.length === 0 && <Text style={styles.empty}>No sessions yet.</Text>}

        {sessions.map((s) => (
          <View key={s.sessionId} style={styles.group}>
            <Text style={styles.groupTitle}>
              {fmt(s.startedAt)}{s.participantId ? ` · Participant ${s.participantId}` : ''}{s.tag ? ` · ${s.tag}` : ''}
            </Text>
            {s.runs.map((r) => (
              <View key={r.run_id} style={styles.row}>
                <Text style={styles.rowProtocol}>{PROTOCOL_LABEL[r.protocol]}</Text>
                <Text style={[styles.rowStatus, { color: r.completed ? COLORS.ok : COLORS.danger }]}>
                  {r.completed ? 'Complete' : 'Partial'}
                </Text>
              </View>
            ))}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  content: { padding: 24, gap: 12 },
  brand: { color: COLORS.text, fontSize: 32, fontWeight: '800' },
  subtitle: { color: COLORS.subtle, fontSize: 15, marginBottom: 12 },
  runBtn: {
    minHeight: 64,
    backgroundColor: COLORS.accent,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  runBtnText: { color: '#06281F', fontSize: 18, fontWeight: '800' },
  runBtnSub: { color: '#06281F', fontSize: 12, fontWeight: '600', opacity: 0.75 },
  voiceBtn: {
    minHeight: 64,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.accent2,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    marginTop: 4,
  },
  voiceBtnText: { color: COLORS.text, fontSize: 17, fontWeight: '800' },
  voiceBtnSub: { color: COLORS.subtle, fontSize: 12, fontWeight: '600' },
  historyBtn: {
    minHeight: MIN_TAP,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  historyBtnText: { color: COLORS.text, fontSize: 16, fontWeight: '600' },
  sectionTitle: { color: COLORS.text, fontSize: 18, fontWeight: '700', marginTop: 16 },
  empty: { color: COLORS.faint, fontSize: 14 },
  group: { gap: 6 },
  groupTitle: { color: COLORS.accent2, fontSize: 13, fontWeight: '700', marginTop: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: COLORS.card,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rowProtocol: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
  rowStatus: { fontSize: 12, fontWeight: '700', marginLeft: 'auto' },
});
