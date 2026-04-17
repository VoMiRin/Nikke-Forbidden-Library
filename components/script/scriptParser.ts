import type {
    ScriptElement,
    NarrationElement,
    ChoiceOption,
    MessengerContentElement,
    MessengerChoiceOption,
    NextRoute
} from '../../types';
import { isDocumentStyleCategory } from '../../utils';

// MessengerChoiceOption 타입이 messages 필드를 지원하지 않을 경우를 대비한 확장 타입
export interface ExtendedMessengerChoiceOption extends Omit<MessengerChoiceOption, 'messages'> {
    messages?: MessengerContentElement[];
}

let choiceIdCounter = 0;
let parserScriptScope = 'global';

const generateChoiceId = () => `${parserScriptScope}::choice_${choiceIdCounter++}`;
const generateOptionId = (choiceId: string, optionIndex: number) => `${choiceId}_opt_${optionIndex}`;

const MAX_PARSER_RECURSION_DEPTH = 50;

type ParserMode = 'default' | 'document';

const shouldTreatLineAsDialogue = (line: string, parserMode: ParserMode): boolean => {
    if (parserMode === 'document') {
        return false;
    }

    const dialogueMatch = line.match(/^([^:]+):\s*(.*)/);
    if (!dialogueMatch ||
        !dialogueMatch[1] ||
        !dialogueMatch[1].trim() ||
        dialogueMatch[2] === undefined ||
        dialogueMatch[1].trim().length >= 75 ||
        dialogueMatch[1].trim().startsWith('[')) {
        return false;
    }

    const potentialSpeaker = dialogueMatch[1].trim();
    const upperSpeakerForCheck = potentialSpeaker.toUpperCase();
    const narrationKeywords = ['LOCATION', 'SOUND', 'NARRATION', '나래이션', 'MUSIC', 'EFFECTS', 'ACTION', 'TRANSITION', 'FADE IN', 'FADE OUT', 'CUT TO', 'INT', 'EXT', 'SYSTEM'];

    return !narrationKeywords.map(k => k.toUpperCase()).includes(upperSpeakerForCheck.replace(/\.$/, ''));
};

