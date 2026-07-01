// Annotation Script - Canvas-based screenshot annotation tool

let canvas;
let ctx;
let isDrawing = false;
let currentTool = 'pen';
let currentColor = '#ff0000';
let currentLineWidth = 3;
let startX, startY;
let history = [];
let historyStep = -1;
let screenshot = null;

document.addEventListener('DOMContentLoaded', async () => {
  canvas = document.getElementById('annotationCanvas');
  ctx = canvas.getContext('2d');

  // Load screenshot from storage
  const data = await chrome.storage.local.get(['pendingScreenshot']);
  if (data.pendingScreenshot) {
    await loadScreenshot(data.pendingScreenshot);
    chrome.storage.local.remove('pendingScreenshot');
  }

  setupEventListeners();
});

async function loadScreenshot(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      // Set canvas size to match image
      canvas.width = img.width;
      canvas.height = img.height;
      
      // Draw image on canvas
      ctx.drawImage(img, 0, 0);
      
      screenshot = img;
      saveState();
      resolve();
    };
    img.src = dataUrl;
  });
}

function setupEventListeners() {
  // Tool buttons
  document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelector('.tool-btn.active')?.classList.remove('active');
      btn.classList.add('active');
      currentTool = btn.dataset.tool;
    });
  });

  // Color picker
  const colorPicker = document.getElementById('colorPicker');
  colorPicker.addEventListener('input', (e) => {
    currentColor = e.target.value;
    document.querySelector('.color-preview').style.backgroundColor = currentColor;
  });

  // Line width
  const lineWidth = document.getElementById('lineWidth');
  lineWidth.addEventListener('input', (e) => {
    currentLineWidth = parseInt(e.target.value);
    document.querySelector('.line-width-value').textContent = currentLineWidth + 'px';
  });

  // Undo/Redo/Clear
  document.getElementById('undoBtn').addEventListener('click', undo);
  document.getElementById('redoBtn').addEventListener('click', redo);
  document.getElementById('clearBtn').addEventListener('click', clearCanvas);

  // Save/Cancel
  document.getElementById('saveAnnotateBtn').addEventListener('click', saveAnnotation);
  document.getElementById('cancelAnnotateBtn').addEventListener('click', async () => {
    console.log('Cancelling annotation, returning to create-bug...');
    
    // Set return flag without saving annotation
    await chrome.storage.local.set({ 
      returnToCreateBug: true
    });
    
    // Open create-bug page in a new tab. Use `new URL(..., location.href)` so
    // the path works whether Anti-Bug runs standalone or embedded as a subfolder.
    chrome.tabs.create({ url: new URL('create-bug.html', location.href).href });
    
    // Close annotation window
    setTimeout(() => {
      window.close();
    }, 100);
  });

  // Canvas events
  canvas.addEventListener('mousedown', handleMouseDown);
  canvas.addEventListener('mousemove', handleMouseMove);
  canvas.addEventListener('mouseup', handleMouseUp);
  canvas.addEventListener('mouseleave', handleMouseUp);
}

function handleMouseDown(e) {
  isDrawing = true;
  const rect = canvas.getBoundingClientRect();
  
  // Calculate scale to handle canvas vs display size differences
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  
  startX = (e.clientX - rect.left) * scaleX;
  startY = (e.clientY - rect.top) * scaleY;

  if (currentTool === 'pen') {
    ctx.beginPath();
    ctx.moveTo(startX, startY);
  } else if (currentTool === 'text') {
    addText(startX, startY);
  }
}

function handleMouseMove(e) {
  if (!isDrawing) return;

  const rect = canvas.getBoundingClientRect();
  
  // Calculate scale to handle canvas vs display size differences
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  
  const x = (e.clientX - rect.left) * scaleX;
  const y = (e.clientY - rect.top) * scaleY;

  ctx.strokeStyle = currentColor;
  ctx.lineWidth = currentLineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (currentTool === 'pen') {
    ctx.lineTo(x, y);
    ctx.stroke();
  } else if (currentTool === 'arrow' || currentTool === 'rectangle') {
    // Redraw for preview
    restoreState();
    
    if (currentTool === 'arrow') {
      drawArrow(startX, startY, x, y);
    } else if (currentTool === 'rectangle') {
      ctx.strokeRect(startX, startY, x - startX, y - startY);
    }
  }
}

function handleMouseUp(e) {
  if (!isDrawing) return;
  isDrawing = false;

  if (currentTool === 'arrow' || currentTool === 'rectangle') {
    const rect = canvas.getBoundingClientRect();
    
    // Calculate scale to handle canvas vs display size differences
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    if (currentTool === 'arrow') {
      drawArrow(startX, startY, x, y);
    } else if (currentTool === 'rectangle') {
      ctx.strokeRect(startX, startY, x - startX, y - startY);
    }
  }

  saveState();
}

function drawArrow(fromX, fromY, toX, toY) {
  const headLength = 15;
  const angle = Math.atan2(toY - fromY, toX - fromX);

  // Draw line
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();

  // Draw arrowhead
  ctx.beginPath();
  ctx.moveTo(toX, toY);
  ctx.lineTo(
    toX - headLength * Math.cos(angle - Math.PI / 6),
    toY - headLength * Math.sin(angle - Math.PI / 6)
  );
  ctx.moveTo(toX, toY);
  ctx.lineTo(
    toX - headLength * Math.cos(angle + Math.PI / 6),
    toY - headLength * Math.sin(angle + Math.PI / 6)
  );
  ctx.stroke();
}

function addText(x, y) {
  const text = prompt('Enter text:');
  if (!text) return;

  ctx.font = `${currentLineWidth * 8}px Arial`;
  ctx.fillStyle = currentColor;
  ctx.fillText(text, x, y);
  
  saveState();
}

function saveState() {
  historyStep++;
  
  // Remove any redo steps
  if (historyStep < history.length) {
    history.splice(historyStep);
  }

  // Save current state
  history.push(canvas.toDataURL());

  // Limit history to 50 states
  if (history.length > 50) {
    history.shift();
    historyStep--;
  }
}

function restoreState() {
  if (historyStep >= 0 && historyStep < history.length) {
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
    };
    img.src = history[historyStep];
  }
}

function undo() {
  if (historyStep > 0) {
    historyStep--;
    restoreState();
  }
}

function redo() {
  if (historyStep < history.length - 1) {
    historyStep++;
    restoreState();
  }
}

function clearCanvas() {
  if (!confirm('Clear all annotations?')) return;
  
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (screenshot) {
    ctx.drawImage(screenshot, 0, 0);
  }
  saveState();
}

async function saveAnnotation() {
  console.log('Saving annotation...');
  
  // Get annotated image as data URL
  const dataUrl = canvas.toDataURL('image/png');
  
  // Store in local storage AND set return flag
  await chrome.storage.local.set({ 
    annotatedScreenshot: dataUrl,
    returnToCreateBug: true
  });
  
  console.log('Annotation saved, reopening create-bug page...');
  
  // Open create-bug page in a new tab (see comment on Cancel button above).
  chrome.tabs.create({ url: new URL('create-bug.html', location.href).href });
  
  // Close annotation window after a moment
  setTimeout(() => {
    window.close();
  }, 100);
}
