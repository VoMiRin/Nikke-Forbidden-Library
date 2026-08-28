import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SparklesIcon } from './Icons';
import { clearPendingAsk, readPendingAsk, savePendingAsk } from './pendingAsk.mjs';

type AskSource = {
  title: string;
  fileSearchStore?: string;
};

type TokenUsage = {
  estimatedInputTokenCount?: number;
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  cachedContentTokenCount?: number;
  thoughtsTokenCount?: number;
  toolUsePromptTokenCount?: number;
};

type AskResponse = {
  answer: string;
  model: string;
  grounded: boolean;
  sources: AskSource[];
  groundingChunkCount: number;
  groundingSupportCount: number;
  tokenUsage?: TokenUsage | null;
  askLogId?: string | null;
};

const ASK_RECOVERY_POLL_INTERVAL_MS = 2_000;
const ASK_RECOVERY_START_DELAY_MS = 8_000;
const ASK_RECOVERY_TIMEOUT_MS = 4 * 60_000;
const ASK_RECOVERY_FETCH_TIMEOUT_MS = 10_000;
const ASK_INITIAL_REQUEST_DEADLINE_MS = 70_000;
const ASK_RECOVERY_RETRYABLE_STATUSES = new Set([202, 429, 500, 502, 503, 504]);

const isRecord = (value: unknown): value is Record<string, unknown> => (
  !!value && typeof value === 'object' && !Array.isArray(value)
);

const readResponsePayload = async (result: Response): Promise<Record<string, unknown>> => {
  const text = await result.text();
  if (!text) return {};

  try {
    const payload: unknown = JSON.parse(text);
    return isRecord(payload) ? payload : {};
  } catch {
    return {};
  }
};

const normalizeAskResponse = (payload: Record<string, unknown>): AskResponse | null => {
  if (typeof payload.answer !== 'string' || typeof payload.model !== 'string') {
    return null;
  }

  const sources = Array.isArray(payload.sources)
    ? payload.sources.filter((source): source is AskSource => (
      isRecord(source) && typeof source.title === 'string'
    ))
    : [];
  const tokenUsage = isRecord(payload.tokenUsage)
    ? payload.tokenUsage as TokenUsage
    : null;

  return {
    answer: payload.answer,
    model: payload.model,
    grounded: payload.grounded === true,
    sources,
    groundingChunkCount: typeof payload.groundingChunkCount === 'number'
      ? payload.groundingChunkCount
      : 0,
    groundingSupportCount: typeof payload.groundingSupportCount === 'number'
      ? payload.groundingSupportCount
      : 0,
    tokenUsage,
    askLogId: typeof payload.askLogId === 'string' ? payload.askLogId : null,
  };
};

const createAskRequestId = () => `ask_${crypto.randomUUID().replaceAll('-', '')}`;

class TerminalAskRequestError extends Error {}

const createAbortError = () => new DOMException('The operation was aborted.', 'AbortError');
const isAbortError = (error: unknown) => (
  error instanceof DOMException && error.name === 'AbortError'
);

const wait = (delayMs: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) {
    reject(createAbortError());
    return;
  }

  const handleAbort = () => {
    window.clearTimeout(timeout);
    reject(createAbortError());
  };
  const timeout = window.setTimeout(() => {
    signal.removeEventListener('abort', handleAbort);
    resolve();
  }, delayMs);

  signal.addEventListener('abort', handleAbort, { once: true });
});

const fetchRecoveryResult = async (requestId: string, signal: AbortSignal) => {
  const controller = new AbortController();
  const handleAbort = () => controller.abort();
  const timeout = window.setTimeout(() => controller.abort(), ASK_RECOVERY_FETCH_TIMEOUT_MS);

  if (signal.aborted) controller.abort();
  signal.addEventListener('abort', handleAbort, { once: true });

  try {
    const query = new URLSearchParams({
      requestId,
      poll: Date.now().toString(),
    });
    const result = await fetch(`/api/ask/result?${query}`, {
      cache: 'no-store',
      headers: {
        accept: 'application/json',
      },
      signal: controller.signal,
    });
    const payload = await readResponsePayload(result);
    return { result, payload };
  } finally {
    window.clearTimeout(timeout);
    signal.removeEventListener('abort', handleAbort);
  }
};

