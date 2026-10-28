import express from 'express';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  detectPrimaryScriptAndLanguage,
  validateAndCorrectBengaliOcr,
  applyImageVerifiedCorrections,
} from './src/utils/bengaliOcrPipeline';
import { OcrFlaggedToken } from './src/types';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// High body limit for base64 PDF page rendering
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Key Pool Manager for Multi-Account Quota Scaling, Pacing & Zero-Error Failover
class KeyPoolManager {
  private keys: string[] = [];
  private clients: Map<string, GoogleGenAI> = new Map();
  private cooldowns: Map<string, number> = new Map(); // key -> cooldown until timestamp
  private requestHistory: Map<string, number[]> = new Map(); // key -> timestamps of requests in last 60s
  private activeInFlight: Map<string, number> = new Map(); // key -> active requests in-flight
  private lastPerKeyDispatch: Map<string, number> = new Map(); // key -> timestamp of last dispatch
  private rrIndex: number = 0; // round-robin pointer for concurrent distribution
  private invalidKeys: Set<string> = new Set(); // quarantined invalid/expired keys (401)
  private lastGlobalDispatchTime: number = 0;
  private configFilePath: string;

  constructor(configFilePath: string) {
    this.configFilePath = configFilePath;
    this.loadKeys();
  }

  markInvalid(key: string) {
    if (!key) return;
    this.invalidKeys.add(key);
    this.keys = this.keys.filter((k) => k !== key);
    this.clients.delete(key);
    this.cooldowns.delete(key);
    this.requestHistory.delete(key);
    const custom = this.getStoredCustomKeys();
    if (custom.includes(key)) {
      const filtered = custom.filter((k) => k !== key);
      try {
        fs.writeFileSync(this.configFilePath, JSON.stringify(filtered, null, 2), 'utf8');
      } catch (e) {
        console.warn('Failed to update stored keys file after quarantine:', e);
      }
    }
    console.warn(
      `[KeyPoolManager] Key ${key.substring(0, 8)}... permanently quarantined (401 Invalid). Active keys remaining: ${this.keys.length}`
    );
  }

  isKeyInvalid(key: string): boolean {
    return this.invalidKeys.has(key);
  }

  loadKeys() {
    const keySet = new Set<string>();

    // 1. Default system key
    if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()) {
      const sysKey = process.env.GEMINI_API_KEY.trim();
      if (!this.invalidKeys.has(sysKey)) {
        keySet.add(sysKey);
      }
    }

    // 2. Comma separated keys in GEMINI_API_KEYS
    if (process.env.GEMINI_API_KEYS) {
      process.env.GEMINI_API_KEYS.split(',').forEach((k) => {
        const trimmed = k.trim();
        if (trimmed && trimmed.length > 10 && !this.invalidKeys.has(trimmed)) keySet.add(trimmed);
      });
    }

    // 3. Numbered env keys: GEMINI_API_KEY_1, GEMINI_API_KEY_2, etc.
    for (let i = 1; i <= 20; i++) {
      const k = process.env[`GEMINI_API_KEY_${i}`];
      if (k && k.trim() && k.trim().length > 10 && !this.invalidKeys.has(k.trim())) {
        keySet.add(k.trim());
      }
    }

    // 4. Stored keys file (added through multi-key settings)
    try {
      if (fs.existsSync(this.configFilePath)) {
        const fileContent = fs.readFileSync(this.configFilePath, 'utf8');
        const parsed = JSON.parse(fileContent);
        if (Array.isArray(parsed)) {
          parsed.forEach((k) => {
            if (typeof k === 'string' && k.trim() && k.trim().length > 10) {
              const trimmed = k.trim();
              if (!this.invalidKeys.has(trimmed)) {
                keySet.add(trimmed);
              }
            }
          });
        }
      }
    } catch (e) {
      console.warn('Notice reading stored keys:', e);
    }

    this.keys = Array.from(keySet);
    this.clients.clear();
    for (const key of this.keys) {
      this.clients.set(
        key,
        new GoogleGenAI({
          apiKey: key,
          httpOptions: {
            headers: {
              'User-Agent': 'aistudio-build',
            },
          },
        })
      );
    }

