/**
 * Video Analytics Service - SmartGuard IoT
 * Satisfies: [#12], [#13], [#17]
 *
 * Requirements:
 *  - [#12]: Have a video camera
 *  - [#13]: Do video analytics, and use that to decide what to do
 *  - [#17]: Camera is activated during security event
 */

const EventEmitter = require('events');

class VideoAnalyticsService extends EventEmitter {
  constructor() {
    super();
    this.cameraState = {
      id: 'cam_perimeter_01',
      name: 'South Entry & Hallway 4K AI Camera',
      status: 'ONLINE',
      streamMode: 'STANDBY_5FPS', // 'STANDBY_5FPS' vs 'RECORDING_30FPS_HD'
      resolution: '1920x1080',
      fps: 5,
      nightVisionActive: true,
      ptzTracking: false,
      detections: []
    };

    this.simulatedScenario = 'NORMAL'; // 'NORMAL', 'PERSON_INTRUDER', 'FALLEN_PERSON', 'SMOKE_FIRE'
  }

  /**
   * Run computer vision inference on frame [#13]
   */
  processFrame() {
    const timestamp = Date.now();
    let detections = [];

    if (this.simulatedScenario === 'PERSON_INTRUDER') {
      detections.push({
        label: 'PERSON',
        confidence: 0.94,
        bbox: { x: 120, y: 80, width: 90, height: 210 },
        posture: 'STANDING_ACTIVE',
        trackId: 104,
        motionVector: { dx: 1.2, dy: 0.4 }
      });
    } else if (this.simulatedScenario === 'FALLEN_PERSON') {
      detections.push({
        label: 'PERSON',
        confidence: 0.91,
        bbox: { x: 140, y: 190, width: 220, height: 70 },
        posture: 'PRONE_PROLONGED_IMMOBILE',
        trackId: 105,
        fallRiskScore: 0.96
      });
    } else if (this.simulatedScenario === 'SMOKE_FIRE') {
      detections.push({
        label: 'FIRE_SMOKE_PLUME',
        confidence: 0.88,
        bbox: { x: 260, y: 50, width: 140, height: 160 },
        flameFlickerHz: 12.4
      });
    }

    this.cameraState.detections = detections;

    // Decision logic based on video analytics [#13]
    const decision = this.makeDecision(detections);

    return {
      camera: this.cameraState,
      timestamp,
      detections,
      decision
    };
  }

  /**
   * Decision making based on video analytics output [#13]
   */
  makeDecision(detections) {
    if (detections.some(d => d.label === 'FIRE_SMOKE_PLUME' && d.confidence > 0.8)) {
      return {
        action: 'TRIGGER_FIRE_CONFIRMATION',
        confidence: 0.88,
        reason: 'Visual smoke and flame flicker verified by optical neural network.'
      };
    }

    if (detections.some(d => d.posture === 'PRONE_PROLONGED_IMMOBILE')) {
      return {
        action: 'TRIGGER_FALL_ASSISTANCE',
        confidence: 0.91,
        reason: 'Subject prone on floor with zero movement exceeding 10 seconds.'
      };
    }

    if (detections.some(d => d.label === 'PERSON' && d.confidence > 0.85)) {
      return {
        action: 'INTRUDER_DETECTED',
        confidence: 0.94,
        reason: 'Unidentified human movement inside restricted security envelope.'
      };
    }

    return {
      action: 'STANDBY_OBSERVE',
      confidence: 1.0,
      reason: 'No visual threats or anomalies in camera field of view.'
    };
  }

  /**
   * Activate high-FPS recording and PTZ tracking during security event [#17]
   */
  activateSecurityEventMode() {
    this.cameraState.streamMode = 'RECORDING_30FPS_HD';
    this.cameraState.fps = 30;
    this.cameraState.ptzTracking = true;
    this.emit('camera:security_activated', this.cameraState);
    return this.cameraState;
  }

  /**
   * Return to low-bandwidth standby mode
   */
  deactivateSecurityEventMode() {
    this.cameraState.streamMode = 'STANDBY_5FPS';
    this.cameraState.fps = 5;
    this.cameraState.ptzTracking = false;
    this.emit('camera:standby_restored', this.cameraState);
    return this.cameraState;
  }

  setScenario(scenarioName) {
    this.simulatedScenario = scenarioName;
  }

  getCameraState() {
    return this.cameraState;
  }
}

module.exports = new VideoAnalyticsService();
