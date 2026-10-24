/**
 * SmartGuard IoT - Klientapplikasjon
 * Håndterer sanntids-WebSocket, AI-genererte overvåkningsbilder på lerret,
 * enhetsstyring, nødsimulering og abonnementsdialog.
 */

let ws = null;
let currentDevices = [];
let simState = {
  fire: false,
  leak: false,
  intrusion: false,
  health: false,
  fault: false
};
let cameraFrameData = {
  detections: [],
  mode: 'STANDBY_5FPS',
  fps: 5
};
let currentCameraChannel = 'auto'; // 'auto', 'normal', 'intrusion', 'fire'

// Preload AI-genererte sikkerhetskamera bilder
const cctvImages = {
  normal: new Image(),
  fire: new Image(),
  intrusion: new Image()
};
cctvImages.normal.src = '/assets/cctv_normal.jpg';
cctvImages.fire.src = '/assets/cctv_fire.jpg';
cctvImages.intrusion.src = '/assets/cctv_intrusion.jpg';

// Lydvarsel for kritiske hendelser (Web Audio API)
let audioCtx = null;
function playAlarmSiren() {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(650, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(900, audioCtx.currentTime + 0.25);
    gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.35);

    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.35);
  } catch (e) {
    // Stille feilhåndtering ved manglende brukerinteraksjon
  }
}

// WebSocket-tilkobling
function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('[SmartGuard] Tilkoblet sanntidstjener');
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'TELEMETRY_SNAPSHOT') {
        renderSnapshot(msg.data);
      } else if (msg.type === 'INITIAL_STATE') {
        if (msg.data.devices) renderDevices(msg.data.devices);
        if (msg.data.notifications) renderNotifications(msg.data.notifications);
        if (msg.data.subscription) renderSubscriptionBadge(msg.data.subscription);
      } else if (msg.type === 'NEW_NOTIFICATION') {
        handleNewNotification(msg.data);
      } else if (msg.type === 'EMERGENCY_RESET') {
        hideEmergencyBanner();
      }
    } catch (e) {
      console.error('Feil ved behandling av melding:', e);
    }
  };

  ws.onclose = () => {
    setTimeout(initWebSocket, 2000);
  };
}

// Kamerakanalvelger
function setCameraChannel(channel) {
  currentCameraChannel = channel;
  document.querySelectorAll('.cam-channel-btn').forEach(btn => btn.classList.remove('active'));
  const activeBtn = document.getElementById(`btn-cam-${channel}`);
  if (activeBtn) activeBtn.classList.add('active');

  const sourceBadge = document.getElementById('cam-feed-source');
  if (channel === 'fire') {
    sourceBadge.textContent = 'Kamera 03 (Brannsone)';
  } else if (channel === 'intrusion') {
    sourceBadge.textContent = 'Kamera 02 (Adgangsparti)';
  } else if (channel === 'normal') {
    sourceBadge.textContent = 'Kamera 01 (Korridor)';
  } else {
    sourceBadge.textContent = 'AI Hendelseskamera';
  }
}

