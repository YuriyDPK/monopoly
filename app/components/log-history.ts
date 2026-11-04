export type LogHistory = {
  source: string[];
  entries: Array<{ id: number; text: string }>;
  nextId: number;
};

export function createLogHistory(source: string[]): LogHistory {
  return { source, entries: [...source].reverse().map((text, id) => ({ id, text })), nextId: source.length };
}

// The API returns a bounded, newest-first snapshot. Retain entries already
// displayed in this session so trimming the server snapshot cannot move text
// underneath someone reading older messages.
export function appendLogHistory(previous: LogHistory, source: string[]): LogHistory {
  let addedCount = source.length;
  for (let offset = 0; offset < source.length; offset++) {
    const overlap = source.length - offset;
    if (overlap > previous.source.length) continue;
    if (source.slice(offset).every((text, index) => text === previous.source[index])) {
      addedCount = offset;
      break;
    }
  }
  let nextId = previous.nextId;
  const additions = source.slice(0, addedCount).reverse().map(text => ({ id: nextId++, text }));
  return { source, entries: additions.length ? [...previous.entries, ...additions] : previous.entries, nextId };
}
