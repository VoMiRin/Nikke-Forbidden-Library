import type { Script } from '../types';

export interface SectionSummary {
  name: string;
  titleCount: number;
  sceneCount: number;
}

/**
 * 소분류를 처음 나온 순서대로 모은다. 소분류가 없으면 빈 배열.
 * 기본은 분류 안의 소분류(section)이고, sectionOf로 타이틀 안의 세부 구분(titleSection)도 모을 수 있다.
 */
export const listSections = (
  scripts: Script[],
  sectionOf: (script: Script) => string | undefined = script => script.section,
): SectionSummary[] => {
  const sections = new Map<string, { titles: Set<string>; scenes: number }>();
  for (const script of scripts) {
    const section = sectionOf(script);
    if (!section) continue;
    const entry = sections.get(section) ?? { titles: new Set<string>(), scenes: 0 };
    entry.titles.add(script.title);
    entry.scenes += 1;
    sections.set(section, entry);
  }
  return Array.from(sections, ([name, { titles, scenes }]) => ({ name, titleCount: titles.size, sceneCount: scenes }));
};
