// High-Performance Architectural Frame Sequence Engine (1,601 High-Density Frames)
const frameCount = 1601;
const canvas = document.getElementById('canvas');
let context = null;
if (canvas) {
  try {
    context = canvas.getContext('2d', { alpha: false }) || canvas.getContext('2d');
  } catch (e) {
    context = canvas.getContext('2d');
  }
}

const currentFramePath = (index) =>
  `frames/frame_${index.toString().padStart(4, '0')}.webp`;

const images = new Array(frameCount);
const isLoaded = new Uint8Array(frameCount);
const enqueued = new Uint8Array(frameCount);

let currentProgress = 0;
let targetProgress = 0;
let lastRenderedIndex = -1;
let lastNearestIndex = -1;
let currentlyDrawnFrameIndex = -1;
let scrollVelocity = 0;
let lastProgress = 0;
let lastProgressTime = performance.now();

// Precalculated dimensions for max render performance
let canvasWidth = 0;
let canvasHeight = 0;
let drawWidth = 0;
let drawHeight = 0;
let offsetX = 0;
let offsetY = 0;
const imgRatio = 16 / 9;

// Cached DOM element references to eliminate high-frequency layout queries
const heroEl = document.getElementById('hero');
const logoEl = document.getElementById('heroLogo');
const houseTextEl = document.getElementById('heroHouseText');
const navEl = document.getElementById('topNav');
const expertSectionEl = document.getElementById('expert');
let portraitImgEl = null;

let cachedHeroScrollableDistance = 1;

