/**
 * Encrypted Store - SmartGuard IoT
 * Satisfies: [#NF2], [#NF5], [#NF16]
 */

const fs = require('fs');
const path = require('path');
const security = require('../engine/security');

const STORE_PATH = path.join(__dirname, 'encrypted_state.json');

class EncryptedStore {
  constructor() {
    this.memoryData = {
      systemConfig: {
        siteName: 'SmartGuard Oslo Main Facility',
        timezone: 'Europe/Oslo',
        securityLevel: 'MAXIMUM'
      },
      auditLog: []
    };
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(STORE_PATH)) {
        const fileContent = fs.readFileSync(STORE_PATH, 'utf8');
        const encryptedEnvelope = JSON.parse(fileContent);
        this.memoryData = security.decrypt(encryptedEnvelope);
      }
    } catch (e) {
      console.warn('Could not read encrypted store, starting fresh:', e.message);
    }
  }

  save() {
    try {
      const encrypted = security.encrypt(this.memoryData);
      fs.writeFileSync(STORE_PATH, JSON.stringify(encrypted, null, 2), 'utf8');
    } catch (e) {
      console.error('Failed to write encrypted store:', e.message);
    }
  }

  logAudit(action, actor, details) {
    const entry = {
      timestamp: Date.now(),
      action,
      actor,
      details
    };
    this.memoryData.auditLog.push(entry);
    if (this.memoryData.auditLog.length > 100) this.memoryData.auditLog.shift();
    this.save();
    return entry;
  }

  getAuditLog() {
    return this.memoryData.auditLog;
  }
}

module.exports = new EncryptedStore();
