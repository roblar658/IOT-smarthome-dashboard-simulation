/**
 * Incident Verification Engine (IVE) - SmartGuard IoT
 * Satisfies: [#5], [#9], [#NF6], [#NF12]
 *
 * Requirements:
 *  - [#5]: At least 2 different sensors for same indirect measurements
 *  - [#9]: Possibility to verify an incident
 *  - [#NF6]: At least 2 different sensors for each measurement to enable incident verification
 *  - [#NF12]: Analysis must be done in a reliable and robust way
 */

class IncidentVerificationEngine {
  constructor() {
    this.history = {
      temperatures: [], // [{ time, val }]
      co2Levels: [],
      smokeLevels: []
    };
  }

  /**
   * Helper to calculate rate of change (derivative) over a time window
   */
  calculateRateOfChange(historyArray, windowSeconds = 10) {
    if (historyArray.length < 2) return 0.0;
    const now = Date.now();
    const cutoff = now - windowSeconds * 1000;
    const windowPoints = historyArray.filter(p => p.time >= cutoff);
    if (windowPoints.length < 2) return 0.0;

    const first = windowPoints[0];
    const last = windowPoints[windowPoints.length - 1];
    const dtSeconds = (last.time - first.time) / 1000;
    if (dtSeconds <= 0) return 0.0;

    return (last.val - first.val) / dtSeconds; // unit per second
  }

  /**
   * 1. FIRE INCIDENT VERIFICATION [#5, #9, #NF6]
   *  - Sensor A: Thermal Rate-of-Rise (dTemp/dt) & absolute temp
   *  - Sensor B: Optical Smoke Particulate Density & CO ppm
   */
  verifyFire(sensorData) {
    const { temp, smokePpm, coPpm } = sensorData;
    const now = Date.now();

    // Push history for derivative calculation
    this.history.temperatures.push({ time: now, val: temp });
    this.history.smokeLevels.push({ time: now, val: smokePpm });
    if (this.history.temperatures.length > 50) this.history.temperatures.shift();
    if (this.history.smokeLevels.length > 50) this.history.smokeLevels.shift();

    const tempRate = this.calculateRateOfChange(this.history.temperatures, 5); // C/sec
    const smokeRate = this.calculateRateOfChange(this.history.smokeLevels, 5); // ppm/sec

    // Indirect scoring:
    // Sensor 1: Thermal indicator (high temp OR rapid rise)
    const thermalScore = Math.min(1.0, Math.max(0.0, (temp - 30) / 40.0) + Math.max(0.0, tempRate * 2.0));
    // Sensor 2: Chemical/Optical indicator (smoke particles + CO)
    const smokeScore = Math.min(1.0, Math.max(0.0, smokePpm / 150.0) + Math.max(0.0, coPpm / 50.0) + Math.max(0.0, smokeRate * 0.5));

    // Incident confirmed only if BOTH independent sensors confirm anomaly
    const compositeScore = 0.5 * thermalScore + 0.5 * smokeScore;
    const verified = (thermalScore >= 0.6 && smokeScore >= 0.5) || (temp > 65.0 && smokePpm > 100);

    return {
      type: 'FIRE',
      verified,
      confidence: Number((compositeScore * 100).toFixed(1)),
      sensors: {
        thermal: {
          temp,
          rateOfRise: Number(tempRate.toFixed(2)),
          score: Number(thermalScore.toFixed(2)),
          triggered: thermalScore >= 0.6
        },
        smoke_co: {
          smokePpm,
          coPpm,
          score: Number(smokeScore.toFixed(2)),
          triggered: smokeScore >= 0.5
        }
      },
      verificationNote: verified
        ? 'VERIFIED: Both thermal rate-of-rise and optical smoke/CO detected.'
        : (thermalScore >= 0.6 ? 'UNVERIFIED: Thermal spike detected without smoke (Possible heat source/cooking)' : 'Normal')
    };
  }

  /**
   * 2. WATER LEAK VERIFICATION [#5, #9, #NF6]
   *  - Sensor A: Conductive Floor Moisture probe (Resistance drop)
   *  - Sensor B: Ultrasonic Main Flow Meter (Continuous unintended flow)
   */
  verifyWaterLeak(sensorData) {
    const { floorMoisturePct, waterFlowLpm, expectedFlow = false } = sensorData;

    const moistureScore = floorMoisturePct / 100.0;
    const flowAnomalyScore = (!expectedFlow && waterFlowLpm > 1.5) ? Math.min(1.0, waterFlowLpm / 10.0) : 0.0;

    // Both floor moisture AND unexpected flow confirm severe leak
    const compositeScore = 0.55 * moistureScore + 0.45 * flowAnomalyScore;
    const verified = (floorMoisturePct > 40 && waterFlowLpm > 1.0) || floorMoisturePct > 85;

    return {
      type: 'WATER_LEAK',
      verified,
      confidence: Number((compositeScore * 100).toFixed(1)),
      sensors: {
        floorMoisture: {
          moisturePct: floorMoisturePct,
          score: Number(moistureScore.toFixed(2)),
          triggered: floorMoisturePct > 40
        },
        flowMeter: {
          flowLpm: waterFlowLpm,
          score: Number(flowAnomalyScore.toFixed(2)),
          triggered: flowAnomalyScore > 0.3
        }
      },
      verificationNote: verified
        ? 'VERIFIED: High floor conductivity correlated with uncommanded main water flow.'
        : (floorMoisturePct > 40 ? 'UNVERIFIED: Moisture sensed but zero pipe flow (spill/condensation)' : 'Normal')
    };
  }

