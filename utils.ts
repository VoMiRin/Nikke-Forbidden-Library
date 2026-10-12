
export const DOCUMENT_STYLE_CATEGORIES = new Set([
  'lost_relics',
]);

export const isDocumentStyleCategory = (categoryKey?: string): boolean => (
  typeof categoryKey === 'string' && DOCUMENT_STYLE_CATEGORIES.has(categoryKey)
);

const normalizeSearchText = (value: string): string => (
  value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
);

const NARRATION_LABELS = new Set([
  'LOCATION', 'SOUND', 'NARRATION', '나래이션', '나레이션', 'MUSIC', 'EFFECTS',
  'ACTION', 'TRANSITION', 'FADE IN', 'FADE OUT', 'CUT TO', 'INT', 'EXT', 'SYSTEM', '시스템', '알림',
]);

// Reviewed field labels in the source corpus, not character aliases. Ordinary
// anonymous speakers, dialogue nicknames and names containing digits stay valid.
const DOCUMENT_FIELD_LABELS = new Set([
  '제목', '내용', '장소', '시간', '용도', '서명자', '타겟', '부사령관실',
  '노이즈 게릴라 콘서트. 장소', '슈가 커피 레시피',
  '카페 서비스', '카페 신메뉴 맛', '미카의 서비스', '미카가 만든 신메뉴 맛',
]);

const isSpeakerLabel = (name: string): boolean => {
  const label = name.normalize('NFKC').trim();
  const unwrapped = label.replace(/^\[([^\[\]]+)\]$/, '$1');
  return !!label && label.length < 75
    && !/[\[\]]/.test(unwrapped)
    && !NARRATION_LABELS.has(unwrapped.toUpperCase().replace(/\.$/, ''))
    && !DOCUMENT_FIELD_LABELS.has(unwrapped);
};

const isNarrativeColonLine = (line: string, title?: string): boolean => {
  if (/^\(.*\)$/.test(line)) return true;
  // Times and ratios are prose, even though they contain a colon.
  if (/^(?:(?:다음날\s*)?(?:오전|오후|AM|PM)|현재\s*시각|평일\s*\/|휴대폰에 뜬 숫자가)\s*[\d?]+\s*:/i.test(line)
    || /^\d{1,2}\s*:\s*\d{2}(?:\D|$)/.test(line)
    || /^[^:]*\d+\s*:\s*\d+\s*(?:로|사이즈|비율)/.test(line)) return true;
  const endCard = line.match(/^(.+?)\s*:\s*(?:END|BEGIN|TO BE CONTINUED)[.·…\s]*$/i);
  if (!endCard) return false;
  const label = normalizeSearchText(endCard[1]);
  const storyTitle = title ? normalizeSearchText(title) : '';
  return !!storyTitle && (label === storyTitle || label.endsWith(` ${storyTitle}`)
    // The original end card spells this title differently from its manifest.
    || (storyTitle === 'lord for justice' && label === 'road, for justice'));
};

export interface SpeakerExtraction {
  name: string;
  lines: string[];
  dialogueCount: number;
}

