/* Onur KAN — website runtime.
   Renders the page template (the <template id="page"> block in index.html)
   with the page logic below, using Preact (assets/js/preact.min.js) to update
   the screen. You normally never need to edit this file: texts and pictures
   are set in index.html (SITE settings) and in the page logic further down. */
(function () {
  'use strict';
  var h = preact.h;
  var SITE = window.SITE || {};

  /* ---------- helpers used by the page logic ---------- */

  // Built-in data (course details and translations) is stored in
  // assets/data/site-data.js so the site also works when opened from disk.
  function siteFetch(url) {
    var data = window.SITE_DATA && window.SITE_DATA[url];
    if (data === undefined) return fetch(url);
    return Promise.resolve({ json: function () { return Promise.resolve(JSON.parse(JSON.stringify(data))); } });
  }

  // Picture names used by the page -> real file paths in the images folder.
  function siteImages() {
    var out = {};
    var folder = SITE.imagesFolder || 'images/';
    var map = SITE.images || {};
    Object.keys(map).forEach(function (k) {
      out[k] = folder + String(map[k]).split('/').map(encodeURIComponent).join('/');
    });
    return out;
  }

  // If a picture is not found, try the same name with another extension
  // (.jpg / .jpeg / .png ...), because Windows hides extensions and GitHub
  // is case-sensitive. If nothing works, the picture area stays empty.
  var EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.PNG', '.JPG', '.JPEG', '.GIF'];
  function siteImgFallback(e) {
    var el = e && e.currentTarget;
    if (!el) return;
    var base = el.getAttribute('data-src') || '';
    if (el.__base !== base) { el.__base = base; el.__try = 0; }
    var m = base.match(/^(.*)(\.[A-Za-z0-9]+)$/);
    if (m) {
      while (el.__try < EXTS.length) {
        var ext = EXTS[el.__try++];
        if (ext !== m[2]) { el.src = m[1] + ext; return; }
      }
    }
    el.style.visibility = 'hidden';
    if (window.console) console.warn('Picture not found: ' + decodeURIComponent(base));
  }
  function siteImgOk(e) {
    var el = e && e.currentTarget;
    if (el) el.style.visibility = '';
  }

  /* ---------- template compiler ---------- */

  var HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;

  // Same whitespace rule as JSX: text containing line breaks is trimmed line
  // by line, so indentation between tags never adds stray spaces.
  function jsxText(s) {
    if (s.indexOf('\n') < 0 && s.indexOf('\r') < 0) return s;
    var lines = s.split(/\r\n|\n|\r/);
    var out = '';
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].replace(/\t/g, ' ');
      if (i > 0) t = t.replace(/^ +/, '');
      if (i < lines.length - 1) t = t.replace(/ +$/, '');
      if (t) out += (out ? ' ' : '') + t;
    }
    return out;
  }

  function parseParts(s) {
    var parts = [], last = 0, m;
    HOLE.lastIndex = 0;
    while ((m = HOLE.exec(s))) {
      if (m.index > last) parts.push(s.slice(last, m.index));
      parts.push({ e: m[1] });
      last = HOLE.lastIndex;
    }
    if (last < s.length) parts.push(s.slice(last));
    return parts;
  }

  function compileValue(v) {
    var p = parseParts(v || '');
    if (p.length === 1 && typeof p[0] === 'object') return { whole: p[0].e };
    for (var i = 0; i < p.length; i++) if (typeof p[i] === 'object') return { parts: p };
    return { lit: v };
  }

  function compileKids(node) {
    var out = [];
    var kids = node.childNodes;
    for (var i = 0; i < kids.length; i++) {
      var c = compile(kids[i]);
      if (c) out.push(c);
    }
    return out;
  }

  // Every element of the template gets a stable id, used as its Preact key, so
  // elements that appear or disappear (<sc-if>, <sc-for>) never get mixed up
  // with their neighbours when the page updates.
  var nextId = 0;

  function compile(node) {
    if (node.nodeType === 3) {
      var t = jsxText(node.nodeValue);
      if (!t) return null;
      var v = compileValue(t);
      return { t: 'text', v: v };
    }
    if (node.nodeType !== 1) return null;
    var tag = node.localName;
    if (tag === 'sc-if') return { t: 'if', e: compileValue(node.getAttribute('value')), kids: compileKids(node) };
    if (tag === 'sc-for') return { t: 'for', e: compileValue(node.getAttribute('list')), as: node.getAttribute('as') || 'item', kids: compileKids(node) };
    var attrs = [];
    for (var i = 0; i < node.attributes.length; i++) {
      var a = node.attributes[i];
      if (a.name.indexOf('hint-') === 0) continue;
      attrs.push([a.name, compileValue(a.value)]);
    }
    return { t: 'el', id: 'n' + (nextId++), tag: tag, attrs: attrs, kids: compileKids(node) };
  }

  /* ---------- rendering ---------- */

  function lookup(expr, scope) {
    expr = expr.trim();
    if (expr === 'true') return true;
    if (expr === 'false') return false;
    if (expr === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(expr)) return +expr;
    if (/^'.*'$|^".*"$/.test(expr)) return expr.slice(1, -1);
    var segs = expr.split('.');
    var s = scope, cur;
    while (s) {
      if (Object.prototype.hasOwnProperty.call(s.vars, segs[0])) { cur = s.vars[segs[0]]; break; }
      s = s.parent;
    }
    if (!s) return undefined;
    for (var i = 1; i < segs.length; i++) {
      if (cur === null || cur === undefined) return undefined;
      cur = cur[segs[i]];
    }
    return cur;
  }

  function evalValue(v, scope) {
    if (v.lit !== undefined) return v.lit;
    if (v.whole !== undefined) return lookup(v.whole, scope);
    var s = '';
    for (var i = 0; i < v.parts.length; i++) {
      var p = v.parts[i];
      if (typeof p === 'string') s += p;
      else { var x = lookup(p.e, scope); if (x !== undefined && x !== null && x !== false) s += String(x); }
    }
    return s;
  }

  function buildKids(list, scope) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var r = build(list[i], scope);
      if (r === null || r === undefined) continue;
      if (Array.isArray(r)) { for (var j = 0; j < r.length; j++) if (r[j] !== null && r[j] !== undefined) out.push(r[j]); }
      else out.push(r);
    }
    return out;
  }

  function handler(fn) {
    return function (e) { return fn.call(this, e); };
  }

  var VOID = { img: 1, br: 1, hr: 1, input: 1, meta: 1, link: 1, source: 1, wbr: 1 };

  function build(node, scope) {
    if (node.t === 'text') {
      var tv = evalValue(node.v, scope);
      return (tv === undefined || tv === null || tv === false) ? null : String(tv);
    }
    if (node.t === 'if') return evalValue(node.e, scope) ? buildKids(node.kids, scope) : null;
    if (node.t === 'for') {
      var list = evalValue(node.e, scope) || [];
      var out = [];
      for (var i = 0; i < list.length; i++) {
        var vars = { $index: i };
        vars[node.as] = list[i];
        var kids = buildKids(node.kids, { vars: vars, parent: scope, loop: (scope.loop || '') + ':' + i });
        for (var k = 0; k < kids.length; k++) out.push(kids[k]);
      }
      return out;
    }
    var props = { key: node.id + (scope.loop || '') };
    for (var a = 0; a < node.attrs.length; a++) {
      var name = node.attrs[a][0];
      var val = evalValue(node.attrs[a][1], scope);
      if (name === 'ref') {
        if (typeof val === 'function') props.ref = val;
        continue;
      }
      if (name[0] === 'o' && name[1] === 'n') {
        // Each element gets its own handler function: Preact stores event
        // bookkeeping on the function, so one function shared by several
        // elements (like "stop") must not be passed around as-is.
        if (typeof val === 'function') props[name] = handler(val);
        continue;
      }
      if (val === undefined || val === null || val === false) continue;
      props[name] = val;
    }
    if (VOID[node.tag]) return h(node.tag, props);
    return h(node.tag, props, buildKids(node.kids, scope));
  }

  /* ---------- component base (React-like) ---------- */

  var app = { comp: null, root: null, tree: null, pending: false, mounted: false, lastState: null };

  function render() {
    var vals = app.comp.renderVals();
    var kids = buildKids(app.tree, { vars: vals, parent: null });
    preact.render(kids.length === 1 ? kids[0] : h(preact.Fragment, null, kids), app.root);
  }

  function flush() {
    app.pending = false;
    var prev = app.lastState;
    render();
    app.lastState = app.comp.state;
    if (app.comp.componentDidUpdate) app.comp.componentDidUpdate(app.comp.props, prev);
  }

  function schedule() {
    if (!app.mounted || app.pending) return;
    app.pending = true;
    Promise.resolve().then(flush);
  }

  function DCLogic(props) {
    this.props = props || {};
    this.state = {};
  }
  DCLogic.prototype.setState = function (patch) {
    if (typeof patch === 'function') patch = patch(this.state, this.props);
    this.state = Object.assign({}, this.state, patch || {});
    schedule();
  };
  DCLogic.prototype.forceUpdate = function () { schedule(); };

  /* ---------- page logic (texts, data and behaviour) ---------- */

  class Component extends DCLogic {
    componentDidMount() {
      try { this.noHover = !!(window.matchMedia && (window.matchMedia('(hover: none)').matches || window.matchMedia('(max-width: 700px)').matches)); if (this.noHover) this.forceUpdate(); } catch (e) {}
      var self = this;
      try {
        siteFetch('data/courses.json')
          .then(function (r) { return r.json(); })
          .then(function (d) { if (Array.isArray(d) && d.length) self.setState({ coursesData: d }); })
          .catch(function () {});
      } catch (e) {}
    }
    componentDidUpdate(prevProps, prevState) {
      var was = prevState && prevState.open;
      var now = this.state && this.state.open;
      try {
        if (now && now !== was && this.closeBtn) this.closeBtn.focus();
        if (!now && was && this.opener && this.opener.focus) this.opener.focus();
        var zWas = !!(prevState && prevState.lpZoom), zNow = !!(this.state && this.state.lpZoom);
        if (zNow && !zWas && this.zoomCloseBtn) this.zoomCloseBtn.focus();
        if (!zNow && zWas && this.zoomOpener && this.zoomOpener.focus) this.zoomOpener.focus({ preventScroll: true });
        try { var lg = (this.state && this.state.lang) || 'en'; if (document.documentElement.lang !== lg) document.documentElement.lang = lg; } catch (e) {}
        var lWas = prevState && typeof prevState.lpOpen === 'number' ? prevState.lpOpen : -1;
        var lNow = this.state && typeof this.state.lpOpen === 'number' ? this.state.lpOpen : -1;
        if (lNow !== lWas) {
          var lf = lNow >= 0 ? document.getElementById('lp-back') : document.getElementById('lp-card-' + ((this.state && this.state.lp) || 'learn') + '-' + lWas);
          if (lf && lf.focus) lf.focus({ preventScroll: true });
        }
        var dWas = prevState && typeof prevState.pjd === 'number' ? prevState.pjd : -1;
        var dNow = this.state && typeof this.state.pjd === 'number' ? this.state.pjd : -1;
        if (dNow !== dWas) {
          var df = dNow >= 0 ? document.getElementById('pjs-back-' + dNow) : ((this.state && this.state.pjs) === dWas ? document.getElementById('pjs-card-' + dWas) : null);
          if (df && df.focus) df.focus({ preventScroll: true });
        }
        var pWas = prevState && typeof prevState.pj === 'number' ? prevState.pj : -1;
        var pNow = this.state && typeof this.state.pj === 'number' ? this.state.pj : -1;
        if (pNow !== pWas) {
          var ph = document.getElementById('pj-head-' + (pNow >= 0 ? pNow : pWas));
          if (ph && ph.focus) ph.focus({ preventScroll: true });
          var pc = document.getElementById('pj-card-' + (pNow >= 0 ? pNow : pWas));
          if (pc && pc.scrollIntoView) pc.scrollIntoView({ behavior: 'smooth', block: pNow >= 0 ? 'start' : 'nearest' });
        }
        var cWas = prevState && typeof prevState.course === 'number' ? prevState.course : -1;
        var cNow = this.state && typeof this.state.course === 'number' ? this.state.course : -1;
        if (cNow >= 0 && cNow !== cWas && this.courseCloseBtn) this.courseCloseBtn.focus();
        if (cNow < 0 && cWas >= 0 && now && this.courseOpener && this.courseOpener.focus) this.courseOpener.focus();
      } catch (e) {}
    }
    renderVals() {
      var self = this;
      var palettes = {
        'Porcelain & Ink': { bg: '#EAEAE6', bar: '#DCDCD6', line: '#B9B9B2', panel: '#FAFAF8' },
        'Glacier': { bg: '#EEF2F5', bar: '#DCE4EA', line: '#AEBBC5', panel: '#F8FAFC' },
        'Stone & Sage': { bg: '#F0F2EE', bar: '#DFE4DB', line: '#B3BCAE', panel: '#F8F9F6' }
      };
      var p = palettes[this.props.palette] || palettes['Porcelain & Ink'];
      var sageOn = (this.props.background || 'White brush strokes') === 'Sage wall';
      if (sageOn) p = { bg: p.bg, bar: '#E4E9E3', line: 'rgba(0, 0, 0, 0.28)', panel: p.panel };
      var lampOn = (this.props.background || 'White brush strokes') === 'Lamp';
      if (lampOn) p = { bg: '#7C8D80', bar: p.bar, line: 'rgba(0, 0, 0, 0.3)', panel: '#F7F3E8', pill: '#F7F3E8' };
      var glow = this.props.glowPreview || 'Off';
      var cur = (this.state && this.state.lang) || 'en';
      var I18N = { it: 'data/it.json', tr: 'data/tr.json' };
      var TRD = (cur !== 'en' && this.state && this.state.i18n && this.state.i18n[cur]) || null;
      function mergeT(en, tr) {
        if (tr === undefined || tr === null) return en;
        if (Array.isArray(en)) { if (!Array.isArray(tr)) return en; return en.map(function (v, i) { return mergeT(v, tr[i]); }); }
        if (en && typeof en === 'object') { var o = {}; Object.keys(en).forEach(function (k) { o[k] = mergeT(en[k], tr[k]); }); return o; }
        return (typeof tr === typeof en && tr !== '') ? tr : en;
      }
      var uiEN = { headline: 'Materials Engineer', navAbout: 'About', navEducation: 'Education', navExperience: 'Experience', navProjects: 'Learnings & Projects', linkedin: 'LinkedIn', place: 'Padova, Italy', cv: 'Download CV', closeWindow: 'Close window', closeCourse: 'Close course', courseLabel: 'Course · University of Padova', taughtBy: 'Taught by:', took: 'What I took from it:', goal: 'Goal:', overview: 'Overview', backTo: 'Back to ', backAll: 'Back to all', prevImg: 'Previous image', nextImg: 'Next image', enlarge: 'Enlarge image', closeImage: 'Close image', kindLearning: 'Learning', kindProject: 'Project', coursework: 'Coursework', coursesCount: '13 courses' };
      var tx = mergeT(uiEN, TRD && TRD.ui);
      function withLead(arr) { return (arr || []).map(function (it) { return { lead: it.lead || '', text: it.text || '', hasLead: !!it.lead }; }); }
      var edEN = {
        msc: {
          title: 'M.Sc. Materials Engineering — Functional Materials track',
          school: 'University of Padova (Università degli Studi di Padova)',
          place: 'Padova, Italy · Sep 2023 – Jul 2026',
          meta: '120 ECTS · taught in English · graduated 16 July 2026',
          intro: 'A two-year, full-time Master’s taught entirely in English. The programme gives every student a core in the main classes of materials and their production technologies, and the Functional Materials track adds dedicated courses on nanomaterials and biomaterials. My path through it had a clear centre: nanomaterials, built up from nanoscience theory to hands-on synthesis and finally to my thesis on VO₂. Around it I built a second line in modelling, simulation and quality, choosing the Finite Element Method and Quality in Manufacturing Engineering as my free-choice courses.',
          coveredLabel: 'What the programme covered',
          covered: [
            { lead: 'Physics of solids:', text: 'quantum mechanics, band theory, and the electronic, magnetic and thermal properties of solids' },
            { lead: 'The main classes of materials:', text: 'metals (heat and surface treatments, welding, powder metallurgy, coatings), ceramics (processing, defect chemistry, reliability), polymers (rheology, processing, recycling) and composites (micromechanics, laminates, fabrication)' },
            { lead: 'Design and reliability:', text: 'stress analysis, fatigue and fracture mechanics, finite element analysis in ANSYS, and materials selection with Ashby charts and CES EduPack' },
            { lead: 'Nanomaterials and biomaterials (my track):', text: 'nanoscience, the synthesis and characterisation of nanoparticles and thin films, biopolymers and biomaterials for medicine, and sports and rehabilitation devices' },
            { lead: 'Modelling and quality (my free choices):', text: 'writing finite element codes from first principles, and industrial metrology from CMMs and laser scanning to X-ray CT and surface texture' },
            { lead: 'Language:', text: 'English B2 productive skills' },
            { lead: '', text: 'Master’s thesis (21 ECTS)' }
          ],
          thesisLabel: 'Master’s thesis',
          thesisTitle: 'Hydrothermal synthesis and thermochromic applications of VO₂(M) nano-powders',
          thesisMeta: 'Department of Industrial Engineering · Supervisor: Prof. Alessandro Martucci · Co-supervisor: Dr. Maria Basso',
          thesisText: 'The thesis set out to develop a low-cost, solution-based route to thermochromic smart-window coatings: synthesise monoclinic VO₂ nano-powders hydrothermally and disperse them in transparent polymer films that can be applied over large areas, as an alternative to vacuum-based deposition. I designed and ran a series of 13 hydrothermal syntheses, systematically varying precursor concentration, reducing-agent amount, pH, temperature and reaction time, and processed the powders into polymer composite coatings (PVA, PVP and PEG) on quartz. Every stage was characterised: phase by XRD, morphology by SEM with quantitative image analysis, thermal and oxidation behaviour by TGA, film surfaces by optical microscopy, and temperature-dependent optical transmittance by UV-Vis-NIR spectroscopy. The work identified the hydrazine-to-vanadium ratio as the main lever controlling the vanadium oxidation state and phase formation, and established the particle-to-polymer ratio and polymer matrix that give the most uniform, transparent films.',
          handsLabel: 'Hands-on work',
          hands: [
            { lead: 'Labs:', text: 'four nanomaterials syntheses (gold and gold–silver nanoparticles, ZnO quantum dots, hybrid silica films and photocatalytic TiO₂ films) and five sessions in the Laboratory of Industrial and Geometrical Metrology (CMM and laser scanning, point-cloud processing, CAD-based inspection, roughness, optical surface metrology and CT)' },
            { lead: 'Computation:', text: 'three structural verification assignments in ANSYS and my own finite element code for the pull-out problem' },
            { lead: 'Projects:', text: 'a group case study on composite engine pistons, a group mini-review on polymer spinal-fusion cages, an individual materials-selection report on ceramic tap valves, and two product-concept posters for protective sports gear' },
            { lead: 'Research:', text: '13 hydrothermal syntheses and more than 40 polymer composite coatings for my thesis' }
          ],
          gainedLabel: 'What I gained',
          gained: [
            'A complete materials-engineering toolkit across metals, ceramics, polymers and composites, learned in an international, English-speaking environment.',
            'Real depth in nanomaterials, from the theory of confinement, nucleation, growth and plasmonics, through synthesis and characterisation in the lab, to an independent research project.',
            'A second strength in modelling, simulation and metrology, which I’ve kept building through self-study in ANSYS Workbench and Fusion 360.',
            'Research skills: designing experiments; characterising materials by XRD, SEM, TGA, UV-Vis-NIR, FTIR and ellipsometry; analysing data; and writing scientific reports and an 88-page thesis.',
            'Teamwork and presentation in international groups, through the piston case study and the spinal-cage mini-review.'
          ],
          courseworkLabel: 'Coursework',
          coursesCount: '13 courses'
        },
        bsc: {
          title: 'B.Sc. Metallurgical and Materials Engineering',
          school: 'Marmara University, Faculty of Technology',
          place: 'Istanbul, Turkey · Sep 2016 – Aug 2021',
          meta: '240 ECTS · taught in Turkish · graduated 6 August 2021',
          intro: 'A four-year, full-time engineering programme that took me from the fundamentals of science and engineering to the production, processing and testing of metals, polymers and composites. Alongside the core metallurgy curriculum, I chose most of my technical electives in polymers and elastomers, and my final year was built around industry, with a full semester of workplace education and a graduation project.',
          coveredLabel: 'What the programme covered',
          covered: [
            { lead: 'Engineering foundations:', text: 'mathematics, differential equations, numerical analysis and statistics for engineers; physics, chemistry and organic chemistry; statics, strength of materials and heat transfer; engineering drawing and computer-aided technical drawing' },
            { lead: 'Materials science:', text: 'materials science, thermodynamics of materials, phase diagrams, metallography, mechanical behaviour of materials and material characterisation techniques' },
            { lead: 'Metals and manufacturing:', text: 'iron and steel production, casting methods, plastic forming, welding processes and technologies, machining, manufacturing metallurgy, and corrosion and corrosion protection' },
            { lead: 'Testing:', text: 'destructive and non-destructive testing methods for materials' },
            { lead: 'Polymers, elastomers and composites (my elective focus):', text: 'polymer science, polymer processing technologies, properties of polymers, polymer blends, elastomer technology, engineering polymers, welding of polymers, polymer product design, composite materials and biomaterials' },
            { lead: 'Professional skills:', text: 'occupational health and safety, leadership and technical English' }
          ],
          industryLabel: 'Industry and practice',
          industry: [
            'Two compulsory industrial internships and a full semester of workplace education (28 ECTS) inside a company, which took me into casting, rubber compounding and mould making (see Experience).',
            'A graduation project in the final year.'
          ],
          gainedLabel: 'What I gained',
          gained: [
            'A solid metallurgical base: how metals are produced, cast, formed, welded and machined, and how their microstructure decides their properties.',
            'A second strength in polymers and elastomers, which fed straight into my rubber-formulation internship and later into my polymer courses in Padova.',
            'A testing mindset, from destructive and non-destructive testing to metallography.',
            'First-hand experience of how production works, thanks to a curriculum that sent me into industry for a full semester.',
            'Technical drawing and CAD skills that I later built on with Fusion 360.'
          ],
          activitiesLabel: 'Activities:',
          activities: 'Metallurgy and Materials Club, Music and Event Club, AHBAP volunteer platform.'
        }
      };
      var ed = mergeT(edEN, TRD && TRD.ed);
      ed.msc.covered = withLead(ed.msc.covered);
      ed.msc.hands = withLead(ed.msc.hands);
      ed.bsc.covered = withLead(ed.bsc.covered);
      var langs = [
        { id: 'en', code: 'EN', name: 'English' },
        { id: 'it', code: 'IT', name: 'Italian' },
        { id: 'tr', code: 'TR', name: 'Turkish' }
      ].map(function (l) {
        var on = l.id === cur;
        return {
          code: l.code,
          name: l.name,
          pressed: on ? 'true' : 'false',
          bg: on ? (p.pill || p.bg) : 'transparent',
          pick: function () {
            self.setState({ lang: l.id });
            var have = self.state && self.state.i18n && self.state.i18n[l.id];
            if (l.id !== 'en' && !have && I18N[l.id] && !(self.i18nLoading && self.i18nLoading[l.id])) {
              self.i18nLoading = self.i18nLoading || {};
              self.i18nLoading[l.id] = true;
              siteFetch(I18N[l.id]).then(function (r) { return r.json(); }).then(function (d) { var m = Object.assign({}, (self.state && self.state.i18n) || {}); m[l.id] = d; self.i18nLoading[l.id] = false; self.setState({ i18n: m }); }).catch(function () { self.i18nLoading[l.id] = false; });
            }
          }
        };
      });
      var open = (this.state && this.state.open) || '';
      var titles = { about: tx.navAbout, education: tx.navEducation, experience: tx.navExperience, projects: tx.navProjects };
      var win = {
        on: open !== '',
        title: titles[open] || '',
        about: open === 'about',
        education: open === 'education',
        experience: open === 'experience',
        projects: open === 'projects'
      };
      var about = [
        'I’m Onur. I was born in 1998 in Zonguldak, a city on Turkey’s Black Sea coast, and that’s where I spent my childhood and teenage years. It’s also where I discovered music, which has been one of the great constants of my life ever since.',
        'In high school, at Mehmet Çelikel, music put me on stage again and again. I played in the school band, performing at school events and in musical theatre productions, and with my band I took part in music competitions across Turkey and placed in several of them.',
        'Then I moved to Istanbul for my Bachelor’s degree, and there I studied Metallurgical and Materials Engineering at Marmara University. Music came with me. Alongside my studies I performed with different bands, and at some point I found myself on the other side of the stage too, working as a sound engineer: recording artists and running sound at concerts. Around the same time I started teaching guitar. Campus life kept me busy as well, and I was an active member of several clubs, from the Metallurgy and Materials Club and the Music and Event Club to the AHBAP volunteer platform.\n',
        'After graduating, I spent some time working at a carbon-fibre composites startup. Then, wanting to take my education further and, even more, to gain new experiences, I moved to Italy to start my Master’s at the University of Padova. These years have been about focus: I’ve put most of my energy into my studies and into growing in new directions, from nanomaterials in the lab to modelling and simulation on the computer. Music is still there, of course, and these days it often finds its way into my engineering projects too.'
      ];
      var coursesOld = [
        { name: 'Nanostructured Materials', ects: 9, who: 'Dr. Elena Colusso, Prof. Alessandro Martucci', desc: 'How nanomaterials are made, turned into functional films and characterised, taught largely in the lab.', items: ['Chemical synthesis of metallic, semiconductor and oxide nanoparticles; their physical properties and applications', 'Thin-film deposition by dip coating, spin coating and capillary flow', 'Structural and functional characterisation of nanomaterials and films', 'Visits to nanotechnology research laboratories', 'Hands-on: four labs: Au and Au/Ag nanoparticles, ZnO quantum dots, hybrid SiO₂ sol-gel films and photocatalytic TiO₂ films'] },
        { name: 'Fundamentals of Nanoscience', ects: 6, who: 'Prof. Giovanni Mattei, Prof. Chiara Maccato, Prof. Moreno Meneghetti', desc: 'The physics and chemistry behind why materials behave differently at the nanoscale.', items: ['Quantum confinement and size-dependent electronic properties', 'Thermodynamic size effects, nucleation (Gibbs–Thomson) and growth (diffusion-limited aggregation, Ostwald ripening)', 'Plasmonics of metallic nanostructures: Mie theory, interacting particles', 'Nanostructures in solid matrices by ion implantation', 'Top-down and bottom-up synthesis: colloidal routes, templating, self-assembly, core–shell particles, nanowires, nanotubes, Langmuir–Blodgett films', 'Interfaces and thin-film growth by CVD, MBE, PVD, ALE and PLD; electron microscopy'] },
        { name: 'Solid State Physics', ects: 9, who: 'Prof. Andrea Gasparotto', desc: 'From quantum mechanics to the properties of real solids and semiconductor devices.', items: ['Foundations of quantum theory, wave mechanics and the wave function', 'Electrons in a periodic lattice and energy band theory', 'Electrical properties of conductors and semiconductors; magnetic and thermal properties of solids', 'Semiconductor devices: operating principles and fabrication technologies', 'Numerical problem solving throughout'] },
        { name: 'Composite Materials', ects: 9, who: 'Prof. Giorgia Franchin, Prof. Lisa Biasetto', desc: 'How a composite’s performance comes from its constituents, architecture, interface and processing.', items: ['Reinforcements (carbon, glass, polymer, SiC and oxide fibres, whiskers, nanotubes, particulates) and fibre-strength statistics', 'Thermoset, thermoplastic, metal and ceramic matrices', 'Elastic constants, tensor analysis of laminae, laminate theory; shear-lag and Eshelby models', 'Interface bonding and its measurement; strength and failure of laminae and laminates; fracture mechanics and toughness', 'Thermal stresses, thermal cycling, creep, conduction; porous materials, bio-composites, recycling, nano-reinforcement', 'Fabrication of polymer-, metal- and ceramic-matrix composites; applications in aerospace, automotive, wind energy and sport', 'Hands-on: group case study on composite engine pistons'] },
        { name: 'Technology of Metals', ects: 9, who: 'Prof. Andrea Zambon', desc: 'Selecting, treating, joining and coating metals for engineering use.', items: ['Steel classification and designation; annealing, hardening and hardenability, tempering, cryogenic and surface hardening', 'Thermochemical treatments: carburising, nitriding, carbonitriding, nitrocarburising, boriding', 'Welding metallurgy, defects and remedies; powder metallurgy and sintering', 'Surface preparation, conversion coatings, electroplating (Cu, Ni, Cr, Zn), electroless deposition, anodising of aluminium', 'PVD and CVD thin films; thermal-spray thick films', 'Aluminium, titanium and copper alloys and superalloys; cold and hot plastic deformation and recovery'] },
        { name: 'Science and Technology of Ceramics', ects: 9, who: 'Prof. Alessandro Martucci', desc: 'Ceramics from crystal structure and defect chemistry to processing, reliability and applications.', items: ['Ionic and covalent structures; point defects, Kröger–Vink notation, diffusion, ionic and electronic conductivity', 'Powders, additives, forming, drying, sintering, grain growth and pore elimination', 'Brittle fracture, K_IC, crack stability, R-curves and toughening mechanisms', 'Subcritical crack growth, creep, Weibull statistics, proof testing and lifetime prediction; thermal stresses', 'Traditional ceramics, refractories, advanced structural and functional ceramics, cements; ternary diagrams', 'Hands-on: Weibull and lifetime-design exercise and a scientific-paper analysis on zirconia sintering'] },
        { name: 'Polymer Processing and Recycling', ects: 6, who: 'Dr. Carlo Boaretti', desc: 'Polymers across their life cycle, from formulation and melt behaviour to processing and recycling.', items: ['Additives: fillers, glass/carbon/Kevlar fibres, antioxidants, UV stabilisers, flame retardants, plasticisers; degradation mechanisms', 'Melt rheology (power law, viscoelasticity, effects of molecular weight, temperature and pressure) and rheometry (capillary rheometer, Rabinowitsch and Bagley corrections, melt flow index)', 'Extrusion and twin-screw extrusion; injection moulding (PvT curves, cooling, defects); blow moulding, rotational moulding, thermoforming, RIM and RTM', 'Polymer identification and sorting; mechanical and chemical recycling, waste-to-energy; PET, polyolefin, PVC and polyurethane case studies'] },
        { name: 'Biopolymers Engineering', ects: 6, who: 'Prof. Giovanna Brusatin', desc: 'Polymers for two demanding fields: sustainability and health.', items: ['Bio-based plastics: renewable resources, circular economy, natural polymers, bio-plastics from fermentation and microbial synthesis', 'Polymeric biomaterials: synthetic and natural, bioinert and bioresorbable', 'Hydrogels: synthesis, types, mechanical and structural characterisation', 'Tissue engineering, stem cells, organoids, 3D biofabrication; polymeric micro- and nanoparticles as therapy carriers', 'Journal club: analysing and presenting scientific papers', 'Hands-on: group mini-review on spinal-fusion cages'] },
        { name: 'Materials Structural Integrity', ects: 9, who: 'Mattia Manzolaro, Giuseppe Zullo', desc: 'Judging whether a component stays reliable under static and dynamic loads.', items: ['Internal reactions, stress and strain states, Mohr’s circles, failure criteria', 'Mechanical characterisation and stress concentration factors', 'Classical and low-cycle fatigue; static and dynamic strength of welded joints; fracture mechanics; curved beams', 'FE computing lab with ANSYS', 'Hands-on: three ANSYS verification assignments'] },
        { name: 'Introduction to the Finite Element Method', ects: 6, who: 'Prof. Angelo Simone', desc: 'Building finite element codes from first principles, with no commercial software.', items: ['Discrete spring systems; strong and weak forms, variational principles, Hilbert and Sobolev spaces', 'Bubnov–Galerkin method; stiffness matrices for bars, trusses and planar elements', 'Isoparametric elements in 1D, 2D and 3D; Gauss–Lagrange integration; sparse assembly', 'Convergence (Céa’s lemma), error estimates and h, p, hp and r refinement; stress post-processing', 'Incremental and diffusion problems; nonlinear FEM: consistent linearisation, Newton–Raphson, material nonlinearity, local damage', 'Hands-on: wrote my own FE code in Python for 1D–3D linear elasticity, with Gmsh for meshing and ParaView for post-processing, defended in an oral exam'] },
        { name: 'Materials Selection and Design', ects: 6, who: 'Prof. Enrico Bernardo', desc: 'Turning design requirements into defensible material and shape choices.', items: ['Material property charts and performance indices', 'Selection with multiple constraints and conflicting objectives: penalty functions, weighting factors', 'Shape factors and combined material–shape selection', 'Efficiency of composite reinforcements and cellular materials', 'Eco-audits and environmental selection; CES EduPack computer lab', 'Hands-on: individual CES report on ceramic tap-valve discs'] },
        { name: 'Quality in Manufacturing Engineering', ects: 6, who: 'Prof. Sofia Catalucci', desc: 'Measurement as a tool to control production.', items: ['Metrology in manufacturing, including additive manufacturing', 'Verification of geometrical product specifications (GPS); statistical process control', 'Coordinate measuring machines, optical coordinate measuring systems, industrial X-ray CT, smart inspection', 'Point-cloud processing and comparison with CAD models and meshes', 'Surface texture and areal topography metrology', 'Hands-on: lab work with an articulated-arm CMM and laser scanner, metrological CT, an optical 3D profiler (confocal, focus variation, white-light interferometry), digital roughness testers and ZEISS Inspect'] },
        { name: 'Sports Engineering and Rehabilitation Devices', ects: 6, who: 'Prof. Nicola Petrone', desc: 'Translating the performance, comfort and safety of sports and rehabilitation devices into measurable engineering quantities.', items: ['Anatomy and physiology of the musculoskeletal system; anthropometry; modelling equilibrium and motion of body segments', 'Gait and running analysis', 'Motion capture, inertial sensors, force platforms, pressure insoles, electromyography', 'Design and calibration of strain-gauge load cells; musculoskeletal simulation', 'Research design and statistics; safety standards and test methods for sports equipment, orthoses and prostheses', 'Hands-on: sessions in the Sports Biomechanics Lab (motion capture) and Sports Engineering Lab (strain-gauged components); product-concept posters'] }
      ];
      var courses = (this.state && this.state.coursesData) || coursesOld.map(function (c) { return { name: c.name, who: c.who, desc: c.desc, sections: [{ title: 'What the course covers', items: c.items.map(function (t) { return { lead: '', text: t, hasLead: false }; }) }] }; });
      courses = mergeT(courses, TRD && TRD.courses);
      var jobs = [
        { when: 'Aug 2022 – Apr 2023', where: 'Kocaeli, Turkey · full-time', role: 'R&D Engineer', company: 'Deltaron Technology', about: 'Deltaron is a small startup in advanced composite manufacturing, developing carbon-fibre braided preforms for high-performance applications. My work sat close to the manufacturing side of braiding, where material flow, machine settings and process stability shape the final part. As part of a small team, I worked across R&D, materials supply and the production floor.', items: ['Troubleshot the braiding process on the company’s custom-built carbon-fibre braiding machine. I adjusted the braid angle and tracked down the causes of skipped-row defects, which made the braided preforms more consistent from run to run.', 'Sourced and qualified carbon-fibre filament, checking suppliers’ material against production requirements, and coordinated raw-material supply so that production could run without interruption.', 'Followed day-to-day manufacturing on the shop floor, traced process deviations back to their root cause and documented each fix so it could be reused.'], took: 'Because the team was small, I saw directly how small changes in process parameters affect the final part. It took my understanding of composites beyond theory: fibre architecture, defect prevention and parameter tuning decide how a part will behave long before it reaches testing.' },
        { when: 'Mar 2021 – Jun 2021', where: 'Kocaeli, Turkey', role: 'Intern, Mould Design and Manufacturing', company: 'Cemerel Mold Technologies', about: 'Cemerel designs and builds plastic injection moulds and tooling for the automotive, white-goods and electrical industries. The internship put me where design meets manufacturing, working alongside the design team for four months.', items: ['Assisted with industrial injection-mould design and prototype evaluation, checking the geometry, feasibility and production requirements of each design.', 'Reviewed technical drawings for manufacturability and supported tooling optimisation.', 'Followed the production workflow and helped prepare tooling-related technical documentation for the production stage.'], took: 'A clear, practical view of how mould design decisions affect manufacturability further down the line. Good engineering is rarely just a correct drawing; it also depends on process clarity, feedback from production and how well a design survives the move from concept to shop floor.' },
        { when: 'Jul 2019 – Aug 2019', where: 'Kocaeli, Turkey', role: 'Intern, Rubber Formulation and Quality Control', company: 'Tekno Kauçuk Sanayii A.Ş.', about: 'Tekno Kauçuk is a long-established rubber manufacturer serving the automotive and defence sectors, where formulation quality and process reliability matter from the very start.', items: ['Worked on rubber compound formulation for automotive and defence applications, following compounds from material evaluation to testing.', 'Ran mechanical and chemical tests on production compounds to support the quality validation of the final products.', 'Supported the plant’s quality-control procedures, seeing first-hand how lab testing feeds into production quality.'], took: 'The link between composition, testing and performance stopped being academic and became very concrete. It was my first real introduction to quality-focused materials engineering, and a chance to put my polymer and elastomer coursework into practice.' },
        { when: 'Jul 2018 – Aug 2018', where: 'Zonguldak, Turkey', role: 'Intern, Metallurgy and Materials Engineering', company: 'TTK (Turkish Hard Coal Enterprises)', about: 'TTK (Türkiye Taşkömürü Kurumu) is Turkey’s state-owned hard-coal company, based in Zonguldak. This was my first industrial internship, back home after my second year of university.', items: ['Prepared moulding models and worked on casting methods for cast iron, steel and aluminium.', 'Gained experience in heat-treatment processes, including annealing and quenching.'], took: 'My first look at metallurgy outside the classroom: how a cast part is made, and how heat treatment changes its properties. It gave me shop-floor context that I later built on in my Bachelor’s courses and in Technology of Metals in Padova.' }
      ];
      var steps = [
        { num: '01', title: 'Simulation first (ANSYS Workbench)', when: 'Mar–Apr 2026', text: 'My FEM course had shown me what happens inside a solver, so I wanted to use a commercial one with the same discipline. I started with meshing, because the mesh decides whether a result can be trusted (Ansys Meshing: Learn the Art of Meshing, 3.5 h), and then completed the full Ansys Workbench Analysis Engineering Training Program (16.5 h). I worked through mesh-refinement studies, static structural analysis, beam buckling, heat flow, a car-crash impact simulation and topology optimisation of a bracket. Each time I focused on the same questions: are the boundary conditions realistic, is the mesh good enough, has the result converged, and what does the stress field actually say about the design?', images: [{ file: 'mesh-refinement-bracket.png', caption: 'Mesh refinement on a bracket' }, { file: 'heat-flow-analysis.gif', caption: 'Heat-flow analysis' }, { file: 'beam-buckling-study.png', caption: 'Beam buckling study' }, { file: 'car-accident-simulation.gif', caption: 'Car-crash impact simulation' }, { file: 'topology-optimized-bracket.png', caption: 'Topology-optimised bracket' }] },
        { num: '02', title: 'Learning CAD properly (Fusion 360)', when: 'Apr 2026', text: 'To simulate my own designs, I needed to model them. I completed Autodesk Fusion 360 (2026): Complete Beginners Guide (10.5 h), covering sketching, parametric part modelling, assemblies, 2D engineering drawings, rendering and STL export, and built a set of practice parts: a flange and piping assembly, a four-pipe manifold, a wall-mounted hook with full dimensioning, a twisted-ring geometry and a decorative desk organiser.', images: [{ file: 'flange-piping-assembly.png', caption: 'Flange and piping assembly' }, { file: 'four-pipe-manifold.png', caption: 'Four-pipe manifold' }, { file: 'wall-mounted-hook.png', caption: 'Wall-mounted hook' }, { file: 'twisted-ring-geometry.png', caption: 'Twisted ring geometry' }, { file: 'mario-desk-organizer.png', caption: 'Desk organiser' }] },
        { num: '03', title: 'Modelling the instrument I play', when: '2026', text: 'The first real thing I wanted to build was a guitar. I modelled a Fender Stratocaster at 1:1 scale from real reference dimensions as a full multi-body assembly: the contoured body, a bolt-on neck with separate fretboard and individual frets, the headstock with six tuning machines, an HSS pickup layout, the pickguard and a six-saddle tremolo bridge. I produced orthographic and isometric drawing sheets, assigned materials for rendering, exported STL files, and carried the geometry into ANSYS Workbench for structural analysis. It’s where my two worlds, music and engineering, first met in one project.', images: [{ file: 'iso.png', caption: 'Stratocaster isometric render' }, { file: 'technical-draw-1.png', caption: 'Drawing sheet' }, { file: 'assembly-fingerboard.png', caption: 'Fretboard and assembly' }, { file: 'top-zoom-body.png', caption: 'Body close-up' }, { file: 'guitar-ansys.png', caption: 'Structural analysis in ANSYS' }] },
        { num: '04', title: 'Headphones designed from scratch', when: 'In progress', text: 'This is the project that brings everything together. Instead of assembling bought parts, I’m designing a complete pair of headphones myself: the driver as well as the housing and headband, all modelled in CAD. I own every decision, from setting the design direction to narrowing down components and materials and fixing the acoustic and ergonomic constraints the build has to meet. It’s design, materials and sound in one object.', images: [{ file: 'headphones-cad.png', caption: 'Headphone assembly in CAD' }, { file: 'headphones-sketch.jpg', caption: 'Early sketches and component layout' }] },
        { num: '05', title: 'Music and sound', when: 'Ongoing', text: 'Music is the thread through everything above. I’ve played guitar since middle school, played in bars and taught guitar for two to three years, and worked as a sound engineer at concerts and recording guitar parts for other artists. I’m currently recording my own album. I also run a study-with-me YouTube channel: the base music and visuals start from AI-assisted tools, then I shape the music in Ableton and edit, sync and finish the videos in DaVinci Resolve.', images: [{ file: 'live.jpg', caption: 'Playing live' }, { file: 'studio.jpg', caption: 'Recording setup' }, { file: 'youtube-thumbnail.jpg', caption: 'Study-with-me YouTube channel' }] }
      ];
      var exSliderOn = (this.props.experienceLayout || 'List') === 'Slider';
      var exN = jobs.length;
      var exIdx = Math.max(0, Math.min(exN - 1, (this.state && typeof this.state.ex === 'number') ? this.state.ex : exN - 1));
      function exGo(i) { self.setState({ ex: Math.max(0, Math.min(exN - 1, i)) }); }
      var MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
      var TL0 = 2018, TL_SPAN = 72;
      function monthAt(s) { var q = String(s).trim().split(/\s+/); return (parseInt(q[1], 10) - TL0) * 12 + (MON[q[0]] || 0); }
      var shortNames = { 'Deltaron Technology': 'Deltaron', 'Cemerel Mold Technologies': 'Cemerel', 'Tekno Kauçuk Sanayii A.Ş.': 'Tekno Kauçuk', 'TTK (Turkish Hard Coal Enterprises)': 'TTK' };
      var exJobs = jobs.slice().reverse().map(function (j, i) {
        var parts = String(j.when).split('–');
        var t0 = monthAt(parts[0]), t1 = monthAt(parts[1] || parts[0]);
        var y0 = TL0 + Math.floor(t0 / 12), y1 = TL0 + Math.floor(t1 / 12);
        var left = t0 / TL_SPAN * 100, width = Math.max(1.6, (t1 + 1 - t0) / TL_SPAN * 100);
        var on = i === exIdx;
        return Object.assign({}, j, {
          hasAbout: !!j.about, hasBg: !!j.bgClass, bgClass: j.bgClass || '',
          slideLabel: j.role + ', ' + j.company + ', ' + j.when,
          hidden: on ? 'false' : 'true', op: on ? '1' : '0',
          name: shortNames[j.company] || j.company,
          years: y0 === y1 ? String(y0) : y0 + '–' + String(y1).slice(2),
          left: left.toFixed(2) + '%', width: width.toFixed(2) + '%', center: (left + width / 2).toFixed(2) + '%',
          current: on ? 'true' : 'false', weight: on ? '700' : '400', barBg: on ? '#000000' : p.panel,
          label: j.company + ', ' + j.when,
          go: function () { exGo(i); }
        });
      });
      var exYears = [];
      for (var yy = 0; yy <= TL_SPAN / 12; yy++) exYears.push({ y: String(TL0 + yy), left: (yy * 12 / TL_SPAN * 100).toFixed(2) + '%' });
      var exCur = exJobs[exIdx] || exJobs[0];
      var ex = {
        shift: 'translateX(' + (-100 * exIdx) + '%)',
        marker: exCur.center,
        announce: exCur.slideLabel,
        prevOff: exIdx === 0 ? 'true' : 'false',
        nextOff: exIdx === exN - 1 ? 'true' : 'false',
        prevOp: exIdx === 0 ? '0.3' : '1',
        nextOp: exIdx === exN - 1 ? '0.3' : '1',
        prevCur: exIdx === 0 ? 'default' : 'pointer',
        nextCur: exIdx === exN - 1 ? 'default' : 'pointer'
      };
      var pjSliderOn = (this.props.projectsLayout || 'Gallery') === 'Slider';
      var pjN = steps.length;
      var pjIdx = Math.max(0, Math.min(pjN - 1, (this.state && typeof this.state.pjs === 'number') ? this.state.pjs : 0));
      function pjGo(i) { self.setState({ pjs: Math.max(0, Math.min(pjN - 1, i)), pjd: -1 }); }
      var pjD = (this.state && typeof this.state.pjd === 'number') ? this.state.pjd : -1;
      var pjShort = ['Simulation', 'CAD', 'Guitar', 'Headphones', 'Music'];
      var pjSlides = steps.map(function (s, i) {
        var on = i === pjIdx;
        var imgs = s.images || [];
        return Object.assign({}, s, {
          short: pjShort[i] || s.title,
          slideLabel: 'Project ' + (i + 1) + ' of ' + pjN + ': ' + s.title,
          hidden: on ? 'false' : 'true',
          op: on ? '1' : '0',
          current: on ? 'true' : 'false',
          weight: on ? '700' : '400',
          cover: imgs[0] ? imgs[0].file : '',
          more: imgs.slice(1),
          hasMore: imgs.length > 1,
          moreN: Math.max(1, imgs.length - 1),
          open: on && pjD === i,
          closed: !(on && pjD === i),
          cardId: 'pjs-card-' + i,
          backId: 'pjs-back-' + i,
          toggle: function () { if (self.pjJustDragged && Date.now() - self.pjJustDragged < 350) return; self.setState({ pjd: (on && pjD === i) ? -1 : i }); },
          go: function () { pjGo(i); }
        });
      });
      var pjS = {
        n: pjN,
        shift: 'translateX(' + (-100 * pjIdx) + '%)',
        barLeft: (pjIdx * 100 / pjN).toFixed(2) + '%',
        barW: (100 / pjN).toFixed(2) + '%',
        announce: pjSlides[pjIdx] ? pjSlides[pjIdx].slideLabel : '',
        prevOff: pjIdx === 0 ? 'true' : 'false',
        nextOff: pjIdx === pjN - 1 ? 'true' : 'false',
        prevOp: pjIdx === 0 ? '0.3' : '1',
        nextOp: pjIdx === pjN - 1 ? '0.3' : '1',
        prevCur: pjIdx === 0 ? 'default' : 'pointer',
        nextCur: pjIdx === pjN - 1 ? 'default' : 'pointer'
      };
      // Uploaded pictures: file name -> url. A file without a url shows a placeholder.
      var IMG = siteImages();
      var lpLearn = [
        { num: '01', title: 'Finite Element Analysis', sub: 'From hand calculation to ANSYS Workbench', art: 'assets/covers/cover-fea.svg', period: '2024 – ongoing',
          tags: ['Hand calculations', 'Python FE code', 'ANSYS Meshing', 'ANSYS Workbench', 'SpaceClaim'],
          intro: ['My interest in simulation didn’t start with software. It started in 2024, in Materials Structural Integrity, when I first had to show that an FE model agreed with a hand calculation. It turned into a real interest in my finite element course, where I wrote my own solver and saw what actually happens inside one. After that I wanted to master the industry tool as well, so in spring 2026 I taught myself ANSYS Workbench, starting with meshing and then working through the full range of analyses. I’m still practising, now more and more on my own designs.'],
          images: [
            { file: 'mesh-refinement-bracket.png', caption: 'Mesh refinement on a bracket: controlling mesh size globally and locally, and checking that results stop changing as the mesh gets finer' },
            { file: 'heat-flow-analysis.gif', caption: 'Heat-flow analysis: temperature distribution and heat flux through a part under thermal loads' },
            { file: 'beam-buckling-study.png', caption: 'Beam buckling study: eigenvalue buckling to find critical loads and buckling mode shapes' },
            { file: 'car-accident-simulation.gif', caption: 'Car-crash impact simulation: an explicit dynamics analysis of a high-speed impact' },
            { file: 'topology-optimized-bracket.png', caption: 'Topology-optimised bracket: removing material where it carries little load, while keeping stiffness where it matters' }
          ],
          sections: [
            { tab: 'How it developed', items: [
              { lead: 'First contact: Materials Structural Integrity (2024).', text: 'My first FE work was three verification assignments in ANSYS. I modelled the same steel beam with beam, plane and solid elements, refined a mapped mesh until the bending stress stopped changing, and computed the stress concentration factor of a plate with a hole against Peterson’s charts. It taught me the rule I still follow: never trust a single FE result without a hand calculation and a convergence study behind it.' },
              { lead: 'Looking inside the solver: Introduction to the Finite Element Method (2025–26).', text: 'With no commercial software allowed, I wrote my own FE code in Python for the pull-out problem. I derived the weak form, built linear and quadratic isoparametric elements, assembled the stiffness matrix, applied the boundary conditions and measured how fast the error fell as I refined the mesh. Seeing the convergence rates come out exactly as theory predicted is when I realised finite elements was the area I wanted to go deeper into.' },
              { lead: 'Meshing first: Ansys Meshing, Learn the Art of Meshing (Mar 2026, 3.5 h).', text: 'Since the mesh decides whether a result can be trusted, I started there. The course covered meshing fundamentals and element types, global mesh settings to control density and quality across the model, local mesh settings and method options to refine where the geometry or the stress gradients demand it, how to build structured, high-quality meshes, how to adapt the mesh to the nature of the problem in both structural and fluid simulations, and how to inspect the inside of a mesh with section views.' },
              { lead: 'The full toolbox: Ansys Workbench, Analysis Engineering Training Program (Apr 2026, 16.5 h, 101 lectures).', text: 'A complete programme in the Workbench and Mechanical environment, following the FE workflow from geometry and materials to contacts, joints and boundary conditions, mesh, solution and post-processing. It covered:', subs: ['static structural analysis, with worked examples and dedicated meshing applications', 'dynamic analysis: modal, harmonic response, random vibration and transient structural analysis', 'explicit dynamics for impact problems, and rigid body dynamics', 'steady-state and transient thermal analysis', 'eigenvalue buckling and nonlinear analysis', 'topology optimisation', 'geometry preparation in SpaceClaim: repairing and simplifying CAD models, pull, move, fill, combine and split operations, merging faces, extracting mid-surfaces for shell models and working with STL data'] },
              { lead: 'Still improving (ongoing).', text: 'I now use these tools on my own models. For example, I carried my Stratocaster CAD model into ANSYS Workbench for structural analysis (see Project 01), and I keep practising on new problems to build speed and judgement.' }
            ] },
            { tab: 'What I gained', items: [
              { text: 'A complete FE workflow, from cleaning up the geometry to a result I can defend.' },
              { text: 'The habit, built while writing my own solver, of asking the same questions every time: are the boundary conditions realistic, is the mesh good enough, has the result converged, and does it agree with a hand calculation?' },
              { text: 'A broad range of analysis types (static, dynamic, thermal, buckling, explicit, nonlinear and optimisation), and a sense of which one a problem actually needs.' },
              { text: 'Geometry preparation in SpaceClaim, which links simulation to the CAD work in Learning 02.' },
              { text: 'Confidence in learning a professional engineering tool on my own, and the motivation to keep going.' }
            ] }
          ] },
        { num: '02', title: '3D Modelling', sub: 'From hand drawing to CAD', art: 'assets/covers/cover-modelling.svg', period: '2016 – ongoing',
          tags: ['Technical drawing', 'AutoCAD', 'SolidWorks', 'Fusion 360', 'Siemens NX'],
          intro: ['I’ve always had a passion for modelling, and geometry has always come naturally to me. I enjoy picturing a part in my head and then working out, feature by feature, how to build it. That’s why 3D modelling is the skill I keep coming back to, from my first technical drawings by hand to the industrial CAD system I’m learning today.'],
          images: [
            { file: 'flange-piping-assembly.png', caption: 'Flange and piping assembly (Fusion 360)' },
            { file: 'four-pipe-manifold.png', caption: 'Four-pipe manifold (Fusion 360)' },
            { file: 'wall-mounted-hook.png', caption: 'Wall-mounted hook with full dimensioning (Fusion 360)' },
            { file: 'twisted-ring-geometry.png', caption: 'Twisted-ring geometry (Fusion 360)' },
            { file: 'mario-desk-organizer.png', caption: 'Decorative desk organiser (Fusion 360)' }
          ],
          sections: [
            { tab: 'How it developed', items: [
              { lead: 'By hand first (Bachelor’s).', text: 'My Bachelor’s started with technical drawing on paper: projecting a part into orthographic views, drawing sections and adding dimensions so that someone else could make it. Doing it by hand built the spatial sense that every CAD tool relies on.' },
              { lead: 'Onto the computer: AutoCAD and SolidWorks (Bachelor’s).', text: 'We then moved to computer-aided drawing, using AutoCAD for 2D drafting and SolidWorks for 3D modelling, turning sketches into solid parts.' },
              { lead: 'Fusion 360 (Master’s, Apr 2026).', text: 'During my Master’s I completed Autodesk Fusion 360: Complete Beginners Guide (10.5 h, 95 lectures), a beginner-to-intermediate course in 3D mechanical design. It covered:', subs: ['setting up the workspace, and 2D sketching with constraints and dimensions', '3D modelling: turning sketches into solid models with a wide range of tools, then editing and modifying them', 'creating assemblies from multiple parts', 'two guided projects: a workbench and a 3D-printed phone stand', '2D engineering drawings of parts and assemblies to industry standards', 'rendering with materials and appearances, and exporting STL files for 3D printing', 'a set of practice modelling exercises'], after: 'Alongside the course, I built my own practice parts: a flange and piping assembly, a four-pipe manifold, a wall-mounted hook with full dimensioning, a twisted-ring geometry and a decorative desk organiser.' },
              { lead: 'Siemens NX (ongoing).', text: 'Now I’m adding a high-end industrial CAD system through Siemens NX Mastery (Udemy, Roy Academy, 79 h), a course built around some 500 examples, 20 assembly projects and 300 quiz questions. Its workbenches range from the sketcher, part and surface design, assembly design and drafting to sheet metal, animation and analysis. I’ve covered the core modelling tools and started the product-design assignments with a drone assembly. Ahead are an aircraft landing-gear assembly and a single-cylinder engine assembly, the drafting workbench, engineering drawing standards, orthographic, sectional and isometric projections, an industrial project on gas-turbine blades for an aero-engine, and hundreds of guided practice examples.' }
            ] },
            { tab: 'What I gained', items: [
              { text: 'A method behind my spatial sense: sketch, constrain, build features, assemble and document.' },
              { text: 'Models that are easy to change: parametric parts where a dimension can be edited and the whole design updates cleanly.' },
              { text: 'Fluency across several CAD systems. The software changes but the principles carry over, which makes each new tool faster to learn.' },
              { text: 'Drawings that communicate, from hand-drawn views to standard engineering drawings of parts and assemblies.' },
              { text: 'My own geometry for simulation and building: the parts I model go straight into ANSYS (Learning 01) and into my projects, from the Stratocaster to the headphones.' }
            ] }
          ] }
      ];
      var lpProj = [
        { num: '01', title: 'Fender Stratocaster', sub: 'From CAD model to numerical simulation', art: 'assets/covers/cover-guitar.svg', period: '2026 – ongoing',
          tags: ['Fusion 360', 'ANSYS Workbench'],
          intro: ['The first real thing I wanted to build with my new skills was the instrument I’ve played since middle school. An electric guitar is a surprisingly rich engineering object: a set of precisely fitted parts under constant string tension, whose stiffness and vibration matter to how it plays and sounds. So I set out to model a Fender Stratocaster at full scale, and then to use that model as a test bench for simulation.'],
          goal: 'Build an accurate 1:1 model of a real guitar, then study how it behaves under string load and vibration.',
          images: [
            { file: 'iso.png', caption: 'The Stratocaster model, isometric render' },
            { file: 'technical-draw-1.png', caption: 'Orthographic drawing sheet' },
            { file: 'assembly-fingerboard.png', caption: 'Neck, fretboard and frets in the assembly' },
            { file: 'top-zoom-body.png', caption: 'Close-up of the contoured body' }
          ],
          sections: [
            { tab: 'How I’m doing it', items: [
              { lead: 'Geometry from drawings and from my own guitar.', text: 'I started from technical drawings of the Stratocaster and, along the way, took measurements from my own guitar, so the model follows real dimensions rather than approximations.' },
              { lead: 'A full multi-body assembly in Fusion 360.', text: 'I modelled each component as its own body and assembled them: the contoured body, a bolt-on neck with a separate fretboard and individual frets, the headstock with six tuning machines, an HSS pickup layout, the pickguard and a six-saddle tremolo bridge.' },
              { lead: 'Drawings and renders.', text: 'I produced orthographic and isometric drawing sheets, assigned materials for rendering and exported STL files.' },
              { lead: 'Into ANSYS Workbench.', text: 'I’ve transferred the geometry into ANSYS Workbench to prepare it for simulation.' }
            ] },
            { tab: 'What’s next', items: [
              { lead: 'Modal analysis:', text: 'find the natural frequencies and mode shapes of the guitar, to see how the structure vibrates.' },
              { lead: 'Static structural analysis:', text: 'apply the string tension and see how the neck and the neck joint carry the load, in terms of stress and deflection.' },
              { lead: 'Topology optimisation:', text: 'explore where material could be removed from the body while keeping the stiffness where it matters.' },
              { text: 'Further studies as the model develops.' }
            ] },
            { tab: 'What I’m learning', items: [
              { text: 'Turning a real object into an accurate model by combining reference drawings with my own measurements.' },
              { text: 'Building a complex assembly in which every part has to fit the others.' },
              { text: 'Taking my own geometry all the way from CAD to a simulation-ready model, which brings Learning 01 and 02 together in one project.' },
              { text: 'Bringing my two worlds, music and engineering, into the same object.' }
            ] }
          ] },
        { num: '02', title: 'Headphones', sub: 'Design, model, build', art: 'assets/covers/cover-headphones.svg', period: '2026 – in progress',
          tags: ['Product design', 'Driver design', 'CAD modelling', '3D printing', 'Assembly', 'Sound'],
          intro: ['This is the project that brings everything together. Instead of assembling bought parts, I’m building a pair of headphones from zero: starting with the drivers, then designing a shell around them, printing it in 3D and assembling the finished headphone myself. It combines the three things I care about most: sound, materials and design.'],
          goal: 'Design, print and assemble a working pair of headphones of my own, owning every decision along the way.',
          images: [
            { file: 'headphones-concept.png', caption: 'Concept for an open-back studio headphone' }
          ],
          sections: [
            { tab: 'The plan', ordered: true, items: [
              { lead: 'Drivers (in progress).', text: 'I’m currently designing the drivers, the heart of any headphone, which turn the electrical signal into sound, together with the other internal components.' },
              { lead: 'Shell (next).', text: 'Once the drivers are defined, I’ll model the shell around them in CAD, including the housing and headband, with the acoustic and ergonomic requirements the build has to meet.' },
              { lead: '3D printing.', text: 'I’ll print the shell parts myself, so the design has to be shaped for printing from the start.' },
              { lead: 'Assembly.', text: 'I’ll put the drivers, shell and internal components together into a finished, working headphone.' },
              { lead: 'Listening and refining.', text: 'Finally, I’ll test how it sounds and feels, and refine the design.' }
            ] },
            { tab: 'What I’m learning', items: [
              { text: 'Product design from a blank page: every decision is mine, from the design direction to the components, materials and constraints.' },
              { text: 'How a headphone actually produces sound, and how each design choice in the driver affects it.' },
              { text: 'Designing for manufacture: shaping parts so they can be 3D printed and assembled without surprises.' },
              { text: 'Bringing my background in music and sound engineering into an engineering design of my own.' }
            ] }
          ] },
        { num: '03', title: 'Music Album', art: 'assets/covers/cover-album.svg', period: '2021 – in progress',
          tags: ['Songwriting', 'Arranging', 'Multi-instrument recording', 'Ableton Live', 'Sound engineering'],
          intro: ['I’ve been playing guitar for more than 15 years, and since 2021 I’ve been making an instrumental album with a friend. We’re both musicians: my main instrument is guitar and his is bass, but we play every other instrument on the record ourselves. It’s my longest-running project, and the one that started long before any of my engineering ones.'],
          images: [],
          sections: [
            { tab: 'How we make it', items: [
              { lead: 'Writing.', text: 'We write all our songs together, from the first idea to the finished piece.' },
              { lead: 'Arranging.', text: 'We arrange every track ourselves. Because we play all the instruments, arranging means thinking about every part of a song, not just our own.' },
              { lead: 'Recording.', text: 'We record the songs ourselves, working in Ableton. I used to work as a sound engineer, running sound at concerts and recording guitar parts for other artists, and my friend is now a professional sound engineer in Turkey, so we treat the technical side of the recordings as carefully as the music itself.' }
            ] },
            { tab: 'What it’s taught me', items: [
              { text: 'Commitment to a long project: building something step by step over years, and keeping the quality bar high the whole way.' },
              { text: 'Real creative teamwork: two people sharing every role, from writing to recording.' },
              { text: 'Attention to detail: like a good experiment, a good recording depends on controlling every variable you can.' },
              { text: 'A practical feel for sound itself, which feeds straight into my headphone project.' }
            ] }
          ] },
        { num: '04', title: 'RedroSound', sub: 'AI-assisted YouTube channel', cover: 'redrosound-logo.png', coverFit: 'contain', period: 'ongoing',
          tags: ['AI-generated music and video', 'Lofi and study music', 'Ableton Live', 'DaVinci Resolve', 'Content creation'],
          intro: ['With a friend, I run RedroSound, a YouTube channel of relaxing instrumental music for studying, working late or slowing down, ranging from chill lofi to synthwave, jazz and ambient. It’s an experiment in combining AI tools with our own production skills: AI creates the first versions of the songs and the visuals, and we turn them into finished study-with-me videos.'],
          link: 'youtube.com/@RedroSound', linkHref: 'https://www.youtube.com/@RedroSound',
          images: [
            { file: 'redrosound-thumbnail.png', caption: 'A RedroSound video thumbnail' },
            { file: 'redrosound-channel.png', caption: 'The RedroSound channel on YouTube' },
            { file: 'redrosound-logo.png', caption: 'The RedroSound logo' }
          ],
          sections: [
            { tab: 'How we make it', items: [
              { lead: 'Creating.', text: 'Both the songs and the videos are generated with AI tools.' },
              { lead: 'Mixing.', text: 'We mix every song ourselves in Ableton.' },
              { lead: 'Editing.', text: 'We edit the videos in DaVinci Resolve, bringing the music and visuals together into the finished video.' }
            ] },
            { tab: 'What it’s taught me', items: [
              { text: 'Using AI as a creative tool, while keeping our own judgement for the final mix and edit.' },
              { text: 'Hands-on audio mixing in Ableton and video editing in DaVinci Resolve.' },
              { text: 'Running a small creative channel with a partner, from production to publishing.' }
            ] }
          ] }
      ];
      lpLearn = mergeT(lpLearn, TRD && TRD.lp && TRD.lp.learn);
      lpProj = mergeT(lpProj, TRD && TRD.lp && TRD.lp.proj);
      var lpTab = (this.state && this.state.lp === 'proj') ? 'proj' : 'learn';
      var lpList = lpTab === 'proj' ? lpProj : lpLearn;
      var lpOpen = (this.state && typeof this.state.lpOpen === 'number') ? this.state.lpOpen : -1;
      var lpC = lpList[lpOpen] || null;
      var lpSec = (this.state && typeof this.state.lpSec === 'number') ? this.state.lpSec : 0;
      var lpImg = (this.state && typeof this.state.lpImg === 'number') ? this.state.lpImg : 0;
      function lpItems(items) { return (items || []).map(function (it) { return { lead: it.lead || '', hasLead: !!it.lead, text: it.text || '', subs: it.subs || [], hasSubs: !!(it.subs && it.subs.length), after: it.after || '', hasAfter: !!it.after }; }); }
      var lpCur = { mainSrc: '', hasMainSrc: false, noMainSrc: true, mainCls: 'wn-ph', mainBg: 'transparent', hasMedia: false, kind: '', period: '', title: '', sub: '', hasSub: false, tags: [], hasTags: false, intro: [], goal: '', hasGoal: false, link: '', linkHref: '', hasLink: false, images: [], imgN: 1, hasThumbs: false, mainFile: '', mainCaption: '', secTabs: [], showOverview: true, showSec: false, sec: { ordered: false, unordered: true, items: [] } };
      if (lpC) {
        var lpSecs = lpC.sections || [];
        var lpS = Math.max(0, Math.min(lpSecs.length, lpSec));
        var lpI = Math.max(0, Math.min(lpC.images.length - 1, lpImg));
        var lpActive = lpS > 0 ? lpSecs[lpS - 1] : null;
        var lpMainSrc = lpC.images[lpI] ? (IMG[lpC.images[lpI].file] || '') : '';
        lpCur = {
          kind: (lpTab === 'proj' ? 'Project ' : 'Learning ') + lpC.num,
          period: lpC.period,
          title: lpC.title,
          sub: lpC.sub || '',
          hasSub: !!lpC.sub,
          tags: lpC.tags || [],
          hasTags: !!(lpC.tags && lpC.tags.length),
          intro: lpC.intro || [],
          goal: lpC.goal || '',
          hasGoal: !!lpC.goal,
          link: lpC.link || '',
          linkHref: lpC.linkHref || '',
          hasLink: !!lpC.link,
          images: lpC.images.map(function (im, i) { var on = i === lpI; return { src: IMG[im.file] || '', hasSrc: !!IMG[im.file], cls: IMG[im.file] ? '' : 'wn-ph', label: 'Show image ' + (i + 1) + ': ' + im.caption, pressed: on ? 'true' : 'false', border: on ? '2px solid #000000' : '1px solid ' + p.line, pick: function () { self.setState({ lpImg: i }); } }; }),
          imgN: Math.max(1, lpC.images.length),
          hasThumbs: lpC.images.length > 1,
          mainFile: lpC.images[lpI] ? lpC.images[lpI].file : '',
          mainCaption: lpC.images[lpI] ? lpC.images[lpI].caption : '',
          imgPos: (lpI + 1) + ' / ' + lpC.images.length,
          mainSrc: lpMainSrc,
          hasMainSrc: !!lpMainSrc,
          noMainSrc: !lpMainSrc,
          mainCls: lpMainSrc ? '' : 'wn-ph',
          mainBg: 'transparent',
          hasMedia: lpC.images.length > 0,
          secTabs: [tx.overview].concat(lpSecs.map(function (s) { return s.tab; })).map(function (lbl, i) { var on = i === lpS; return { label: lbl, pressed: on ? 'true' : 'false', line: on ? '#000000' : 'transparent', weight: on ? '700' : '400', pick: function () { self.setState({ lpSec: i }); } }; }),
          showOverview: lpS === 0,
          showSec: lpS > 0,
          sec: lpActive ? { ordered: !!lpActive.ordered, unordered: !lpActive.ordered, items: lpItems(lpActive.items) } : { ordered: false, unordered: true, items: [] }
        };
      }
      function lpStep(d) { if (!lpC) return; var n = lpC.images.length; if (n < 2) return; var cur = Math.max(0, Math.min(n - 1, lpImg)); self.setState({ lpImg: (cur + d + n) % n }); }
      var lpHov = (this.state && this.state.lpHov) || 'learn-0';
      function lpRow(kind, c, i) {
        var key = kind + '-' + i;
        var on = key === lpHov;
        return {
          num: c.num,
          title: c.title,
          id: 'lp-card-' + key,
          current: on ? 'true' : 'false',
          goOp: on ? '1' : '0.3',
          hover: function () { if ((self.state && self.state.lpHov) !== key) self.setState({ lpHov: key }); },
          open: function () { self.setState({ lp: kind, lpOpen: i, lpSec: 0, lpImg: 0, lpHov: key }); }
        };
      }
      function lpCard(kind, label, c, i) {
        var art = c.art || '';
        var cv = art ? null : (c.cover ? { file: c.cover } : (c.images || [])[0]);
        var src = cv ? (IMG[cv.file] || '') : '';
        var contain = c.coverFit === 'contain';
        return { kind: label, title: c.title, sub: c.sub || '', hasSub: !!c.sub, art: art, hasArt: !!art, cover: cv ? cv.file : '', src: src, hasSrc: !!src, fit: contain ? 'contain' : 'cover', box: contain ? 'left: 10%; top: 12%; width: 80%; height: 56%' : 'inset: 0; width: 100%; height: 100%', showFile: !!cv && !src, picCls: (cv && !src) ? 'wn-ph' : '', id: 'lp-card-' + kind + '-' + i, open: function () { self.setState({ lp: kind, lpOpen: i, lpSec: 0, lpImg: 0, lpZoom: false }); } };
      }
      var lp = {
        tabs: [{ id: 'learn', label: 'Learnings', n: lpLearn.length }, { id: 'proj', label: 'Projects', n: lpProj.length }].map(function (t) { var on = t.id === lpTab; return { label: t.label, count: ('0' + t.n).slice(-2), pressed: on ? 'true' : 'false', line: on ? '#000000' : 'transparent', pick: function () { self.setState({ lp: t.id, lpOpen: -1, lpSec: 0, lpImg: 0 }); } }; }),
        grid: !lpC,
        detail: !!lpC,
        cardH: 'calc((100vh - 324px) / 2)',
        titleSize: 'clamp(16px, 1.45vw, 20px)',
        allCards: lpLearn.map(function (c, i) { return lpCard('learn', tx.kindLearning, c, i); }).concat(lpProj.map(function (c, i) { return lpCard('proj', tx.kindProject, c, i); })),
        learnRows: lpLearn.map(function (c, i) { return lpRow('learn', c, i); }),
        projRows: lpProj.map(function (c, i) { return lpRow('proj', c, i); }),
        previews: lpLearn.map(function (c, i) { return { file: c.images[0] ? c.images[0].file : '', op: lpHov === 'learn-' + i ? '1' : '0' }; }).concat(lpProj.map(function (c, i) { return { file: c.images[0] ? c.images[0].file : '', op: lpHov === 'proj-' + i ? '1' : '0' }; })),
        cur: lpCur,
        close: function () { self.setState({ lpOpen: -1, lpZoom: false }); },
        zoomOn: open === 'projects' && !!lpC && lpC.images.length > 0 && !!(self.state && self.state.lpZoom),
        zoomOpen: function () { self.zoomOpener = document.activeElement; self.setState({ lpZoom: true }); },
        zoomClose: function () { self.setState({ lpZoom: false }); },
        zoomPrev: function (e) { if (e && e.stopPropagation) e.stopPropagation(); lpStep(-1); },
        zoomNext: function (e) { if (e && e.stopPropagation) e.stopPropagation(); lpStep(1); },
        zoomKey: function (e) { if (!e) return; if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); self.setState({ lpZoom: false }); } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); lpStep(e.key === 'ArrowRight' ? 1 : -1); } },
        setZoomClose: function (el) { self.zoomCloseBtn = el; },
        prevImg: function () { lpStep(-1); },
        nextImg: function () { lpStep(1); }
      };
      var courseIdx = (this.state && typeof this.state.course === 'number') ? this.state.course : -1;
      var cwOpen = !!(this.state && this.state.cwOpen);
      var cw = {
        open: cwOpen,
        expanded: cwOpen ? 'true' : 'false',
        rot: cwOpen ? 'rotate(180deg)' : 'rotate(0deg)',
        dialog: courseIdx >= 0,
        c: courseIdx >= 0 ? courses[courseIdx] : { name: '', who: '', desc: '', sections: [] }
      };
      function openFn(k) { return function () { self.opener = document.activeElement; self.setState({ open: k, ex: null, pj: -1, pjs: 0, lp: 'learn', lpOpen: -1, lpSec: 0, lpImg: 0, lpHov: 'learn-0' }); }; }
      return {
        portrait: IMG['onur-kan.jpg'] || '',
        hasPortrait: !!IMG['onur-kan.jpg'],
        imgErr: siteImgFallback,
        imgOk: siteImgOk,
        rootClass: this.props.motion === false ? 'still' : '',
        p: p,
        lampOn: lampOn,
        lampOp: (lampOn && ((this.state && (this.state.lampLit || this.state.aboutHot)) || this.noHover)) ? '1' : '0',
        lampFlick: (lampOn && ((this.state && (this.state.lampLit || this.state.aboutHot)) || this.noHover)) ? 'lm-flick' : '',
        aboutOn: function () { if (!(self.state && self.state.aboutHot)) self.setState({ aboutHot: true }); },
        aboutOff: function () { if (self.state && self.state.aboutHot) self.setState({ aboutHot: false }); },
        lampMove: function (e) {
          if (!lampOn || !e || !e.currentTarget || !e.currentTarget.getBoundingClientRect) return;
          var r = e.currentTarget.getBoundingClientRect();
          var lx = r.left + r.width * 0.93, ly = r.top + r.height * 0.11;
          var dx = e.clientX - lx, dy = e.clientY - ly;
          var d = Math.sqrt(dx * dx + dy * dy);
          var R = Math.max(260, Math.min(r.width, r.height) * 0.5);
          var lit = !!(self.state && self.state.lampLit);
          var inZone = false;
          if (self.navEl && self.navEl.getBoundingClientRect) { var nr = self.navEl.getBoundingClientRect(); inZone = e.clientX >= nr.left - 24 && e.clientY >= nr.top - 24; }
          var want = inZone || (lit ? d <= R * 1.15 : d < R);
          if (want !== lit) self.setState({ lampLit: want });
        },
        setNav: function (el) { self.navEl = el; },
        lampLeave: function () { if (self.state && self.state.lampLit) self.setState({ lampLit: false }); },
        paperClass: lampOn ? 'wn-paper' : '',
        bigClass: this.props.largerText === false ? '' : 'wn-big',
        footBg: lampOn ? '#E9ECE7' : 'rgba(0, 0, 0, 0.13)',
        texOpacity: (sageOn || lampOn) ? '0' : String((this.props.texture ?? 60) / 100),
        sageOpacity: sageOn ? '1' : '0',
        padovaOn: glow === 'Padova (M.Sc.)' ? '1' : '0',
        marmaraOn: glow === 'Marmara (B.Sc.)' ? '1' : '0',
        langs: langs,
        win: win,
        about: mergeT(about, TRD && TRD.about),
        courses: courses.map(function (c, i) { return Object.assign({}, c, { open: function () { self.courseOpener = document.activeElement; self.setState({ course: i }); } }); }),
        cw: cw,
        toggleCw: function () { self.setState({ cwOpen: !cw.open }); },
        closeCourse: function () { self.setState({ course: -1 }); },
        courseKey: function (e) { if (e && e.key === 'Escape') { e.stopPropagation(); self.setState({ course: -1 }); } },
        setCourseClose: function (el) { self.courseCloseBtn = el; },
        jobs: mergeT(jobs, TRD && TRD.jobs).map(function (j) { return Object.assign({}, j, { hasAbout: !!j.about, hasBg: !!j.bgClass, bgClass: j.bgClass || '' }); }),
        pjG: (function () {
          var k = (self.state && typeof self.state.pj === 'number') ? self.state.pj : -1;
          var s = steps[k];
          if (!s) return { grid: true, detail: false, cur: { num: '', when: '', title: '', text: '', cover: '', more: [], moreN: 1, hasMore: false, backId: '' }, close: function () {} };
          var imgs = s.images || [];
          return {
            grid: false,
            detail: true,
            cur: { num: s.num, when: s.when, title: s.title, text: s.text, cover: imgs[0] ? imgs[0].file : '', more: imgs.slice(1), moreN: Math.max(1, imgs.length - 1), hasMore: imgs.length > 1, backId: 'pj-head-' + k },
            close: function () { self.setState({ pj: -1 }); }
          };
        })(),
        lp: lp,
        tx: tx,
        ed: ed,
        canBack: open === 'projects' && !!lpC,
        noBack: !(open === 'projects' && !!lpC),
        headCur: (open === 'projects' && !!lpC) ? 'pointer' : 'auto',
        headBack: function () { if (open === 'projects' && self.state && self.state.lpOpen >= 0) self.setState({ lpOpen: -1 }); },
        pjOff: false,
        pjSlider: pjSliderOn,
        bodyClass: open === 'projects' ? 'wn-noscroll wn-lock' : '',
        pjGallery: !pjSliderOn,
        pjS: pjS,
        pjSlides: pjSlides,
        pjPrev: function () { pjGo(pjIdx - 1); },
        pjNext: function () { pjGo(pjIdx + 1); },
        setPjTrack: function (el) { self.pjTrack = el; },
        pjDown: function (e) {
          if (!e || (e.pointerType === 'mouse' && e.button !== 0)) return;
          self.pjDrag = { x: e.clientX, dx: 0, on: false, id: e.pointerId, el: e.currentTarget };
        },
        pjMove: function (e) {
          var d = self.pjDrag; var t = self.pjTrack; if (!d || !e) return;
          var dx = e.clientX - d.x;
          if (!d.on) { if (Math.abs(dx) < 6) return; d.on = true; try { if (d.el && d.el.setPointerCapture) d.el.setPointerCapture(d.id); } catch (err) {} if (t) { t.style.transition = 'none'; if (t.parentNode) t.parentNode.classList.add('ex-dragging'); } }
          var edge = (pjIdx === 0 && dx > 0) || (pjIdx === pjN - 1 && dx < 0);
          d.dx = edge ? dx * 0.3 : dx;
          if (t) t.style.transform = 'translateX(calc(' + (-100 * pjIdx) + '% + ' + d.dx + 'px))';
        },
        pjUp: function () {
          var d = self.pjDrag; var t = self.pjTrack; self.pjDrag = null; if (!d || !d.on) return; self.pjJustDragged = Date.now();
          var w = (t && t.parentNode) ? t.parentNode.clientWidth : 800;
          var lim = Math.min(120, w * 0.15);
          var nx = pjIdx; if (d.dx < -lim) nx = pjIdx + 1; else if (d.dx > lim) nx = pjIdx - 1;
          nx = Math.max(0, Math.min(pjN - 1, nx));
          if (t) { t.style.transition = ''; t.style.transform = 'translateX(' + (-100 * nx) + '%)'; if (t.parentNode) t.parentNode.classList.remove('ex-dragging'); }
          if (nx !== pjIdx) pjGo(nx);
        },
        pjWheel: function (e) {
          if (!e) return; var ax = Math.abs(e.deltaX || 0), ay = Math.abs(e.deltaY || 0);
          if (ax < 4 || ax < ay) return;
          var now = Date.now();
          if (self.pjWheelLock && now < self.pjWheelLock) return;
          if (!self.pjWheelT || now - self.pjWheelT > 300) self.pjWheelAcc = 0;
          self.pjWheelT = now;
          self.pjWheelAcc = (self.pjWheelAcc || 0) + e.deltaX;
          if (Math.abs(self.pjWheelAcc) > 60) { var dir = self.pjWheelAcc > 0 ? 1 : -1; self.pjWheelAcc = 0; self.pjWheelLock = now + 900; pjGo(pjIdx + dir); }
        },
        exSlider: exSliderOn,
        exList: !exSliderOn,
        ex: ex,
        exJobs: exJobs,
        exYears: exYears,
        exPrev: function () { exGo(exIdx - 1); },
        exNext: function () { exGo(exIdx + 1); },
        setExTrack: function (el) { self.exTrack = el; },
        exDown: function (e) {
          if (!e || (e.pointerType === 'mouse' && e.button !== 0)) return;
          self.exDrag = { x: e.clientX, dx: 0, on: false };
          try { var el = e.currentTarget; if (el && el.setPointerCapture) el.setPointerCapture(e.pointerId); } catch (err) {}
        },
        exMove: function (e) {
          var d = self.exDrag; var t = self.exTrack; if (!d || !e) return;
          var dx = e.clientX - d.x;
          if (!d.on) { if (Math.abs(dx) < 6) return; d.on = true; if (t) { t.style.transition = 'none'; if (t.parentNode) t.parentNode.classList.add('ex-dragging'); } }
          var edge = (exIdx === 0 && dx > 0) || (exIdx === exN - 1 && dx < 0);
          d.dx = edge ? dx * 0.3 : dx;
          if (t) t.style.transform = 'translateX(calc(' + (-100 * exIdx) + '% + ' + d.dx + 'px))';
        },
        exUp: function () {
          var d = self.exDrag; var t = self.exTrack; self.exDrag = null; if (!d || !d.on) return;
          var w = (t && t.parentNode) ? t.parentNode.clientWidth : 800;
          var lim = Math.min(120, w * 0.15);
          var nx = exIdx; if (d.dx < -lim) nx = exIdx + 1; else if (d.dx > lim) nx = exIdx - 1;
          nx = Math.max(0, Math.min(exN - 1, nx));
          if (t) { t.style.transition = ''; t.style.transform = 'translateX(' + (-100 * nx) + '%)'; if (t.parentNode) t.parentNode.classList.remove('ex-dragging'); }
          if (nx !== exIdx) exGo(nx);
        },
        exWheel: function (e) {
          if (!e) return; var ax = Math.abs(e.deltaX || 0), ay = Math.abs(e.deltaY || 0);
          if (ax < 4 || ax < ay) return;
          var now = Date.now();
          if (self.exWheelLock && now < self.exWheelLock) return;
          if (!self.exWheelT || now - self.exWheelT > 300) self.exWheelAcc = 0;
          self.exWheelT = now;
          self.exWheelAcc = (self.exWheelAcc || 0) + e.deltaX;
          if (Math.abs(self.exWheelAcc) > 60) { var dir = self.exWheelAcc > 0 ? 1 : -1; self.exWheelAcc = 0; self.exWheelLock = now + 900; exGo(exIdx + dir); }
        },
        steps: (function () {
          var pjIdx = (self.state && typeof self.state.pj === 'number') ? self.state.pj : -1;
          return steps.map(function (s, i) {
            var on = pjIdx === i;
            var imgs = s.images || [];
            return Object.assign({}, s, {
              open: on,
              closed: !on,
              id: 'pj-card-' + i,
              headId: 'pj-head-' + i,
              cover: imgs[0] ? imgs[0].file : '',
              more: imgs.slice(1),
              hasMore: imgs.length > 1,
              gcol: (steps.length === 5 && i === 3) ? '2 / span 2' : ((steps.length === 5 && i === 4) ? '4 / span 2' : 'span 2'),
              toggle: function () { self.setState({ pj: on ? -1 : i }); }
            });
          });
        })(),
        openAbout: openFn('about'),
        openEducation: openFn('education'),
        openExperience: openFn('experience'),
        openProjects: openFn('projects'),
        closeWin: function () { self.setState({ open: '', course: -1, cwOpen: false }); },
        stop: function (e) { if (e && e.stopPropagation) e.stopPropagation(); },
        winKey: function (e) { if (e && e.key === 'Escape') { e.stopPropagation(); if (open === 'projects' && self.state && (self.state.pj >= 0 || self.state.pjd >= 0 || self.state.lpOpen >= 0)) { self.setState({ pj: -1, pjd: -1, lpOpen: -1 }); } else { self.setState({ open: '', course: -1, cwOpen: false }); } } else if (e && open === 'experience' && exSliderOn && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) { e.preventDefault(); exGo(exIdx + (e.key === 'ArrowRight' ? 1 : -1)); } else if (e && open === 'projects' && pjSliderOn && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) { e.preventDefault(); pjGo(pjIdx + (e.key === 'ArrowRight' ? 1 : -1)); } else if (e && open === 'projects' && lpC && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) { e.preventDefault(); lpStep(e.key === 'ArrowRight' ? 1 : -1); } },
        setCloseBtn: function (el) { self.closeBtn = el; }
      };
    }
  }

  /* ---------- start ---------- */

  function start() {
    var tpl = document.getElementById('page');
    app.root = document.getElementById('app');
    app.tree = compileKids(tpl.content);
    var props = {
      background: SITE.background || 'Lamp',
      palette: 'Porcelain & Ink',
      glowPreview: 'Off',
      texture: 60,
      motion: true,
      largerText: true,
      experienceLayout: 'List'
    };
    document.body.style.backgroundColor = props.background === 'Lamp' ? '#7C8D80' : '#EAEAE6';
    app.comp = new Component(props);
    render();
    app.lastState = app.comp.state;
    app.mounted = true;
    if (app.comp.componentDidMount) app.comp.componentDidMount();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
