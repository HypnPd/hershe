/* HERSHE - DJ profile
 *
 * Published as a static page: content.json + assets/uploads/* are the real,
 * public site. "Edit profile" is a personal local draft - it reads and writes
 * only this browser's localStorage (text/links) and IndexedDB (photos/videos
 * you add), and never changes what anyone else sees. To make a change real,
 * ask Claude to update and republish the page.
 */
(() => {
  'use strict';

  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
  const VIDEO_EXT = ['mp4', 'm4v', 'mov', 'webm'];
  const LS_KEY = 'hershe.draft.v1';

  /* ---------- tiny DOM helper ---------- */
  function h(tag, attrs = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null) el.append(kid);
    return el;
  }
  const icon = (name) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'ico'); svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#i-${name}`); svg.append(use); return svg;
  };

  /* ---------- toast ---------- */
  let toastTimer;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('is-on');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('is-on'), 3800);
  }

  /* ---------- local blob storage (IndexedDB) for photos/videos added in Editor mode ---------- */
  const idb = (() => {
    let dbp;
    const open = () => (dbp ??= new Promise((res, rej) => {
      if (!('indexedDB' in window)) return rej(new Error('no indexeddb'));
      const r = indexedDB.open('hershe-media', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('media');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));
    const run = async (mode, fn) => {
      const db = await open();
      return new Promise((res, rej) => {
        const t = db.transaction('media', mode);
        const req = fn(t.objectStore('media'));
        t.oncomplete = () => res(req && req.result);
        t.onerror = t.onabort = () => rej(t.error);
      });
    };
    return {
      put: (id, blob) => run('readwrite', (s) => s.put(blob, id)),
      get: (id) => run('readonly', (s) => s.get(id)),
      del: (id) => run('readwrite', (s) => s.delete(id)),
      clear: () => run('readwrite', (s) => s.clear()),
    };
  })();

  const urlCache = new Map();
  async function mediaUrl(id) {
    if (urlCache.has(id)) return urlCache.get(id);
    try {
      const blob = await idb.get(id);
      if (!blob) return null;
      const u = URL.createObjectURL(blob); urlCache.set(id, u); return u;
    } catch { return null; }
  }
  function dropLocal(id) {
    if (!id) return;
    if (urlCache.has(id)) { URL.revokeObjectURL(urlCache.get(id)); urlCache.delete(id); }
    idb.del(id).catch(() => {});
  }

  /* A ref is either a published static path ("assets/uploads/xxx.jpg") or a
   * locally-added draft blob ("local:<idb-id>"). Both render the same way. */
  const isStaticAsset = (p) => typeof p === 'string' && /^[\w.-]+\.(?:jpe?g|png|webp|gif|mp4|mov|m4v|webm)$/i.test(p) && p !== '.' && p !== '..';
  const isLocalRef = (p) => typeof p === 'string' && /^local:[\w-]+$/.test(p);
  const validRef = (p) => isStaticAsset(p) || isLocalRef(p);

  function setImgSrc(img, ref) {
    if (!ref) return;
    if (isLocalRef(ref)) mediaUrl(ref.slice(6)).then((u) => { if (u) img.src = u; });
    else if (isStaticAsset(ref)) img.src = ref;
  }
  function setBgImage(el, ref) {
    if (!ref) return;
    if (isLocalRef(ref)) mediaUrl(ref.slice(6)).then((u) => { if (u) el.style.backgroundImage = `url("${u}")`; });
    else if (isStaticAsset(ref)) el.style.backgroundImage = `url("${ref}")`;
  }

  async function shrinkImage(file, max = 2000) {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close && bmp.close();
    return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), 'image/jpeg', 0.86));
  }
  async function storeLocalPhoto(file, max) {
    const [full, thumb] = [await shrinkImage(file, max), await shrinkImage(file, 720)];
    const fullId = uid(), thumbId = uid();
    await idb.put(fullId, full); await idb.put(thumbId, thumb);
    return { src: 'local:' + fullId, thumb: 'local:' + thumbId };
  }

  /* ---------- state ---------- */
  const blankVideo = (label = 'Live set') => ({ id: uid(), kind: null, ref: '', label, title: 'Set title' });
  const blankGig = () => ({ id: uid(), title: 'Gig title', place: 'Venue / city', date: 'Date' });
  const defaults = () => ({
    text: {},
    genres: ['House', 'Deep House', 'Electro House', 'R&B'],
    gigs: [blankGig(), blankGig()],
    socials: {},
    hero: [],
    videos: [blankVideo(), blankVideo(), blankVideo()],
    featuredVideo: { id: uid(), kind: null, ref: '', label: 'Highlight', title: 'Live highlight reel' },
    photos: [],
    slots: {},
    booking: { email: '', phone: '', press: '' },
  });

  /** Layer `saved` over `base`: same field-by-field merge for the published
   *  content.json (over hardcoded defaults) and a local draft (over that). */
  function mergeContent(base, saved) {
    if (!saved || typeof saved !== 'object') return base;
    return {
      ...base, ...saved,
      booking: { ...base.booking, ...saved.booking },
      genres: Array.isArray(saved.genres) ? saved.genres : base.genres,
      gigs: Array.isArray(saved.gigs) && saved.gigs.length ? saved.gigs : base.gigs,
      videos: Array.isArray(saved.videos) && saved.videos.length ? saved.videos : base.videos,
      featuredVideo: saved.featuredVideo && typeof saved.featuredVideo === 'object' ? { ...base.featuredVideo, ...saved.featuredVideo } : base.featuredVideo,
      hero: Array.isArray(saved.hero) ? saved.hero.filter((p) => p && validRef(p.src)) : base.hero,
      photos: Array.isArray(saved.photos) ? saved.photos.filter((p) => p && validRef(p.src)) : base.photos,
      slots: { ...base.slots, ...(saved.slots || {}) },
    };
  }

  let state = defaults();
  let hasDraft = false;

  async function loadContent() {
    let baseline = defaults();
    try {
      const r = await fetch('content.json', { cache: 'no-store' });
      if (r.ok) { const j = await r.json(); baseline = mergeContent(baseline, j); }
    } catch { /* published without content.json: show the built-in defaults */ }

    let draft = null;
    try { draft = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { /* private mode or corrupt JSON */ }
    hasDraft = !!draft;
    state = draft ? mergeContent(baseline, draft) : baseline;
  }

  /* ---------- URL / link parsing (unrelated to the ref scheme above) ---------- */
  function toUrl(raw) {
    try {
      const u = new URL(/^https?:\/\//i.test(String(raw).trim()) ? String(raw).trim() : 'https://' + String(raw).trim());
      return /^https?:$/.test(u.protocol) && u.hostname.includes('.') ? u : null;
    } catch { return null; }
  }
  function parseVideo(raw) {
    const u = toUrl(raw); if (!u) return null;
    const host = u.hostname.replace(/^(www|m)\./, '');
    const is = (d) => host === d || host.endsWith('.' + d);
    let id = null;
    if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
    else if (is('youtube.com')) id = u.searchParams.get('v') || (u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]+)/) || [])[1];
    if (id && /^[\w-]{6,15}$/.test(id)) return { kind: 'youtube', ref: id };
    if (is('vimeo.com')) {
      const m = u.pathname.match(/(\d{5,})(?:\/([a-z0-9]+))?/i);
      if (m) return { kind: 'vimeo', ref: m[1] + (m[2] ? `?h=${m[2]}` : '') };
    }
    if (is('soundcloud.com')) return { kind: 'soundcloud', ref: u.href };
    if (/\.(mp4|webm|mov|m4v)$/i.test(u.pathname)) return { kind: 'video', ref: u.href };
    return { kind: 'link', ref: u.href };
  }
  const hostOf = (href) => { try { return new URL(href).hostname.replace(/^www\./, ''); } catch { return 'link'; } };

  /* ---------- saving the local draft ---------- */
  let editing = false, saveTimer = null;
  const setSaveState = (t) => { const el = $('#saveState'); if (el) el.textContent = t; };

  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(LS_KEY, JSON.stringify(state)); hasDraft = true; setSaveState('Draft saved - visible only to you'); }
      catch { toast("Could not save - this browser's storage is full or blocked (private mode?)."); setSaveState('Not saved'); }
    }, 350);
  }

  /* ---------- editable text ---------- */
  const plainOK = (() => { const d = document.createElement('div'); d.setAttribute('contenteditable', 'plaintext-only'); return d.contentEditable === 'plaintext-only'; })();

  function applyEditable(root = document) {
    $$('[data-edit],[data-live]', root).forEach((el) => {
      if (editing) { el.setAttribute('contenteditable', plainOK ? 'plaintext-only' : 'true'); el.spellcheck = false; }
      else el.removeAttribute('contenteditable');
    });
  }
  function live(el, get, set) {
    el.dataset.live = ''; el.textContent = get();
    el.addEventListener('input', () => { set(el.textContent); save(); });
    return el;
  }
  function applyText() {
    $$('[data-edit]').forEach((el) => { const v = state.text[el.dataset.edit]; if (v != null) el.textContent = v; });
    mirrorName();
  }
  function mirrorName() {
    const name = (state.text.name ?? $('[data-edit="name"]').textContent).trim() || 'DJ';
    $$('[data-mirror="name"]').forEach((el) => { el.textContent = name; });
    document.title = name;
  }
  document.addEventListener('input', (e) => {
    const el = e.target.closest && e.target.closest('[data-edit]');
    if (!el) return;
    state.text[el.dataset.edit] = el.textContent; save();
    if (el.dataset.edit === 'name') mirrorName();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches && e.target.matches('[contenteditable]') && !e.target.closest('.gig, .about__text, .booking__info')) {
      e.preventDefault(); e.target.blur();
    }
  });

  /* ---------- replaceable single photos (about portrait, featured backdrop) ---------- */
  function loadSlots() {
    $$('[data-slot]').forEach((fig) => {
      const p = state.slots[fig.dataset.slot];
      if (!validRef(p)) return;
      setImgSrc($('img', fig), p); fig.classList.add('is-custom');
    });
  }
  $$('[data-slot] input[type="file"]').forEach((input) => {
    input.addEventListener('change', async () => {
      const file = input.files[0]; input.value = '';
      if (!file) return;
      const fig = input.closest('[data-slot]'), key = fig.dataset.slot;
      try {
        toast('Adding photo...');
        const blob = await shrinkImage(file, 2000);
        const id = uid(); await idb.put(id, blob);
        const old = state.slots[key]; state.slots[key] = 'local:' + id; save();
        if (isLocalRef(old)) dropLocal(old.slice(6));
        setImgSrc($('img', fig), state.slots[key]); fig.classList.add('is-custom');
        toast('Photo updated (in your draft).');
      } catch { toast('That image could not be read - try a JPG, PNG or WebP.'); }
    });
  });

  /* ---------- hero slider ---------- */
  const heroSlidesEl = $('#heroSlides'), heroDotsEl = $('#heroDots');
  let heroIdx = 0, heroTimer = null;
  const heroReduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function renderHero() {
    heroSlidesEl.replaceChildren(); heroDotsEl.replaceChildren();
    if (heroIdx >= state.hero.length) heroIdx = 0;
    state.hero.forEach((slide, i) => {
      const div = h('div', { class: 'hero__slide' + (i === heroIdx ? ' is-active' : '') });
      setBgImage(div, slide.src);
      heroSlidesEl.append(div);
      heroDotsEl.append(h('button', {
        class: 'hero__dot' + (i === heroIdx ? ' is-active' : ''), type: 'button', role: 'tab',
        'aria-label': `Photo ${i + 1} of ${state.hero.length}`, 'aria-selected': String(i === heroIdx),
        onclick: () => showHero(i, true),
      }));
    });
    $('#heroPrev').hidden = $('#heroNext').hidden = heroDotsEl.hidden = state.hero.length < 2;
    restartHeroTimer();
  }
  function showHero(i, userTriggered) {
    const n = state.hero.length; if (!n) return;
    heroIdx = (i + n) % n;
    $$('.hero__slide', heroSlidesEl).forEach((el, k) => el.classList.toggle('is-active', k === heroIdx));
    $$('.hero__dot', heroDotsEl).forEach((el, k) => { el.classList.toggle('is-active', k === heroIdx); el.setAttribute('aria-selected', String(k === heroIdx)); });
    if (userTriggered) restartHeroTimer();
  }
  function restartHeroTimer() {
    clearInterval(heroTimer); heroTimer = null;
    if (heroReduced || editing || state.hero.length < 2) return;
    heroTimer = setInterval(() => showHero(heroIdx + 1), 5200);
  }
  $('#heroPrev').addEventListener('click', () => showHero(heroIdx - 1, true));
  $('#heroNext').addEventListener('click', () => showHero(heroIdx + 1, true));
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearInterval(heroTimer); else restartHeroTimer(); });

  $('#heroAddInput').addEventListener('change', async (e) => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    if (state.hero.length >= 8) return toast("That's the maximum of 8 hero photos.");
    try {
      toast('Adding photo...');
      const photo = await storeLocalPhoto(file, 2400);
      state.hero.push({ id: uid(), ...photo }); save(); renderHero();
      showHero(state.hero.length - 1, true);
      toast('Hero photo added (in your draft).');
    } catch { toast('That image could not be read - try a JPG, PNG or WebP.'); }
  });
  $('#heroRemoveBtn').addEventListener('click', () => {
    if (state.hero.length <= 1) return toast('Keep at least one hero photo - add another before removing this one.');
    const [gone] = state.hero.splice(heroIdx, 1);
    if (isLocalRef(gone.src)) dropLocal(gone.src.slice(6));
    if (isLocalRef(gone.thumb)) dropLocal(gone.thumb.slice(6));
    save(); renderHero(); toast('Hero photo removed from your draft.');
  });

  /* ---------- genres ---------- */
  function renderGenres() {
    const ul = $('#genres'); ul.replaceChildren();
    state.genres.forEach((name, i) => {
      ul.append(h('li', {},
        icon('disc'),
        h('span', { text: name }),
        h('button', {
          class: 'chip__x edit-only', type: 'button', style: 'background:none;border:0;color:inherit;padding:0;margin-left:4px;cursor:pointer',
          'aria-label': `Remove ${name}`, onclick: () => { state.genres.splice(i, 1); save(); renderGenres(); },
        }, icon('x'))));
    });
    const input = h('input', {
      type: 'text', placeholder: 'Add a genre', 'aria-label': 'Add a genre', maxlength: 24,
      style: 'background:none;border:0;border-bottom:1px solid var(--line-dark);color:inherit;width:110px;font:inherit',
    });
    const add = () => { const v = input.value.trim(); if (!v) return; state.genres.push(v); save(); renderGenres(); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    ul.append(h('li', { class: 'edit-only' }, input,
      h('button', { type: 'button', style: 'background:none;border:0;color:var(--pink);cursor:pointer', 'aria-label': 'Add genre', onclick: add }, icon('plus'))));
  }

  /* ---------- gigs ---------- */
  function renderGigs() {
    const grid = $('#gigsGrid'); grid.replaceChildren();
    state.gigs.forEach((g, i) => {
      const card = h('article', { class: 'gig' },
        live(h('p', { class: 'gig__date' }), () => g.date, (t) => { g.date = t; }),
        live(h('h3', { class: 'gig__title' }), () => g.title, (t) => { g.title = t; }),
        h('p', { class: 'gig__place' }, icon('pin'), live(h('span', {}), () => g.place, (t) => { g.place = t; })),
      );
      if (state.gigs.length > 1) {
        card.append(h('div', { class: 'gig__tools' },
          h('button', { type: 'button', onclick: () => { state.gigs.splice(i, 1); save(); renderGigs(); } }, 'Remove')));
      }
      grid.append(card);
    });
    applyEditable(grid);
  }
  $('#addGig').addEventListener('click', () => {
    if (state.gigs.length >= 12) return toast("That's the maximum of 12 gigs.");
    state.gigs.push(blankGig()); save(); renderGigs();
  });

  /* ---------- videos (sets grid + featured single) ---------- */
  const syncs = new Set();
  function renderVideos() {
    const grid = $('#videoGrid'); grid.replaceChildren(); syncs.clear();
    grid.classList.toggle('has-content', state.videos.some((v) => v.kind));
    state.videos.forEach((v, i) => grid.append(videoCard(v, i)));
    applyEditable(grid);
    renderFeatured();
  }

  function videoCard(v, i) {
    const card = h('article', { class: 'vcard' + (v.kind ? '' : ' is-empty') });
    card.append(
      live(h('p', { class: 'vcard__label' }), () => v.label, (t) => { v.label = t; }),
      live(h('h3', { class: 'vcard__title' }), () => v.title, (t) => { v.title = t; }),
      mediaFor(v, renderVideos),
    );
    const tools = h('div', { class: 'vtools' });
    if (v.kind) tools.append(h('button', { type: 'button', onclick: () => {
      if (v.kind === 'file' && isLocalRef(v.ref)) dropLocal(v.ref.slice(6));
      Object.assign(v, { kind: null, ref: '' }); save(); renderVideos();
    } }, 'Replace'));
    if (state.videos.length > 1) tools.append(h('button', { type: 'button', onclick: () => {
      if (v.kind === 'file' && isLocalRef(v.ref)) dropLocal(v.ref.slice(6));
      state.videos.splice(i, 1); save(); renderVideos();
    } }, 'Delete slot'));
    card.append(tools);
    return card;
  }

  function renderFeatured() {
    const box = $('#featuredMedia'); box.replaceChildren();
    box.append(mediaFor(state.featuredVideo, renderVideos, true));
    if (state.featuredVideo.kind) {
      box.append(h('div', { class: 'vtools edit-only', style: 'justify-content:center' },
        h('button', { type: 'button', onclick: () => {
          if (state.featuredVideo.kind === 'file' && isLocalRef(state.featuredVideo.ref)) dropLocal(state.featuredVideo.ref.slice(6));
          Object.assign(state.featuredVideo, { kind: null, ref: '' }); save(); renderVideos();
        } }, 'Replace')));
    }
  }

  function mediaFor(v, onChange, isFeatured) {
    const box = h('div', { class: 'vmedia' });
    switch (v.kind) {
      case 'youtube':
        box.append(facade({ bg: `https://i.ytimg.com/vi/${v.ref}/hqdefault.jpg`, host: 'YouTube', src: `https://www.youtube-nocookie.com/embed/${v.ref}?autoplay=1&rel=0`, title: v.title }));
        break;
      case 'vimeo':
        box.append(facade({ host: 'Vimeo', src: `https://player.vimeo.com/video/${v.ref}${v.ref.includes('?') ? '&' : '?'}autoplay=1`, title: v.title }));
        break;
      case 'soundcloud':
        box.append(facade({ host: 'SoundCloud', src: `https://w.soundcloud.com/player/?url=${encodeURIComponent(v.ref)}&auto_play=true&visual=true`, title: v.title }));
        break;
      case 'video':
        if (toUrl(v.ref)) box.append(videoEl(v.ref, box));
        break;
      case 'file':
        if (validRef(v.ref)) box.append(videoEl(v.ref, box));
        break;
      case 'link':
        if (toUrl(v.ref)) box.append(h('a', { class: 'vmedia__link', href: v.ref, target: '_blank', rel: 'noopener noreferrer' }, icon('arrow'), `Watch on ${hostOf(v.ref)}`));
        break;
      default:
        box.classList.add('vmedia--empty');
        box.append(emptyVideoUI(v, onChange, isFeatured));
    }
    return box;
  }

  function facade({ bg, host, src, title }) {
    const btn = h('button', { class: 'vmedia__facade', type: 'button', 'aria-label': `Play ${title || 'video'}` },
      h('span', { class: 'vmedia__play' }, icon('play')), h('span', { class: 'vmedia__host', text: host }));
    if (bg) btn.style.backgroundImage = `url("${bg}")`;
    btn.addEventListener('click', () => {
      btn.replaceWith(h('iframe', {
        src, title: title || 'Video', allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
        allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin',
      }));
    });
    return btn;
  }

  function videoEl(ref, box) {
    const vid = h('video', { controls: true, playsinline: true, preload: 'metadata' });
    vid.addEventListener('error', () => {
      if (!box.querySelector('.vmedia__error'))
        box.append(h('div', { class: 'vmedia__error', text: "This browser can't play that file. Try an MP4 (H.264) export." }));
    });
    if (isLocalRef(ref)) mediaUrl(ref.slice(6)).then((u) => { if (u) vid.src = u + '#t=0.1'; });
    else vid.src = ref;
    return vid;
  }

  function emptyVideoUI(v, onChange, isFeatured) {
    const view = [icon('play'), h('p', { class: 'view-hint', text: isFeatured ? 'Highlight reel coming soon' : 'Video coming soon' })];
    const err = h('p', { class: 'vform__err', role: 'alert' });
    const url = h('input', { type: 'url', placeholder: 'YouTube / Vimeo / SoundCloud link', 'aria-label': 'Video link' });
    const submit = () => {
      const p = parseVideo(url.value);
      if (!p) { err.textContent = "That doesn't look like a valid link."; return; }
      Object.assign(v, p); save(); onChange();
    };
    url.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });

    const file = h('input', { type: 'file', accept: 'video/mp4,video/quicktime,video/webm,.mp4,.m4v,.mov,.webm', hidden: true });
    file.addEventListener('change', async () => {
      const f = file.files[0]; file.value = '';
      if (!f) return;
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      if (!VIDEO_EXT.includes(ext)) return toast('Use an MP4, MOV, M4V or WebM file.');
      try {
        toast(`Adding ${f.name}...`);
        const id = uid(); await idb.put(id, f);
        Object.assign(v, { kind: 'file', ref: 'local:' + id }); save(); onChange(); toast('Video added (in your draft).');
      } catch { toast('Could not store that file in this browser (storage full?).'); }
    });
    const pick = h('label', { class: 'btn btn--line', tabindex: '0', onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } } }, 'Upload video', file);
    pick.addEventListener('click', (e) => { if (e.target !== file) { e.preventDefault(); file.click(); } });

    const form = h('div', { class: 'vform' }, url,
      h('button', { class: 'btn btn--solid', type: 'button', onclick: submit }, 'Add link'),
      h('span', { class: 'vform__or', text: 'or' }), pick, err);

    const holder = h('div', {});
    const sync = () => holder.replaceChildren(...(editing ? [form] : view));
    sync(); syncs.add(sync);
    return holder;
  }

  $('#addVideoSlot').addEventListener('click', () => {
    if (state.videos.length >= 12) return toast("That's the maximum of 12 video slots.");
    state.videos.push(blankVideo()); save(); renderVideos();
  });

  /* ---------- gallery ---------- */
  const gallery = $('#galleryGrid');

  function renderGallery() {
    gallery.replaceChildren();
    gallery.classList.toggle('has-content', state.photos.length > 0);

    state.photos.forEach((p, i) => {
      const img = h('img', { alt: `Gallery photo ${i + 1}`, loading: 'lazy', decoding: 'async' });
      setImgSrc(img, (p.thumb && validRef(p.thumb)) ? p.thumb : p.src);
      img.addEventListener('load', () => img.classList.add('is-loaded'));
      if (img.complete) img.classList.add('is-loaded');
      const open = h('button', { class: 'tile__open', type: 'button', 'aria-label': `Open photo ${i + 1} of ${state.photos.length}`, onclick: () => openLightbox(i) }, img);
      const del = h('button', {
        class: 'tile__del', type: 'button', 'aria-label': `Remove photo ${i + 1}`,
        onclick: () => {
          if (isLocalRef(p.src)) dropLocal(p.src.slice(6));
          if (isLocalRef(p.thumb)) dropLocal(p.thumb.slice(6));
          state.photos.splice(i, 1); save(); renderGallery();
        },
      }, icon('x'));
      gallery.append(h('figure', { class: 'tile' }, open, del));
    });

    if (!state.photos.length)
      for (let n = 1; n <= 6; n++) gallery.append(h('div', { class: 'tile tile--empty', 'aria-hidden': 'true', text: String(n).padStart(2, '0') }));

    const input = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
    input.addEventListener('change', () => { addPhotos([...input.files]); input.value = ''; });
    gallery.append(h('label', { class: 'tile tile--add edit-only' }, icon('plus'), 'Add photos', input));
  }

  async function addPhotos(files) {
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (!images.length) return toast('Please choose image files (JPG, PNG, WebP).');
    let added = 0, unreadable = 0;
    for (const [n, f] of images.entries()) {
      toast(`Adding photo ${n + 1} of ${images.length}...`);
      try { state.photos.push(await storeLocalPhoto(f, 2000)); added++; }
      catch { unreadable++; }
    }
    save(); renderGallery();
    toast(unreadable
      ? `${added} added, ${unreadable} couldn't be read (HEIC isn't supported in most browsers - export as JPG).`
      : added ? `${added} photo${added > 1 ? 's' : ''} added to your draft.` : 'No photos were added.');
  }

  ['dragenter', 'dragover'].forEach((t) => gallery.addEventListener(t, (e) => {
    if (!editing) return; e.preventDefault(); gallery.classList.add('is-drop');
  }));
  gallery.addEventListener('dragleave', (e) => { if (!gallery.contains(e.relatedTarget)) gallery.classList.remove('is-drop'); });
  gallery.addEventListener('drop', (e) => {
    gallery.classList.remove('is-drop');
    if (!editing) return; e.preventDefault(); addPhotos([...e.dataTransfer.files]);
  });

  /* ---------- lightbox ---------- */
  const lb = $('#lightbox'), lbImg = $('#lbImg'), lbCount = $('#lbCount');
  let lbIndex = 0;
  function showLb(i) {
    const n = state.photos.length; if (!n) return;
    lbIndex = (i + n) % n;
    setImgSrc(lbImg, state.photos[lbIndex].src);
    lbImg.alt = `Gallery photo ${lbIndex + 1}`;
    lbCount.textContent = `${lbIndex + 1} / ${n}`;
  }
  function openLightbox(i) { showLb(i); if (!lb.open) lb.showModal(); }
  $('#lbClose').addEventListener('click', () => lb.close());
  $('#lbPrev').addEventListener('click', () => showLb(lbIndex - 1));
  $('#lbNext').addEventListener('click', () => showLb(lbIndex + 1));
  lb.addEventListener('click', (e) => { if (e.target === lb) lb.close(); });
  lb.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') showLb(lbIndex - 1);
    if (e.key === 'ArrowRight') showLb(lbIndex + 1);
  });

  /* ---------- socials ---------- */
  const NETWORKS = [
    { key: 'instagram',  name: 'Instagram',  cta: 'Follow', blurb: 'Behind the decks and behind the scenes.', base: 'https://instagram.com/' },
    { key: 'tiktok',     name: 'TikTok',     cta: 'Follow', blurb: 'Clips straight from the floor.',          base: 'https://tiktok.com/@' },
    { key: 'soundcloud', name: 'SoundCloud', cta: 'Listen', blurb: 'Mixes, edits and unreleased tracks.',     base: 'https://soundcloud.com/' },
    { key: 'spotify',    name: 'Spotify',    cta: 'Listen', blurb: 'Playlists and releases.',                 base: null },
    { key: 'youtube',    name: 'YouTube',    cta: 'Watch',  blurb: 'Full sets on video.',                     base: 'https://youtube.com/@' },
    { key: 'mixcloud',   name: 'Mixcloud',   cta: 'Listen', blurb: 'Long-form radio shows and mixes.',        base: 'https://mixcloud.com/' },
  ];

  function normalizeSocial(net, raw) {
    raw = raw.trim(); if (!raw) return '';
    const isHandle = raw.startsWith('@') || (!raw.includes('.') && !raw.includes('/'));
    if (isHandle) {
      if (!net.base) return null;
      const name = raw.replace(/^@/, '');
      return /^[\w.-]+$/.test(name) ? net.base + name : null;
    }
    const u = toUrl(raw); return u ? u.href : null;
  }
  function handleFor(net, href) {
    try {
      const u = new URL(href), seg = u.pathname.replace(/^\/|\/$/g, '').split('/')[0];
      if (net.base && seg) return seg.startsWith('@') ? seg : '@' + seg;
      return u.hostname.replace(/^www\./, '');
    } catch { return net.blurb; }
  }
  const socialHref = (net) => { const u = state.socials[net.key] && toUrl(state.socials[net.key]); return u ? u.href : ''; };
  const anySocial = () => NETWORKS.some(socialHref);

  function socialLink(net) {
    const href = socialHref(net);
    const inner = [
      h('span', { class: 'srow__name', text: net.name }),
      h('span', { class: 'srow__blurb', text: href ? handleFor(net, href) : net.blurb }),
      h('span', { class: 'srow__go' }, href ? net.cta : 'Coming soon', href ? icon('arrow') : null),
    ];
    return href
      ? h('a', { class: 'srow__link', href, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `${net.name} (opens in a new tab)` }, ...inner)
      : h('div', { class: 'srow__link' }, ...inner);
  }

  function renderSocials() {
    const ul = $('#socials'); ul.replaceChildren();
    ul.classList.toggle('has-content', anySocial());
    NETWORKS.forEach((net) => {
      const li = h('li', { class: 'srow' + (socialHref(net) ? '' : ' is-empty') });
      li.append(socialLink(net));

      const err = h('span', { class: 'srow__err', role: 'alert' });
      const input = h('input', {
        type: 'text', value: state.socials[net.key] || '', autocomplete: 'off', spellcheck: 'false',
        'aria-label': `${net.name} link`,
        placeholder: net.base ? '@handle or profile link' : 'Profile link (https://...)',
      });
      const commit = () => {
        const n = normalizeSocial(net, input.value);
        if (n === null) { err.textContent = net.base ? 'Use an @handle or a full link.' : 'Paste the full profile link.'; input.setAttribute('aria-invalid', 'true'); return; }
        err.textContent = ''; input.removeAttribute('aria-invalid');
        if ((state.socials[net.key] || '') === n) return;
        if (n) state.socials[net.key] = n; else delete state.socials[net.key];
        input.value = n; save();
        li.firstElementChild.replaceWith(socialLink(net));
        li.classList.toggle('is-empty', !n); ul.classList.toggle('has-content', anySocial());
        renderFooterSocials();
      };
      input.addEventListener('change', commit);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
      li.append(h('label', { class: 'srow__edit' }, h('span', { class: 'field__name', text: net.name }), input, err));
      ul.append(li);
    });
    renderFooterSocials();
  }
  function renderFooterSocials() {
    const ul = $('#footerSocials'); ul.replaceChildren();
    NETWORKS.filter(socialHref).forEach((n) =>
      ul.append(h('li', {}, h('a', { href: socialHref(n), target: '_blank', rel: 'noopener noreferrer' }, n.name))));
  }

  /* ---------- booking ---------- */
  const emailOK = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
  function renderBooking() {
    const email = emailOK(state.booking.email || '') ? state.booking.email : '';
    const mail = $('#mailLink'), footerMail = $('#footerMail');
    mail.textContent = email || 'booking@yourdomain.com';
    mail.href = email ? `mailto:${email}` : '#booking';
    footerMail.textContent = email || 'booking@yourdomain.com';
    footerMail.href = email ? `mailto:${email}` : '#booking';

    const phone = (state.booking.phone || '').trim();
    $('#phoneWrap').classList.toggle('is-unset', !phone);
    $('#phoneLink').href = 'tel:' + phone.replace(/[^+\d]/g, ''); $('#phoneLink').textContent = phone;
    const footerPhone = $('#footerPhone');
    if (phone) { footerPhone.hidden = false; footerPhone.href = 'tel:' + phone.replace(/[^+\d]/g, ''); footerPhone.textContent = phone; }
    else footerPhone.hidden = true;

    const pu = state.booking.press && toUrl(state.booking.press);
    $('#pressWrap').classList.toggle('is-unset', !pu);
    if (pu) $('#pressLink').href = pu.href;
  }
  $('#emailInput').addEventListener('change', (e) => {
    const v = e.target.value.trim();
    if (v && !emailOK(v)) { e.target.setAttribute('aria-invalid', 'true'); return toast("That email address doesn't look right."); }
    e.target.removeAttribute('aria-invalid'); state.booking.email = v; save(); renderBooking();
  });
  $('#phoneInput').addEventListener('change', (e) => {
    state.booking.phone = e.target.value.trim(); save(); renderBooking();
  });
  $('#pressInput').addEventListener('change', (e) => {
    const v = e.target.value.trim();
    if (v && !toUrl(v)) { e.target.setAttribute('aria-invalid', 'true'); return toast('Paste a full link (https://...).'); }
    e.target.removeAttribute('aria-invalid'); state.booking.press = v ? toUrl(v).href : ''; save(); renderBooking();
  });

  const form = $('#bookingForm'), formErr = $('#formError');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(form));
    $$('[aria-invalid]', form).forEach((el) => el.removeAttribute('aria-invalid'));
    const bad = [];
    if (!d.name.trim()) bad.push('name');
    if (!emailOK(String(d.email).trim())) bad.push('email');
    if (!d.message.trim()) bad.push('message');
    if (bad.length) {
      bad.forEach((n) => form.elements[n].setAttribute('aria-invalid', 'true'));
      formErr.textContent = `Please fill in: ${bad.join(', ')}.`; form.elements[bad[0]].focus(); return;
    }
    formErr.textContent = '';
    const to = state.booking.email;
    if (!emailOK(to || '')) return toast("Booking email isn't set up yet.");
    const subject = `Booking enquiry${d.event ? ' - ' + d.event : ''}`;
    const body = [`Name: ${d.name}`, `Email: ${d.email}`, `Event / venue: ${d.event || '-'}`, `Date: ${d.date || '-'}`, '', d.message].join('\n');
    location.href = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    toast('Opening your email app...');
  });

  /* ---------- edit mode ---------- */
  const editBtn = $('#editToggle');

  function setEditing(on) {
    editing = on;
    document.body.classList.toggle('is-editing', on);
    editBtn.setAttribute('aria-pressed', String(on));
    editBtn.textContent = on ? 'Done' : 'Edit profile';
    $('#emailInput').value = state.booking.email || ''; $('#phoneInput').value = state.booking.phone || ''; $('#pressInput').value = state.booking.press || '';
    applyEditable();
    syncs.forEach((fn) => fn());
    restartHeroTimer();
    setSaveState(hasDraft ? 'Draft saved - visible only to you' : 'Editing - visible only to you');
  }
  editBtn.addEventListener('click', () => {
    const turningOn = !editing;
    setEditing(turningOn);
    if (turningOn) toast('Editing on - this is a personal draft. It saves only in this browser, not to the published site.');
  });

  $('#resetDraft').addEventListener('click', async () => {
    if (!confirm('Discard your local draft and go back to the published version? This only affects this browser.')) return;
    try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
    try { await idb.clear(); } catch { /* ignore */ }
    location.reload();
  });

  /* ---------- nav, header, reveal ---------- */
  const header = $('#siteHeader'), nav = $('#nav'), menuBtn = $('#menuToggle');
  const onScroll = () => header.classList.toggle('is-solid', window.scrollY > 40);
  onScroll(); addEventListener('scroll', onScroll, { passive: true });
  const closeMenu = () => { menuBtn.setAttribute('aria-expanded', 'false'); nav.classList.remove('is-open'); };
  menuBtn.addEventListener('click', () => {
    const open = menuBtn.getAttribute('aria-expanded') !== 'true';
    menuBtn.setAttribute('aria-expanded', String(open)); nav.classList.toggle('is-open', open);
  });
  nav.addEventListener('click', (e) => { if (e.target.closest('a')) closeMenu(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && nav.classList.contains('is-open')) { closeMenu(); menuBtn.focus(); } });

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const reveals = $$('.reveal');
  if ('IntersectionObserver' in window && !reduced) {
    const io = new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); } }), { threshold: .12 });
    reveals.forEach((el) => io.observe(el));
  } else reveals.forEach((el) => el.classList.add('is-in'));

  const links = $$('.nav a');
  if ('IntersectionObserver' in window) {
    const spy = new IntersectionObserver((entries) => entries.forEach((en) => {
      if (!en.isIntersecting) return;
      links.forEach((a) => a.setAttribute('aria-current', String(a.getAttribute('href') === '#' + en.target.id)));
    }), { rootMargin: '-45% 0px -50% 0px' });
    ['about', 'gigs', 'sets', 'gallery', 'connect', 'booking'].forEach((id) => spy.observe($('#' + id)));
  }

  /* ---------- boot ---------- */
  (async () => {
    $('#year').textContent = new Date().getFullYear();
    await loadContent();
    applyText();
    renderGenres(); renderGigs(); renderHero(); renderVideos(); renderGallery(); renderSocials(); renderBooking();
    loadSlots(); applyEditable();
    setSaveState(hasDraft ? 'Draft saved - visible only to you' : 'Local draft - visible only to you');

    // The editor UI (the "Edit profile" bar) only appears when the page is
    // opened with ?edit in the URL - a plain shared link never shows it.
    const isEditorLink = new URLSearchParams(location.search).has('edit');
    $('.editbar').hidden = !isEditorLink;
    if (isEditorLink) {
      setEditing(true);
      setTimeout(() => toast('Editor link open - changes save only in this browser, not to the published site.'), 1200);
    }
  })();
})();
