import { createHash } from 'node:crypto';
import { normalizeSearchValue } from '../lib/search.mjs';

// Distinct names stay distinct. Aliases and anonymous speakers cannot safely be
// merged without a curated identity map. Counts describe recorded dialogue lines.
export const buildSpeakerAssets = (records) => {
  const catalog = new Map();
  for (const { script, speakerDetails } of records) {
    for (const detail of Object.values(speakerDetails)) {
      if (!detail.dialogueCount) continue;
      const key = normalizeSearchValue(detail.name);
      if (!catalog.has(key)) {
        catalog.set(key, {
          id: createHash('sha256').update(key).digest('hex').slice(0, 20),
          name: detail.name,
          titles: new Set(),
          scenes: new Map(),
        });
      }
      const speaker = catalog.get(key);
      speaker.titles.add(JSON.stringify([script.categoryKey, script.title]));
      speaker.scenes.set(script.id, detail.dialogueCount);
    }
  }
  const speakerIndex = {};
  const speakers = [...catalog.values()]
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
    .map(({ id, name, titles, scenes }) => {
      const summary = {
        id, name,
        sceneCount: scenes.size,
        titleCount: titles.size,
        dialogueCount: [...scenes.values()].reduce((sum, count) => sum + count, 0),
      };
      speakerIndex[id] = {
        ...summary,
        scenes: [...scenes].map(([scriptId, dialogueCount]) => ({ scriptId, dialogueCount })),
      };
      return summary;
    });
  return { speakers, speakerIndex };
};
