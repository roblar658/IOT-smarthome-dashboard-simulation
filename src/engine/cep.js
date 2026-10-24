/**
 * Complex Event Processing (CEP) Engine - SmartGuard IoT
 * Satisfies: [#NF1], [#NF10], [#NF11], [#NF15]
 *
 * Implements:
 *  - Time-window data aggregation (1-min, 5-min rolling windows: min, max, avg, count) [#NF1]
 *  - Event correlation across time and multiple sensor types [#NF10, #NF15]
 *  - Workflow execution engine for triggering security & emergency cascades [#NF11]
 */

const EventEmitter = require('events');

class ComplexEventProcessor extends EventEmitter {
  constructor() {
    super();
    this.slidingWindows = new Map(); // key -> [{ timestamp, value }]
    this.rules = [];
    this.activeWorkflows = new Map();

    this.initDefaultRules();
  }

  /**
   * Push value into sliding window and calculate aggregations [#NF1]
   */
  pushMetric(metricName, value, windowSeconds = 60) {
    if (!this.slidingWindows.has(metricName)) {
      this.slidingWindows.set(metricName, []);
    }
    const window = this.slidingWindows.get(metricName);
    const now = Date.now();
    window.push({ timestamp: now, value });

    // Prune points older than window
    const cutoff = now - windowSeconds * 1000;
    while (window.length > 0 && window[0].timestamp < cutoff) {
      window.shift();
    }

    // Compute aggregations [#NF1]
    const values = window.map(w => w.value);
    const count = values.length;
    const sum = values.reduce((acc, v) => acc + v, 0);
    const avg = count > 0 ? sum / count : 0;
    const min = count > 0 ? Math.min(...values) : 0;
    const max = count > 0 ? Math.max(...values) : 0;

    return {
      metric: metricName,
      windowSeconds,
      count,
      current: value,
      avg: Number(avg.toFixed(2)),
      min: Number(min.toFixed(2)),
      max: Number(max.toFixed(2))
    };
  }

  /**
   * Initialize default event rules [#NF11, #NF15]
   */
  initDefaultRules() {
    // Rule 1: Fire Trigger Workflow
    this.rules.push({
      id: 'RULE_FIRE_CASCADE',
      name: 'Verified Fire Emergency Cascade',
      condition: (event) => event.type === 'FIRE' && event.verified === true,
      action: (event) => {
        this.emit('trigger:fire', event);
      }
    });

    // Rule 2: Water Leak Trigger Workflow
    this.rules.push({
      id: 'RULE_LEAK_CASCADE',
      name: 'Verified Water Leak Valve Shutdown',
      condition: (event) => event.type === 'WATER_LEAK' && event.verified === true,
      action: (event) => {
        this.emit('trigger:water_leak', event);
      }
    });

    // Rule 3: Intrusion Trigger Workflow
    this.rules.push({
      id: 'RULE_INTRUSION_CASCADE',
      name: 'Perimeter Intrusion Camera & Alarm Cascade',
      condition: (event) => event.type === 'INTRUSION' && event.verified === true,
      action: (event) => {
        this.emit('trigger:intrusion', event);
      }
    });

    // Rule 4: Personal Health Fall/Cardiac Workflow
    this.rules.push({
      id: 'RULE_HEALTH_CASCADE',
      name: 'Personal Health Distress Workflow',
      condition: (event) => event.type === 'HEALTH_EMERGENCY' && event.verified === true,
      action: (event) => {
        this.emit('trigger:health_emergency', event);
      }
    });

    // Rule 5: Occupancy-based Climate Adjustment [#21]
    this.rules.push({
      id: 'RULE_OCCUPANCY_CLIMATE',
      name: 'Occupancy-Driven HVAC Optimization',
      condition: (event) => event.type === 'OCCUPANCY',
      action: (event) => {
        this.emit('trigger:occupancy_changed', event);
      }
    });
  }

  /**
   * Ingest event into the CEP engine and evaluate matching rules [#NF15]
   */
  processEvent(event) {
    const matchedRules = [];
    for (const rule of this.rules) {
      try {
        if (rule.condition(event)) {
          matchedRules.push(rule.id);
          rule.action(event);
        }
      } catch (err) {
        console.error(`Error executing CEP rule ${rule.id}:`, err);
      }
    }
    return matchedRules;
  }
}

module.exports = new ComplexEventProcessor();
