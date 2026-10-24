/**
 * SmartGuard IoT - Central Server
 * Combines Express REST API + WebSocket Server + Continuous Pooling Engine
 * Satisfies all requirements from Descriptions 1 to 5.
 */

const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');

// Import services and engines
const deviceManager = require('./src/services/deviceManager');
const energyManager = require('./src/services/energyManager');
const videoAnalytics = require('./src/services/videoAnalytics');
const emergency = require('./src/services/emergency');
const notifier = require('./src/services/notifier');
const billing = require('./src/services/billing');
const pooling = require('./src/engine/pooling');
const security = require('./src/engine/security');
const maintenance = require('./src/engine/maintenance');
const store = require('./src/data/store');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Broadcast to all connected WebSocket clients [#11, #NF7]
function broadcast(type, data) {
  const message = JSON.stringify({ type, data, timestamp: Date.now() });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// Wire pooling snapshot to WebSocket clients
pooling.on('snapshot', (snapshot) => {
  broadcast('TELEMETRY_SNAPSHOT', {
    ...snapshot,
    devices: deviceManager.getAllDevices(),
    emergencyState: {
      activeIncidents: emergency.getActiveIncidents(),
      dispatches: emergency.getDispatches().slice(-5)
    },
    notifications: notifier.getRecentNotifications(10),
    subscription: billing.getCurrentSubscription()
  });
});

// Wire notifier events
notifier.on('notification:new', (notif) => {
  broadcast('NEW_NOTIFICATION', notif);
  store.logAudit('NOTIFICATION_SENT', 'SYSTEM', { title: notif.title, priority: notif.priority });
});

// Wire device changes
deviceManager.on('device:updated', (device) => broadcast('DEVICE_UPDATED', device));
deviceManager.on('device:started', (device) => broadcast('DEVICE_STARTED', device));
deviceManager.on('device:stopped', (device) => broadcast('DEVICE_STOPPED', device));
deviceManager.on('device:resumed', (device) => broadcast('DEVICE_RESUMED', device));
deviceManager.on('device:added', (device) => broadcast('DEVICE_ADDED', device));
deviceManager.on('device:removed', (device) => broadcast('DEVICE_REMOVED', device));

// -------------------------------------------------------------
// REST API ROUTES
// -------------------------------------------------------------

// 1. Device Management API [#1, #4, #6, #7, #22]
app.get('/api/devices', (req, res) => {
  res.json({ success: true, devices: deviceManager.getAllDevices() });
});

app.post('/api/devices', (req, res) => {
  try {
    const newDev = deviceManager.addDevice(req.body);
    store.logAudit('DEVICE_ADDED', 'USER', { deviceId: newDev.id, name: newDev.name });
    res.status(201).json({ success: true, device: newDev });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.delete('/api/devices/:id', (req, res) => {
  try {
    const result = deviceManager.removeDevice(req.params.id);
    store.logAudit('DEVICE_REMOVED', 'USER', { deviceId: req.params.id });
    res.json({ success: true, result });
  } catch (err) {
    res.status(404).json({ success: false, error: err.message });
  }
});

app.post('/api/devices/:id/start', (req, res) => {
  try {
    const dev = deviceManager.startDevice(req.params.id);
    res.json({ success: true, device: dev });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/devices/:id/stop', (req, res) => {
  try {
    const dev = deviceManager.stopDevice(req.params.id);
    res.json({ success: true, device: dev });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/devices/:id/resume', (req, res) => {
  try {
    const dev = deviceManager.resumeDevice(req.params.id);
    res.json({ success: true, device: dev });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.patch('/api/devices/:id', (req, res) => {
  try {
    const dev = deviceManager.updateDeviceState(req.params.id, req.body);
    res.json({ success: true, device: dev });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 2. Energy Management API [#2]
app.get('/api/energy', (req, res) => {
  res.json({ success: true, energy: energyManager.getEnergySummary() });
});

app.post('/api/energy/peak-shaving', (req, res) => {
  const { enabled } = req.body;
  energyManager.togglePeakShaving(enabled);
  res.json({ success: true, peakShavingActive: energyManager.peakShavingActive });
});

app.post('/api/energy/threshold', (req, res) => {
  const { thresholdKw } = req.body;
  energyManager.setPeakThreshold(thresholdKw);
  res.json({ success: true, thresholdKw: energyManager.peakThresholdKw });
});

// 3. Emergency & Incident Simulation API [#3, #5, #9, #14, #17, #18, #19, #20, #21]
app.post('/api/simulate/fire', (req, res) => {
  const { active = true } = req.body;
  pooling.simulateFire(active);
  res.json({ success: true, simulation: 'FIRE', active });
});

app.post('/api/simulate/leak', (req, res) => {
  const { active = true } = req.body;
  pooling.simulateWaterLeak(active);
  res.json({ success: true, simulation: 'WATER_LEAK', active });
});

app.post('/api/simulate/intrusion', (req, res) => {
  const { active = true } = req.body;
  pooling.simulateIntrusion(active);
  res.json({ success: true, simulation: 'INTRUSION', active });
});

app.post('/api/simulate/health', (req, res) => {
  const { active = true } = req.body;
  pooling.simulateHealthEmergency(active);
  res.json({ success: true, simulation: 'HEALTH_EMERGENCY', active });
});

app.post('/api/simulate/fault', (req, res) => {
  const { active = true } = req.body;
  pooling.simulateApplianceFault(active);
  res.json({ success: true, simulation: 'APPLIANCE_VIBRATION_FAULT', active });
});

app.post('/api/emergency/reset', (req, res) => {
  // Clear all simulator triggers
  pooling.simulateFire(false);
  pooling.simulateWaterLeak(false);
  pooling.simulateIntrusion(false);
  pooling.simulateHealthEmergency(false);
  pooling.simulateApplianceFault(false);

  const result = emergency.resetEmergencyState();
  store.logAudit('EMERGENCY_RESET', 'USER', { message: 'All actuators restored to normal standby' });
  broadcast('EMERGENCY_RESET', result);
  res.json({ success: true, result });
});

// 4. Notifications API [#11, #23]
app.get('/api/notifications', (req, res) => {
  res.json({ success: true, notifications: notifier.getRecentNotifications(50) });
});

app.post('/api/notifications/:id/ack', (req, res) => {
  const acked = notifier.acknowledge(req.params.id);
  res.json({ success: Boolean(acked), notification: acked });
});

// 5. Subscription & 3rd Party Billing API [#NF14]
app.get('/api/billing/tiers', (req, res) => {
  res.json({ success: true, tiers: billing.getTiers() });
});

app.get('/api/billing/subscription', (req, res) => {
  res.json({ success: true, subscription: billing.getCurrentSubscription() });
});

app.post('/api/billing/checkout', (req, res) => {
  const { planId } = req.body;
  const session = billing.createCheckoutSession('user_default', planId);
  res.json({ success: true, checkoutSession: session });
});

app.post('/api/billing/upgrade', (req, res) => {
  const { planId } = req.body;
  const updated = billing.upgradeSubscription('user_default', planId);
  store.logAudit('SUBSCRIPTION_UPGRADED', 'USER', { planId });
  broadcast('SUBSCRIPTION_UPDATED', updated);
  res.json({ success: true, subscription: updated });
});

app.post('/api/billing/webhook', (req, res) => {
  const sig = req.headers['stripe-signature'];
  const result = billing.processWebhook(req.body, sig);
  res.json(result);
});

// 6. Predictive Maintenance API [#15]
app.get('/api/maintenance', (req, res) => {
  res.json({ success: true, maintenance: maintenance.getOverview() });
});

// 7. Security API [#NF2, #NF8, #NF13]
app.post('/api/security/sign', (req, res) => {
  const signed = security.signPayload(req.body);
  res.json({ success: true, signedEnvelope: signed });
});

app.post('/api/security/verify', (req, res) => {
  const verification = security.verifySignedPayload(req.body);
  res.json(verification);
});

// WebSocket Connection Handler
wss.on('connection', (ws) => {
  // Send immediate state snapshot
  ws.send(JSON.stringify({
    type: 'INITIAL_STATE',
    data: {
      devices: deviceManager.getAllDevices(),
      notifications: notifier.getRecentNotifications(10),
      subscription: billing.getCurrentSubscription(),
      maintenance: maintenance.getOverview(),
      emergencyState: {
        activeIncidents: emergency.getActiveIncidents(),
        dispatches: emergency.getDispatches().slice(-5)
      }
    }
  }));
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[SmartGuard IoT] Server listening on http://localhost:${PORT}`);
  // Start continuous pooling loop [#NF3]
  pooling.start();
  console.log(`[SmartGuard IoT] Continuous Sensor Pooling Engine active.`);
});

module.exports = { app, server };
