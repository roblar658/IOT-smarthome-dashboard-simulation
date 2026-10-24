/**
 * Continuous Sensor Pooling Engine - SmartGuard IoT
 * Satisfies: [#10], [#NF3], [#NF7]
 *
 * Requirements:
 *  - [#10]: Possibility to collect information from different devices (sensors)
 *  - [#NF3]: Sensor data must be collected through pooling in a continuous way
 *  - [#NF7]: Data communication must be fast enough (< 50ms internal loop)
 */

const EventEmitter = require('events');
const biasFilter = require('./biasFilter');
const verification = require('./verification');
const cep = require('./cep');
const maintenance = require('./maintenance');
const energyManager = require('../services/energyManager');
const videoAnalytics = require('../services/videoAnalytics');
const emergency = require('../services/emergency');
const notifier = require('../services/notifier');

class ContinuousPoolingEngine extends EventEmitter {
  constructor() {
    super();
    this.timer = null;
    this.intervalMs = 1500; // 1.5 second deterministic continuous pooling loop [#NF3]
    this.isPolling = false;

    // Simulated physical environment state
    this.envState = {
      ambientTemp: 21.5,
      smokePpm: 12,
      coPpm: 4,
      floorMoisturePct: 5,
      waterFlowLpm: 0.0,
      pirMotion: false,
      co2Ppm: 480,
      soundDb: 34,
      doorContactOpen: false,
      systemArmed: true,
      wearable: {
        impactG: 0.98,
        heartRateBpm: 72,
        spO2Pct: 98,
        motionlessSeconds: 0
      },
      appliance: {
        currentRms: 2.1,
        vibrationG: 0.12,
        harmonicDeviation: 2.0
      }
    };

    // Attach CEP triggers to Emergency Orchestrator & Notifier
    this.wireEventWorkflows();
  }

  wireEventWorkflows() {
    cep.on('trigger:fire', (event) => {
      const record = emergency.handleFireIncident(event);
      notifier.notify({
        title: 'KRITISK NØDVARSEL: BRANN BEKREFTET',
        message: `Målt temperaturøkning og optisk røykverifisering (${event.confidence}% konfidens). Nødutganger åpnet, nødlys på, 110-nødsentral varslet!`,
        priority: 'CRITICAL_MANDATORY',
        category: 'FIRE'
      });
    });

    cep.on('trigger:water_leak', (event) => {
      const record = emergency.handleWaterLeakIncident(event);
      notifier.notify({
        title: 'KRITISK VARSEL: VANNLEKKASJE DETEKTERT',
        message: `Høy fuktighet og uventet vannstrøm registrert (${event.confidence}% konfidens). Hovedvannventil er stengt automatisk!`,
        priority: 'CRITICAL_MANDATORY',
        category: 'LEAK'
      });
    });

    cep.on('trigger:intrusion', (event) => {
      const record = emergency.handleIntrusionIncident(event);
      notifier.notify({
        title: 'SIKKERHETSALARM: UAUTORISERT INNTRENGING',
        message: `Dørkontakt brutt og bevegelse bekreftet av AI-kamera (${event.confidence}%). Strobelys aktivert, vekter sendt.`,
        priority: 'CRITICAL_MANDATORY',
        category: 'SECURITY'
      });
    });

    cep.on('trigger:health_emergency', (event) => {
      const record = emergency.handleHealthEmergency(event);
      notifier.notify({
        title: 'MEDISINSK NØDVARSEL: FALL OG PULSAVVIK',
        message: `Helsearmbånd registrerte hardt fall etterfulgt av immobilitet. Nødetater (113) er varslet og inngangslås er frigjort!`,
        priority: 'CRITICAL_MANDATORY',
        category: 'HEALTH'
      });
    });

    cep.on('trigger:occupancy_changed', (event) => {
      const hvacMode = event.suggestedHvacMode;
      const hvac = require('../services/deviceManager').getDevice('climate_hvac');
      if (hvac && hvac.status === 'RUNNING' && hvac.state.mode !== 'FIRE_LOCKOUT') {
        require('../services/deviceManager').updateDeviceState('climate_hvac', {
          mode: hvacMode,
          powerWatts: hvacMode === 'COMFORT' ? 920 : 380
        });
      }
    });
  }

  start() {
    if (this.isPolling) return;
    this.isPolling = true;
    this.timer = setInterval(() => this.pollTick(), this.intervalMs);
  }

  stop() {
    if (!this.isPolling) return;
    clearInterval(this.timer);
    this.isPolling = false;
  }

