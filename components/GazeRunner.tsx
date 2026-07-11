import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import { useVideoPlayer, VideoView } from 'expo-video';
import { COLORS } from '@/lib/theme';
import type { GazeTrial } from '@/lib/types';

const nowISO = () => new Date().toISOString();

interface PhaseDef {
  phase: string;
  ms: number;
  title: string;
  detail: string;
  voice: string;
  dotLayout?: 'left' | 'center' | 'right';
}

function getPhases(): PhaseDef[] {
  return [
    {
      phase: 'right_eye_intro',
      ms: 5000,
      title: 'Right Eye Test',
      detail: 'Please keep your head still and move only your eyes. The right eye test will begin now.',
      voice: 'Please keep your head still and move only your eyes. The right eye test will begin now.',
    },
    // REP 1
    { phase: 'right_left_dot_1', ms: 3000, title: 'Left Dot', detail: 'Look at the left dot.', voice: 'Look at the left dot.', dotLayout: 'left' },
    { phase: 'right_center_dot_1', ms: 3000, title: 'Center Dot', detail: 'Now look up at the center dot.', voice: 'Now look up at the center dot.', dotLayout: 'center' },
    { phase: 'right_right_dot_1', ms: 3000, title: 'Right Dot', detail: 'Now look at the right dot.', voice: 'Now look at the right dot.', dotLayout: 'right' },
    { phase: 'right_inter_rep', ms: 3000, title: 'Great', detail: 'Repeat the sequence one more time.', voice: 'Great. Repeat the sequence one more time.' },
    // REP 2
    { phase: 'right_left_dot_2', ms: 3000, title: 'Left Dot', detail: 'Look at the left dot.', voice: 'Look at the left dot.', dotLayout: 'left' },
    { phase: 'right_center_dot_2', ms: 3000, title: 'Center Dot', detail: 'Now look up at the center dot.', voice: 'Now look up at the center dot.', dotLayout: 'center' },
    { phase: 'right_right_dot_2', ms: 3000, title: 'Right Dot', detail: 'Now look at the right dot.', voice: 'Now look at the right dot.', dotLayout: 'right' },
    { phase: 'right_end', ms: 3000, title: 'Right Eye Complete', detail: 'The right eye test is complete.', voice: 'The right eye test is complete.' },
    
    // LEFT EYE
    { phase: 'left_eye_intro', ms: 6000, title: 'Left Eye Test', detail: 'Now switch to your left eye. Keep your head still and move only your eyes. The left eye test will begin now.', voice: 'Now switch to your left eye. Keep your head still and move only your eyes. The left eye test will begin now.' },
    // REP 1
    { phase: 'left_right_dot_1', ms: 3000, title: 'Right Dot', detail: 'Look at the right dot.', voice: 'Look at the right dot.', dotLayout: 'right' },
    { phase: 'left_center_dot_1', ms: 3000, title: 'Center Dot', detail: 'Now look up at the center dot.', voice: 'Now look up at the center dot.', dotLayout: 'center' },
    { phase: 'left_left_dot_1', ms: 3000, title: 'Left Dot', detail: 'Now look at the left dot.', voice: 'Now look at the left dot.', dotLayout: 'left' },
    { phase: 'left_inter_rep', ms: 3000, title: 'Great', detail: 'Repeat the sequence one more time.', voice: 'Great. Repeat the sequence one more time.' },
    // REP 2
    { phase: 'left_right_dot_2', ms: 3000, title: 'Right Dot', detail: 'Look at the right dot.', voice: 'Look at the right dot.', dotLayout: 'right' },
    { phase: 'left_center_dot_2', ms: 3000, title: 'Center Dot', detail: 'Now look up at the center dot.', voice: 'Now look up at the center dot.', dotLayout: 'center' },
    { phase: 'left_left_dot_2', ms: 3000, title: 'Left Dot', detail: 'Now look at the left dot.', voice: 'Now look at the left dot.', dotLayout: 'left' },
    { phase: 'left_end', ms: 3000, title: 'Test Complete', detail: 'The left eye test is complete.', voice: 'The left eye test is complete.' },
  ];
}

interface Props {
  onDone: (trials: GazeTrial[], completed: boolean) => void;
  setCameraActive?: (active: boolean) => void;
}

