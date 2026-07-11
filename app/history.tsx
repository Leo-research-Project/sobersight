import { useCallback, useState, useEffect } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View, Platform, AppState } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { COLORS, MIN_TAP } from '@/lib/theme';
import * as IntentLauncher from 'expo-intent-launcher';
import { clearRuns, exportRuns, loadRuns } from '@/lib/storage';
import {
  clearVoiceSessions,
  exportVoiceSessions,
  loadVoiceSessions,
} from '@/lib/voiceStorage';
import { clearParticipantRegistry } from '@/lib/participantRegistry';
import { PROTOCOL_LABEL, type Run } from '@/lib/types';
import type { VoiceSession } from '@/lib/voiceTypes';
import * as FileSystem from 'expo-file-system/legacy';

function fmt(iso: string): string {
  return new Date(iso).toLocaleString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

interface Session { sessionId: string; startedAt: string; participantId?: string; tag: string; runs: Run[]; }
type HistoryTab = 'voice' | 'eye';

// Group runs into sessions (newest first), protocols ordered within each.
function groupSessions(runs: Run[]): Session[] {
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

export default function History() {
  const router = useRouter();
  const [runs, setRuns] = useState<Run[]>([]);
  const [voice, setVoice] = useState<VoiceSession[]>([]);
  const [activeTab, setActiveTab] = useState<HistoryTab>('voice');
  const [hasStorageAccess, setHasStorageAccess] = useState(true); // default true to avoid flicker on iOS

  const checkStorageAccess = async () => {
    if (Platform.OS !== 'android') return;
    try {
      const RNFS = require('react-native-fs');
      const testDir = `${RNFS.ExternalStorageDirectoryPath}/Documents/SoberSight`;
      const testFile = `${testDir}/.test_access`;
      await RNFS.mkdir(testDir);
      await RNFS.writeFile(testFile, 'test', 'utf8');
      await RNFS.unlink(testFile);
      setHasStorageAccess(true);
    } catch (e) {
      setHasStorageAccess(false);
    }
  };

  const refresh = useCallback(() => {
    loadRuns().then(setRuns);
    loadVoiceSessions().then(setVoice);
    checkStorageAccess();
  }, []);
  useFocusEffect(refresh);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') checkStorageAccess();
    });
    return () => sub.remove();
  }, []);

  const onExport = async () => {
    try {
      if (runs.length) await exportRuns();
      if (voice.length) await exportVoiceSessions();
    } catch (e) {
      Alert.alert('Export failed', String(e));
    }
  };

  const onClear = () => {
    Alert.alert('Delete all sessions?', 'Deletes eye-tracking and voice sessions. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => { await clearRuns(); await clearVoiceSessions(); await clearParticipantRegistry(); refresh(); },
      },
    ]);
  };

  const onGrantStorage = async () => {
    try {
      if (Platform.OS === 'android') {
        await IntentLauncher.startActivityAsync('android.settings.MANAGE_APP_ALL_FILES_ACCESS_PERMISSION', {
          data: 'package:com.ESC.sobersight',
        });
      }
    } catch (e) {
      Alert.alert('Error', 'Could not open settings.');
    }
  };

  const empty = runs.length === 0 && voice.length === 0;
  const visibleEyeSessions = groupSessions(runs);
  const tabEmpty = activeTab === 'voice' ? voice.length === 0 : visibleEyeSessions.length === 0;

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable style={styles.back} onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.backText}>‹ Back</Text>
        </Pressable>
        <Text style={styles.title}>Session History</Text>
      </View>

      <View style={styles.actions}>
        <Pressable style={styles.primary} onPress={onExport} disabled={empty}>
          <Text style={styles.primaryText}>Export all (JSON)</Text>
        </Pressable>
        <Pressable style={styles.danger} onPress={onClear} disabled={empty}>
          <Text style={styles.dangerText}>Delete all</Text>
        </Pressable>
      </View>

      {Platform.OS === 'android' && !hasStorageAccess && (
        <View style={[styles.actions, { paddingTop: 0 }]}>
          <Pressable style={[styles.primary, { flex: 1, backgroundColor: COLORS.accent2 }]} onPress={onGrantStorage}>
            <Text style={[styles.primaryText, { color: '#000' }]}>Grant Android Storage Permission</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.tabs}>
        <Pressable
          style={[styles.tab, activeTab === 'voice' && styles.activeTab]}
          onPress={() => setActiveTab('voice')}>
          <Text style={[styles.tabText, activeTab === 'voice' && styles.activeTabText]}>Voice Command</Text>
          <Text style={[styles.tabCount, activeTab === 'voice' && styles.activeTabText]}>{voice.length}</Text>
        </Pressable>
        <Pressable
          style={[styles.tab, activeTab === 'eye' && styles.activeTab]}
          onPress={() => setActiveTab('eye')}>
          <Text style={[styles.tabText, activeTab === 'eye' && styles.activeTabText]}>Eye Tracking</Text>
          <Text style={[styles.tabCount, activeTab === 'eye' && styles.activeTabText]}>{visibleEyeSessions.length}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        {empty && <Text style={styles.empty}>No sessions recorded.</Text>}
        {!empty && tabEmpty && (
          <Text style={styles.empty}>
            No {activeTab === 'voice' ? 'voice command' : 'eye-tracking'} sessions recorded.
          </Text>
        )}

        {activeTab === 'voice' && voice.map((v) => (
          <Pressable
            key={v.session_id || v.started_at}
            style={styles.sessionCard}
            onPress={() => router.push(`/voice-session/${v.session_id || v.started_at}` as any)}>
            <View style={styles.cardTop}>
              <Text style={styles.cardDate}>{fmt(v.started_at)}</Text>
              <Text style={styles.sessionCount}>{v.rounds.filter(Boolean).length}/10 rounds</Text>
            </View>
            <Text style={styles.cardMeta}>
              Participant {v.participant} · groups {v.group_sequence.join(', ')}
            </Text>
            <Text style={styles.cardMeta}>{v.audioUri ? 'Audio saved' : 'No audio'} · JSON detail available</Text>
            {v.rounds.filter(Boolean).map((r) => (
              <View key={`${r.round}-${r.group}`} style={styles.protoRow}>
                <View style={styles.protoMain}>
                  <Text style={styles.cardProtocol}>Round {r.round} · Group {r.group}</Text>
                  <Text style={styles.protoMeta}>
                    {r.tasks.length} tasks · logged to session audio
                  </Text>
                </View>
              </View>
            ))}
            <Text style={[styles.cardStatus, { color: v.completed ? COLORS.ok : COLORS.danger, marginTop: 6 }]}>
              {v.completed ? 'Complete' : 'Partial'}
            </Text>
            <Text style={styles.openHint}>Tap to open audio preview and JSON ›</Text>
          </Pressable>
        ))}

        {activeTab === 'eye' && visibleEyeSessions.map((s) => (
          <Pressable
            key={s.sessionId}
            style={styles.sessionCard}
            onPress={() => router.push(`/report/${s.sessionId}` as any)}>
            <View style={styles.cardTop}>
              <Text style={styles.cardDate}>{fmt(s.startedAt)}</Text>
              <Text style={styles.sessionCount}>{s.runs.length} test{s.runs.length === 1 ? '' : 's'}</Text>
            </View>
            {!!s.participantId && <Text style={styles.cardMeta}>Participant {s.participantId}</Text>}
            {!!s.tag && <Text style={styles.cardMeta}>Tag: {s.tag}</Text>}

            {s.runs.map((r) => (
              <View key={r.run_id} style={styles.protoRow}>
                <View style={styles.protoMain}>
                  <Text style={styles.cardProtocol}>{PROTOCOL_LABEL[r.protocol]}</Text>
                  <Text style={styles.protoMeta}>
                    {r.trials.length} trials{r.video_uri ? ' · 🎥' : ' · no video'}
                  </Text>
                </View>
                <Text style={[styles.cardStatus, { color: r.completed ? COLORS.ok : COLORS.danger }]}>
                  {r.completed ? 'Complete' : 'Partial'}
                </Text>
              </View>
            ))}
            <Text style={styles.openHint}>Tap to open video preview and JSON ›</Text>
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  header: { paddingHorizontal: 16, paddingTop: 8 },
  back: { minHeight: MIN_TAP, justifyContent: 'center' },
  backText: { color: COLORS.accent, fontSize: 16 },
  title: { color: COLORS.text, fontSize: 26, fontWeight: '800', paddingHorizontal: 8 },
  actions: { flexDirection: 'row', gap: 12, paddingHorizontal: 24, paddingVertical: 12 },
  tabs: { flexDirection: 'row', gap: 10, paddingHorizontal: 24, paddingBottom: 12 },
  tab: {
    flex: 1,
    minHeight: 64,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    backgroundColor: COLORS.card,
    paddingHorizontal: 14,
    justifyContent: 'center',
    gap: 3,
  },
  activeTab: { borderColor: COLORS.accent, backgroundColor: 'rgba(100, 255, 218, 0.08)' },
  tabText: { color: COLORS.subtle, fontSize: 15, fontWeight: '800' },
  tabCount: { color: COLORS.faint, fontSize: 12, fontWeight: '700' },
  activeTabText: { color: COLORS.accent },
  primary: {
    flex: 1,
    minHeight: MIN_TAP,
    backgroundColor: COLORS.accent,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { color: COLORS.bg, fontSize: 15, fontWeight: '700' },
  danger: {
    minHeight: MIN_TAP,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: COLORS.danger,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dangerText: { color: COLORS.danger, fontSize: 15, fontWeight: '600' },
  list: { paddingHorizontal: 24, paddingBottom: 32, gap: 12 },
  empty: { color: COLORS.faint, fontSize: 14 },
  sectionLabel: { color: COLORS.faint, fontSize: 12, fontWeight: '800', letterSpacing: 1.5, marginTop: 8 },
  sessionCard: { backgroundColor: COLORS.card, borderRadius: 12, padding: 16, gap: 6 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sessionCount: { color: COLORS.accent2, fontSize: 12, fontWeight: '700' },
  cardProtocol: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  cardStatus: { fontSize: 12, fontWeight: '700' },
  cardDate: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  cardMeta: { color: COLORS.faint, fontSize: 13 },
  protoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.cardBorder,
  },
  protoMain: { flex: 1 },
  protoMeta: { color: COLORS.faint, fontSize: 12, marginTop: 2 },
  openHint: { color: COLORS.faint, fontSize: 12, marginTop: 6 },
});
