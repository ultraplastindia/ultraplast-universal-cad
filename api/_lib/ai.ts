import { ANALYSIS_PROMPT, parseAnalysis } from './aiShapes.js';
import type { AiAnalysis } from './aiShapes.js';
import { getSetting, setSetting, unseal } from './settings.js';

export type VisionId = 'anthropic' | 'openai' | 'gemini';
export type MeshId = 'stability' | 'meshy';
export type ProviderId = VisionId | MeshId;
export interface Provider { enabled: boolean; keyEnc: string; model: string }
export interface AiSettings { providers: Record<ProviderId, Provider>; preferredVision: 'auto' | VisionId; preferredMesh: 'auto' | MeshId; dailyLimit: number }

export const PROVIDERS: { id: ProviderId; label: string; use: 'vision' | 'mesh'; model: string; help: string }[] = [
  { id: 'anthropic', label: 'Anthropic (Claude)', use: 'vision', model: 'claude-sonnet-5-5', help: 'Reads the picture and suggests the part type and proportions. Key from console.anthropic.com.' },
  { id: 'openai', label: 'OpenAI', use: 'vision', model: 'gpt-4o', help: 'Reads the picture and suggests the part type and proportions. Key from platform.openai.com.' },
  { id: 'gemini', label: 'Google Gemini', use: 'vision', model: 'gemini-2.5-flash', help: 'Reads the picture and suggests the part type and proportions. Key from aistudio.google.com.' },
  { id: 'stability', label: 'Stability AI (Stable Fast 3D)', use: 'mesh', model: '', help: 'Makes a 3D mesh (GLB) from one picture. Key from platform.stability.ai.' },
  { id: 'meshy', label: 'Meshy', use: 'mesh', model: '', help: 'Makes a textured 3D mesh (GLB) from one picture. Key from meshy.ai (API settings).' },
];
export const AI_DEFAULT: AiSettings = {
  providers: Object.fromEntries(PROVIDERS.map((p) => [p.id, { enabled: false, keyEnc: '', model: p.model }])) as Record<ProviderId, Provider>,
  preferredVision: 'auto', preferredMesh: 'auto', dailyLimit: 30,
};
/** Saved settings laid over the defaults, so a provider added later still appears. */
export async function loadAi(): Promise<AiSettings> {
  const s = await getSetting<Partial<AiSettings>>('ai', {});
  return { ...AI_DEFAULT, ...s, providers: Object.fromEntries(PROVIDERS.map((p) => [p.id, { ...AI_DEFAULT.providers[p.id], ...(s.providers?.[p.id] ?? {}) }])) as Record<ProviderId, Provider> };
}
export const saveAi = (s: AiSettings): Promise<void> => setSetting('ai', s);
export const keyOf = (p: Provider): string | null => unseal(p.keyEnc);
export const usable = (s: AiSettings, id: ProviderId): boolean => s.providers[id].enabled && !!keyOf(s.providers[id]);

/** Providers to try, in order: the preferred one first, then every other usable one ("automatic" = all enabled ones). */
export function order(s: AiSettings, use: 'vision' | 'mesh'): ProviderId[] {
  const ids = PROVIDERS.filter((p) => p.use === use && usable(s, p.id)).map((p) => p.id);
  const pref = use === 'vision' ? s.preferredVision : s.preferredMesh;
  return pref !== 'auto' && ids.includes(pref) ? [pref, ...ids.filter((i) => i !== pref)] : ids;
}

async function http(url: string, init: RequestInit, ms = 50000): Promise<Response> {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...init, signal: ctl.signal }); } catch (e) { throw new Error(e instanceof Error && e.name === 'AbortError' ? 'The AI service took too long to answer.' : 'Could not reach the AI service.'); } finally { clearTimeout(t); }
}
async function failText(r: Response, who: string): Promise<Error> {
  let m = ''; try { const j = (await r.json()) as { error?: { message?: string } | string; message?: string; errors?: string[] }; m = typeof j.error === 'string' ? j.error : j.error?.message ?? j.message ?? j.errors?.join(' ') ?? ''; } catch { /* no body */ }
  const hint = r.status === 401 || r.status === 403 ? ' (the key was refused: check it and its billing)' : r.status === 429 ? ' (rate or credit limit reached)' : '';
  return new Error(`${who}: ${r.status}${hint}${m ? ` - ${m.slice(0, 160)}` : ''}`);
}

/** One small request with the stored key; used by Settings > "Test". Costs a few tokens at most. */
export async function testProvider(id: ProviderId, p: Provider): Promise<string> {
  const key = keyOf(p); if (!key) throw new Error('No key saved.');
  if (id === 'stability') { const r = await http('https://api.stability.ai/v1/user/balance', { headers: { Authorization: `Bearer ${key}` } }, 15000); if (!r.ok) throw await failText(r, 'Stability'); const j = (await r.json()) as { credits?: number }; return `Key accepted. Credits: ${j.credits ?? 'unknown'}.`; }
  if (id === 'meshy') { const r = await http('https://api.meshy.ai/openapi/v1/balance', { headers: { Authorization: `Bearer ${key}` } }, 15000); if (!r.ok) throw await failText(r, 'Meshy'); const j = (await r.json()) as { balance?: number }; return `Key accepted. Credits: ${j.balance ?? 'unknown'}.`; }
  const t = await vision(id, key, p.model, null, 'Reply with the single word OK.', 8);
  return `Key accepted. Model answered: "${t.trim().slice(0, 30)}".`;
}

