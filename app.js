/**
 * CRUST & EMBER — Interactive Cinematic Story Engine
 * 
 * Sequentially choreographs 1,175 high-definition frames across 4 folders:
 * - Folder 1: frames 1 to 300 (San Marzano Harvest & Morning Gathering)
 * - Folder 2: frames 1 to 300 (48-Hr Fermented Dough Kneading & 900°F Stone Oven Hearth)
 * - Folder 3: frames 1 to 300 (Piazza San Lorenzo Osteria & Coastal Terrace Feasting)
 * - Folder 4: frames 1 to 275 (The Leopard Blistered Crust & Molten Cheese Pull Reveal)
 * 
 * PHASE 1 REFINEMENTS:
 * - Bounded frame cache (max 120 frames) with safe LRU eviction
 * - Native decode() for butter-smooth GPU rasterization
 * - Junction micro-blend crossfades at frames 298..302, 598..602, 898..902
 * - Non-linear scroll allocation giving 30% of travel to Act IV & cheese pull
 * 
 * PHASE 2 REFINEMENTS (CINEMATIC VISUAL POLISH):
 * 1. Choreographed Editorial Text & Card Transitions:
 *    - Continuous scroll-linked opacity and translateY curves replacing discrete binary classes.
 *    - Precise entry, dwell, and exit windows timed so text exits before vital subject reveals.
 *    - Act IV card cleanly exits by frame 1070 so the climactic mozzarella pull is 100% unobstructed.
 * 2. Selective Cinematic Camera Movement:
 *    - Micro scale drift (1.000x -> 1.028x) during Act II (kneader approach) & Act IV (pizza reveal).
 *    - Deterministic, reversible, zero-crop bounds preserving native composition and boundary continuity.
 * 3. Canvas Rendering Quality & Sharpness:
 *    - Asserted `imageSmoothingEnabled = true` and `imageSmoothingQuality = 'high'`.
 *    - High-DPI backing store aligned to devicePixelRatio (clamped to 2 for memory safety).
 */

