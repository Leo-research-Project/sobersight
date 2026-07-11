// In-Vehicle Voice Command task content. 10 groups (G1..G10), each with 5
// tasks in fixed order: Reading (warm-up), Navigation, Cockpit control, Media,
// Communication. Prompts are verbatim from the data-collection guideline.
//
// Per participant the group order is ROTATED (Latin square) so each content
// group lands on a different round across participants — see groupSequenceFor().
// Round 1 is the sober baseline.

import type { ImageSourcePropType } from 'react-native';

export type TaskType = 'reading' | 'navigation' | 'cockpit' | 'media' | 'communication';

export const TASK_TYPE_LABEL: Record<TaskType, string> = {
  reading: 'Reading (warm-up)',
  navigation: 'Navigation',
  cockpit: 'Cockpit control',
  media: 'Media',
  communication: 'Communication',
};

export interface VoiceTask {
  taskCode: string; // R1, N1, C1, ... — unique within the study
  group: number; // 1..10
  groupId: string; // G1..G10
  type: TaskType;
  sceneId: string; // stable id for the picture shown with this group
  imageAsset: string; // bundled image file used on the task page
  promptLines: string[]; // paragraphs shown beneath the picture, in order
}

export const NUM_GROUPS = 10;
export const TASKS_PER_GROUP = 5;
export const TASK_ORDER: TaskType[] = ['reading', 'navigation', 'cockpit', 'media', 'communication'];

// One picture per group, shared by that group's 5 tasks.
export const GROUP_IMAGE: Record<number, ImageSourcePropType> = {
  1: require('../assets/voice/g1.png'),
  2: require('../assets/voice/g2.png'),
  3: require('../assets/voice/g3.png'),
  4: require('../assets/voice/g4.png'),
  5: require('../assets/voice/g5.png'),
  6: require('../assets/voice/g6.png'),
  7: require('../assets/voice/g7.png'),
  8: require('../assets/voice/g8.png'),
  9: require('../assets/voice/g9.png'),
  10: require('../assets/voice/g10.png'),
};

export const GROUP_SCENE: Record<number, { sceneId: string; imageAsset: string; description: string }> = {
  1: { sceneId: 'G1_mountain_freeway', imageAsset: 'assets/voice/g1.png', description: 'Mountain freeway daytime driving scene' },
  2: { sceneId: 'G2_downtown_day', imageAsset: 'assets/voice/g2.png', description: 'Downtown daytime driving scene' },
  3: { sceneId: 'G3_rainy_city_freeway', imageAsset: 'assets/voice/g3.png', description: 'Rainy city freeway scene' },
  4: { sceneId: 'G4_rainy_downtown', imageAsset: 'assets/voice/g4.png', description: 'Rainy downtown driving scene' },
  5: { sceneId: 'G5_rainy_traffic', imageAsset: 'assets/voice/g5.png', description: 'Rainy heavy-traffic scene' },
  6: { sceneId: 'G6_freeway_traffic', imageAsset: 'assets/voice/g6.png', description: 'Freeway traffic scene' },
  7: { sceneId: 'G7_freeway_ramp', imageAsset: 'assets/voice/g7.png', description: 'Freeway ramp daytime scene' },
  8: { sceneId: 'G8_night_city', imageAsset: 'assets/voice/g8.png', description: 'Night city driving scene' },
  9: { sceneId: 'G9_dark_rural', imageAsset: 'assets/voice/g9.png', description: 'Dark rural road scene' },
  10: { sceneId: 'G10_winter_rural', imageAsset: 'assets/voice/g10.png', description: 'Winter rural road scene' },
};

const DRIVE = 'Imagine you are driving:';
const reading = (cmd: string): string[] => [
  "Imagine you're driving, and you want to give your vehicle the following command:",
  `"${cmd}"`,
  'Please read it aloud.',
];
const task = (situation: string, instruction: string): string[] => [DRIVE, situation, instruction];
const voiceTask = (group: number, taskCode: string, type: TaskType, promptLines: string[]): VoiceTask => ({
  taskCode,
  group,
  groupId: `G${group}`,
  type,
  sceneId: GROUP_SCENE[group].sceneId,
  imageAsset: GROUP_SCENE[group].imageAsset,
  promptLines,
});