type Img = { mime: string; base64: string } | null;
async function vision(id: VisionId, key: string, model: string, img: Img, prompt: string, maxTokens: number): Promise<string> {
  if (id === 'anthropic') {
    const content: unknown[] = img ? [{ type: 'image', source: { type: 'base64', media_type: img.mime, data: img.base64 } }, { type: 'text', text: prompt }] : [{ type: 'text', text: prompt }];
    const r = await http('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'user', content }] }) });
    if (!r.ok) throw await failText(r, 'Anthropic');
    return ((await r.json()) as { content?: { type: string; text?: string }[] }).content?.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('') ?? '';
  }
  if (id === 'openai') {
    const content: unknown[] = img ? [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.base64}` } }] : [{ type: 'text', text: prompt }];
    const r = await http('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'user', content }] }) });
    if (!r.ok) throw await failText(r, 'OpenAI');
    return ((await r.json()) as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content ?? '';
  }
  const parts: unknown[] = img ? [{ text: prompt }, { inline_data: { mime_type: img.mime, data: img.base64 } }] : [{ text: prompt }];
  const r = await http(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', headers: { 'x-goog-api-key': key, 'content-type': 'application/json' }, body: JSON.stringify({ contents: [{ parts }], generationConfig: { maxOutputTokens: maxTokens } }) });
  if (!r.ok) throw await failText(r, 'Gemini');
  return ((await r.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }).candidates?.[0]?.content?.parts?.map((x) => x.text ?? '').join('') ?? '';
}

/** Tries each usable vision provider in order until one gives a readable answer. */
export async function analyse(s: AiSettings, img: { mime: string; base64: string }): Promise<{ provider: ProviderId; analysis: AiAnalysis }> {
  const ids = order(s, 'vision') as VisionId[];
  if (!ids.length) throw new Error('No AI is switched on. The administrator can add a key in Settings > AI.');
  const errs: string[] = [];
  for (const id of ids) {
    try {
      const p = s.providers[id], text = await vision(id, keyOf(p)!, p.model, img, ANALYSIS_PROMPT, 1500), a = parseAnalysis(text);
      if ('error' in a) { errs.push(`${id}: ${a.error}`); continue; }
      return { provider: id, analysis: a };
    } catch (e) { errs.push(e instanceof Error ? e.message : String(e)); }
  }
  throw new Error(errs.join(' | '));
}

/* ---------- 3D mesh from one picture ---------- */
/** Stability answers with the GLB itself (returned as base64). Meshy starts a job (returned as an id to poll). */
export async function meshStart(s: AiSettings, img: { mime: string; base64: string }): Promise<{ provider: MeshId; glb?: string; jobId?: string }> {
  const ids = order(s, 'mesh') as MeshId[];
  if (!ids.length) throw new Error('No 3D AI is switched on. The administrator can add a Stability or Meshy key in Settings > AI.');
  const errs: string[] = [];
  for (const id of ids) {
    const key = keyOf(s.providers[id])!;
    try {
      if (id === 'stability') {
        const form = new FormData(); form.append('image', new Blob([Buffer.from(img.base64, 'base64')], { type: img.mime }), 'part.png');
        const r = await http('https://api.stability.ai/v2beta/3d/stable-fast-3d', { method: 'POST', headers: { Authorization: `Bearer ${key}`, Accept: 'model/gltf-binary' }, body: form }, 55000);
        if (!r.ok) throw await failText(r, 'Stability');
        return { provider: id, glb: Buffer.from(await r.arrayBuffer()).toString('base64') };
      }
      const r = await http('https://api.meshy.ai/openapi/v1/image-to-3d', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ image_url: `data:${img.mime};base64,${img.base64}`, enable_pbr: false, should_texture: true }) });
      if (!r.ok) throw await failText(r, 'Meshy');
      const j = (await r.json()) as { result?: string };
      if (!j.result) throw new Error('Meshy: no job id returned.');
      return { provider: id, jobId: j.result };
    } catch (e) { errs.push(e instanceof Error ? e.message : String(e)); }
  }
  throw new Error(errs.join(' | '));
}
export async function meshStatus(s: AiSettings, jobId: string): Promise<{ status: string; progress: number; glbUrl?: string }> {
  if (!usable(s, 'meshy')) throw new Error('Meshy is not switched on.');
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(jobId)) throw new Error('Bad job id.');
  const r = await http(`https://api.meshy.ai/openapi/v1/image-to-3d/${jobId}`, { headers: { Authorization: `Bearer ${keyOf(s.providers.meshy)!}` } }, 15000);
  if (!r.ok) throw await failText(r, 'Meshy');
  const j = (await r.json()) as { status?: string; progress?: number; model_urls?: { glb?: string } };
  return { status: String(j.status ?? 'UNKNOWN'), progress: Number(j.progress ?? 0), glbUrl: j.model_urls?.glb };
}
/** Downloads the finished GLB. Only Meshy's own download hosts are allowed, so this cannot be used to fetch arbitrary sites. */
export async function meshFile(url: string): Promise<Buffer> {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !/(^|\.)meshy\.ai$/.test(u.hostname)) throw new Error('That download address is not allowed.');
  const r = await http(u.toString(), {}, 40000);
  if (!r.ok) throw new Error(`Download failed (${r.status}).`);
  const b = Buffer.from(await r.arrayBuffer());
  if (b.length > 25_000_000) throw new Error('The model file is too large.');
  return b;
}
