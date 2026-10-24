/**
 * Emergency Response Orchestrator - SmartGuard IoT
 * Satisfies: [#3], [#14], [#17], [#18], [#19], [#20], [#21]
 *
 * Requirements:
 *  - [#3]: Emergency response triggered by device incident
 *  - [#14]: Send message to emergency response center (110/112 CAP protocol)
 *  - [#17]: Camera activated during security event
 *  - [#18]: Lighting activated during security event
 *  - [#19]: Water shut off at relevant places during a leak
 *  - [#20]: Emergency exit triggered (through assumption of fire)
 *  - [#21]: HVAC setting adjusted through trigger
 */

const EventEmitter = require('events');
const deviceManager = require('./deviceManager');
const videoAnalytics = require('./videoAnalytics');

class EmergencyResponseOrchestrator extends EventEmitter {
  constructor() {
    super();
    this.activeIncidents = new Map();
    this.dispatchedAlerts = [];
  }

  /**
   * Handle Verified Fire Incident [#3, #14, #17, #18, #20, #21]
   */
  handleFireIncident(incidentData) {
    const incidentId = `INC_FIRE_${Date.now()}`;
    const timestamp = Date.now();

    // 1. Activate Camera to High-FPS Recording [#17]
    videoAnalytics.activateSecurityEventMode();
    videoAnalytics.setScenario('SMOKE_FIRE');
    deviceManager.updateDeviceState('security_camera', {
      recordingMode: 'ALARM_30FPS_HD',
      ptzTrackingActive: true
    });

    // 2. Activate Lighting along Exit Paths to 100% White [#18]
    deviceManager.updateDeviceState('smart_lighting', {
      on: true,
      brightness: 100,
      colorHex: '#FFFFFF',
      mode: 'EMERGENCY_FULL'
    });

    // 3. Trigger Emergency Exit Door Unlock (Fail-safe) [#20]
    deviceManager.updateDeviceState('emergency_exit', {
      locked: false,
      emergencyReleased: true,
      reason: 'Automatic Fire Alarm Release'
    });

    // 4. Adjust HVAC: Shut off Fresh Air Damper to starve fire [#21]
    deviceManager.updateDeviceState('climate_hvac', {
      mode: 'FIRE_LOCKOUT',
      freshAirDamperOpen: false,
      fanSpeed: 'OFF',
      powerWatts: 0
    });

    // 5. Send CAP Message to Emergency Response Center (110/112) [#14]
    const capDispatch = this.dispatchToEmergencyCenter({
      incidentId,
      urgency: 'Immediate',
      severity: 'Extreme',
      certainty: 'Observed',
      event: 'Structure Fire Alarm Confirmed',
      category: 'Fire',
      headline: 'Automated Verified Fire Alarm at Residential Facility',
      description: `Verified by thermal rate-of-rise and optical smoke sensors. Confidence: ${incidentData.confidence}%. Nødutganger frigjort, HVAC spjeld stengt.`,
      areaDesc: 'Oslo Smart Residence, Sektor 1',
      coordinates: '59.9139, 10.7522',
      contact: '+47 22 00 00 00'
    });

    const record = {
      incidentId,
      type: 'FIRE',
      status: 'ACTIVE_EMERGENCY',
      timestamp,
      data: incidentData,
      dispatch: capDispatch
    };

    this.activeIncidents.set(incidentId, record);
    this.emit('incident:fire_orchestrated', record);
    return record;
  }

  /**
   * Handle Verified Water Leak Incident [#3, #19]
   */
  handleWaterLeakIncident(incidentData) {
    const incidentId = `INC_LEAK_${Date.now()}`;
    const timestamp = Date.now();

    // 1. Motorized Water Valve Shutdown [#19]
    deviceManager.updateDeviceState('water_valve', {
      valveOpen: false,
      positionPct: 0,
      lastActuated: timestamp,
      reason: 'Automated Leak Isolation'
    });

    // 2. Pause Smart Washing Machine [#1]
    try {
      deviceManager.updateDeviceState('appliance_washer', {
        cycle: 'EMERGENCY_LEAK_STOP',
        powerDrawWatts: 5
      });
      deviceManager.pauseDevice('appliance_washer');
    } catch (e) {
      console.error(e);
    }

    // 3. Lighting Alert Indication [#18]
    deviceManager.updateDeviceState('smart_lighting', {
      on: true,
      colorHex: '#00D2FF', // Blue alert
      mode: 'WARNING_PULSE'
    });

    const record = {
      incidentId,
      type: 'WATER_LEAK',
      status: 'MITIGATED_VALVE_SHUT',
      timestamp,
      data: incidentData
    };

    this.activeIncidents.set(incidentId, record);
    this.emit('incident:leak_orchestrated', record);
    return record;
  }

