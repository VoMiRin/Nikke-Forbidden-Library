const parseJson = (value) => {
  if (typeof value !== 'string' || !value.trim()) return null;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

export const parseGeminiErrorPayload = (error) => {
  const structuredCandidates = [
    error?.response?.data,
    error?.body,
    error?.cause?.response?.data,
  ];

  for (const candidate of structuredCandidates) {
    if (candidate && typeof candidate === 'object') return candidate;

    const parsedCandidate = parseJson(candidate);
    if (parsedCandidate) return parsedCandidate;
  }

  const parsedMessage = parseJson(error instanceof Error ? error.message : error);
  if (parsedMessage) return parsedMessage;

  if (error && typeof error === 'object' && error.error && typeof error.error === 'object') {
    return error;
  }

  const rawMessage = error instanceof Error ? error.message : String(error ?? '');
  return {
    error: {
      code: error?.code,
      status: error?.status,
      message: rawMessage,
      details: Array.isArray(error?.details) ? error.details : [],
    },
  };
};

export const getGeminiErrorDetails = (error) => {
  const payload = parseGeminiErrorPayload(error);
  const nestedError = payload?.error && typeof payload.error === 'object'
    ? payload.error
    : payload;

  return {
    payload,
    code: nestedError?.code ?? error?.code,
    status: nestedError?.status ?? error?.status,
    message: nestedError?.message ?? (error instanceof Error ? error.message : String(error ?? '')),
    details: Array.isArray(nestedError?.details)
      ? nestedError.details
      : Array.isArray(error?.details)
        ? error.details
        : [],
  };
};

export const isGeminiRateLimitError = (error) => {
  const { code, status, message } = getGeminiErrorDetails(error);

  return Number(code) === 429
    || status === 'RESOURCE_EXHAUSTED'
    || /rate limit|quota|resource exhausted|429/i.test(message);
};

const collectQuotaViolations = (details) => (
  details.flatMap((detail) => (
    Array.isArray(detail?.violations) ? detail.violations : []
  ))
);

const isDailyGenerateRequestViolation = (violation) => {
  if (!violation || typeof violation !== 'object') return false;

  const quotaId = String(violation.quotaId ?? violation.quota_id ?? '');
  const quotaMetric = String(violation.quotaMetric ?? violation.quota_metric ?? '');
  const description = String(violation.description ?? violation.subject ?? '');
  const quotaText = `${quotaId} ${quotaMetric} ${description}`;

  return /generate[^\s]*requests?[^\s]*per[^\s]*day/i.test(quotaId)
    || (
      /generate[_\s-]*content.*requests?|generate requests?/i.test(quotaText)
      && /per[_\s-]*day|daily/i.test(quotaText)
    );
};

export const isGeminiDailyRequestQuotaError = (error) => {
  if (!isGeminiRateLimitError(error)) return false;

  const { details, message } = getGeminiErrorDetails(error);
  if (collectQuotaViolations(details).some(isDailyGenerateRequestViolation)) {
    return true;
  }

  return /(?:daily|per[-\s]?day).{0,40}(?:request|quota)|(?:request|quota).{0,40}(?:daily|per[-\s]?day)/i
    .test(message);
};

export const isRetryableGeminiError = (error) => {
  if (isGeminiDailyRequestQuotaError(error)) return false;

  const { code, status, message } = getGeminiErrorDetails(error);

  return isGeminiRateLimitError(error)
    || Number(code) === 503
    || status === 'UNAVAILABLE'
    || /high demand|try again later|unavailable|503/i.test(message);
};

export const getPacificDateKey = (now = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

export const createGeminiFallbackRouter = ({
  primaryModel,
  fallbackModel,
  getDateKey = () => getPacificDateKey(),
} = {}) => {
  const normalizedPrimaryModel = String(primaryModel ?? '').trim();
  const normalizedFallbackModel = String(fallbackModel ?? '').trim();
  const fallbackEnabled = Boolean(
    normalizedPrimaryModel
    && normalizedFallbackModel
    && normalizedPrimaryModel !== normalizedFallbackModel
  );
  let primaryQuotaExhaustedDateKey = null;

  const isPrimaryQuotaExhausted = () => (
    fallbackEnabled && primaryQuotaExhaustedDateKey === getDateKey()
  );

  const getPreferredModel = () => (
    isPrimaryQuotaExhausted() ? normalizedFallbackModel : normalizedPrimaryModel
  );

  const generate = async (request, generateContent) => {
    if (typeof generateContent !== 'function') {
      throw new TypeError('generateContent must be a function.');
    }

    const initialModel = getPreferredModel();
    const wasPrimarySkipped = fallbackEnabled && initialModel === normalizedFallbackModel;

    try {
      const response = await generateContent({ ...request, model: initialModel });
      return {
        response,
        model: initialModel,
        fallbackUsed: wasPrimarySkipped,
        fallbackReason: wasPrimarySkipped ? 'primary_daily_quota_cached' : null,
      };
    } catch (error) {
      if (
        !fallbackEnabled
        || initialModel !== normalizedPrimaryModel
        || !isGeminiDailyRequestQuotaError(error)
      ) {
        throw error;
      }

      primaryQuotaExhaustedDateKey = getDateKey();
      const response = await generateContent({ ...request, model: normalizedFallbackModel });
      return {
        response,
        model: normalizedFallbackModel,
        fallbackUsed: true,
        fallbackReason: 'primary_daily_quota',
      };
    }
  };

  return {
    generate,
    getPreferredModel,
    isPrimaryQuotaExhausted,
  };
};
