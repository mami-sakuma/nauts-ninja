import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js";

const vertexShader = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = `
  uniform sampler2D u_smokeTex;
  uniform sampler2D u_texture;
  varying vec2 vUv;
  uniform float u_progress;
  uniform float u_planeAspect;
  uniform float u_videoAspect;

  vec2 coverUv(vec2 uv, float planeAspect, float videoAspect) {
    vec2 result = uv;
    if (videoAspect > planeAspect) {
      float ratio = planeAspect / videoAspect;
      result.x = (uv.x - 0.5) * ratio + 0.5;
    } else {
      float ratio = videoAspect / planeAspect;
      result.y = (uv.y - 0.5) * ratio + 0.5;
    }
    return result;
  }

  void main() {
    vec2 smokeUv = coverUv(vUv, u_planeAspect, u_videoAspect);
    smokeUv = (smokeUv - 0.5) * 0.92 + 0.5;
    vec4 smoke = texture2D(u_smokeTex, smokeUv);

    float smokeDensity = max(max(smoke.r, smoke.g), smoke.b);
    float thickSmoke = smoothstep(0.045, 0.14, smokeDensity);

    float fadeX = smoothstep(0.0, 0.22, vUv.x) * smoothstep(1.0, 0.78, vUv.x);
    float topFade = smoothstep(1.0, 0.38, vUv.y);
    topFade = topFade * topFade * (3.0 - 2.0 * topFade);
    float fadeY = smoothstep(0.0, 0.04, vUv.y) * topFade;
    float bottomMask = smoothstep(0.055, 0.13, vUv.y);
    float borderMask = fadeX * fadeY * bottomMask;

    float lowerBirth = smoothstep(0.0, 0.22, u_progress);
    float smokeMask = thickSmoke * borderMask * lowerBirth;

    vec3 pureWhiteSmoke = vec3(1.0);
    float smokeTail = 1.0 - smoothstep(0.68, 1.0, u_progress);
    float activeMask = smoothstep(0.0, 0.01, u_progress);
    float finalMask = smokeMask * activeMask;
    float cleanSmoke = smoothstep(0.08, 0.26, finalMask);
    float finalAlpha = cleanSmoke * smokeTail;

    if (finalAlpha < 0.02) {
      discard;
    }

    gl_FragColor = vec4(pureWhiteSmoke, finalAlpha);
  }
`;

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const HOVER_DURATION = 2800;
const LEAVE_DURATION = 900;
const SMOKE_PLAYBACK_RATE = 4.0;
const SMOKE_POOL_SIZE = 6;
const SMOKE_START_DELAY = 320;
const RESET_HOLD_DURATION = 900;
const SMOKE_TOP_EXTENSION = 1.06;
const SMOKE_SIDE_EXTENSION = 1.06;
function discoverPlaceholders() {
  const explicit = [...document.querySelectorAll(".webgl-placeholder")];
  const nautsMembers = [...document.querySelectorAll(".p-mem-list-item .img > .img-wrapper")];
  const targets = explicit.length > 0 ? explicit : nautsMembers;

  return targets
    .map((placeholder) => {
      placeholder.classList.add("webgl-placeholder");
      const image = placeholder.querySelector("img");
      const card = placeholder.closest(".member-card, .p-mem-list-item") || placeholder;
      if (image && !card.dataset.image) {
        card.dataset.image = image.currentSrc || image.getAttribute("src") || "";
      }
      if (image && !card.dataset.name) {
        card.dataset.name = image.getAttribute("alt") || "";
      }
      return placeholder;
    })
    .filter((placeholder) => placeholder.querySelector("img"));
}

const placeholders = discoverPlaceholders();
const canvas = document.querySelector("#webgl-canvas");
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(0, 1, 0, 1, 0.01, 10);
camera.position.z = 1;

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
  powerPreference: "high-performance"
});
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.toneMappingExposure = 1;

const items = [];
let lastFrameTime = performance.now();
let activeSmokeItem = null;

