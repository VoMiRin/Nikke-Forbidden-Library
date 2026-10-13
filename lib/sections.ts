import type { Script } from '../types';

export interface SectionSummary {
  name: string;
  titleCount: number;
  sceneCount: number;
}

/** 분류 안의 소분류를 처음 나온 순서대로 모은다. 소분류가 없으면 빈 배열. */
export const listSections = (scripts: Script[]): SectionSummary[] => {
  const sections = new Map<string, { titles: Set<string>; scenes: number }>();
  for (const script of scripts) {
    if (!script.section) continue;
    const entry = sections.get(script.section) ?? { titles: new Set<string>(), scenes: 0 };
    entry.titles.add(script.title);
    entry.scenes += 1;
    sections.set(script.section, entry);
  }
  return Array.from(sections, ([name, { titles, scenes }]) => ({ name, titleCount: titles.size, sceneCount: scenes }));
};
