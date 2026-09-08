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

// Fast nearest loaded frame finder (guarantees zero flicker or blank frames)
function getNearestFrame(targetIdx) {
  if (isLoaded[targetIdx]) {
    lastNearestIndex = targetIdx;
    return images[targetIdx];
  }

  const maxRadius = 80;
  for (let r = 1; r <= maxRadius; r++) {
    const left = targetIdx - r;
    if (left >= 0 && isLoaded[left]) {
      lastNearestIndex = left;
      return images[left];
    }
    const right = targetIdx + r;
    if (right < frameCount && isLoaded[right]) {
      lastNearestIndex = right;
      return images[right];
    }
  }

  // Fall back to previously rendered frame if available
  if (lastNearestIndex >= 0 && images[lastNearestIndex]) {
    return images[lastNearestIndex];
  }

  // Global nearest fallback
  for (let i = 0; i < frameCount; i++) {
    if (isLoaded[i]) {
      lastNearestIndex = i;
      return images[i];
    }
  }
  return null;
}

function render(p) {
  if (!canvas || !context) return;
  const targetIndex = Math.min(
    frameCount - 1,
    Math.max(0, Math.floor(p * (frameCount - 1)))
  );

  if (targetIndex === lastRenderedIndex) return;

  const img = getNearestFrame(targetIndex);
  if (!img) return;

  context.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);
  lastRenderedIndex = targetIndex;
}

// Directional & Predictive Asynchronous Frame Streaming
const queue = [];
let activeLoads = 0;
const MAX_CONCURRENT = 6; // Optimal for HTTP pipeline and UI thread decoding

function enqueueFrame(idx, highPriority = false) {
  if (idx < 0 || idx >= frameCount || isLoaded[idx]) return;
  if (enqueued[idx]) {
    if (highPriority) {
      // Move to front if already in queue but now high priority
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
  processQueue();
}

function prioritizeAround(currentIndex, direction = 1) {
  const lookAhead = 40;
  const lookBehind = 15;

  if (direction >= 0) {
    for (let i = 0; i <= lookAhead; i++) {
      enqueueFrame(currentIndex + i, true);
    }
    for (let i = 1; i <= lookBehind; i++) {
      enqueueFrame(currentIndex - i, false);
    }
  } else {
    for (let i = 0; i <= lookAhead; i++) {
      enqueueFrame(currentIndex - i, true);
    }
    for (let i = 1; i <= lookBehind; i++) {
      enqueueFrame(currentIndex + i, false);
    }
  }
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
        render(currentProgress);
        triggerLoaderSplit();
      }
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
  
  setTimeout(() => {
    if (loader) loader.classList.add('split');
    document.body.classList.add('hero-loaded');
    
    setTimeout(() => {
      if (loader) {
        loader.classList.add('loader-done');
        loader.style.display = 'none';
      }
    }, 2200);
  }, 120);
}

// Fallback trigger in case frame 0 takes longer than expected to download
window.addEventListener('DOMContentLoaded', () => {
  setTimeout(triggerLoaderSplit, 600);
});
setTimeout(triggerLoaderSplit, 800);

// Intelligent Preload: opening sequence and light keyframe scaffolding
function initPreloader() {
  // Priority 1: Opening 35 frames in sequential order
  for (let i = 0; i < Math.min(35, frameCount); i++) {
    enqueueFrame(i, false);
  }
  // Priority 2: Keyframe skeleton every 12 frames across timeline (background streaming)
  for (let i = 35; i < frameCount; i += 12) {
    enqueueFrame(i, false);
  }
}

initPreloader();

// Calculate scroll progress exclusively across the Hero sequence track
function calculateHeroProgress(scrollY) {
  const hero = document.getElementById('hero');
  if (!hero) {
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    return maxScroll > 0 ? scrollY / maxScroll : 0;
  }
  const heroScrollableDistance = hero.offsetHeight - window.innerHeight;
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

  let lastTime = performance.now();
  function raf(time) {
    const dt = Math.min(33, Math.max(1, time - lastTime));
    lastTime = time;

    lenis.raf(time);
    
    // Delta-time aware smooth exponential interpolation
    const lerpFactor = 1 - Math.exp(-18 * (dt / 1000));
    currentProgress += (targetProgress - currentProgress) * lerpFactor;
    render(currentProgress);

    const currentScroll = lenis.scroll || window.scrollY || 0;
    updateHeroLogo(currentScroll);
    updateHeroHouseText(currentScroll);
    updateHeroBlur(currentScroll);
    updateHeroNav(currentScroll);
    updateExpertParallax();

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

  let lastTime = performance.now();
  function fallbackLoop(time) {
    const dt = Math.min(33, Math.max(1, time - lastTime));
    lastTime = time;

    const lerpFactor = 1 - Math.exp(-18 * (dt / 1000));
    currentProgress += (targetProgress - currentProgress) * lerpFactor;
    render(currentProgress);

    const scrollTop = window.scrollY || document.documentElement.scrollTop || 0;
    updateHeroLogo(scrollTop);
    updateHeroHouseText(scrollTop);
    updateHeroBlur(scrollTop);
    updateHeroNav(scrollTop);
    updateExpertParallax();

    requestAnimationFrame(fallbackLoop);
  }
  requestAnimationFrame(fallbackLoop);
}

// Handle entrance animation completion before scroll take-over
let entranceFinished = false;
setTimeout(() => {
  entranceFinished = true;
  const logo = document.getElementById('heroLogo');
  if (logo) logo.style.transition = 'none';
}, 2200);

// Continuous scroll upward movement for hero logo
let lastLogoTranslateY = null;
let lastLogoOpacity = null;
function updateHeroLogo(scrollY) {
  const logo = document.getElementById('heroLogo');
  if (!logo) return;
  if (!entranceFinished && scrollY === 0) return;
  
  if (!entranceFinished && scrollY > 0) {
    entranceFinished = true;
    logo.style.transition = 'none';
  }
  
  const translateY = Math.round(-scrollY * 1.4);
  const opacity = Math.max(0, +(1 - scrollY / 450).toFixed(3));
  
  if (translateY !== lastLogoTranslateY || opacity !== lastLogoOpacity) {
    lastLogoTranslateY = translateY;
    lastLogoOpacity = opacity;
    logo.style.transform = `translate3d(0px, ${translateY}px, 0px)`;
    logo.style.opacity = `${opacity}`;
    logo.style.pointerEvents = opacity <= 0.05 ? 'none' : 'auto';
  }
}

// Continuous scroll trigger animation for house showcase text
let lastHouseTranslateY = null;
let lastHouseOpacity = null;
function updateHeroHouseText(scrollY) {
  const houseText = document.getElementById('heroHouseText');
  if (!houseText) return;
  
  const hero = document.getElementById('hero');
  const heroHeight = hero ? hero.offsetHeight - window.innerHeight : 1000;
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
      houseText.style.transform = `translate3d(0px, ${translateY}px, 0px)`;
      houseText.style.opacity = `${roundedOpacity}`;
      houseText.style.pointerEvents = roundedOpacity <= 0.05 ? 'none' : 'auto';
    }
  } else {
    if (lastHouseOpacity !== 0) {
      lastHouseOpacity = 0;
      houseText.style.opacity = '0';
      houseText.style.pointerEvents = 'none';
    }
  }
}

