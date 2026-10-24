/**
 * Bias & Calibration Filter Engine - SmartGuard IoT
 * Satisfies: [#NF4] (Sensor correlation to correct calibration & measurement biases)
 *
 * Implements:
 *  - 1D Kalman Filter for sensor noise reduction & state estimation
 *  - Dynamic Baseline Calibration for sensor drift (e.g. CO2/gas sensor creep)
 *  - Temperature-compensated offset adjustments
 */

class KalmanFilter {
  constructor(processNoise = 0.01, measurementNoise = 0.5, estimationError = 1.0, initialValue = 0) {
    this.q = processNoise;       // Process variance Q
    this.r = measurementNoise;   // Measurement variance R
    this.p = estimationError;   // Estimation error covariance P
    this.x = initialValue;      // Value estimate
    this.k = 0;                 // Kalman gain
  }

  update(measurement) {
    // Prediction update
    this.p = this.p + this.q;

    // Measurement update
    this.k = this.p / (this.p + this.r);
    this.x = this.x + this.k * (measurement - this.x);
    this.p = (1 - this.k) * this.p;

    return this.x;
  }
}

class BiasFilterEngine {
  constructor() {
    this.filters = new Map();
    this.baselines = new Map();
    this.offsets = new Map();
  }

  /**
   * Get or initialize Kalman filter for a specific sensor channel
   */
  getFilter(sensorId, initialValue = 20.0, q = 0.02, r = 0.8) {
    if (!this.filters.has(sensorId)) {
      this.filters.set(sensorId, new KalmanFilter(q, r, 1.0, initialValue));
      this.baselines.set(sensorId, initialValue);
      this.offsets.set(sensorId, 0.0);
    }
    return this.filters.get(sensorId);
  }

  /**
   * Set calibration offset for known hardware bias [#NF4]
   */
  setCalibrationOffset(sensorId, offsetValue) {
    this.offsets.set(sensorId, offsetValue);
  }

  /**
   * Process raw sensor reading through bias correction and Kalman filter
   * @param {string} sensorId - Unique sensor identifier
   * @param {number} rawValue - Raw reading from hardware
   * @param {object} context - Ambient context (e.g. ambientTemp) for temperature compensation
   * @returns {object} - Detailed calibration result
   */
  process(sensorId, rawValue, context = {}) {
    const filter = this.getFilter(sensorId, rawValue);
    const manualOffset = this.offsets.get(sensorId) || 0.0;

    // Apply temperature compensation if applicable (e.g. for semiconductor gas/PIR sensors)
    let tempCompensation = 0.0;
    if (context.ambientTemp !== undefined) {
      const deltaTemp = context.ambientTemp - 21.0; // Reference 21 C
      tempCompensation = deltaTemp * 0.015; // 1.5% drift per C
    }

    // Unbiased measurement
    const unbiasedRaw = rawValue - manualOffset - tempCompensation;

    // Kalman filtered state
    const filteredValue = filter.update(unbiasedRaw);

    // Track rolling baseline for long-term drift detection
    const prevBase = this.baselines.get(sensorId) || filteredValue;
    const newBase = prevBase * 0.995 + filteredValue * 0.005;
    this.baselines.set(sensorId, newBase);

    return {
      sensorId,
      raw: Number(rawValue.toFixed(2)),
      corrected: Number(filteredValue.toFixed(2)),
      biasRemoved: Number((rawValue - filteredValue).toFixed(2)),
      kalmanGain: Number(filter.k.toFixed(4)),
      baseline: Number(newBase.toFixed(2))
    };
  }
}

module.exports = new BiasFilterEngine();