// Oppdater visning med mottatt telemetri
function renderSnapshot(data) {
  const { telemetry, verifications, camera, maintenance, energy, devices, emergencyState } = data;

  // 1. Enheter og aktuatorer
  if (devices) {
    currentDevices = devices;
    renderDevices(devices);

    const waterValve = devices.find(d => d.id === 'water_valve');
    const emergencyExit = devices.find(d => d.id === 'emergency_exit');
    const lighting = devices.find(d => d.id === 'smart_lighting');
    const hvac = devices.find(d => d.id === 'climate_hvac');
    const cameraDev = devices.find(d => d.id === 'security_camera');

    if (waterValve) {
      const open = waterValve.state.valveOpen;
      document.getElementById('val-water-valve').textContent = open ? 'Aktiv (Åpen)' : 'Stengt (Lekkasjesikret)';
      document.getElementById('chip-water-valve').classList.toggle('alert-mode', !open);
    }

    if (emergencyExit) {
      const released = emergencyExit.state.emergencyReleased;
      document.getElementById('val-emergency-door').textContent = released ? 'Frigjort (Evakuering)' : 'Låst (Normal)';
      document.getElementById('chip-emergency-door').classList.toggle('alert-mode', released);
    }

    if (lighting) {
      const mode = lighting.state.mode;
      document.getElementById('val-lighting').textContent = `${mode} (${lighting.state.brightness}%)`;
      document.getElementById('chip-lighting').classList.toggle('alert-mode', mode !== 'NORMAL');
    }

    if (hvac) {
      const mode = hvac.state.mode;
      document.getElementById('val-hvac').textContent = `${mode} (${hvac.state.currentTemp} °C)`;
      document.getElementById('chip-hvac').classList.toggle('alert-mode', mode === 'FIRE_LOCKOUT');
    }

    if (cameraDev) {
      const rec = cameraDev.state.recordingMode;
      document.getElementById('val-camera-stream').textContent = rec;
      document.getElementById('chip-camera-stream').classList.toggle('alert-mode', rec.includes('ALARM'));
    }
  }

  // 2. Sensorfusjon
  if (telemetry) {
    document.getElementById('val-temp-raw').textContent = telemetry.thermal.raw;
    document.getElementById('val-temp-kalman').textContent = telemetry.thermal.filtered;
    document.getElementById('val-smoke').textContent = telemetry.smoke.filtered;
    document.getElementById('val-co').textContent = telemetry.thermal.filtered > 60 ? '45' : '4';

    document.getElementById('val-moisture').textContent = telemetry.moisture.filtered;
    document.getElementById('val-water-flow').textContent = telemetry.waterFlowLpm.toFixed(1);

    document.getElementById('val-pir').textContent = telemetry.pirMotion ? 'Bevegelse registrert' : 'Ingen bevegelse';
    document.getElementById('val-co2').textContent = telemetry.co2.filtered;
    document.getElementById('val-sound').textContent = telemetry.soundDb;

    document.getElementById('health-hr').textContent = `${telemetry.wearable.heartRateBpm} slag/min`;
    document.getElementById('health-spo2').textContent = `${telemetry.wearable.spO2Pct} %`;
    document.getElementById('health-impact').textContent = `${telemetry.wearable.impactG.toFixed(2)} G`;
    document.getElementById('health-state-text').textContent = 
      telemetry.wearable.impactG > 2.5 ? 'Advarsel: Kraftig støt og unormal stillstand detektert.' : 'Status: Normale fysiologiske verdier registrert.';
  }

  // 3. Verifisering og konfidensgrad
  if (verifications) {
    const fire = verifications.fire;
    const fireBadge = document.getElementById('fire-conf-badge');
    fireBadge.textContent = `${fire.confidence}% konfidens`;
    fireBadge.classList.toggle('verified', fire.verified);
    document.getElementById('fire-verify-note').textContent = fire.verificationNote;

    const leak = verifications.waterLeak;
    const leakBadge = document.getElementById('leak-conf-badge');
    leakBadge.textContent = `${leak.confidence}% konfidens`;
    leakBadge.classList.toggle('verified', leak.verified);
    document.getElementById('leak-verify-note').textContent = leak.verificationNote;

    const occ = verifications.occupancy;
    const occBadge = document.getElementById('occ-conf-badge');
    occBadge.textContent = `${occ.occupied ? 'Tilstede' : 'Tomt'} (${occ.confidence}%)`;
    occBadge.classList.toggle('verified', occ.occupied);
    document.getElementById('occ-verify-note').textContent = `Driftsmodus: ${occ.suggestedHvacMode} (Energibesparing aktiv).`;

    if (verifications.health.verified) {
      document.getElementById('health-state-text').textContent = verifications.health.verificationNote;
    }
  }

  // 4. Energiovervåking
  if (energy) {
    document.getElementById('energy-kw-val').textContent = energy.currentKw.toFixed(2);
    document.getElementById('energy-kwh-today').textContent = `${energy.cumulativeKwhToday.toFixed(2)} kWh`;
    document.getElementById('val-peak-limit').textContent = `${energy.peakThresholdKw.toFixed(1)} kW`;

    const fillPct = Math.min(100, (energy.currentKw / 10.0) * 100);
    const barFill = document.getElementById('energy-bar-fill');
    barFill.style.width = `${fillPct}%`;
    barFill.classList.toggle('exceeded', energy.currentKw > energy.peakThresholdKw);

    const sheddingStatus = document.getElementById('energy-shedding-status');
    if (energy.sheddingEngaged) {
      sheddingStatus.textContent = 'Lastreduksjon aktiv (Forbruk kuttet)';
      sheddingStatus.className = 'status-warning';
    } else {
      sheddingStatus.textContent = 'Normal belastning';
      sheddingStatus.className = 'status-online';
    }
  }

  // 5. Prediktivt vedlikehold
  if (maintenance) {
    document.getElementById('washer-wear-pct').textContent = `${maintenance.wearIndexPct} %`;
    document.getElementById('washer-rul-hours').textContent = `${maintenance.estimatedRulHours} driftstimer`;
    document.getElementById('washer-wear-bar').style.width = `${maintenance.wearIndexPct}%`;
    document.getElementById('maintenance-recommendation').textContent = maintenance.recommendation;
  }

  // 6. Kamera og bildeanalyse
  if (camera) {
    cameraFrameData.detections = camera.detections || [];
    cameraFrameData.mode = camera.camera.streamMode;
    cameraFrameData.fps = camera.camera.fps;

    document.getElementById('cam-rec-mode').textContent = `${camera.camera.streamMode} (${camera.camera.fps} bps)`;
    document.getElementById('cam-rec-mode').style.color = camera.camera.streamMode.includes('ALARM') ? '#f43f5e' : '#38bdf8';
    document.getElementById('cam-objects-count').textContent = camera.detections.length;
    document.getElementById('cam-ptz-status').textContent = camera.camera.ptzTracking ? 'Aktiv sporing' : 'Deaktivert';
    document.getElementById('ai-decision-text').textContent = camera.decision ? camera.decision.reason : 'Normal overvåking';
  }

  // 7. Kritisk alarmbanner
  if (emergencyState && emergencyState.activeIncidents && emergencyState.activeIncidents.length > 0) {
    showEmergencyBanner(emergencyState.activeIncidents[0]);
  }
}

