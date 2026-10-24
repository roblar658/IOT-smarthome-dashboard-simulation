/**
 * Predictive Maintenance Engine - SmartGuard IoT
 * Satisfies: [#15] (Do prediction analysis related to maintenance)
 *
 * Capabilities:
 *  - Motor Current Signature Analysis (MCSA) anomaly tracking
 *  - Vibration spectrum harmonic analysis (simulated FFT peak power)
 *  - Wear Index computation (0-100%) and Remaining Useful Life (RUL in hours)
 *  - Early warning alerts before catastrophic bearing or compressor failure
 */

class PredictiveMaintenanceEngine {
  constructor() {
    this.deviceWear = {
      'appliance_washer': {
        runHours: 142.5,
        baselineCurrentRms: 2.1,  // Amperes
        baselineVibrationG: 0.12, // g-force
        wearIndex: 18.5,           // %
        estimatedRulHours: 2850,
        anomaliesDetected: 0
      },
      'climate_hvac': {
        runHours: 1120.0,
        baselineCurrentRms: 4.8,
        baselineVibrationG: 0.08,
        wearIndex: 29.0,
        estimatedRulHours: 5200,
        anomaliesDetected: 0
      }
    };
  }

  /**
   * Analyze high-frequency vibration and electrical telemetry for predictive maintenance [#15]
   * @param {string} deviceId - Target appliance/equipment
   * @param {number} currentRms - Measured current draw (Amperes)
   * @param {number} vibrationG - Measured peak vibration (g-force)
   * @param {number} harmonicDeviation - Peak harmonic frequency shift (%)
   */
  analyze(deviceId, currentRms, vibrationG, harmonicDeviation = 0) {
    if (!this.deviceWear[deviceId]) {
      this.deviceWear[deviceId] = {
        runHours: 10.0,
        baselineCurrentRms: currentRms || 2.0,
        baselineVibrationG: vibrationG || 0.1,
        wearIndex: 5.0,
        estimatedRulHours: 4000,
        anomaliesDetected: 0
      };
    }

    const state = this.deviceWear[deviceId];
    state.runHours += 0.01; // increment runtime

    // Deviation from baseline
    const currentDeltaPct = Math.max(0, ((currentRms - state.baselineCurrentRms) / state.baselineCurrentRms) * 100);
    const vibrationDeltaPct = Math.max(0, ((vibrationG - state.baselineVibrationG) / state.baselineVibrationG) * 100);

    // Composite wear score calculation
    const anomalySeverity = (currentDeltaPct * 0.4 + vibrationDeltaPct * 0.4 + harmonicDeviation * 0.2);
    
    // Gradual wear accumulation + accelerated degradation under abnormal stress
    if (anomalySeverity > 30) {
      state.wearIndex = Math.min(100, state.wearIndex + 0.15);
      state.estimatedRulHours = Math.max(0, state.estimatedRulHours - 5);
      state.anomaliesDetected++;
    } else {
      state.wearIndex = Math.min(100, state.wearIndex + 0.002);
      state.estimatedRulHours = Math.max(0, state.estimatedRulHours - 0.01);
    }

    // Determine status
    let status = 'HEALTHY';
    let recommendation = 'Equipment operates within nominal baseline parameters.';

    if (state.wearIndex > 80 || anomalySeverity > 75) {
      status = 'CRITICAL_MAINTENANCE_REQUIRED';
      recommendation = 'Urgent: High bearing friction and abnormal harmonic vibration detected. Immediate service required.';
    } else if (state.wearIndex > 50 || anomalySeverity > 40) {
      status = 'MAINTENANCE_RECOMMENDED';
      recommendation = 'Warning: Elevated motor current and mechanical vibration observed. Plan preventative maintenance within 30 days.';
    }

    return {
      deviceId,
      status,
      wearIndexPct: Number(state.wearIndex.toFixed(1)),
      estimatedRulHours: Math.round(state.estimatedRulHours),
      runHoursTotal: Number(state.runHours.toFixed(1)),
      metrics: {
        currentRms: Number(currentRms.toFixed(2)),
        vibrationG: Number(vibrationG.toFixed(3)),
        currentDeviationPct: Number(currentDeltaPct.toFixed(1)),
        vibrationDeviationPct: Number(vibrationDeltaPct.toFixed(1)),
        harmonicDeviationPct: Number(harmonicDeviation.toFixed(1))
      },
      recommendation,
      requiresAction: status !== 'HEALTHY'
    };
  }

  getOverview() {
    return this.deviceWear;
  }
}

module.exports = new PredictiveMaintenanceEngine();
