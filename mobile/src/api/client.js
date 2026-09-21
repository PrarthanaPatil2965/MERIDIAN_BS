/**
 * Every network call the app makes. One place to change the base URL,
 * one place to handle timeouts.
 */

const DEFAULT_URL =
  process.env.EXPO_PUBLIC_API_URL || 'http://192.168.1.5:8000';

let baseUrl = DEFAULT_URL;

export const setBaseUrl = (url) => {
  if (url && url.trim()) baseUrl = url.trim().replace(/\/+$/, '');
};
export const getBaseUrl = () => baseUrl;

async function request(path, { method = 'POST', body, isForm = false, timeout = 20000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: isForm ? undefined : { 'Content-Type': 'application/json' },
      body: isForm ? body : body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`Bad response from server (${res.status})`);
    }
    if (!res.ok) throw new Error(json.detail || `Server error ${res.status}`);
    return json;
  } finally {
    clearTimeout(timer);
  }
}

export const health = () => request('/health', { method: 'GET', timeout: 8000 });

export const perceive = (imageBase64, lang, sessionId) =>
  request('/v1/perceive', {
    body: { image: imageBase64, lang, session_id: sessionId },
    timeout: 15000,
  });

export const ask = (question, imageBase64, lang, sessionId) =>
  request('/v1/ask', {
    body: { question, image: imageBase64, lang, session_id: sessionId },
    timeout: 25000,
  });

export async function transcribe(uri, lang = 'auto') {
  // Whisper picks the decoder from the extension, so keep whatever the
  // recorder actually produced (m4a on Android, caf or m4a on iOS).
  const ext = (uri.split('.').pop() || 'm4a').split('?')[0].toLowerCase();
  const mime = { m4a: 'audio/m4a', mp4: 'audio/mp4', caf: 'audio/x-caf', wav: 'audio/wav' }[ext] || 'audio/m4a';
  const form = new FormData();
  form.append('file', { uri, name: `clip.${ext}`, type: mime });
  form.append('lang', lang);
  return request('/v1/stt', { body: form, isForm: true, timeout: 25000 });
}

export const buildSos = ({ name, contact, lat, lng, lang, sendViaServer = false }) =>
  request('/v1/sos', {
    body: { name, contact, lat, lng, lang, send_via_server: sendViaServer },
    timeout: 15000,
  });