// Bygg enhetsliste
function renderDevices(devices) {
  const container = document.getElementById('device-list-container');
  if (!container) return;

  container.innerHTML = devices.map(dev => {
    const isRunning = dev.status === 'RUNNING';
    const isPaused = dev.status === 'PAUSED';
    return `
      <div class="device-item" id="dev-card-${dev.id}">
        <div class="dev-info">
          <div class="dev-name">
            ${dev.name}
            <span class="dev-status-tag ${dev.status}">${dev.status}</span>
          </div>
          <div class="dev-meta">
            Kategori: ${dev.category} | Sist oppdatert: ${new Date(dev.lastSeen).toLocaleTimeString()}
          </div>
        </div>
        <div class="dev-actions">
          ${isRunning ? `
            <button class="btn-action" onclick="pauseDevice('${dev.id}')">Pause</button>
            <button class="btn-action" onclick="stopDevice('${dev.id}')">Stopp</button>
          ` : `
            <button class="btn-action" onclick="startDevice('${dev.id}')">Start</button>
            ${isPaused ? `<button class="btn-action" onclick="resumeDevice('${dev.id}')">Gjenoppta</button>` : ''}
          `}
          <button class="btn-action btn-action-danger" onclick="removeDevice('${dev.id}')">Fjern</button>
        </div>
      </div>
    `;
  }).join('');
}

// Varslingslogg
function renderNotifications(notifications) {
  const container = document.getElementById('notifications-list');
  if (!container) return;

  container.innerHTML = notifications.map(n => `
    <div class="notif-item ${n.priority}">
      <div class="notif-header">
        <span>${n.title}</span>
        <span class="notif-time">${new Date(n.timestamp).toLocaleTimeString()}</span>
      </div>
      <div class="notif-msg">${n.message}</div>
    </div>
  `).join('');
}

function handleNewNotification(notif) {
  if (notif.mandatory || notif.priority === 'CRITICAL_MANDATORY') {
    playAlarmSiren();
    showEmergencyBanner({ type: notif.category, message: notif.message });
  }
  fetch('/api/notifications')
    .then(r => r.json())
    .then(d => { if (d.notifications) renderNotifications(d.notifications); });
}