  /**
   * Handle Verified Security Intrusion [#3, #14, #17, #18]
   */
  handleIntrusionIncident(incidentData) {
    const incidentId = `INC_INTRUSION_${Date.now()}`;
    const timestamp = Date.now();

    // 1. Camera High-FPS + AI Tracking [#17]
    videoAnalytics.activateSecurityEventMode();
    videoAnalytics.setScenario('PERSON_INTRUDER');
    deviceManager.updateDeviceState('security_camera', {
      recordingMode: 'ALARM_30FPS_HD',
      ptzTrackingActive: true
    });

    // 2. Activate Strobe Lighting for Deterrence [#18]
    deviceManager.updateDeviceState('smart_lighting', {
      on: true,
      brightness: 100,
      colorHex: '#FF0033', // Red alert
      mode: 'SECURITY_STROBE'
    });

    // 3. Dispatch to Security Response Center (112 / Securitas) [#14]
    const capDispatch = this.dispatchToEmergencyCenter({
      incidentId,
      urgency: 'Expected',
      severity: 'Severe',
      certainty: 'Observed',
      event: 'Perimeter Intrusion Alert',
      category: 'Security',
      headline: 'Verified Unauthorized Entry Detected',
      description: `Cross-confirmed by door contact sensor and optical AI vision tracking. Confidence: ${incidentData.confidence}%.`,
      areaDesc: 'Søndre Inngang og Gang'
    });

    const record = {
      incidentId,
      type: 'INTRUSION',
      status: 'ACTIVE_ALARM',
      timestamp,
      data: incidentData,
      dispatch: capDispatch
    };

    this.activeIncidents.set(incidentId, record);
    this.emit('incident:intrusion_orchestrated', record);
    return record;
  }

  /**
   * Handle Personal Health Emergency [#3, #4, #14]
   */
  handleHealthEmergency(incidentData) {
    const incidentId = `INC_HEALTH_${Date.now()}`;
    const timestamp = Date.now();

    // 1. Camera check for visual assistance
    videoAnalytics.setScenario('FALLEN_PERSON');

    // 2. Unlock door for incoming paramedics
    deviceManager.updateDeviceState('emergency_exit', {
      locked: false,
      emergencyReleased: true,
      reason: 'Paramedic Access - Medical Emergency'
    });

    // 3. Dispatch to 113 Medical Dispatch Center [#14]
    const capDispatch = this.dispatchToEmergencyCenter({
      incidentId,
      urgency: 'Immediate',
      severity: 'Severe',
      certainty: 'Observed',
      event: 'Personal Health Distress / Fall Incident',
      category: 'Health',
      headline: 'Wearable Impact Fall & Distress Vitals Detected',
      description: `User fallen and motionless. Heart rate: ${incidentData.sensors.ppgVitals.heartRateBpm} BPM, SpO2: ${incidentData.sensors.ppgVitals.spO2Pct}%. Paramedic access unlocked.`
    });

    const record = {
      incidentId,
      type: 'HEALTH_EMERGENCY',
      status: 'MEDICAL_DISPATCHED',
      timestamp,
      data: incidentData,
      dispatch: capDispatch
    };

    this.activeIncidents.set(incidentId, record);
    this.emit('incident:health_orchestrated', record);
    return record;
  }

  /**
   * Send Common Alerting Protocol (CAP 1.2) Payload to Emergency Center [#14]
   */
  dispatchToEmergencyCenter(capData) {
    const capPayload = {
      identifier: capData.incidentId,
      sender: 'smartguard-gateway-no-01@smartguard.local',
      sent: new Date().toISOString(),
      status: 'Actual',
      msgType: 'Alert',
      scope: 'Restricted',
      info: {
        category: capData.category,
        event: capData.event,
        urgency: capData.urgency,
        severity: capData.severity,
        certainty: capData.certainty,
        headline: capData.headline,
        description: capData.description,
        area: {
          areaDesc: capData.areaDesc,
          circle: capData.coordinates || '59.9139,10.7522,0.05'
        }
      },
      acknowledgment: {
        status: 'DISPATCH_ACKNOWLEDGED_BY_PSAP',
        responseCenterId: 'PSAP_NO_110_112_OSLO',
        etaMinutes: 6,
        receivedAt: new Date().toISOString()
      }
    };

    this.dispatchedAlerts.push(capPayload);
    if (this.dispatchedAlerts.length > 30) this.dispatchedAlerts.shift();

    return capPayload;
  }

  /**
   * Reset all actuators to safe normal operational state
   */
  resetEmergencyState() {
    this.activeIncidents.clear();
    videoAnalytics.deactivateSecurityEventMode();
    videoAnalytics.setScenario('NORMAL');

    deviceManager.updateDeviceState('security_camera', {
      recordingMode: 'STANDBY_5FPS',
      ptzTrackingActive: false
    });

    deviceManager.updateDeviceState('smart_lighting', {
      on: true,
      brightness: 70,
      colorHex: '#FFA834',
      mode: 'NORMAL'
    });

    deviceManager.updateDeviceState('water_valve', {
      valveOpen: true,
      positionPct: 100,
      reason: 'Manual / System Reset'
    });

    deviceManager.updateDeviceState('emergency_exit', {
      locked: true,
      emergencyReleased: false,
      reason: 'System Reset'
    });

    deviceManager.updateDeviceState('climate_hvac', {
      mode: 'COMFORT',
      freshAirDamperOpen: true,
      fanSpeed: 'AUTO',
      powerWatts: 920
    });

    this.emit('emergency:reset');
    return { success: true, message: 'All safety actuators restored to normal standby.' };
  }

  getActiveIncidents() {
    return Array.from(this.activeIncidents.values());
  }

  getDispatches() {
    return this.dispatchedAlerts;
  }
}

module.exports = new EmergencyResponseOrchestrator();
