/* 운동 레포트 · Firebase 연결부
 * - 데이터(기구/동작/세션/런닝/웨이트)는 Firestore를 직접 읽고 씀 → 빠름
 * - 사진만 Apps Script 중계로 구글 드라이브에 저장 (URL만 Firestore에 보관)
 * - 화면(app.js)은 FB.call('기능', ...) 또는 FB.xxx 로 사용
 */
(function () {
  const VERSION = 'WF1.4';   // 배포할 때마다 숫자 올리기 (화면 하단·메뉴·로그인에 표시 → 업로드 반영 확인용)
  const WORKOUTS = ['가슴', '등', '어깨', '하체'];
  const BODY_PARTS = ['가슴', '어깨', '등', '팔', '하체'];
  // 상체/하체 분류: 하체만 하체, 나머지는 상체
  const partGroup = (part) => (String(part) === '하체' ? '하체' : '상체');

  const ready = !!(window.firebase && window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.projectId);
  if (!ready) { window.FB = { ok: false, version: VERSION }; return; }

  firebase.initializeApp(window.FIREBASE_CONFIG);
  const auth = firebase.auth();
  const db = firebase.firestore();
  let USER = null;   // { uid, email, name }

  const USERS = window.ALLOWED_USERS || {};
  const lower = (v) => String(v || '').trim().toLowerCase();
  const nameOf = (email) => USERS[lower(email)] || '';
  const now = () => new Date().toISOString();
  const tidy = (v, n) => String(v == null ? '' : v).trim().slice(0, n || 500);
  const num = (v) => { const s = String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''); return s === '' ? '' : Number(s); };
  const fail = (m) => { throw new Error(m); };

  /* ---------- 로그인 ---------- */
  const authReady = new Promise((res) => {
    auth.onAuthStateChanged((u) => {
      if (u && nameOf(u.email)) USER = { uid: u.uid, email: lower(u.email), name: nameOf(u.email) };
      else USER = null;
      res(USER);
      if (window.onAuthChanged) window.onAuthChanged(USER, u);
    });
  });

  async function signIn() {
    const p = new firebase.auth.GoogleAuthProvider();
    p.setCustomParameters({ prompt: 'select_account' });
    try { await auth.signInWithPopup(p); }
    catch (e) {
      if (['auth/popup-blocked', 'auth/cancelled-popup-request', 'auth/operation-not-supported-in-this-environment'].includes(e.code)) {
        await auth.signInWithRedirect(p); return;
      }
      throw e;
    }
  }
  const signOut = () => auth.signOut();

  function requireUser() { if (!USER) fail('로그인이 필요합니다.'); return USER; }

  /* ---------- 사진 중계 (Apps Script) ---------- */
  async function uploadPhoto(kind, photo) {
    const u = requireUser();
    const url = String((window.APP_CONFIG || {}).APPS_SCRIPT_URL || '').trim();
    if (!url) fail('사진 저장 서버(Apps Script) 주소가 config.js에 없습니다.');
    const idToken = await auth.currentUser.getIdToken();
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ op: 'photo', idToken, kind, who: u.name, photo }),
    });
    const o = await r.json().catch(() => null);
    if (!o || !o.ok) fail((o && o.error) || '사진 저장 실패');
    return o;   // { url, thumb }
  }

  /* ---------- Firestore 공통 ---------- */
  const col = (name) => db.collection(name);
  const docsOf = (snap) => snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));

  /* ---------- 기구 + 동작 ---------- */
  async function listGear() {
    requireUser();
    const [eqs, mvs] = await Promise.all([
      col('equipment').orderBy('createdAt').get().then(docsOf),
      col('moves').orderBy('createdAt').get().then(docsOf),
    ]);
    return eqs.map((e) => ({
      id: e.id, name: e.name, part: e.part, thumb: e.photoThumb || '', owner: e.owner,
      moves: mvs.filter((m) => m.equipId === e.id).map((m) => ({ id: m.id, name: m.name, desc: m.desc, thumb: m.photoThumb || '' })),
    }));
  }
  async function addEquipment(d) {
    const u = requireUser(); d = d || {};
    const name = tidy(d.name, 60); if (!name) fail('기구 이름을 입력해 주세요.');
    const part = BODY_PARTS.indexOf(tidy(d.part)) >= 0 ? d.part : '가슴';
    let photo = { url: '', thumb: '' };
    if (d.photo) photo = await uploadPhoto('기구', d.photo);
    const ref = await col('equipment').add({ name, part, photoUrl: photo.url || '', photoThumb: photo.thumb || '', owner: u.name, uid: u.uid, createdAt: now() });
    if (Array.isArray(d.moves)) for (const m of d.moves) await addMove_(ref.id, m);
    return { ok: true, id: ref.id, gear: await listGear() };
  }
  async function addMove(equipId, m) {
    requireUser();
    await addMove_(tidy(equipId, 40), m || {});
    return { ok: true, gear: await listGear() };
  }
  async function addMove_(equipId, m) {
    const u = USER;
    const name = tidy(m.name, 60); if (!name) fail('동작 이름을 입력해 주세요.');
    let photo = { url: '', thumb: '' };
    if (m.photo) photo = await uploadPhoto('기구', m.photo);
    await col('moves').add({ equipId, name, desc: tidy(m.desc, 300), photoUrl: photo.url || '', photoThumb: photo.thumb || '', owner: u.name, uid: u.uid, createdAt: now() });
  }

  /* ---------- 세션 + 항목별 저장 ---------- */
  async function startSession(d) {
    const u = requireUser(); d = d || {};
    const date = tidy(d.date, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('날짜를 올바르게 선택해 주세요.');
    const workout = WORKOUTS.indexOf(tidy(d.workout)) >= 0 ? d.workout : '';
    // 같은 날·같은 사람 세션이 있으면 재사용
    const ex = await col('sessions').where('uid', '==', u.uid).where('date', '==', date).limit(1).get();
    if (!ex.empty) {
      const ref = ex.docs[0];
      if (workout) await ref.ref.update({ workout });
      return { ok: true, id: ref.id, date, workout: workout || ref.data().workout };
    }
    const ref = await col('sessions').add({ date, who: u.name, uid: u.uid, workout, finishPhoto: '', finishThumb: '', createdAt: now() });
    return { ok: true, id: ref.id, date, workout };
  }
  async function mySession_(sid) {
    const d = await col('sessions').doc(sid).get();
    if (!d.exists || d.data().uid !== USER.uid) fail('세션을 찾을 수 없습니다.');
    return Object.assign({ id: d.id }, d.data());
  }
  async function addRunning(sid, r) {
    const u = requireUser(); const s = await mySession_(tidy(sid, 40)); r = r || {};
    let photo = { url: '' };
    if (r.photo) photo = await uploadPhoto('런닝머신', r.photo);
    await col('running').add({ sessionId: s.id, date: s.date, who: u.name, uid: u.uid,
      min: num(r.min), km: num(r.km), incline: num(r.incline), speed: num(r.speed), kcal: num(r.kcal),
      photo: photo.url || '', createdAt: now() });
    return { ok: true };
  }
  async function addWeight(sid, w) {
    const u = requireUser(); const s = await mySession_(tidy(sid, 40)); w = w || {};
    const equip = tidy(w.equipName, 60); if (!equip) fail('기구를 선택해 주세요.');
    const sets = (Array.isArray(w.sets) ? w.sets : []).filter((x) => String(x.weight || '').trim() !== '' || String(x.reps || '').trim() !== '');
    if (!sets.length) fail('무게·횟수를 한 세트 이상 입력해 주세요.');
    const batch = db.batch();
    sets.forEach((x, i) => {
      const ref = col('weights').doc();
      batch.set(ref, { sessionId: s.id, date: s.date, who: u.name, uid: u.uid,
        equip, move: tidy(w.moveName, 60), part: tidy(w.part, 20), setNo: i + 1, weight: num(x.weight), reps: num(x.reps), createdAt: now() });
    });
    await batch.commit();
    return { ok: true, count: sets.length };
  }
  async function addFinishPhoto(sid, photo) {
    const u = requireUser(); const s = await mySession_(tidy(sid, 40));
    if (!photo || !photo.data) fail('사진을 선택해 주세요.');
    const saved = await uploadPhoto('오운완', photo);
    await col('sessions').doc(s.id).update({ finishPhoto: saved.url || '', finishThumb: saved.thumb || '' });
    return { ok: true, thumb: saved.thumb, url: saved.url };
  }

  /* ---------- 일지 조회 ---------- */
  function sessionView(s, runs, wts) {
    const myRun = runs.filter((r) => r.sessionId === s.id);
    const myWt = wts.filter((r) => r.sessionId === s.id);
    const byEquip = {};
    myWt.sort((a, b) => (a.setNo || 0) - (b.setNo || 0)).forEach((r) => {
      const k = r.equip + ' / ' + (r.move || '');
      (byEquip[k] = byEquip[k] || { equip: r.equip, move: r.move || '', part: r.part, sets: [] }).sets.push({ weight: r.weight, reps: r.reps });
    });
    return {
      id: s.id, date: s.date, who: s.who, workout: s.workout || '',
      finishThumb: s.finishThumb || '', finishPhoto: s.finishPhoto || '',
      running: myRun.map((r) => ({ min: r.min, km: r.km, incline: r.incline, speed: r.speed, kcal: r.kcal, photo: r.photo })),
      weights: Object.values(byEquip),
    };
  }
  async function sessionSummary(sid) {
    requireUser();
    const s = await mySession_(tidy(sid, 40));
    const [runs, wts] = await Promise.all([
      col('running').where('sessionId', '==', s.id).get().then(docsOf),
      col('weights').where('sessionId', '==', s.id).get().then(docsOf),
    ]);
    return sessionView(s, runs, wts);
  }
  async function listSessions(who) {
    requireUser();
    const people = Object.values(USERS);
    const filter = people.indexOf(who) >= 0 ? who : '';
    const [ss, runs, wts] = await Promise.all([
      col('sessions').orderBy('date', 'desc').get().then(docsOf),
      col('running').get().then(docsOf),
      col('weights').get().then(docsOf),
    ]);
    return ss.filter((s) => !filter || s.who === filter).map((s) => sessionView(s, runs, wts));
  }

  /* ---------- 홈 피드: 어제 오운완 (없으면 공백 일수 계산) ---------- */
  async function latestFinish() {
    requireUser();
    const people = Object.values(USERS);
    const ss = await col('sessions').orderBy('date', 'desc').limit(60).get().then(docsOf);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const yd = new Date(today); yd.setDate(yd.getDate() - 1);
    const ymdOf = (d) => d.toISOString().slice(0, 10);
    const yesterday = ymdOf(yd);

    return people.map((p) => {
      // 그 사람의 오운완 있는 세션들 (최신순)
      const mine = ss.filter((s) => s.who === p && s.finishThumb);
      const y = mine.find((s) => String(s.date).slice(0, 10) === yesterday);
      if (y) {
        return { who: p, hasPhoto: true, date: y.date, workout: y.workout || '', thumb: y.finishThumb, url: y.finishPhoto || y.finishThumb, daysOff: 0 };
      }
      // 어제 건 없음 → 마지막 오운완이 며칠 전인지
      const last = mine[0];
      let daysOff = 999;
      if (last) {
        const ld = new Date(String(last.date).slice(0, 10) + 'T00:00:00');
        daysOff = Math.round((today - ld) / 86400000);   // 오늘 기준 며칠 전
      }
      return { who: p, hasPhoto: false, date: last ? last.date : '', daysOff, hasAny: !!last };
    });
  }

  /* ---------- 기구 1개의 내 기록 (날짜별 무게×횟수) ---------- */
  async function equipLog(equipName) {
    const u = requireUser();
    const name = tidy(equipName, 60);
    const all = await col('weights').where('equip', '==', name).get().then(docsOf);
    const mine = all.filter((w) => w.who === u.name);
    // 날짜+동작 단위로 묶기
    const byKey = {};
    mine.sort((a, b) => (a.setNo || 0) - (b.setNo || 0)).forEach((w) => {
      const k = w.date + '|' + (w.move || '');
      (byKey[k] = byKey[k] || { date: w.date, move: w.move || '', sets: [] }).sets.push({ weight: w.weight, reps: w.reps });
    });
    return Object.values(byKey).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }

  /* ---------- 특정 날짜의 부부 오운완 (VS 콜라주용) ---------- */
  async function dayFinish(date) {
    requireUser();
    const people = Object.values(USERS);
    const d = String(date || '').slice(0, 10);
    const ss = await col('sessions').where('date', '==', d).get().then(docsOf);
    // 각 사람: 오운완 사진 세션 우선, 없으면 운동만 한 세션, 둘 다 없으면 쉼
    return people.map((p) => {
      const mine = ss.filter((s) => s.who === p);
      const withPhoto = mine.find((s) => s.finishThumb);
      if (withPhoto) return { who: p, state: 'photo', date: d, workout: withPhoto.workout || '', thumb: withPhoto.finishThumb, url: withPhoto.finishPhoto || withPhoto.finishThumb };
      if (mine.length) return { who: p, state: 'nophoto', date: d, workout: (mine[0].workout || '') };  // 운동은 함(사진만 없음)
      return { who: p, state: 'rest', date: d };   // 쉼
    });
  }

  /* ---------- 한 사람의 오운완 전체 목록 (날짜별 보기용) ---------- */
  async function finishHistory(who) {
    requireUser();
    const ss = await col('sessions').orderBy('date', 'desc').get().then(docsOf);
    return ss.filter((s) => s.who === who && s.finishThumb)
      .map((s) => ({ who: s.who, date: s.date, workout: s.workout || '', thumb: s.finishThumb, url: s.finishPhoto || s.finishThumb }));
  }

  /* ---------- 발전 추이용 원자료 ---------- */
  async function trendData() {
    requireUser();
    const [runs, wts] = await Promise.all([
      col('running').get().then(docsOf),
      col('weights').get().then(docsOf),
    ]);
    return { running: runs, weights: wts, people: Object.values(USERS) };
  }

  /* ---------- 화면용 창구 ---------- */
  const API = { listGear, addEquipment, addMove, startSession, addRunning, addWeight, addFinishPhoto, sessionSummary, listSessions, trendData, latestFinish, finishHistory, dayFinish, equipLog };
  async function call(fn) {
    const f = API[fn]; if (!f) fail('없는 기능: ' + fn);
    return f.apply(null, Array.prototype.slice.call(arguments, 1));
  }

  window.FB = {
    ok: true, version: VERSION, workouts: WORKOUTS, parts: BODY_PARTS,
    authReady, signIn, signOut, call,
    me: () => USER,
    people: () => Object.values(USERS),
    partGroup,
  };
})();
