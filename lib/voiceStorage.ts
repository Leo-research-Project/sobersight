// Local persistence + on-disk export for the In-Vehicle Voice Command task.
// Fully offline. Mirrors lib/storage.ts: durable AsyncStorage index plus a
// human-readable folder tree under Documents.
//
//   Documents/SoberSight/{session-start-stamp}/voice_command/
//     session.json
//     voice_command_audio.m4a
//
//   Documents/SoberSight/voice_command_sessions.json

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { File, Paths } from 'expo-file-system';
import RNFS from 'react-native-fs';
import { Platform } from 'react-native';
import type { VoiceSession } from './voiceTypes';

const KEY = 'sobersight_voice_v1';
const ROOT_DIR = 'SoberSight';
const VOICE_DIR = 'VoiceCommand';
const VOICE_INDEX_FILE = 'voice_sessions_index.json';

function localStamp(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

function getBaseUri(): string {
  return Platform.OS === 'android' 
    ? `${RNFS.ExternalStorageDirectoryPath}/Documents/${ROOT_DIR}`
    : `${FileSystem.documentDirectory}${ROOT_DIR}`;
}

async function makeDirectory(path: string) {
  if (Platform.OS === 'android') {
    await RNFS.mkdir(path.replace('file://', ''));
  } else {
    await FileSystem.makeDirectoryAsync(path, { intermediates: true });
  }
}

async function copyFile(from: string, to: string) {
  if (Platform.OS === 'android') {
    await RNFS.copyFile(from.replace('file://', ''), to.replace('file://', ''));
  } else {
    await FileSystem.copyAsync({ from, to });
  }
}

async function writeString(path: string, contents: string) {
  if (Platform.OS === 'android') {
    await RNFS.writeFile(path.replace('file://', ''), contents, 'utf8');
  } else {
    await FileSystem.writeAsStringAsync(path, contents);
  }
}

async function getSessionDirUri(session: VoiceSession): Promise<string> {
  const baseUri = getBaseUri();
  const pId = session.participant || 'Unassigned';
  const sessionDirName = `${VOICE_DIR}_${localStamp(session.started_at)}`;
  const dirUri = `${baseUri}/${pId}/${sessionDirName}`;
  
  await makeDirectory(dirUri);
  return dirUri;
}

export function voiceSessionFolderName(session: VoiceSession): string {
  const pId = session.participant || 'Unassigned';
  return `${pId}/${VOICE_DIR}_${localStamp(session.started_at)}`;
}

export function voiceSessionJsonPath(session: VoiceSession): string {
  return `Documents/${ROOT_DIR}/${voiceSessionFolderName(session)}/session.json`;
}

export function voiceSessionsIndexPath(): string {
  return `Documents/${ROOT_DIR}/${VOICE_INDEX_FILE}`;
}

async function writeVoiceSessionsIndex(sessions: VoiceSession[]): Promise<void> {
  try {
    const baseUri = getBaseUri();
    await makeDirectory(baseUri);
    await writeString(`${baseUri}/${VOICE_INDEX_FILE}`, JSON.stringify(sessions, null, 2));
  } catch (e) {
    console.warn('writeVoiceSessionsIndex: failed', e);
  }
}

// Copy the freshly recorded whole-test audio file out of the cache into the session
// folder. Returns the permanent uri, or the raw uri if the copy fails (so the
// recording is never lost). Best-effort: never throws.
export async function copySessionAudio(session: VoiceSession, uri: string): Promise<string> {
  try {
    const dirUri = await getSessionDirUri(session);
    const ext = uri.split('.').pop() || 'wav';
    const filename = `voice_audio_${session.rounds ? session.rounds.filter(Boolean).length : 0}.${ext}`;
    const destUri = `${dirUri}/${filename}`;

    await copyFile(uri, destUri);

    // Try to delete original cache file safely
    try {
      await FileSystem.deleteAsync(uri, { idempotent: true });
    } catch (e) {}

    return destUri;
  } catch (e) {
    console.warn('copySessionAudio: failed, keeping cache uri', e);
    return uri;
  }
}

// Write/refresh the session.json at the session folder root. Best-effort.
export async function writeVoiceSessionJson(session: VoiceSession): Promise<void> {
  try {
    const dirUri = await getSessionDirUri(session);
    const jfUri = `${dirUri}/session.json`;
    session.jsonUri = jfUri;

    const exportData: any = { ...session };
    delete exportData.audioUri;
    delete exportData.jsonUri;
    if (exportData.rounds) {
      exportData.rounds = exportData.rounds.map((r: any) => {
        if (!r) return r;
        const copy = { ...r };
        delete copy.audioUri;
        return copy;
      });
    }

    await writeString(jfUri, JSON.stringify(exportData, null, 2));
  } catch (e) {
    console.warn('writeVoiceSessionJson: failed', e);
  }
}

export async function loadVoiceSessions(): Promise<VoiceSession[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as VoiceSession[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Upsert by session_id (newest first). Durable index — independent of the file
// export so a disk error can never lose the structured log.
export async function saveVoiceSession(session: VoiceSession): Promise<void> {
  const all = await loadVoiceSessions();
  const next = all.filter((s) => s.session_id !== session.session_id);
  next.unshift(session);
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
  await writeVoiceSessionsIndex(next);
}

// Persist a session everywhere: AsyncStorage index + Documents session.json.
// Never throws — structured data is always saved.
export async function persistVoiceSession(session: VoiceSession): Promise<void> {
  await writeVoiceSessionJson(session);
  await saveVoiceSession(session);
}

export async function clearVoiceSessions(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}

export async function shareVoiceAudio(uri: string): Promise<void> {
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { dialogTitle: 'Export voice-command test audio' });
  }
}

// Write every voice session log to a single JSON file and open the share sheet.
export async function exportVoiceSessions(): Promise<string> {
  const sessions = await loadVoiceSessions();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = new File(Paths.cache, `sobersight_voice_${stamp}.json`);
  if (file.exists) file.delete();
  file.create();
  file.write(JSON.stringify(sessions, null, 2));

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/json',
      UTI: 'public.json',
      dialogTitle: 'Export voice command sessions',
    });
  }
  return file.uri;
}
