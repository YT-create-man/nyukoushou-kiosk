const $ = (id) => document.getElementById(id);
const pages = {
  action: $('page-action'),
  scan: $('page-scan'),
  confirm: $('page-confirm'),
  success: $('page-success'),
  error: $('page-error')
};

let state = {
  currentAction: null,
  currentMember: null,
  scanning: false,
  stream: null,
  rafId: null
};

function showPage(name) {
  Object.values(pages).forEach(p => p.classList.remove('active'));
  pages[name].classList.add('active');
}

function init() {
  $('store-display').textContent = CONFIG.STORE || '';
  $('btn-checkin').addEventListener('click', () => startScan('入校'));
  $('btn-checkout').addEventListener('click', () => startScan('退校'));
  $('btn-cancel-scan').addEventListener('click', cancelScan);
  $('btn-cancel-confirm').addEventListener('click', () => { state.currentMember = null; goAction(); });
  $('btn-ok').addEventListener('click', confirmAction);
  $('btn-back-error').addEventListener('click', goAction);
  showPage('action');
}

async function startScan(action) {
  state.currentAction = action;
  applyActionLabel('action-label-scan', action);
  showPage('scan');

  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user' },
      audio: false
    });
    $('video').srcObject = state.stream;
    state.scanning = true;
    state.rafId = requestAnimationFrame(tick);
  } catch (err) {
    showError('カメラ起動失敗: ' + err.message);
  }
}

function applyActionLabel(elemId, action) {
  const el = $(elemId);
  el.textContent = action;
  el.classList.remove('checkin', 'checkout');
  el.classList.add(action === '入校' ? 'checkin' : 'checkout');
}

function tick() {
  if (!state.scanning) return;
  const video = $('video');
  if (video.readyState === video.HAVE_ENOUGH_DATA) {
    const canvas = $('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imgData.data, canvas.width, canvas.height);
    if (code && code.data) {
      onQrDetected(code.data.trim());
      return;
    }
  }
  state.rafId = requestAnimationFrame(tick);
}

function stopCamera() {
  state.scanning = false;
  if (state.rafId) cancelAnimationFrame(state.rafId);
  if (state.stream) {
    state.stream.getTracks().forEach(t => t.stop());
    state.stream = null;
  }
}

function cancelScan() {
  stopCamera();
  state.currentAction = null;
  showPage('action');
}

async function onQrDetected(memberId) {
  stopCamera();
  try {
    const res = await callGas({
      action: 'lookup',
      id: memberId,
      store: CONFIG.STORE
    });
    if (!res.ok) {
      showError('未登録: ' + memberId);
      return;
    }
    state.currentMember = res;
    applyActionLabel('action-label-confirm', state.currentAction);
    $('member-id-display').textContent = res.id;
    showPage('confirm');
  } catch (err) {
    showError('通信エラー: ' + err.message);
  }
}

async function confirmAction() {
  if (!state.currentMember || !state.currentAction) return;
  const typeJp = state.currentAction === '入校' ? '出席' : '退校';
  $('btn-ok').disabled = true;
  try {
    const res = await callGas({
      action: 'log',
      id: state.currentMember.id,
      type: typeJp,
      store: state.currentMember.store
    });
    if (!res.ok) {
      showError(res.error || '記録失敗');
      return;
    }
    const action = state.currentAction || '';
    const t = res.timestamp ? new Date(res.timestamp).toLocaleTimeString('ja-JP') : '';
    $('success-msg').textContent = '受け付けました';
    $('success-sub').textContent = action + (t ? ' / ' + t : '');
    showPage('success');
    setTimeout(goAction, 2500);
  } catch (err) {
    showError('通信エラー: ' + err.message);
  } finally {
    $('btn-ok').disabled = false;
  }
}

function showError(msg) {
  stopCamera();
  $('error-msg').textContent = msg;
  showPage('error');
}

function goAction() {
  stopCamera();
  state.currentAction = null;
  state.currentMember = null;
  $('member-id-display').textContent = '';
  $('success-msg').textContent = '';
  $('success-sub').textContent = '';
  $('error-msg').textContent = '';
  showPage('action');
}

async function callGas(params) {
  const url = new URL(CONFIG.GAS_URL);
  url.searchParams.set('token', CONFIG.TOKEN);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  });
  const res = await fetch(url.toString(), { method: 'GET' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return await res.json();
}

document.addEventListener('DOMContentLoaded', init);
