// High-Performance Architectural Frame Sequence Engine (1,601 High-Density Frames)
const frameCount = 1601;
const canvas = document.getElementById('canvas');
let context = null;
if (canvas) {
  try {
    context = canvas.getContext('2d', { alpha: false, desynchronized: true }) || canvas.getContext('2d');
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

function resize() {
  if (!canvas || !context) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  canvasWidth = Math.round(window.innerWidth * dpr);
  canvasHeight = Math.round(window.innerHeight * dpr);

  if (canvas.width !== canvasWidth || canvas.height !== canvasHeight) {
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'medium';

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

  lastRenderedIndex = -1;
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

// Cached DOM element references to eliminate high-frequency layout queries
const heroEl = document.getElementById('hero');
const logoEl = document.getElementById('heroLogo');
const houseTextEl = document.getElementById('heroHouseText');
const navEl = document.getElementById('topNav');
const expertSectionEl = document.getElementById('expert');
let portraitImgEl = null;

// Fast nearest loaded frame finder (guarantees zero flicker or blank frames with zero latency)
let currentlyDrawnFrameIndex = -1;

function getNearestLoadedFrameIndex(targetIdx) {
  if (isLoaded[targetIdx]) return targetIdx;

  // Search outward from targetIdx for the closest loaded frame
  for (let r = 1; r < frameCount; r++) {
    const left = targetIdx - r;
    if (left >= 0 && isLoaded[left]) return left;
    const right = targetIdx + r;
    if (right < frameCount && isLoaded[right]) return right;
    if (left < 0 && right >= frameCount) break;
  }
  return -1;
}

function render(p) {
  if (!canvas || !context) return;
  const targetIndex = Math.min(
    frameCount - 1,
    Math.max(0, Math.floor(p * (frameCount - 1)))
  );

  const bestIdx = getNearestLoadedFrameIndex(targetIndex);
  if (bestIdx < 0 || !images[bestIdx]) return;

  // Avoid re-drawing if the canvas already displays this exact image
  if (bestIdx === currentlyDrawnFrameIndex) return;

  context.drawImage(images[bestIdx], offsetX, offsetY, drawWidth, drawHeight);
  currentlyDrawnFrameIndex = bestIdx;
  lastRenderedIndex = targetIndex;
}

// Directional & Predictive Asynchronous Frame Streaming
const queue = [];
let activeLoads = 0;
const MAX_CONCURRENT = 6; // 6 concurrent HTTP/2 streams for rapid preloading without socket stalls

function enqueueFrame(idx, highPriority = false) {
  if (idx < 0 || idx >= frameCount || isLoaded[idx]) return;
  if (enqueued[idx]) {
    if (highPriority) {
      const existingPos = queue.indexOf(idx);
      if (existingPos > 0) {
        queue.splice(existingPos, 1);
        queue.unshift(idx);
      }
    }
    return;
  }
  
  enqueued[idx] = 1;
  if (highPriority) {
    queue.unshift(idx);
  } else {
    queue.push(idx);
  }
}

let lastPrioritizedIndex = -1;
function prioritizeAround(currentIndex, direction = 1) {
  if (Math.abs(currentIndex - lastPrioritizedIndex) < 1) return;
  lastPrioritizedIndex = currentIndex;

  const lookAhead = 35;
  const lookBehind = 8;

  if (direction >= 0) {
    // Unshift in reverse so currentIndex and immediate next frames are at the HEAD of the queue
    for (let i = lookAhead; i >= 0; i--) {
      enqueueFrame(currentIndex + i, true);
    }
    for (let i = 1; i <= lookBehind; i++) {
      enqueueFrame(currentIndex - i, false);
    }
  } else {
    for (let i = lookAhead; i >= 0; i--) {
      enqueueFrame(currentIndex - i, true);
    }
    for (let i = 1; i <= lookBehind; i++) {
      enqueueFrame(currentIndex + i, false);
    }
  }
  processQueue();
}

function processQueue() {
  while (activeLoads < MAX_CONCURRENT && queue.length > 0) {
    const idx = queue.shift();
    if (isLoaded[idx]) {
      continue;
    }

    activeLoads++;
    const img = new Image();
    let finished = false;

    const onFinish = () => {
      if (finished) return;
      finished = true;
      images[idx] = img;
      isLoaded[idx] = 1;
      activeLoads--;

      if (idx === 0 || lastRenderedIndex === -1) {
        triggerLoaderSplit();
      }
      render(currentProgress);
      processQueue();
    };

    img.onload = onFinish;
    img.onerror = onFinish;
    img.src = currentFramePath(idx + 1);

    if ('decode' in img) {
      img.decode().then(onFinish).catch(onFinish);
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

// Fallback trigger in case frame 0 takes longer than expected to download
window.addEventListener('DOMContentLoaded', () => {
  setTimeout(triggerLoaderSplit, 600);
});
setTimeout(triggerLoaderSplit, 800);

// Intelligent Preload: opening buffer for instant, butter-smooth initial scrubbing
function initPreloader() {
  // Preload frame 0 with top priority
  enqueueFrame(0, true);
  // Preload opening 35 frames buffer (1..34) for immediate 60-120fps scrubbing from frame 0
  for (let i = 1; i < Math.min(35, frameCount); i++) {
    enqueueFrame(i, false);
  }
  processQueue();
}

initPreloader();

// Calculate scroll progress exclusively across the Hero sequence track
function calculateHeroProgress(scrollY) {
  if (!heroEl) {
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    return maxScroll > 0 ? scrollY / maxScroll : 0;
  }
  const heroScrollableDistance = heroEl.offsetHeight - window.innerHeight;
  if (heroScrollableDistance <= 0) return 0;
  return Math.min(1, Math.max(0, scrollY / heroScrollableDistance));
}

// Smooth Momentum Scroll Engine (Lenis)
let lenis = null;

if (typeof Lenis !== 'undefined') {
  lenis = new Lenis({
    duration: 1.0,
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    orientation: 'vertical',
    gestureOrientation: 'vertical',
    smoothWheel: true,
    wheelMultiplier: 1.0,
    touchMultiplier: 1.0,
    syncTouch: true,
    infinite: false,
  });

  lenis.on('scroll', (e) => {
    targetProgress = calculateHeroProgress(e.scroll);
    
    const now = performance.now();
    const dt = Math.max(1, now - lastProgressTime);
    const dp = targetProgress - lastProgress;
    scrollVelocity = dp / dt;
    lastProgress = targetProgress;
    lastProgressTime = now;

    const currentIdx = Math.floor(targetProgress * (frameCount - 1));
    prioritizeAround(currentIdx, scrollVelocity >= 0 ? 1 : -1);
  });

  function raf(time) {
    lenis.raf(time);
    
    // Direct synchronization: Lenis already handles smooth momentum physics at 60/120fps.
    // Eliminating secondary lerp removes the 3-5s initial drag/lag completely.
    currentProgress = targetProgress;
    render(currentProgress);

    const currentScroll = lenis.scroll || window.scrollY || 0;
    updateHeroLogo(currentScroll);
    updateHeroHouseText(currentScroll);
    updateHeroBlur(currentScroll);
    updateHeroNav(currentScroll);
    updateExpertParallax(currentScroll);

    requestAnimationFrame(raf);
  }
  requestAnimationFrame(raf);
} else {
  // Fallback native scroll listener
  window.addEventListener('scroll', () => {
    const scrollTop = window.scrollY || document.documentElement.scrollTop || 0;
    targetProgress = calculateHeroProgress(scrollTop);

    const currentIdx = Math.floor(targetProgress * (frameCount - 1));
    prioritizeAround(currentIdx, 1);
  }, { passive: true });

  function fallbackLoop() {
    currentProgress = targetProgress;
    render(currentProgress);

    const scrollTop = window.scrollY || document.documentElement.scrollTop || 0;
    updateHeroLogo(scrollTop);
    updateHeroHouseText(scrollTop);
    updateHeroBlur(scrollTop);
    updateHeroNav(scrollTop);
    updateExpertParallax(scrollTop);

    requestAnimationFrame(fallbackLoop);
  }
  requestAnimationFrame(fallbackLoop);
}

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
  
  const heroHeight = heroEl ? heroEl.offsetHeight - window.innerHeight : 1000;
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
  
  const heroHeight = heroEl.offsetHeight - window.innerHeight;
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
  const heroHeight = heroEl ? heroEl.offsetHeight - window.innerHeight : 5000;
  
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