function createSmokeVideoTexture(instanceIndex = 0) {
  const video = document.createElement("video");
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.defaultPlaybackRate = SMOKE_PLAYBACK_RATE;
  video.playbackRate = SMOKE_PLAYBACK_RATE;
  video.autoplay = false;
  video.preload = "auto";
  video.crossOrigin = "anonymous";
  video.setAttribute("muted", "");
  video.setAttribute("playsinline", "");
  video.setAttribute("preload", "auto");
  video.disablePictureInPicture = true;
  video.style.position = "fixed";
  video.style.left = "-9999px";
  video.style.top = "-9999px";
  video.style.width = "1px";
  video.style.height = "1px";
  video.style.opacity = "0";
  video.style.pointerEvents = "none";

  const source = document.createElement("source");
  source.src = `./images/smoke-${(instanceIndex % SMOKE_POOL_SIZE) + 1}.mp4`;
  source.type = "video/mp4";
  video.appendChild(source);
  document.body.appendChild(video);
  video.load();

  const texture = new THREE.VideoTexture(video);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  video.addEventListener("loadeddata", () => {
    video.defaultPlaybackRate = SMOKE_PLAYBACK_RATE;
    video.playbackRate = SMOKE_PLAYBACK_RATE;
    texture.needsUpdate = true;
  });
  video.addEventListener("canplay", () => {
    video.defaultPlaybackRate = SMOKE_PLAYBACK_RATE;
    video.playbackRate = SMOKE_PLAYBACK_RATE;
    texture.needsUpdate = true;
  });
  video.addEventListener("timeupdate", () => {
    texture.needsUpdate = true;
  });

  return { video, texture };
}

const smokeSlots = Array.from({ length: SMOKE_POOL_SIZE }, (_, index) => ({
  ...createSmokeVideoTexture(index),
  item: null
}));

function acquireSmokeSlot(item) {
  if (item.smokeVideo) {
    return item.smokeVideo;
  }

  let slot = smokeSlots.find((candidate) => candidate.item === null);
  if (!slot) {
    slot = {
      ...createSmokeVideoTexture(smokeSlots.length),
      item: null
    };
    smokeSlots.push(slot);
  }

  slot.item = item;
  item.smokeVideo = slot;
  item.uniforms.u_smokeTex.value = slot.texture;
  item.uniforms.u_videoAspect.value = getVideoAspect(slot.video);
  return slot;
}

function releaseSmokeSlot(item) {
  const slot = item.smokeVideo;
  if (!slot) {
    return;
  }

  slot.video.pause();
  slot.video.currentTime = 0;
  slot.texture.needsUpdate = true;
  slot.item = null;
  item.smokeVideo = null;
}

function isSmokeCutoffReached(video) {
  const cutoffTime = getSmokeCutoffTime(video);
  return cutoffTime > 0 && video.currentTime >= cutoffTime;
}

function getSmokeCutoffTime(video) {
  return Number.isFinite(video.duration) && video.duration > 2.5 ? video.duration - 2.5 : 0;
}

function getVideoAspect(video) {
  return video.videoWidth > 0 && video.videoHeight > 0 ? video.videoWidth / video.videoHeight : 1;
}

function trimSmokeCredits(item) {
  const { video } = item.smokeVideo;
  if (!Number.isFinite(video.duration) || video.duration <= 2.5) {
    return;
  }
  const cutoffTime = getSmokeCutoffTime(video);
  if (video.currentTime >= cutoffTime) {
    video.pause();
    video.currentTime = Math.max(0, cutoffTime);
  }
}

function playSmokeVideo(item, restart = true) {
  const { video, texture } = item.smokeVideo;
  video.defaultPlaybackRate = SMOKE_PLAYBACK_RATE;
  video.playbackRate = SMOKE_PLAYBACK_RATE;
  if (video.readyState === 0) {
    video.load();
  }
  if (restart) {
    try {
      video.currentTime = 0;
    } catch (error) {
      video.addEventListener("loadedmetadata", () => {
        video.currentTime = 0;
      }, { once: true });
    }
  }
  texture.needsUpdate = true;
  const playRequest = video.play();
  if (playRequest) {
    playRequest
      .then(() => {
        video.defaultPlaybackRate = SMOKE_PLAYBACK_RATE;
        video.playbackRate = SMOKE_PLAYBACK_RATE;
      })
      .catch(() => {});
  }
}

function coverTexture(texture) {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
}

