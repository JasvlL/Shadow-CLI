import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

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

/**
 * Validates a Lemon Squeezy license key via Shadow API.
 */
export async function validateLicenseKey(key: string): Promise<LicenseStatus> {
  try {
    // En producción esto apuntará a tu dominio real (ej. api.shadow.dev)
    const API_URL = process.env.SHADOW_API_URL || 'http://127.0.0.1:8787';
    
    // Si estamos offline o probando, podemos mantener el fallback
    if (key === 'TEST-PRO-KEY') {
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
    // Error de red o servidor, devolvemos fallo por seguridad
  }

  return { key, active: false, tier: 'free' };
}
