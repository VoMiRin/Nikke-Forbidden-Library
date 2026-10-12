import type { MessageBubbleElement, MessengerAppElement, MessengerContentElement, ScriptElement } from '../../types';
import type { ExtendedMessengerChoiceOption } from './scriptParser';

/** 선택지 순번을 A, B, C…로 표시한다 */
export const optionKey = (index: number) => String.fromCharCode(65 + index);

/**
 * "모든 분기 보기"에서 메신저를 그리는 단위.
 * 선택 답장이 있는 메시지를 갈래마다 `branch-start`(답장 문구 포함) → 그 갈래의 메시지들 → `branch-end`로 펼친다.
 */
export type MessengerBranchItem =
  | { kind: 'message'; message: MessengerContentElement }
  | { kind: 'branch-start'; label: string; sender: string; replyText: string; choiceId: string; optionValue: string }
  | { kind: 'branch-end' };

const flattenMessages = (messages: MessengerContentElement[], labelPrefix: string): MessengerBranchItem[] => {
  const items: MessengerBranchItem[] = [];

  for (const message of messages) {
    if (message.type === 'message_bubble' && message.choice) {
      message.choice.options.forEach((option, index) => {
        const label = `${labelPrefix}${optionKey(index)}`;
        items.push({
          kind: 'branch-start',
          label,
          sender: message.sender,
          replyText: option.text,
          choiceId: message.choice!.choiceId,
          optionValue: option.value,
        });
        const branchMessages = (option as ExtendedMessengerChoiceOption).messages ?? [];
        items.push(...flattenMessages(branchMessages, `${label}-`));
      });
      items.push({ kind: 'branch-end' });
      continue;
    }
    items.push({ kind: 'message', message });
  }

  return items;
};

export const flattenMessengerBranches = (element: MessengerAppElement): MessengerBranchItem[] => (
  flattenMessages(element.messages, '')
);

/**
 * 검색 일치 위치를 찾을 때 쓰는 목록. 인덱스가 flattenMessengerBranches와 같아서 DOM id와 맞는다.
 * 갈래 시작은 답장 문구를 보낸 메시지처럼 취급하고, 갈래 끝은 비교 대상에서 뺀다.
 */
export const getMessengerBranchSearchList = (element: MessengerAppElement): (MessengerContentElement | null)[] => (
  flattenMessengerBranches(element).map((item): MessengerContentElement | null => {
    if (item.kind === 'message') return item.message;
    if (item.kind === 'branch-start') {
      const replyBubble: MessageBubbleElement = {
        type: 'message_bubble',
        sender: item.sender,
        text: item.replyText,
        isSender: true,
      };
      return replyBubble;
    }
    return null;
  })
);

/** 장면 안에 선택지(일반·메신저)가 하나라도 있는지 */
export const hasBranchingContent = (elements: ScriptElement[]): boolean => elements.some((element) => {
  if (element.type === 'choice_block') return true;
  if (element.type === 'messenger_app') {
    return element.messages.some(message => message.type === 'message_bubble' && !!message.choice);
  }
  return false;
});

export interface ChoiceOptionLabel {
  key: string;
  text: string;
}

/**
 * 선택지 ID → 각 선택값의 표시 키(A, B…)와 문구. 분기별 다음 장면 버튼에 "A 「…」 선택 시"처럼 쓰인다.
 */
export const collectChoiceOptionKeys = (elements: ScriptElement[]): Map<string, Map<string, ChoiceOptionLabel>> => {
  const keys = new Map<string, Map<string, ChoiceOptionLabel>>();

  const visitMessages = (messages: MessengerContentElement[]) => {
    for (const message of messages) {
      if (message.type !== 'message_bubble' || !message.choice) continue;
      keys.set(message.choice.choiceId, new Map(message.choice.options.map((option, index) => [option.value, { key: optionKey(index), text: option.text }])));
      message.choice.options.forEach(option => visitMessages((option as ExtendedMessengerChoiceOption).messages ?? []));
    }
  };

  const visit = (list: ScriptElement[]) => {
    for (const element of list) {
      if (element.type === 'choice_block') {
        keys.set(element.choiceId, new Map(element.options.map((option, index) => [option.value, { key: optionKey(index), text: option.text }])));
        element.options.forEach(option => visit(option.elements));
      } else if (element.type === 'messenger_app') {
        visitMessages(element.messages);
      }
    }
  };

  visit(elements);
  return keys;
};

/**
 * 선택지 ID → 선택값 → 그 선택일 때 넘어가는 장면 ID.
 * 장면 끝의 다음 장면 버튼에 적힌 조건부 이동([NEXT_ROUTE IF_CHOICE=…])을 모은다.
 */
export const collectRouteTargets = (elements: ScriptElement[]): Map<string, Map<string, string>> => {
  const targets = new Map<string, Map<string, string>>();

  const visit = (list: ScriptElement[]) => {
    for (const element of list) {
      if (element.type === 'next_subchapter_button') {
        for (const route of element.routes ?? []) {
          if (route.isDefault || !route.choiceId || route.optionValue === undefined || !route.targetScriptId) continue;
          const byOption = targets.get(route.choiceId) ?? new Map<string, string>();
          if (!byOption.has(route.optionValue)) byOption.set(route.optionValue, route.targetScriptId);
          targets.set(route.choiceId, byOption);
        }
      } else if (element.type === 'choice_block') {
        element.options.forEach(option => visit(option.elements));
      }
    }
  };

  visit(elements);
  return targets;
};
