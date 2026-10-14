import fs from 'node:fs/promises';
import path from 'node:path';
import { parseEnv } from 'node:util';

const usableKey = value => {
  const key = value?.trim();
  return key && key !== 'PLACEHOLDER_API_KEY' && !key.includes('YOUR_') ? key : '';
};

export const loadAiConfig = async ({ rootDir, env = process.env, development = false }) => {
  if (development) {
    if (env.NODE_ENV === 'production' || env.K_SERVICE) {
      throw new Error('Development AI settings cannot be used in production.');
    }
    let local = {};
    try {
      local = parseEnv(await fs.readFile(path.join(rootDir, '.env.development.local'), 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    // Never substitute an operational key when the development key is missing.
    const apiKey = usableKey(env.DEV_GEMINI_API_KEY ?? local.DEV_GEMINI_API_KEY);
    if (!apiKey) {
      throw new Error('Set DEV_GEMINI_API_KEY in .env.development.local before running npm run dev.');
    }
    return {
      apiKey,
      model: 'gemini-4-argon',
      fallbackModel: '',
      fileSearchStore: (env.DEV_GEMINI_FILE_SEARCH_STORE ?? local.DEV_GEMINI_FILE_SEARCH_STORE)?.trim()
        || env.GEMINI_FILE_SEARCH_STORE || '',
      requestConfig: { serviceTier: 'flex', httpOptions: { timeout: 900_000 } },
    };
  }

  const candidates = [
    env.GEMINI_API_KEY,
    env.GOOGLE_API_KEY,
    ...(env.GEMINI_API_KEYS ?? '').split(/[,\s]+/),
    ...Array.from({ length: 10 }, (_, index) => env[`GEMINI_API_KEY_${index + 1}`]),
  ];
  return {
    apiKey: candidates.map(usableKey).find(Boolean) || '',
    model: env.GEMINI_MODEL ?? 'gemini-3.7-flash',
    fallbackModel: env.GEMINI_FALLBACK_MODEL ?? 'gemini-3.5-flash-lite',
    fileSearchStore: env.GEMINI_FILE_SEARCH_STORE ?? '',
    requestConfig: {},
  };
};
