import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRightIcon } from './Icons';
import { normalizeSourceTarget, sourceTargetUrl } from '../lib/sourceLinks.mjs';
import { clearPendingAsk, readPendingAsk, savePendingAsk } from './pendingAsk.mjs';

type AskSource = {
  title: string;
  fileSearchStore?: string;
  target?: { kind: 'chapter' | 'category' | 'scene'; categoryKey: string; title?: string; scriptId?: string; subTitle?: string };
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
const ASK_RECOVERY_TIMEOUT_MS = import.meta.env.DEV ? Infinity : 4 * 60_000;
const ASK_RECOVERY_FETCH_TIMEOUT_MS = 10_000;
const ASK_RECOVERY_NOT_FOUND_TIMEOUT_MS = 30_000;
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
    )).map(source => ({ ...source, target: normalizeSourceTarget(source.target) ?? undefined }))
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
    || (result.status === 503 && payload.status === 'ANSWER_PERSISTENCE_UNCERTAIN')
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
  const notFoundDeadline = Date.now() + ASK_RECOVERY_NOT_FOUND_TIMEOUT_MS;
  let invalidSuccessResponseCount = 0;
  let hasObservedRegisteredRequest = false;

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

    if (result.status === 404 && payload.status === 'not_found') {
      if (!hasObservedRegisteredRequest && Date.now() >= notFoundDeadline) {
        throw new TerminalAskRequestError('AI 질문이 서버에 접수된 기록을 찾지 못했습니다. 다시 질문해 주세요.');
      }
      await wait(getRetryDelayMs(result), signal);
      continue;
    }

    if (payload.status === 'failed') {
      throw new TerminalAskRequestError(
        typeof payload.error === 'string'
          ? payload.error
          : 'AI 답변 생성을 완료하지 못했습니다. 다시 질문해 주세요.'
      );
    }

    if (result.status === 202 && (payload.status === 'processing' || payload.status === 'pending')) {
      hasObservedRegisteredRequest = true;
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

const formatElapsed = (elapsedMs: number) => {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}분 ${seconds}초` : `${seconds}초`;
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
      return <strong key={`${part}-${index}`} className="font-semibold">{part.slice(2, -2)}</strong>;
    }

    return <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>;
  });
};

const AnswerBlock: React.FC<{ answer: string }> = ({ answer }) => {
  const lines = useMemo(() => answer.split(/\r?\n/), [answer]);

  return (
    <div className="flex flex-col gap-3.5 font-body text-[17px] leading-[1.95] text-nikke-text-primary max-sm:text-base">
      {lines.map((line, index) => {
        const trimmed = line.trim();
        if (!trimmed) {
          return null;
        }

        if (trimmed.startsWith('###')) {
          return (
            <h4 key={`${trimmed}-${index}`} className="pt-2 font-headline text-lg font-bold">
              {renderInlineMarkdown(trimmed.replace(/^#+\s*/, ''))}
            </h4>
          );
        }

        if (/^[-*]\s+/.test(trimmed)) {
          return (
            <p key={`${trimmed}-${index}`} className="pl-4">
              <span aria-hidden="true" className="-ml-4 mr-2 text-nikke-accent">•</span>
              {renderInlineMarkdown(trimmed.replace(/^[-*]\s+/, '').replace(/^\s+/, ''))}
            </p>
          );
        }

        return <p key={`${trimmed}-${index}`}>{renderInlineMarkdown(trimmed)}</p>;
      })}
    </div>
  );
};

const formatTokenUsage = (tokenUsage?: TokenUsage | null): string | null => {
  if (!tokenUsage) return null;

  const metrics = [
    ['입력', tokenUsage.promptTokenCount],
    ['검색', tokenUsage.toolUsePromptTokenCount],
    ['출력', tokenUsage.candidatesTokenCount],
    ['총합', tokenUsage.totalTokenCount],
  ] as const;
  const parts = metrics
    .map(([label, value]) => {
      const formattedValue = formatTokenCount(value);
      return formattedValue ? `${label} ${formattedValue}` : null;
    })
    .filter(Boolean);

  return parts.length > 0 ? `${parts.join(' · ')} 토큰` : null;
};

export const AiAskPanel: React.FC = () => {
  const [prompt, setPrompt] = useState('');
  const [response, setResponse] = useState<AskResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);
  const [waitStartedAt, setWaitStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const activeRequestRef = useRef<{ abort: () => void } | null>(null);
  const isMountedRef = useRef(true);

  const canSubmit = prompt.trim().length > 0 && !isSubmitting;

  useEffect(() => {
    isMountedRef.current = true;

    const pendingAsk = readPendingAsk(getAskSessionStorage(), Date.now(), import.meta.env.DEV ? Infinity : undefined);
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
      setWaitStartedAt(pendingAsk.submittedAt);

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
          if (requestError instanceof TerminalAskRequestError) {
            clearPendingAsk(getAskSessionStorage(), pendingAsk.requestId);
          }
          if (isMountedRef.current && activeRequestRef.current === activeRequest) {
            if (requestError instanceof TerminalAskRequestError) {
              setPendingRequestId(null);
            }
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

  // 답변을 기다리는 동안 경과 시간을 1초마다 갱신한다
  useEffect(() => {
    if (!isSubmitting || waitStartedAt === null) return;
    setNow(Date.now());
    const intervalId = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [isSubmitting, waitStartedAt]);

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
    setWaitStartedAt(submittedAt);

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
    setWaitStartedAt(Date.now());
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
      if (requestError instanceof TerminalAskRequestError) {
        clearPendingAsk(getAskSessionStorage(), pendingRequestId);
      }
      if (isMountedRef.current && activeRequestRef.current === activeRequest) {
        if (requestError instanceof TerminalAskRequestError) {
          setPendingRequestId(null);
        }
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

  const tokenUsageLabel = response ? formatTokenUsage(response.tokenUsage) : null;
  const elapsedLabel = isSubmitting && waitStartedAt !== null
    ? formatElapsed(now - waitStartedAt)
    : null;

  return (
    <>
      <form
        onSubmit={handleSubmit}
        aria-label="AI에게 질문"
        className="mt-8 rounded-xl border border-nikke-border-strong bg-nikke-surface focus-within:border-nikke-accent"
      >
        <label htmlFor="ai-ask-prompt" className="sr-only">질문</label>
        <textarea
          id="ai-ask-prompt"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={3}
          maxLength={1200}
          className="block min-h-28 w-full resize-y border-0 bg-transparent px-5 pb-2 pt-5 text-[17px] leading-[1.7] text-nikke-text-primary outline-none placeholder:text-nikke-text-muted max-sm:px-4 max-sm:text-base"
          placeholder="궁금한 내용을 입력하세요"
        />
        <div className="flex flex-wrap items-center justify-between gap-3 py-2.5 pl-5 pr-2.5 max-sm:pl-4">
          <p className="text-xs leading-[1.6] text-nikke-text-muted">
            질문과 답변은 위키 품질 개선을 위해 저장될 수 있습니다. · {prompt.length} / 1200
          </p>
          <button
            type="submit"
            disabled={!canSubmit}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-nikke-accent px-5 text-sm font-semibold text-nikke-accent-ink hover:bg-nikke-accent-strong disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-nikke-accent max-sm:w-full"
          >
            {isRecovering ? '답변 생성 중…' : isSubmitting ? '질문 중…' : '질문하기'}
            {!isSubmitting && <ArrowRightIcon aria-hidden="true" className="h-4 w-4" />}
          </button>
        </div>
      </form>

      {elapsedLabel && (
        <div className="mt-6 flex items-start gap-3 rounded-lg bg-nikke-accent/10 px-4 py-3.5" role="status">
          <span aria-hidden="true" className="mt-[0.55em] h-1.5 w-1.5 flex-none animate-pulse rounded-full bg-nikke-accent ring-[3px] ring-nikke-accent/20" />
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm leading-[1.65] text-nikke-text-primary">
              <span>{isRecovering ? 'AI가 답변을 생성 중입니다.' : '기록을 대조하고 있습니다.'}</span>
              <span className="font-mono text-xs text-nikke-text-secondary" aria-hidden="true">{elapsedLabel}</span>
            </p>
            <p className="mt-0.5 text-xs leading-[1.6] text-nikke-text-muted">
              답변에 몇 분까지 걸릴 수 있습니다. 같은 질문을 다시 보내지 않아도 되며, 다른 메뉴에 다녀오거나 새로고침해도 이 탭에서 이어서 받아 옵니다.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-6 rounded-lg bg-red-500/10 px-4 py-3.5" role="alert">
          <p className="text-sm leading-[1.65] text-red-600 dark:text-[#FFB4B6]">{error}</p>
          {pendingRequestId && !isSubmitting && (
            <button
              type="button"
              onClick={handleRecoverPendingAnswer}
              className="mt-1.5 min-h-9 text-sm font-semibold text-red-600 underline underline-offset-4 dark:text-[#FFB4B6]"
            >
              저장된 결과 다시 확인
            </button>
          )}
        </div>
      )}

      {response && (
        <section aria-labelledby="ai-answer-title" className="mt-10">
          <div className="flex items-baseline justify-between gap-3 border-b border-nikke-border pb-3.5">
            <h2 id="ai-answer-title" className="text-[13px] font-medium text-nikke-text-muted">답변</h2>
            <span className="font-mono text-[11px] text-nikke-text-muted">{response.model}</span>
          </div>
          <div className="pt-6">
            <AnswerBlock answer={response.answer} />
          </div>
          {(response.sources.length > 0 || response.groundingChunkCount > 0) && (
            <div className="mt-7">
              <p className="mb-2.5 text-xs text-nikke-text-muted">근거 {response.groundingChunkCount}개</p>
              {response.sources.length > 0 && (
                <ul className="flex flex-wrap gap-2">
                  {response.sources.map((source) => (
                    <li
                      key={`${source.title}:${source.target?.kind === 'scene' ? source.target.scriptId : ''}`}
                      className="inline-flex min-h-9 items-center rounded-lg border border-nikke-border-strong px-3 text-[13px] text-nikke-text-secondary"
                    >
                      {sourceTargetUrl(source.target) ? (
                        <a href={sourceTargetUrl(source.target)!} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 hover:text-nikke-highlight">
                          {source.target?.kind === 'scene' ? `${source.target.title} · ${source.target.subTitle ?? source.target.scriptId}` : source.target?.kind === 'chapter' ? source.target.title : '관련 분류 보기'} <span aria-hidden="true">↗</span><span className="sr-only"> (새 탭에서 원문 열기)</span>
                        </a>
                      ) : source.title}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {tokenUsageLabel && (
            <details className="group mt-5 text-xs text-nikke-text-muted">
              <summary className="inline-flex min-h-9 cursor-pointer list-none items-center gap-1.5 hover:text-nikke-text-secondary [&::-webkit-details-marker]:hidden">
                <span aria-hidden="true" className="transition-transform duration-150 group-open:rotate-90">›</span>
                상세 정보
              </summary>
              <p className="mt-1 font-mono text-[11px]">{tokenUsageLabel}</p>
            </details>
          )}
        </section>
      )}
    </>
  );
};