function resize() {
  if (!canvas || !context) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  // Cap dimensions to 1920x1080 (native WebP resolution) to eliminate heavy GPU fill-rate overhead
  canvasWidth = Math.min(1920, Math.round(window.innerWidth * dpr));
  canvasHeight = Math.min(1080, Math.round(window.innerHeight * dpr));

  if (canvas.width !== canvasWidth || canvas.height !== canvasHeight) {
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'low';

  const cRatio = canvasWidth / canvasHeight;
  if (cRatio > imgRatio) {
    drawWidth = canvasWidth;
    drawHeight = Math.round(canvasWidth / imgRatio);
    offsetX = 0;
    offsetY = Math.round((canvasHeight - drawHeight) / 2);
  } else {
    drawHeight = canvasHeight;
    drawWidth = Math.round(canvasHeight * imgRatio);
    offsetX = Math.round((canvasWidth - drawWidth) / 2);
    offsetY = 0;
  }

  const heroH = heroEl ? heroEl.offsetHeight : (window.innerHeight * 6);
  cachedHeroScrollableDistance = Math.max(1, heroH - window.innerHeight);

  lastRenderedIndex = -1;
  currentlyDrawnFrameIndex = -1;
  render(currentProgress);
}

// Guard against mobile address bar show/hide resize thrashing
let lastInnerWidth = window.innerWidth;
let lastInnerHeight = window.innerHeight;
function handleResize() {
  const newW = window.innerWidth;
  const newH = window.innerHeight;
  // If only height changed by less than 120px, it's just mobile address bar toggle
  if (newW === lastInnerWidth && Math.abs(newH - lastInnerHeight) < 120) {
    return;
  }
  lastInnerWidth = newW;
  lastInnerHeight = newH;
  resize();
}

window.addEventListener('resize', handleResize, { passive: true });
resize();

// Fast nearest loaded frame finder (prioritizes backwards search to eliminate forward/backward time-travel jumps)
function getNearestLoadedFrameIndex(targetIdx) {
  if (isLoaded[targetIdx]) return targetIdx;

  // Search backward first (frames already viewed), then forward
  for (let r = 1; r <= 30; r++) {
    const left = targetIdx - r;
    if (left >= 0 && isLoaded[left]) return left;
    const right = targetIdx + r;
    if (right < frameCount && isLoaded[right]) return right;
  }

  // If no neighboring frame is loaded yet, keep currently displayed frame to prevent flashing
  if (currentlyDrawnFrameIndex >= 0 && isLoaded[currentlyDrawnFrameIndex]) {
    return currentlyDrawnFrameIndex;
  }

  return isLoaded[0] ? 0 : -1;
}

function render(p) {
  if (!canvas || !context) return;
  const targetIndex = Math.min(
    frameCount - 1,
    Math.max(0, Math.round(p * (frameCount - 1)))
  );

  const bestIdx = getNearestLoadedFrameIndex(targetIndex);
  if (bestIdx < 0 || !images[bestIdx]) return;

  // Avoid re-drawing if the canvas already displays this exact image
  if (bestIdx === currentlyDrawnFrameIndex) return;

  context.drawImage(images[bestIdx], offsetX, offsetY, drawWidth, drawHeight);
  currentlyDrawnFrameIndex = bestIdx;
  lastRenderedIndex = targetIndex;
}

// High-Throughput Streamlined Frame Streaming Engine
const queue = [];
let activeLoads = 0;
const MAX_CONCURRENT = 8; // Optimal HTTP/2 multiplexed streams

function enqueueFrame(idx) {
  if (idx < 0 || idx >= frameCount || isLoaded[idx] || enqueued[idx]) return;
  enqueued[idx] = 1;
  queue.push(idx);
}

let lastPrioritizedIndex = -1;
function prioritizeAround(currentIndex, direction = 1) {
  if (Math.abs(currentIndex - lastPrioritizedIndex) < 2) return;
  lastPrioritizedIndex = currentIndex;

  const lookAhead = 45;
  const lookBehind = 10;
  const urgent = [];

  if (direction >= 0) {
    for (let i = 0; i <= lookAhead; i++) {
      const idx = currentIndex + i;
      if (idx < frameCount && !isLoaded[idx]) {
        urgent.push(idx);
        enqueued[idx] = 1;
      }
    }
    for (let i = 1; i <= lookBehind; i++) {
      const idx = currentIndex - i;
      if (idx >= 0 && !isLoaded[idx]) {
        urgent.push(idx);
        enqueued[idx] = 1;
      }
    }
  } else {
    for (let i = 0; i <= lookAhead; i++) {
      const idx = currentIndex - i;
      if (idx >= 0 && !isLoaded[idx]) {
        urgent.push(idx);
        enqueued[idx] = 1;
      }
    }
    for (let i = 1; i <= lookBehind; i++) {
      const idx = currentIndex + i;
      if (idx < frameCount && !isLoaded[idx]) {
        urgent.push(idx);
        enqueued[idx] = 1;
      }
    }
  }

  // Prepend urgent unloaded frames to the head of the queue without duplicates
  if (urgent.length > 0) {
    const urgentSet = new Set(urgent);
    const remaining = queue.filter(idx => !urgentSet.has(idx) && !isLoaded[idx]);
    queue.length = 0;
    queue.push(...urgent, ...remaining);
  }

  processQueue();
}

const MIN_INITIAL_BUFFER = 15; // Buffer 15 continuous opening frames before triggering slat split
let initialBufferLoaded = 0;
let initialBufferReady = false;

const hasCreateImageBitmap = typeof window.createImageBitmap === 'function';

function processQueue() {
  while (activeLoads < MAX_CONCURRENT && queue.length > 0) {
    const idx = queue.shift();
    if (isLoaded[idx]) {
      continue;
    }

    activeLoads++;
    const url = currentFramePath(idx + 1);

    const onFinish = (drawable) => {
      if (drawable) {
        images[idx] = drawable;
        isLoaded[idx] = 1;
      }
      activeLoads--;

      if (!initialBufferReady) {
        initialBufferLoaded++;
        if (idx === 0 && currentlyDrawnFrameIndex < 0) {
          render(0);
        }
        if (initialBufferLoaded >= MIN_INITIAL_BUFFER) {
          initialBufferReady = true;
          triggerLoaderSplit();
        }
      }

      // Keep downloads moving; frame rendering is strictly managed by mainLoop RAF
      processQueue();
    };

    if (hasCreateImageBitmap) {
      fetch(url)
        .then(res => {
          if (!res.ok) throw new Error('Fetch failed');
          return res.blob();
        })
        .then(blob => createImageBitmap(blob))
        .then(bitmap => onFinish(bitmap))
        .catch(() => {
          // Transparent fallback to HTMLImageElement
          const img = new Image();
          img.onload = () => onFinish(img);
          img.onerror = () => onFinish(null);
          img.src = url;
        });
    } else {
      const img = new Image();
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        onFinish(img);
      };
      img.onload = done;
      img.onerror = () => onFinish(null);
      img.src = url;
      if ('decode' in img) {
        img.decode().then(done).catch(done);
      }
    }
  }
}