function makeFallbackTexture(name, index) {
  const fallback = document.createElement("canvas");
  fallback.width = 900;
  fallback.height = 1220;
  const ctx = fallback.getContext("2d");
  const palette = [
    ["#171717", "#d1c9bc", "#4d7071"],
    ["#101010", "#dcd4c9", "#7c6858"],
    ["#141414", "#ebe4d8", "#54606e"],
    ["#0f0f0f", "#d0c3b5", "#705868"]
  ][index % 4];

  ctx.fillStyle = palette[0];
  ctx.fillRect(0, 0, fallback.width, fallback.height);
  const glow = ctx.createRadialGradient(450, 430, 80, 450, 430, 560);
  glow.addColorStop(0, palette[2]);
  glow.addColorStop(1, "#000000");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, fallback.width, fallback.height);
  ctx.fillStyle = palette[1];
  ctx.beginPath();
  ctx.ellipse(450, 350, 132, 162, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#080808";
  ctx.beginPath();
  ctx.ellipse(450, 330, 145, 130, 0, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = palette[1];
  ctx.beginPath();
  ctx.moveTo(265, 1060);
  ctx.bezierCurveTo(285, 705, 615, 705, 635, 1060);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(0, 0, 0, 0.82)";
  ctx.fillRect(0, 1018, fallback.width, 204);
  ctx.fillStyle = "rgba(247, 247, 242, 0.84)";
  ctx.font = "600 48px Arial, sans-serif";
  ctx.fillText(name, 54, 1118);

  const texture = new THREE.CanvasTexture(fallback);
  coverTexture(texture);
  return texture;
}

function loadTexture(path, name, index) {
  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin("anonymous");
  return new Promise((resolve) => {
    loader.load(
      path,
      (texture) => {
        coverTexture(texture);
        resolve(texture);
      },
      undefined,
      () => resolve(makeFallbackTexture(name, index))
    );
  });
}

const HOVER_IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "avif"];