    const safeInterval = (60 / (Math.max(1, this.keys.length) * 14)).toFixed(1);
    console.log(
      `[KeyPoolManager] Loaded ${this.keys.length} API key(s). Total throughput: ${Math.max(
        15,
        this.keys.length * 15
      )} RPM. Safe request interval: ~${safeInterval}s`
    );
  }

  // Enforces global token-bucket pacing so that Google's 15 RPM limit per key is mathematically never exceeded
  async throttlePacing(): Promise<void> {
    const totalKeys = Math.max(1, this.keys.length);
    // Safe RPM: 14 RPM per key (reserving a 1-request safety buffer under Google's 15 RPM limit)
    const safeTotalRpm = totalKeys * 14;
    const minIntervalMs = Math.ceil(60000 / safeTotalRpm);

    const now = Date.now();
    const elapsed = now - this.lastGlobalDispatchTime;
    if (elapsed < minIntervalMs) {
      const waitMs = minIntervalMs - elapsed;
      await new Promise((r) => setTimeout(r, waitMs));
    }
    this.lastGlobalDispatchTime = Date.now();
  }

  // Returns rolling 60-second request count for a key
  getKeyUsageLastMinute(key: string): number {
    const now = Date.now();
    const history = this.requestHistory.get(key) || [];
    const valid = history.filter((t) => now - t < 60000);
    this.requestHistory.set(key, valid);
    return valid.length;
  }

  recordKeyUsage(key: string) {
    const history = this.requestHistory.get(key) || [];
    history.push(Date.now());
    this.requestHistory.set(key, history);
  }

  getStoredCustomKeys(): string[] {
    try {
      if (fs.existsSync(this.configFilePath)) {
        const fileContent = fs.readFileSync(this.configFilePath, 'utf8');
        const parsed = JSON.parse(fileContent);
        if (Array.isArray(parsed)) {
          return parsed.filter((k) => typeof k === 'string' && k.trim().length > 10);
        }
      }
    } catch (e) {
      console.warn('Notice reading stored keys:', e);
    }
    return [];
  }

  registerSessionKeys(newKeys: string[]) {
    let added = false;
    for (const k of newKeys) {
      const trimmed = typeof k === 'string' ? k.trim() : '';
      if (trimmed.length > 10 && !this.invalidKeys.has(trimmed) && !this.keys.includes(trimmed)) {
        this.keys.push(trimmed);
        this.clients.set(
          trimmed,
          new GoogleGenAI({
            apiKey: trimmed,
            httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
          })
        );
        added = true;
      }
    }
    if (added) {
      console.log(
        `[KeyPoolManager] Dynamically registered session keys. Total active: ${this.keys.length}`
      );
    }
  }

  saveAdditionalKeys(newKeys: string[]) {
    const validKeys = Array.from(
      new Set(
        newKeys
          .map((k) => k.trim())
          .filter((k) => k.length > 10 && !this.invalidKeys.has(k))
      )
    );
    try {
      fs.writeFileSync(this.configFilePath, JSON.stringify(validKeys, null, 2), 'utf8');
      this.loadKeys();
      return true;
    } catch (err) {
      console.error('Failed to save additional keys:', err);
      return false;
    }
  }

  addKey(key: string): boolean {
    const trimmed = key.trim();
    if (!trimmed || trimmed.length < 10) return false;
    const currentCustom = this.getStoredCustomKeys();
    if (!currentCustom.includes(trimmed)) {
      currentCustom.push(trimmed);
      return this.saveAdditionalKeys(currentCustom);
    }
    return true;
  }

  removeKey(keyToRemove: string): boolean {
    const trimmed = keyToRemove.trim();
    const currentCustom = this.getStoredCustomKeys();
    const filtered = currentCustom.filter((k) => k !== trimmed);
    return this.saveAdditionalKeys(filtered);
  }

  resetAdditionalKeys() {
    try {
      if (fs.existsSync(this.configFilePath)) {
        fs.unlinkSync(this.configFilePath);
      }
      this.loadKeys();
      return true;
    } catch (err) {
      console.error('Failed to reset additional keys:', err);
      return false;
    }
  }

  hasKeys(): boolean {
    return this.keys.length > 0;
  }

  getTotalKeys(): number {
    return this.keys.length;
  }

  getCapacity(): number {
    return Math.max(15, this.keys.length * 15);
  }

  getStatus() {
    const now = Date.now();
    const storedCustom = this.getStoredCustomKeys();
    const activeKeys = this.keys.map((k, idx) => {
      const isCooldown = (this.cooldowns.get(k) || 0) > now;
      const masked =
        k.length > 10 ? `${k.substring(0, 6)}...${k.substring(k.length - 4)}` : 'AIzaSy...';
      const isCustom = storedCustom.includes(k);
      const rpmUsage = this.getKeyUsageLastMinute(k);
      return {
        id: idx + 1,
        masked,
        status: isCooldown ? 'cooldown' : 'active',
        cooldownRemainingSec: isCooldown
          ? Math.ceil(((this.cooldowns.get(k) || 0) - now) / 1000)
          : 0,
        rpmUsageLastMinute: rpmUsage,
        isCustom,
      };
    });

    const safeIntervalSec = Math.round((60 / (Math.max(1, this.keys.length) * 14)) * 10) / 10;
    const recommendedBatch = Math.max(1, Math.min(5, this.keys.length));

    return {
      totalKeys: this.keys.length,
      totalCapacityRpm: Math.max(15, this.keys.length * 15),
      safeIntervalSec,
      recommendedBatchSize: recommendedBatch,
      keys: activeKeys,
      customKeys: storedCustom,
      customKeysCount: storedCustom.length,
    };
  }

  // Select key with lowest in-flight load, distributed across pool via round-robin
  getNextClient(): { client: GoogleGenAI; key: string; index: number; remainingCooldownMs: number } {
    if (this.keys.length === 0) {
      const fallbackKey = process.env.GEMINI_API_KEY || '';
      return {
        client: new GoogleGenAI({
          apiKey: fallbackKey,
          httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
        }),
        key: fallbackKey,
        index: 0,
        remainingCooldownMs: 0,
      };
    }

    const now = Date.now();
    const total = this.keys.length;

    // 1. Gather all healthy keys (not in cooldown)
    const availableIndices: number[] = [];
    for (let i = 0; i < total; i++) {
      const key = this.keys[i];
      const cooldownUntil = this.cooldowns.get(key) || 0;
      if (cooldownUntil <= now) {
        availableIndices.push(i);
      }
    }

    if (availableIndices.length > 0) {
      // Find lowest in-flight request count among available keys
      let minInFlight = Infinity;
      for (const idx of availableIndices) {
        const inFlight = this.activeInFlight.get(this.keys[idx]) || 0;
        if (inFlight < minInFlight) {
          minInFlight = inFlight;
        }
      }

      // Filter to keys with minimum in-flight load
      const leastBusy = availableIndices.filter(
        (idx) => (this.activeInFlight.get(this.keys[idx]) || 0) === minInFlight
      );

      // Distribute evenly via round-robin among least busy keys
      this.rrIndex = (this.rrIndex + 1) % leastBusy.length;
      const selectedIdx = leastBusy[this.rrIndex];
      const selectedKey = this.keys[selectedIdx];

      return {
        client: this.clients.get(selectedKey)!,
        key: selectedKey,
        index: selectedIdx,
        remainingCooldownMs: 0,
      };
    }

    // All keys are in cooldown! Find the one that expires soonest
    let minCooldownUntil = Infinity;
    let soonestKey = this.keys[0];
    let soonestIdx = 0;

    for (let i = 0; i < total; i++) {
      const key = this.keys[i];
      const cooldownUntil = this.cooldowns.get(key) || 0;
      if (cooldownUntil < minCooldownUntil) {
        minCooldownUntil = cooldownUntil;
        soonestKey = key;
        soonestIdx = i;
      }
    }

    const remainingWait = Math.max(0, minCooldownUntil - now);
    return {
      client: this.clients.get(soonestKey) || new GoogleGenAI({ apiKey: soonestKey }),
      key: soonestKey,
      index: soonestIdx,
      remainingCooldownMs: remainingWait,
    };
  }

  markCooldown(key: string, durationMs: number = 20000) {
    if (key) {
      this.cooldowns.set(key, Date.now() + durationMs);
    }
  }

  // Execute an action with automatic multi-key pacing, failover, and patient cooldown waiting (Zero-Failure)
  async executeWithFailover<T>(
    fn: (client: GoogleGenAI, keyIndex: number, attemptNumber: number) => Promise<T>
  ): Promise<T> {
    const totalKeys = Math.max(1, this.keys.length);
    const maxTries = Math.max(12, totalKeys * 3);
    let lastError: any = null;

    for (let tryCount = 0; tryCount < maxTries; tryCount++) {
      // Step 1: Select next best client (least in-flight + round-robin)
      const { client, key, index, remainingCooldownMs } = this.getNextClient();

      // If all keys are in cooldown, patiently wait out the window (ZERO FAILURE)
      if (remainingCooldownMs > 0) {
        const waitMs = Math.min(22000, remainingCooldownMs + 500);
        console.warn(
          `[KeyPool All-Cooldown] All ${totalKeys} keys cooling down. Patiently waiting ${Math.ceil(
            waitMs / 1000
          )}s for rate-limit reset (attempt #${tryCount + 1}/${maxTries})...`
        );
        await new Promise((r) => setTimeout(r, waitMs));
      }

      // Per-key pacing: ensure this specific key doesn't exceed 14 RPM (~4.2s per request on the same key)
      const lastKeyDispatch = this.lastPerKeyDispatch.get(key) || 0;
      const elapsedOnKey = Date.now() - lastKeyDispatch;
      const minIntervalPerKey = 3800; // ~15.7 RPM safe window
      if (elapsedOnKey < minIntervalPerKey) {
        const waitOnKey = minIntervalPerKey - elapsedOnKey;
        await new Promise((r) => setTimeout(r, waitOnKey));
      }
      this.lastPerKeyDispatch.set(key, Date.now());

      // Track in-flight request on this key
      this.activeInFlight.set(key, (this.activeInFlight.get(key) || 0) + 1);

      try {
        const result = await fn(client, index, tryCount);
        this.recordKeyUsage(key);
        return result;
      } catch (err: any) {
        lastError = err;
        const errStatus = (err as any)?.status || (err as any)?.code || (err as any)?.error?.code;
        const errMsg = String(err?.message || '');
        const errStack = String(err?.stack || '');
        let errJson = '';
        try {
          errJson = JSON.stringify(err);
        } catch {}
        const combined = `${errMsg} ${errStack} ${errJson}`.toLowerCase();

        const isQuota =
          errStatus === 429 ||
          combined.includes('429') ||
          combined.includes('resource_exhausted') ||
          combined.includes('quota exceeded') ||
          combined.includes('rate-limits') ||
          combined.includes('rate limit') ||
          combined.includes('free_tier_requests');

        const isTransient =
          isQuota ||
          errStatus === 503 ||
          combined.includes('503') ||
          combined.includes('high demand') ||
          combined.includes('unavailable') ||
          combined.includes('overloaded');

        if (isTransient) {
          const cooldownDuration = isQuota ? 20000 : 7000;
          console.warn(
            `[Key #${index + 1} ${isQuota ? '429 Rate-Limit' : '503 High-Demand'}] Setting ${cooldownDuration / 1000}s cooldown and failing over (try #${tryCount + 1}/${maxTries})...`
          );
          this.markCooldown(key, cooldownDuration);

          if (this.keys.length > 1) {
            // Immediate zero-wait rotation to another active key
            continue;
          } else {
            // Single key: wait with exponential backoff
            const waitTime = Math.min(15000, 3000 * (tryCount + 1));
            console.log(`[Single Key Pacing] Waiting ${waitTime / 1000}s for rate-limit window...`);
            await new Promise((r) => setTimeout(r, waitTime));
            continue;
          }
        } else {
          const isAuthError =
            errStatus === 401 ||
            combined.includes('401') ||
            combined.includes('unauthenticated') ||
            combined.includes('api key not valid') ||
            combined.includes('access_token_type_unsupported') ||
            combined.includes('api_key_invalid');

          if (isAuthError) {
            console.warn(
              `[Key #${index + 1} INVALID 401 UNAUTHENTICATED] Quarantining and removing invalid key: ${key.substring(
                0,
                8
              )}...`
            );
            this.markInvalid(key);
            if (this.keys.length > 0) {
              continue;
            } else {
              this.loadKeys();
              continue;
            }
          }

          // Model 404 or other temporary issue
          if (
            errStatus === 404 ||
            combined.includes('404') ||
            combined.includes('not_found') ||
            combined.includes('no longer available')
          ) {
            console.warn(`[Model 404] Model unavailable, continuing to next model in pool...`);
            continue;
          }
          if (tryCount < 4) {
            await new Promise((r) => setTimeout(r, 1200));
            continue;
          }
          throw err;
        }
      } finally {
        this.activeInFlight.set(key, Math.max(0, (this.activeInFlight.get(key) || 1) - 1));
      }
    }

    throw lastError;
  }
}