// 120fps Pure White Screen Multi-Part Horizontal & Vertical Split Controller
let loaderTriggered = false;
function triggerLoaderSplit() {
  if (loaderTriggered) return;
  loaderTriggered = true;
  
  const loader = document.getElementById('whiteLoader');
  if (loader) loader.classList.add('split');
  document.body.classList.add('hero-loaded');
  
  setTimeout(() => {
    if (loader) {
      loader.classList.add('loader-done');
      loader.style.display = 'none';
    }
  }, 2200);
}

// Fallback trigger so slower networks never get stuck
setTimeout(() => {
  if (!loaderTriggered) {
    triggerLoaderSplit();
  }
}, 2000);

// Dense contiguous opening preload: guaranteed zero-lag initial scroll experience
function initPreloader() {
  // Pre-load frames 0 to 45 in unbroken consecutive order so initial scroll never encounters missing frames
  const initialSequence = [];
  for (let i = 0; i <= 45; i++) {
    initialSequence.push(i);
  }
  // Followed by distributed skeleton across the rest of the hero sequence
  for (let i = 50; i <= 240; i += 6) {
    initialSequence.push(i);
  }

  for (const idx of initialSequence) {
    if (idx < frameCount && !isLoaded[idx]) {
      enqueued[idx] = 1;
      queue.push(idx);
    }
  }

  processQueue();
}

initPreloader();

// Calculate scroll progress exclusively across the Hero sequence track
function calculateHeroProgress(scrollY) {
  if (cachedHeroScrollableDistance <= 0) return 0;
  return Math.min(1, Math.max(0, scrollY / cachedHeroScrollableDistance));
}

// High-Performance Unified Scroll Engine (Mobile Touch-Optimized + Desktop Momentum)
let lenis = null;
const isTouchDevice = ('ontouchstart' in window && !window.matchMedia('(pointer: fine)').matches) || (window.innerWidth <= 768);

function onScrollUpdate(scrollY) {
  targetProgress = calculateHeroProgress(scrollY);
  
  const now = performance.now();
  const dt = Math.max(1, now - lastProgressTime);
  const dp = targetProgress - lastProgress;
  scrollVelocity = dp / dt;
  lastProgress = targetProgress;
  lastProgressTime = now;

  const currentIdx = Math.floor(targetProgress * (frameCount - 1));
  prioritizeAround(currentIdx, scrollVelocity >= 0 ? 1 : -1);
}

// Enable Lenis with smoothWheel for mouse and trackpad devices
if (typeof Lenis !== 'undefined') {
  lenis = new Lenis({
    duration: 0.8,
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    orientation: 'vertical',
    gestureOrientation: 'vertical',
    smoothWheel: true,
    wheelMultiplier: 1.0,
    syncTouch: false,
    infinite: false,
  });

  lenis.on('scroll', (e) => {
    onScrollUpdate(e.scroll);
  });
}

// Native scroll listener as universal safety/fallback
window.addEventListener('scroll', () => {
  if (!lenis || isTouchDevice) {
    onScrollUpdate(window.scrollY || document.documentElement.scrollTop || 0);
  }
}, { passive: true });