function getHoverImageCandidates(src) {
  const queryIndex = src.search(/[?#]/);
  const cleanSrc = queryIndex === -1 ? src : src.slice(0, queryIndex);
  const suffix = queryIndex === -1 ? "" : src.slice(queryIndex);
  const extensionIndex = cleanSrc.lastIndexOf(".");
  const slashIndex = cleanSrc.lastIndexOf("/");

  if (extensionIndex === -1 || extensionIndex < slashIndex) {
    return [`${cleanSrc}2${suffix}`];
  }

  const base = cleanSrc.slice(0, extensionIndex);
  const extension = cleanSrc.slice(extensionIndex + 1);
  const candidates = [`${base}2.${extension}${suffix}`];

  for (const candidateExtension of HOVER_IMAGE_EXTENSIONS) {
    if (candidateExtension !== extension.toLowerCase()) {
      candidates.push(`${base}2.${candidateExtension}${suffix}`);
    }
  }

  return [...new Set(candidates)];
}

function preloadHoverImage(item) {
  if (item.hoverImageStatus !== "idle" || item.hoverImageCandidates.length === 0) {
    return;
  }

  item.hoverImageStatus = "loading";
  let candidateIndex = 0;
  const tryNextCandidate = () => {
    const candidate = item.hoverImageCandidates[candidateIndex];
    const hoverImage = new Image();
    hoverImage.onload = () => {
      item.hoverImageSrc = candidate;
      item.hoverImageStatus = "ready";
      if (item.hoverLayer) {
        item.hoverLayer.src = item.hoverImageSrc;
      }
      if (item.hovered || item.target === 1) {
        showHoverImage(item);
      }
    };
    hoverImage.onerror = () => {
      candidateIndex += 1;
      if (candidateIndex < item.hoverImageCandidates.length) {
        tryNextCandidate();
      } else {
        item.hoverImageStatus = "error";
      }
    };
    hoverImage.src = candidate;
  };

  tryNextCandidate();
}

function createHoverLayer(image) {
  if (!image || !image.parentElement) {
    return null;
  }

  const hoverLayer = image.cloneNode(false);
  hoverLayer.removeAttribute("srcset");
  hoverLayer.removeAttribute("sizes");
  hoverLayer.removeAttribute("loading");
  hoverLayer.setAttribute("aria-hidden", "true");
  hoverLayer.alt = "";
  hoverLayer.classList.add("js-hover-image");
  hoverLayer.style.opacity = "0";
  image.insertAdjacentElement("afterend", hoverLayer);
  return hoverLayer;
}

function showHoverImage(item) {
  if (!item.hoverLayer || item.hoverImageStatus !== "ready") {
    return;
  }

  item.hoverLayer.src = item.hoverImageSrc;
  item.hoverLayer.style.transition = "opacity 360ms cubic-bezier(0.22, 1, 0.36, 1)";
  item.hoverLayer.style.opacity = "1";
}

function hideHoverImage(item) {
  if (!item.hoverLayer) {
    return;
  }

  item.hoverLayer.style.transition = "opacity 460ms cubic-bezier(0.22, 1, 0.36, 1)";
  item.hoverLayer.style.opacity = "0";
}

function resizeRenderer() {
  const width = Math.max(1, Math.floor(window.innerWidth));
  const height = Math.max(1, Math.floor(window.innerHeight));
  renderer.setSize(width, height, false);
  camera.left = 0;
  camera.right = width;
  camera.top = height;
  camera.bottom = 0;
  camera.updateProjectionMatrix();
}

function syncMeshesToDom() {
  resizeRenderer();

  for (const item of items) {
    const rect = item.placeholder.getBoundingClientRect();
    const smokeScaleX = rect.width * SMOKE_SIDE_EXTENSION;
    const baseY = window.innerHeight - (rect.top + rect.height * 0.5);
    const smokeScaleY = rect.height * SMOKE_TOP_EXTENSION;
    const smokeCenterY = baseY + (smokeScaleY - rect.height);
    item.mesh.position.set(rect.left + rect.width * 0.5, smokeCenterY, 0);
    item.mesh.scale.set(smokeScaleX, smokeScaleY, 1);
    item.uniforms.u_planeAspect.value = smokeScaleX > 0 && smokeScaleY > 0 ? smokeScaleX / smokeScaleY : 1;
  }
}

async function createItem(placeholder, index) {
  const card = placeholder.closest(".member-card, .p-mem-list-item") || placeholder;
  const image = placeholder.querySelector("img");
  const texturePath = image?.currentSrc || image?.getAttribute("src") || card.dataset.image;
  const originalImageSrc = image?.getAttribute("src") || texturePath;
  const hoverImageCandidates = originalImageSrc ? getHoverImageCandidates(originalImageSrc) : [];
  const hoverLayer = createHoverLayer(image);
  const texture = await loadTexture(texturePath, card.dataset.name || image?.getAttribute("alt") || "", index);
  const uniforms = {
    u_texture: { value: texture },
    u_smokeTex: { value: smokeSlots[0].texture },
    u_progress: { value: 0 },
    u_planeAspect: { value: 1 },
    u_videoAspect: { value: 1 }
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    blending: THREE.NormalBlending,
    alphaTest: 0,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide
  });

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2, 128, 180), material);
  scene.add(mesh);

  const item = {
    card,
    placeholder,
    image,
    mesh,
    uniforms,
    smokeVideo: null,
    progress: 0,
    target: 0,
    hovered: false,
    smokeDelayElapsed: 0,
    smokeStarted: false,
    holdElapsed: 0,
    originalImageSrc,
    hoverImageSrc: "",
    hoverImageCandidates,
    hoverImageStatus: hoverImageCandidates.length > 0 ? "idle" : "error",
    hoverLayer
  };

  const setActive = (active) => {
    item.hovered = active && !prefersReducedMotion;
    if (active && !prefersReducedMotion) {
      if (item.target === 1 && item.progress > 0.001 && item.progress < 0.998) {
        return;
      }
      if (item.progress >= 0.998) {
        item.progress = 0;
        item.smokeDelayElapsed = 0;
        item.smokeStarted = false;
        item.holdElapsed = 0;
        item.uniforms.u_progress.value = 0;
        if (item.image) {
          item.image.style.transition = "none";
          item.image.style.opacity = "1";
        }
      }
      preloadHoverImage(item);
      showHoverImage(item);
      item.target = 1;
      activeSmokeItem = item;
      item.progress = 0;
      item.smokeDelayElapsed = 0;
      item.smokeStarted = false;
      item.holdElapsed = 0;
      item.uniforms.u_progress.value = 0;
      acquireSmokeSlot(item);
      item.smokeVideo.video.load();
    } else if (item.target === 0) {
      hideHoverImage(item);
    }
    placeholder.classList.toggle("is-smoking", item.target === 1);
    syncMeshesToDom();
    requestAnimationFrame(syncMeshesToDom);
  };

  placeholder.addEventListener("pointerenter", () => setActive(true));
  placeholder.addEventListener("pointerleave", () => setActive(false));
  placeholder.addEventListener("focusin", () => setActive(true));
  placeholder.addEventListener("focusout", () => setActive(false));
  placeholder.tabIndex = 0;

  items.push(item);
  preloadHoverImage(item);
}