const parseScriptElementsRecursive = (
    lines: string[],
    currentLineIndex: number,
    stopAtTag?: '[OPTION_END]' | '[CHOICE_END]' | '[MESSENGER_END]' | '[MSG_END]',
    depth = 0,
    parserMode: ParserMode = 'default',
): { elements: ScriptElement[], nextLineIndex: number } => {
    if (depth > MAX_PARSER_RECURSION_DEPTH) {
        console.error("Script parser exceeded max recursion depth. Possible malformed nested choices or messenger blocks.");
        const errorElement: NarrationElement = {
            type: 'narration',
            text: '[Error: Script parsing exceeded maximum recursion depth. Check for deeply nested or unterminated blocks.]',
            speaker: 'SYSTEM'
        };
        return {
            elements: [errorElement],
            nextLineIndex: lines.length
        };
    }

    const elements: ScriptElement[] = [];
    let i = currentLineIndex;

    if (currentLineIndex >= lines.length && stopAtTag && !['[CHOICE_END]', '[OPTION_END]', '[MSG_END]', '[MESSENGER_END]'].includes(stopAtTag)) {
        return { elements: [], nextLineIndex: lines.length };
    }

    while (i < lines.length) {
        const currentLineText = lines[i];
        if (typeof currentLineText !== 'string') {
            console.error("Script parser encountered non-string line at index:", i, "value:", currentLineText);
            i++;
            continue;
        }
        const line = currentLineText.trim();

        if (stopAtTag && line.toUpperCase() === stopAtTag) {
            return { elements, nextLineIndex: i + 1 };
        }

        const nextSubChapterButtonMatch = line.match(/^\[NEXT_SUBCHAPTER_BUTTON(?:\s+TEXT="(.+?)")?\]$/i);
        if (nextSubChapterButtonMatch) {
            const routes: NextRoute[] = [];
            let lookAheadIndex = i + 1;

            while (lookAheadIndex < lines.length) {
                const routeLine = lines[lookAheadIndex]?.trim();
                if (!routeLine) {
                    lookAheadIndex++;
                    continue;
                }

                const conditionalRouteMatch = routeLine.match(/^\[NEXT_ROUTE\s+IF_CHOICE="(.+?)"\s+OPTION="(.+?)"\s+TARGET="(.+?)"\]$/i);
                const defaultRouteMatch = routeLine.match(/^\[NEXT_ROUTE\s+DEFAULT\s+TARGET="(.+?)"\]$/i);
                const directTargetMatch = routeLine.match(/^\[NEXT_TARGET\s+SCRIPT_ID="(.+?)"\]$/i);

                if (conditionalRouteMatch) {
                    routes.push({
                        choiceId: conditionalRouteMatch[1],
                        optionValue: conditionalRouteMatch[2],
                        targetScriptId: conditionalRouteMatch[3],
                    });
                    lookAheadIndex++;
                    continue;
                }

                if (defaultRouteMatch) {
                    routes.push({
                        isDefault: true,
                        targetScriptId: defaultRouteMatch[1],
                    });
                    lookAheadIndex++;
                    continue;
                }

                if (directTargetMatch) {
                    routes.push({
                        isDefault: true,
                        targetScriptId: directTargetMatch[1],
                    });
                    lookAheadIndex++;
                    continue;
                }

                break;
            }

            elements.push({
                type: 'next_subchapter_button',
                buttonText: nextSubChapterButtonMatch[1] || 'Next Chapter Part',
                targetScriptId: routes.find(route => route.isDefault)?.targetScriptId,
                routes: routes.length > 0 ? routes : undefined,
            });
            i = lookAheadIndex;
            continue;
        }

        const choicePromptMatch = line.match(/^\[CHOICE_PROMPT="(.+?)"\]$/i);
        const choiceStartMatch = line.match(/^\[CHOICE_START(?:\s+ID="(.+?)")?\]$/i);

        if (choicePromptMatch || choiceStartMatch) {
            let choiceId = choiceStartMatch?.[1] || generateChoiceId();
            const prompt = choicePromptMatch ? choicePromptMatch[1] : undefined;
            const options: ChoiceOption[] = [];
            let optionIndex = 0;

            let contentStartIndex = i + 1;
            const nestedChoiceStartAfterPromptMatch = lines[contentStartIndex]?.trim().match(/^\[CHOICE_START(?:\s+ID="(.+?)")?\]$/i);
            if (choicePromptMatch && nestedChoiceStartAfterPromptMatch) {
                choiceId = nestedChoiceStartAfterPromptMatch[1] || choiceId;
                contentStartIndex++;
            }

            let optParseIndex = contentStartIndex;

            let nextChoiceEndIndex = -1;
            let openChoiceBlocks = 1;
            for (let j = contentStartIndex; j < lines.length; j++) {
                const currentLineForChoiceEnd = lines[j];
                if (typeof currentLineForChoiceEnd !== 'string') {
                    continue;
                }
                const trimmedCurrentLine = currentLineForChoiceEnd.trim().toUpperCase();
                if (trimmedCurrentLine.match(/^\[CHOICE_START(?:\s+ID=".+?")?\]$/i)) {
                    openChoiceBlocks++;
                } else if (trimmedCurrentLine === '[CHOICE_END]') {
                    openChoiceBlocks--;
                    if (openChoiceBlocks === 0) {
                        nextChoiceEndIndex = j;
                        break;
                    }
                }
            }

            const effectiveChoiceEndIndex = nextChoiceEndIndex !== -1 ? nextChoiceEndIndex : lines.length;

            while (optParseIndex < effectiveChoiceEndIndex) {
                const currentOptionLineText = lines[optParseIndex];
                if (typeof currentOptionLineText !== 'string') {
                    console.error("Script parser encountered non-string option line at index:", optParseIndex, "value:", currentOptionLineText);
                    optParseIndex++;
                    continue;
                }
                const trimmedOptionLine = currentOptionLineText.trim();

                if (!trimmedOptionLine) {
                    optParseIndex++;
                    continue;
                }
                const optionTextMatch = trimmedOptionLine.match(/^\[OPTION(?:\s+TEXT="(.+?)")(?:\s+VALUE="(.+?)")?\]$/i);

                if (optionTextMatch) {
                    const optionId = generateOptionId(choiceId, optionIndex++);
                    const optionValue = optionTextMatch[2] || optionId;
                    const parsedOptionContent = parseScriptElementsRecursive(lines, optParseIndex + 1, '[OPTION_END]', depth + 1, parserMode);
                    options.push({
                        optionId,
                        text: optionTextMatch[1],
                        value: optionValue,
                        elements: parsedOptionContent.elements,
                    });
                    optParseIndex = parsedOptionContent.nextLineIndex;
                } else {
                    optParseIndex++;
                }
            }

            elements.push({ type: 'choice_block', choiceId, prompt, options });
            i = effectiveChoiceEndIndex + 1;
            continue;
        }

        const messengerStartMatch = line.match(/^\[MESSENGER_START(?:\s+TITLE="([^"]+?)")?(?:\s+PARTICIPANTS="([^"]+?)")?\]$/i);
        if (messengerStartMatch) {
            const appTitle = messengerStartMatch[1];
            const participantsString = messengerStartMatch[2];
            const participants = participantsString ? participantsString.split(',').map(p => p.trim()) : undefined;
            const messages: MessengerContentElement[] = [];
            let msgParseIndex = i + 1;

            let nestedMessengerEndIndex = -1;
            let openMessengerBlocks = 1;
            for (let j = msgParseIndex; j < lines.length; j++) {
                const currentLineForMessengerEnd = lines[j];
                if (typeof currentLineForMessengerEnd !== 'string') continue;
                const trimmedCurrentLine = currentLineForMessengerEnd.trim().toUpperCase();
                if (trimmedCurrentLine.startsWith('[MESSENGER_START')) {
                    openMessengerBlocks++;
                } else if (trimmedCurrentLine === '[MESSENGER_END]') {
                    openMessengerBlocks--;
                    if (openMessengerBlocks === 0) {
                        nestedMessengerEndIndex = j;
                        break;
                    }
                }
            }
            const effectiveMessengerEnd = nestedMessengerEndIndex !== -1 ? nestedMessengerEndIndex : lines.length;

            while (msgParseIndex < effectiveMessengerEnd) {
                const currentMsgLineText = lines[msgParseIndex];
                if (typeof currentMsgLineText !== 'string') { msgParseIndex++; continue; }
                const trimmedMsgLine = currentMsgLineText.trim();

                if (!trimmedMsgLine) { msgParseIndex++; continue; }

                const msgHeaderMatch = trimmedMsgLine.match(/^\[MSG\s+SENDER="([^"]+?)"(?:\s+IS_SENDER="(true|false)")?(?:\s+IS_SYSTEM="(true|false)")?\]$/i);

                if (/^(메시지 전송에 실패했습니다|이용이 제한된 계정입니다|메시지를 보낼 수 없습니다\.\s*블록\/삭제된 계정입니다)\.?$/.test(trimmedMsgLine)) {
                    messages.push({
                        type: 'message_status',
                        text: trimmedMsgLine,
                        statusType: 'delivery_failed',
                    });
                    msgParseIndex++;
                } else if (msgHeaderMatch) {
                    const sender = msgHeaderMatch[1];
                    const isSender = msgHeaderMatch[2]?.toLowerCase() === 'true';
                    const isSystem = msgHeaderMatch[3]?.toLowerCase() === 'true';

                    // Find matching [MSG_END], accounting for nested [MSG] blocks
                    let msgEndIndex = -1;
                    let openMsgBlocks = 1;
                    let j = msgParseIndex + 1;
                    while (j < effectiveMessengerEnd) {
                        const lineContent = lines[j]?.trim();
                        if (lineContent.match(/^\[MSG\s+SENDER="[^"]+?".*?\]$/i)) {
                            openMsgBlocks++;
                        } else if (lineContent.toUpperCase() === '[MSG_END]') {
                            openMsgBlocks--;
                            if (openMsgBlocks === 0) {
                                msgEndIndex = j;
                                break;
                            }
                        }
                        j++;
                    }

                    const effectiveMsgEnd = msgEndIndex !== -1 ? msgEndIndex : j;
                    const messageBlockLines = lines.slice(msgParseIndex + 1, effectiveMsgEnd);

                    const firstContentLineTrimmed = messageBlockLines.find(l => l.trim() !== '')?.trim().toUpperCase();

                    const embeddedChoiceStartMatch = firstContentLineTrimmed?.match(/^\[CHOICE_START(?:\s+ID="(.+?)")?\]$/i);

                    if (isSender && embeddedChoiceStartMatch) {
                        const choiceId = embeddedChoiceStartMatch[1] || generateChoiceId();
                        const options: ExtendedMessengerChoiceOption[] = [];
                        let optionIndex = 0;

                        let lineIdx = 0;
                        while (lineIdx < messageBlockLines.length) {
                            const optionLine = messageBlockLines[lineIdx];
                            const trimmedOptionLine = optionLine.trim();
                            const optionTextMatch = trimmedOptionLine.match(/^\[OPTION(?:\s+TEXT="(.+?)")(?:\s+VALUE="(.+?)")?\]$/i);
                            if (optionTextMatch) {
                                const optionId = generateOptionId(choiceId, optionIndex++);
                                // Find the content between [OPTION TEXT="..."] and [OPTION_END]
                                let optionEndIdx = lineIdx + 1;
                                while (optionEndIdx < messageBlockLines.length && messageBlockLines[optionEndIdx].trim().toUpperCase() !== '[OPTION_END]') {
                                    optionEndIdx++;
                                }

                                // Extract the lines between option start and end
                                const optionContentLines = messageBlockLines.slice(lineIdx + 1, optionEndIdx);

                                // Parse the option content as messenger messages
                                const optionMessages: MessengerContentElement[] = [];
                                let optContentIdx = 0;

                                while (optContentIdx < optionContentLines.length) {
                                    const optContentLine = optionContentLines[optContentIdx];
                                    if (!optContentLine || !optContentLine.trim()) {
                                        optContentIdx++;
                                        continue;
                                    }

                                    const optMsgMatch = optContentLine.trim().match(/^\[MSG\s+SENDER="([^"]+?)"(?:\s+IS_SENDER="(true|false)")?(?:\s+IS_SYSTEM="(true|false)")?\]$/i);
                                    if (optMsgMatch) {
                                        const optSender = optMsgMatch[1];
                                        const optIsSender = optMsgMatch[2]?.toLowerCase() === 'true';
                                        const optIsSystem = optMsgMatch[3]?.toLowerCase() === 'true';

                                        // Find the matching [MSG_END]
                                        let optMsgEndIdx = optContentIdx + 1;
                                        let openOptMsgBlocks = 1;
                                        while (optMsgEndIdx < optionContentLines.length) {
                                            const optMsgLine = optionContentLines[optMsgEndIdx]?.trim();
                                            if (optMsgLine.match(/^\[MSG\s+SENDER="[^"]+?".*?\]$/i)) {
                                                openOptMsgBlocks++;
                                            } else if (optMsgLine.toUpperCase() === '[MSG_END]') {
                                                openOptMsgBlocks--;
                                                if (openOptMsgBlocks === 0) {
                                                    break;
                                                }
                                            }
                                            optMsgEndIdx++;
                                        }

                                        // Extract message content
                                        const optMsgContent = optionContentLines.slice(optContentIdx + 1, optMsgEndIdx).join('\n').trim();

                                        if (optMsgContent) {
                                            optionMessages.push({
                                                type: 'message_bubble',
                                                sender: optSender,
                                                text: optMsgContent,
                                                isSender: optIsSender,
                                                isSystem: optIsSystem
                                            });
                                        }

                                        optContentIdx = optMsgEndIdx + 1;
                                    } else {
                                        optContentIdx++;
                                    }
                                }

                                options.push({
                                    optionId,
                                    text: optionTextMatch[1],
                                    value: optionTextMatch[2] || optionId,
                                    messages: optionMessages, // Store the parsed messages for this option
                                });

                                lineIdx = optionEndIdx + 1; // Move to the line after [OPTION_END]
                            } else {
                                lineIdx++;
                            }
                        }

                        messages.push({
                            type: 'message_bubble',
                            sender,
                            isSender,
                            isSystem,
                            choice: {
                                choiceId,
                                options,
                            }
                        });

                    } else {
                        const textContent = messageBlockLines.join('\n');
                        messages.push({
                            type: 'message_bubble',
                            sender,
                            text: textContent.trim() || undefined,
                            isSender,
                            isSystem
                        });
                    }
                    msgParseIndex = effectiveMsgEnd + 1; // Move index past the content and the [MSG_END] line
                } else {
                    msgParseIndex++; // Skip unknown lines inside messenger block
                }
            }
            elements.push({ type: 'messenger_app', appTitle, participants, messages });
            i = effectiveMessengerEnd + 1;
            continue;
        }

        if (line === '---') {
            elements.push({ type: 'scene_break' });
        } else if (line.match(/^\[SCENE START\]/i) || line.match(/^\[SCENE END\]/i)) {
            elements.push({ type: 'narration', text: line, isSceneMarker: true, speaker: 'SCENE' });
        } else {
            const narrationKeywordMatch = line.match(/^(LOCATION|SOUND|NARRATION|나래이션|MUSIC|EFFECTS|ACTION|TRANSITION|FADE IN|FADE OUT|CUT TO|INT\.|EXT\.|SYSTEM)[:\s](.*)/i);
            const actionDialogueMatch = line.match(/^([^\[]+)\[ACTION\]:\s*(.*)/i);

            if (narrationKeywordMatch) {
                elements.push({
                    type: 'narration',
                    text: narrationKeywordMatch[2].trim(),
                    speaker: narrationKeywordMatch[1].split(':')[0].replace(/\.$/, '')
                });
            } else if (actionDialogueMatch) {
                elements.push({
                    type: 'narration',
                    speaker: `${actionDialogueMatch[1].trim()}[ACTION]`,
                    text: actionDialogueMatch[2].trim()
                });
            } else {
                const dialogueMatch = line.match(/^([^:]+):\s*(.*)/);
                if (shouldTreatLineAsDialogue(line, parserMode) && dialogueMatch) {

                    const potentialSpeaker = dialogueMatch[1].trim();
                    const dialogueText = dialogueMatch[2].trim();
                    elements.push({ type: 'dialogue', speaker: potentialSpeaker, dialogue: dialogueText });
                } else {
                    const parentheticalMatch = line.match(/^\((.*)\)$/);
                    if (parentheticalMatch) {
                        elements.push({ type: 'narration', text: parentheticalMatch[1].trim(), speaker: 'ACTION' });
                    } else if (line) {
                        elements.push({ type: 'narration', text: line });
                    }
                }
            }
        }
        i++;
    }
    return { elements, nextLineIndex: i };
};

/**
 * 스크립트 콘텐츠를 파싱하여 ScriptElement 배열로 반환합니다.
 */
export const parseScriptContent = (
    content: string | undefined,
    options?: { scriptId?: string; categoryKey?: string },
): ScriptElement[] => {
    if (!content) return [];
    choiceIdCounter = 0;
    parserScriptScope = options?.scriptId || 'global';
    const lines = content.split('\n');
    const parserMode: ParserMode = isDocumentStyleCategory(options?.categoryKey) ? 'document' : 'default';
    return parseScriptElementsRecursive(lines, 0, undefined, 0, parserMode).elements;
};

/**
 * 파서 상태를 리셋합니다. 테스트용.
 */
export const resetParserState = () => {
    choiceIdCounter = 0;
    parserScriptScope = 'global';
};
