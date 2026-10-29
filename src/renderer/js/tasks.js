// How each phone request looks: an icon, a colour from the phone's chapter accents, and one verb.
const NOTES = '#517E71', DIARY = '#A46D63', AI = '#8265B0', TASKS = '#587BA0', PEOPLE = '#AF6F84', MOVIES = '#AA8146';
const OPERATIONS = {
  'text': ['pen', AI, 'Writing'],
  'summarize-note': ['layers', NOTES, 'Summarizing a note'],
  'rewrite-note': ['pen', NOTES, 'Rewriting a note'],
  'expand-note': ['pen', NOTES, 'Growing a note'],
  'tone-note': ['chat', NOTES, 'Changing the tone'],
  'clarify-note': ['check', NOTES, 'Fixing grammar'],
  'markdown-note': ['layers', NOTES, 'Tidying a note'],
  'present-text': ['sparkle', MOVIES, 'Styling a note'],
  'present-website': ['globe', TASKS, 'Building a page'],
  'suggest-note-metadata': ['tag', NOTES, 'Finding a title'],
  'suggest-note-ideas': ['sparkle', AI, 'Finding ideas'],
  'suggest-note-template': ['file', NOTES, 'Making a template'],
  'suggest-diary-day': ['calendar', DIARY, 'Reading your day'],
  'ask-diary-question': ['chat', DIARY, 'Answering a question'],
  'answer-diary-question': ['search', DIARY, 'Looking back'],
  'diary.conversation': ['chat', DIARY, 'Talking it through'],
  'reflect-thought': ['sparkle', PEOPLE, 'Reflecting'],
  'ask-note-image': ['eye', TASKS, 'Looking at a photo'],
  'scan-note-image': ['scan', TASKS, 'Reading a page'],
  'diary-photo-questions': ['eye', DIARY, 'Asking about a photo'],
  'generate-note-background': ['picture', MOVIES, 'Painting a background'],
  'embed': ['search', TASKS, 'Learning your notes'],
  'voice.transcribe': ['mic', PEOPLE, 'Listening'],
};

export function describe(operation) {
  const [iconName, accent, verb] = OPERATIONS[operation] || ['sparkle', AI, 'Helping'];
  return { icon: iconName, accent, verb };
}

export const ACTIVE = new Set(['queued', 'running']);
export const isActive = (job) => ACTIVE.has(job.state);

/** Terminal states collapse into three stamps a person can recognise without reading. */
export function outcome(job) {
  if (job.state === 'completed') return { tone: 'done', label: 'Done', icon: 'check' };
  if (job.state === 'failed') return { tone: 'problem', label: 'Problem', icon: 'alert' };
  return { tone: 'stopped', label: job.state === 'expired' ? 'Expired' : 'Stopped', icon: 'cross' };
}