export function GazeRunner({ onDone, setCameraActive }: Props) {
  const insets = useSafeAreaInsets();
  const [showGuideline, setShowGuideline] = useState(true);

  useEffect(() => {
    if (setCameraActive) {
      setCameraActive(!showGuideline);
    }
  }, [showGuideline, setCameraActive]);

  // Load the downloaded guideline video.
  const player = useVideoPlayer(require('@/assets/videos/gaze_guideline.mp4'), (p) => {
    p.loop = true;
    p.play();
  });

  const [title, setTitle] = useState('Get ready');
  const [detail, setDetail] = useState('');
  const [dotLayout, setDotLayout] = useState<'left' | 'center' | 'right' | null>(null);
  const [repLabel, setRepLabel] = useState('');
  const [remaining, setRemaining] = useState(0); // seconds, display only

  const cancelled = useRef(false);
  const doneGuard = useRef(false);
  const trialsRef = useRef<GazeTrial[]>([]);
  const timers = useRef<{ cancel: () => void }[]>([]);
  const deadline = useRef(0); // ms epoch; 0 = no countdown

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const id = setTimeout(resolve, ms);
      timers.current.push({ cancel: () => { clearTimeout(id); resolve(); } });
    });

  const speakAsync = (text: string, rate = 0.95) =>
    new Promise<void>((resolve) => {
      Speech.speak(text, {
        rate,
        onDone: () => resolve(),
        onStopped: () => resolve(),
        onError: () => resolve(),
      });
    });

  const finish = (completed: boolean) => {
    if (doneGuard.current) return;
    doneGuard.current = true;
    deadline.current = 0;
    onDone(trialsRef.current, completed);
  };

  const exit = () => {
    cancelled.current = true;
    timers.current.forEach((t) => t.cancel());
  };

  const runPhase = async (def: PhaseDef, rep: number, countdown: boolean) => {
    const trial: GazeTrial = { phase: def.phase, rep, start_time: nowISO(), end_time: null };
    trialsRef.current.push(trial);

    setTitle(def.title);
    setDetail(def.detail);
    setDotLayout(def.dotLayout ?? null);

    if (def.dotLayout) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }

    Speech.speak(def.voice, { rate: 0.95 });

    deadline.current = countdown ? Date.now() + def.ms : 0;
    await sleep(def.ms);
    trial.end_time = nowISO();
  };

  useEffect(() => {
    const id = setInterval(() => {
      if (deadline.current === 0) { setRemaining(0); return; }
      setRemaining(Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000)));
    }, 100);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (showGuideline) return;
    const activeTimers = timers.current;

    (async () => {
      setRepLabel('Test Running');

      for (const def of getPhases()) {
        if (cancelled.current) return finish(false);
        await runPhase(def, 1, true);
      }
      finish(true);
    })();

    return () => {
      cancelled.current = true;
      activeTimers.forEach((t) => t.cancel());
      Speech.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showGuideline]);

  if (showGuideline) {
    return (
      <View style={[styles.root, styles.guidelineRoot]}>
        <View style={styles.guidelineHeader}>
          <Text style={styles.guidelineTitle}>Video Guideline</Text>
          <Text style={styles.guidelineSub}>Please watch the instructions before starting.</Text>
        </View>
        <View style={styles.videoContainer}>
          <VideoView player={player} style={styles.video} contentFit="contain" />
        </View>
        <View style={[styles.guidelineFooter, { paddingBottom: insets.bottom + 20 }]}>
          <Pressable 
            style={styles.startBtn} 
            onPress={() => {
              player.pause();
              setShowGuideline(false);
            }}>
            <Text style={styles.startBtnText}>Start Test</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {/* Top bar */}
      <View style={[styles.topBar, { paddingTop: insets.top + 6 }]} pointerEvents="none">
        <Text style={styles.rec}>● REC</Text>
        <Text style={styles.repLabel}>{repLabel}</Text>
        <View style={styles.badge}><Text style={styles.badgeText}>GAZE</Text></View>
      </View>

      <View style={styles.dotsContainer} pointerEvents="none">
        {dotLayout === 'left' && <View style={[styles.dot, styles.dotLeft]} />}
        {dotLayout === 'center' && <View style={[styles.dot, styles.dotCenter]} />}
        {dotLayout === 'right' && <View style={[styles.dot, styles.dotRight]} />}
      </View>

      <View style={styles.center} pointerEvents="none">
        <Text style={styles.title}>{title}</Text>
        {!!detail && <Text style={styles.detail}>{detail}</Text>}
        {remaining > 0 && <Text style={styles.countdown}>{remaining}</Text>}
      </View>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + 10 }]} pointerEvents="box-none">
        <Pressable style={styles.endBtn} onLongPress={exit} delayLongPress={900}>
          <Text style={styles.endText}>■ Hold to End Session</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  guidelineRoot: { backgroundColor: '#000', zIndex: 10, elevation: 10 },
  guidelineHeader: { paddingTop: 60, paddingHorizontal: 20, alignItems: 'center' },
  guidelineTitle: { color: COLORS.text, fontSize: 24, fontWeight: '800' },
  guidelineSub: { color: COLORS.subtle, fontSize: 16, marginTop: 8, textAlign: 'center' },
  videoContainer: { flex: 1, marginVertical: 20 },
  video: { flex: 1 },
  guidelineFooter: { paddingHorizontal: 20 },
  startBtn: {
    backgroundColor: COLORS.accent2,
    height: 56,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startBtnText: { color: '#000', fontSize: 18, fontWeight: '700' },
  
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 18,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  rec: { color: COLORS.danger, fontSize: 13, fontWeight: '800', width: 70 },
  repLabel: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  badge: { width: 70, alignItems: 'flex-end' },
  badgeText: {
    color: COLORS.accent2,
    fontSize: 12,
    fontWeight: '700',
    borderWidth: 1,
    borderColor: COLORS.accent2,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: 'hidden',
  },

  dotsContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dot: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: COLORS.accent2,
    position: 'absolute',
  },
  dotLeft: { left: 30, top: '50%' },
  dotRight: { right: 30, top: '50%' },
  dotCenter: { top: '30%', alignSelf: 'center' },

  center: { position: 'absolute', bottom: 140, left: 24, right: 24, alignItems: 'center' },
  title: { color: COLORS.text, fontSize: 24, fontWeight: '800', textAlign: 'center', textShadowColor: '#000', textShadowOffset: { width: 1, height: 1 }, textShadowRadius: 3 },
  detail: { color: COLORS.subtle, fontSize: 16, textAlign: 'center', marginTop: 8, textShadowColor: '#000', textShadowOffset: { width: 1, height: 1 }, textShadowRadius: 2 },
  countdown: { color: COLORS.accent2, fontSize: 32, fontWeight: '700', marginTop: 12, fontVariant: ['tabular-nums'], textShadowColor: '#000', textShadowOffset: { width: 1, height: 1 }, textShadowRadius: 3 },
  
  bottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 18,
    paddingTop: 14,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  endBtn: {
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.danger,
    backgroundColor: 'rgba(229,72,77,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  endText: { color: COLORS.danger, fontSize: 16, fontWeight: '800' },
});
