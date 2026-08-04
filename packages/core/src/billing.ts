import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

/**
 * Where the licence is verified when SHADOW_API_URL is not set.
 *
 * This has to be a real deployed URL: a client machine has no local worker, so a
 * localhost default silently downgrades every paying customer to free.
 */
const PRODUCTION_API_URL = 'https://shadow-api.jeferson-zelayae.workers.dev';

const SHADOW_DIR = path.join(os.homedir(), '.shadow');
const LICENSE_FILE = path.join(SHADOW_DIR, 'license.json');
// Simple machine-bound key for obfuscation (prevents casual copy-pasting of license files between PCs)
const ENCRYPTION_KEY = crypto.scryptSync(os.hostname() + os.userInfo().username, 'shadow-salt', 32);

export interface LicenseStatus {
  key: string;
  active: boolean;
  tier: 'free' | 'pro';
  expiresAt?: string;
  customerName?: string;
}

function encrypt(text: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(text: string): string {
  const parts = text.split(':');
  const iv = Buffer.from(parts.shift()!, 'hex');
  const encryptedText = Buffer.from(parts.join(':'), 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
}

export function loadLicense(): LicenseStatus {
  try {
    if (fs.existsSync(LICENSE_FILE)) {
      const data = fs.readFileSync(LICENSE_FILE, 'utf8');
      const decrypted = decrypt(data);
      return JSON.parse(decrypted) as LicenseStatus;
    }
  } catch (e) {
    // Ignore read/decrypt errors (invalidates tampered files)
  }
  return { key: '', active: false, tier: 'free' };
}

export function saveLicense(status: LicenseStatus) {
  try {
    if (!fs.existsSync(SHADOW_DIR)) {
      fs.mkdirSync(SHADOW_DIR, { recursive: true });
    }
    const encrypted = encrypt(JSON.stringify(status));
    fs.writeFileSync(LICENSE_FILE, encrypted, 'utf8');
  } catch (e) {
    // Ignore write errors
  }
}

export function clearLicense(): LicenseStatus {
  try {
    if (fs.existsSync(LICENSE_FILE)) {
      fs.unlinkSync(LICENSE_FILE);
    }
  } catch (e) {
    // Ignore delete errors
  }
  return { key: '', active: false, tier: 'free' };
}

/**
 * Validates a Lemon Squeezy license key via Shadow API.
 */
export async function validateLicenseKey(key: string): Promise<LicenseStatus> {
  try {
    const API_URL = process.env.SHADOW_API_URL || PRODUCTION_API_URL;

    // Development-only shortcut, so working on the TUI does not need a live licence.
    // Gated behind SHADOW_DEV because this repo is public: without the gate, the bypass
    // is simply a free PRO key that anyone can read off GitHub. The server no longer
    // honours it at all — this branch never leaves the machine.
    if (key === 'TEST-PRO-KEY' && process.env.SHADOW_DEV === '1') {
      const status: LicenseStatus = {
        key,
        active: true,
        tier: 'pro',
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        customerName: 'Shadow PRO (Test)'
      };
      saveLicense(status);
      return status;
    }

    const res = await fetch(`${API_URL}/api/validate-license`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key })
    });

    if (!res.ok) {
      throw new Error('Invalid response from server');
    }

    const data = await res.json() as any;
    
    if (data.valid && data.tier === 'pro') {
      const status: LicenseStatus = {
        key,
        active: true,
        tier: 'pro',
        expiresAt: data.expires_at || undefined,
        customerName: 'Shadow PRO User'
      };
      saveLicense(status);
      return status;
    }
  } catch (err) {
    // Network or server error: fail closed. Treating an unreachable server as "valid"
    // would make the licence check trivially defeatable by going offline.
  }

  return { key, active: false, tier: 'free' };
}