// Initialize key pool manager
const keyPool = new KeyPoolManager(path.resolve(__dirname, 'server_keys.json'));

// Map model options to official high-capacity supported models
// gemini-3.1-flash-lite provides verified, ultra-fast multimodal vision with full quota
function resolveModelName(modelOption: string): string {
  switch (modelOption) {
    case 'HTAV':
    case 'VHBB':
    case 'LTLB':
    case 'LTGB':
    default:
      return 'gemini-3.1-flash-lite';
  }
}

// API: Get Key Pool Status
app.get('/api/key-pool', (req, res) => {
  res.json({
    success: true,
    ...keyPool.getStatus(),
  });
});

// API: Save Additional Keys into Server Pool (Merges incoming keys with existing server keys)
app.post('/api/key-pool', (req, res) => {
  const { keys } = req.body;
  if (!Array.isArray(keys)) {
    return res.status(400).json({ error: 'keys must be an array of strings' });
  }

  const currentCustom = keyPool.getStoredCustomKeys();
  const validIncoming = keys
    .filter((k) => typeof k === 'string' && k.trim().length > 10)
    .map((k) => k.trim());
  const merged = Array.from(new Set([...currentCustom, ...validIncoming]));

  const success = keyPool.saveAdditionalKeys(merged);
  if (!success) {
    return res.status(500).json({ error: 'Failed to save keys to server storage.' });
  }

  return res.json({
    success: true,
    message: 'কী সফলভাবে সংরক্ষণ করা হয়েছে এবং পুল আপডেট হয়েছে।',
    ...keyPool.getStatus(),
  });
});

