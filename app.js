(() => {
  'use strict';
  const FILES = {
    connections: 'data/conn_profs_ai.csv',
    mentorship: 'data/ment_profs_ai.csv',
    universities: 'data/universities.csv'
  };
  const PAGE_SIZE = 25;
  const $ = (selector) => document.querySelector(selector);
  const state = {
    view: 'universities', query: '', level: '', country: '', region: '', sort: '', page: 1,
    openId: '', people: { connections: [], mentorship: [] }, universities: [],
    universityIndex: new Map(), linkedAffiliations: 0
  };

  function parseCSV(text) {
    const input = text.replace(/^\uFEFF/, '');
    const rows = [];
    let row = [], field = '', quoted = false;
    for (let i = 0; i < input.length; i++) {
      const ch = input[i];
      if (quoted) {
        if (ch === '"' && input[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') quoted = false;
        else field += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (ch !== '\r') field += ch;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r, index) => index === 0 || r.some(v => String(v).trim() !== ''));
  }

  function norm(value) { return String(value ?? '').trim().toLocaleLowerCase().replace(/\s+/g, ' '); }
  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }
  function findColumn(headers, candidates) {
    const normalized = headers.map(h => norm(h));
    for (const candidate of candidates) {
      const index = normalized.indexOf(norm(candidate));
      if (index !== -1) return index;
    }
    return -1;
  }
  function readField(row, index) { return index >= 0 ? String(row[index] ?? '').trim() : ''; }
  function makePeople(rows, dataset) {
    const headers = rows[0] || [];
    const keyIndex = findColumn(headers, ['Key', 'ID', 'Identifier']);
    const firstIndex = findColumn(headers, ['First Name', 'First']);
    const lastIndex = findColumn(headers, ['Last Name', 'Last', 'Surname']);
    const levelIndex = findColumn(headers, ['Level']);
    const noteIndex = findColumn(headers, ['Notes/Evidence', 'Notes', 'Evidence']);
    const uniIndex = findColumn(headers, ['Universities', 'University', 'Affiliations']);
    if ([keyIndex, firstIndex, lastIndex].some(i => i < 0)) {
      throw new Error(`${dataset} CSV is missing one of the required columns: Key, First Name, or Last Name.`);
    }
    return rows.slice(1).map(row => ({
      id: readField(row, keyIndex),
      firstName: readField(row, firstIndex),
      lastName: readField(row, lastIndex),
      level: readField(row, levelIndex),
      note: readField(row, noteIndex),
      affiliations: uniIndex < 0 ? [] : row.slice(uniIndex).map(v => String(v ?? '').trim()).filter(Boolean),
      dataset
    })).filter(p => p.id || p.firstName || p.lastName);
  }
  function makeUniversities(rows) {
    const headers = rows[0] || [];
    const nameIndex = findColumn(headers, ['University', 'University Name', 'Name']);
    const countryIndex = findColumn(headers, ['Country']);
    const stateIndex = findColumn(headers, ['State', 'Province', 'Region']);
    const levelIndex = findColumn(headers, ['Level']);
    const totalIndex = findColumn(headers, ['Total']);
    if (nameIndex < 0) throw new Error('The universities CSV is missing its University column.');
    return rows.slice(1).map(row => ({
      name: readField(row, nameIndex), country: readField(row, countryIndex),
      region: readField(row, stateIndex), level: readField(row, levelIndex),
      total: readField(row, totalIndex)
    })).filter(u => u.name);
  }
  function numberOrNull(value) {
    const n = Number(value);
    return value !== '' && Number.isFinite(n) ? n : null;
  }
  function levelCompare(a, b) {
    const na = numberOrNull(a), nb = numberOrNull(b);
    if (na !== null && nb !== null) return na - nb;
    if (na !== null) return -1;
    if (nb !== null) return 1;
    return String(a).localeCompare(String(b), undefined, {numeric:true, sensitivity:'base'});
  }
  function levelCompareDesc(a, b) {
    const na = numberOrNull(a), nb = numberOrNull(b);
    if (na !== null && nb !== null) return nb - na;
    if (na !== null) return -1;
    if (nb !== null) return 1;
    return String(a).localeCompare(String(b), undefined, {numeric:true, sensitivity:'base'});
  }
  function personName(p) {
    const first = String(p.firstName || '').trim();
    const last = String(p.lastName || '').trim();
    if (first && last) return `${last}, ${first}`;
    return last || first || 'Unnamed professor';
  }
  function personHref(person) { return `?view=${encodeURIComponent(person.dataset)}&person=${encodeURIComponent(person.id)}`; }
  function universityHref(name) { return `?view=universities&university=${encodeURIComponent(name)}`; }
  function linkedUniversity(name) { return state.universityIndex.get(norm(name)); }
  function affiliationHTML(name) {
    const uni = linkedUniversity(name);
    const safe = escapeHTML(name);
    return uni
      ? `<a class="aff-chip linked" href="${universityHref(uni.name)}" title="Open ${safe}">${safe}</a>`
      : `<span class="aff-chip unlinked" title="No exact university-index match">${safe}</span>`;
  }
  function levelHTML(level) {
    const safe = escapeHTML(level || '—');
    const cls = /^[0-5]$/.test(String(level)) ? ` level-${level}` : '';
    return `<span class="level-pill${cls}">${safe}</span>`;
  }
  function formatCount(n) { return new Intl.NumberFormat().format(n); }
  function buildIndexes() {
    state.universityIndex = new Map(state.universities.map(u => [norm(u.name), u]));
    let linked = 0;
    [...state.people.connections, ...state.people.mentorship].forEach(p => {
      const unique = new Set(p.affiliations.map(norm).filter(k => state.universityIndex.has(k)));
      linked += unique.size;
    });
    state.linkedAffiliations = linked;
    const allPeople = [...state.people.connections, ...state.people.mentorship];
    $('#connectionTabCount').textContent = formatCount(state.people.connections.length);
    $('#mentorshipTabCount').textContent = formatCount(state.people.mentorship.length);
    $('#universitiesTabCount').textContent = formatCount(state.universities.length);
  }
  function relatedPeople(uniName) {
    const key = norm(uniName);
    return {
      connections: state.people.connections.filter(p => p.affiliations.some(a => norm(a) === key)),
      mentorship: state.people.mentorship.filter(p => p.affiliations.some(a => norm(a) === key))
    };
  }
  function setView(view, preserveQuery = false) {
    if (!['connections','mentorship','universities'].includes(view)) view = 'connections';
    state.view = view;
    state.page = 1;
    state.openId = '';
    if (!preserveQuery) { state.query = ''; state.level = ''; state.country = ''; state.region = ''; }
    render();
  }
  function getRows() {
    const q = norm(state.query);
    if (state.view === 'universities') {
      let rows = state.universities.filter(u => (!q || norm([u.name,u.country,u.region,u.level,u.total].join(' ')).includes(q)) && (!state.level || u.level === state.level) && (!state.country || u.country === state.country) && (!state.region || u.region === state.region));
      const sort = state.sort || 'total-desc';
      rows.sort((a,b) => {
        if (sort === 'name-asc') return a.name.localeCompare(b.name);
        if (sort === 'country-asc') return a.country.localeCompare(b.country) || a.name.localeCompare(b.name);
        if (sort === 'level-asc') return levelCompare(a.level,b.level) || a.name.localeCompare(b.name);
        if (sort === 'total-asc') return (numberOrNull(a.total) ?? -Infinity) - (numberOrNull(b.total) ?? -Infinity);
        return (numberOrNull(b.total) ?? -Infinity) - (numberOrNull(a.total) ?? -Infinity);
      });
      return rows;
    }
    let rows = state.people[state.view].filter(p => {
      const haystack = norm([p.firstName,p.lastName,p.affiliations.join(' '),p.level].join(' '));
      return (!q || haystack.includes(q)) && (!state.level || p.level === state.level);
    });
    const sort = state.sort || 'level-desc';
    rows.sort((a,b) => {
      if (sort === 'first-asc') return a.firstName.localeCompare(b.firstName) || a.lastName.localeCompare(b.lastName);
      if (sort === 'level-asc') return levelCompare(a.level,b.level) || a.lastName.localeCompare(b.lastName);
      if (sort === 'level-desc') return levelCompareDesc(a.level,b.level) || a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName);
      if (sort === 'affiliations-desc') return b.affiliations.length - a.affiliations.length || a.lastName.localeCompare(b.lastName);
      return a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName);
    });
    return rows;
  }
  function updateControls() {
    const isUniversity = state.view === 'universities';
    $('#searchInput').placeholder = isUniversity ? 'Search by university, country, or state' : 'Search by name or university affiliation';
    $('#searchInput').value = state.query;
    $('#levelLabel').textContent = 'Level';
    const records = isUniversity ? state.universities : state.people[state.view];
    const levels = [...new Set(records.map(r => r.level).filter(Boolean))].sort(levelCompare);
    $('#levelFilter').innerHTML = '<option value="">All levels</option>' + levels.map(l => `<option value="${escapeHTML(l)}">Level ${escapeHTML(l)}</option>`).join('');
    $('#levelFilter').value = state.level;
    $('#levelFilter').hidden = isUniversity;
    $('#levelLabel').parentElement.hidden = isUniversity;
    $('#countryFilterWrap').hidden = !isUniversity;
    $('#stateFilterWrap').hidden = !isUniversity;
    if (isUniversity) {
      const countries = [...new Set(state.universities.map(u => u.country).filter(Boolean))].sort((a,b) => a.localeCompare(b));
      const regions = [...new Set(state.universities.filter(u => !state.country || u.country === state.country).map(u => u.region).filter(Boolean))].sort((a,b) => a.localeCompare(b));
      if (state.region && !regions.includes(state.region)) state.region = '';
      $('#countryFilter').innerHTML = '<option value="">All countries</option>' + countries.map(v => `<option value="${escapeHTML(v)}">${escapeHTML(v)}</option>`).join('');
      $('#stateFilter').innerHTML = '<option value="">All states</option>' + regions.map(v => `<option value="${escapeHTML(v)}">${escapeHTML(v)}</option>`).join('');
      $('#countryFilter').value = state.country;
      $('#stateFilter').value = state.region;
    }
    const options = isUniversity
      ? [['total-desc','Epstein Score (high to low)'],['total-asc','Epstein Score (low to high)'],['name-asc','University name (A–Z)'],['country-asc','Country (A–Z)'],['level-asc','Level (low to high)']]
      : [['last-asc','Last name (A–Z)'],['first-asc','First name (A–Z)'],['level-asc','Level (low to high)'],['level-desc','Level (high to low)'],['affiliations-desc','Affiliations (most first)']];
    $('#sortSelect').innerHTML = options.map(([v,l]) => `<option value="${v}">${l}</option>`).join('');
    const defaultSort = isUniversity ? 'total-desc' : 'level-desc';
    if (!options.some(([v]) => v === state.sort)) state.sort = defaultSort;
    $('#sortSelect').value = state.sort;
    document.querySelectorAll('.tab').forEach(tab => {
      const active = tab.dataset.view === state.view;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
  }
  function personDetail(p) {
    const noteHTML = p.note
      ? escapeHTML(p.note)
      : state.evidenceRedacted
        ? '<span class="subtle">Omitted from the supplied preview. The original entry may or may not contain evidence.</span>'
        : '<span class="subtle">No Notes/Evidence listed.</span>';
    const affHTML = p.affiliations.length
      ? p.affiliations.map(affiliationHTML).join('')
      : '<span class="subtle">No university affiliation listed.</span>';
    return `<div class="detail-content"><div class="detail-block"><h4>Notes / Evidence</h4><p>${noteHTML}</p><p style="margin-top:11px;color:#92a0a6;font-size:10px">Level ${levelHTML(p.level)}</p></div><div class="detail-block"><h4>All listed affiliations · ${p.affiliations.length}</h4><div class="detail-affiliations">${affHTML}</div></div></div>`;
  }
  function renderPeopleTable(rows) {
    const start = (state.page - 1) * PAGE_SIZE;
    const pageRows = rows.slice(start, start + PAGE_SIZE);
    const body = pageRows.map(p => {
      const id = `person:${p.dataset}:${p.id}`;
      const open = state.openId === id;
      const shown = p.affiliations.slice(0,3).map(affiliationHTML).join('');
      const extra = p.affiliations.length > 3 ? `<span class="more-chip">+${p.affiliations.length - 3} more</span>` : '';
      return `<tr class="result-row" data-row-id="${escapeHTML(id)}"><td><a class="professor-name" href="${personHref(p)}">${escapeHTML(personName(p) || 'Unnamed professor')}</a></td><td>${levelHTML(p.level)}</td><td><div class="aff-preview">${shown || '<span class="subtle">No affiliation listed</span>'}${extra}</div></td><td><button class="detail-button" type="button" data-expand="${escapeHTML(id)}" aria-expanded="${open}">${open ? 'Close −' : 'Details +'}</button></td></tr>${open ? `<tr class="detail-row"><td colspan="4">${personDetail(p)}</td></tr>` : ''}`;
    }).join('');
    return `<table class="data-table"><thead><tr><th>Professor</th><th>Level</th><th>University affiliations</th><th></th></tr></thead><tbody>${body}</tbody></table>`;
  }
  function universityDetail(uni) {
    const related = relatedPeople(uni.name);
    const groupHTML = (dataset, title) => {
      const people = related[dataset];
      return `<div class="related-list"><h4>${title} · ${people.length}</h4>${people.length ? people.map(p => `<a class="related-person" href="${personHref(p)}">${escapeHTML(personName(p))}<span>Level ${levelHTML(p.level)}</span></a>`).join('') : '<p class="subtle">No exact matches in this list.</p>'}</div>`;
    };
    return `<div class="detail-content" style="grid-template-columns:minmax(170px,.65fr) minmax(300px,1.8fr)"><div class="detail-block"><h4>University details</h4><p>${escapeHTML(uni.country || 'Country not listed')}${uni.region ? ` · ${escapeHTML(uni.region)}` : ''}</p><p style="margin-top:7px;color:#92a0a6;font-size:10px">Level ${levelHTML(uni.level)} · Epstein Score ${escapeHTML(uni.total || '—')}</p></div><div class="related-lists">${groupHTML('connections','Connected professors')}${groupHTML('mentorship','Mentioned professors')}</div></div>`;
  }
  function renderUniversityTable(rows) {
    const start = (state.page - 1) * PAGE_SIZE;
    const pageRows = rows.slice(start, start + PAGE_SIZE);
    const body = pageRows.map(uni => {
      const id = `university:${norm(uni.name)}`;
      const open = state.openId === id;
      const related = relatedPeople(uni.name);
      const count = related.connections.length;
      
      return `<tr class="result-row university-row" data-row-id="${escapeHTML(id)}"><td><a class="university-name" href="${universityHref(uni.name)}">${escapeHTML(uni.name)}</a></td><td>${escapeHTML(uni.country || '—')}</td><td>${escapeHTML(uni.region || '—')}</td><td>${levelHTML(uni.level)}</td><td>${escapeHTML(uni.total || '—')}</td><td>${formatCount(count)}</td><td><button class="detail-button" type="button" data-expand="${escapeHTML(id)}" aria-expanded="${open}">${open ? 'Close −' : 'Details +'}</button></td></tr>${open ? `<tr class="detail-row"><td colspan="7">${universityDetail(uni)}</td></tr>` : ''}`;
    }).join('');
    return `<table class="data-table"><thead><tr><th>University</th><th>Country</th><th>State</th><th>Level</th><th>Epstein Score</th><th>Connected People</th><th></th></tr></thead><tbody>${body}</tbody></table>`;
  }
  function syncURL() {
    const url = new URL(window.location.href);
    url.search = '';
    url.searchParams.set('view', state.view);
    if (state.query) url.searchParams.set('q', state.query);
    if (state.level) url.searchParams.set('level', state.level);
    if (state.country) url.searchParams.set('country', state.country);
    if (state.region) url.searchParams.set('state', state.region);
    if (state.openId.startsWith('person:')) {
      const [, dataset, ...key] = state.openId.split(':');
      url.searchParams.set('view', dataset);
      url.searchParams.set('person', key.join(':'));
    } else if (state.openId.startsWith('university:')) {
      const name = state.universities.find(u => `university:${norm(u.name)}` === state.openId)?.name;
      if (name) url.searchParams.set('university', name);
    }
    history.replaceState({}, '', url);
  }
  function render() {
    updateControls();
    const rows = getRows();
    const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    state.page = Math.min(state.page, totalPages);
    const isUniversity = state.view === 'universities';
    $('#resultsSummary').textContent = `${formatCount(rows.length)} ${isUniversity ? 'universities' : 'professor records'}${state.query || state.level || state.country || state.region ? ' found' : ''}`;
    if (rows.length) $('#tableMount').innerHTML = isUniversity ? renderUniversityTable(rows) : renderPeopleTable(rows);
    else $('#tableMount').innerHTML = `<div class="table-empty"><div><strong>No matching records</strong><p>Try a different name, key, affiliation, or level filter.</p></div></div>`;
    $('#pagination').hidden = rows.length <= PAGE_SIZE;
    $('#pageStatus').textContent = `Page ${state.page} of ${totalPages} · ${formatCount(rows.length)} results`;
    $('#prevPage').disabled = state.page <= 1;
    $('#nextPage').disabled = state.page >= totalPages;
    syncURL();
  }
  async function loadCSV(path) {
    const response = await fetch(path, {cache:'no-store'});
    if (!response.ok) throw new Error(`Could not load ${path} (HTTP ${response.status}).`);
    return parseCSV(await response.text());
  }
  function initialiseFromURL() {
    const params = new URLSearchParams(window.location.search);
    const view = params.get('view') || 'universities';
    state.view = ['connections','mentorship','universities'].includes(view) ? view : 'universities';
    state.query = params.get('q') || '';
    state.level = params.get('level') || '';
    state.country = params.get('country') || '';
    state.region = params.get('state') || '';
    const person = params.get('person');
    const university = params.get('university');
    if (person) state.openId = `person:${state.view}:${person}`;
    if (university) { state.view = 'universities'; state.openId = `university:${norm(university)}`; }
  }
  function bindEvents() {
    document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => setView(tab.dataset.view)));
    $('#searchInput').addEventListener('input', e => { state.query = e.target.value; state.page = 1; state.openId = ''; render(); });
    $('#levelFilter').addEventListener('change', e => { state.level = e.target.value; state.page = 1; state.openId = ''; render(); });
    $('#countryFilter').addEventListener('change', e => { state.country = e.target.value; state.page = 1; state.openId = ''; render(); });
    $('#stateFilter').addEventListener('change', e => { state.region = e.target.value; state.page = 1; state.openId = ''; render(); });
    $('#sortSelect').addEventListener('change', e => { state.sort = e.target.value; state.page = 1; render(); });
    $('#resetButton').addEventListener('click', () => { state.query=''; state.level=''; state.country=''; state.region=''; state.openId=''; state.page=1; render(); });
    $('#tableMount').addEventListener('click', e => {
      const button = e.target.closest('[data-expand]');
      if (!button) return;
      const id = button.dataset.expand;
      state.openId = state.openId === id ? '' : id;
      render();
    });
    $('#prevPage').addEventListener('click', () => { state.page = Math.max(1,state.page-1); state.openId=''; render(); });
    $('#nextPage').addEventListener('click', () => { state.page += 1; state.openId=''; render(); });
    document.addEventListener('keydown', e => {
      if (e.key === '/' && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) { e.preventDefault(); $('#searchInput').focus(); }
      if (e.key === 'Escape' && document.activeElement === $('#searchInput')) { $('#searchInput').value=''; state.query=''; state.page=1; render(); }
    });
  }
  async function start() {
    try {
      const [connections, mentorship, universities] = await Promise.all([
        loadCSV(FILES.connections), loadCSV(FILES.mentorship), loadCSV(FILES.universities)
      ]);
      state.people.connections = makePeople(connections, 'connections');
      state.people.mentorship = makePeople(mentorship, 'mentorship');
      state.universities = makeUniversities(universities);
      buildIndexes();
      initialiseFromURL();
      bindEvents();
      render();
      // Open a requested record on the correct page after filters and sorting are applied.
      if (state.openId) {
        const rows = getRows();
        const index = state.view === 'universities'
          ? rows.findIndex(u => `university:${norm(u.name)}` === state.openId)
          : rows.findIndex(p => `person:${p.dataset}:${p.id}` === state.openId);
        if (index >= 0) {
          state.page = Math.floor(index / PAGE_SIZE) + 1;
          render();
          // Bring cross-tab deep links into view after the correct page has rendered.
          window.requestAnimationFrame(() => {
            const target = [...document.querySelectorAll('[data-row-id]')].find(row => row.dataset.rowId === state.openId);
            if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          });
        } else { state.openId = ''; render(); }
      }
    } catch (error) {
      console.error(error);
      $('#tableMount').innerHTML = `<div class="table-empty"><div><strong>Could not load the dataset</strong><p>${escapeHTML(error.message)} Check that the three CSV files are in the <code>data</code> folder and run this site through a local web server or GitHub Pages.</p></div></div>`;
      $('#resultsSummary').textContent = 'Dataset unavailable';
    }
  }
  start();
})();