function resetSmokeItem(item) {
  if (activeSmokeItem === item) {
    activeSmokeItem = null;
  }
  item.hovered = false;
  item.target = 0;
  item.progress = 0;
  item.smokeDelayElapsed = 0;
  item.smokeStarted = false;
  item.holdElapsed = 0;
  item.uniforms.u_progress.value = 0;
  item.placeholder.classList.remove("is-smoking");
  hideHoverImage(item);
  releaseSmokeSlot(item);
  if (item.image) {
    item.image.style.transition = "opacity 280ms ease";
    item.image.style.opacity = "1";
  }
}

function animate() {
  const now = performance.now();
  const delta = Math.min(now - lastFrameTime, 64);
  lastFrameTime = now;

  for (const item of items) {
    if (item.target === 1 && item.smokeVideo && !item.smokeStarted) {
      item.smokeDelayElapsed += delta;
      if (item.smokeDelayElapsed >= SMOKE_START_DELAY) {
        item.smokeStarted = true;
        item.progress = Math.max(item.progress, 0.002);
        item.uniforms.u_progress.value = item.progress;
        playSmokeVideo(item, true);
      }
    }

    if (item.smokeVideo && item.smokeStarted) {
      item.uniforms.u_smokeTex.value = item.smokeVideo.texture;
      item.uniforms.u_videoAspect.value = getVideoAspect(item.smokeVideo.video);
      trimSmokeCredits(item);
      if (item.smokeVideo.video.playbackRate !== SMOKE_PLAYBACK_RATE) {
        item.smokeVideo.video.defaultPlaybackRate = SMOKE_PLAYBACK_RATE;
        item.smokeVideo.video.playbackRate = SMOKE_PLAYBACK_RATE;
      }
      item.smokeVideo.texture.needsUpdate = true;

      if ((item.smokeStarted || item.progress > 0.001) && item.smokeVideo.video.readyState >= 2) {
        if (item.target === 1 && item.smokeVideo.video.paused && item.progress < 0.998 && !isSmokeCutoffReached(item.smokeVideo.video)) {
          const playRequest = item.smokeVideo.video.play();
          if (playRequest) {
            playRequest.catch(() => {});
          }
        }
      }
    }

    if (item.target === 1 && item.smokeStarted) {
      item.progress = Math.min(1, item.progress + delta / HOVER_DURATION);
    } else if (item.target === 1) {
      item.progress = 0;
    } else {
      item.progress = 0;
    }

    item.uniforms.u_progress.value = item.progress;

    if (item.image) {
      const video = item.smokeVideo?.video;
      const hasVideoTime = video && Number.isFinite(video.duration) && video.duration > 2.5 && video.currentTime > 0;
      const cutoff = hasVideoTime ? video.duration - 2.5 : 1;
      const videoProgress = hasVideoTime ? Math.min(1, video.currentTime / cutoff) : 0;
      const progressFallback = item.target === 1 ? item.progress : 0;
      const disappearProgress = item.target === 1 ? Math.max(videoProgress, progressFallback) : item.progress;
      const fadeStart = 0.42;
      const fadeEnd = 0.76;
      const fadeRatio = Math.min(1, Math.max(0, (disappearProgress - fadeStart) / (fadeEnd - fadeStart)));
      const photoFade = fadeRatio * fadeRatio * (3 - 2 * fadeRatio);
      item.image.style.transition = item.target === 1 ? "none" : "opacity 280ms ease";
      item.image.style.opacity = String(1 - photoFade);
      if (item.hoverLayer && item.hoverLayer.style.opacity !== "0") {
        item.hoverLayer.style.opacity = String(1 - photoFade);
      }
    }

    if (item.target === 1 && item.progress >= 1) {
      item.holdElapsed += delta;
      if (item.holdElapsed >= RESET_HOLD_DURATION) {
        resetSmokeItem(item);
      }
    }
  }

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

Promise.all(placeholders.map(createItem)).then(() => {
  syncMeshesToDom();
  document.body.classList.add("webgl-ready");
  window.addEventListener("resize", syncMeshesToDom, { passive: true });
  window.addEventListener("scroll", syncMeshesToDom, { passive: true });
  new ResizeObserver(syncMeshesToDom).observe(document.body);
  renderer.render(scene, camera);
  animate();
});