function mainLoop(time) {
  if (lenis) {
    lenis.raf(time);
  }

  const currentScroll = (lenis && typeof lenis.scroll === 'number')
    ? lenis.scroll
    : (window.scrollY || document.documentElement.scrollTop || 0);

  targetProgress = calculateHeroProgress(currentScroll);

  // High-precision smooth exponential dampening (frame-rate independent 60/120fps glide)
  const diff = targetProgress - currentProgress;
  if (Math.abs(diff) < 0.00001) {
    currentProgress = targetProgress;
  } else {
    currentProgress += diff * 0.16;
  }

  render(currentProgress);

  updateHeroLogo(currentScroll);
  updateHeroHouseText(currentScroll);
  updateHeroBlur(currentScroll);
  updateHeroNav(currentScroll);
  updateExpertParallax(currentScroll);

  requestAnimationFrame(mainLoop);
}
requestAnimationFrame(mainLoop);

// Handle entrance animation completion before scroll take-over
let entranceFinished = false;
setTimeout(() => {
  entranceFinished = true;
  if (logoEl) logoEl.style.transition = 'none';
}, 2200);

// Continuous scroll upward movement for hero logo
let lastLogoTranslateY = null;
let lastLogoOpacity = null;
function updateHeroLogo(scrollY) {
  if (!logoEl) return;
  if (!entranceFinished && scrollY === 0) return;
  
  if (!entranceFinished && scrollY > 0) {
    entranceFinished = true;
    logoEl.style.transition = 'none';
  }
  
  const translateY = Math.round(-scrollY * 1.4);
  const opacity = Math.max(0, +(1 - scrollY / 450).toFixed(3));
  
  if (translateY !== lastLogoTranslateY || opacity !== lastLogoOpacity) {
    lastLogoTranslateY = translateY;
    lastLogoOpacity = opacity;
    logoEl.style.transform = `translate3d(0px, ${translateY}px, 0px)`;
    logoEl.style.opacity = `${opacity}`;
    logoEl.style.pointerEvents = opacity <= 0.05 ? 'none' : 'auto';
  }
}

// Continuous scroll trigger animation for house showcase text
let lastHouseTranslateY = null;
let lastHouseOpacity = null;
function updateHeroHouseText(scrollY) {
  if (!houseTextEl) return;
  
  const heroHeight = cachedHeroScrollableDistance;
  const progress = Math.min(1, Math.max(0, scrollY / heroHeight));
  
  const startProgress = 0.20;
  const peakProgress = 0.35;
  const fadeOutProgress = 0.54;
  const endProgress = 0.68;
  
  if (progress >= startProgress && progress <= endProgress) {
    let opacity = 0;
    if (progress < peakProgress) {
      opacity = (progress - startProgress) / (peakProgress - startProgress);
    } else if (progress <= fadeOutProgress) {
      opacity = 1;
    } else {
      opacity = Math.max(0, 1 - (progress - fadeOutProgress) / (endProgress - fadeOutProgress));
    }
    
    const relativeOffset = (progress - startProgress) * heroHeight;
    const translateY = Math.round(-relativeOffset * 0.45);
    const roundedOpacity = +opacity.toFixed(3);
    
    if (translateY !== lastHouseTranslateY || roundedOpacity !== lastHouseOpacity) {
      lastHouseTranslateY = translateY;
      lastHouseOpacity = roundedOpacity;
      houseTextEl.style.transform = `translate3d(0px, ${translateY}px, 0px)`;
      houseTextEl.style.opacity = `${roundedOpacity}`;
      houseTextEl.style.pointerEvents = roundedOpacity <= 0.05 ? 'none' : 'auto';
    }
  } else {
    if (lastHouseOpacity !== 0) {
      lastHouseOpacity = 0;
      houseTextEl.style.opacity = '0';
      houseTextEl.style.pointerEvents = 'none';
    }
  }
}

