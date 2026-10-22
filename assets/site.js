/* ==========================================================================
   Benedict Bagoyo portfolio: shared behaviour for every page
   Each part checks whether its element exists, so one file serves all pages.
   ========================================================================== */
(() => { // wraps the code so its variables don't leak into the page
  const root = document.documentElement; // the <html> element, where theme and language are set
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; // true if the visitor wants less animation
  const $ = (sel) => document.querySelector(sel); // shortcut: first element matching a selector
  const $$ = (sel) => [...document.querySelectorAll(sel)]; // shortcut: all matching elements, as an array

  /* ---------- Text the script writes itself, in both languages ---------- */
  const T = { // edit these if you change the wording of buttons or chart captions
    en: { sampling: 'Sampling data', iter: (k, i) => `k-means with k = ${k}: iteration ${i}`, done: (i) => `Converged after ${i} iterations`, copy: 'Copy email', copied: 'Copied', copyFail: 'Copy failed', toLight: 'Switch to light theme', toDark: 'Switch to dark theme' }, // English strings
    es: { sampling: 'Generando datos', iter: (k, i) => `k-means con k = ${k}: iteración ${i}`, done: (i) => `Convergencia tras ${i} iteraciones`, copy: 'Copiar email', copied: 'Copiado', copyFail: 'No se pudo copiar', toLight: 'Cambiar a tema claro', toDark: 'Cambiar a tema oscuro' }, // Spanish strings
  }; // end of strings
  let lang = root.dataset.lang === 'es' ? 'es' : 'en'; // current language; English unless Spanish was saved
  const t = () => T[lang]; // shortcut to the strings for the current language
  const store = (key, value) => { try { localStorage.setItem(key, value); } catch (e) { /* storage blocked */ } }; // saves a choice for the next visit, if the browser allows

  document.addEventListener('touchstart', () => {}, { passive: true }); // lets iPhones show the pressed-card tint while a finger is held down

  /* ---------- Hero chart: animated k-means (front page only) ---------- */
  const kmeans = (() => { // builds the chart if the page has one; returns its controls
    const card = $('#kmeans-card'); // the dark card holding the chart
    const canvas = $('#kmeans'); // the chart's drawing surface
    if (!card || !canvas) return null; // no chart on this page
    const ctx = canvas.getContext('2d'); // 2D drawing tools for the canvas
    const statusEl = $('#kmeans-status'); // caption that reports progress
    const K = 3; // number of clusters to find
    const N = 180; // number of points to draw
    const MAX_ITER = 30; // safety cap on k-means passes
    let points = []; // the data points
    let centroids = []; // the cluster centres
    let iteration = 0; // k-means passes run so far
    let phase = 'gather'; // stage: 'gather' (points fly in), 'cluster' or 'done'
    let phaseStart = 0; // time the gather stage began
    let lastStep = 0; // time of the latest k-means pass
    let frameId = null; // pending animation frame, so it can be cancelled
    let colors = {}; // colours read from the CSS variables
    let width = 0; // canvas width in CSS pixels
    let height = 0; // canvas height in CSS pixels

    function setStatus() { // writes the chart caption for the current stage, in the current language
      if (phase === 'gather') statusEl.textContent = t().sampling; // points still flying in
      else if (phase === 'cluster') statusEl.textContent = t().iter(K, iteration); // clustering under way
      else statusEl.textContent = t().done(iteration); // finished
    } // end setStatus

    function readColors() { // copies the current theme colours into JavaScript
      const css = getComputedStyle(card); // computed styles of the chart card
      const get = (name) => css.getPropertyValue(name).trim(); // reads one CSS variable
      colors = { bg: get('--chart-bg'), grid: get('--chart-line'), idle: get('--mist'), ink: get('--chart-ink'), clusters: [get('--chart-1'), get('--chart-2'), get('--chart-3')] }; // card background, grid, unassigned points, marker cross, one colour per cluster
    } // end readColors

    function randn() { // random number from a standard normal distribution
      let u = 0; // first uniform draw
      while (u === 0) u = Math.random(); // redraw if zero, since log(0) is undefined
      const v = Math.random(); // second uniform draw
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); // Box-Muller transform
    } // end randn

    const clamp = (x) => Math.min(0.97, Math.max(0.03, x)); // keeps a coordinate inside the plot

    function makeData() { // builds new data and resets the algorithm
      const base = [{ x: 0.25, y: 0.3 }, { x: 0.74, y: 0.34 }, { x: 0.5, y: 0.74 }]; // rough centres of the three true groups
      const centres = base.map((c) => ({ x: c.x + (Math.random() - 0.5) * 0.1, y: c.y + (Math.random() - 0.5) * 0.1 })); // nudge them so each run differs
      points = Array.from({ length: N }, (_, i) => { // create N points
        const c = centres[i % K]; // spread points evenly across the groups
        const sx = Math.random(); // random starting x
        const sy = Math.random(); // random starting y
        return { sx, sy, x: sx, y: sy, tx: clamp(c.x + randn() * 0.09), ty: clamp(c.y + randn() * 0.09), cluster: -1 }; // start, current and final position; -1 means unassigned
      }); // end point creation
      const first = points[Math.floor(Math.random() * N)]; // k-means++ seeding: the first centre is a random point
      const picks = [first]; // chosen starting centres
      while (picks.length < K) { // choose the remaining centres
        const d2 = points.map((p) => Math.min(...picks.map((c) => (p.tx - c.tx) ** 2 + (p.ty - c.ty) ** 2))); // squared distance from each point to its nearest chosen centre
        let r = Math.random() * d2.reduce((a, b) => a + b, 0); // random draw weighted by those distances
        let idx = 0; // index of the point the draw lands on
        while (r > d2[idx] && idx < N - 1) { r -= d2[idx]; idx += 1; } // walk the cumulative sum until the draw is used up
        picks.push(points[idx]); // far-away points are more likely to be picked, so centres start spread out
      } // end seeding
      centroids = picks.map((p) => ({ x: p.tx, y: p.ty, tx: p.tx, ty: p.ty })); // drawn position and target position of each centre
      iteration = 0; // reset the pass counter
      phase = 'gather'; // begin with the points flying in
      setStatus(); // caption for this stage
    } // end makeData

    function step() { // one k-means pass; returns true if any point changed cluster
      let changed = false; // tracks whether assignments moved
      for (const p of points) { // visit every point
        let best = 0; // index of the nearest centre so far
        let bestDist = Infinity; // distance to that centre
        centroids.forEach((c, k) => { // compare with each centre
          const d = (p.tx - c.tx) ** 2 + (p.ty - c.ty) ** 2; // squared distance
          if (d < bestDist) { bestDist = d; best = k; } // keep the closest
        }); // end comparison
        if (p.cluster !== best) { p.cluster = best; changed = true; } // reassign and note the change
      } // end assignment step
      centroids.forEach((c, k) => { // update each centre
        const members = points.filter((p) => p.cluster === k); // points in this cluster
        if (!members.length) return; // an empty cluster keeps its centre
        c.tx = members.reduce((s, p) => s + p.tx, 0) / members.length; // mean x of the cluster
        c.ty = members.reduce((s, p) => s + p.ty, 0) / members.length; // mean y of the cluster
      }); // end update step
      iteration += 1; // count this pass
      return changed && iteration < MAX_ITER; // keep going only if something moved and the cap isn't reached
    } // end step

    function draw() { // paints the current state
      const pad = 16; // inner margin of the plot
      const px = (x) => pad + x * (width - pad * 2); // converts a 0 to 1 x value to canvas pixels
      const py = (y) => pad + y * (height - pad * 2); // converts a 0 to 1 y value to canvas pixels
      ctx.clearRect(0, 0, width, height); // wipe the last frame
      ctx.strokeStyle = colors.grid; // grid colour
      ctx.lineWidth = 1; // thin grid lines
      ctx.beginPath(); // start the grid
      for (let i = 1; i < 6; i++) { const x = Math.round(px(i / 6)) + 0.5; ctx.moveTo(x, pad); ctx.lineTo(x, height - pad); } // five vertical lines, snapped to sharp pixels
      for (let i = 1; i < 4; i++) { const y = Math.round(py(i / 4)) + 0.5; ctx.moveTo(pad, y); ctx.lineTo(width - pad, y); } // three horizontal lines
      ctx.stroke(); // draw the grid
      for (const p of points) { // each point
        ctx.globalAlpha = p.cluster < 0 ? 0.45 : 0.95; // unassigned points are fainter
        ctx.fillStyle = p.cluster < 0 ? colors.idle : colors.clusters[p.cluster]; // grey until assigned, then its cluster colour
        ctx.beginPath(); // start the dot
        ctx.arc(px(p.x), py(p.y), 3.5, 0, Math.PI * 2); // circle with a 3.5px radius
        ctx.fill(); // paint it
      } // end points
      ctx.globalAlpha = 1; // reset transparency
      if (phase === 'gather') return; // centres appear only once clustering starts
      centroids.forEach((c, k) => { // each centre
        const x = px(c.x); // its canvas x
        const y = py(c.y); // its canvas y
        ctx.fillStyle = colors.bg; // hollow inside matching the card
        ctx.strokeStyle = colors.clusters[k]; // ring in the cluster colour
        ctx.lineWidth = 3; // thick ring so it reads as a marker
        ctx.beginPath(); // start the ring
        ctx.arc(x, y, 9, 0, Math.PI * 2); // ring with a 9px radius
        ctx.fill(); // fill the inside
        ctx.stroke(); // draw the ring
        ctx.strokeStyle = colors.ink; // cross in the light text colour
        ctx.lineWidth = 1.5; // thin cross
        ctx.beginPath(); // start the cross
        ctx.moveTo(x - 4, y); ctx.lineTo(x + 4, y); ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4); // horizontal and vertical strokes
        ctx.stroke(); // draw the cross marking the exact mean
      }); // end centres
    } // end draw

    function frame(now) { // one animation frame; "now" is a timestamp in ms
      if (phase === 'gather') { // points flying into place
        const p = Math.min(1, (now - phaseStart) / 1400); // progress 0 to 1 over 1.4 seconds
        const e = 1 - Math.pow(1 - p, 3); // ease-out so motion slows at the end
        for (const pt of points) { pt.x = pt.sx + (pt.tx - pt.sx) * e; pt.y = pt.sy + (pt.ty - pt.sy) * e; } // move each point along its path
        if (p === 1) { phase = 'cluster'; lastStep = now - 1000; } // switch stage and run the first pass right away
      } else if (phase === 'cluster' && now - lastStep > 900) { // time for the next pass, every 0.9s
        const moving = step(); // run one pass
        lastStep = now; // remember when
        if (!moving) phase = 'done'; // stop once stable
        setStatus(); // update the caption
      } // end stage logic
      let sliding = false; // whether any centre is still moving on screen
      for (const c of centroids) { // ease each centre toward its target
        c.x += (c.tx - c.x) * 0.12; // cover 12% of the remaining x distance
        c.y += (c.ty - c.y) * 0.12; // cover 12% of the remaining y distance
        if (Math.abs(c.tx - c.x) + Math.abs(c.ty - c.y) > 0.0005) sliding = true; // still visibly moving
      } // end centre easing
      draw(); // paint this frame
      frameId = (phase !== 'done' || sliding) ? requestAnimationFrame(frame) : null; // continue until everything has settled
    } // end frame

    function resize() { // matches the canvas resolution to its size on screen
      const dpr = window.devicePixelRatio || 1; // screen pixel density (2 on Retina)
      width = canvas.clientWidth; // displayed width
      height = canvas.clientHeight; // displayed height
      canvas.width = Math.round(width * dpr); // internal width in device pixels
      canvas.height = Math.round(height * dpr); // internal height in device pixels
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // lets drawing code use CSS pixels
      draw(); // repaint at the new size
    } // end resize

    function start() { // starts or restarts the demo
      if (frameId) cancelAnimationFrame(frameId); // stop any animation already running
      makeData(); // new points and starting centres
      if (reduceMotion) { // visitor prefers no animation
        points.forEach((p) => { p.x = p.tx; p.y = p.ty; }); // place points at their final positions
        phase = 'cluster'; // allow centres to be drawn
        while (step()) { /* keep running passes */ } // run k-means to the end instantly
        centroids.forEach((c) => { c.x = c.tx; c.y = c.ty; }); // place centres at their final means
        phase = 'done'; // mark finished
        setStatus(); // final caption
        draw(); // one still frame
        return; // skip the animation loop
      } // end reduced-motion path
      frameId = requestAnimationFrame((now) => { phaseStart = now; frame(now); }); // begin animating on the next frame
    } // end start

    readColors(); // load the palette before drawing
    resize(); // size the canvas once
    new ResizeObserver(resize).observe(canvas); // redraw whenever the canvas changes size
    $('#rerun').addEventListener('click', start); // restart when "Run again" is pressed
    start(); // run the demo on page load
    return { repaint: () => { readColors(); draw(); }, setStatus }; // controls used by the theme and language switches
  })(); // end k-means

  /* ---------- Theme toggle ---------- */
  const themeBtn = $('#theme-toggle'); // the light/dark button
  const themeMeta = $('meta[name="theme-color"]'); // colours the phone's browser bar
  const isDark = () => (root.dataset.theme ? root.dataset.theme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches); // which theme is showing now
  function syncTheme() { // refreshes everything that depends on the theme
    if (themeBtn) themeBtn.setAttribute('aria-label', isDark() ? t().toLight : t().toDark); // spoken label of the button
    if (themeMeta) themeMeta.setAttribute('content', getComputedStyle(root).getPropertyValue('--paper').trim()); // browser bar matches the page
    if (kmeans) kmeans.repaint(); // chart picks up the new colours
  } // end syncTheme
  if (themeBtn) themeBtn.addEventListener('click', () => { // when the toggle is clicked
    root.dataset.theme = isDark() ? 'light' : 'dark'; // switch to the other theme
    store('theme', root.dataset.theme); // remember it for next visit
    syncTheme(); // update the page
  }); // end toggle handler
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncTheme); // follow the system if it switches theme

  /* ---------- Copy email (front page) ---------- */
  const copyBtn = $('#copy-email'); // the "Copy email" button
  if (copyBtn) copyBtn.addEventListener('click', async () => { // when clicked
    try { await navigator.clipboard.writeText(copyBtn.dataset.email); copyBtn.textContent = t().copied; } // copy and confirm
    catch (e) { copyBtn.textContent = t().copyFail; } // clipboard blocked by the browser
    setTimeout(() => { copyBtn.textContent = t().copy; }, 2000); // restore the label after 2 seconds
  }); // end copy handler

  /* ---------- Language switch ---------- */
  const langBtn = $('#lang-toggle'); // the EN/ES button
  function applyLang() { // shows the chosen language everywhere
    root.dataset.lang = lang; // CSS uses this to hide the other language
    root.lang = lang; // tells screen readers and translators which language the page is in
    $$('[data-aria-en]').forEach((el) => el.setAttribute('aria-label', el.dataset[lang === 'es' ? 'ariaEs' : 'ariaEn'])); // swap spoken labels
    const title = document.body.dataset[lang === 'es' ? 'titleEs' : 'titleEn']; // page title in this language
    if (title) document.title = title; // browser tab text
    if (copyBtn) copyBtn.textContent = t().copy; // copy button label
    if (kmeans) kmeans.setStatus(); // chart caption
    syncTheme(); // theme button label
  } // end applyLang
  if (langBtn) langBtn.addEventListener('click', () => { // when the language button is clicked
    lang = lang === 'es' ? 'en' : 'es'; // switch to the other language
    store('lang', lang); // remember it for next visit
    applyLang(); // update the page
  }); // end language handler
  applyLang(); // set everything up in the starting language

  /* ---------- Clover: automatic spin on arrival and at the bottom of the page ---------- */
  function spin(svg) { // plays one full turn on a clover
    if (reduceMotion || !svg) return; // skip if motion is reduced or the clover is missing
    svg.classList.remove('is-spinning'); // reset, in case it is mid-turn
    void svg.getBoundingClientRect(); // forces the browser to notice the reset, so the turn can replay
    svg.classList.add('is-spinning'); // start the turn
  } // end spin
  $$('.clover').forEach((svg) => svg.addEventListener('animationend', () => svg.classList.remove('is-spinning'))); // clear the flag when a turn finishes, so hover works again
  const headClover = $('.brand .clover'); // the clover next to your name
  const footClover = $('footer .clover'); // the clover in the footer
  window.addEventListener('load', () => setTimeout(() => spin(headClover), 350)); // turn once shortly after the page has loaded
  if (footClover) new IntersectionObserver((entries) => { // watches the footer clover
    entries.forEach((e) => { if (e.isIntersecting) spin(footClover); }); // turn each time it scrolls fully into view
  }, { threshold: 1 }).observe(footClover); // "fully" means 100% visible

  /* ---------- Project tabs (front page) ---------- */
  const tabs = $$('[role="tab"]'); // all project tabs
  function selectTab(tab, moveFocus) { // opens one tab and closes the rest
    tabs.forEach((x) => { // go through every tab
      const on = x === tab; // is this the chosen one?
      x.setAttribute('aria-selected', String(on)); // mark selected or not
      x.tabIndex = on ? 0 : -1; // only the open tab is reachable with Tab
      document.getElementById(x.getAttribute('aria-controls')).hidden = !on; // show its card, hide the others
    }); // end loop
    if (moveFocus) tab.focus(); // move keyboard focus when using arrow keys
    tab.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' }); // on phones, slides the chosen tab into view
  } // end selectTab
  tabs.forEach((tab, i) => { // set up each tab
    tab.addEventListener('click', () => selectTab(tab, false)); // open on click
    tab.addEventListener('keydown', (e) => { // keyboard support
      const dir = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key]; // arrow keys move to the next or previous tab
      let next = null; // the tab to open, if any
      if (dir) next = tabs[(i + dir + tabs.length) % tabs.length]; // wrap around at the ends
      if (e.key === 'Home') next = tabs[0]; // Home jumps to the first tab
      if (e.key === 'End') next = tabs[tabs.length - 1]; // End jumps to the last tab
      if (next) { e.preventDefault(); selectTab(next, true); } // open it and stop the page from scrolling
    }); // end keyboard handler
  }); // end tab setup

  /* ---------- Highlight the section you're reading (header menu and project contents list) ---------- */
  $$('[data-spy]').forEach((menu) => { // each menu that should follow the scroll
    const links = [...menu.querySelectorAll('a[href^="#"]')]; // its links that point inside the page
    const targets = links.map((a) => document.getElementById(a.getAttribute('href').slice(1))).filter(Boolean); // the sections they point to
    const spy = new IntersectionObserver((entries) => { // runs when a section crosses the middle of the screen
      entries.forEach((entry) => { // each section that changed
        if (!entry.isIntersecting) return; // ignore sections leaving
        links.forEach((a) => { // update every link
          if (a.getAttribute('href') === '#' + entry.target.id) a.setAttribute('aria-current', 'true'); // highlight the matching link
          else a.removeAttribute('aria-current'); // un-highlight the rest
        }); // end link loop
      }); // end entries loop
    }, { rootMargin: '-40% 0px -55% 0px' }); // a thin band just above the middle of the screen
    targets.forEach((s) => spy.observe(s)); // start watching
  }); // end scroll highlight

  /* ---------- Case study preview on hover (mouse and trackpad only) ---------- */
  const previewLinks = $$('[data-preview]'); // buttons that open a project page
  const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches; // true on computers, false on phones and tablets
  if (previewLinks.length && canHover) { // only build the preview where it can be used
    const peek = document.createElement('div'); // the floating window
    peek.className = 'peek'; // styled in style.css
    peek.setAttribute('aria-hidden', 'true'); // purely visual; screen readers skip it
    peek.innerHTML = '<div class="peek-bar"><i></i><i></i><i></i><span></span></div><div class="peek-view"><div class="peek-skel"><b></b><b></b><b></b></div><iframe tabindex="-1" title=""></iframe></div>'; // title bar with dots, loading placeholders and the page itself
    document.body.append(peek); // add it to the page
    const frame = peek.querySelector('iframe'); // the shrunken project page
    const label = peek.querySelector('.peek-bar span'); // page name in the title bar
    let timer = null; // delay before showing, so a passing mouse doesn't trigger it
    frame.addEventListener('load', () => { if (frame.getAttribute('src')) peek.classList.add('is-loaded'); }); // fade the page in once it has loaded

    function load(link) { // loads the project page into the window, reloading if theme or language changed
      const key = `${link.href}|${root.dataset.theme || ''}|${lang}`; // what the preview should currently show
      if (frame.dataset.key === key) return; // already showing it
      peek.classList.remove('is-loaded'); // show placeholders while loading
      frame.dataset.key = key; // remember what is loading
      frame.src = link.href; // load the page
    } // end load

    function place(link) { // positions the window just above the button, or below if there's no room
      const r = link.getBoundingClientRect(); // where the button is on screen
      const w = peek.offsetWidth; // window width
      const h = peek.offsetHeight; // window height
      const left = Math.min(Math.max(12, r.left), window.innerWidth - w - 12); // line up with the button, kept on screen
      let top = r.top - h - 12; // try above the button
      let origin = 'left bottom'; // grow upward from the button
      if (top < 76) { top = r.bottom + 12; origin = 'left top'; } // not enough room under the header: go below instead
      peek.style.left = `${left}px`; // horizontal position
      peek.style.top = `${top}px`; // vertical position
      peek.style.setProperty('--origin', origin); // where the grow animation starts
    } // end place

    const hide = () => { clearTimeout(timer); peek.classList.remove('is-open'); }; // cancels and hides the preview
    previewLinks.forEach((link) => { // set up each button
      link.addEventListener('mouseenter', () => { // pointer arrives on the button
        load(link); // start loading straight away so it's ready when shown
        label.textContent = link.dataset.preview; // page name for the title bar
        clearTimeout(timer); // cancel any earlier timer
        timer = setTimeout(() => { place(link); peek.classList.add('is-open'); }, 280); // show after a short pause
      }); // end mouseenter
      link.addEventListener('mouseleave', hide); // pointer leaves: hide
      link.addEventListener('click', hide); // clicked: hide while the page changes
    }); // end button setup
    window.addEventListener('scroll', hide, { passive: true }); // scrolling hides it, so it never floats in the wrong place
  } // end preview
})(); // run the wrapped code immediately
