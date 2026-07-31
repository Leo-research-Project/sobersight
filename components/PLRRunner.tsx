import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import { COLORS } from '@/lib/theme';
import { LED_BASELINE_LEVEL, LED_STIMULUS_LEVEL, setLedLevel } from '@/lib/ledDevice';
import type { PLRTrial } from '@/lib/types';

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

// Stimulus comes from the BLE LED board (ESP32C3), not the phone torch.
// Each trial: 5s baseline (10% LED) → 0.1s stimulus (55%) → 5s baseline.
// PLRTrial keeps the flash_* field names; they mark the stimulus window.
const BASELINE_MS = 5000;
const STIMULUS_MS = 100;

const nowISO = () => new Date().toISOString();

// Fire-and-forget brightness write — BLE latency must not shift the
// protocol timeline, and timestamps are stamped when the write is issued.
const led = (level: number) => {
  setLedLevel(level).catch(() => {});
};

interface Props {
  onDone: (trials: PLRTrial[], completed: boolean) => void;
}

export function PLRRunner({ onDone }: Props) {
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState('Wait'); // "Wait" | "Flash"
  const [trialNum, setTrialNum] = useState(0); // current trial 1..3
  const [elapsed, setElapsed] = useState(0); // seconds since start
  const [countdown, setCountdown] = useState(0); // 3..1 pre-test countdown, 0 = not counting

  const cancelled = useRef(false);
  const doneGuard = useRef(false);
  const trialsRef = useRef<PLRTrial[]>([]);
  const timers = useRef<{ cancel: () => void }[]>([]);

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const id = setTimeout(resolve, ms);
      timers.current.push({ cancel: () => { clearTimeout(id); resolve(); } });
    });

  const speakAsync = (text: string) =>
    new Promise<void>((resolve) => {
      Speech.speak(text, { rate: 0.95, onDone: () => resolve(), onStopped: () => resolve(), onError: () => resolve() });
    });

  const runCountdown = async () => {
    for (let c = 3; c >= 1; c--) {
      if (cancelled.current) return;
      setCountdown(c);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      await sleep(1000);
    }
    setCountdown(0);
  };

  const finish = (completed: boolean) => {
    if (doneGuard.current) return;
    doneGuard.current = true;
    led(LED_BASELINE_LEVEL); // board holds 10% whenever idle
    onDone(trialsRef.current, completed);
  };

  const exit = () => {
    cancelled.current = true;
    timers.current.forEach((t) => t.cancel());
  };

  useEffect(() => {
    (async () => {
      await speakAsync('Keep your eyes open and look at the camera.');
      if (cancelled.current) return finish(false);
      await runCountdown();
      if (cancelled.current) return finish(false);

      const startMs = Date.now();
      const tick = setInterval(() => setElapsed(Math.floor((Date.now() - startMs) / 1000)), 250);
      timers.current.push({ cancel: () => clearInterval(tick) });

      for (let n = 1; n <= 3; n++) {
        if (cancelled.current) return finish(false);

        const trial: PLRTrial = {
          trial_number: n,
          start_time: nowISO(),
          flash_started_at: null,
          flash_ended_at: null,
          end_time: null,
        };
        trialsRef.current.push(trial);
        setTrialNum(n);

        // 5s baseline — LED at 10%
        setPhase('Wait');
        led(LED_BASELINE_LEVEL);
        await sleep(BASELINE_MS);
        if (cancelled.current) { trial.end_time = nowISO(); return finish(false); }

        // 0.1s stimulus — LED at 55%
        setPhase('Flash');
        led(LED_STIMULUS_LEVEL);
        trial.flash_started_at = nowISO();
        await sleep(STIMULUS_MS);
        trial.flash_ended_at = nowISO();
        led(LED_BASELINE_LEVEL);
        if (cancelled.current) { trial.end_time = nowISO(); return finish(false); }

        // 5s baseline — LED back at 10%
        setPhase('Wait');
        await sleep(BASELINE_MS);
        trial.end_time = nowISO();
        if (cancelled.current) return finish(false);
      }
      finish(true);
    })();

    return () => {
      cancelled.current = true;
      timers.current.forEach((t) => t.cancel());
      Speech.stop();
      led(LED_BASELINE_LEVEL); // back to the 10% idle level
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flashActive = phase === 'Flash';
  return (
    <View style={styles.root}>
      {/* Top bar */}
      <View style={[styles.topBar, { paddingTop: insets.top + 6 }]} pointerEvents="none">
        <Text style={styles.rec}>● REC</Text>
        <Text style={styles.timer}>{mmss(elapsed)}</Text>
        <View style={styles.badge}><Text style={styles.badgeText}>PLR</Text></View>
      </View>

      {/* Center framing reticle */}
      <View style={styles.center} pointerEvents="none">
        <View style={[styles.bracket, styles.tl]} />
        <View style={[styles.bracket, styles.tr]} />
        <View style={[styles.bracket, styles.bl]} />
        <View style={[styles.bracket, styles.br]} />
        <View style={[styles.pill, flashActive && styles.pillActive]}>
          <Text style={styles.pillText}>LOOK AT CAMERA</Text>
        </View>
        {countdown > 0 && (
          <View style={styles.countWrap}>
            <Text style={styles.countNum}>{countdown}</Text>
            <Text style={styles.countLabel}>Get ready…</Text>
          </View>
        )}
      </View>

      {/* Bottom info + End Session */}
      <View style={[styles.bottom, { paddingBottom: insets.bottom + 10 }]} pointerEvents="box-none">
        <View style={styles.statsRow}>
          <Stat value={`${trialNum}/3`} label="Flashes" />
        </View>
        <Pressable style={styles.endBtn} onLongPress={exit} delayLongPress={900}>
          <Text style={styles.endText}>■ Hold to End Session</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const BRACKET = 22;
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
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
  rec: { color: COLORS.danger, fontSize: 13, fontWeight: '800', width: 60 },
  timer: { color: COLORS.text, fontSize: 20, fontWeight: '700', fontVariant: ['tabular-nums'] },
  badge: { width: 60, alignItems: 'flex-end' },
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  bracket: { position: 'absolute', width: BRACKET, height: BRACKET, borderColor: COLORS.accent2 },
  tl: { top: '34%', left: '12%', borderLeftWidth: 2, borderTopWidth: 2 },
  tr: { top: '34%', right: '12%', borderRightWidth: 2, borderTopWidth: 2 },
  bl: { bottom: '34%', left: '12%', borderLeftWidth: 2, borderBottomWidth: 2 },
  br: { bottom: '34%', right: '12%', borderRightWidth: 2, borderBottomWidth: 2 },
  pill: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(56,189,248,0.6)',
    backgroundColor: 'rgba(19,26,42,0.5)',
  },
  pillActive: {
    borderColor: COLORS.accent2,
    backgroundColor: 'rgba(56,189,248,0.22)',
  },
  pillText: { color: COLORS.text, fontSize: 14, fontWeight: '700', letterSpacing: 0.5 },
  countWrap: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  countNum: { color: COLORS.accent2, fontSize: 96, fontWeight: '900', fontVariant: ['tabular-nums'] },
  countLabel: { color: COLORS.subtle, fontSize: 14, fontWeight: '600', marginTop: 4 },
  bottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 18,
    paddingTop: 14,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  statsRow: { flexDirection: 'row', justifyContent: 'space-around' },
  stat: { alignItems: 'center', flex: 1 },
  statValue: { color: COLORS.text, fontSize: 18, fontWeight: '800' },
  statLabel: { color: COLORS.subtle, fontSize: 12, marginTop: 2 },
  endBtn: {
    marginTop: 10,
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
