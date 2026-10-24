/**
 * Device Manager Service - SmartGuard IoT
 * Satisfies: [#1], [#4], [#6], [#7], [#22]
 *
 * Requirements:
 *  - [#1]: Support for at least 1 smart appliance (Smart Washing Machine)
 *  - [#4]: One device for personal health monitoring (Smart Wearable)
 *  - [#6]: At least 1 smart device related to climate control (Smart HVAC / Thermostat)
 *  - [#7]: At least 1 smart device related to lighting (Smart Lighting System)
 *  - [#22]: Device management: Add, Remove, Stop, Resume, and Start devices
 */

const EventEmitter = require('events');

class DeviceManager extends EventEmitter {
  constructor() {
    super();
    this.devices = new Map();
    this.initDefaultDevices();
  }

  /**
   * Populate initial required devices
   */
  initDefaultDevices() {
    // 1. Smart Appliance [#1]
    this.devices.set('appliance_washer', {
      id: 'appliance_washer',
      name: 'Smart EcoWash 9000',
      category: 'APPLIANCE',
      status: 'RUNNING', // 'RUNNING', 'STOPPED', 'PAUSED'
      state: {
        cycle: 'COTTON_ECO',
        spinSpeedRpm: 1200,
        doorLocked: true,
        progressPct: 62,
        powerDrawWatts: 1850,
        waterUsedLiters: 42
      },
      controllable: true,
      lastSeen: Date.now()
    });

    // 2. Personal Health Monitor [#4]
    this.devices.set('health_wearable', {
      id: 'health_wearable',
      name: 'VitalGuard Pulse Watch',
      category: 'HEALTH',
      status: 'RUNNING',
      state: {
        heartRateBpm: 72,
        spO2Pct: 98,
        motionState: 'NORMAL_WALK',
        impactG: 0.98,
        fallDetected: false,
        batteryPct: 88
      },
      controllable: false,
      lastSeen: Date.now()
    });

    // 3. Climate Control / HVAC [#6, #21]
    this.devices.set('climate_hvac', {
      id: 'climate_hvac',
      name: 'NordicAir Precision HVAC',
      category: 'CLIMATE',
      status: 'RUNNING',
      state: {
        currentTemp: 21.8,
        targetTemp: 22.0,
        mode: 'COMFORT', // 'COMFORT', 'ECO', 'FIRE_LOCKOUT'
        fanSpeed: 'AUTO',
        freshAirDamperOpen: true,
        powerWatts: 920
      },
      controllable: true,
      lastSeen: Date.now()
    });

    // 4. Smart Lighting [#7, #18]
    this.devices.set('smart_lighting', {
      id: 'smart_lighting',
      name: 'AuraHue Dynamic Lighting',
      category: 'LIGHTING',
      status: 'RUNNING',
      state: {
        on: true,
        brightness: 70, // 0 - 100%
        colorHex: '#FFA834', // Warm ambient
        mode: 'NORMAL', // 'NORMAL', 'EMERGENCY_FULL', 'SECURITY_STROBE'
        powerWatts: 45
      },
      controllable: true,
      lastSeen: Date.now()
    });

    // 5. Motorized Water Shutoff Valve [#19]
    this.devices.set('water_valve', {
      id: 'water_valve',
      name: 'AquaStop Motorized Main Valve',
      category: 'SAFETY_ACTUATOR',
      status: 'RUNNING',
      state: {
        valveOpen: true,
        positionPct: 100,
        lastActuated: Date.now()
      },
      controllable: true,
      lastSeen: Date.now()
    });

    // 6. Emergency Exit Electromagnetic Lock [#20]
    this.devices.set('emergency_exit', {
      id: 'emergency_exit',
      name: 'Main Emergency Door MagLock',
      category: 'SAFETY_ACTUATOR',
      status: 'RUNNING',
      state: {
        locked: true,
        failSafeArmed: true,
        emergencyReleased: false
      },
      controllable: true,
      lastSeen: Date.now()
    });

    // 7. Security Camera [#12, #17]
    this.devices.set('security_camera', {
      id: 'security_camera',
      name: 'Perimeter 4K AI Camera',
      category: 'SECURITY',
      status: 'RUNNING',
      state: {
        recordingMode: 'STANDBY_5FPS', // 'STANDBY_5FPS', 'ALARM_30FPS_HD'
        ptzTrackingActive: false,
        nightVision: true,
        aiInferencing: true
      },
      controllable: true,
      lastSeen: Date.now()
    });
  }

  // --- DEVICE MANAGEMENT LIFECYCLE METHODS [#22] ---

  /**
   * Add a new device [#22]
   */
  addDevice(deviceData) {
    const id = deviceData.id || `device_${Date.now()}`;
    const newDevice = {
      id,
      name: deviceData.name || 'New Smart Device',
      category: deviceData.category || 'MISC',
      status: 'STOPPED', // Initially stopped until started
      state: deviceData.state || {},
      controllable: deviceData.controllable !== false,
      lastSeen: Date.now()
    };

    this.devices.set(id, newDevice);
    this.emit('device:added', newDevice);
    return newDevice;
  }

  /**
   * Remove a device [#22]
   */
  removeDevice(id) {
    if (!this.devices.has(id)) {
      throw new Error(`Device ${id} not found.`);
    }
    const removed = this.devices.get(id);
    this.devices.delete(id);
    this.emit('device:removed', removed);
    return { success: true, removedId: id };
  }

  /**
   * Start a device [#22]
   */
  startDevice(id) {
    const device = this.getDevice(id);
    device.status = 'RUNNING';
    device.lastSeen = Date.now();
    this.emit('device:started', device);
    return device;
  }

  /**
   * Stop a device [#22]
   */
  stopDevice(id) {
    const device = this.getDevice(id);
    device.status = 'STOPPED';
    device.lastSeen = Date.now();
    this.emit('device:stopped', device);
    return device;
  }

  /**
   * Resume a paused device [#22]
   */
  resumeDevice(id) {
    const device = this.getDevice(id);
    if (device.status !== 'PAUSED') {
      device.status = 'RUNNING';
    } else {
      device.status = 'RUNNING';
    }
    device.lastSeen = Date.now();
    this.emit('device:resumed', device);
    return device;
  }

  /**
   * Pause a running device
   */
  pauseDevice(id) {
    const device = this.getDevice(id);
    device.status = 'PAUSED';
    device.lastSeen = Date.now();
    this.emit('device:paused', device);
    return device;
  }

  /**
   * Update device state or properties
   */
  updateDeviceState(id, patch) {
    const device = this.getDevice(id);
    device.state = { ...device.state, ...patch };
    device.lastSeen = Date.now();
    this.emit('device:updated', device);
    return device;
  }

  getDevice(id) {
    const device = this.devices.get(id);
    if (!device) {
      throw new Error(`Device with ID '${id}' not found`);
    }
    return device;
  }

  getAllDevices() {
    return Array.from(this.devices.values());
  }
}

module.exports = new DeviceManager();
