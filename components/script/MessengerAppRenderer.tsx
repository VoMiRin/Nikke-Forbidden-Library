import React from 'react';
import type { MessengerAppElement, MessengerContentElement } from '../../types';
import type { ExtendedMessengerChoiceOption } from './scriptParser';
import { flattenMessengerBranches } from './branchView';

interface MessengerAppRendererProps {
  element: MessengerAppElement;
  keyPrefix: string;
  messageIdPrefix: string;
  highlightedSearchMatchId?: string | null;
  selectedOptions: Record<string, string>;
  onOptionSelect: (choiceId: string, optionValue: string) => void;
  onClearChoice: (choiceId: string) => void;
  /** 모든 분기 보기: 답장 갈래마다 이어지는 메시지를 모두 펼친다 (선택값은 바꾸지 않음) */
  showAllBranches?: boolean;
  /** 답장 갈래가 장면 끝에서 다른 장면으로 이어질 때 그 장면 이름 */
  getOptionDestination?: (choiceId: string, optionValue: string) => string | undefined;
}

/** 답장 갈래와 상관없이 보이는 일반 메시지 한 줄 */
const renderPlainMessage = (msg: MessengerContentElement, msgId: string, msgKey: string, searchMatchClass: string): React.ReactNode => {
  if (msg.type === 'message_status' && msg.statusType === 'delivery_failed') {
    return (
      <div id={msgId} key={msgKey} className={`flex items-center justify-center rounded-lg text-[11px] text-red-600 dark:text-[#FFB4B6] ${searchMatchClass}`}>
        <svg xmlns="http://www.w3.org/2000/svg" className="mr-1.5 h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm-1-9a1 1 0 002 0V5a1 1 0 00-2 0v4zm1 4a1 1 0 100 2 1 1 0 000-2z" clipRule="evenodd" />
        </svg>
        <span>{msg.text}</span>
      </div>
    );
  }

  if (msg.type === 'message_bubble' && msg.isSystem) {
    return (
      <div id={msgId} key={msgKey} className={`rounded-lg text-center ${searchMatchClass}`}>
        <span className="text-[11px] text-nikke-text-muted">{msg.text}</span>
      </div>
    );
  }

  if (msg.type === 'message_bubble' && msg.text) {
    return (
      <div id={msgId} key={msgKey} className={`flex rounded-[14px] ${msg.isSender ? 'justify-end' : 'justify-start'} ${searchMatchClass}`}>
        <div className={`max-w-[80%] px-3.5 py-2.5 ${msg.isSender ? 'rounded-[14px_14px_4px_14px] bg-nikke-accent text-nikke-accent-ink' : 'rounded-[14px_14px_14px_4px] bg-nikke-surface-high text-nikke-text-primary'}`}>
          {!msg.isSender && <p className="mb-[3px] text-[11px] font-semibold text-nikke-highlight">{msg.sender}</p>}
          <p className={`whitespace-pre-wrap text-sm leading-[1.6] ${msg.isSender ? 'font-medium' : ''}`}>{msg.text}</p>
        </div>
      </div>
    );
  }

  return null;
};