const requestInitialAnswer = async (
  prompt: string,
  requestId: string,
  signal: AbortSignal
): Promise<AskResponse | null> => {
  let result: Response;

  try {
    result = await fetch('/api/ask', {
      method: 'POST',
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ prompt, requestId }),
      signal,
    });
  } catch (requestError) {
    if (isAbortError(requestError)) throw requestError;
    if (navigator.onLine === false) {
      throw new Error('네트워크 연결이 끊겼습니다. 연결을 확인한 뒤 저장된 결과를 다시 확인해 주세요.');
    }
    return null;
  }

  let payload: Record<string, unknown>;
  try {
    payload = await readResponsePayload(result);
  } catch (payloadError) {
    if (isAbortError(payloadError)) throw payloadError;
    return null;
  }

  if (
    result.status === 504
    || ((result.status === 502 || result.status === 503) && Object.keys(payload).length === 0)
  ) {
    return null;
  }

  if (!result.ok) {
    const retryMessage = result.status === 429 ? formatRetryAfter(result.headers.get('retry-after')) : null;
    throw new TerminalAskRequestError(
      retryMessage
        ? `AI 요청이 잠시 많습니다. ${retryMessage}`
        : typeof payload.error === 'string'
          ? payload.error
          : `AI 질문 요청에 실패했습니다. (HTTP ${result.status})`
    );
  }

  return normalizeAskResponse(payload);
};

const getRetryDelayMs = (result: Response) => {
  const retryAfterSeconds = Number(result.headers.get('retry-after'));
  return Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
    ? Math.max(1_000, retryAfterSeconds * 1_000)
    : ASK_RECOVERY_POLL_INTERVAL_MS;
};

const pollForStoredAnswer = async (requestId: string, signal: AbortSignal): Promise<AskResponse> => {
  const deadline = Date.now() + ASK_RECOVERY_TIMEOUT_MS;
  let invalidSuccessResponseCount = 0;

  while (!signal.aborted && Date.now() < deadline) {
    let retryDelayMs = ASK_RECOVERY_POLL_INTERVAL_MS;
    let result: Response;
    let payload: Record<string, unknown>;

    try {
      ({ result, payload } = await fetchRecoveryResult(requestId, signal));
    } catch {
      if (signal.aborted) throw createAbortError();
      // A short network interruption should not turn a completed Gemini response into a failure.
      await wait(retryDelayMs, signal);
      continue;
    }

    if (result.status === 200) {
      const recoveredResponse = normalizeAskResponse(payload);
      if (recoveredResponse) return recoveredResponse;
      invalidSuccessResponseCount += 1;
      if (invalidSuccessResponseCount >= 2) {
        throw new Error('저장된 AI 답변 응답 형식을 확인할 수 없습니다.');
      }
      await wait(retryDelayMs, signal);
      continue;
    }

    if (payload.status === 'RECOVERY_NOT_CONFIGURED') {
      throw new Error('저장된 AI 답변 복구 기능이 설정되지 않았습니다.');
    }

    if (!ASK_RECOVERY_RETRYABLE_STATUSES.has(result.status)) {
      throw new Error(
        typeof payload.error === 'string'
          ? payload.error
          : '저장된 AI 답변을 확인할 수 없습니다.'
      );
    }

    retryDelayMs = getRetryDelayMs(result);
    await wait(retryDelayMs, signal);
  }

  if (signal.aborted) throw createAbortError();
  throw new Error('답변 생성이 오래 걸리고 있습니다. 잠시 후 저장된 결과를 다시 확인해 주세요.');
};

const formatTokenCount = (value: number | undefined) => (
  Number.isFinite(value) ? value.toLocaleString('ko-KR') : null
);

const formatRetryAfter = (retryAfter: string | null) => {
  if (!retryAfter) return null;

  const retryAfterSeconds = Number(retryAfter);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    if (retryAfterSeconds < 60) {
      return `${Math.ceil(retryAfterSeconds)}초 후에 다시 시도해 주세요.`;
    }

    if (retryAfterSeconds < 3600) {
      return `${Math.ceil(retryAfterSeconds / 60)}분 후에 다시 시도해 주세요.`;
    }

    if (retryAfterSeconds < 86400) {
      return `${Math.ceil(retryAfterSeconds / 3600)}시간 후에 다시 시도해 주세요.`;
    }

    return `${Math.ceil(retryAfterSeconds / 86400)}일 후에 다시 시도해 주세요.`;
  }

  return '잠시 후에 다시 시도해 주세요.';
};

