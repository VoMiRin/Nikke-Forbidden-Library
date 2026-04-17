
export const DOCUMENT_STYLE_CATEGORIES = new Set([
  'lost_relics',
]);

export const isDocumentStyleCategory = (categoryKey?: string): boolean => (
  typeof categoryKey === 'string' && DOCUMENT_STYLE_CATEGORIES.has(categoryKey)
);

// Helper function to extract searchable text from script content
export const extractTextFromScriptContent = (
  content: string | undefined,
  options?: { categoryKey?: string },
): { content: string; speakers: string } => {
  if (typeof content !== 'string' || !content) { // Guard against null, undefined, or non-string
    return { content: "", speakers: "" };
  }

  const documentStyleMode = isDocumentStyleCategory(options?.categoryKey);
  let searchableText = "";
  const speakerSet = new Set<string>();
  const lines = content.split('\n');
  let inMessengerBlock = false;
  let inMessageBubble = false;

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
      continue;
    }

    if (inMessengerBlock) {
      if (trimmedLine.match(/^\[MSG\s+SENDER="([^"]+?)".*?\]$/i)) {
        inMessageBubble = true;
        const senderMatch = trimmedLine.match(/SENDER="([^"]+)"/i);
        if (senderMatch && senderMatch[1]) {
          const currentSender = senderMatch[1];
          if (!trimmedLine.match(/IS_SYSTEM="true"/i)) {
             speakerSet.add(currentSender.toLowerCase());
          }
        }
        continue;
      }
      if (trimmedLine.match(/^\[MSG_END\]$/i)) {
        inMessageBubble = false;
        continue;
      }
      if (inMessageBubble) {
        // Inside a message bubble, add text content, ignore image/sticker tags for search
        if (trimmedLine.match(/^\[IMAGE:.*?\]$/i) || trimmedLine.match(/^\[STICKER:.*?\]$/i)) {
          continue;
        }
        searchableText += trimmedLine + " ";
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
        searchableText += actionDialogueMatch[2].trim() + " ";
        continue;
    }

    const dialogueMatch = documentStyleMode ? null : trimmedLine.match(/^([^:]+):\s*(.*)/);
    if (dialogueMatch && dialogueMatch[1] && dialogueMatch[1].trim().length < 75 && dialogueMatch[2]) {
      const potentialSpeaker = dialogueMatch[1].trim();
      const upperSpeakerForCheck = potentialSpeaker.toUpperCase();
      const narrationKeywords = ['LOCATION', 'SOUND', 'NARRATION', '나래이션', 'MUSIC', 'EFFECTS', 'ACTION', 'TRANSITION', 'FADE IN', 'FADE OUT', 'CUT TO', 'INT', 'EXT', 'SYSTEM'];
      if (!narrationKeywords.includes(upperSpeakerForCheck.replace(/\.$/, ''))) {
        speakerSet.add(potentialSpeaker.toLowerCase());
        searchableText += dialogueMatch[2].trim() + " "; 
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
  const finalContent = searchableText.replace(/\s+/g, ' ').trim().toLowerCase();

  return { content: finalContent, speakers: speakers };
};
