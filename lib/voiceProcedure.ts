import { GROUPS, groupSequenceFor, NUM_GROUPS, TASK_ORDER, TASKS_PER_GROUP, tasksForGroup } from './voiceTasks';
import type { TaskType } from './voiceTasks';
import type { VoiceSession } from './voiceTypes';

export interface VoiceProcedureValidationOptions {
  audioFileExists?: boolean;
}

export interface VoiceProcedureValidationResult {
  valid: boolean;
  errors: string[];
}

const sameSequence = <T,>(a: T[], b: T[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

const TASK_CODE_PREFIX: Record<TaskType, string> = {
  reading: 'R',
  navigation: 'N',
  cockpit: 'C',
  media: 'M',
  communication: 'K',
};

export function validateVoiceTaskCatalog(): VoiceProcedureValidationResult {
  const errors: string[] = [];

  if (GROUPS.length !== NUM_GROUPS) errors.push(`Expected ${NUM_GROUPS} groups, found ${GROUPS.length}.`);

  GROUPS.forEach((groupTasks, groupIndex) => {
    const group = groupIndex + 1;
    if (groupTasks.length !== TASKS_PER_GROUP) {
      errors.push(`G${group} expected ${TASKS_PER_GROUP} tasks, found ${groupTasks.length}.`);
    }

    TASK_ORDER.forEach((type, taskIndex) => {
      const task = groupTasks[taskIndex];
      const expectedCode = `${TASK_CODE_PREFIX[type]}${group}`;
      if (!task) {
        errors.push(`G${group} missing task ${taskIndex + 1}.`);
        return;
      }
      if (task.taskCode !== expectedCode) errors.push(`G${group} task ${taskIndex + 1} expected ${expectedCode}, found ${task.taskCode}.`);
      if (task.type !== type) errors.push(`${task.taskCode} expected type ${type}, found ${task.type}.`);
      if (task.group !== group || task.groupId !== `G${group}`) errors.push(`${task.taskCode} has wrong group metadata.`);
      if (!task.promptLines.length || task.promptLines.some((line) => !line.trim())) errors.push(`${task.taskCode} is missing prompt text.`);
      if (!task.imageAsset || !task.sceneId) errors.push(`${task.taskCode} is missing picture metadata.`);
    });
  });

  return { valid: errors.length === 0, errors };
}

export function expectedTaskCodesForParticipant(participant: string | number, pNum?: number): string[] {
  return groupSequenceFor(participant, pNum).flatMap((group) => tasksForGroup(group).map((task) => task.taskCode));
}

export function validateVoiceSessionProcedure(
  session: VoiceSession,
  options: VoiceProcedureValidationOptions = {},
): VoiceProcedureValidationResult {
  const errors: string[] = [];
  const catalog = validateVoiceTaskCatalog();
  errors.push(...catalog.errors);

  if (!session.participant || session.participant.trim() === '') errors.push('Participant ID is missing.');

  // Removed strict sequence matching for single-round payload

  if (session.group_sequence.length === 0) errors.push(`Group sequence is empty.`);
  if (session.rounds.filter(Boolean).length === 0) errors.push(`No completed rounds found.`);
  if (!session.audioStartedAt) errors.push('Audio recording never started.');
  if (!session.audioStoppedAt) errors.push('Audio recording stop timestamp is missing.');

  const actualTaskCodes: string[] = [];

  session.rounds.forEach((round, roundIndex) => {
    if (!round) return;
    const expectedGroup = session.group_sequence[roundIndex];
    const expectedTasks = tasksForGroup(expectedGroup);

    if (round.group !== expectedGroup || round.groupId !== `G${expectedGroup}`) errors.push(`Sequence step ${roundIndex + 1} has wrong group metadata.`);
    if (round.tasks.length !== TASKS_PER_GROUP) errors.push(`Sequence step ${roundIndex + 1} expected ${TASKS_PER_GROUP} tasks, found ${round.tasks.length}.`);

    round.tasks.forEach((taskLog, taskIndex) => {
      const expectedTask = expectedTasks[taskIndex];
      actualTaskCodes.push(taskLog.taskCode);

      if (!expectedTask) {
        errors.push(`Sequence step ${roundIndex + 1} has unexpected task at index ${taskIndex + 1}.`);
        return;
      }

      if (taskLog.taskCode !== expectedTask.taskCode || taskLog.taskId !== expectedTask.taskCode) {
        errors.push(`Sequence step ${roundIndex + 1} task ${taskIndex + 1} expected ${expectedTask.taskCode}, found ${taskLog.taskCode}/${taskLog.taskId}.`);
      }
      if (taskLog.type !== expectedTask.type) errors.push(`${taskLog.taskCode} has wrong task type.`);
      if (taskLog.round !== round.round || taskLog.group !== expectedGroup || taskLog.groupId !== `G${expectedGroup}`) {
        errors.push(`${taskLog.taskCode} has wrong round/group metadata.`);
      }
      if (!taskLog.promptLines.length || taskLog.promptLines.some((line) => !line.trim())) errors.push(`${taskLog.taskCode} is missing prompt text in log.`);
      if (!taskLog.imageAsset || !taskLog.sceneId) errors.push(`${taskLog.taskCode} is missing picture metadata in log.`);
      if (!taskLog.shownAt || !taskLog.leftAt) errors.push(`${taskLog.taskCode} is missing shown/left timestamps.`);
      if (taskLog.shownAtAudioMs === null || taskLog.leftAtAudioMs === null) errors.push(`${taskLog.taskCode} is missing audio-relative offsets.`);
      if (taskLog.visits.length < 1) errors.push(`${taskLog.taskCode} has no page visits.`);

      const shownEvents = round.pageEvents.filter((event) => event.taskId === taskLog.taskId && event.event === 'shown');
      const leftEvents = round.pageEvents.filter((event) => event.taskId === taskLog.taskId && event.event === 'left');
      if (shownEvents.length !== taskLog.visits.length) {
        errors.push(`${taskLog.taskCode} has ${shownEvents.length} shown events for ${taskLog.visits.length} visits.`);
      }
      if (leftEvents.length !== taskLog.visits.length) {
        errors.push(`${taskLog.taskCode} has ${leftEvents.length} left events for ${taskLog.visits.length} visits.`);
      }

      taskLog.visits.forEach((visit, visitIndex) => {
        if (!visit.shownAt || !visit.leftAt) errors.push(`${taskLog.taskCode} visit ${visitIndex + 1} is missing shown/left timestamps.`);
        if (!visit.leaveDirection) errors.push(`${taskLog.taskCode} visit ${visitIndex + 1} is missing transition direction.`);
        if (!visit.recordingState) errors.push(`${taskLog.taskCode} visit ${visitIndex + 1} is missing recording state.`);
        if (visit.recordingState !== 'recording') errors.push(`${taskLog.taskCode} visit ${visitIndex + 1} was not recorded.`);
        if (visit.shownAtAudioMs === null || visit.leftAtAudioMs === null) errors.push(`${taskLog.taskCode} visit ${visitIndex + 1} is missing audio-relative offsets.`);
      });
    });

    round.pageEvents.forEach((event, eventIndex) => {
      if (!event.timestamp) errors.push(`Sequence step ${roundIndex + 1} event ${eventIndex + 1} is missing timestamp.`);
      if (!event.recordingState) errors.push(`Sequence step ${roundIndex + 1} event ${eventIndex + 1} is missing recording state.`);
      if (event.recordingState !== 'recording') errors.push(`Sequence step ${roundIndex + 1} event ${eventIndex + 1} was not recorded.`);
      if (event.participant !== session.participant) errors.push(`Sequence step ${roundIndex + 1} event ${eventIndex + 1} has wrong participant.`);
      if (!sameSequence(event.groupSequence, session.group_sequence)) errors.push(`Sequence step ${roundIndex + 1} event ${eventIndex + 1} has wrong group sequence.`);
      if (event.audioMs === null) errors.push(`Sequence step ${roundIndex + 1} event ${eventIndex + 1} is missing audio-relative offset.`);
      if (event.event === 'left' && !event.transitionDirection) errors.push(`Sequence step ${roundIndex + 1} event ${eventIndex + 1} is missing transition direction.`);
    });
  });

  const expectedTaskCodes = session.group_sequence.flatMap((group) => tasksForGroup(group).map((task) => task.taskCode));
  if (actualTaskCodes.length !== session.group_sequence.length * TASKS_PER_GROUP) {
    errors.push(`Expected ${session.group_sequence.length * TASKS_PER_GROUP} task logs, found ${actualTaskCodes.length}.`);
  }
  if (!sameSequence(actualTaskCodes, expectedTaskCodes)) {
    errors.push(`Full task order is wrong. Expected ${expectedTaskCodes.join(',')}, found ${actualTaskCodes.join(',')}.`);
  }

  return { valid: errors.length === 0, errors };
}