// Kritisk nødvarsel
function showEmergencyBanner(incident) {
  const banner = document.getElementById('mandatory-alarm-banner');
  const title = document.getElementById('banner-title');
  const desc = document.getElementById('banner-desc');

  title.textContent = `Kritisk nødrespons aktivert: ${incident.type || 'Hendelse'}`;
  desc.textContent = incident.message || 'Automatisert krisehåndtering er iverksatt: Nødutganger åpnet, belysning aktivert, nødsentral varslet.';
  banner.classList.remove('hidden');
}

function hideEmergencyBanner() {
  document.getElementById('mandatory-alarm-banner').classList.add('hidden');
}

// Hendelsessimulering
async function toggleSimFire() {
  simState.fire = !simState.fire;
  document.getElementById('sim-fire-btn').classList.toggle('active', simState.fire);
  await fetch('/api/simulate/fire', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active: simState.fire })
  });
}

async function toggleSimLeak() {
  simState.leak = !simState.leak;
  document.getElementById('sim-leak-btn').classList.toggle('active', simState.leak);
  await fetch('/api/simulate/leak', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active: simState.leak })
  });
}

async function toggleSimIntrusion() {
  simState.intrusion = !simState.intrusion;
  document.getElementById('sim-intrusion-btn').classList.toggle('active', simState.intrusion);
  await fetch('/api/simulate/intrusion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active: simState.intrusion })
  });
}

async function toggleSimHealth() {
  simState.health = !simState.health;
  document.getElementById('sim-health-btn').classList.toggle('active', simState.health);
  await fetch('/api/simulate/health', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active: simState.health })
  });
}

async function toggleSimFault() {
  simState.fault = !simState.fault;
  document.getElementById('sim-fault-btn').classList.toggle('active', simState.fault);
  await fetch('/api/simulate/fault', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active: simState.fault })
  });
}

async function resetEmergency() {
  simState = { fire: false, leak: false, intrusion: false, health: false, fault: false };
  document.querySelectorAll('.sim-btn').forEach(b => b.classList.remove('active'));
  hideEmergencyBanner();

  await fetch('/api/emergency/reset', { method: 'POST' });
}

// Enhetsstyring API
async function startDevice(id) {
  await fetch(`/api/devices/${id}/start`, { method: 'POST' });
}

async function stopDevice(id) {
  await fetch(`/api/devices/${id}/stop`, { method: 'POST' });
}

async function resumeDevice(id) {
  await fetch(`/api/devices/${id}/resume`, { method: 'POST' });
}

async function pauseDevice(id) {
  await fetch(`/api/devices/${id}/stop`, { method: 'POST' });
}

async function removeDevice(id) {
  if (confirm(`Bekreft at du vil fjerne enheten ${id}?`)) {
    await fetch(`/api/devices/${id}`, { method: 'DELETE' });
  }
}

function openAddDeviceModal() {
  document.getElementById('modal-add-device').classList.remove('hidden');
}

function closeAddDeviceModal() {
  document.getElementById('modal-add-device').classList.add('hidden');
}

async function handleAddDevice(e) {
  e.preventDefault();
  const name = document.getElementById('dev-name').value;
  const category = document.getElementById('dev-category').value;
  const power = Number(document.getElementById('dev-power').value) || 0;

  await fetch('/api/devices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      category,
      state: { powerDrawWatts: power }
    })
  });

  closeAddDeviceModal();
  document.getElementById('form-add-device').reset();
}

// Energistyring
async function togglePeakShaving(enabled) {
  await fetch('/api/energy/peak-shaving', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled })
  });
}

// Abonnementsdialog
async function openBillingModal() {
  const modal = document.getElementById('modal-billing');
  const grid = document.getElementById('pricing-tiers-grid');
  modal.classList.remove('hidden');

  const res = await fetch('/api/billing/tiers');
  const data = await res.json();
  const subRes = await fetch('/api/billing/subscription');
  const subData = await subRes.json();
  const currentPlanId = subData.subscription.planId;

  grid.innerHTML = data.tiers.map(tier => {
    const isCurrent = tier.id === currentPlanId;
    return `
      <div class="tier-card ${isCurrent ? 'current' : ''}">
        <div>
          <div class="tier-name">${tier.name}</div>
          <div class="tier-price">${tier.priceNok} kr <span class="tier-period">per måned</span></div>
          <ul class="tier-features">
            ${tier.features.map(f => `<li>${f}</li>`).join('')}
          </ul>
        </div>
        <div>
          ${isCurrent ? 
            `<button class="btn btn-secondary" disabled style="width:100%">Gjeldende avtale</button>` :
            `<button class="btn btn-primary" style="width:100%" onclick="upgradePlan('${tier.id}')">Oppgrader avtale</button>`
          }
        </div>
      </div>
    `;
  }).join('');
}