// Helper function to extract searchable text from script content
export const extractTextFromScriptContent = (
  content: string | undefined,
  options?: { categoryKey?: string; title?: string },
): { content: string; displayContent: string; speakers: string; speakerContent: Record<string, string>; speakerDetails: Record<string, SpeakerExtraction> } => {
  if (typeof content !== 'string' || !content) { // Guard against null, undefined, or non-string
    return { content: "", displayContent: "", speakers: "", speakerContent: {}, speakerDetails: {} };
  }

  const documentStyleMode = isDocumentStyleCategory(options?.categoryKey);
  let searchableText = "";
  const speakerSet = new Set<string>();
  const speakerContentMap = new Map<string, string[]>();
  const speakerDetails = new Map<string, SpeakerExtraction>();
  const lines = content.split('\n');
  let inMessengerBlock = false;
  let inMessageBubble = false;
  let currentMessengerSender: string | null = null;
  let currentMessengerMessageIsSystem = false;
  const messengerStack: { sender: string | null; isSystem: boolean }[] = [];

  const addSpeakerContent = (speaker: string, text: string, isDialogue = true) => {
    const normalizedSpeaker = normalizeSearchText(speaker);
    const normalizedText = normalizeSearchText(text);

    if (!isSpeakerLabel(speaker) || !normalizedText) {
      return;
    }
    speakerSet.add(normalizedSpeaker);

    if (!speakerContentMap.has(normalizedSpeaker)) {
      speakerContentMap.set(normalizedSpeaker, []);
    }

    speakerContentMap.get(normalizedSpeaker)?.push(normalizedText);
    if (!speakerDetails.has(normalizedSpeaker)) {
      speakerDetails.set(normalizedSpeaker, { name: speaker.normalize('NFKC').trim(), lines: [], dialogueCount: 0 });
    }
    const details = speakerDetails.get(normalizedSpeaker)!;
    details.lines.push(text.normalize('NFKC').replace(/\s+/g, ' ').trim());
    if (isDialogue) details.dialogueCount += 1;
  };

  for (const line of lines) {
    const trimmedLine = line.trim();

    // Messenger block handling
    if (trimmedLine.match(/^\[MESSENGER_START.*?\]$/i)) {
      inMessengerBlock = true;
      const titleMatch = trimmedLine.match(/TITLE="([^"]+)"/i);
      if (titleMatch && titleMatch[1]) {
        searchableText += titleMatch[1] + " ";
      }
      continue;
    }
    if (trimmedLine.match(/^\[MESSENGER_END\]$/i)) {
      inMessengerBlock = false;
      messengerStack.length = 0;
      inMessageBubble = false;
      currentMessengerSender = null;
      currentMessengerMessageIsSystem = false;
      continue;
    }

    if (inMessengerBlock) {
      if (trimmedLine.match(/^\[MSG\s+SENDER="([^"]+?)".*?\]$/i)) {
        if (inMessageBubble) messengerStack.push({ sender: currentMessengerSender, isSystem: currentMessengerMessageIsSystem });
        inMessageBubble = true;
        currentMessengerSender = null;
        currentMessengerMessageIsSystem = false;
        const senderMatch = trimmedLine.match(/SENDER="([^"]+)"/i);
        if (senderMatch && senderMatch[1]) {
          const currentSender = senderMatch[1];
          currentMessengerSender = currentSender;
          currentMessengerMessageIsSystem = !!trimmedLine.match(/IS_SYSTEM="true"/i);
        }
        continue;
      }
      if (trimmedLine.match(/^\[MSG_END\]$/i)) {
        const previous = messengerStack.pop();
        inMessageBubble = !!previous;
        currentMessengerSender = previous?.sender ?? null;
        currentMessengerMessageIsSystem = previous?.isSystem ?? false;
        continue;
      }
      if (inMessageBubble) {
        // Structural choice tags are not dialogue lines. Nested messages restore
        // their parent sender after MSG_END.
        if (/^\[(?:CHOICE_|OPTION(?:\s|_)|NEXT_|IMAGE:|STICKER:)/i.test(trimmedLine)) {
          continue;
        }
        searchableText += trimmedLine + " ";
        if (currentMessengerSender && !currentMessengerMessageIsSystem) {
          addSpeakerContent(currentMessengerSender, trimmedLine);
        }
        continue;
      }
    }

    // Existing rules for non-messenger content
    if (trimmedLine === '---' || 
        trimmedLine.match(/^\[SCENE START\]/i) || 
        trimmedLine.match(/^\[SCENE END\]/i) ||
        trimmedLine.match(/^\[CHOICE_START\]/i) ||
        trimmedLine.match(/^\[CHOICE_END\]/i) ||
        trimmedLine.match(/^\[CHOICE_PROMPT=".*?"\]/i) ||
        trimmedLine.match(/^\[OPTION TEXT=".*?"\]/i) ||
        trimmedLine.match(/^\[OPTION_END\]/i) ||
        trimmedLine.match(/^\[NEXT_SUBCHAPTER_BUTTON.*?\]/i)
        ) {
      continue; 
    }
    
    const actionDialogueMatch = trimmedLine.match(/^([^\[]+)\[ACTION\]:\s*(.*)/i);
    if (actionDialogueMatch) {
      const potentialSpeaker = actionDialogueMatch[1].trim();
      const actionText = actionDialogueMatch[2].trim();
      if (isSpeakerLabel(potentialSpeaker) && actionText) {
        addSpeakerContent(potentialSpeaker, actionText, false);
      }
      searchableText += actionText + " ";
      continue;
    }

    // A colon inside [시스템: ...] is not a speaker delimiter. A complete
    // bracketed nickname followed by a colon, e.g. [블랙로즈]: ..., is dialogue.
    const plainLine = trimmedLine.replace(/^\*{1,3}(.+?)\*{1,3}$/, '$1').trim();
    const timestampedChat = plainLine.match(/^\[([^\[\]]+)\]\s*\[(?:(?:오전|오후|AM|PM)\s*)?[\d?]{1,2}\s*:\s*[\d?]{2}(?::[\d?]{2})?\]\s*(.+)$/i);
    const dialogueMatch = documentStyleMode || isNarrativeColonLine(plainLine, options?.title)
      ? null : timestampedChat ?? plainLine.match(/^(\[[^\[\]:]+\]|[^:\[\]]+)\s*:\s*(.+)$/);
    if (dialogueMatch && isSpeakerLabel(dialogueMatch[1])) {
      const dialogueText = dialogueMatch[2].trim();
      addSpeakerContent(dialogueMatch[1].trim(), dialogueText);
      searchableText += dialogueText + " ";
      continue;
    }

    const narrationKeywordMatch = trimmedLine.match(/^(Location|SOUND|NARRATION|MUSIC|EFFECTS|ACTION|TRANSITION|FADE IN|FADE OUT|CUT TO|INT\.|EXT\.|SYSTEM)[:\s](.*)/i);
    if (narrationKeywordMatch && narrationKeywordMatch[2]) {
        searchableText += narrationKeywordMatch[2].trim() + " ";
        continue;
    }
    
    const parentheticalMatch = trimmedLine.match(/^\((.*)\)$/);
    if (parentheticalMatch && parentheticalMatch[1]) {
        searchableText += parentheticalMatch[1].trim() + " ";
        continue;
    }
    
    // Rejected speaker lines remain searchable as narrative/document text.
    // Structural tags were already consumed above; do not discard system notices.
    if (trimmedLine && !trimmedLine.startsWith('@@@')) {
        searchableText += trimmedLine + " ";
    }
  }

  const speakers = Array.from(speakerSet).join(' ');
  const finalContent = normalizeSearchText(searchableText);
  const speakerContent = Object.fromEntries(
    Array.from(speakerContentMap.entries()).map(([speaker, speakerLines]) => [
      speaker,
      normalizeSearchText(speakerLines.join(' ')),
    ])
  );

  return {
    content: finalContent,
    displayContent: searchableText.normalize('NFKC').replace(/\s+/g, ' ').trim(),
    speakers,
    speakerContent,
    speakerDetails: Object.fromEntries(speakerDetails),
  };
};
