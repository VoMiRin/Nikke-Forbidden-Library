import React, { useMemo, useState } from 'react';
import { SparklesIcon } from './Icons';

type AskSource = {
  title: string;
  fileSearchStore?: string;
};

type AskResponse = {
  answer: string;
  model: string;
  grounded: boolean;
  sources: AskSource[];
  groundingChunkCount: number;
  groundingSupportCount: number;
};

const renderInlineMarkdown = (text: string): React.ReactNode[] => {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);

  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={`${part}-${index}`} className="font-semibold text-nikke-text-primary">{part.slice(2, -2)}</strong>;
    }

    return <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>;
  });
};

const AnswerBlock: React.FC<{ answer: string }> = ({ answer }) => {
  const lines = useMemo(() => answer.split(/\r?\n/), [answer]);

  return (
    <div className="space-y-2 text-sm leading-7 text-nikke-text-secondary md:text-base md:leading-8">
      {lines.map((line, index) => {
        const trimmed = line.trim();
        if (!trimmed) {
          return <div key={`blank-${index}`} className="h-1" />;
        }

        if (trimmed.startsWith('###')) {
          return (
            <h4 key={`${trimmed}-${index}`} className="pt-2 font-headline text-lg font-bold text-nikke-text-primary">
              {renderInlineMarkdown(trimmed.replace(/^#+\s*/, ''))}
            </h4>
          );
        }

        if (/^[-*]\s+/.test(trimmed)) {
          return (
            <p key={`${trimmed}-${index}`} className="pl-4">
              <span className="-ml-4 mr-2 text-nikke-accent">•</span>
              {renderInlineMarkdown(trimmed.replace(/^[-*]\s+/, '').replace(/^\s+/, ''))}
            </p>
          );
        }

        return <p key={`${trimmed}-${index}`}>{renderInlineMarkdown(trimmed)}</p>;
      })}
    </div>
  );
};

export const AiAskPanel: React.FC = () => {
  const [prompt, setPrompt] = useState('');
  const [response, setResponse] = useState<AskResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canSubmit = prompt.trim().length > 0 && !isSubmitting;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;

    setIsSubmitting(true);
    setError(null);
    setResponse(null);

    try {
      const result = await fetch('/api/ask', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });
      const payload = await result.json().catch(() => ({}));

      if (!result.ok) {
        throw new Error(payload.error || 'AI 질문 요청에 실패했습니다.');
      }

      setResponse(payload as AskResponse);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'AI 질문 요청에 실패했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="mb-6 border-y border-nikke-border/15 py-4 md:mb-8 md:py-5">
      <div className="mb-3 flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-nikke-surface-high text-nikke-accent">
          <SparklesIcon className="h-5 w-5" />
        </span>
        <div>
          <p className="font-label text-[11px] uppercase tracking-[0.2em] text-nikke-accent">AI Chat</p>
          <h3 className="font-headline text-xl font-bold tracking-[-0.02em] text-nikke-text-primary md:text-2xl">
            스토리 질문하기
          </h3>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={3}
          maxLength={1200}
          className="min-h-[7rem] w-full resize-y rounded-[1rem] bg-nikke-surface-low/85 px-4 py-3 text-sm leading-7 text-nikke-text-primary outline-none transition-all duration-300 ease-editorial placeholder:text-nikke-text-muted focus:bg-nikke-surface-low focus:ring-2 focus:ring-nikke-accent/20 md:text-base"
          placeholder="궁금한 내용을 입력하세요"
          aria-label="AI archive question"
        />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-nikke-text-muted">
            {prompt.length}/1200
          </p>
          <button
            type="submit"
            disabled={!canSubmit}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-nikke-gradient px-5 py-2.5 text-sm font-bold text-slate-950 transition-transform duration-300 ease-editorial hover:scale-[1.02] disabled:cursor-wait disabled:opacity-60 disabled:hover:scale-100"
          >
            <SparklesIcon className="h-4 w-4" />
            {isSubmitting ? '질문 중...' : '질문하기'}
          </button>
        </div>
      </form>

      {error && (
        <div className="mt-4 rounded-[1rem] border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm leading-6 text-red-200">
          {error}
        </div>
      )}

      {response && (
        <div className="mt-5 space-y-4">
          <div className="rounded-[1rem] bg-nikke-surface-low/70 px-4 py-4 md:px-5 md:py-5">
            <AnswerBlock answer={response.answer} />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-nikke-text-muted">
            <span className="font-label uppercase tracking-[0.18em] text-nikke-text-muted">{response.model}</span>
            <span>근거 {response.groundingChunkCount}개</span>
            {response.sources.map((source) => (
              <span key={source.title} className="rounded-full bg-nikke-surface-low px-3 py-1 text-nikke-text-secondary">
                {source.title}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};