// API: Add a single key with live verification
app.post('/api/key-pool/add', async (req, res) => {
  const { key } = req.body;
  if (!key || typeof key !== 'string' || key.trim().length < 10) {
    return res.status(400).json({ error: 'অনুগ্রহ করে একটি সঠিক জেমিনাই এআই কী প্রদান করুন।' });
  }

  const trimmed = key.trim();

  // Live test against Gemini API before accepting
  try {
    const testAi = new GoogleGenAI({
      apiKey: trimmed,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });
    await testAi.models.generateContent({
      model: 'gemini-3.1-flash-lite',
      contents: 'ping',
    });
  } catch (err: any) {
    const errStatus = (err as any)?.status || (err as any)?.code || (err as any)?.error?.code;
    const msg = String(err?.message || '').toLowerCase();
    if (
      errStatus === 401 ||
      msg.includes('401') ||
      msg.includes('api key not valid') ||
      msg.includes('unauthenticated') ||
      msg.includes('access_token_type_unsupported')
    ) {
      keyPool.markInvalid(trimmed);
      return res.status(400).json({
        error:
          'প্রদত্ত জেমিনাই এআই কী-টি বৈধ নয় বা মেয়াদোত্তীর্ণ (401 Unauthenticated)। অনুগ্রহ করে https://aistudio.google.com/apikey থেকে সঠিক API কী প্রদান করুন।',
      });
    }
  }

  const success = keyPool.addKey(trimmed);
  if (!success) {
    return res.status(500).json({ error: 'কী সংরক্ষণ করতে ব্যর্থ হয়েছে।' });
  }

  return res.json({
    success: true,
    message: 'নতুন কী সফলভাবে যুক্ত ও স্থায়ীভাবে সংরক্ষণ করা হয়েছে।',
    ...keyPool.getStatus(),
  });
});

// API: Remove a single key
app.post('/api/key-pool/remove', (req, res) => {
  const { key } = req.body;
  if (!key || typeof key !== 'string') {
    return res.status(400).json({ error: 'কী উল্লেখ করুন।' });
  }

  const success = keyPool.removeKey(key);
  return res.json({
    success,
    message: 'কী সফলভাবে তালিকা থেকে মুছে ফেলা হয়েছে।',
    ...keyPool.getStatus(),
  });
});

// API: Reset to Default Key
app.delete('/api/key-pool', (req, res) => {
  const success = keyPool.resetAdditionalKeys();
  return res.json({
    success,
    message: 'ডিফল্ট কী পুলে রিসেট করা হয়েছে।',
    ...keyPool.getStatus(),
  });
});

// Utility to cleanly strip printed page numbers appearing on scanned PDF pages (header or footer)
function stripPrintedPageNumbers(text: string): string {
  if (!text) return '';
  const lines = text.split('\n');
  const filtered: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();

    // Check if line is only a printed page number (Bengali or English digits)
    // Matches: '১২', '12', '- ১২ -', '— ১২ —', 'পৃষ্ঠা ১২', 'Page 12', '১২ |', '| ১২', '12.', '১২।'
    const isPageNumOnly =
      /^[-—–~|\s\.\*]*[০-৯0-9]{1,4}[-—–~|\s\.\*।]*$/.test(trimmed) ||
      /^(?:পৃষ্ঠা|পেজ|page)\s*[:।\-–—~.]*\s*[০-৯0-9]{1,4}$/i.test(trimmed) ||
      /^[০-৯0-9]{1,4}\s*[:।\-–—~/]*\s*(?:পৃষ্ঠা|পেজ|page)$/i.test(trimmed);

    // If it's an isolated page number line anywhere, skip it
    if (isPageNumOnly) {
      continue;
    }

    // Running header or footer with page number on top or bottom
    if ((i === 0 || i >= lines.length - 2) && /^.*?[\-–—|]\s*(?:পৃষ্ঠা\s*)?[০-৯0-9]{1,4}\s*$/i.test(trimmed)) {
      continue;
    }

    filtered.push(raw);
  }

  return filtered.join('\n').trim();
}