const getAskSessionStorage = (): Storage | null => {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
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

const TokenMetric: React.FC<{ label: string; value?: number }> = ({ label, value }) => {
  const formattedValue = formatTokenCount(value);
  if (!formattedValue) return null;

  return <span>{label} {formattedValue} 토큰</span>;
};

export const AiAskPanel: React.FC = () => {
  const [prompt, setPrompt] = useState('');
  const [response, setResponse] = useState<AskResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);
  const activeRequestRef = useRef<{ abort: () => void } | null>(null);
  const isMountedRef = useRef(true);

  const canSubmit = prompt.trim().length > 0 && !isSubmitting;

  useEffect(() => {
    isMountedRef.current = true;

    const pendingAsk = readPendingAsk(getAskSessionStorage());
    if (pendingAsk) {
      const requestController = new AbortController();
      const activeRequest = {
        abort: () => requestController.abort(),
      };

      activeRequestRef.current?.abort();
      activeRequestRef.current = activeRequest;
      setPendingRequestId(pendingAsk.requestId);
      setIsSubmitting(true);
      setIsRecovering(true);

      void pollForStoredAnswer(pendingAsk.requestId, requestController.signal)
        .then((recoveredResponse) => {
          if (!isMountedRef.current || activeRequestRef.current !== activeRequest) return;
          setResponse(recoveredResponse);
          setError(null);
          setPendingRequestId(null);
          clearPendingAsk(getAskSessionStorage(), pendingAsk.requestId);
        })
        .catch((requestError: unknown) => {
          if (isAbortError(requestError)) return;
          if (isMountedRef.current && activeRequestRef.current === activeRequest) {
            setError(requestError instanceof Error ? requestError.message : '저장된 AI 답변을 확인하지 못했습니다.');
          }
        })
        .finally(() => {
          if (activeRequestRef.current !== activeRequest) return;
          activeRequestRef.current = null;
          if (isMountedRef.current) {
            setIsRecovering(false);
            setIsSubmitting(false);
          }
        });
    }

    return () => {
      isMountedRef.current = false;
      activeRequestRef.current?.abort();
    };
  }, []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;

    setIsSubmitting(true);
    setIsRecovering(false);
    setError(null);
    setResponse(null);
    activeRequestRef.current?.abort();

    const requestId = createAskRequestId();
    const submittedAt = Date.now();
    const postController = new AbortController();
    const recoveryController = new AbortController();
    const activeRequest = {
      abort: () => {
        postController.abort();
        recoveryController.abort();
      },
    };
    activeRequestRef.current = activeRequest;
    setPendingRequestId(requestId);
    savePendingAsk(getAskSessionStorage(), { requestId, submittedAt });

    const markRecoveryStarted = () => {
      if (isMountedRef.current && activeRequestRef.current === activeRequest) {
        setIsRecovering(true);
      }
    };

    let initialDeadlineId = 0;
    const initialRequestPromise = requestInitialAnswer(
      prompt.trim(),
      requestId,
      postController.signal
    );
    const initialDeadlinePromise = new Promise<null>((resolve) => {
      initialDeadlineId = window.setTimeout(() => resolve(null), ASK_INITIAL_REQUEST_DEADLINE_MS);
    });
    const initialOutcomePromise = Promise.race([
      initialRequestPromise,
      initialDeadlinePromise,
    ]).then(
      (initialResponse) => ({ source: 'initial' as const, response: initialResponse }),
      (requestError: unknown) => ({ source: 'initial' as const, error: requestError })
    );

    const recoveryOutcomePromise = (async () => {
      await wait(ASK_RECOVERY_START_DELAY_MS, recoveryController.signal);
      markRecoveryStarted();
      return pollForStoredAnswer(requestId, recoveryController.signal);
    })().then(
      (recoveredResponse) => ({ source: 'recovery' as const, response: recoveredResponse }),
      (requestError: unknown) => ({ source: 'recovery' as const, error: requestError })
    );

    try {
      const firstOutcome = await Promise.race([initialOutcomePromise, recoveryOutcomePromise]);
      let askResponse: AskResponse;

      if (firstOutcome.source === 'initial') {
        if ('error' in firstOutcome) throw firstOutcome.error;

        if (firstOutcome.response) {
          recoveryController.abort();
          askResponse = firstOutcome.response;
        } else {
          markRecoveryStarted();
          const recoveryOutcome = await recoveryOutcomePromise;
          if ('error' in recoveryOutcome) throw recoveryOutcome.error;
          askResponse = recoveryOutcome.response;
        }
      } else if ('response' in firstOutcome) {
        postController.abort();
        askResponse = firstOutcome.response;
      } else {
        if (isAbortError(firstOutcome.error)) throw firstOutcome.error;

        const initialOutcome = await initialOutcomePromise;
        if ('error' in initialOutcome) {
          throw isAbortError(initialOutcome.error) ? firstOutcome.error : initialOutcome.error;
        }
        if (!initialOutcome.response) throw firstOutcome.error;
        askResponse = initialOutcome.response;
      }

      if (isMountedRef.current && activeRequestRef.current === activeRequest) {
        setResponse(askResponse);
        setPendingRequestId(null);
        clearPendingAsk(getAskSessionStorage(), requestId);
      }
    } catch (requestError) {
      if (isAbortError(requestError)) return;
      if (requestError instanceof TerminalAskRequestError) {
        clearPendingAsk(getAskSessionStorage(), requestId);
      }
      if (isMountedRef.current && activeRequestRef.current === activeRequest) {
        if (requestError instanceof TerminalAskRequestError) {
          setPendingRequestId(null);
        }
        setError(requestError instanceof Error ? requestError.message : 'AI 질문 요청에 실패했습니다.');
      }
    } finally {
      window.clearTimeout(initialDeadlineId);
      activeRequest.abort();
      if (activeRequestRef.current === activeRequest) {
        activeRequestRef.current = null;
        if (isMountedRef.current) {
          setIsRecovering(false);
          setIsSubmitting(false);
        }
      }
    }
  };

  const handleRecoverPendingAnswer = async () => {
    if (!pendingRequestId || isSubmitting) return;

    setIsSubmitting(true);
    setIsRecovering(true);
    setError(null);

    activeRequestRef.current?.abort();
    const requestController = new AbortController();
    const activeRequest = {
      abort: () => requestController.abort(),
    };
    activeRequestRef.current = activeRequest;

    try {
      const recoveredResponse = await pollForStoredAnswer(pendingRequestId, requestController.signal);
      if (isMountedRef.current && activeRequestRef.current === activeRequest) {
        setResponse(recoveredResponse);
        setPendingRequestId(null);
        clearPendingAsk(getAskSessionStorage(), pendingRequestId);
      }
    } catch (requestError) {
      if (isAbortError(requestError)) return;
      if (isMountedRef.current && activeRequestRef.current === activeRequest) {
        setError(requestError instanceof Error ? requestError.message : '저장된 AI 답변을 확인하지 못했습니다.');
      }
    } finally {
      if (activeRequestRef.current === activeRequest) {
        activeRequestRef.current = null;
        if (isMountedRef.current) {
          setIsRecovering(false);
          setIsSubmitting(false);
        }
      }
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
          <p className="text-xs leading-5 text-nikke-text-muted">
            질문과 답변은 위키 품질 개선을 위해 저장될 수 있습니다. {prompt.length}/1200
          </p>
          <button
            type="submit"
            disabled={!canSubmit}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-nikke-gradient px-5 py-2.5 text-sm font-bold text-slate-950 transition-transform duration-300 ease-editorial hover:scale-[1.02] disabled:cursor-wait disabled:opacity-60 disabled:hover:scale-100"
          >
            <SparklesIcon className="h-4 w-4" />
            {isRecovering ? '답변 확인 중...' : isSubmitting ? '질문 중...' : '질문하기'}
          </button>
        </div>
      </form>

      {isRecovering && (
        <div className="mt-4 rounded-[1rem] border border-nikke-accent/20 bg-nikke-accent/5 px-4 py-3 text-sm leading-6 text-nikke-text-secondary" role="status">
          답변 생성은 계속되고 있습니다. 저장된 결과를 확인하는 중입니다.
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-[1rem] border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm leading-6 text-red-200">
          <p>{error}</p>
          {pendingRequestId && !isSubmitting && (
            <button
              type="button"
              onClick={handleRecoverPendingAnswer}
              className="mt-2 font-bold text-red-100 underline decoration-red-200/60 underline-offset-4"
            >
              저장된 결과 다시 확인
            </button>
          )}
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
            <TokenMetric label="입력" value={response.tokenUsage?.promptTokenCount} />
            <TokenMetric label="검색" value={response.tokenUsage?.toolUsePromptTokenCount} />
            <TokenMetric label="출력" value={response.tokenUsage?.candidatesTokenCount} />
            <TokenMetric label="총합" value={response.tokenUsage?.totalTokenCount} />
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
