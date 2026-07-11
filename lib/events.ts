// Flatten a Run into a time-ordered event list (shared by the on-disk
// session.json writer and the in-app session detail / video-alignment view).

import type { GazeTrial, PLRTrial, Run } from './types';

export interface SessionEvent {
  type: string; // dark_pre_begin | dark_pre_end | flash_begin | flash_end | tap_response | <phase>_begin/_end
  timestamp: string; // ISO8601
  repetition?: number;
  reactionTimeMs?: number | null;
  phase?: string;
  direction?: string;
  rep?: number;
}

const ms = (iso: string) => new Date(iso).getTime();

export function buildEvents(run: Run): SessionEvent[] {
  const events: SessionEvent[] = [];

  if (run.protocol === 'PLR') {
    for (const tr of run.trials as PLRTrial[]) {
      events.push({ type: 'dark_pre_begin', timestamp: tr.start_time, repetition: tr.trial_number });
      if (tr.flash_started_at) {
        events.push({ type: 'dark_pre_end', timestamp: tr.flash_started_at, repetition: tr.trial_number });
        events.push({
          type: 'flash_begin',
          timestamp: tr.flash_started_at,
          repetition: tr.trial_number,
        });
      }
      if (tr.flash_ended_at) {
        events.push({ type: 'flash_end', timestamp: tr.flash_ended_at, repetition: tr.trial_number });
        events.push({ type: 'dark_post_begin', timestamp: tr.flash_ended_at, repetition: tr.trial_number });
      }
      if (tr.end_time) events.push({ type: 'dark_post_end', timestamp: tr.end_time, repetition: tr.trial_number });
    }
  } else {
    // Horizontal gaze — one begin/end event per movement phase. The phase name
    // already encodes the side (move_right, hold_left, center_from_right, …).
    for (const tr of run.trials as GazeTrial[]) {
      events.push({ type: `${tr.phase}_begin`, timestamp: tr.start_time, phase: tr.phase, rep: tr.rep });
      if (tr.end_time) events.push({ type: `${tr.phase}_end`, timestamp: tr.end_time, phase: tr.phase, rep: tr.rep });
    }
  }

  return events.sort((a, b) => ms(a.timestamp) - ms(b.timestamp));
}