// Dynamic blur on the hero section: cached to prevent unnecessary GPU style recalculations
let lastBlurAmount = -1;
function updateHeroBlur(scrollY) {
  const hero = document.getElementById('hero');
  if (!hero || !canvas) return;
  
  const heroHeight = hero.offsetHeight - window.innerHeight;
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
  const nav = document.getElementById('topNav');
  if (!nav) return;
  const hero = document.getElementById('hero');
  const heroHeight = hero ? hero.offsetHeight - window.innerHeight : 5000;
  
  if (scrollY > heroHeight - 120) {
    const opacity = Math.max(0, +(1 - (scrollY - (heroHeight - 120)) / 120).toFixed(2));
    if (opacity !== lastNavOpacity) {
      lastNavOpacity = opacity;
      nav.style.opacity = `${opacity}`;
      nav.style.pointerEvents = opacity <= 0.05 ? 'none' : 'auto';
    }
  } else {
    if (document.body.classList.contains('hero-loaded') && lastNavOpacity !== 1) {
      lastNavOpacity = 1;
      nav.style.opacity = '1';
      nav.style.pointerEvents = 'auto';
    }
  }
}

// Eleanor Sterling Section Scroll Parallax Page Transition
let lastParallaxTranslateY = null;
function updateExpertParallax() {
  const expertSection = document.getElementById('expert');
  const portraitImg = document.querySelector('.expert-portrait-img');
  if (!expertSection || !portraitImg) return;

  const rect = expertSection.getBoundingClientRect();
  const windowHeight = window.innerHeight;
  
  if (rect.top < windowHeight && rect.bottom > 0) {
    const progress = (windowHeight - rect.top) / (windowHeight + rect.height);
    const translateY = Math.round((progress - 0.5) * -36);
    if (translateY !== lastParallaxTranslateY) {
      lastParallaxTranslateY = translateY;
      portraitImg.style.transform = `scale(1.04) translate3d(0, ${translateY}px, 0)`;
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
