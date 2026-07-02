(() => {
  const canvas = document.querySelector(".smoke-canvas");
  const portraits = [...document.querySelectorAll(".portrait")];

  if (!canvas || portraits.length === 0) return;

  const gl =
    canvas.getContext("webgl", {
      alpha: true,
      antialias: false,
      depth: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false
    }) ||
    canvas.getContext("experimental-webgl", {
      alpha: true,
      antialias: false,
      depth: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false
    });

  if (!gl) {
    canvas.classList.add("is-hidden");
    return;
  }

  const vertexShaderSource = `
    attribute vec2 a_position;

    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  const fragmentShaderSource = `
    precision highp float;

    uniform vec2 u_resolution;
    uniform vec4 u_rect;
    uniform vec2 u_pointer;
    uniform float u_time;
    uniform float u_strength;
    uniform float u_age;
    uniform float u_seed;

    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);

      float a = hash(i);
      float b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0));
      float d = hash(i + vec2(1.0, 1.0));

      return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
    }

    float fbm(vec2 p) {
      float value = 0.0;
      float amp = 0.5;
      mat2 rotate = mat2(0.82, -0.57, 0.57, 0.82);

      for (int i = 0; i < 4; i++) {
        value += amp * noise(p);
        p = rotate * p * 2.04 + 17.7;
        amp *= 0.5;
      }

      return value;
    }

    float softRect(vec2 p, vec2 halfSize, float softness) {
      vec2 d = abs(p) - halfSize;
      float outside = length(max(d, 0.0));
      float inside = min(max(d.x, d.y), 0.0);
      return 1.0 - smoothstep(0.0, softness, outside + inside);
    }

    void main() {
      vec2 pixel = vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y);
      vec2 center = u_rect.xy + u_rect.zw * 0.5;
      vec2 localPx = pixel - center;
      vec2 local = localPx / max(u_rect.zw, vec2(1.0));

      float rectMask = softRect(localPx, u_rect.zw * 0.61, 78.0);
      float distFromPointer = distance(pixel, u_pointer);
      float pointerBloom = 1.0 - smoothstep(8.0, 190.0, distFromPointer);
      float smokeArea = max(rectMask, pointerBloom * 0.66);

      vec2 flow = local * vec2(2.0, 5.8);
      flow.x += sin(local.y * 7.0 + u_time * 0.38 + u_seed) * 0.2;
      flow.y -= u_age * 0.055;
      flow += vec2(u_seed * 0.73, u_seed * 1.17);

      float base = fbm(flow + vec2(u_time * 0.045, -u_time * 0.025));
      float detail = fbm(flow * vec2(2.4, 0.72) + vec2(-u_time * 0.08, u_time * 0.035));
      float vein = fbm(vec2(local.x * 12.0 + base * 2.2, local.y * 3.2 - u_time * 0.12));
      float wisps = smoothstep(0.49, 0.79, base * 0.62 + detail * 0.24 + vein * 0.34);

      float verticalHold = smoothstep(0.82, -0.35, local.y);
      float horizontalFade = smoothstep(0.86, 0.04, abs(local.x));
      float appear = smoothstep(0.0, 0.42, u_age);
      float vanish = 1.0 - smoothstep(0.58, 1.0, u_age);
      float life = mix(vanish, 1.0, u_strength);
      float alpha = wisps * smokeArea * verticalHold * horizontalFade * appear * life;

      float edgeNoise = fbm(flow * 3.0 + 8.0);
      alpha *= smoothstep(0.24, 0.95, edgeNoise + smokeArea * 0.75);
      alpha *= 0.72 * u_strength + 0.42 * (1.0 - u_strength) * vanish;

      vec3 smoke = mix(vec3(0.64), vec3(1.0), smoothstep(0.18, 0.95, base));
      gl_FragColor = vec4(smoke, clamp(alpha, 0.0, 0.72));
    }
  `;

  const compileShader = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) || "Shader compile failed");
    }

    return shader;
  };

  const createProgram = () => {
    const program = gl.createProgram();
    gl.attachShader(program, compileShader(gl.VERTEX_SHADER, vertexShaderSource));
    gl.attachShader(program, compileShader(gl.FRAGMENT_SHADER, fragmentShaderSource));
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || "Program link failed");
    }

    return program;
  };

  const program = createProgram();
  const positionLocation = gl.getAttribLocation(program, "a_position");
  const uniforms = {
    resolution: gl.getUniformLocation(program, "u_resolution"),
    rect: gl.getUniformLocation(program, "u_rect"),
    pointer: gl.getUniformLocation(program, "u_pointer"),
    time: gl.getUniformLocation(program, "u_time"),
    strength: gl.getUniformLocation(program, "u_strength"),
    age: gl.getUniformLocation(program, "u_age"),
    seed: gl.getUniformLocation(program, "u_seed")
  };

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW
  );

  const state = {
    active: false,
    target: null,
    strength: 0,
    age: 1,
    seed: Math.random() * 100,
    pointerX: window.innerWidth * 0.5,
    pointerY: window.innerHeight * 0.5,
    rect: { left: 0, top: 0, width: 1, height: 1 }
  };

  let pixelRatio = 1;
  let lastTime = performance.now();

  const resize = () => {
    pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.floor(window.innerWidth * pixelRatio);
    const height = Math.floor(window.innerHeight * pixelRatio);

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      gl.viewport(0, 0, width, height);
    }
  };

  const syncRect = () => {
    if (!state.target) return;
    const rect = state.target.getBoundingClientRect();
    state.rect.left = rect.left;
    state.rect.top = rect.top;
    state.rect.width = rect.width;
    state.rect.height = rect.height;
  };

  const activate = (event, portrait) => {
    state.active = true;
    state.target = portrait;
    state.seed = Math.random() * 100;
    state.age = 0;
    state.pointerX = event.clientX;
    state.pointerY = event.clientY;
    syncRect();
  };

  const deactivate = () => {
    state.active = false;
    state.age = 0;
  };

  portraits.forEach((portrait) => {
    portrait.addEventListener("pointerenter", (event) => activate(event, portrait));
    portrait.addEventListener("pointermove", (event) => {
      state.pointerX = event.clientX;
      state.pointerY = event.clientY;
      if (state.target === portrait) syncRect();
    });
    portrait.addEventListener("pointerleave", deactivate);
    portrait.addEventListener("focus", () => {
      const rect = portrait.getBoundingClientRect();
      activate(
        {
          clientX: rect.left + rect.width * 0.5,
          clientY: rect.top + rect.height * 0.5
        },
        portrait
      );
    });
    portrait.addEventListener("blur", deactivate);
  });

  window.addEventListener("resize", resize);
  window.addEventListener("scroll", syncRect, { passive: true });

  const render = (time) => {
    resize();

    const delta = Math.min((time - lastTime) / 1000, 0.05);
    lastTime = time;
    state.age = Math.min(state.age + delta * 0.58, 1);
    state.strength += ((state.active ? 1 : 0) - state.strength) * (1 - Math.pow(0.001, delta));

    if (state.target) syncRect();
    if (!state.active && state.strength < 0.002 && state.age >= 1) {
      state.target = null;
    }

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (state.target || state.strength > 0.002) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

      gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
      gl.uniform4f(
        uniforms.rect,
        state.rect.left * pixelRatio,
        state.rect.top * pixelRatio,
        state.rect.width * pixelRatio,
        state.rect.height * pixelRatio
      );
      gl.uniform2f(uniforms.pointer, state.pointerX * pixelRatio, state.pointerY * pixelRatio);
      gl.uniform1f(uniforms.time, time / 1000);
      gl.uniform1f(uniforms.strength, state.strength);
      gl.uniform1f(uniforms.age, state.age);
      gl.uniform1f(uniforms.seed, state.seed);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    requestAnimationFrame(render);
  };

  resize();
  requestAnimationFrame(render);
})();
