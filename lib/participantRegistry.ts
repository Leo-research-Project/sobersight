import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'sobersight_participant_registry_v1';

export async function getParticipantNumber(participant: string): Promise<number> {
  const norm = participant.trim().toUpperCase();
  if (!norm) return 1;

  try {
    const raw = await AsyncStorage.getItem(KEY);
    const registry: string[] = raw ? JSON.parse(raw) : [];
    
    const index = registry.indexOf(norm);
    if (index !== -1) {
      return index + 1;
    }
    
    registry.push(norm);
    await AsyncStorage.setItem(KEY, JSON.stringify(registry));
    return registry.length;
  } catch (e) {
    console.warn('Failed to read/write participant registry', e);
    return 1; // Fallback
  }
}

export async function peekParticipantNumber(participant: string): Promise<number | null> {
  const norm = participant.trim().toUpperCase();
  if (!norm) return null;

  try {
    const raw = await AsyncStorage.getItem(KEY);
    const registry: string[] = raw ? JSON.parse(raw) : [];
    
    const index = registry.indexOf(norm);
    if (index !== -1) {
      return index + 1;
    }
    
    return registry.length + 1;
  } catch {
    return null;
  }
}

export async function getAllParticipants(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

const COUNTS_KEY = 'sobersight_participant_counts_v1';

export async function getParticipantRunCount(participant: string): Promise<number> {
  const norm = participant.trim().toUpperCase();
  if (!norm) return 0;
  try {
    const raw = await AsyncStorage.getItem(COUNTS_KEY);
    const counts: Record<string, number> = raw ? JSON.parse(raw) : {};
    return counts[norm] || 0;
  } catch {
    return 0;
  }
}

export async function incrementParticipantRunCount(participant: string): Promise<number> {
  const norm = participant.trim().toUpperCase();
  if (!norm) return 1;
  try {
    const raw = await AsyncStorage.getItem(COUNTS_KEY);
    const counts: Record<string, number> = raw ? JSON.parse(raw) : {};
    counts[norm] = (counts[norm] || 0) + 1;
    await AsyncStorage.setItem(COUNTS_KEY, JSON.stringify(counts));
    return counts[norm];
  } catch {
    return 1;
  }
}

export async function clearParticipantRegistry(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
    await AsyncStorage.removeItem(COUNTS_KEY);
  } catch (e) {
    console.warn('Failed to clear participant registry', e);
  }
}