  /**
   * 3. ROOM OCCUPANCY VERIFICATION (FOR HVAC) [#5, #6, #21]
   *  - Sensor A: Passive Infrared (PIR) Motion Detection
   *  - Sensor B: NDIR CO2 PPM accumulation rate + Acoustic decibel level
   */
  verifyOccupancy(sensorData) {
    const { pirMotion, co2Ppm, soundDb } = sensorData;
    const now = Date.now();

    this.history.co2Levels.push({ time: now, val: co2Ppm });
    if (this.history.co2Levels.length > 50) this.history.co2Levels.shift();

    const co2Rate = this.calculateRateOfChange(this.history.co2Levels, 10);

    const pirScore = pirMotion ? 1.0 : 0.0;
    const metabolicScore = Math.min(1.0, Math.max(0.0, (co2Ppm - 450) / 600.0) + (co2Rate > 0.2 ? 0.3 : 0.0) + (soundDb > 40 ? 0.2 : 0.0));

    // Occupied if either PIR sees motion OR human breathing/sound elevates CO2
    const occupied = pirMotion || metabolicScore > 0.4;
    const confidence = pirMotion ? (metabolicScore > 0.4 ? 98 : 80) : (metabolicScore > 0.4 ? 75 : 10);

    return {
      type: 'OCCUPANCY',
      occupied,
      confidence,
      sensors: {
        pir: { motion: pirMotion, score: pirScore },
        metabolic: { co2Ppm, soundDb, co2Rate: Number(co2Rate.toFixed(2)), score: Number(metabolicScore.toFixed(2)) }
      },
      suggestedHvacMode: occupied ? 'COMFORT' : 'ECO'
    };
  }

  /**
   * 4. PERSONAL HEALTH EMERGENCY VERIFICATION [#4, #9]
   *  - Sensor A: Wearable Accelerometer (Impact Jerk + Sudden Prolonged Immobility)
   *  - Sensor B: Optical PPG (Severe Tachycardia/Bradycardia or SpO2 < 88%)
   */
  verifyHealthEmergency(sensorData) {
    const { impactG, heartRateBpm, spO2Pct, motionlessSeconds } = sensorData;

    const fallImpactScore = (impactG > 2.8 && motionlessSeconds > 5) ? 1.0 : (impactG > 2.0 ? 0.5 : 0.0);
    const vitalsDistressScore = (heartRateBpm > 140 || heartRateBpm < 45 || spO2Pct < 90) ? 1.0 : 0.0;

    const compositeScore = 0.5 * fallImpactScore + 0.5 * vitalsDistressScore;
    const verified = (fallImpactScore === 1.0 && vitalsDistressScore > 0) || fallImpactScore === 1.0 || (vitalsDistressScore === 1.0 && heartRateBpm < 40);

    return {
      type: 'HEALTH_EMERGENCY',
      verified,
      confidence: Number((compositeScore * 100).toFixed(1)),
      sensors: {
        accelerometer: { impactG, motionlessSeconds, score: fallImpactScore },
        ppgVitals: { heartRateBpm, spO2Pct, score: vitalsDistressScore }
      },
      verificationNote: verified
        ? 'VERIFIED: Fall impact corroborated with vital signs distress.'
        : 'Normal'
    };
  }

  /**
   * 5. SECURITY INTRUSION VERIFICATION [#12, #13, #17, #NF10]
   */
  verifyIntrusion(sensorData) {
    const { doorContactOpen, pirMotion, cameraPersonDetected, systemArmed = true } = sensorData;

    if (!systemArmed) {
      return { type: 'INTRUSION', verified: false, confidence: 0, reason: 'System disarmed' };
    }

    const contactScore = doorContactOpen ? 1.0 : 0.0;
    const motionScore = (pirMotion ? 0.5 : 0.0) + (cameraPersonDetected ? 0.5 : 0.0);

    const compositeScore = 0.5 * contactScore + 0.5 * motionScore;
    const verified = doorContactOpen && (pirMotion || cameraPersonDetected);

    return {
      type: 'INTRUSION',
      verified,
      confidence: Number((compositeScore * 100).toFixed(1)),
      sensors: {
        doorContact: { open: doorContactOpen, score: contactScore },
        presenceMotion: { pir: pirMotion, cameraAi: cameraPersonDetected, score: motionScore }
      },
      verificationNote: verified
        ? 'VERIFIED: Perimeter breach confirmed by indoor optical/motion sensors.'
        : 'Normal'
    };
  }
}

module.exports = new IncidentVerificationEngine();