// Groups in canonical order G1..G10. The 5 tasks per group are R, N, C, M, K.
export const GROUPS: VoiceTask[][] = [
  // Group 1 — sober baseline content for participant 1
  [
    voiceTask(1, 'R1', 'reading', reading('Hey Car, set the temperature to 65 and play my driving playlist.')),
    voiceTask(1, 'N1', 'navigation', task("The low-fuel light just came on while you're on the freeway.", 'Tell the car to take you somewhere to refuel.')),
    voiceTask(1, 'C1', 'cockpit', task("It's getting too warm inside, and there's exhaust smell from the road.", 'Tell the car to cool things down and keep the outside air out.')),
    voiceTask(1, 'M1', 'media', task("You're settled in and want to hear the music you like.", 'Tell the car to put your music on.')),
    voiceTask(1, 'K1', 'communication', task("You're running behind and need to let your mom know.", "Tell the car to text her you'll be a little late.")),
  ],
  // Group 2
  [
    voiceTask(2, 'R2', 'reading', reading('Hey Car, navigate to the nearest gas station and call Sarah.')),
    voiceTask(2, 'N2', 'navigation', task('You want a coffee before your next meeting.', 'Tell the car to take you to the Starbucks on Main Street.')),
    voiceTask(2, 'C2', 'cockpit', task("The windshield is starting to fog up and it's hard to see.", 'Tell the car to turn on the windshield defroster.')),
    voiceTask(2, 'M2', 'media', task("It's a long drive and you want to catch up on a show you follow.", 'Tell the car to play your podcast.')),
    voiceTask(2, 'K2', 'communication', task('You need to reach your coworker David.', 'Tell the car to call David.')),
  ],
  // Group 3
  [
    voiceTask(3, 'R3', 'reading', reading("Hey Car, turn on the seat heater and text Steve I'm running late.")),
    voiceTask(3, 'N3', 'navigation', task('You have to drop a package at a specific address.', 'Tell the car to navigate to 1450 Elm Street.')),
    voiceTask(3, 'C3', 'cockpit', task("It's a cold morning and your hands are freezing on the wheel.", 'Tell the car to warm up your hands.')),
    voiceTask(3, 'M3', 'media', task("The song that's playing really isn't your taste.", 'Tell the car to change it.')),
    voiceTask(3, 'K3', 'communication', task('You want to order food from the pizza place before you get home.', 'Tell the car to call them.')),
  ],
  // Group 4
  [
    voiceTask(4, 'R4', 'reading', reading('Hey Car, find a coffee shop downtown and turn the volume up.')),
    voiceTask(4, 'N4', 'navigation', task("You're running late for a flight.", 'Tell the car to get you to the airport as fast as possible.')),
    voiceTask(4, 'C4', 'cockpit', task('The air inside feels stuffy.', 'Tell the car to open the sunroof.')),
    voiceTask(4, 'M4', 'media', task('The music is too quiet to hear clearly.', 'Tell the car to make it louder.')),
    voiceTask(4, 'K4', 'communication', task('Your phone buzzes with a new text message.', 'Tell the car to find out what it says.')),
  ],
  // Group 5
  [
    voiceTask(5, 'R5', 'reading', reading('Hey Car, switch to the sports station and close the passenger window.')),
    voiceTask(5, 'N5', 'navigation', task("You've finished all your errands for the day.", 'Tell the car to take you home.')),
    voiceTask(5, 'C5', 'cockpit', task("It's getting dark out and the road ahead is hard to see.", 'Tell the car to turn the lights on.')),
    voiceTask(5, 'M5', 'media', task('You want to catch the latest news.', 'Tell the car to play the news.')),
    voiceTask(5, 'K5', 'communication', task('You just heard a message and want to respond.', "Tell the car to let them know you're on your way.")),
  ],
  // Group 6
  [
    voiceTask(6, 'R6', 'reading', reading('Hey Car, take me to the airport and skip to the next song.')),
    voiceTask(6, 'N6', 'navigation', task("You're not feeling well and need to pick up some medicine.", 'Tell the car to find the closest place to get it.')),
    voiceTask(6, 'C6', 'cockpit', task('It just started raining and the windshield is getting wet.', 'Tell the car to turn on the windshield wipers.')),
    voiceTask(6, 'M6', 'media', task("You're in the mood for something upbeat.", 'Tell the car to play something with energy.')),
    voiceTask(6, 'K6', 'communication', task("Your friend Alex wants to know when you'll arrive.", 'Tell the car to let Alex know your arrival time.')),
  ],
  // Group 7
  [
    voiceTask(7, 'R7', 'reading', reading('Hey Car, lower the temperature two degrees and start my podcast.')),
    voiceTask(7, 'N7', 'navigation', task("Your electric car's battery is getting low.", 'Tell the car to find the closest place to charge.')),
    voiceTask(7, 'C7', 'cockpit', task("You're feeling cold.", 'Tell the car to make it warmer inside.')),
    voiceTask(7, 'M7', 'media', task('You want to relax and wind down on the drive.', 'Tell the car to play something relaxing.')),
    voiceTask(7, 'K7', 'communication', task("You don't want to forget to grab milk later.", 'Tell the car to set a reminder to buy milk.')),
  ],
  // Group 8
  [
    voiceTask(8, 'R8', 'reading', reading('Hey Car, call the office and turn on the windshield defroster.')),
    voiceTask(8, 'N8', 'navigation', task('Traffic is backing up ahead of you.', 'Tell the car to find a faster route.')),
    voiceTask(8, 'C8', 'cockpit', task("The fan is blowing hard and it's getting noisy.", 'Tell the car to lower the fan speed.')),
    voiceTask(8, 'M8', 'media', task('You were listening to an audiobook earlier and want to continue.', 'Tell the car to pick up where it left off.')),
    voiceTask(8, 'K8', 'communication', task('You missed a call a moment ago.', 'Tell the car to get back to whoever called.')),
  ],
  // Group 9
  [
    voiceTask(9, 'R9', 'reading', reading('Hey Car, play some jazz and set a reminder to buy groceries.')),
    voiceTask(9, 'N9', 'navigation', task("You're almost at the stadium but need somewhere to park.", 'Tell the car to find parking nearby.')),
    voiceTask(9, 'C9', 'cockpit', task("You've just parked and you're about to step out.", 'Tell the car to lock the doors after you leave.')),
    voiceTask(9, 'M9', 'media', task('The volume is too loud now.', 'Tell the car to make it quieter.')),
    voiceTask(9, 'K9', 'communication', task("A call is coming in, but you can't take it right now.", 'Tell the car to decline the call.')),
  ],
  // Group 10
  [
    voiceTask(10, 'R10', 'reading', reading('Hey Car, navigate home and turn on the air conditioning.')),
    voiceTask(10, 'N10', 'navigation', task("You're meeting a friend for dinner.", "Tell the car to take you to Luigi's on 5th Avenue.")),
    voiceTask(10, 'C10', 'cockpit', task("You're about to merge onto the highway and the windows are down.", 'Tell the car to close everything up.')),
    voiceTask(10, 'M10', 'media', task('You want a mix of different songs instead of the same order.', 'Tell the car to shuffle your music.')),
    voiceTask(10, 'K10', 'communication', task('You promised to call your dad this evening.', 'Tell the car to call Dad.')),
  ],
];

// Group presentation order for a participant, rotated by one group per
// participant. Returns the group numbers (1..10) in round order, e.g.
//   P1 -> [1,2,3,4,5,6,7,8,9,10]
//   P2 -> [2,3,4,5,6,7,8,9,10,1]
export function groupSequenceFor(participant: string | number, explicitPNum?: number): number[] {
  let pNum = 1;
  if (explicitPNum !== undefined && explicitPNum > 0) {
    pNum = explicitPNum;
  } else if (typeof participant === 'number') {
    pNum = participant;
  } else {
    const parsed = parseInt(participant, 10);
    if (!isNaN(parsed)) {
      pNum = parsed;
    } else {
      // Fallback for text IDs: use a simple sum of char codes to pick a rotation
      pNum = Array.from(participant).reduce((sum, char) => sum + char.charCodeAt(0), 0) || 1;
    }
  }

  const offset = ((pNum - 1) % NUM_GROUPS + NUM_GROUPS) % NUM_GROUPS;
  return Array.from({ length: NUM_GROUPS }, (_, k) => ((offset + k) % NUM_GROUPS) + 1);
}

export function tasksForGroup(group: number): VoiceTask[] {
  return GROUPS[group - 1];
}
