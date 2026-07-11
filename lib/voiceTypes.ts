// Data schema for the In-Vehicle Voice Command task. One VoiceSession per
// participant run: 10 rounds (groups in the participant's rotated order), one
// continuous audio recording for the whole test, and 5 task pages per round.

import type { TaskType } from './voiceTasks';

export type VoiceRecordingState = 'recording' | 'not_recording' | 'failed';
export type VoiceTransitionDirection = 'next' | 'previous' | 'end_round' | 'end_session';

export interface VoiceTaskVisit {
  shownAt: string; // ISO8601 — when this visit to the task page began
  leftAt: string | null; // ISO8601 — when this visit ended
  shownAtAudioMs: number | null; // ms from session audio start
  leftAtAudioMs: number | null; // ms from session audio start
  leaveDirection: VoiceTransitionDirection | null;
  recordingState: VoiceRecordingState;
}

export interface VoiceTaskLog {
  taskCode: string; // R1, N1, ...
  taskId: string; // same as taskCode, explicit for exported dataset consumers
  group: number; // 1..10
  groupId: string; // G1..G10
  round: number; // 1..10
  taskIndex: number; // 1..5 within the round
  type: TaskType;
  sceneId: string; // stable id for the displayed picture
  imageAsset: string; // bundled image path displayed on the task page
  promptLines: string[];
  shownAt: string; // ISO8601 — when the task page was first shown
  leftAt: string | null; // ISO8601 — when the participant left the page
  shownAtAudioMs: number | null; // ms from session audio start
  leftAtAudioMs: number | null; // ms from session audio start
  visits: VoiceTaskVisit[]; // every page visit, including previous/next navigation
}

export interface VoicePageEvent {
  event: 'shown' | 'left';
  timestamp: string;
  audioMs: number | null;
  participant: string;
  groupSequence: number[];
  round: number;
  group: number;
  groupId: string;
  taskCode: string;
  taskId: string;
  taskIndex: number;
  type: TaskType;
  sceneId: string;
  imageAsset: string;
  transitionDirection: VoiceTransitionDirection | null;
  recordingState: VoiceRecordingState;
}

export interface VoiceRoundLog {
  round: number; // 1..10 (round 1 = sober baseline)
  group: number; // group id 1..10
  groupId: string; // G1..G10
  audioStartedAt: string | null; // legacy mirror of session audio start
  audioStoppedAt: string | null; // legacy mirror of session audio stop
  audioUri: string | null; // legacy; audio is stored once on VoiceSession.audioUri
  tasks: VoiceTaskLog[];
  pageEvents: VoicePageEvent[]; // sequential page log aligned to the session audio
}

export interface VoiceSession {
  kind: 'voice_command';
  session_id: string;
  participant: string; // participant identifier entered at setup
  participant_number?: number; // assigned index based on the order of unique participants
  group_sequence: number[]; // group ids in round order, length 10
  started_at: string; // ISO8601
  ended_at: string | null; // ISO8601
  audioStartedAt: string | null; // ISO8601 — one recording for the whole test
  audioStoppedAt: string | null; // ISO8601
  audioUri: string | null; // permanent file uri of the whole-test recording
  jsonUri: string | null; // permanent file uri of session.json
  completed: boolean; // all 10 rounds finished
  rounds: VoiceRoundLog[];
}