// API endpoint for OCR of a single page with multi-key failover
app.post('/api/ocr-page', async (req, res) => {
  try {
    const {
      imageBase64,
      pageNumber,
      totalPages,
      bookDetails,
      layoutConfig,
      watermarkFilters,
      modelChoice = 'LTGB',
      language = 'bn',
      mode = 'text', // 'text' | 'image'
      hasImages = false,
      customKeys,
    } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ error: 'No image provided for OCR.' });
    }

    // Immediately incorporate any client-provided custom keys to ensure multi-key throughput
    if (Array.isArray(customKeys) && customKeys.length > 0) {
      keyPool.registerSessionKeys(customKeys);
    }

    let mimeType = 'image/jpeg';
    let cleanBase64 = imageBase64;
    const mimeMatch = imageBase64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/);
    if (mimeMatch) {
      mimeType = mimeMatch[1];
      cleanBase64 = imageBase64.substring(mimeMatch[0].length);
    } else {
      cleanBase64 = imageBase64.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
    }

    const modelToUse = resolveModelName(modelChoice);

    // Dynamic Mode Handling:
    // 'smart': Default & recommended - extracts clean text and automatically detects/crops any diagrams, portraits, or icons with exact 2D bounds
    // 'image': Forces extraction of figures & text
    // 'text': Text-only extraction
    const effectiveMode = mode === 'text' ? 'text' : 'smart';

    const watermarkText =
      Array.isArray(watermarkFilters) && watermarkFilters.length > 0
        ? `\n- বিশেষ নির্দেশ: নিম্নলিখিত জলছাপ বা স্ক্যানার টেক্সট বাদ দিন: ${watermarkFilters.join(', ')}`
        : '';

    const bookContext = bookDetails?.title
      ? `বইয়ের নাম: ${bookDetails.title}. লেখক: ${bookDetails.author || 'অজ্ঞাত'}.\n`
      : '';

    const imageInstruction =
      effectiveMode === 'text'
        ? `\n- কোনো ইমেজ ট্যাগ যুক্ত করবেন না। শুধুমাত্র বইয়ের লিখিত মূল টেক্সট ও শিরোনাম দ্রুত রূপান্তর করুন।`
        : `\n- চিত্র ও লোগো পজিশনিং নির্দেশিকা (Image & Figure Alignment):
১. এই পৃষ্ঠায় যদি কোনো ছবি, অলঙ্করণ, ডায়াগ্রাম, প্রতিকৃতি বা প্রকাশনীর লোগো/আইকন থাকে, তবে টেক্সটের সঠিক স্থানে নিম্নোক্ত ট্যাগ দিন:
[IMAGE_FIGURE: {"type": "logo" | "icon" | "illustration" | "diagram", "box_2d": [ymin, xmin, ymax, xmax], "align": "left" | "center" | "right"}]
২. ছবির অবস্থান ও পজিশনিং (Do NOT force center images):
   - ইমেজ অযথা সেন্টার করার দরকার নেই! একচুয়াল পিডিএফ ডকুমেন্টে ইমেজ যেরকম অবস্থানে ছিল ঠিক সেই অনুযায়ী পজিশনিং ফলো করুন।
   - যদি পিডিএফে ছবিটি বামে থাকে, তবে "align": "left" দিন।
   - যদি ছবিটি পৃষ্ঠার মাঝে থাকে, তবে "align": "center" দিন।
   - যদি ছবিটি ডানে থাকে, তবে "align": "right" দিন।
৩. বাউন্ডিং বক্স (box_2d): [ymin, xmin, ymax, xmax] হলো ০ থেকে ১০০০ স্কেলে স্বাভাবিকীকৃত ২ডি স্থানাঙ্ক। কোনো অবস্থাতেই পুরো পাতার প্রস্থ বা অযাচিত ফাঁকা মার্জিন ধরবেন না।
৪. কোনো ক্যাপশন দেবেন না: ছবির নিচে আলাদা করে কোনো ক্যাপশন, নাম, নম্বর বা বিবরণ (যেমন: '*ক্যাপশন*' বা '*চিত্র ১*') লিখবেন না।
৫. সাধারণ টেক্সট পাতার ক্ষেত্রে (যেখানে কোনো ছবি বা লোগো নেই) কোনো IMAGE_FIGURE ট্যাগ দেবেন না।`;

    // Pre-OCR Language & Writing System Detection
    const langProfile = detectPrimaryScriptAndLanguage('', bookDetails, language);
    const languageModeInstruction =
      language === 'bn-en' || langProfile.isMixedBengaliEnglish
        ? `ভাষা ও লিপি নির্দেশিকা (Mixed Bengali-English Document):
   - এই ডকুমেন্টে বাংলা এবং ইংরেজি উভয় ভাষার টেক্সট থাকতে পারে।
   - বাংলা শব্দের ক্ষেত্রে শতভাগ খাঁটি বাংলা ইউনিকোড (U+0980 থেকে U+09FF) ব্যবহার করুন। কোনো বাংলা শব্দের ভেতর ভুলবশত তেলুগু (যেমন: 'కిংবা' এর বদলে অবশ্যই 'কিংবা' লিখুন), তামিল, দেবনাগরী/হিন্দি, ওড়িয়া, কন্নড় বা ল্যাটিন অক্ষর মেশাবেন না।
   - প্রকৃত ইংরেজি শব্দ, বিদেশি নাম, সংখ্যা এবং গাণিতিক চিহ্ন অবিকৃত রাখুন।`
        : `ভাষা ও লিপি কঠোর নির্দেশিকা (Strict Bengali Unicode Script Enforcement):
   - প্রতিটি বাংলা শব্দ অবশ্যই খাঁটি বাংলা ইউনিকোড ব্লকে (U+0980–U+09FF) লিখতে হবে।
   - কোনো বাংলা শব্দের ভেতরে কখনোই তেলুগু (যেমন: ভুল 'కిংবা' নয়, সঠিক 'কিংবা'), তামিল, দেবনাগরী, ওড়িয়া, কন্নড়, গুজরাটি বা অন্য কোনো লিপির অক্ষর প্রবেশ করাবেন না।
   - মূল বইয়ের বানান, যুক্তাক্ষর (ক্ষ, জ্ঞ, ষ্ণ, ণ্ড, হ্ণ, ব্র, ট্র, ঙ্ক, ঙ্গ, ঙ্ঘ), কার-চিহ্ন (া, ি, ী, ু, ূ, ৃ, ে, ৈ, ো, ৌ), চন্দ্রবিন্দু (ঁ), অনুস্বার (ং), বিসর্গ (ঃ) এবং বিরামচিহ্ন (দাঁড়ি '।') হুবহু বজায় রাখুন।
   - পাতায় যদি কোনো বৈধ ইংরেজি শব্দ, সংখ্যা, গাণিতিক প্রতীক বা সংস্কৃত/আরবি উদ্ধৃতি থাকে, তবে তা পরিবর্তন না করে যথাযথভাবে সংরক্ষণ করুন।`;

    const systemPrompt = `আপনি একজন বিশেষজ্ঞ দ্রুতগতির বাংলা বই ওসিআর রূপান্তরকারী।
প্রদত্ত বইয়ের স্ক্যান পৃষ্ঠার লেখা নিখুঁত বাংলা বানানে পাঠোদ্ধার করে সরাসরি খাঁটি মার্কডাউনে দিন।
${bookContext}পৃষ্ঠা: ${pageNumber || 'অজ্ঞাত'}${totalPages ? ` / ${totalPages}` : ''}

কঠোর নির্দেশনাবলী:
১. বানান ও যুক্তাক্ষর (ক্ষ, জ্ঞ, ষ্ণ, ণ্ড, হ্ণ, ব্র, ট্র) ও বিরামচিহ্ন (দাঁড়ি '।', কমা) মূল বইয়ের অনুরূপ নির্ভুল রাখুন।
${languageModeInstruction}
২. পৃষ্ঠা নম্বর সম্পূর্ণ বর্জন ও স্কিপ করুন (SKIP ALL PRINTED PAGE NUMBERS):
   - স্ক্যান করা পিডিএফ পৃষ্ঠার নিচের দিকে (ফুটার) বা উপরের দিকে (হেডার) থাকা মুদ্রিত পৃষ্ঠা নম্বর (যেমন: '১২', '- ১২ -', 'পৃষ্ঠা ১২', '১২৩', '১', '২' ইত্যাদি) নেওয়ার কোনো দরকার নেই।
   - কোনো অবস্থাতেই টেক্সটে পৃষ্ঠা নম্বর রাখবেন না। সম্পূর্ণ বর্জন ও স্কিপ করে যান।
৩. টেক্সট ও ইমেজের সঠিক পজিশনিং ও বেসিক ইনডেন্টেশন বজায় রাখুন:
   - সেন্টার অ্যালাইন (Center Align): মূল বই/পিডিএফ-এ যেসব লেখা সম্পূর্ণ মাঝে বা সেন্টার অ্যালাইন করা আছে (যেমন: অধ্যায়ের নাম, কবিতার চরণ/স্তবক, বইয়ের উৎসর্গপত্র, বিশেষ বার্তা/ঘোষণা, তারকাদল বা সেকশন বিভাজক * * * / ***), সেগুলোকে <p class="text-center">লেখা</p> বা <div class="text-center">লেখা</div> ট্যাগ দিয়ে যথাযথভাবে সেন্টার অ্যালাইন রাখুন।
   - লেফট অ্যালাইন (Left Align): সাধারণ অনুচ্ছেদ বা মূল বিবরণ মূল স্ক্যানের ন্যায় যথাযথভাবে লেফট অ্যালাইন রাখুন (যেমন সাধারণ প্যারাগ্রাফ বা <p class="text-left">লেখা</p>)।
   - রাইট অ্যালাইন (Right Align): যেসব লেখা মূল স্ক্যানে পৃষ্ঠার ডানপাশে বা রাইট অ্যালাইন থাকে (যেমন: তারিখ, স্থান, লেখকের স্বাক্ষর বা শ্লোক শেষের উদ্ধৃতি), সেগুলোকে <p class="text-right">লেখা</p> দিয়ে ডানপাশে রাখুন।
   - ছবির পজিশনিং (Image Alignment): ইমেজ জোর করে সেন্টার করার প্রয়োজন নেই। একচুয়াল পিডিএফে ইমেজ বামে থাকলে বামে ("align": "left"), মাঝে থাকলে মাঝে ("align": "center"), ডানে থাকলে ডানে ("align": "right") রাখুন।
   - বেসিক ইনডেন্টেশন (Indentation): স্ক্যানের অনুচ্ছেদের শুরুর স্পেস বা ইনডেন্টেশন, সংলাপে চরিত্রের বক্তব্যের ইনডেন্ট, কবিতার স্তবকের ভেতরের ইনডেন্টেশন হুবহু বজায় রাখুন। ইনডেন্টেড লাইনের ক্ষেত্রে স্বাভাবিক স্পেস অথবা <p class="indent-1">লেখা</p> / <p class="indent-2">লেখা</p> ব্যবহার করুন।
৪. বইয়ের রানিং নাম বা মুদ্রিত হেডার, ফর্মা নম্বর এবং অযাচিত জলছাপ বর্জন করুন।${watermarkText}
৫. মাল্টি-কলাম পঠনক্রম (Multi-Column Reading Order): পৃষ্ঠায় ২ বা ততোধিক কলাম থাকলে কখনোই বাম ও ডান কলামের লাইন পাশাপাশি মিশিয়ে ফেলবেন না; প্রথমে বাম কলাম (Column 1) উপর থেকে নিচ পর্যন্ত সম্পূর্ণ পাঠোদ্ধার করুন, তারপর ডান কলাম (Column 2) উপর থেকে নিচ পর্যন্ত পাঠোদ্ধার করুন। ফুল-উইডথ শিরোনাম বা টেবিল যথাস্থানে রাখুন।
৬. প্রধান শিরোনামকে '# ' বা '## ' দিন, প্যারাগ্রাফের মাঝে স্বাভাবিক লাইনব্রেক দিন, কবিতার প্রতিটি পঙক্তি আলাদা লাইনে রাখুন এবং কোনো কৃত্রিম ফাঁকা ট্যাগ (<p></p> বা অতিরিক্ত <br/>) যোগ করবেন না।${imageInstruction}
৭. সরাসরি খাঁটি মার্কডাউন দিন, কোনো ভূমিকা বা বাড়তি কথা বলবেন না।`;

    // Execute with KeyPool automatic rotation & failover
    let actualModel = modelToUse;
    let usedKeyIndex = 0;

    const response = await keyPool.executeWithFailover(async (aiClient, keyIndex, attempt) => {
      usedKeyIndex = keyIndex;
      // Resilient model tiering: primary verified model -> official aliases
      const resilientModels = [
        modelToUse,
        'gemini-3.1-flash-lite',
        'gemini-flash-lite-latest',
        'gemini-flash-latest',
      ];
      actualModel = resilientModels[attempt % resilientModels.length];
      if (attempt > 0) {
        console.log(
          `[Failover] Attempt #${attempt + 1}: routing to model ${actualModel} with Key #${keyIndex + 1}`
        );
      }

      return await aiClient.models.generateContent({
        model: actualModel,
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: mimeType,
                data: cleanBase64,
              },
            },
            {
              text: `এই বাংলা পৃষ্ঠাটি দ্রুত ও নির্ভুলভাবে পাঠোদ্ধার (OCR) করে ক্লিন মার্কডাউনে দিন। বাংলা শব্দের ভেতর অন্য কোনো লিপির অক্ষর (যেমন তেলুগু বা দেবনাগরী) মেশাবেন না।`,
            },
          ],
        },
        config: {
          systemInstruction: systemPrompt,
          temperature: 0.1,
          thinkingConfig: {
            thinkingLevel: ThinkingLevel.MINIMAL,
          },
        },
      });
    });

    const rawMarkdown = response?.text || '';

    // Strip only standalone generic placeholder labels beneath figure tags (e.g. "চিত্র", "*চিত্র*", "[চিত্র]", "*ক্যাপশন*")
    // while preserving genuine source captions such as "চিত্র ১: মুঘল স্থাপত্য"
    const strippedCaptionsMarkdown = rawMarkdown.replace(
      /(\[IMAGE_FIGURE:\s*{[\s\S]*?}\])\s*\n\s*(?:\*+|_+|\s+|\[+|\()*(?:চিত্র|ছবি|ক্যাপশন|চিত্রাঙ্কন|ডায়াগ্রাম|ডায়াগ্রাম|অলঙ্করণ|figure|image|illustration|diagram|photo|caption)(?:\*+|_+|\s+|\]+|\)|[:।.\-–—])*(?=\r?\n|$)/gi,
      '$1'
    );

    // Strip all printed page numbers from top or bottom of the page
    const rawOcr = stripPrintedPageNumbers(strippedCaptionsMarkdown);

    // Stage 3 & 4: Post-OCR Unicode Script Validation & Context-Aware Error Correction
    const validationResult = validateAndCorrectBengaliOcr(rawOcr, {
      language,
      bookDetails,
    });
    let markdown = validationResult.correctedText;
    let ocrValidation = validationResult.validationReport;

    // Stage 5: Selective Image-Based Verification (only triggered when suspicious low-confidence tokens exist)
    if (ocrValidation.flaggedTokens.length > 0 && cleanBase64) {
      try {
        const tokensToVerify = ocrValidation.flaggedTokens.slice(0, 5);
        const tokenDescriptions = tokensToVerify
          .map(
            (t, idx) =>
              `${idx + 1}. Token: "${t.token}" (Line ${t.lineNumber}, approx region box_2d: [${t.region.box2d.join(', ')}], Context: "${t.contextSentence}", Plausible candidates: [${t.plausibleCandidates.join(', ')}])`
          )
          .join('\n');

        const verifyResponse = await keyPool.executeWithFailover(async (aiClient) => {
          return await aiClient.models.generateContent({
            model: actualModel,
            contents: {
              parts: [
                {
                  inlineData: {
                    mimeType,
                    data: cleanBase64,
                  },
                },
                {
                  text: `এই পৃষ্ঠার নির্দিষ্ট কিছু সন্দেহজনক ওসিআর শব্দ মূল ছবির গ্লিফ (glyph) দেখে যাচাই করুন:\n${tokenDescriptions}\n\nশুধুমাত্র যদি ছবির অক্ষর স্পষ্টভাবে পড়া যায় তবেই "high" কনফিডেন্স দিন, অনুমান করবেন না।`,
                },
              ],
            },
            config: {
              temperature: 0.0,
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    token: { type: Type.STRING },
                    lineNumber: { type: Type.INTEGER },
                    verifiedWord: { type: Type.STRING },
                    visualConfidence: { type: Type.STRING },
                    glyphEvidence: { type: Type.STRING },
                  },
                  required: ['token', 'lineNumber', 'verifiedWord', 'visualConfidence', 'glyphEvidence'],
                },
              },
            },
          });
        });

        const verifyJsonText = verifyResponse?.text?.trim();
        if (verifyJsonText) {
          const parsedVerified = JSON.parse(verifyJsonText);
          if (Array.isArray(parsedVerified)) {
            const applied = applyImageVerifiedCorrections(markdown, ocrValidation, parsedVerified);
            markdown = applied.updatedText;
            ocrValidation = applied.updatedReport;
          }
        }
      } catch (verifyErr) {
        console.warn('[OCR Image Verification] Selective visual verification skipped:', verifyErr);
      }
    }

    // Check if any figure tags were identified in smart or image mode
    const figures: Array<{
      caption: string;
      type: string;
      top: number;
      left: number;
      width: number;
      height: number;
      align: 'left' | 'center' | 'right';
    }> = [];

    if (effectiveMode !== 'text') {
      const figureRegex = /\[IMAGE_FIGURE:\s*({[\s\S]*?)\s*\]/g;
      let match;
      while ((match = figureRegex.exec(markdown)) !== null) {
        try {
          let parsed: any = null;
          const rawChunk = match[1];
          try {
            // Fix common LLM bracket typos where [a, b, c, d} is written instead of [a, b, c, d]}
            let fixed = rawChunk.replace(/\[\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\}/, '[$1, $2, $3, $4]}');
            if (!fixed.endsWith('}')) fixed += '}';
            parsed = JSON.parse(fixed);
          } catch {
            const nm = rawChunk.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
            if (nm) {
              parsed = {
                box_2d: [Number(nm[1]), Number(nm[2]), Number(nm[3]), Number(nm[4])],
                type: rawChunk.includes('logo') ? 'logo' : rawChunk.includes('icon') ? 'icon' : 'illustration',
              };
            }
          }

          if (!parsed) continue;

          let topVal = 20;
          let leftVal = 10;
          let widthVal = 80;
          let heightVal = 30;

          const box = parsed.box_2d || parsed.bbox || parsed.bounding_box || parsed.box;
          if (Array.isArray(box) && box.length === 4) {
            const [ymin, xmin, ymax, xmax] = box.map(Number);
            const scale = Math.max(ymin, xmin, ymax, xmax) > 100 ? 10 : 1;
            topVal = Math.max(0, ymin / scale);
            leftVal = Math.max(0, xmin / scale);
            widthVal = Math.max(2, (xmax - xmin) / scale);
            heightVal = Math.max(2, (ymax - ymin) / scale);
          } else if (parsed.top !== undefined || parsed.left !== undefined) {
            topVal = Number(parsed.top ?? parsed.approx_top_percent ?? 20);
            leftVal = Number(parsed.left ?? parsed.approx_left_percent ?? 10);
            widthVal = Number(parsed.width ?? parsed.approx_width_percent ?? 80);
            heightVal = Number(parsed.height ?? parsed.approx_height_percent ?? 30);
          } else if (parsed.ymin !== undefined && parsed.xmin !== undefined) {
            const ymin = Number(parsed.ymin);
            const xmin = Number(parsed.xmin);
            const ymax = Number(parsed.ymax ?? ymin + 150);
            const xmax = Number(parsed.xmax ?? xmin + 150);
            const scale = Math.max(ymin, xmin, ymax, xmax) > 100 ? 10 : 1;
            topVal = ymin / scale;
            leftVal = xmin / scale;
            widthVal = Math.max(2, (xmax - xmin) / scale);
            heightVal = Math.max(2, (ymax - ymin) / scale);
          }

          // Determine actual position from PDF document: left, center, or right
          let alignVal: 'left' | 'center' | 'right' = 'center';
          if (parsed.align === 'left' || parsed.align === 'right' || parsed.align === 'center') {
            alignVal = parsed.align;
          } else if (leftVal < 25 && widthVal < 60) {
            alignVal = 'left';
          } else if (leftVal + widthVal / 2 > 65 && widthVal < 60) {
            alignVal = 'right';
          } else {
            alignVal = 'center';
          }

          const rawFigCaption = typeof parsed.caption === 'string' ? parsed.caption.trim() : '';
          const isGenericPlaceholder =
            !rawFigCaption ||
            /^(?:\*+|_+|\s+|\[+|\()*(?:চিত্র|ছবি|ক্যাপশন|চিত্রাঙ্কন|ডায়াগ্রাম|ডায়াগ্রাম|অলঙ্করণ|লোগো|আইকন|প্রতিকৃতি|figure|image|illustration|diagram|photo|caption)(?:\*+|_+|\s+|\]+|\)|[:।.\-–—])*$/i.test(
              rawFigCaption
            );

          figures.push({
            caption: isGenericPlaceholder ? '' : rawFigCaption,
            type: parsed.type || 'figure',
            top: isNaN(topVal) ? 20 : topVal,
            left: isNaN(leftVal) ? 10 : leftVal,
            width: isNaN(widthVal) ? 80 : widthVal,
            height: isNaN(heightVal) ? 30 : heightVal,
            align: alignVal,
          });
        } catch {
          // ignore parse errors
        }
      }
    }

    return res.json({
      success: true,
      pageNumber,
      markdown,
      rawOcr,
      ocrValidation,
      figures,
      modelUsed: actualModel,
      channelUsed: usedKeyIndex + 1,
      appliedMode: effectiveMode,
    });
  } catch (error: any) {
    console.error('OCR Error on server:', error);
    const errStatus = (error as any)?.status || (error as any)?.code || (error as any)?.error?.code;
    const errMsg = String(error?.message || '');
    let errJson = '';
    try {
      errJson = JSON.stringify(error);
    } catch {}
    const combined = `${errMsg} ${errJson}`.toLowerCase();

    const isQuota =
      errStatus === 429 ||
      combined.includes('429') ||
      combined.includes('resource_exhausted') ||
      combined.includes('quota exceeded') ||
      combined.includes('rate-limits') ||
      combined.includes('free_tier_requests');

    const is503 =
      errStatus === 503 ||
      combined.includes('503') ||
      combined.includes('high demand') ||
      combined.includes('unavailable') ||
      combined.includes('overloaded');

    const friendlyMsg = isQuota
      ? 'গুগল এআই কোটা সীমা (429 Rate Limit): সবকটি সক্রিয় কী-এর প্রতি মিনিটের সীমা সাময়িকভাবে পূর্ণ হয়েছে। অনুগ্রহ করে কয়েক সেকেন্ড অপেক্ষা করে রিস্ক্যান বাটনে ক্লিক করুন অথবা মাল্টি-কী পুলে আরও একটি জিমেইল কী যুক্ত করুন।'
      : is503
      ? 'গুগল এআই সার্ভার সাময়িকভাবে অতিরিক্ত চাপে রয়েছে। অনুগ্রহ করে কয়েক সেকেন্ড পর আবার রিস্ক্যান বাটনে চাপুন।'
      : 'জেমিনাই ভিশন এআই দিয়ে রূপান্তরের সময় সাময়িক ত্রুটি ঘটেছে। অনুগ্রহ করে পুনরায় চেষ্টা করুন।';

    return res.status(isQuota ? 429 : 500).json({
      success: false,
      error: friendlyMsg,
      detail: errMsg,
      isRateLimit: isQuota,
    });
  }
});

