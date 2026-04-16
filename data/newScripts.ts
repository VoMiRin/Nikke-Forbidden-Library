/**
 * 새 스크립트 추가용 파일
 * 
 * 아래의 카테고리별 파일에 스크립트를 추가하면 자동으로 이곳에 합쳐집니다.
 * data/new_scripts/ 폴더 내의 각 파일을 수정하세요.
 */

import type { ScriptData } from './scriptLoader';

import { mainStoryScripts } from './new_scripts/mainStory';
import { eventStoryScripts } from './new_scripts/eventStory';
import { sideStoryScripts } from './new_scripts/sideStory';
import { subQuestScripts } from './new_scripts/subQuest';
import { lostRelicsScripts } from './new_scripts/lostRelics';
import { outpostStoryScripts } from './new_scripts/outpostStory';
import { characterEpisodeScripts } from './new_scripts/characterEpisode';
import { eventLostRelicsScripts } from './new_scripts/eventLostRelics';

/**
 * 새로 추가된 모든 스크립트 데이터
 */
export const newScriptsData: ScriptData[] = [
    ...mainStoryScripts,
    ...eventStoryScripts,
    ...sideStoryScripts,
    ...subQuestScripts,
    ...lostRelicsScripts,
    ...outpostStoryScripts,
    ...characterEpisodeScripts,
    ...eventLostRelicsScripts,
];
