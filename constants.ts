import React from 'react';
import type { ScriptCategory } from './types';
import { BookOpenIcon, ChatBubbleIcon, UserCircleIcon, CalendarDaysIcon, SparklesIcon, ArchiveBoxIcon, PuzzlePieceIcon, GiftIcon } from './components/Icons';

export const SCRIPT_CATEGORIES: ScriptCategory[] = [
  { key: 'main_story', name: '메인 스토리', roman: 'I', icon: React.createElement(BookOpenIcon) },
  { key: 'side_stories', name: '사이드 스토리', roman: 'II', icon: React.createElement(PuzzlePieceIcon) },
  { key: 'sub_quests', name: '서브 퀘스트', roman: 'III', icon: React.createElement(SparklesIcon) },
  { key: 'event_stories', name: '이벤트 스토리', roman: 'IV', icon: React.createElement(CalendarDaysIcon) },
  { key: 'character_episodes', name: '니케 에피소드', roman: 'V', icon: React.createElement(UserCircleIcon) },
  { key: 'lost_relics', name: '유실물', roman: 'VI', icon: React.createElement(ArchiveBoxIcon) },
  { key: 'event_lost_relics', name: '이벤트 유실물', roman: 'VII', icon: React.createElement(ArchiveBoxIcon) },
  { key: 'outpost_stories', name: '돌발 스토리', roman: 'VIII', icon: React.createElement(SparklesIcon) },
  { key: 'special_stories', name: '특별 스토리', roman: 'IX', icon: React.createElement(GiftIcon) },
  { key: 'blabla', name: '블라블라', roman: 'X', icon: React.createElement(ChatBubbleIcon) },
];