export const MessengerAppRenderer: React.FC<MessengerAppRendererProps> = ({
  element,
  keyPrefix,
  messageIdPrefix,
  highlightedSearchMatchId = null,
  selectedOptions,
  onOptionSelect,
  onClearChoice,
  showAllBranches = false,
  getOptionDestination,
}) => {
  const allMessages: MessengerContentElement[] = [];

  for (const msg of element.messages) {
    allMessages.push(msg);

    if (msg.type === 'message_bubble' && msg.choice) {
      const selectedOptionValue = selectedOptions[msg.choice.choiceId];
      if (selectedOptionValue) {
        const selectedOption = msg.choice.options.find(option => option.value === selectedOptionValue) as ExtendedMessengerChoiceOption;
        if (selectedOption?.messages) {
          allMessages.push(...selectedOption.messages);
        }
      }
    }
  }

  const firstUnansweredChoiceIndex = element.messages.findIndex(
    msg => msg.type === 'message_bubble' && msg.choice && !selectedOptions[msg.choice.choiceId]
  );

  let messagesToRender = allMessages;
  if (firstUnansweredChoiceIndex !== -1) {
    let messageCount = 0;
    for (let i = 0; i <= firstUnansweredChoiceIndex; i++) {
      messageCount++;
      const msg = element.messages[i];
      if (msg.type === 'message_bubble' && msg.choice && selectedOptions[msg.choice.choiceId]) {
        const selectedOption = msg.choice.options.find(option => option.value === selectedOptions[msg.choice.choiceId]) as ExtendedMessengerChoiceOption;
        if (selectedOption?.messages) {
          messageCount += selectedOption.messages.length;
        }
      }
    }
    messagesToRender = allMessages.slice(0, messageCount);
  }

  return (
    <section aria-label="메신저 기록" className="mx-auto mb-8 mt-6 w-full max-w-[440px] overflow-hidden rounded-2xl border border-nikke-border bg-nikke-surface font-sans">
      <div className="flex items-center justify-between gap-3 border-b border-nikke-border px-[18px] py-3.5">
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-semibold text-nikke-text-primary">{element.appTitle || '메신저'}</span>
          {element.participants && element.participants.length > 0 && (
            <span className="mt-0.5 block truncate text-[11px] text-nikke-text-muted">{element.participants.join(', ')}</span>
          )}
        </span>
        <span className="shrink-0 text-xs text-nikke-text-muted">메신저</span>
      </div>
      <div className="flex max-h-[58vh] flex-col gap-2.5 overflow-y-auto p-4 md:max-h-[500px]">
        {showAllBranches ? flattenMessengerBranches(element).map((item, itemIdx) => {
          const msgKey = `${keyPrefix}_branch_${itemIdx}`;
          const msgId = `${messageIdPrefix}-message-${itemIdx}`.replace(/[^a-zA-Z0-9:_-]/g, '_');
          const searchMatchClass = highlightedSearchMatchId === msgId ? 'ring-1 ring-nikke-accent/70' : '';

          if (item.kind === 'branch-start') {
            return (
              <div id={msgId} key={msgKey} className={`mt-1 flex flex-col items-end gap-2 rounded-lg ${searchMatchClass}`}>
                <p className="flex w-full items-center gap-3 text-[11px] text-nikke-accent before:h-px before:flex-1 before:bg-nikke-border after:h-px after:flex-1 after:bg-nikke-border">
                  답장 {item.label}
                </p>
                <div className="max-w-[80%] rounded-[14px_14px_4px_14px] border border-nikke-accent bg-nikke-accent/10 px-3.5 py-2.5 text-nikke-text-primary">
                  <p className="whitespace-pre-wrap text-sm font-medium leading-[1.6]">{item.replyText}</p>
                </div>
                {getOptionDestination?.(item.choiceId, item.optionValue) && (
                  <p className="text-[11px] text-nikke-highlight">
                    → 다음 장면: {getOptionDestination(item.choiceId, item.optionValue)}
                  </p>
                )}
              </div>
            );
          }

          if (item.kind === 'branch-end') {
            return (
              <p key={msgKey} id={msgId} className="mb-1 flex items-center gap-3 text-[11px] text-nikke-text-muted before:h-px before:flex-1 before:bg-nikke-border after:h-px after:flex-1 after:bg-nikke-border">
                분기 끝
              </p>
            );
          }

          return renderPlainMessage(item.message, msgId, msgKey, searchMatchClass);
        }) : messagesToRender.map((msg, msgIdx) => {
          const msgKey = `${keyPrefix}_msg_${msgIdx}`;
          const msgId = `${messageIdPrefix}-message-${msgIdx}`.replace(/[^a-zA-Z0-9:_-]/g, '_');
          const isSearchMatched = highlightedSearchMatchId === msgId;
          const searchMatchClass = isSearchMatched
            ? 'ring-1 ring-nikke-accent/70'
            : '';

          let isOriginalMessage = false;
          let messageCount = 0;

          for (let i = 0; i < element.messages.length; i++) {
            if (messageCount === msgIdx) {
              isOriginalMessage = true;
              break;
            }
            messageCount++;

            const originalMsg = element.messages[i];
            if (originalMsg.type === 'message_bubble' && originalMsg.choice && selectedOptions[originalMsg.choice.choiceId]) {
              const selectedOption = originalMsg.choice.options.find(option => option.value === selectedOptions[originalMsg.choice.choiceId]) as ExtendedMessengerChoiceOption;
              if (selectedOption?.messages) {
                messageCount += selectedOption.messages.length;
                if (msgIdx < messageCount) {
                  isOriginalMessage = false;
                  break;
                }
              }
            }
          }

          if (msg.type === 'message_bubble' && msg.choice && isOriginalMessage && !msg.isSystem) {
            const selectedOptionValue = selectedOptions[msg.choice.choiceId];
            const selectedOption = msg.choice.options.find(option => option.value === selectedOptionValue);

            if (!selectedOptionValue) {
              return (
                <div id={msgId} key={msgKey} className={`flex justify-end rounded-lg ${searchMatchClass}`}>
                  <div className="flex w-full max-w-[85%] flex-col gap-2">
                    {msg.choice.options.map(option => (
                      <button
                        key={option.optionId}
                        onClick={() => onOptionSelect(msg.choice!.choiceId, option.value)}
                        className="min-h-11 w-full rounded-lg border border-nikke-border-strong px-3.5 py-2 text-left text-sm text-nikke-text-primary transition-colors duration-150 hover:border-nikke-accent hover:bg-nikke-accent/[0.08] focus:outline-none focus-visible:ring-2 focus-visible:ring-nikke-accent"
                      >
                        {option.text}
                      </button>
                    ))}
                  </div>
                </div>
              );
            }

            return (
              <div id={msgId} key={msgKey} className={`flex flex-col items-end gap-2.5 rounded-lg ${searchMatchClass}`}>
                <div className="max-w-[80%] rounded-[14px_14px_4px_14px] bg-nikke-accent px-3.5 py-2.5 text-nikke-accent-ink">
                  <p className="whitespace-pre-wrap text-sm font-medium leading-[1.6]">{selectedOption?.text}</p>
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={() => onClearChoice(msg.choice!.choiceId)}
                    className="min-h-8 rounded-md border border-nikke-border-strong px-2.5 text-xs text-nikke-text-secondary hover:border-nikke-accent hover:text-nikke-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-nikke-accent"
                    aria-label={`답장 변경: ${selectedOption?.text ?? ''}`}
                  >
                    답장 변경
                  </button>
                </div>
              </div>
            );
          }

          return renderPlainMessage(msg, msgId, msgKey, searchMatchClass);
        })}
      </div>
    </section>
  );
};
