import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SHADOW_DIR = path.join(os.homedir(), '.shadow');
const LICENSE_FILE = path.join(SHADOW_DIR, 'license.json');

export interface LicenseStatus {
  key: string;
  active: boolean;
  tier: 'free' | 'pro';
  expiresAt?: string;
  customerName?: string;
}

export function loadLicense(): LicenseStatus {
  try {
    if (fs.existsSync(LICENSE_FILE)) {
      const data = fs.readFileSync(LICENSE_FILE, 'utf8');
      return JSON.parse(data) as LicenseStatus;
    }
  } catch (e) {
    // Ignore read errors
  }
  return { key: '', active: false, tier: 'free' };
}

export function saveLicense(status: LicenseStatus) {
  try {
    if (!fs.existsSync(SHADOW_DIR)) {
      fs.mkdirSync(SHADOW_DIR, { recursive: true });
    }
    fs.writeFileSync(LICENSE_FILE, JSON.stringify(status, null, 2), 'utf8');
  } catch (e) {
    // Ignore write errors
  }
}

/**
 * Validates a Lemon Squeezy license key.
 * In a real environment, this would ping the Lemon Squeezy License API:
 * POST https://api.lemonsqueezy.com/v1/licenses/validate
 */
export async function validateLicenseKey(key: string): Promise<LicenseStatus> {
  // Mock validation for demonstration / alpha phase.
  // We'll consider any key starting with "SHADOW-PRO-" as valid.
  if (key.startsWith('SHADOW-PRO-')) {
    const status: LicenseStatus = {
      key,
      active: true,
      tier: 'pro',
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      customerName: 'Shadow CLI User'
    };
    saveLicense(status);
    return status;
  }

  return { key, active: false, tier: 'free' };
}
