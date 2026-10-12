
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

export interface SpeakerExtraction {
  name: string;
  lines: string[];
  dialogueCount: number;
}

// Helper function to extract searchable text from script content
export const extractTextFromScriptContent = (
  content: string | undefined,
  options?: { categoryKey?: string },
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

    if (!normalizedSpeaker || !normalizedText) {
      return;
    }

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
          if (!currentMessengerMessageIsSystem) {
             speakerSet.add(normalizeSearchText(currentSender));
          }
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
      if (potentialSpeaker && potentialSpeaker.length < 75 && actionText) {
        speakerSet.add(normalizeSearchText(potentialSpeaker));
        addSpeakerContent(potentialSpeaker, actionText, false);
      }
      searchableText += actionText + " ";
      continue;
    }

    const dialogueMatch = documentStyleMode ? null : trimmedLine.match(/^([^:]+):\s*(.*)/);
    if (dialogueMatch && dialogueMatch[1] && dialogueMatch[1].trim().length < 75 && dialogueMatch[2]) {
      const potentialSpeaker = dialogueMatch[1].trim();
      const upperSpeakerForCheck = potentialSpeaker.toUpperCase();
      const narrationKeywords = ['LOCATION', 'SOUND', 'NARRATION', '나래이션', 'MUSIC', 'EFFECTS', 'ACTION', 'TRANSITION', 'FADE IN', 'FADE OUT', 'CUT TO', 'INT', 'EXT', 'SYSTEM'];
      if (!narrationKeywords.includes(upperSpeakerForCheck.replace(/\.$/, ''))) {
        const dialogueText = dialogueMatch[2].trim();
        speakerSet.add(normalizeSearchText(potentialSpeaker));
        addSpeakerContent(potentialSpeaker, dialogueText);
        searchableText += dialogueText + " "; 
        continue;
      }
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
    
    if (trimmedLine && !dialogueMatch && !narrationKeywordMatch && !parentheticalMatch && !trimmedLine.startsWith('[') && !trimmedLine.endsWith(']')) {
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