// Dynamic blur on the hero section: cached to prevent unnecessary GPU style recalculations
let lastBlurAmount = -1;
function updateHeroBlur(scrollY) {
  if (!heroEl || !canvas) return;
  
  const heroHeight = cachedHeroScrollableDistance;
  const startBlur = heroHeight - 50;
  const endBlur = heroHeight + window.innerHeight * 0.6;
  
  if (scrollY > startBlur) {
    const progress = Math.min(1, Math.max(0, (scrollY - startBlur) / (endBlur - startBlur)));
    const blurAmount = Math.round(progress * 20);
    if (blurAmount !== lastBlurAmount) {
      lastBlurAmount = blurAmount;
      canvas.style.filter = blurAmount > 0 ? `blur(${blurAmount}px)` : 'none';
    }
  } else {
    if (lastBlurAmount !== 0) {
      lastBlurAmount = 0;
      canvas.style.filter = 'none';
    }
  }
}

// Top Nav visibility: only stays active and visible inside the hero section
let lastNavOpacity = null;
function updateHeroNav(scrollY) {
  if (!navEl) return;
  const heroHeight = cachedHeroScrollableDistance;
  
  if (scrollY > heroHeight - 120) {
    const opacity = Math.max(0, +(1 - (scrollY - (heroHeight - 120)) / 120).toFixed(2));
    if (opacity !== lastNavOpacity) {
      lastNavOpacity = opacity;
      navEl.style.opacity = `${opacity}`;
      navEl.style.pointerEvents = opacity <= 0.05 ? 'none' : 'auto';
    }
  } else {
    if (document.body.classList.contains('hero-loaded') && lastNavOpacity !== 1) {
      lastNavOpacity = 1;
      navEl.style.opacity = '1';
      navEl.style.pointerEvents = 'auto';
    }
  }
}

// Eleanor Sterling Section Scroll Parallax Page Transition
let lastParallaxTranslateY = null;
function updateExpertParallax(scrollY) {
  if (!expertSectionEl) return;
  const heroH = heroEl ? heroEl.offsetHeight - window.innerHeight : 2000;
  // While scrolling within hero section, bypass getBoundingClientRect entirely to avoid reflow
  if (scrollY < heroH - 200) return;

  if (!portraitImgEl) {
    portraitImgEl = document.querySelector('.expert-portrait-img');
    if (!portraitImgEl) return;
  }

  const rect = expertSectionEl.getBoundingClientRect();
  const windowHeight = window.innerHeight;
  
  if (rect.top < windowHeight && rect.bottom > 0) {
    const progress = (windowHeight - rect.top) / (windowHeight + rect.height);
    const translateY = Math.round((progress - 0.5) * -36);
    if (translateY !== lastParallaxTranslateY) {
      lastParallaxTranslateY = translateY;
      portraitImgEl.style.transform = `scale(1.04) translate3d(0, ${translateY}px, 0)`;
    }
  }
}

// Mobile Navigation Menu Toggle Handler
function initMobileMenu() {
  const toggleBtn = document.getElementById('mobileMenuToggle');
  const mobileMenu = document.getElementById('mobileMenu');
  const mobileLinks = document.querySelectorAll('.mobile-nav-link');
  
  if (!toggleBtn || !mobileMenu) return;

  function toggleMenu(open) {
    const isOpen = open !== undefined ? open : !mobileMenu.classList.contains('open');
    if (isOpen) {
      mobileMenu.classList.add('open');
      toggleBtn.setAttribute('aria-expanded', 'true');
      const icon = toggleBtn.querySelector('.menu-icon');
      if (icon) icon.textContent = 'close';
    } else {
      mobileMenu.classList.remove('open');
      toggleBtn.setAttribute('aria-expanded', 'false');
      const icon = toggleBtn.querySelector('.menu-icon');
      if (icon) icon.textContent = 'menu';
    }
  }

  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMenu();
  });

  mobileLinks.forEach(link => {
    link.addEventListener('click', () => {
      toggleMenu(false);
    });
  });

  document.addEventListener('click', (e) => {
    if (mobileMenu.classList.contains('open') && !mobileMenu.contains(e.target) && !toggleBtn.contains(e.target)) {
      toggleMenu(false);
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initMobileMenu);
} else {
  initMobileMenu();
}
