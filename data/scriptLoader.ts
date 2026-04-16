import type { Script } from '../types';

// Module-level cache for chapter file content promises
const chapterContentCache = new Map<string, Promise<string>>();

/**
 * 스크립트 콘텐츠를 로드하는 함수를 생성합니다.
 * 챕터 파일을 가져와 캐싱하고, 스크립트 ID별로 콘텐츠를 분리합니다.
 */
export const createLoadContentFn = (categoryKey: string, mainChapterFile: string, scriptId: string): () => Promise<string> => {
    return async () => {
        const pathForFetch = `scripts/${categoryKey}/${mainChapterFile}`;

        if (!chapterContentCache.has(pathForFetch)) {
            chapterContentCache.set(pathForFetch, (async () => {
                try {
                    const response = await fetch(pathForFetch);
                    if (!response.ok) {
                        const errorText = await response.text().catch(() => `Could not read error response body (Status: ${response.status})`);
                        console.error(`Failed to load script chapter file from ${response.url} for script ${scriptId}. Status: ${response.status}. Response: ${errorText}`);
                        throw new Error(`HTTP error ${response.status} loading chapter file ${mainChapterFile} (for script ${scriptId}). URL: ${response.url}`);
                    }
                    return await response.text();
                } catch (error) {
                    chapterContentCache.delete(pathForFetch); // Remove promise on error to allow retry
                    const attemptedUrl = (error instanceof TypeError && error.message.includes('Failed to fetch'))
                        ? `(Attempted: ${pathForFetch})`
                        : (error instanceof Response && error.url) ? error.url : pathForFetch;
                    console.error(`Error fetching or parsing ${attemptedUrl} (script ${scriptId}) during cache population:`, error);
                    if (error instanceof Error) {
                        throw new Error(`Failed to load content (cache population phase) for script ${scriptId} from ${attemptedUrl}. Original error: ${error.message}`);
                    }
                    throw new Error(`Failed to load content (cache population phase) for script ${scriptId} from ${attemptedUrl}. Unknown error.`);
                }
            })());
        }

        try {
            const fullChapterText = await chapterContentCache.get(pathForFetch)!;

            const scriptBlocks = fullChapterText.split(/\n*@@@SCRIPT_ID:\s*/);
            let contentForId = '';
            let found = false;

            for (const block of scriptBlocks) {
                if (!block.trim()) continue;

                const idMatch = block.match(/^([^\n]+)/);
                if (idMatch && idMatch[1].trim() === scriptId) {
                    let scriptContentStartIndex = block.indexOf('\n') + 1;
                    const subTitleMatch = block.substring(scriptContentStartIndex).match(/^@@@SUB_TITLE:[^\n]*\n?/i);
                    if (subTitleMatch) {
                        scriptContentStartIndex += subTitleMatch[0].length;
                    }
                    contentForId = block.substring(scriptContentStartIndex).trim();
                    found = true;
                    break;
                }
            }

            if (!found) {
                console.warn(`Script ID "${scriptId}" not found in ${mainChapterFile} (loaded from ${pathForFetch}). This might indicate an issue with the SCRIPT_ID delimiter or the ID itself in the file.`);
                return `Error: Script content for ID "${scriptId}" not found in ${mainChapterFile}. Please check delimiters and ID.`;
            }
            return contentForId;

        } catch (error) {
            const attemptedUrl = pathForFetch;
            console.error(`Error processing content for ${attemptedUrl} (script ${scriptId}) from cache:`, error);
            if (error instanceof Error) {
                throw new Error(`Failed to get content for script ${scriptId} from ${attemptedUrl} (cached attempt). Original error: ${error.message}`);
            }
            throw new Error(`Failed to get content for script ${scriptId} from ${attemptedUrl} (cached attempt). Unknown error.`);
        }
    };
};

/**
 * 스크립트 데이터 정의를 위한 간단한 타입 (loadContent 제외)
 */
export type ScriptData = Omit<Script, 'loadContent' | 'searchableContent' | 'searchableSpeakers'>;

/**
 * 스크립트 데이터 배열을 완전한 Script 객체 배열로 변환합니다.
 */
export const buildScripts = (scripts: ScriptData[]): Script[] => {
    return scripts.map(script => ({
        ...script,
        searchableContent: '',
        searchableSpeakers: '',
        loadContent: function () {
            return createLoadContentFn(this.categoryKey, this.mainChapterFile, this.id)();
        }
    }));
};
