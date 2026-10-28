(() => {
  'use strict';

  const API = '/api/console';
  const STATUS_VALUES = ['P', 'R', 'A'];

  const state = {
    csrf: '',
    expiresAt: null,
    data: null,
    roster: [],
    selectedId: null,
    view: 'overview',
    draft: new Map(),
    dirty: false,
    saving: false,
    loggingIn: false,
    modalMode: 'add',
    modalMeetingId: null,
    modalBusy: false,
    markSearch: '',
    overviewSearch: '',
  };

  const dom = {};
  let toastTimer = 0;
  let expiryTimer = 0;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    cacheDom();
    if (!dom.consoleView) return;
    bindEvents();
    bootstrap();
  }

  function cacheDom() {
    const ids = {
      bootView: 'boot-view',
      loginView: 'login-view',
      loginForm: 'login-form',
      loginSubmit: 'login-submit',
      loginError: 'login-error',
      adminPassword: 'admin-password',
      togglePassword: 'toggle-password',
      consoleView: 'console-view',
      lockBtn: 'lock-btn',
      addMeetingBtn: 'add-meeting-btn',
      overviewBtn: 'overview-btn',
      meetingList: 'meeting-list',
      sessionExpiry: 'session-expiry',
      overviewPanel: 'overview-panel',
      overviewSub: 'overview-sub',
      exportCsv: 'export-csv',
      overviewEmpty: 'overview-empty',
      emptyAddBtn: 'empty-add-btn',
      overviewContent: 'overview-content',
      statMeetings: 'stat-meetings',
      statOperators: 'stat-operators',
      statRate: 'stat-rate',
      statPerfect: 'stat-perfect',
      overviewSearch: 'overview-search',
      overviewCount: 'overview-count',
      overviewBody: 'overview-body',
      meetingPanel: 'meeting-panel',
      meetingTitle: 'meeting-title',
      meetingMeta: 'meeting-meta',
      editMeetingBtn: 'edit-meeting-btn',
      deleteMeetingBtn: 'delete-meeting-btn',
      markSearch: 'mark-search',
      markCount: 'mark-count',
      saveBtn: 'save-btn',
      saveBtnBottom: 'save-btn-bottom',
      saveNote: 'save-note',
      markFooterCount: 'mark-footer-count',
      markFooterNote: 'mark-footer-note',
      markBody: 'mark-body',
      meetingModal: 'meeting-modal',
      meetingForm: 'meeting-form',
      modalKicker: 'modal-kicker',
      modalTitle: 'modal-title',
      modalClose: 'modal-close',
      modalCancel: 'modal-cancel',
      modalSubmit: 'modal-submit',
      modalError: 'modal-error',
      meetingDate: 'meeting-date',
      meetingDateHint: 'meeting-date-hint',
      meetingLabel: 'meeting-label',
      toast: 'toast',
    };

    for (const [key, id] of Object.entries(ids)) {
      dom[key] = document.getElementById(id);
    }
  }

  function bindEvents() {
    dom.loginForm.addEventListener('submit', handleLoginSubmit);
    dom.togglePassword.addEventListener('click', togglePasswordVisibility);
    dom.adminPassword.addEventListener('input', () => {
      dom.loginError.textContent = '';
    });

    dom.lockBtn.addEventListener('click', lockConsole);
    dom.addMeetingBtn.addEventListener('click', () => openMeetingModal('add'));
    dom.emptyAddBtn.addEventListener('click', () => openMeetingModal('add'));
    dom.overviewBtn.addEventListener('click', showOverview);

    dom.overviewSearch.addEventListener('input', (event) => {
      state.overviewSearch = event.target.value;
      renderOverviewRows();
    });

    dom.markSearch.addEventListener('input', (event) => {
      state.markSearch = event.target.value;
      renderMarkTable();
    });

    dom.markBody.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest('button[data-status]');
      if (!button || !dom.markBody.contains(button)) return;
      const row = button.closest('tr[data-username]');
      if (!row) return;
      setStatus(row.dataset.username, button.dataset.status, row);
    });

    dom.markBody.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest('button[data-status]');
      if (!button || !dom.markBody.contains(button)) return;
      event.preventDefault();
      button.click();
    });

    dom.saveBtn.addEventListener('click', saveAttendance);
    dom.saveBtnBottom.addEventListener('click', saveAttendance);
    dom.editMeetingBtn.addEventListener('click', () => openMeetingModal('edit'));
    dom.deleteMeetingBtn.addEventListener('click', deleteMeeting);
    dom.exportCsv.addEventListener('click', exportCsv);

    document.querySelectorAll('[data-bulk]').forEach((button) => {
      button.addEventListener('click', () => {
        applyBulk(button.dataset.bulk);
      });
    });

    dom.meetingForm.addEventListener('submit', handleMeetingSubmit);
    dom.modalClose.addEventListener('click', closeMeetingModal);
    dom.modalCancel.addEventListener('click', closeMeetingModal);
    dom.meetingModal.addEventListener('cancel', (event) => {
      if (state.modalBusy) event.preventDefault();
    });
    dom.meetingModal.addEventListener('close', () => {
      state.modalBusy = false;
      dom.modalError.textContent = '';
    });
    dom.meetingDate.addEventListener('input', () => {
      dom.modalError.textContent = '';
    });
    dom.meetingLabel.addEventListener('input', () => {
      dom.modalError.textContent = '';
    });

    document.addEventListener('keydown', (event) => {
      const key = String(event.key || '').toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === 's') {
        if (state.view === 'meeting' && state.data && !dom.meetingModal.open) {
          event.preventDefault();
          saveAttendance();
        }
      }
    });

    window.addEventListener('beforeunload', (event) => {
      if (state.dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    });

    window.addEventListener('pageshow', (event) => {
      if (!event.persisted) return;
      clearExpiryTimer();
      wipeSensitive();
      showBoot();
      bootstrap();
    });
  }

  /* ------------------------------------------------------------------ */
  /* Network                                                             */
  /* ------------------------------------------------------------------ */

  function requestSignal() {
    if (
      typeof AbortSignal !== 'undefined' &&
      typeof AbortSignal.timeout === 'function'
    ) {
      return AbortSignal.timeout(15000);
    }
    const controller = new AbortController();
    window.setTimeout(() => controller.abort(), 15000);
    return controller.signal;
  }

  async function apiGet() {
    try {
      const response = await fetch(API, {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: requestSignal(),
      });
      let payload = null;
      try {
        payload = await response.json();
      } catch (_) {
        payload = null;
      }
      return {
        status: response.status,
        ok: response.ok && Boolean(payload) && payload.ok === true,
        payload,
      };
    } catch (_) {
      return { status: 0, ok: false, payload: null };
    }
  }

  async function apiPost(body, options = {}) {
    const includeCsrf = options.csrf !== false;
    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    if (includeCsrf && state.csrf) {
      headers['X-CSRF-Token'] = state.csrf;
    }

    try {
      const response = await fetch(API, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers,
        body: JSON.stringify(body),
        signal: requestSignal(),
      });
      let payload = null;
      try {
        payload = await response.json();
      } catch (_) {
        payload = null;
      }
      return {
        status: response.status,
        ok: response.ok && Boolean(payload) && payload.ok === true,
        payload,
      };
    } catch (_) {
      return { status: 0, ok: false, payload: null };
    }
  }

  async function authenticatedPost(body) {
    const result = await apiPost(body);
    if (result.status === 401) {
      handleUnauthorized();
    }
    return result;
  }

  async function bootstrap() {
    showBoot();
    const result = await apiGet();

    if (result.ok) {
      try {
        applyPayload(result.payload);
        showConsole();
      } catch (_) {
        showLogin('Console response was invalid.');
      }
      return;
    }

    if (result.status === 401) {
      showLogin('');
      return;
    }

    if (result.status === 0) {
      showLogin('Unable to reach the console.');
      return;
    }

    showLogin(
      (result.payload && result.payload.message) ||
        'Console is temporarily unavailable.'
    );
  }

  /* ------------------------------------------------------------------ */
  /* Session / view state                                                */
  /* ------------------------------------------------------------------ */

  function applyPayload(payload) {
    if (
      !payload ||
      payload.ok !== true ||
      !payload.data ||
      !Array.isArray(payload.roster)
    ) {
      throw new Error('Invalid console payload');
    }

    const data = payload.data;
    const revision = Number(data.revision);

    state.data = {
      revision: Number.isSafeInteger(revision) && revision >= 0 ? revision : 0,
      updatedAt:
        typeof data.updatedAt === 'string' ? data.updatedAt : null,
      meetings: Array.isArray(data.meetings) ? data.meetings : [],
      records:
        data.records && typeof data.records === 'object'
          ? data.records
          : {},
    };

    state.roster = payload.roster
      .filter(
        (entry) =>
          entry &&
          typeof entry.username === 'string' &&
          entry.username.length > 0 &&
          entry.username.length <= 64
      )
      .map((entry) => ({
        username: entry.username,
        name: typeof entry.name === 'string' ? entry.name : '',
      }));

    if (
      typeof payload.csrf === 'string' &&
      payload.csrf.length >= 20
    ) {
      state.csrf = payload.csrf;
    }

    const expiresAt = Number(payload.expiresAt);
    state.expiresAt = Number.isFinite(expiresAt) ? expiresAt : null;

    if (state.selectedId && !getMeeting(state.selectedId)) {
      state.selectedId = null;
      state.view = 'overview';
    }

    if (state.view === 'meeting' && state.selectedId) {
      loadDraft();
    } else {
      state.selectedId = null;
      state.view = 'overview';
      state.draft.clear();
    }

    state.dirty = false;
    state.saving = false;
    state.modalBusy = false;

    updateSessionExpiry();
    scheduleExpiry();
    renderAll();
  }

  function showBoot() {
    document.title = 'Restricted Console';
    if (dom.bootView) dom.bootView.hidden = false;
    dom.loginView.hidden = true;
    dom.consoleView.hidden = true;
  }

  function showLogin(message) {
    clearExpiryTimer();
    wipeSensitive();

    if (dom.bootView) dom.bootView.hidden = true;
    dom.consoleView.hidden = true;
    dom.loginView.hidden = false;
    document.title = 'Restricted Console';
    dom.loginError.textContent = message || '';
    dom.adminPassword.value = '';
    dom.adminPassword.type = 'password';
    dom.adminPassword.disabled = false;
    dom.togglePassword.textContent = 'SHOW';
    dom.togglePassword.setAttribute('aria-pressed', 'false');
    dom.togglePassword.disabled = false;
    setLoginBusy(false);
    state.loggingIn = false;

    window.setTimeout(() => {
      try {
        dom.adminPassword.focus({ preventScroll: true });
      } catch (_) {
        dom.adminPassword.focus();
      }
    }, 60);
  }

  function showConsole() {
    if (dom.bootView) dom.bootView.hidden = true;
    dom.loginView.hidden = true;
    dom.consoleView.hidden = false;
    document.title = 'Attendance Control \u2014 CyLab';
  }

  function wipeSensitive() {
    clearTimeout(toastTimer);
    clearExpiryTimer();

    state.csrf = '';
    state.expiresAt = null;
    state.data = null;
    state.roster = [];
    state.selectedId = null;
    state.view = 'overview';
    state.draft.clear();
    state.dirty = false;
    state.saving = false;
    state.loggingIn = false;
    state.modalBusy = false;
    state.modalMeetingId = null;
    state.markSearch = '';
    state.overviewSearch = '';

    dom.meetingList.replaceChildren();
    dom.overviewBody.replaceChildren();
    dom.markBody.replaceChildren();
    dom.overviewCount.textContent = '';
    dom.markCount.textContent = '';
    dom.overviewSub.textContent = '\u2014';
    dom.meetingTitle.textContent = '\u2014';
    dom.meetingMeta.textContent = '\u2014';
    dom.saveNote.textContent = '';
    dom.saveNote.classList.remove('dirty');
    dom.saveBtn.disabled = true;
    dom.saveBtn.textContent = 'DONE / SAVE';
    dom.saveBtnBottom.disabled = true;
    dom.saveBtnBottom.textContent = 'DONE / SAVE';
    dom.markFooterCount.textContent = '';
    dom.markFooterNote.textContent = '';
    dom.sessionExpiry.textContent = 'SESSION \u2014';
    dom.overviewPanel.hidden = true;
    dom.meetingPanel.hidden = true;
    dom.overviewContent.hidden = true;
    dom.overviewEmpty.hidden = true;
    dom.overviewSearch.value = '';
    dom.markSearch.value = '';
    dom.statMeetings.textContent = '0';
    dom.statOperators.textContent = '0';
    dom.statRate.textContent = '0%';
    dom.statPerfect.textContent = '0';
    dom.toast.hidden = true;
    dom.toast.textContent = '';
    dom.modalError.textContent = '';

    if (dom.meetingModal.open) {
      dom.meetingModal.close();
    }
  }

  function handleUnauthorized() {
    if (!dom.loginView.hidden) return;
    showLogin('Session expired. Authenticate again.');
  }

  function setLoginBusy(busy) {
    dom.loginSubmit.disabled = busy;
    dom.loginSubmit.textContent = busy
      ? 'AUTHENTICATING\u2026'
      : 'AUTHENTICATE';
    dom.adminPassword.disabled = busy;
    dom.togglePassword.disabled = busy;
  }

  function updateSessionExpiry() {
    if (!state.expiresAt) {
      dom.sessionExpiry.textContent = 'SESSION \u2014';
      return;
    }
    const date = new Date(state.expiresAt);
    if (Number.isNaN(date.getTime())) {
      dom.sessionExpiry.textContent = 'SESSION \u2014';
      return;
    }
    const time = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
    dom.sessionExpiry.textContent = `SESSION ENDS ${time}`;
  }

  function scheduleExpiry() {
    clearExpiryTimer();
    if (!state.expiresAt) return;

    const remaining = state.expiresAt - Date.now();
    if (remaining <= 0) {
      handleUnauthorized();
      return;
    }

    expiryTimer = window.setTimeout(() => {
      if (!state.expiresAt) return;
      if (Date.now() >= state.expiresAt) {
        handleUnauthorized();
      } else {
        scheduleExpiry();
      }
    }, Math.min(remaining + 250, 2147483647));
  }

  function clearExpiryTimer() {
    if (expiryTimer) {
      clearTimeout(expiryTimer);
      expiryTimer = 0;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Rendering                                                           */
  /* ------------------------------------------------------------------ */

  function renderAll() {
    if (!state.data) return;
    renderMeetingList();

    if (state.view === 'meeting' && state.selectedId && getMeeting(state.selectedId)) {
      renderMeeting();
    } else {
      state.view = 'overview';
      state.selectedId = null;
      renderOverview();
    }

    dom.overviewBtn.classList.toggle('active', state.view === 'overview');
  }

  function renderMeetingList() {
    dom.meetingList.replaceChildren();

    if (state.data.meetings.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'att-side-empty';
      empty.textContent = 'NO DATES RECORDED';
      dom.meetingList.append(empty);
      return;
    }

    const fragment = document.createDocumentFragment();

    for (const meeting of state.data.meetings) {
      const stats = meetingStats(meeting.id);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'att-meeting-item';
      if (state.view === 'meeting' && state.selectedId === meeting.id) {
        button.classList.add('active');
      }
      button.title = `${formatDateFull(meeting.date)} \u2014 ${meeting.label}`;

      const top = document.createElement('span');
      top.className = 'att-mi-top';

      const date = document.createElement('span');
      date.className = 'att-mi-date';
      date.textContent = formatDateShort(meeting.date);

      const present = document.createElement('span');
      present.className = 'att-mi-p';
      present.textContent = `${stats.p}P`;

      top.append(date, present);

      const label = document.createElement('span');
      label.className = 'att-mi-label';
      label.textContent = meeting.label;

      const sub = document.createElement('span');
      sub.className = 'att-mi-sub';
      sub.textContent = `${stats.r} R \u00b7 ${stats.a} A`;

      button.append(top, label, sub);
      button.addEventListener('click', () => selectMeeting(meeting.id));
      fragment.append(button);
    }

    dom.meetingList.append(fragment);
  }

  function renderOverview() {
    if (!state.data) return;
    dom.overviewPanel.hidden = false;
    dom.meetingPanel.hidden = true;
    dom.overviewBtn.classList.add('active');

    const hasMeetings = state.data.meetings.length > 0;
    dom.overviewEmpty.hidden = hasMeetings;
    dom.overviewContent.hidden = !hasMeetings;

    if (!hasMeetings) {
      dom.overviewSub.textContent = 'NO ATTENDANCE DATA RECORDED';
      return;
    }

    const summary = buildSummary();
    const totalPresent = summary.reduce((sum, person) => sum + person.p, 0);
    const possible = summary.length * state.data.meetings.length;
    const average = possible
      ? Math.round((totalPresent / possible) * 100)
      : 0;
    const perfect = summary.filter(
      (person) => person.total > 0 && person.p === person.total
    ).length;

    dom.statMeetings.textContent = String(state.data.meetings.length);
    dom.statOperators.textContent = String(state.roster.length);
    dom.statRate.textContent = `${average}%`;
    dom.statPerfect.textContent = String(perfect);

    dom.overviewSub.textContent = [
      `${state.roster.length} operators`,
      `${state.data.meetings.length} meeting${
        state.data.meetings.length === 1 ? '' : 's'
      }`,
      state.data.updatedAt
        ? `updated ${formatDateTime(state.data.updatedAt)}`
        : null,
    ]
      .filter(Boolean)
      .join(' \u00b7 ');

    renderOverviewRows(summary);
  }

  function renderOverviewRows(summaryInput) {
    if (!state.data) return;

    const summary = summaryInput || buildSummary();
    const query = normalizeQuery(state.overviewSearch);
    const filtered = summary.filter((person) => matchesPerson(person, query));

    dom.overviewCount.textContent = `${filtered.length} / ${summary.length} OPERATORS`;
    dom.overviewBody.replaceChildren();

    const fragment = document.createDocumentFragment();

    if (filtered.length === 0) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 6;
      cell.className = 'att-table-empty';
      cell.textContent = query
        ? 'NO OPERATOR MATCHES THAT SEARCH'
        : 'NO OPERATORS IN ROSTER';
      row.append(cell);
      fragment.append(row);
      dom.overviewBody.append(fragment);
      return;
    }

    for (const person of filtered) {
      const row = document.createElement('tr');

      const operator = document.createElement('td');
      operator.className = 'att-operator';
      operator.textContent = person.username;

      const name = document.createElement('td');
      name.className = 'att-realname';
      name.textContent = person.name || '\u2014';

      const present = document.createElement('td');
      present.className = 'att-num att-p att-center';
      present.textContent = String(person.p);

      const reserved = document.createElement('td');
      reserved.className = 'att-num att-r att-center';
      reserved.textContent = String(person.r);

      const absent = document.createElement('td');
      absent.className = 'att-num att-a att-center';
      absent.textContent = String(person.a);

      const attended = document.createElement('td');
      attended.className = 'att-attended-cell';

      const fraction = document.createElement('span');
      fraction.className = 'att-fraction';
      fraction.append(document.createTextNode(String(person.p)));
      const total = document.createElement('span');
      total.textContent = ` / ${person.total}`;
      fraction.append(total);

      const rateBar = document.createElement('span');
      rateBar.className = 'att-rate-bar';

      const track = document.createElement('span');
      track.className = 'att-rate-track';
      const fill = document.createElement('span');
      fill.className = 'att-rate-fill';
      fill.style.width = `${person.rate}%`;
      track.append(fill);

      const percent = document.createElement('span');
      percent.className = 'att-rate-pct';
      percent.textContent = `${person.rate}%`;

      rateBar.append(track, percent);
      attended.append(fraction, rateBar);

      row.append(operator, name, present, reserved, absent, attended);
      fragment.append(row);
    }

    dom.overviewBody.append(fragment);
  }

  function renderMeeting() {
    const meeting = getMeeting(state.selectedId);
    if (!meeting) {
      state.view = 'overview';
      state.selectedId = null;
      renderOverview();
      return;
    }

    dom.overviewPanel.hidden = true;
    dom.meetingPanel.hidden = false;

    dom.meetingTitle.textContent = formatDateFull(meeting.date);
    renderMarkTable();
    updateMeetingLiveStats();
  }

  function renderMarkTable() {
    if (!state.data || !state.selectedId) return;

    const summary = buildSummary();
    const summaryByUser = new Map(
      summary.map((person) => [person.username, person])
    );
    const query = normalizeQuery(state.markSearch);
    const filtered = state.roster.filter((person) =>
      matchesPerson(person, query)
    );

    dom.markCount.textContent = `${filtered.length} / ${state.roster.length} OPERATORS`;
    dom.markBody.replaceChildren();

    const fragment = document.createDocumentFragment();

    if (filtered.length === 0) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 2;
      cell.className = 'att-table-empty';
      cell.textContent = 'NO OPERATOR MATCHES THAT SEARCH';
      row.append(cell);
      fragment.append(row);
      dom.markBody.append(fragment);
      updateMeetingLiveStats();
      return;
    }

    for (const person of filtered) {
      const status = state.draft.get(person.username) || 'A';
      const stats = summaryByUser.get(person.username) || {
        p: 0,
        total: state.data.meetings.length,
        rate: 0,
      };

      const row = document.createElement('tr');
      row.className = `att-status-${status}`;
      row.dataset.username = person.username;

      const operatorCell = document.createElement('td');
      operatorCell.className = 'att-operator-cell';

      const operator = document.createElement('span');
      operator.className = 'att-operator';
      operator.textContent = person.username;

      const name = document.createElement('span');
      name.className = 'att-realname';
      name.textContent = person.name || '\u2014';

      const history = document.createElement('span');
      history.className = 'att-mark-history';
      history.textContent = `${stats.p} / ${stats.total} meets \u00b7 ${stats.rate}% attended`;

      operatorCell.append(operator, name, history);

      const statusCell = document.createElement('td');
      statusCell.className = 'att-status-cell';
      const group = document.createElement('div');
      group.className = 'att-status-group';

      for (const value of STATUS_VALUES) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'att-status-btn';
        button.dataset.status = value;
        button.textContent = value;
        button.classList.toggle('active', value === status);
        button.setAttribute(
          'aria-pressed',
          value === status ? 'true' : 'false'
        );
        button.setAttribute(
          'aria-label',
          `${
            value === 'P' ? 'Present' : value === 'R' ? 'R' : 'Absent'
          } for ${person.username}`
        );
        group.append(button);
      }

      statusCell.append(group);
      row.append(operatorCell, statusCell);
      fragment.append(row);
    }

    dom.markBody.append(fragment);
    updateMeetingLiveStats();
  }

  function updateMeetingLiveStats() {
    const meeting = getMeeting(state.selectedId);
    if (!meeting) return;

    let present = 0;
    let reserved = 0;
    for (const status of state.draft.values()) {
      if (status === 'P') present += 1;
      else if (status === 'R') reserved += 1;
    }
    const absent = Math.max(0, state.roster.length - present - reserved);

    dom.meetingMeta.textContent = [
      meeting.label,
      `${present} P`,
      `${reserved} R`,
      `${absent} A`,
      `${state.roster.length} operators`,
    ].join(' \u00b7 ');

    if (state.dirty) {
      dom.saveNote.textContent =
        'UNSAVED CHANGES \u2014 PRESS DONE / SAVE TO COMMIT';
    } else {
      dom.saveNote.textContent = meeting.updatedAt
        ? `LAST UPDATED ${formatDateTime(meeting.updatedAt)}`
        : 'NOT SAVED YET';
    }
    dom.saveNote.classList.toggle('dirty', state.dirty);
    dom.markFooterCount.textContent = `${present} P \u00b7 ${reserved} R \u00b7 ${absent} A`;
    dom.markFooterNote.textContent = state.dirty ? 'UNSAVED' : 'SAVED';
    updateSaveButton();
  }

  function updateSaveButton() {
    const disabled = !state.dirty || state.saving;
    const label = state.saving ? 'SAVING\u2026' : 'DONE / SAVE';
    dom.saveBtn.disabled = disabled;
    dom.saveBtn.textContent = label;
    dom.saveBtnBottom.disabled = disabled;
    dom.saveBtnBottom.textContent = label;
  }

  /* ------------------------------------------------------------------ */
  /* Navigation                                                          */
  /* ------------------------------------------------------------------ */

  function selectMeeting(id, options = {}) {
    const meeting = getMeeting(id);
    if (!meeting) return;

    if (
      !options.force &&
      state.view === 'meeting' &&
      state.selectedId === id
    ) {
      return;
    }

    if (
      !options.force &&
      state.dirty &&
      !confirmDiscard(
        'Discard unsaved attendance changes and switch meetings?'
      )
    ) {
      return;
    }

    state.selectedId = id;
    state.view = 'meeting';
    state.markSearch = '';
    dom.markSearch.value = '';
    loadDraft();
    state.dirty = false;
    state.saving = false;
    renderAll();
  }

  function showOverview() {
    if (state.view === 'overview') return;

    if (
      state.dirty &&
      !confirmDiscard(
        'Discard unsaved attendance changes and open the overview?'
      )
    ) {
      return;
    }

    state.view = 'overview';
    state.selectedId = null;
    state.draft.clear();
    state.dirty = false;
    state.saving = false;
    state.markSearch = '';
    dom.markSearch.value = '';
    renderAll();
  }

  function loadDraft() {
    state.draft.clear();
    if (!state.data || !state.selectedId) return;

    const record = state.data.records[state.selectedId] || {};
    for (const [username, status] of Object.entries(record)) {
      if (status === 'P' || status === 'R') {
        state.draft.set(username, status);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Marking                                                             */
  /* ------------------------------------------------------------------ */

  function setStatus(username, status, row) {
    if (!username || !STATUS_VALUES.includes(status)) return;

    const current = state.draft.get(username) || 'A';
    if (current === status) return;

    if (status === 'A') state.draft.delete(username);
    else state.draft.set(username, status);

    state.dirty = true;
    paintRowStatus(row, status);
    updateMeetingLiveStats();
  }

  function paintRowStatus(row, status) {
    if (!row) return;
    row.classList.remove('att-status-P', 'att-status-R', 'att-status-A');
    row.classList.add(`att-status-${status}`);

    row.querySelectorAll('.att-status-btn').forEach((button) => {
      const active = button.dataset.status === status;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function applyBulk(status) {
    if (!state.data || !state.selectedId) return;
    if (!STATUS_VALUES.includes(status)) return;

    const rows = Array.from(
      dom.markBody.querySelectorAll('tr[data-username]')
    );
    if (rows.length === 0) {
      toast('No visible operators to mark.', 'info');
      return;
    }

    if (
      rows.length > 1 &&
      !window.confirm(
        `This will ${
          status === 'A' ? 'reset' : 'mark'
        } all ${rows.length} visible operators as ${status}. You can still change individuals afterward. Continue?`
      )
    ) {
      return;
    }

    let changed = false;
    for (const row of rows) {
      const username = row.dataset.username;
      const current = state.draft.get(username) || 'A';
      if (current === status) continue;

      if (status === 'A') state.draft.delete(username);
      else state.draft.set(username, status);

      paintRowStatus(row, status);
      changed = true;
    }

    if (changed) {
      state.dirty = true;
      updateMeetingLiveStats();
      toast(
        status === 'A'
          ? 'Visible operators reset to absent.'
          : `Visible operators marked ${status}.`,
        'info'
      );
    }
  }

  async function saveAttendance() {
    if (
      !state.data ||
      !state.selectedId ||
      !state.dirty ||
      state.saving ||
      dom.meetingModal.open
    ) {
      return;
    }

    state.saving = true;
    updateSaveButton();

    try {
      const marks = {};
      for (const [username, status] of state.draft.entries()) {
        marks[username] = status;
      }

      const result = await authenticatedPost({
        action: 'save-attendance',
        meetingId: state.selectedId,
        expectedRevision: state.data.revision,
        marks,
      });

      if (result.status === 401) return;

      if (result.status === 409) {
        await refreshData(
          'Data changed elsewhere. Reloaded. Your last change was not saved.'
        );
        return;
      }

      if (!result.ok) {
        toast(
          (result.payload && result.payload.message) ||
            'Could not save attendance.',
          'error'
        );
        return;
      }

      applyPayload(result.payload);
      toast('Attendance saved.', 'success');
    } catch (_) {
      toast('Could not save attendance. Nothing was saved.', 'error');
    } finally {
      state.saving = false;
      updateSaveButton();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Meeting dates                                                       */
  /* ------------------------------------------------------------------ */

  function openMeetingModal(mode) {
    if (!state.data || dom.meetingModal.open) return;

    const isEdit = mode === 'edit';
    if (isEdit && !state.selectedId) return;

    if (
      state.dirty &&
      !confirmDiscard(
        isEdit
          ? 'Discard unsaved attendance changes and edit this date?'
          : 'Discard unsaved attendance changes and add a new date?'
      )
    ) {
      return;
    }

    state.modalMode = isEdit ? 'edit' : 'add';
    state.modalMeetingId = isEdit ? state.selectedId : null;
    dom.modalError.textContent = '';

    if (isEdit) {
      const meeting = getMeeting(state.modalMeetingId);
      if (!meeting) return;
      dom.modalKicker.textContent = 'EDIT DATE';
      dom.modalTitle.textContent = 'Edit meeting date';
      dom.modalSubmit.textContent = 'SAVE CHANGES';
      dom.meetingDateHint.textContent =
        'Change the date or label, then save.';
      dom.meetingDate.value = meeting.date;
      dom.meetingLabel.value = meeting.label;
    } else {
      dom.modalKicker.textContent = 'NEW DATE';
      dom.modalTitle.textContent = 'Add a meeting date';
      dom.modalSubmit.textContent = 'ADD DATE';
      dom.meetingDateHint.textContent =
        'Choose the date of the meeting. Nothing is pre-filled.';
      dom.meetingDate.value = '';
      dom.meetingLabel.value = '';
    }

    setModalBusy(false);

    if (typeof dom.meetingModal.showModal === 'function') {
      dom.meetingModal.showModal();
    } else {
      dom.meetingModal.setAttribute('open', '');
    }

    window.setTimeout(() => {
      try {
        dom.meetingDate.focus({ preventScroll: true });
      } catch (_) {
        dom.meetingDate.focus();
      }
    }, 40);
  }

  function closeMeetingModal() {
    if (state.modalBusy) return;
    if (dom.meetingModal.open) {
      dom.meetingModal.close();
    } else {
      dom.meetingModal.removeAttribute('open');
    }
  }

  function setModalBusy(busy) {
    state.modalBusy = busy;
    dom.modalSubmit.disabled = busy;
    dom.modalSubmit.textContent = busy
      ? 'SAVING\u2026'
      : state.modalMode === 'edit'
        ? 'SAVE CHANGES'
        : 'ADD DATE';
    dom.modalCancel.disabled = busy;
    dom.modalClose.disabled = busy;
    dom.meetingDate.disabled = busy;
    dom.meetingLabel.disabled = busy;
  }

  async function handleMeetingSubmit(event) {
    event.preventDefault();

    if (!state.data || state.modalBusy) return;

    const date = dom.meetingDate.value;
    const label = dom.meetingLabel.value.trim();

    if (!date) {
      dom.modalError.textContent = 'Choose a meeting date.';
      return;
    }

    const wasAdd = state.modalMode === 'add';
    const body = {
      action: wasAdd ? 'add-meeting' : 'update-meeting',
      date,
      label,
      expectedRevision: state.data.revision,
    };
    if (!wasAdd) body.meetingId = state.modalMeetingId;

    setModalBusy(true);
    dom.modalError.textContent = '';

    const result = await authenticatedPost(body);

    if (result.status === 401) {
      setModalBusy(false);
      closeMeetingModal();
      return;
    }

    if (result.status === 409) {
      setModalBusy(false);
      const code = result.payload && result.payload.error;
      if (code === 'duplicate_date') {
        dom.modalError.textContent =
          (result.payload && result.payload.message) ||
          'A meeting already exists on this date.';
        return;
      }
      closeMeetingModal();
      await refreshData('Data changed elsewhere. Reloaded.');
      return;
    }

    if (!result.ok) {
      setModalBusy(false);
      dom.modalError.textContent =
        (result.payload && result.payload.message) ||
        'Could not save the meeting date.';
      return;
    }

    const meta = (result.payload && result.payload.meta) || {};

    try {
      applyPayload(result.payload);
    } catch (_) {
      setModalBusy(false);
      closeMeetingModal();
      toast('Console response was invalid.', 'error');
      return;
    }

    setModalBusy(false);
    closeMeetingModal();

    if (wasAdd && meta.meetingId) {
      selectMeeting(meta.meetingId, { force: true });
      toast('Meeting date added. Mark who was present.', 'success');
    } else {
      toast('Meeting date updated.', 'success');
    }
  }

  async function deleteMeeting() {
    const meeting = getMeeting(state.selectedId);
    if (!meeting) return;

    const warning = state.dirty
      ? 'Unsaved attendance changes will be lost.\n\n'
      : '';
    const confirmed = window.confirm(
      `${warning}Delete ${formatDateFull(meeting.date)} (${
        meeting.label
      }) and all attendance recorded for it? This cannot be undone.`
    );
    if (!confirmed) return;

    const result = await authenticatedPost({
      action: 'delete-meeting',
      meetingId: meeting.id,
      expectedRevision: state.data.revision,
    });

    if (result.status === 401) return;

    if (result.status === 409) {
      await refreshData('Data changed elsewhere. Reloaded.');
      return;
    }

    if (!result.ok) {
      toast(
        (result.payload && result.payload.message) ||
          'Could not delete the meeting.',
        'error'
      );
      return;
    }

    try {
      applyPayload(result.payload);
    } catch (_) {
      toast('Console response was invalid.', 'error');
      return;
    }

    toast('Meeting and its attendance were deleted.', 'success');
  }

  async function refreshData(message) {
    const result = await apiGet();

    if (result.status === 401) {
      handleUnauthorized();
      return;
    }

    if (!result.ok) {
      toast('Could not reload console data.', 'error');
      return;
    }

    try {
      applyPayload(result.payload);
    } catch (_) {
      toast('Console response was invalid.', 'error');
      return;
    }

    if (message) toast(message, 'info');
  }

  /* ------------------------------------------------------------------ */
  /* Login / lock                                                        */
  /* ------------------------------------------------------------------ */

  async function handleLoginSubmit(event) {
    event.preventDefault();
    if (state.loggingIn) return;

    const password = dom.adminPassword.value;
    if (!password) {
      dom.loginError.textContent = 'Enter the master key.';
      dom.adminPassword.focus();
      return;
    }

    state.loggingIn = true;
    dom.loginError.textContent = '';
    setLoginBusy(true);

    const result = await apiPost(
      { action: 'login', password },
      { csrf: false }
    );

    if (result.status === 0) {
      state.loggingIn = false;
      setLoginBusy(false);
      dom.loginError.textContent = 'Unable to reach the console.';
      return;
    }

    if (result.status === 429) {
      state.loggingIn = false;
      setLoginBusy(false);
      dom.loginError.textContent =
        (result.payload && result.payload.message) ||
        'Too many attempts. Try again later.';
      return;
    }

    if (result.status === 503) {
      state.loggingIn = false;
      setLoginBusy(false);
      dom.loginError.textContent =
        (result.payload && result.payload.message) ||
        'Console is not configured.';
      return;
    }

    if (!result.ok) {
      state.loggingIn = false;
      setLoginBusy(false);
      dom.loginError.textContent =
        result.status === 401
          ? 'Invalid credentials.'
          : 'Authentication failed. Try again.';
      dom.adminPassword.select();
      return;
    }

    try {
      applyPayload(result.payload);
    } catch (_) {
      state.loggingIn = false;
      showLogin('Console response was invalid.');
      return;
    }

    state.loggingIn = false;
    dom.adminPassword.value = '';
    showConsole();
    toast('Authenticated. Session active.', 'success');
  }

  function togglePasswordVisibility() {
    const reveal = dom.adminPassword.type === 'password';
    dom.adminPassword.type = reveal ? 'text' : 'password';
    dom.togglePassword.textContent = reveal ? 'HIDE' : 'SHOW';
    dom.togglePassword.setAttribute('aria-pressed', reveal ? 'true' : 'false');
  }

  async function lockConsole() {
    if (state.saving) {
      toast('Wait for the current save to finish.', 'info');
      return;
    }

    if (
      state.dirty &&
      !window.confirm(
        'Unsaved attendance changes will be lost. Lock the console?'
      )
    ) {
      return;
    }

    let message = 'Console locked.';
    const result = await apiPost({ action: 'logout' });

    if (!result.ok && result.status !== 401) {
      message = 'Locked locally. Server session will expire automatically.';
    }

    showLogin(message);
  }

  /* ------------------------------------------------------------------ */
  /* Helpers                                                             */
  /* ------------------------------------------------------------------ */

  function getMeeting(id) {
    if (!state.data || !id) return null;
    return (
      state.data.meetings.find((meeting) => meeting.id === id) || null
    );
  }

  function buildSummary() {
    const totalMeetings = state.data ? state.data.meetings.length : 0;
    const rows = state.roster.map((person) => ({
      username: person.username,
      name: person.name,
      p: 0,
      r: 0,
      a: totalMeetings,
      total: totalMeetings,
      rate: 0,
    }));
    const byUsername = new Map(
      rows.map((row) => [row.username, row])
    );

    if (state.data) {
      for (const meeting of state.data.meetings) {
        const record = state.data.records[meeting.id];
        if (!record) continue;
        for (const [username, status] of Object.entries(record)) {
          const row = byUsername.get(username);
          if (!row) continue;
          if (status === 'P') row.p += 1;
          else if (status === 'R') row.r += 1;
        }
      }
    }

    for (const row of rows) {
      row.a = Math.max(0, totalMeetings - row.p - row.r);
      row.rate = totalMeetings
        ? Math.round((row.p / totalMeetings) * 100)
        : 0;
    }

    return rows;
  }

  function meetingStats(meetingId) {
    const record =
      (state.data && state.data.records[meetingId]) || {};
    const known = new Set(state.roster.map((person) => person.username));
    let present = 0;
    let reserved = 0;

    for (const [username, status] of Object.entries(record)) {
      if (!known.has(username)) continue;
      if (status === 'P') present += 1;
      else if (status === 'R') reserved += 1;
    }

    return {
      p: present,
      r: reserved,
      a: Math.max(0, state.roster.length - present - reserved),
    };
  }

  function normalizeQuery(value) {
    return String(value || '').trim().toLowerCase();
  }

  function matchesPerson(person, query) {
    if (!query) return true;
    const username = person.username.toLowerCase();
    const name = String(person.name || '').toLowerCase();
    const tokens = query.split(/\s+/).filter(Boolean);
    return tokens.every(
      (token) => username.includes(token) || name.includes(token)
    );
  }

  function parseIsoDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return null;
    }
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      return null;
    }
    return date;
  }

  function formatDateFull(value) {
    const date = parseIsoDate(value);
    if (!date) return String(value || '\u2014');
    return new Intl.DateTimeFormat('en-GB', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    })
      .format(date)
      .toUpperCase();
  }

  function formatDateShort(value) {
    const date = parseIsoDate(value);
    if (!date) return String(value || '\u2014');
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      timeZone: 'UTC',
    })
      .format(date)
      .toUpperCase();
  }

  function formatDateTime(value) {
    if (!value) return 'NEVER';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'UNKNOWN';
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
      .format(date)
      .toUpperCase();
  }

  function todayISO() {
    const now = new Date();
    const local = new Date(
      now.getTime() - now.getTimezoneOffset() * 60000
    );
    return local.toISOString().slice(0, 10);
  }

  function confirmDiscard(message) {
    return !state.dirty || window.confirm(message);
  }

  function toast(message, kind = 'info') {
    clearTimeout(toastTimer);
    dom.toast.textContent = String(message);
    dom.toast.className =
      'att-toast' +
      (kind === 'error'
        ? ' att-toast-error'
        : kind === 'info'
          ? ' att-toast-info'
          : '');
    dom.toast.hidden = false;
    toastTimer = window.setTimeout(() => {
      dom.toast.hidden = true;
    }, 4200);
  }

  function exportCsv() {
    if (!state.data || state.data.meetings.length === 0) {
      toast('No attendance data to export.', 'info');
      return;
    }

    const summary = buildSummary();
    const rows = [
      [
        'Username',
        'Name',
        'Present',
        'R',
        'Absent',
        'Total Meets',
        'Attendance %',
      ],
      ...summary.map((person) => [
        person.username,
        person.name,
        person.p,
        person.r,
        person.a,
        person.total,
        person.rate,
      ]),
    ];

    const csv = rows
      .map((row) => row.map(csvCell).join(','))
      .join('\r\n');
    const blob = new Blob([`\uFEFF${csv}`], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `cylabs-report-${todayISO()}.csv`;
    anchor.rel = 'noopener';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('CSV report exported.', 'success');
  }

  function csvCell(value) {
    let text = value === null || value === undefined ? '' : String(value);
    // Neutralize spreadsheet formula injection when the report is opened
    // in Excel / Sheets. Roster names are user-controlled data.
    if (/^[=+\-@\t\r]/.test(text)) {
      text = `'${text}`;
    }
    if (/[",\r\n]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  }
})();
