import React from 'react';
import type { MessengerAppElement, MessengerContentElement } from '../../types';
import type { ExtendedMessengerChoiceOption } from './scriptParser';

interface MessengerAppRendererProps {
  element: MessengerAppElement;
  keyPrefix: string;
  selectedOptions: Record<string, string>;
  onOptionSelect: (choiceId: string, optionValue: string) => void;
  onClearChoice: (choiceId: string) => void;
}

export const MessengerAppRenderer: React.FC<MessengerAppRendererProps> = ({
  element,
  keyPrefix,
  selectedOptions,
  onOptionSelect,
  onClearChoice,
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
    <div className="mx-auto my-10 max-w-2xl rounded-[2rem] bg-nikke-surface-low/90 p-4 shadow-ambient ring-1 ring-nikke-border/10 md:p-5">
      {element.appTitle && (
        <h3 className="mb-2 text-left font-headline text-xl font-bold tracking-[-0.02em] text-nikke-text-primary">
          {element.appTitle}
        </h3>
      )}
      {element.participants && element.participants.length > 0 && (
        <p className="mb-4 text-left font-label text-[0.72rem] uppercase tracking-[0.16em] text-nikke-text-muted">
          Participants: {element.participants.join(', ')}
        </p>
      )}
      <div className="max-h-[500px] space-y-4 overflow-y-auto rounded-[1.5rem] bg-nikke-bg-alt/60 p-4 pr-3">
        {messagesToRender.map((msg, msgIdx) => {
          const msgKey = `${keyPrefix}_msg_${msgIdx}`;

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

          if (msg.type === 'message_status' && msg.statusType === 'delivery_failed') {
            return (
              <div key={msgKey} className="my-1 flex items-center justify-center text-xs italic text-red-400/90">
                <svg xmlns="http://www.w3.org/2000/svg" className="mr-1.5 h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm-1-9a1 1 0 002 0V5a1 1 0 00-2 0v4zm1 4a1 1 0 100 2 1 1 0 000-2z" clipRule="evenodd" />
                </svg>
                <span>{msg.text}</span>
              </div>
            );
          }

          if (msg.type === 'message_bubble') {
            if (msg.isSystem) {
              return (
                <div key={msgKey} className="my-2 text-center">
                  <span className="rounded-full bg-nikke-surface-high px-3 py-1 font-label text-[0.68rem] uppercase tracking-[0.16em] text-nikke-text-muted">{msg.text}</span>
                </div>
              );
            }

            if (msg.choice && isOriginalMessage) {
              const selectedOptionValue = selectedOptions[msg.choice.choiceId];
              const selectedOption = msg.choice.options.find(option => option.value === selectedOptionValue);

              if (!selectedOptionValue) {
                return (
                  <div key={msgKey} className="my-2 flex justify-end">
                    <div className="w-full max-w-[85%] space-y-2">
                      {msg.choice.options.map(option => (
                        <button
                          key={option.optionId}
                          onClick={() => onOptionSelect(msg.choice!.choiceId, option.value)}
                          className="w-full rounded-full bg-nikke-surface-high px-4 py-3 text-center font-body text-base text-nikke-text-primary transition-all duration-300 ease-editorial hover:bg-nikke-accent hover:text-slate-950 focus:outline-none focus:ring-2 focus:ring-nikke-accent"
                        >
                          {option.text}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              }

              return (
                <div key={msgKey} className="my-2">
                  <div className="mb-2 flex justify-end">
                    <div className="max-w-[75%] rounded-[1.25rem] rounded-br-md bg-nikke-gradient p-3 text-slate-950 shadow-glass">
                      <p className="whitespace-pre-wrap font-body text-sm">{selectedOption?.text}</p>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <button
                      onClick={() => onClearChoice(msg.choice!.choiceId)}
                      className="rounded-full bg-nikke-surface-high px-3 py-1.5 font-label text-[0.68rem] uppercase tracking-[0.16em] text-nikke-text-secondary transition-colors duration-300 ease-editorial hover:text-nikke-text-primary focus:outline-none focus:ring-1 focus:ring-nikke-accent"
                      aria-label={`Change selected option ${selectedOption?.text ?? ''}`}
                    >
                      Change Choice
                    </button>
                  </div>
                </div>
              );
            }

            if (msg.text) {
              return (
                <div key={msgKey} className={`flex ${msg.isSender ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[75%] rounded-[1.25rem] p-3 shadow-sm ${msg.isSender ? 'rounded-br-md bg-nikke-gradient text-slate-950' : 'rounded-bl-md bg-nikke-surface-high text-nikke-text-primary'}`}>
                    {!msg.isSender && <p className="mb-1 font-label text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-nikke-accent">{msg.sender}</p>}
                    <p className="whitespace-pre-wrap font-body text-sm leading-7">{msg.text}</p>
                  </div>
                </div>
              );
            }
          }

          return null;
        })}
      </div>
    </div>
  );
};
