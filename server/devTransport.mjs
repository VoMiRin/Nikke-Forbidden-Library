// Native fetch can supply its own response timeouts, independently of the SDK.
// Override them per request while preserving normal behavior for other hosts.
export const createDevelopmentDispatcher = dispatcher => ({
  dispatch(options, handler) {
    const isGemini = String(options.origin) === 'https://generativelanguage.googleapis.com';
    return dispatcher.dispatch(isGemini
      ? { ...options, headersTimeout: 0, bodyTimeout: 0 }
      : options, handler);
  },
});

export const configureDevelopmentTransport = async () => {
  const { getGlobalDispatcher, setGlobalDispatcher } = await import('undici');
  setGlobalDispatcher(createDevelopmentDispatcher(getGlobalDispatcher()));
};
