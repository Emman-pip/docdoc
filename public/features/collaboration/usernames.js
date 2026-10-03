const ADJECTIVES = ['Guilty', 'Quiet', 'Brave', 'Curious', 'Happy', 'Clever', 'Gentle', 'Lucky', 'Mellow', 'Swift', 'Bright', 'Cosmic', 'Sleepy', 'Jolly', 'Witty', 'Amber'];
const NOUNS = ['Pride', 'Otter', 'Panda', 'Falcon', 'Maple', 'Comet', 'Willow', 'Badger', 'Pebble', 'Tiger', 'Meadow', 'Raven', 'Orbit', 'Cedar', 'Fox', 'Cloud'];

export function generateUsername(values = crypto.getRandomValues(new Uint32Array(3))) {
  return `${ADJECTIVES[values[0] % ADJECTIVES.length]}${NOUNS[values[1] % NOUNS.length]}${String(values[2] % 10000).padStart(4, '0')}`;
}

export function initializeUsername(storage) {
  const saved = storage.getItem('docdoc.name');
  if (saved?.trim() && saved !== 'You') return saved;
  const name = generateUsername();
  storage.setItem('docdoc.name', name);
  return name;
}
