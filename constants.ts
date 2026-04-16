import React from 'react';
import type { ScriptCategory } from './types';
import { BookOpenIcon, UserCircleIcon, CalendarDaysIcon, SparklesIcon, ArchiveBoxIcon, PuzzlePieceIcon } from './components/Icons';

export const SCRIPT_CATEGORIES: ScriptCategory[] = [
  { key: 'main_story', name: '메인 스토리', icon: React.createElement(BookOpenIcon) },
  { key: 'side_stories', name: '사이드 스토리', icon: React.createElement(PuzzlePieceIcon) },
  { key: 'sub_quests', name: '서브 퀘스트', icon: React.createElement(SparklesIcon) },
  { key: 'event_stories', name: '이벤트 스토리', icon: React.createElement(CalendarDaysIcon) },
  { key: 'character_episodes', name: '니케 에피소드', icon: React.createElement(UserCircleIcon) },
  { key: 'lost_relics', name: '유실물', icon: React.createElement(ArchiveBoxIcon) },
  { key: 'event_lost_relics', name: '이벤트 유실물', icon: React.createElement(ArchiveBoxIcon) },
  { key: 'outpost_stories', name: '돌발 스토리', icon: React.createElement(SparklesIcon) },
];

export const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  /*main_story: 'A chronicle of the surface reclamation war. Trace the footsteps of those who sought the sky.',
  side_stories: 'Expanded worldbuilding, squad moments, and stories that deepen the archive beyond the main line.',
  sub_quests: 'Mission-sized encounters and self-contained episodes collected from the wider battlefield.',
  event_stories: 'Limited event narratives, seasonal arcs, and special stories preserved in one place.',
  character_episodes: 'Closer looks at individual Nikkes through bond scenes and personal episodes.',
  lost_relics: 'Recovered fragments and records from the old world, gathered as archival evidence.',
  event_lost_relics: 'Event-specific relic archives and temporary discoveries documented for reference.',
  outpost_stories: 'Daily base life, side conversations, and quieter scenes from the outpost.',*/
};