function closeBillingModal() {
  document.getElementById('modal-billing').classList.add('hidden');
}

async function upgradePlan(planId) {
  const res = await fetch('/api/billing/upgrade', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ planId })
  });
  const data = await res.json();
  renderSubscriptionBadge(data.subscription);
  closeBillingModal();
}

function renderSubscriptionBadge(sub) {
  const badge = document.getElementById('sub-plan-badge');
  if (badge && sub.planDetails) {
    badge.textContent = sub.planDetails.name;
  }
}

// AI Sikkerhetskamera lerret med AI-generert bildevisning
function initCameraCanvas() {
  const canvas = document.getElementById('camera-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let tick = 0;

  function draw() {
    tick++;
    const w = canvas.width;
    const h = canvas.height;

    // 1. Bestem hvilket AI-generert bilde som skal vises
    let activeImage = cctvImages.normal;
    let sceneMode = 'NORMAL';

    if (currentCameraChannel === 'fire' || (currentCameraChannel === 'auto' && simState.fire)) {
      activeImage = cctvImages.fire;
      sceneMode = 'FIRE';
    } else if (currentCameraChannel === 'intrusion' || (currentCameraChannel === 'auto' && simState.intrusion)) {
      activeImage = cctvImages.intrusion;
      sceneMode = 'INTRUSION';
    } else {
      activeImage = cctvImages.normal;
      sceneMode = 'NORMAL';
    }

    // 2. Tegn det AI-genererte overvåkningsbildet
    if (activeImage.complete && activeImage.naturalWidth > 0) {
      ctx.drawImage(activeImage, 0, 0, w, h);
    } else {
      // Fallback før bildet er ferdig innlastet
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, w, h);
    }

    // 3. Diskret scanne-effekt over videoen
    const scanY = (tick * 1.5) % h;
    ctx.strokeStyle = sceneMode === 'FIRE' ? 'rgba(244, 63, 94, 0.15)' : 'rgba(56, 189, 248, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, scanY);
    ctx.lineTo(w, scanY);
    ctx.stroke();

    // 4. AI Objekt-deteksjonsbokser og sporingsrammer
    if (sceneMode === 'INTRUSION') {
      // Sporing av inntrenger
      const bx = 270, by = 130, bw = 140, bh = 200;
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.strokeRect(bx, by, bw, bh);

      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.fillRect(bx, by - 22, bw, 22);

      ctx.fillStyle = '#38bdf8';
      ctx.font = '600 11px Inter, sans-serif';
      ctx.fillText('INNTRENGER (94%)', bx + 6, by - 6);

      // Sentrumsikte
      ctx.beginPath();
      ctx.arc(bx + bw / 2, by + bh * 0.35, 5, 0, Math.PI * 2);
      ctx.stroke();

    } else if (sceneMode === 'FIRE') {
      // Deteksjon av flammer og røyk
      const bx = 300, by = 120, bw = 180, bh = 180;
      ctx.strokeStyle = '#f43f5e';
      ctx.lineWidth = 2;
      ctx.strokeRect(bx, by, bw, bh);

      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.fillRect(bx, by - 22, bw, 22);

      ctx.fillStyle = '#f43f5e';
      ctx.font = '600 11px Inter, sans-serif';
      ctx.fillText('RØYK OG FLAMMER (98%)', bx + 6, by - 6);
    }

    // Tidsstempel på skjerm
    document.getElementById('cam-timestamp').textContent = 
      new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';

    requestAnimationFrame(draw);
  }

  requestAnimationFrame(draw);
}

window.addEventListener('DOMContentLoaded', () => {
  initWebSocket();
  initCameraCanvas();
});
