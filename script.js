document.addEventListener("DOMContentLoaded", () => {
  // --- 1. Touch Responsive Glow ---
  const glow = document.getElementById("cursor-glow");
  document.addEventListener("mousemove", (e) => {
    glow.style.left = e.clientX + "px";
    glow.style.top = e.clientY + "px";
  });

  // --- 3. EHAX Particle System ---
  class ParticleSystem {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.particles = [];
      this.mouse = { x: 0, y: 0 };
      this.resize();
      this.init();
      this.animate();

      window.addEventListener("resize", () => this.resize());
      window.addEventListener("mousemove", (e) => {
        this.mouse.x = e.clientX;
        this.mouse.y = e.clientY;
      });
    }
    resize() {
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
    }
    init() {
      const count = Math.min(60, Math.floor(window.innerWidth / 20));
      for (let i = 0; i < count; i++) {
        this.particles.push({
          x: Math.random() * this.canvas.width,
          y: Math.random() * this.canvas.height,
          vx: (Math.random() - 0.5) * 0.4,
          vy: (Math.random() - 0.5) * 0.4,
          size: Math.random() * 1.5 + 0.5,
          opacity: Math.random() * 0.3 + 0.1,
        });
      }
    }
    animate() {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.particles.forEach((p) => {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x = this.canvas.width;
        if (p.x > this.canvas.width) p.x = 0;
        if (p.y < 0) p.y = this.canvas.height;
        if (p.y > this.canvas.height) p.y = 0;

        const dx = this.mouse.x - p.x;
        const dy = this.mouse.y - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 150) {
          p.x -= dx * 0.01;
          p.y -= dy * 0.01;
        }
        this.ctx.beginPath();
        this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        this.ctx.fillStyle = `rgba(255, 255, 255, ${p.opacity})`;
        this.ctx.fill();
      });

      for (let i = 0; i < this.particles.length; i++) {
        for (let j = i + 1; j < this.particles.length; j++) {
          const dx = this.particles[i].x - this.particles[j].x;
          const dy = this.particles[i].y - this.particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 120) {
            this.ctx.beginPath();
            this.ctx.moveTo(this.particles[i].x, this.particles[i].y);
            this.ctx.lineTo(this.particles[j].x, this.particles[j].y);
            this.ctx.strokeStyle = `rgba(255, 255, 255, ${0.05 * (1 - dist / 120)})`;
            this.ctx.lineWidth = 0.5;
            this.ctx.stroke();
          }
        }
      }
      requestAnimationFrame(() => this.animate());
    }
  }
  const canvas = document.getElementById("particleCanvas");
  if (canvas) new ParticleSystem(canvas);

  // --- 3b. Wire Globe with Parallax ---
  class WireGlobe {
    constructor(canvas, hero) {
      this.canvas = canvas;
      this.hero = hero;
      this.ctx = canvas.getContext("2d");
      this.size = 640;
      this.count = 380;
      this.buckets = 7;
      this.points = [];
      this.edges = [];
      this.projected = [];
      this.tx = 0; this.ty = 0;
      this.mx = 0; this.my = 0;
      this.raf = 0;
      this.t0 = null;
      this.visible = true;
      this.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      this.setup();
      this.buildMesh();
      this.bind();
      this.start();
    }

    setup() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = this.size * dpr;
      this.canvas.height = this.size * dpr;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    buildMesh() {
      const golden = Math.PI * (3 - Math.sqrt(5));
      for (let i = 0; i < this.count; i++) {
        const y = 1 - (i / (this.count - 1)) * 2;
        const r = Math.sqrt(1 - y * y);
        const theta = golden * i;
        this.points.push([Math.cos(theta) * r, y, Math.sin(theta) * r]);
      }
      for (let a = 0; a < this.count; a++) {
        for (let b = a + 1; b < this.count; b++) {
          const dx = this.points[a][0] - this.points[b][0];
          const dy = this.points[a][1] - this.points[b][1];
          const dz = this.points[a][2] - this.points[b][2];
          if (dx * dx + dy * dy + dz * dz < 0.085) this.edges.push([a, b]);
        }
      }
      this.projected = new Array(this.count);
    }

    bind() {
      window.addEventListener("mousemove", (e) => {
        const rect = this.hero.getBoundingClientRect();
        this.tx = ((e.clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
        this.ty = Math.min(((e.clientY - rect.top) / Math.max(rect.height, 1)) * 2 - 1, 1);
      });
      window.addEventListener("touchmove", (e) => {
        if (e.touches && e.touches[0]) {
          const t = e.touches[0];
          const rect = this.hero.getBoundingClientRect();
          this.tx = ((t.clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
          this.ty = Math.min(((t.clientY - rect.top) / Math.max(rect.height, 1)) * 2 - 1, 1);
        }
      }, { passive: true });
      window.addEventListener("mouseleave", () => {
        this.tx = 0;
        this.ty = 0;
      });
      window.addEventListener("touchend", () => {
        this.tx = 0;
        this.ty = 0;
      }, { passive: true });

      if ("IntersectionObserver" in window) {
        const io = new IntersectionObserver((entries) => {
          entries.forEach((entry) => {
            this.visible = entry.isIntersecting;
            if (this.visible && !this.raf && !this.reduced) this.start();
          });
        }, { threshold: 0.05 });
        io.observe(this.hero);
      }
    }

    draw(t) {
      const ctx = this.ctx;
      const W = this.size, H = this.size;
      const N = this.count;

      this.mx += (this.tx - this.mx) * 0.06;
      this.my += (this.ty - this.my) * 0.06;
      this.hero.style.setProperty("--mx", this.mx.toFixed(3));
      this.hero.style.setProperty("--my", this.my.toFixed(3));

      const ay = t * 0.22 + this.mx * 0.7;
      const ax = -0.42 + this.my * 0.35;
      const cy = Math.cos(ay), sy = Math.sin(ay), cx = Math.cos(ax), sx = Math.sin(ax);
      const R = 236, F = 3.4, ox = W / 2, oy = H / 2;

      for (let i = 0; i < N; i++) {
        const p = this.points[i];
        const x1 = p[0] * cy + p[2] * sy;
        const z1 = -p[0] * sy + p[2] * cy;
        const y2 = p[1] * cx - z1 * sx;
        const z2 = p[1] * sx + z1 * cx;
        const s = F / (F - z2);
        this.projected[i] = [ox + x1 * R * s, oy + y2 * R * s, z2];
      }

      ctx.clearRect(0, 0, W, H);

      for (let k = 0; k < this.buckets; k++) {
        const lo = -1 + (2 * k) / this.buckets;
        const hi = -1 + (2 * (k + 1)) / this.buckets;
        const depth = ((lo + hi) / 2 + 1) / 2;
        ctx.strokeStyle = `rgba(255, 255, 255, ${(0.035 + depth * 0.30).toFixed(3)})`;
        ctx.lineWidth = 0.5 + depth * 0.7;
        ctx.beginPath();
        for (let e = 0; e < this.edges.length; e++) {
          const A = this.projected[this.edges[e][0]];
          const B = this.projected[this.edges[e][1]];
          const z = (A[2] + B[2]) / 2;
          if (z < lo || z >= hi) continue;
          ctx.moveTo(A[0], A[1]);
          ctx.lineTo(B[0], B[1]);
        }
        ctx.stroke();
      }

      for (let k = 0; k < this.buckets; k++) {
        const lo = -1 + (2 * k) / this.buckets;
        const hi = -1 + (2 * (k + 1)) / this.buckets;
        const depth = ((lo + hi) / 2 + 1) / 2;
        const size = 0.8 + depth * 1.5;
        ctx.fillStyle = `rgba(255, 255, 255, ${(0.12 + depth * 0.75).toFixed(3)})`;
        ctx.beginPath();
        for (let i = 0; i < N; i++) {
          const q = this.projected[i];
          if (q[2] < lo || q[2] >= hi) continue;
          ctx.moveTo(q[0] + size, q[1]);
          ctx.arc(q[0], q[1], size, 0, Math.PI * 2);
        }
        ctx.fill();
      }
    }

    start() {
      const frame = (now) => {
        if (this.t0 === null) this.t0 = now;
        this.draw((now - this.t0) / 1000);
        if (this.reduced || !this.visible) {
          this.raf = 0;
          return;
        }
        this.raf = requestAnimationFrame(frame);
      };
      this.raf = requestAnimationFrame(frame);
    }
  }

  const globeCanvas = document.getElementById("globeCanvas");
  const heroSection = document.getElementById("hero") || document.getElementById("heroScene");
  if (globeCanvas && heroSection) new WireGlobe(globeCanvas, heroSection);

  // ==========================================
  // 1. TACTILE WEB AUDIO SFX (SYNTHESIZED)
  // ==========================================
  class SoundFX {
    constructor() {
      this.enabled = true;
      this.ctx = null;
    }

    init() {
      try {
        if (!this.ctx) {
          const AudioCtx = window.AudioContext || window.webkitAudioContext;
          if (AudioCtx) this.ctx = new AudioCtx();
        }
        if (this.ctx && this.ctx.state === "suspended") {
          this.ctx.resume().catch(() => {});
        }
      } catch (_) {}
    }

    playTone(freq = 700, duration = 0.06, type = "triangle", gainVal = 0.22) {
      if (!this.enabled) return;
      this.init();
      if (!this.ctx) return;

      const fire = () => {
        try {
          const t = this.ctx.currentTime;
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();

          osc.type = type;
          osc.frequency.setValueAtTime(freq, t);

          gain.gain.setValueAtTime(gainVal, t);
          gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);

          osc.connect(gain);
          gain.connect(this.ctx.destination);

          osc.start(t);
          osc.stop(t + duration);
        } catch (_) {}
      };

      if (this.ctx.state === "suspended") {
        this.ctx.resume().then(fire).catch(() => {});
      } else {
        fire();
      }
    }

    hover() {
      this.playTone(740, 0.05, "triangle", 0.20);
    }

    click() {
      this.playTone(1100, 0.07, "triangle", 0.26);
    }

    drawer() {
      if (!this.enabled) return;
      this.init();
      if (!this.ctx) return;
      const fire = () => {
        try {
          const t = this.ctx.currentTime;
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = "sawtooth";
          osc.frequency.setValueAtTime(560, t);
          osc.frequency.exponentialRampToValueAtTime(1150, t + 0.12);
          gain.gain.setValueAtTime(0.24, t);
          gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
          osc.connect(gain);
          gain.connect(this.ctx.destination);
          osc.start(t);
          osc.stop(t + 0.14);
        } catch (_) {}
      };
      if (this.ctx.state === "suspended") {
        this.ctx.resume().then(fire).catch(() => {});
      } else {
        fire();
      }
    }

    key() {
      this.playTone(650 + Math.random() * 200, 0.04, "triangle", 0.18);
    }

    toggleOn() {
      if (!this.enabled) return;
      this.init();
      if (!this.ctx) return;
      const fire = () => {
        try {
          const t = this.ctx.currentTime;
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(520, t);
          osc.frequency.exponentialRampToValueAtTime(980, t + 0.12);
          gain.gain.setValueAtTime(0.25, t);
          gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
          osc.connect(gain);
          gain.connect(this.ctx.destination);
          osc.start(t);
          osc.stop(t + 0.14);
        } catch (_) {}
      };
      if (this.ctx.state === "suspended") {
        this.ctx.resume().then(fire).catch(() => {});
      } else {
        fire();
      }
    }

    toggleOff() {
      this.init();
      if (!this.ctx) return;
      const fire = () => {
        try {
          const t = this.ctx.currentTime;
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(700, t);
          osc.frequency.exponentialRampToValueAtTime(320, t + 0.12);
          gain.gain.setValueAtTime(0.18, t);
          gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
          osc.connect(gain);
          gain.connect(this.ctx.destination);
          osc.start(t);
          osc.stop(t + 0.14);
        } catch (_) {}
      };
      if (this.ctx.state === "suspended") {
        this.ctx.resume().then(fire).catch(() => {});
      } else {
        fire();
      }
    }
  }
  const sfx = new SoundFX();

  // Multi-event universal audio unlock on first user gesture
  const unlockAudio = () => {
    sfx.init();
  };
  ["pointerdown", "mousedown", "touchstart", "touchend", "click", "keydown"].forEach(evt => {
    window.addEventListener(evt, unlockAudio, { capture: true, passive: true });
    document.addEventListener(evt, unlockAudio, { capture: true, passive: true });
  });

  const audioBtn = document.getElementById("audio-toggle");
  const audioLabel = document.getElementById("audio-label");
  if (audioBtn) {
    audioBtn.addEventListener("click", () => {
      sfx.init();
      sfx.enabled = !sfx.enabled;
      audioBtn.classList.toggle("active", sfx.enabled);
      if (audioLabel) audioLabel.textContent = sfx.enabled ? "AUDIO: ON" : "AUDIO: OFF";
      if (sfx.enabled) {
        sfx.toggleOn();
      } else {
        sfx.toggleOff();
      }
    });
  }

  // ==========================================
  // 2. ASCII TEXT SCRAMBLE DECRYPT EFFECT
  // ==========================================
  class TextScrambler {
    constructor() {
      this.chars = '!<>-_\\/[]{}—=+*^?#________';
    }
    scramble(el, text = null, duration = 500) {
      if (!el) return;
      const target = text !== null ? text : (el.getAttribute("data-original") || el.textContent);
      if (!el.getAttribute("data-original")) el.setAttribute("data-original", target);
      let frame = 0;
      const totalFrames = Math.max(10, Math.floor(duration / 30));
      clearInterval(el._scrambleTimer);
      el._scrambleTimer = setInterval(() => {
        let output = '';
        const progress = frame / totalFrames;
        for (let i = 0; i < target.length; i++) {
          if (target[i] === ' ' || target[i] === '\n') {
            output += target[i];
          } else if (i < target.length * progress) {
            output += target[i];
          } else {
            output += this.chars[Math.floor(Math.random() * this.chars.length)];
          }
        }
        el.textContent = output;
        frame++;
        if (frame > totalFrames) {
          clearInterval(el._scrambleTimer);
          el.textContent = target;
        }
      }, 30);
    }
  }
  const scrambler = new TextScrambler();

  // Scramble main title on load
  const heroTitle = document.querySelector(".hero-title");
  if (heroTitle) {
    const orig = heroTitle.textContent;
    heroTitle.addEventListener("mouseenter", () => scrambler.scramble(heroTitle, orig, 450));
  }

  // ==========================================
  // 3. 3D TILT EFFECT ON PODIUM
  // ==========================================
  class TiltEffect {
    constructor() {
      this.elements = document.querySelectorAll("[data-tilt]");
      const isTouch = window.matchMedia("(hover: none) and (pointer: coarse)").matches;
      if (!isTouch) {
        this.init();
      }
    }
    init() {
      this.elements.forEach((el) => {
        el.addEventListener("mousemove", (e) => this.handleMove(e, el));
        el.addEventListener("mouseleave", (e) => this.handleLeave(e, el));
      });
    }
    handleMove(e, el) {
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const rotateX = ((y - centerY) / centerY) * -10;
      const rotateY = ((x - centerX) / centerX) * 10;
      el.style.transform = `perspective(800px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) translateY(-4px) scale3d(1.02, 1.02, 1.02)`;
      el.style.transition = "transform 0.08s ease";
    }
    handleLeave(e, el) {
      el.style.transform = "perspective(800px) rotateX(0deg) rotateY(0deg) translateY(0) scale3d(1, 1, 1)";
      el.style.transition = "transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)";
    }
  }
  new TiltEffect();

  // ==========================================
  // 4. OPERATOR INSPECT DRAWER
  // ==========================================
  const drawer = document.getElementById("operator-drawer");
  const drawerOverlay = document.getElementById("drawer-overlay");
  const drawerCloseBtn = document.getElementById("drawer-close");

  function openDrawer(user) {
    if (!drawer || !user) return;
    sfx.drawer();

    // Populate Drawer Elements
    const isDanger = user.total < 40;
    const uNameEl = document.getElementById("drawer-username");
    if (uNameEl) {
      uNameEl.textContent = user.username;
      uNameEl.classList.toggle("name-danger", isDanger);
    }
    const realNameEl = document.getElementById("drawer-realname");
    if (realNameEl) {
      realNameEl.textContent = user.name || "Name not given";
    }
    document.getElementById("drawer-rank").textContent = `#${user.rank.toString().padStart(2, '0')}`;
    const scoreEl = document.getElementById("drawer-score");
    if (scoreEl) {
      scoreEl.textContent = `${user.total} PTS`;
      scoreEl.classList.toggle("danger", isDanger);
    }

    const totalSolved = user.easy + user.medium + user.hard;
    document.getElementById("drawer-flags").textContent = totalSolved.toString();

    const pct = Math.max(1, Math.round((user.rank / allUsers.length) * 100));
    document.getElementById("drawer-percentile").textContent = `TOP ${pct}%`;

    const avatarChar = user.username ? user.username.charAt(0).toUpperCase() : ">";
    document.getElementById("drawer-avatar-icon").textContent = avatarChar;

    // Counts & Points
    document.getElementById("drawer-easy-count").textContent = `${user.easy} flags`;
    document.getElementById("drawer-easy-pts").textContent = `${user.easy * 1} pts`;

    document.getElementById("drawer-med-count").textContent = `${user.medium} flags`;
    document.getElementById("drawer-med-pts").textContent = `${user.medium * 3} pts`;

    document.getElementById("drawer-hard-count").textContent = `${user.hard} flags`;
    document.getElementById("drawer-hard-pts").textContent = `${user.hard * 6} pts`;

    // Ratio Bars
    const eW = totalSolved ? ((user.easy / totalSolved) * 100).toFixed(1) : 0;
    const mW = totalSolved ? ((user.medium / totalSolved) * 100).toFixed(1) : 0;
    const hW = totalSolved ? ((user.hard / totalSolved) * 100).toFixed(1) : 0;

    const bE = document.getElementById("dr-bar-easy");
    const bM = document.getElementById("dr-bar-med");
    const bH = document.getElementById("dr-bar-hard");
    if (bE) bE.style.width = `${eW}%`;
    if (bM) bM.style.width = `${mW}%`;
    if (bH) bH.style.width = `${hW}%`;

    // Attendance summary + full history
    const attendance = user.attendance || EMPTY_ATTENDANCE;
    const attendanceEl = document.getElementById("drawer-attendance");
    const summaryEl = document.getElementById("drawer-attendance-summary");
    const historyEl = document.getElementById("drawer-attendance-history");

    if (attendanceEl) {
      attendanceEl.textContent = formatAttendance(attendance);
      attendanceEl.classList.toggle("danger", !attendance.available);
    }

    if (summaryEl && historyEl) {
      historyEl.replaceChildren();

      if (!attendance.available) {
        summaryEl.textContent = "Attendance unavailable.";
        const empty = document.createElement("div");
        empty.className = "attendance-history-empty";
        empty.textContent = "The public attendance feed could not be loaded.";
        historyEl.append(empty);
      } else if (!attendance.total) {
        summaryEl.textContent = "No meetings recorded yet.";
        const empty = document.createElement("div");
        empty.className = "attendance-history-empty";
        empty.textContent = "Attendance history will appear after the first meeting.";
        historyEl.append(empty);
      } else {
        summaryEl.textContent = `${attendance.p} present \u00b7 ${attendance.r} R \u00b7 ${attendance.a} absent \u00b7 ${attendance.rate}% of ${attendance.total} meetings`;

        const fragment = document.createDocumentFragment();
        for (const entry of attendance.history) {
          const row = document.createElement("div");
          row.className = "att-history-row";

          const main = document.createElement("div");
          main.className = "att-history-main";

          const date = document.createElement("span");
          date.className = "att-history-date";
          date.textContent = formatPublicDate(entry.date);

          const label = document.createElement("span");
          label.className = "att-history-label";
          label.textContent = entry.label || "CyLab Meet";
          label.title = entry.label || "CyLab Meet";

          main.append(date, label);

          const status = document.createElement("span");
          const key = entry.status.toLowerCase();
          status.className = `att-history-status is-${key}`;
          status.textContent =
            entry.status === "P"
              ? "P \u00b7 PRESENT"
              : entry.status === "R"
                ? "R \u00b7 MARKED R"
                : "A \u00b7 ABSENT";

          row.append(main, status);
          fragment.append(row);
        }
        historyEl.append(fragment);
      }
    }

    drawer.classList.add("active");
    drawerOverlay.classList.add("active");
    document.body.style.overflow = "hidden";
  }

  function closeDrawer() {
    if (!drawer) return;
    sfx.click();
    drawer.classList.remove("active");
    drawerOverlay.classList.remove("active");
    document.body.style.overflow = "";
  }

  if (drawerCloseBtn) drawerCloseBtn.addEventListener("click", closeDrawer);
  if (drawerOverlay) drawerOverlay.addEventListener("click", closeDrawer);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && drawer && drawer.classList.contains("active")) {
      closeDrawer();
    }
  });

  // ==========================================
  // 5. LEADERBOARD DATA & RATIO BARS
  // ==========================================
  const searchInput = document.getElementById("operator-search");
  const clearBtn = document.getElementById("search-clear");
  const tbody = document.getElementById("board-body");

  let allUsers = [];

  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    const div = document.createElement("div");
    div.textContent = String(str);
    return div.innerHTML;
  }

  const EMPTY_ATTENDANCE = {
    available: false,
    meetings: [],
    records: Object.create(null),
    updatedAt: null
  };

  function normalizeAttendance(payload) {
    if (
      !payload ||
      payload.ok !== true ||
      payload.configured === false ||
      !Array.isArray(payload.meetings)
    ) {
      return EMPTY_ATTENDANCE;
    }

    const seenDates = new Set();
    const meetings = [];
    for (const item of payload.meetings) {
      if (!item || typeof item.date !== "string") continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date)) continue;
      if (seenDates.has(item.date)) continue;
      seenDates.add(item.date);
      meetings.push({
        date: item.date,
        label: typeof item.label === "string" && item.label.trim()
          ? item.label.replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, 80)
          : "CyLab Meet"
      });
    }
    meetings.sort((a, b) => b.date.localeCompare(a.date));

    const records = Object.create(null);
    if (
      payload.records &&
      typeof payload.records === "object" &&
      !Array.isArray(payload.records)
    ) {
      for (const [username, marks] of Object.entries(payload.records)) {
        if (!marks || typeof marks !== "object") continue;
        const clean = Object.create(null);
        for (const [date, status] of Object.entries(marks)) {
          if (!seenDates.has(date)) continue;
          if (status === "P" || status === "R") clean[date] = status;
        }
        records[username] = clean;
      }
    }

    return {
      available: true,
      meetings,
      records,
      updatedAt: typeof payload.updatedAt === "string" ? payload.updatedAt : null
    };
  }

  function buildUserAttendance(username, attendance) {
    if (!attendance || !attendance.available) {
      return {
        available: false,
        p: 0,
        r: 0,
        a: 0,
        total: 0,
        rate: 0,
        history: []
      };
    }

    const marks = attendance.records[username] || {};
    let present = 0;
    let reserved = 0;
    const history = attendance.meetings.map((meeting) => {
      const mark = marks[meeting.date];
      const status = mark === "P" || mark === "R" ? mark : "A";
      if (status === "P") present += 1;
      else if (status === "R") reserved += 1;
      return {
        date: meeting.date,
        label: meeting.label,
        status
      };
    });

    const total = attendance.meetings.length;
    return {
      available: true,
      p: present,
      r: reserved,
      a: Math.max(0, total - present - reserved),
      total,
      rate: total ? Math.round((present / total) * 100) : 0,
      history
    };
  }

  function formatAttendance(attendance) {
    if (!attendance || !attendance.available || !attendance.total) {
      return "\u2014";
    }
    return `${attendance.p} / ${attendance.total}`;
  }

  function attendanceTitle(attendance) {
    if (!attendance || !attendance.available) {
      return "Attendance unavailable";
    }
    if (!attendance.total) {
      return "No meetings recorded yet";
    }
    return `${attendance.p} present \u00b7 ${attendance.r} R \u00b7 ${attendance.a} absent \u00b7 ${attendance.rate}% of ${attendance.total} meetings`;
  }

  function formatPublicDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return value || "\u2014";
    }
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "UTC"
    }).format(date).toUpperCase();
  }

  function renderBoard(filter = "") {
    if (!tbody) return;
    const q = filter.trim().toLowerCase();

    // Render ALL operators in table (including top 3)
    const dataset = allUsers;
    const matched = q ? dataset.filter(u => {
      const uName = (u.username || "").toLowerCase();
      const rName = (u.name || "").toLowerCase();
      if (uName.includes(q) || rName.includes(q)) return true;
      const tokens = q.split(/\s+/).filter(Boolean);
      if (tokens.length > 1) {
        return tokens.every(token => uName.includes(token) || rName.includes(token));
      }
      return false;
    }) : dataset;


    if (matched.length === 0) {
      tbody.innerHTML = `
        <tr class="empty-row">
          <td colspan="7" class="no-results">
            No operator found matching "<strong id="search-term-display"></strong>"
          </td>
        </tr>
      `;
      const termEl = tbody.querySelector("#search-term-display");
      if (termEl) termEl.textContent = filter.trim();
      return;
    }

    let html = "";
    for (let i = 0; i < matched.length; i++) {
      const u = matched[i];
      const totSolves = u.easy + u.medium + u.hard;
      const eP = totSolves ? Math.round((u.easy / totSolves) * 100) : 0;
      const mP = totSolves ? Math.round((u.medium / totSolves) * 100) : 0;
      const hP = totSolves ? Math.round((u.hard / totSolves) * 100) : 0;

      let rankClass = "";
      if (u.rank === 1) rankClass = "rank-gold";
      else if (u.rank === 2) rankClass = "rank-silver";
      else if (u.rank === 3) rankClass = "rank-bronze";

      const isDanger = u.total < 40;
      const rowDangerClass = isDanger ? "row-danger" : "";
      const nameDangerClass = isDanger ? "name-danger" : "";
      const ptsDangerClass = isDanger ? "pts-danger" : "";
      const attendance = u.attendance || EMPTY_ATTENDANCE;
      const attendanceText = formatAttendance(attendance);
      const attendanceClass =
        attendance.available && attendance.total
          ? "attendance-badge"
          : "attendance-badge attendance-empty";

      html += `
        <tr class="operator-row ${rowDangerClass}" data-username="${escapeHtml(u.username)}" data-realname="${escapeHtml(u.name || '')}" title="${escapeHtml(u.name && u.name !== 'Name not given' && u.name !== 'Busy Person' ? `${u.username} (${u.name})` : u.username)}">
          <td class="c-rank ${rankClass}">#${u.rank.toString().padStart(2, '0')}</td>
          <td class="c-name">
            <div class="name-cell">
              <span class="name-text ${nameDangerClass}">${escapeHtml(u.username)}</span>
              <div class="mini-ratio-bar" title="Easy: ${u.easy} | Med: ${u.medium} | Hard: ${u.hard}">
                <span class="m-seg seg-e" style="width: ${eP}%"></span>
                <span class="m-seg seg-m" style="width: ${mP}%"></span>
                <span class="m-seg seg-h" style="width: ${hP}%"></span>
              </div>
              <div class="mobile-solves" aria-label="Solves: ${u.easy} easy, ${u.medium} medium, ${u.hard} hard">
                <span class="m-badge m-easy">${u.easy}E</span>
                <span class="m-badge m-med">${u.medium}M</span>
                <span class="m-badge m-hard">${u.hard}H</span>
              </div>
            </div>
          </td>
          <td class="c-num col-easy">${u.easy}</td>
          <td class="c-num col-med">${u.medium}</td>
          <td class="c-num col-hard">${u.hard}</td>
          <td class="c-tot">
            <span class="pts-badge">${u.total} <span class="pts-unit">PTS</span></span>
          </td>
          <td class="c-att">
            <span class="${attendanceClass}" title="${escapeHtml(attendanceTitle(attendance))}">${escapeHtml(attendanceText)}</span>
          </td>
        </tr>
      `;
    }
    tbody.innerHTML = html;

    // Attach row events
    tbody.querySelectorAll(".operator-row").forEach(row => {
      row.addEventListener("mouseenter", () => sfx.hover());
      row.addEventListener("click", () => {
        const uName = row.getAttribute("data-username");
        const found = allUsers.find(x => x.username === uName);
        if (found) openDrawer(found);
      });
    });
  }

  function fetchAttendanceFeed() {
    const controller = typeof AbortController !== "undefined"
      ? new AbortController()
      : null;
    const timer = controller
      ? window.setTimeout(() => controller.abort(), 5000)
      : 0;

    return fetch('/api/attendance', {
      cache: 'no-store',
      signal: controller ? controller.signal : undefined
    }).finally(() => {
      if (timer) window.clearTimeout(timer);
    });
  }

  const attendancePromise = fetchAttendanceFeed()
    .then(r => {
      if (!r.ok) throw new Error("Attendance fetch error");
      return r.json();
    })
    .then(payload => normalizeAttendance(payload))
    .catch(() => EMPTY_ATTENDANCE);

  const leaderboardPromise = fetch('leaderboard.json', { cache: 'no-store' })
    .then(r => {
      if (!r.ok) throw new Error("Data fetch error");
      return r.json();
    });

  Promise.all([leaderboardPromise, attendancePromise])
    .then(([data, attendance]) => {
      if (!data || !Array.isArray(data.leaderboard)) return;

      const sanitized = data.leaderboard
        .filter(u => u && typeof u.username === "string" && u.username.length <= 64)
        .map(u => {
          const easy = Math.max(0, parseInt(u.easy, 10) || 0);
          const medium = Math.max(0, parseInt(u.medium, 10) || 0);
          const hard = Math.max(0, parseInt(u.hard, 10) || 0);
          const total = (easy * 1) + (medium * 3) + (hard * 6);
          return {
            username: String(u.username).trim(),
            name: (u.name && String(u.name).trim()) || "Name not given",
            easy,
            medium,
            hard,
            total
          };
        });

      const sorted = sanitized.sort((a, b) => 
        b.total - a.total || b.hard - a.hard || b.medium - a.medium || b.easy - a.easy
      );

      allUsers = sorted.map((u, idx) => ({
        ...u,
        rank: idx + 1,
        attendance: buildUserAttendance(u.username, attendance)
      }));

      // Populate Podium (Top 3)
      for (let i = 1; i <= 3; i++) {
        const user = allUsers[i - 1];
        if (user) {
          const nameEl = document.getElementById(`pod-${i}-name`);
          const scoreEl = document.getElementById(`pod-${i}-score`);
          const attendanceEl = document.getElementById(`pod-${i}-att`);
          if (nameEl) nameEl.textContent = user.username;
          if (scoreEl) scoreEl.textContent = `${user.total} PTS`;
          if (attendanceEl) {
            attendanceEl.textContent = user.attendance.available && user.attendance.total
              ? `${user.attendance.p} / ${user.attendance.total} MEETS`
              : "ATTENDANCE \u2014";
          }

          const spotEl = document.querySelector(`.spot-${i}`);
          if (spotEl) {
            spotEl.addEventListener("mouseenter", () => {
              sfx.hover();
              if (nameEl) scrambler.scramble(nameEl, user.username, 300);
            });
            spotEl.addEventListener("click", () => openDrawer(user));
          }
        }
      }

      // Initial Table Render
      renderBoard();

      // Search listeners
      if (searchInput) {
        searchInput.addEventListener("input", (e) => {
          sfx.key();
          const val = e.target.value;
          if (clearBtn) clearBtn.style.display = val ? "inline-block" : "none";
          renderBoard(val);
        });
      }

      if (clearBtn && searchInput) {
        clearBtn.addEventListener("click", () => {
          sfx.click();
          searchInput.value = "";
          clearBtn.style.display = "none";
          renderBoard("");
          searchInput.focus();
        });
      }
    })
    .catch(() => {
      // Graceful degradation without leaking error internals
      if (tbody) {
        tbody.innerHTML = `
          <tr class="empty-row">
            <td colspan="7" class="no-results">Unable to load live leaderboard. Please refresh.</td>
          </tr>
        `;
      }
    });
});