  /**
   * Main Pooling Execution Loop [#10, #NF3, #NF4, #NF7]
   */
  pollTick() {
    const startTime = Date.now();

    // 1. Add slight physical fluctuations to simulate real analog sensors
    const rawTemp = this.envState.ambientTemp + (Math.random() - 0.5) * 0.4;
    const rawCo2 = this.envState.co2Ppm + (Math.random() - 0.5) * 15;
    const rawSmoke = this.envState.smokePpm + (Math.random() - 0.5) * 2;
    const rawCo = this.envState.coPpm + (Math.random() - 0.5) * 0.5;
    const rawMoisture = this.envState.floorMoisturePct;
    const rawWaterFlow = this.envState.waterFlowLpm;

    // 2. Bias-correction and Kalman filtering [#NF4]
    const filteredTemp = biasFilter.process('sensor_temp', rawTemp, { ambientTemp: rawTemp });
    const filteredCo2 = biasFilter.process('sensor_co2', rawCo2, { ambientTemp: rawTemp });
    const filteredSmoke = biasFilter.process('sensor_smoke', rawSmoke);
    const filteredMoisture = biasFilter.process('sensor_moisture', rawMoisture);

    // 3. Sensor aggregation & time-window tracking [#NF1]
    const tempAgg = cep.pushMetric('temperature', filteredTemp.corrected, 60);
    const powerReading = energyManager.sampleEnergy();
    const powerAgg = cep.pushMetric('power_kw', powerReading.currentKw, 60);

    // 4. Incident verification across dual sensors [#5, #9, #NF6]
    const fireVerification = verification.verifyFire({
      temp: filteredTemp.corrected,
      smokePpm: filteredSmoke.corrected,
      coPpm: rawCo
    });

    const leakVerification = verification.verifyWaterLeak({
      floorMoisturePct: filteredMoisture.corrected,
      waterFlowLpm: rawWaterFlow,
      expectedFlow: false
    });

    const occupancyVerification = verification.verifyOccupancy({
      pirMotion: this.envState.pirMotion,
      co2Ppm: filteredCo2.corrected,
      soundDb: this.envState.soundDb
    });

    const healthVerification = verification.verifyHealthEmergency({
      impactG: this.envState.wearable.impactG,
      heartRateBpm: this.envState.wearable.heartRateBpm,
      spO2Pct: this.envState.wearable.spO2Pct,
      motionlessSeconds: this.envState.wearable.motionlessSeconds
    });

    // 5. Video analytics inference [#12, #13]
    const cameraAnalytics = videoAnalytics.processFrame();

    const intrusionVerification = verification.verifyIntrusion({
      doorContactOpen: this.envState.doorContactOpen,
      pirMotion: this.envState.pirMotion,
      cameraPersonDetected: cameraAnalytics.detections.some(d => d.label === 'PERSON'),
      systemArmed: this.envState.systemArmed
    });

    // 6. Feed into Complex Event Processing (CEP) engine [#NF15]
    cep.processEvent(fireVerification);
    cep.processEvent(leakVerification);
    cep.processEvent(intrusionVerification);
    cep.processEvent(healthVerification);
    cep.processEvent(occupancyVerification);

    // 7. Predictive maintenance analysis [#15]
    const maintenanceAnalysis = maintenance.analyze(
      'appliance_washer',
      this.envState.appliance.currentRms,
      this.envState.appliance.vibrationG,
      this.envState.appliance.harmonicDeviation
    );

    const loopLatencyMs = Date.now() - startTime;

    // Snapshot payload for subscribers/UI [#NF7]
    const snapshot = {
      timestamp: Date.now(),
      loopLatencyMs,
      telemetry: {
        thermal: { raw: filteredTemp.raw, filtered: filteredTemp.corrected, biasRemoved: filteredTemp.biasRemoved },
        co2: { raw: filteredCo2.raw, filtered: filteredCo2.corrected, biasRemoved: filteredCo2.biasRemoved },
        smoke: { raw: filteredSmoke.raw, filtered: filteredSmoke.corrected },
        moisture: { raw: filteredMoisture.raw, filtered: filteredMoisture.corrected },
        waterFlowLpm: rawWaterFlow,
        pirMotion: this.envState.pirMotion,
        soundDb: this.envState.soundDb,
        doorContactOpen: this.envState.doorContactOpen,
        wearable: this.envState.wearable
      },
      aggregations: {
        tempAgg,
        powerAgg
      },
      verifications: {
        fire: fireVerification,
        waterLeak: leakVerification,
        occupancy: occupancyVerification,
        intrusion: intrusionVerification,
        health: healthVerification
      },
      camera: cameraAnalytics,
      maintenance: maintenanceAnalysis,
      energy: powerReading
    };

    this.emit('snapshot', snapshot);
    return snapshot;
  }

  // Simulator helper methods to trigger test scenarios
  simulateFire(active = true) {
    if (active) {
      this.envState.ambientTemp = 74.5;
      this.envState.smokePpm = 180;
      this.envState.coPpm = 45;
    } else {
      this.envState.ambientTemp = 21.5;
      this.envState.smokePpm = 12;
      this.envState.coPpm = 4;
    }
  }

  simulateWaterLeak(active = true) {
    if (active) {
      this.envState.floorMoisturePct = 88;
      this.envState.waterFlowLpm = 4.8; // Uncommanded flow
    } else {
      this.envState.floorMoisturePct = 5;
      this.envState.waterFlowLpm = 0.0;
    }
  }

  simulateIntrusion(active = true) {
    if (active) {
      this.envState.doorContactOpen = true;
      this.envState.pirMotion = true;
      videoAnalytics.setScenario('PERSON_INTRUDER');
    } else {
      this.envState.doorContactOpen = false;
      this.envState.pirMotion = false;
      videoAnalytics.setScenario('NORMAL');
    }
  }

  simulateHealthEmergency(active = true) {
    if (active) {
      this.envState.wearable.impactG = 3.8;
      this.envState.wearable.motionlessSeconds = 12;
      this.envState.wearable.heartRateBpm = 148;
      this.envState.wearable.spO2Pct = 86;
      videoAnalytics.setScenario('FALLEN_PERSON');
    } else {
      this.envState.wearable.impactG = 0.98;
      this.envState.wearable.motionlessSeconds = 0;
      this.envState.wearable.heartRateBpm = 72;
      this.envState.wearable.spO2Pct = 98;
      videoAnalytics.setScenario('NORMAL');
    }
  }

  simulateApplianceFault(active = true) {
    if (active) {
      this.envState.appliance.currentRms = 6.4;
      this.envState.appliance.vibrationG = 0.88;
      this.envState.appliance.harmonicDeviation = 45.0;
    } else {
      this.envState.appliance.currentRms = 2.1;
      this.envState.appliance.vibrationG = 0.12;
      this.envState.appliance.harmonicDeviation = 2.0;
    }
  }
}

module.exports = new ContinuousPoolingEngine();