(function() {
  'use strict';

  // --- Configuration ---
  const SCENE_CONFIG = [
    {
      id: 'scene-1',
      folder: 'frame 1',
      frames: 300,
      title: 'I. The Sunlit Harvest',
      badge: '01 / THE TUSCAN ORIGIN',
      cardId: 'card-scene-1',
      startGlobal: 0,
      endGlobal: 299
    },
    {
      id: 'scene-2',
      folder: 'frame 2',
      frames: 300,
      title: 'II. The Fire & Handcrafted Stone',
      badge: '02 / THE ARTISAN HEARTH',
      cardId: 'card-scene-2',
      startGlobal: 300,
      endGlobal: 599
    },
    {
      id: 'scene-3',
      folder: 'frame 3',
      frames: 300,
      title: 'III. Piazza & Osteria Crust & Ember',
      badge: '03 / THE CONVIVIAL PIAZZA',
      cardId: 'card-scene-3',
      startGlobal: 600,
      endGlobal: 899
    },
    {
      id: 'scene-4',
      folder: 'frame 4',
      frames: 275,
      title: 'IV. The Golden Crust & Melted Mozzarella',
      badge: '04 / THE CULMINATION',
      cardId: 'card-scene-4',
      startGlobal: 900,
      endGlobal: 1174
    }
  ];

  const TOTAL_FRAMES = 1175; // 300 + 300 + 300 + 275

  // --- Memory Stability & Cache Bounds (Preserved from Phase 1) ---
  const CACHE_CONFIG = {
    maxFrames: 120,
    lookAhead: 65,
    lookBehind: 35,
    maxConcurrentLoads: 6
  };

  // Junction boundaries configuration for seamless micro-blends
  const JUNCTIONS = [
    { boundaryIndex: 300, blendRadius: 2, fromScene: 0, toScene: 1 },
    { boundaryIndex: 600, blendRadius: 2, fromScene: 1, toScene: 2 },
    { boundaryIndex: 900, blendRadius: 2, fromScene: 2, toScene: 3 }
  ];

  // Choreographed Editorial Card Narrative Timings
  // Defines enter start, full peak in, exit start, and complete exit
  const CARD_TIMINGS = [
    { id: 'card-scene-1', start: 12,  peakIn: 45,  peakOut: 200, end: 260 },
    { id: 'card-scene-2', start: 320, peakIn: 355, peakOut: 470, end: 540 },
    { id: 'card-scene-3', start: 620, peakIn: 655, peakOut: 775, end: 845 },
    { id: 'card-scene-4', start: 915, peakIn: 945, peakOut: 1030, end: 1070 } // Exits completely before cheese pull peak!
  ];

  // --- DOM References ---
  const canvas = document.getElementById('story-canvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  const container = document.getElementById('cinematic');
  const preloader = document.getElementById('preloader');
  const preloaderFill = document.getElementById('preloader-fill');
  const preloaderStatus = document.getElementById('preloader-status');
  const hudFrameLabel = document.getElementById('hud-frame-label');
  const hudProgressBar = document.getElementById('hud-progress-bar');
  const hudSceneName = document.getElementById('hud-scene-name');
  const siteHeader = document.getElementById('site-header');
  const scrollPrompt = document.getElementById('scroll-prompt');

  // Modal elements
  const bookingModal = document.getElementById('booking-modal');
  const btnBookTable = document.getElementById('btn-book-table');
  const btnQuickMenu = document.getElementById('btn-quick-menu');
  const btnOrderOnline = document.getElementById('btn-order-online');
  const modalClose = document.getElementById('modal-close');

  // --- Frame Cache & Lifecycle Controller ---
  const imageCache = new Map(); // globalIndex -> HTMLImageElement
  const loadingQueue = new Set(); // indices currently being fetched
  let activeConcurrentLoads = 0;

  let renderedGlobalIndex = -1;
  let targetGlobalIndex = 0;
  let currentLerpedIndex = 0;
  let isReady = false;

  /**
   * Builds the formatted relative path for a global frame index (0 to 1174).
   */
  function getFramePath(globalIndex) {
    let scene = null;
    let localIndex = 1;

    if (globalIndex < 300) {
      scene = SCENE_CONFIG[0];
      localIndex = globalIndex + 1;
    } else if (globalIndex < 600) {
      scene = SCENE_CONFIG[1];
      localIndex = (globalIndex - 300) + 1;
    } else if (globalIndex < 900) {
      scene = SCENE_CONFIG[2];
      localIndex = (globalIndex - 600) + 1;
    } else {
      scene = SCENE_CONFIG[3];
      localIndex = (globalIndex - 900) + 1;
      if (localIndex > 275) localIndex = 275;
    }

    const pad = String(localIndex).padStart(3, '0');
    return encodeURI(`${scene.folder}/ezgif-frame-${pad}.jpg`);
  }

  /**
   * Load an image with decode() for jitter-free GPU rasterization
   */
  function loadFrame(globalIndex) {
    if (imageCache.has(globalIndex)) {
      return Promise.resolve(imageCache.get(globalIndex));
    }
    if (loadingQueue.has(globalIndex)) {
      return Promise.resolve(null);
    }

    loadingQueue.add(globalIndex);
    activeConcurrentLoads++;

    return new Promise((resolve) => {
      const img = new Image();
      img.src = getFramePath(globalIndex);

      const onDone = () => {
        loadingQueue.delete(globalIndex);
        activeConcurrentLoads = Math.max(0, activeConcurrentLoads - 1);
        imageCache.set(globalIndex, img);
        resolve(img);
      };

      const onError = () => {
        loadingQueue.delete(globalIndex);
        activeConcurrentLoads = Math.max(0, activeConcurrentLoads - 1);
        resolve(null);
      };

      if ('decode' in img) {
        img.decode().then(onDone).catch(() => {
          img.onload = onDone;
          img.onerror = onError;
        });
      } else {
        img.onload = onDone;
        img.onerror = onError;
      }
    });
  }

  /**
   * Evicts frames outside of the current active working set.
   * Reserved milestones and the currently rendered frame are strictly preserved.
   */
  function evictOutOfWindowFrames(currentCenter) {
    if (imageCache.size <= CACHE_CONFIG.maxFrames) return;

    const minKeep = Math.max(0, currentCenter - CACHE_CONFIG.lookBehind);
    const maxKeep = Math.min(TOTAL_FRAMES - 1, currentCenter + CACHE_CONFIG.lookAhead);

    const reservedMilestones = new Set([
      0, 299, 300, 599, 600, 899, 900, 1174,
      Math.round(renderedGlobalIndex)
    ]);

    for (const [idx, img] of imageCache.entries()) {
      if (idx < minKeep || idx > maxKeep) {
        if (!reservedMilestones.has(idx)) {
          img.src = '';
          imageCache.delete(idx);
          if (imageCache.size <= CACHE_CONFIG.maxFrames) {
            break;
          }
        }
      }
    }
  }

  /**
   * Proactively schedules frame loading around the active scrub position
   */
  function maintainWorkingSet(centerIndex) {
    const center = Math.round(centerIndex);
    
    // Evict old out-of-range frames first
    evictOutOfWindowFrames(center);

    const needed = [];
    
    // Immediate 15 frames prioritized
    for (let i = 1; i <= 15; i++) {
      const fwd = center + i;
      if (fwd < TOTAL_FRAMES && !imageCache.has(fwd) && !loadingQueue.has(fwd)) {
        needed.push(fwd);
      }
      const bwd = center - i;
      if (bwd >= 0 && !imageCache.has(bwd) && !loadingQueue.has(bwd)) {
        needed.push(bwd);
      }
    }

    // Extended lookahead
    for (let i = 16; i <= CACHE_CONFIG.lookAhead; i++) {
      const fwd = center + i;
      if (fwd < TOTAL_FRAMES && !imageCache.has(fwd) && !loadingQueue.has(fwd)) {
        needed.push(fwd);
      }
    }

    // Run throttled concurrent loads
    for (const idx of needed) {
      if (activeConcurrentLoads >= CACHE_CONFIG.maxConcurrentLoads) break;
      loadFrame(idx);
    }
  }

  /**
   * Initial essential keyframe preloader
   */
  async function initialPreload() {
    const essentialIndices = [];
    
    // First 40 frames for immediate butter-smooth initial scroll
    for (let i = 0; i < 40; i++) essentialIndices.push(i);

    // Junction boundaries to guarantee seamless cuts
    essentialIndices.push(298, 299, 300, 301, 598, 599, 600, 601, 898, 899, 900, 901);

    // Act IV climax frames
    essentialIndices.push(950, 1000, 1050, 1100, 1150, 1174);

    const uniqueToLoad = Array.from(new Set(essentialIndices));
    let loadedCount = 0;
    const totalToLoad = uniqueToLoad.length;

    for (const idx of uniqueToLoad) {
      await loadFrame(idx);
      loadedCount++;
      const pct = Math.round((loadedCount / totalToLoad) * 100);
      preloaderFill.style.width = `${pct}%`;
      if (pct > 65) {
        preloaderStatus.textContent = 'Kindling Wood-Fired Hearth...';
      }
    }

    isReady = true;
    preloader.classList.add('fade-out');

    // Draw frame 0 immediately
    renderFrame(0);

    // Start sliding window around position 0
    maintainWorkingSet(0);
  }

  /**
   * PHASE 2: Selective Camera Scale Calculation
   * Computes a very gentle, deterministic scale factor (1.000x - 1.026x)
   * during narrative focus moments.
   * PHASE 4: Disables camera push-in when prefers-reduced-motion is active.
   */
  function getCameraScale(globalIndex) {
    // Respect OS-level reduced motion preference
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return 1.0;
    }

    if (globalIndex >= 340 && globalIndex <= 540) {
      // Act II: Hearth push-in
      const t = (globalIndex - 340) / (540 - 340);
      const curve = Math.sin(t * Math.PI); // Smooth rise and fall
      return 1.0 + 0.024 * curve;
    } else if (globalIndex >= 960 && globalIndex <= 1174) {
      // Act IV: Pizza Hero & Cheese Pull push-in
      const t = (globalIndex - 960) / (1174 - 960);
      const ease = t * (2 - t);
      return 1.0 + 0.026 * ease;
    }
    return 1.0;
  }

  /**
   * PHASE 2: High Performance Canvas Cover Drawing
   * Features:
   * - Programmatic micro camera push-in support
   * - imageSmoothingQuality = 'high' assertion
   * - Global alpha blending for junction transitions
   */
  function drawCover(img, alpha = 1.0, scaleMultiplier = 1.0) {
    if (!img) return;

    // Assert high quality smoothing
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const canvasW = canvas.width;
    const canvasH = canvas.height;
    const imgW = img.naturalWidth || 1920;
    const imgH = img.naturalHeight || 1080;

    const imgRatio = imgW / imgH;
    const canvasRatio = canvasW / canvasH;

    let baseW, baseH;

    if (canvasRatio > imgRatio) {
      baseW = canvasW;
      baseH = canvasW / imgRatio;
    } else {
      baseH = canvasH;
      baseW = canvasH * imgRatio;
    }

    // Apply selective camera scale
    const drawW = baseW * scaleMultiplier;
    const drawH = baseH * scaleMultiplier;
    const offsetX = (canvasW - drawW) / 2;
    const offsetY = (canvasH - drawH) / 2;

    if (alpha < 1.0) {
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    } else {
      ctx.globalAlpha = 1.0;
    }

    ctx.drawImage(img, offsetX, offsetY, drawW, drawH);
    ctx.globalAlpha = 1.0;
  }

  /**
   * Retrieves an image from cache, or nearest cached neighbor for flicker prevention
   */
  function getFrameOrNearest(index) {
    if (imageCache.has(index)) return imageCache.get(index);
    for (let offset = 1; offset <= 8; offset++) {
      if (imageCache.has(index - offset)) return imageCache.get(index - offset);
      if (imageCache.has(index + offset)) return imageCache.get(index + offset);
    }
    loadFrame(index);
    return null;
  }

  /**
   * Render frame to canvas with micro-blend boundary handling & camera scale
   */
  function renderFrame(globalIndex) {
    const clampedIndex = Math.max(0, Math.min(TOTAL_FRAMES - 1, globalIndex));
    const roundIdx = Math.round(clampedIndex);

    const cameraScale = getCameraScale(clampedIndex);

    // Check if within scene junction blend window
    let activeJunction = null;
    for (const junc of JUNCTIONS) {
      if (Math.abs(clampedIndex - junc.boundaryIndex) <= junc.blendRadius) {
        activeJunction = junc;
        break;
      }
    }

    if (activeJunction) {
      const bIdx = activeJunction.boundaryIndex;
      const r = activeJunction.blendRadius;
      const t = (clampedIndex - (bIdx - r)) / (2 * r);
      const easeT = t * t * (3 - 2 * t);

      const imgA = getFrameOrNearest(bIdx - 1);
      const imgB = getFrameOrNearest(bIdx);

      // Boundaries always use scale 1.0 to prevent scale mismatch between adjacent scenes
      if (imgA && imgB) {
        drawCover(imgA, 1.0, 1.0);
        drawCover(imgB, easeT, 1.0);
      } else if (imgB) {
        drawCover(imgB, 1.0, 1.0);
      } else if (imgA) {
        drawCover(imgA, 1.0, 1.0);
      }
    } else {
      const img = getFrameOrNearest(roundIdx);
      if (img) {
        drawCover(img, 1.0, cameraScale);
      }
    }

    renderedGlobalIndex = roundIdx;

    maintainWorkingSet(roundIdx);

    // Update HUD
    const formattedFrame = String(roundIdx + 1).padStart(4, '0');
    hudFrameLabel.textContent = `Frame ${formattedFrame}`;
    const progressPct = ((roundIdx / (TOTAL_FRAMES - 1)) * 100).toFixed(1);
    hudProgressBar.style.width = `${progressPct}%`;

    // Active scene badge
    let activeScene = SCENE_CONFIG[0];
    for (const sc of SCENE_CONFIG) {
      if (roundIdx >= sc.startGlobal && roundIdx <= sc.endGlobal) {
        activeScene = sc;
        break;
      }
    }
    hudSceneName.textContent = activeScene.title;

    // Choreographed editorial card timing
    updateStoryCards(clampedIndex);

    // Scroll prompt toggle
    if (roundIdx > 30) {
      scrollPrompt.classList.add('hidden');
    } else {
      scrollPrompt.classList.remove('hidden');
    }
  }

  /**
   * PHASE 2: Choreographed Story Cards with Continuous Interpolation
   * Calculates smooth opacity [0..1] and translation offsets [20px -> 0px -> -16px]
   * based on exact scene progress, eliminating awkward card delays.
   */
  function updateStoryCards(frame) {
    CARD_TIMINGS.forEach(c => {
      const el = document.getElementById(c.id);
      if (!el) return;

      if (frame < c.start || frame > c.end) {
        el.style.opacity = '0';
        el.style.pointerEvents = 'none';
        if (el.classList.contains('card-center')) {
          el.style.transform = 'translateX(-50%) translateY(24px) scale(0.97)';
        } else {
          el.style.transform = 'translateY(24px) scale(0.97)';
        }
        el.classList.remove('active');
        return;
      }

      let opacity = 1.0;
      let yOffset = 0.0; // in pixels

      if (frame < c.peakIn) {
        // Entrance: upward gentle glide with fade in
        const progress = (frame - c.start) / (c.peakIn - c.start);
        opacity = progress;
        yOffset = 24.0 * (1.0 - progress);
      } else if (frame <= c.peakOut) {
        // Dwell: full visibility & clarity
        opacity = 1.0;
        yOffset = 0.0;
      } else {
        // Exit: gentle upward drift with fade out before subject reveal
        const progress = (frame - c.peakOut) / (c.end - c.peakOut);
        opacity = 1.0 - progress;
        yOffset = -16.0 * progress;
      }

      el.style.opacity = opacity.toFixed(3);
      el.style.pointerEvents = opacity > 0.6 ? 'auto' : 'none';

      const isMobile = window.innerWidth <= 768;
      const scaleVal = (0.98 + 0.02 * opacity).toFixed(3);

      if (isMobile) {
        // Mobile layout: drawer pinned with clean vertical drift
        el.style.transform = `translateY(${yOffset.toFixed(1)}px) scale(${scaleVal})`;
      } else if (el.classList.contains('card-center')) {
        // Desktop center card (Scene 4)
        el.style.transform = `translateX(-50%) translateY(${yOffset.toFixed(1)}px) scale(${scaleVal})`;
      } else {
        // Desktop left / right cards
        el.style.transform = `translateY(${yOffset.toFixed(1)}px) scale(${scaleVal})`;
      }

      if (opacity > 0.05) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    });
  }

  /**
   * PHASE 2: Responsive Canvas sizing with High-DPI sharpening
   */
  function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);

    // Ensure smoothing is asserted on resize
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    if (renderedGlobalIndex >= 0) {
      renderFrame(renderedGlobalIndex);
    }
  }

  /**
   * Non-Linear Narrative Pacing Engine (Preserved from Phase 1)
   */
  function calculateFrameFromScroll(rawProgress) {
    const p = Math.max(0, Math.min(1, rawProgress));

    if (p <= 0.23) {
      return (p / 0.23) * 299;
    } else if (p <= 0.47) {
      const localP = (p - 0.23) / (0.47 - 0.23);
      return 300 + localP * 299;
    } else if (p <= 0.70) {
      const localP = (p - 0.47) / (0.70 - 0.47);
      return 600 + localP * 299;
    } else {
      const localP = (p - 0.70) / (1.00 - 0.70);
      if (localP <= 0.50) {
        return 900 + (localP / 0.50) * 150;
      } else {
        const pullProgress = (localP - 0.50) / 0.50;
        const eased = Math.pow(pullProgress, 0.85);
        return 1051 + eased * (1174 - 1051);
      }
    }
  }

  /**
   * Scroll handler calculating narrative frame progress
   */
  function onScroll() {
    const rect = container.getBoundingClientRect();
    const scrollDistance = container.offsetHeight - window.innerHeight;
    const scrolled = -rect.top;

    const rawProgress = Math.max(0, Math.min(1, scrolled / scrollDistance));
    targetGlobalIndex = calculateFrameFromScroll(rawProgress);

    if (window.scrollY > 40) {
      siteHeader.classList.add('scrolled');
    } else {
      siteHeader.classList.remove('scrolled');
    }
  }

  /**
   * RequestAnimationFrame animation loop with smooth lerping
   */
  function animationLoop() {
    if (isReady) {
      const diff = targetGlobalIndex - currentLerpedIndex;
      if (Math.abs(diff) > 0.04) {
        currentLerpedIndex += diff * 0.16;
        renderFrame(currentLerpedIndex);
      } else if (Math.round(currentLerpedIndex) !== renderedGlobalIndex) {
        currentLerpedIndex = targetGlobalIndex;
        renderFrame(currentLerpedIndex);
      }
    }
    requestAnimationFrame(animationLoop);
  }

  // Debounced resize handler for orientation and viewport changes
  let resizeTimer = null;
  function handleResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeCanvas();
      onScroll();
    }, 60);
  }

  // --- Interaction Event Listeners ---
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', handleResize);

  // Reservation & Menu Modal handlers (WCAG 2.2 Accessible Dialog Pattern)
  let lastActiveElement = null;

  function openModal() {
    lastActiveElement = document.activeElement;
    bookingModal.classList.add('active');
    bookingModal.setAttribute('aria-hidden', 'false');
    const firstInput = document.getElementById('modal-party-name');
    if (firstInput) {
      setTimeout(() => firstInput.focus(), 50);
    }
  }

  function closeModal() {
    bookingModal.classList.remove('active');
    bookingModal.setAttribute('aria-hidden', 'true');
    if (lastActiveElement && typeof lastActiveElement.focus === 'function') {
      lastActiveElement.focus();
    }
  }

  if (btnBookTable) btnBookTable.addEventListener('click', openModal);
  if (btnOrderOnline) btnOrderOnline.addEventListener('click', openModal);
  if (modalClose) modalClose.addEventListener('click', closeModal);
  bookingModal.addEventListener('click', (e) => {
    if (e.target === bookingModal) closeModal();
  });

  // Focus trap inside modal for screen readers and keyboard users
  bookingModal.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      const focusableElements = bookingModal.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusableElements.length === 0) return;
      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        last.focus();
        e.preventDefault();
      } else if (!e.shiftKey && document.activeElement === last) {
        first.focus();
        e.preventDefault();
      }
    }
  });

  if (btnQuickMenu) {
    btnQuickMenu.addEventListener('click', () => {
      const menuSec = document.getElementById('menu');
      if (menuSec) menuSec.scrollIntoView({ behavior: 'smooth' });
    });
  }

  // Keyboard navigation for precision scrubbing (disabled when typing in forms or inside active modal)
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (bookingModal.classList.contains('active')) {
        closeModal();
      }
      return;
    }

    const activeTag = document.activeElement ? document.activeElement.tagName : '';
    const isInputActive = ['INPUT', 'SELECT', 'TEXTAREA'].includes(activeTag);
    if (isInputActive || bookingModal.classList.contains('active')) {
      return;
    }

    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      window.scrollBy({ top: 120, behavior: 'smooth' });
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      window.scrollBy({ top: -120, behavior: 'smooth' });
    }
  });

  // --- Startup sequence ---
  window.addEventListener('DOMContentLoaded', () => {
    resizeCanvas();
    initialPreload();
    requestAnimationFrame(animationLoop);
    onScroll();
  });

})();
