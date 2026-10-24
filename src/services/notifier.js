/**
 * Priority Notification Service - SmartGuard IoT
 * Satisfies: [#11], [#23]
 *
 * Requirements:
 *  - [#11]: Real-time alert delivered to relevant people
 *  - [#23]: Notification of different events, with mandatory notifications (bypass DND)
 */

const EventEmitter = require('events');

class NotificationService extends EventEmitter {
  constructor() {
    super();
    this.notifications = [];
  }

  /**
   * Send notification [#11, #23]
   * @param {object} options
   *   - title: string
   *   - message: string
   *   - priority: 'INFO' | 'WARNING' | 'CRITICAL_MANDATORY'
   *   - mandatory: boolean
   *   - category: 'FIRE' | 'LEAK' | 'SECURITY' | 'HEALTH' | 'ENERGY' | 'SYSTEM'
   */
  notify(options) {
    const isMandatory = options.mandatory || options.priority === 'CRITICAL_MANDATORY';
    const notification = {
      id: `NOTIF_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: Date.now(),
      title: options.title,
      message: options.message,
      priority: options.priority || 'INFO',
      mandatory: isMandatory, // [#23] Cannot be silenced, overrides DND
      category: options.category || 'SYSTEM',
      deliveredChannels: ['WEBSOCKET_IN_APP', 'PUSH_NOTIFICATION', 'SMS_GATEWAY'],
      requiresAck: isMandatory,
      acknowledged: false,
      sirenAudioTrigger: isMandatory
    };

    this.notifications.unshift(notification);
    if (this.notifications.length > 50) this.notifications.pop();

    this.emit('notification:new', notification);
    return notification;
  }

  acknowledge(id) {
    const notif = this.notifications.find(n => n.id === id);
    if (notif) {
      notif.acknowledged = true;
      notif.acknowledgedAt = Date.now();
      this.emit('notification:acknowledged', notif);
      return notif;
    }
    return null;
  }

  getRecentNotifications(limit = 20) {
    return this.notifications.slice(0, limit);
  }
}

module.exports = new NotificationService();
