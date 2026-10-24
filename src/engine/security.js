/**
 * Security Engine - SmartGuard IoT
 * Satisfies: [#NF2], [#NF5], [#NF8], [#NF13], [#NF16]
 * Features:
 *  - AES-256-GCM symmetric encryption for data at rest (e.g. sensitive health data [#4])
 *  - HMAC-SHA256 message signing & verification with nonce & timestamp against replay attacks
 *  - Token-based authentication & Role-Based Access Control (RBAC)
 */

const crypto = require('crypto');

// Master encryption key (256-bit)
const SECRET_KEY = crypto.scryptSync(process.env.APP_SECRET || 'smartguard-super-secure-key-2026', 'salt', 32);
const HMAC_KEY = crypto.scryptSync(process.env.HMAC_SECRET || 'smartguard-hmac-integrity-key', 'hmac-salt', 32);

// Cache for seen nonces to prevent replay attacks [#NF13]
const seenNonces = new Set();
setInterval(() => seenNonces.clear(), 60000); // Clear every minute

class SecurityEngine {
  /**
   * Encrypt arbitrary string/object with AES-256-GCM [#NF2, #NF5, #NF16]
   */
  static encrypt(data) {
    const text = typeof data === 'string' ? data : JSON.stringify(data);
    const iv = crypto.randomBytes(12); // 96-bit IV for GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', SECRET_KEY, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    
    return {
      ciphertext: encrypted,
      iv: iv.toString('hex'),
      authTag: authTag,
      encryptedAt: Date.now()
    };
  }

  /**
   * Decrypt AES-256-GCM payload
   */
  static decrypt(encryptedPayload) {
    const { ciphertext, iv, authTag } = encryptedPayload;
    const decipher = crypto.createDecipheriv('aes-256-gcm', SECRET_KEY, Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));
    
    let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    try {
      return JSON.parse(decrypted);
    } catch {
      return decrypted;
    }
  }

  /**
   * Cryptographically sign message payload with HMAC-SHA256 + nonce [#NF8, #NF13]
   */
  static signPayload(payload) {
    const nonce = crypto.randomBytes(8).toString('hex');
    const timestamp = Date.now();
    const message = JSON.stringify(payload) + `:${nonce}:${timestamp}`;
    const hmac = crypto.createHmac('sha256', HMAC_KEY).update(message).digest('hex');

    return {
      payload,
      signature: hmac,
      nonce,
      timestamp
    };
  }

  /**
   * Verify signature and guard against replay attacks [#NF8, #NF13]
   */
  static verifySignedPayload(envelope) {
    const { payload, signature, nonce, timestamp } = envelope;

    // Check freshness: reject if older than 10 seconds
    const now = Date.now();
    if (Math.abs(now - timestamp) > 10000) {
      return { valid: false, reason: 'Timestamp expired (Replay defense)' };
    }

    // Check nonce replay
    if (seenNonces.has(nonce)) {
      return { valid: false, reason: 'Duplicate nonce detected (Replay attack blocked)' };
    }
    seenNonces.add(nonce);

    // Verify HMAC
    const expectedMessage = JSON.stringify(payload) + `:${nonce}:${timestamp}`;
    const expectedHmac = crypto.createHmac('sha256', HMAC_KEY).update(expectedMessage).digest('hex');

    const valid = crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expectedHmac, 'hex'));
    return { valid, reason: valid ? 'OK' : 'Signature mismatch' };
  }

  /**
   * RBAC permission check for critical actuators [#NF2]
   */
  static authorizeAction(userRole, action) {
    const permissions = {
      admin: ['*'],
      resident: ['device.read', 'device.control', 'emergency.view', 'energy.control'],
      responder: ['emergency.view', 'emergency.override', 'camera.view'],
      guest: ['device.read']
    };

    const allowed = permissions[userRole] || [];
    if (allowed.includes('*') || allowed.includes(action)) {
      return true;
    }
    return false;
  }
}

module.exports = SecurityEngine;
