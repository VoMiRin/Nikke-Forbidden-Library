
export interface BaseScriptElement {
  // originalLineText: string; // Kept for potential debugging
}

export interface DialogueElement extends BaseScriptElement {
  type: 'dialogue';
  speaker?: string;
  dialogue?: string;
}

export interface NarrationElement extends BaseScriptElement {
  type: 'narration';
  text: string;
  speaker?: string; // For LOCATION, SOUND, ACTION, NARRATION (keywords)
  isSceneMarker?: boolean; // For [SCENE START/END]
}

export interface SceneBreakElement extends BaseScriptElement {
  type: 'scene_break';
}

export interface ChoiceOption {
  optionId: string;
  text: string;
  value: string;
  elements: ScriptElement[];
}

export interface ChoiceBlockElement extends BaseScriptElement {
  type: 'choice_block';
  choiceId: string;
  prompt?: string;
  options: ChoiceOption[];
}

export interface NextRoute {
  targetScriptId: string;
  choiceId?: string;
  optionValue?: string;
  isDefault?: boolean;
}

export interface NextSubChapterButtonElement extends BaseScriptElement {
  type: 'next_subchapter_button';
  buttonText: string;
  targetScriptId?: string;
  routes?: NextRoute[];
}

// New types for Messenger App
export interface MessengerChoiceOption {
  optionId: string;
  text: string;
  value: string;
}

export interface MessageBubbleElement extends BaseScriptElement {
  type: 'message_bubble';
  sender: string;
  text?: string;
  isSender?: boolean; // True if the message is from the "player" perspective (e.g., Commander)
  isSystem?: boolean; // True for system messages like "User joined"
  choice?: {
    choiceId: string;
    options: MessengerChoiceOption[];
  };
}

export interface MessageStatusElement extends BaseScriptElement {
  type: 'message_status';
  text: string;
  statusType: 'delivery_failed';
}

export type MessengerContentElement = MessageBubbleElement | MessageStatusElement;

export interface MessengerAppElement extends BaseScriptElement {
  type: 'messenger_app';
  appTitle?: string;
  participants?: string[];
  messages: MessengerContentElement[];
}

export type ScriptElement =
  | DialogueElement
  | NarrationElement
  | SceneBreakElement
  | ChoiceBlockElement
  | NextSubChapterButtonElement
  | MessengerAppElement; // Added MessengerAppElement

export interface Script {
  id: string;
  title: string; // Main Chapter Title
  categoryKey: string;
  content?: string; // Full script content, lazy-loaded
  subTitle?: string; // Sub-Chapter Title or specific part name
  searchableContent: string; // Pre-calculated for searching dialogue and narration
  searchableSpeakers: string; // Pre-calculated for searching speakers
  mainChapterFile: string; // Filename (e.g., "chapter_00.txt")
  loadContent: () => Promise<string>; // Function to load the full content
}

export interface ScriptCategory {
  key: string;
  name: string;
  icon?: React.ReactNode;
}

// Legacy type, can be kept for reference or if any old parser logic remnants exist.
// The new system primarily uses ScriptElement[].
export interface LegacyDialogueLine {
  speaker?: string;
  dialogue?: string;
  narration?: string;
  isSceneBreak?: boolean;
}