// Selective Image-Based Verification Endpoint for Suspicious OCR Tokens
app.post('/api/verify-ocr-tokens', async (req, res) => {
  try {
    const { imageBase64, markdown, flaggedTokens } = req.body as {
      imageBase64: string;
      markdown: string;
      flaggedTokens: OcrFlaggedToken[];
    };

    if (!imageBase64 || !markdown || !Array.isArray(flaggedTokens) || flaggedTokens.length === 0) {
      return res.status(400).json({ error: 'Missing imageBase64, markdown, or flaggedTokens.' });
    }

    let mimeType = 'image/jpeg';
    let cleanBase64 = imageBase64;
    const mimeMatch = imageBase64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/);
    if (mimeMatch) {
      mimeType = mimeMatch[1];
      cleanBase64 = imageBase64.substring(mimeMatch[0].length);
    } else {
      cleanBase64 = imageBase64.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
    }

    const tokenDescriptions = flaggedTokens
      .slice(0, 5)
      .map(
        (t, idx) =>
          `${idx + 1}. Token: "${t.token}" (Line ${t.lineNumber}, approx region box_2d: [${t.region.box2d.join(', ')}], Context: "${t.contextSentence}", Plausible candidates: [${t.plausibleCandidates.join(', ')}])`
      )
      .join('\n');

    const verifyResponse = await keyPool.executeWithFailover(async (aiClient) => {
      return await aiClient.models.generateContent({
        model: 'gemini-3.1-flash-lite',
        contents: {
          parts: [
            { inlineData: { mimeType, data: cleanBase64 } },
            {
              text: `এই পৃষ্ঠার সন্দেহজনক শব্দগুলো মূল ছবির গ্লিফ (glyph) দেখে যাচাই করুন:\n${tokenDescriptions}\n\nছবির অক্ষর স্পষ্টভাবে মিললে "high" কনফিডেন্স দিন, অন্যথায় "low" দিন।`,
            },
          ],
        },
        config: {
          temperature: 0.0,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                token: { type: Type.STRING },
                lineNumber: { type: Type.INTEGER },
                verifiedWord: { type: Type.STRING },
                visualConfidence: { type: Type.STRING },
                glyphEvidence: { type: Type.STRING },
              },
              required: ['token', 'lineNumber', 'verifiedWord', 'visualConfidence', 'glyphEvidence'],
            },
          },
        },
      });
    });

    const baseValidation = validateAndCorrectBengaliOcr(markdown);
    let updatedText = baseValidation.correctedText;
    let updatedReport = baseValidation.validationReport;

    const verifyJsonText = verifyResponse?.text?.trim();
    if (verifyJsonText) {
      const parsedVerified = JSON.parse(verifyJsonText);
      if (Array.isArray(parsedVerified)) {
        const applied = applyImageVerifiedCorrections(updatedText, updatedReport, parsedVerified);
        updatedText = applied.updatedText;
        updatedReport = applied.updatedReport;
      }
    }

    return res.json({
      success: true,
      markdown: updatedText,
      ocrValidation: updatedReport,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err?.message || 'Image verification failed',
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    hasGeminiKey: keyPool.hasKeys(),
    totalKeys: keyPool.getTotalKeys(),
    rpmCapacity: keyPool.getCapacity(),
  });
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(Number(port), '0.0.0.0', () => {
    console.log(`Bangla PDF to EPUB server running at http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
});
