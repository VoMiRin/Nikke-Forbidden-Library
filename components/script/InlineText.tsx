import React from 'react';
import { stripInlineMarkup } from '../../utils';

/**
 * 본문·선택지 안의 인라인 표기를 그린다.
 * - `[REDACT]원문[/REDACT]`: 가려진 문구. 눌러서 펼치고 다시 눌러서 가린다(아카이브 열람용 기능).
 * - `<color=#RRGGBB>문구</color>`: 게임 원문의 글자색.
 * 표기가 없는 문자열은 그대로 돌려준다.
 */
const INLINE_TOKEN = /\[REDACT\]([\s\S]*?)\[\/REDACT\]|<color=(#[0-9a-fA-F]{3,8})>([\s\S]*?)<\/color>/g;

export const hasInlineMarkup = (text: string): boolean => /\[REDACT\]|<color=#/i.test(text);

/** 표기를 걷어낸 글. `redacted: 'mask'`이면 가려진 문구를 ■로 바꾼다(버튼 안 이름표처럼 펼칠 수 없는 곳). */
export const toPlainInlineText = (text: string, options?: { redacted?: 'keep' | 'mask' }): string => (
  stripInlineMarkup(text, options?.redacted === 'mask' ? '■■■' : undefined)
);

const RedactedSpan: React.FC<{ text: string; interactive: boolean }> = ({ text, interactive }) => {
  const [revealed, setRevealed] = React.useState(false);
  const maskedClass = 'rounded-[3px] bg-nikke-text-primary text-transparent [box-decoration-break:clone] [-webkit-box-decoration-break:clone] select-none';

  if (!interactive) {
    return (
      <span className={maskedClass} aria-label="가려진 문구">
        {text}
      </span>
    );
  }

  return (
    <button
      type="button"
      aria-pressed={revealed}
      aria-label={revealed ? undefined : '가려진 문구 펼치기'}
      title={revealed ? '다시 가리기' : '눌러서 가려진 문구 보기'}
      onClick={(event) => {
        // 선택지 안에 있어도 가림만 펼치고 선택은 하지 않는다
        event.stopPropagation();
        setRevealed(value => !value);
      }}
      onKeyDown={(event) => event.stopPropagation()}
      className={`mx-px inline whitespace-pre-wrap px-1 text-left align-baseline [font:inherit] [box-decoration-break:clone] [-webkit-box-decoration-break:clone] focus:outline-none focus-visible:ring-2 focus-visible:ring-nikke-accent ${
        revealed
          ? 'rounded-[3px] bg-nikke-highlight/15 text-nikke-highlight'
          : maskedClass
      }`}
    >
      {text}
    </button>
  );
};

/** `interactive`가 false면 가림을 펼칠 수 없게 그린다(다른 버튼 안에 들어갈 때). */
export const InlineText: React.FC<{ text: string; interactive?: boolean }> = ({ text, interactive = true }) => {
  if (!hasInlineMarkup(text)) return <>{text}</>;

  const parts: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(INLINE_TOKEN)) {
    const index = match.index ?? 0;
    if (index > last) parts.push(text.slice(last, index));
    if (match[1] !== undefined) {
      parts.push(<RedactedSpan key={key++} text={match[1]} interactive={interactive} />);
    } else {
      parts.push(
        <span key={key++} style={{ color: match[2] }}>
          <InlineText text={match[3]} interactive={interactive} />
        </span>
      );
    }
    last = index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
};
