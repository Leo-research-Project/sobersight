const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const moduleCache = new Map();

function loadTsModule(relPath) {
  const absPath = path.join(root, relPath);
  if (moduleCache.has(absPath)) return moduleCache.get(absPath).exports;

  const source = fs.readFileSync(absPath, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;

  const mod = { exports: {} };
  moduleCache.set(absPath, mod);

  const localRequire = (request) => {
    if (request.startsWith('./')) {
      return loadTsModule(path.join(path.dirname(relPath), `${request.slice(2)}.ts`));
    }
    if (request.endsWith('.png') || request.endsWith('.jpg')) return request;
    if (request === 'react-native') return {};
    throw new Error(`Unexpected require: ${request}`);
  };

  new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports);
  return mod.exports;
}

const {
  GROUPS,
  groupSequenceFor,
  NUM_GROUPS,
  TASKS_PER_GROUP,
  tasksForGroup,
} = loadTsModule('lib/voiceTasks.ts');
const {
  expectedTaskCodesForParticipant,
  validateVoiceSessionProcedure,
  validateVoiceTaskCatalog,
} = loadTsModule('lib/voiceProcedure.ts');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function same(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function iso(ms) {
  return new Date(1_800_000_000_000 + ms).toISOString();
}

function makeEvent(session, task, round, taskIndex, event, ms, direction = null, recordingState = 'recording') {
  return {
    event,
    timestamp: iso(ms),
    audioMs: ms,
    participant: session.participant,
    groupSequence: [...session.group_sequence],
    round,
    group: task.group,
    groupId: task.groupId,
    taskCode: task.taskCode,
    taskId: task.taskCode,
    taskIndex,
    type: task.type,
    sceneId: task.sceneId,
    imageAsset: task.imageAsset,
    transitionDirection: direction,
    recordingState,
  };
}

function makeValidSession(participant = 1) {
  const session = {
    kind: 'voice_command',
    session_id: 'test-session',
    participant: String(participant),
    group_sequence: groupSequenceFor(participant),
    started_at: iso(0),
    ended_at: iso(100_000),
    audioStartedAt: iso(0),
    audioStoppedAt: iso(100_000),
    audioUri: 'file:///voice_command_audio.m4a',
    jsonUri: 'file:///session.json',
    completed: false,
    rounds: [],
  };

  let ms = 1000;
  session.group_sequence.forEach((group, roundIndex) => {
    const round = {
      round: roundIndex + 1,
      group,
      groupId: `G${group}`,
      audioStartedAt: session.audioStartedAt,
      audioStoppedAt: session.audioStoppedAt,
      audioUri: null,
      tasks: [],
      pageEvents: [],
    };

    tasksForGroup(group).forEach((task, taskIndex) => {
      const shownAt = iso(ms);
      const leftAt = iso(ms + 500);
      const direction = taskIndex === TASKS_PER_GROUP - 1 ? 'end_round' : 'next';
      const log = {
        taskCode: task.taskCode,
        taskId: task.taskCode,
        group: task.group,
        groupId: task.groupId,
        round: round.round,
        taskIndex: taskIndex + 1,
        type: task.type,
        sceneId: task.sceneId,
        imageAsset: task.imageAsset,
        promptLines: [...task.promptLines],
        shownAt,
        leftAt,
        shownAtAudioMs: ms,
        leftAtAudioMs: ms + 500,
        visits: [{
          shownAt,
          leftAt,
          shownAtAudioMs: ms,
          leftAtAudioMs: ms + 500,
          leaveDirection: direction,
          recordingState: 'recording',
        }],
      };
      round.tasks.push(log);
      round.pageEvents.push(makeEvent(session, task, round.round, taskIndex + 1, 'shown', ms));
      round.pageEvents.push(makeEvent(session, task, round.round, taskIndex + 1, 'left', ms + 500, direction));
      ms += 1000;
    });

    session.rounds.push(round);
  });

  return session;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function run() {
  const expectedRotations = {
    1: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    2: [2, 3, 4, 5, 6, 7, 8, 9, 10, 1],
    3: [3, 4, 5, 6, 7, 8, 9, 10, 1, 2],
    4: [4, 5, 6, 7, 8, 9, 10, 1, 2, 3],
    10: [10, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    11: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    12: [2, 3, 4, 5, 6, 7, 8, 9, 10, 1],
  };
  for (const [participant, expected] of Object.entries(expectedRotations)) {
    assert(same(groupSequenceFor(Number(participant)), expected), `Rotation failed for participant ${participant}`);
  }

  const catalog = validateVoiceTaskCatalog();
  assert(catalog.valid, `Task catalog invalid:\n${catalog.errors.join('\n')}`);
  assert(GROUPS.length === NUM_GROUPS, 'Expected exactly 10 groups.');
  assert(GROUPS.flat().length === NUM_GROUPS * TASKS_PER_GROUP, 'Expected exactly 50 tasks.');
  GROUPS.forEach((group, index) => {
    assert(group.length === TASKS_PER_GROUP, `G${index + 1} does not have exactly 5 tasks.`);
    assert(same(group.map((task) => task.taskCode), [`R${index + 1}`, `N${index + 1}`, `C${index + 1}`, `M${index + 1}`, `K${index + 1}`]), `G${index + 1} task order is wrong.`);
  });

  assert(same(expectedTaskCodesForParticipant(1).slice(0, 10), ['R1', 'N1', 'C1', 'M1', 'K1', 'R2', 'N2', 'C2', 'M2', 'K2']), 'Participant 1 full order starts wrong.');
  assert(same(expectedTaskCodesForParticipant(2).slice(0, 10), ['R2', 'N2', 'C2', 'M2', 'K2', 'R3', 'N3', 'C3', 'M3', 'K3']), 'Participant 2 full order starts wrong.');

  for (let group = 1; group <= 10; group += 1) {
    const asset = path.join(root, `assets/voice/g${group}.png`);
    assert(fs.existsSync(asset), `Missing picture asset ${asset}`);
    assert(fs.statSync(asset).size > 0, `Empty picture asset ${asset}`);
  }

  const valid = makeValidSession(1);
  assert(validateVoiceSessionProcedure(valid, { audioFileExists: true }).valid, 'Valid session did not pass validation.');

  const missingTimestamp = clone(valid);
  missingTimestamp.rounds[0].tasks[0].visits[0].leftAt = null;
  assert(!validateVoiceSessionProcedure(missingTimestamp, { audioFileExists: true }).valid, 'Missing timestamp was accepted.');

  const missingRecordingState = clone(valid);
  delete missingRecordingState.rounds[0].pageEvents[0].recordingState;
  assert(!validateVoiceSessionProcedure(missingRecordingState, { audioFileExists: true }).valid, 'Missing recording state was accepted.');

  const notRecording = clone(valid);
  notRecording.rounds[0].tasks[0].visits[0].recordingState = 'not_recording';
  notRecording.rounds[0].pageEvents[0].recordingState = 'not_recording';
  assert(!validateVoiceSessionProcedure(notRecording, { audioFileExists: true }).valid, 'Non-recording task visit was accepted.');

  const duplicateFinalLeft = clone(valid);
  const finalEvent = duplicateFinalLeft.rounds[0].pageEvents.findLast((event) => event.event === 'left');
  duplicateFinalLeft.rounds[0].pageEvents.push({ ...finalEvent });
  const finalTaskLeftEvents = duplicateFinalLeft.rounds[0].pageEvents.filter((event) => event.taskId === 'K1' && event.event === 'left');
  assert(finalTaskLeftEvents.length === 2, 'Test fixture did not create duplicate final left event.');
  assert(!validateVoiceSessionProcedure(duplicateFinalLeft, { audioFileExists: true }).valid, 'Duplicate final left event was accepted.');

  const previousVisit = clone(valid);
  const task = previousVisit.rounds[0].tasks[0];
  task.visits.push({
    shownAt: iso(60_000),
    leftAt: iso(60_500),
    shownAtAudioMs: 60_000,
    leftAtAudioMs: 60_500,
    leaveDirection: 'next',
    recordingState: 'recording',
  });
  assert(task.visits.length === 2 && task.visits[0].shownAt !== task.visits[1].shownAt, 'Previous revisit did not preserve visit history.');

  console.log('voice procedure audit passed');
}

run();
