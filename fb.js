/* 운동 레포트 · Firebase 연결부
 * - 데이터(기구/동작/세션/런닝/웨이트)는 Firestore를 직접 읽고 씀 → 빠름
 * - 사진만 Apps Script 중계로 구글 드라이브에 저장 (URL만 Firestore에 보관)
 * - 화면(app.js)은 FB.call('기능', ...) 또는 FB.xxx 로 사용
 */
(function () {
  const VERSION = 'WF4.2';   // 배포할 때마다 숫자 올리기 (화면 하단·메뉴·로그인에 표시 → 업로드 반영 확인용)
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
  let MYW_CACHE = null;   // 내 웨이트 기록 캐시 (지난번 무게 조회용, 저장·수정 시 비움)

  const USERS = window.ALLOWED_USERS || {};   // 이메일 → 기본 이름 (허용 목록)
  const lower = (v) => String(v || '').trim().toLowerCase();
  /* 표시 이름은 Firestore profiles 컬렉션에서 관리 (앱에서 변경 가능)
   * PROFILES = [{ email, name, uid }] — config 순서 유지 */
  let PROFILES = Object.keys(USERS).map((e) => ({ email: lower(e), name: USERS[e], uid: '' }));
  const profileOf = (email) => PROFILES.filter((p) => p.email === lower(email))[0];
  const nameOf = (email) => { const p = profileOf(email); return p ? p.name : ''; };
  const peopleNames = () => PROFILES.map((p) => p.name);
  /* 기록의 지금 표시 이름 (uid로 찾고, 없으면 저장된 이름) */
  const whoName_ = (rec) => { const p = PROFILES.filter((x) => x.uid && x.uid === rec.uid)[0]; return p ? p.name : rec.who; };
  /* 기록이 그 사람 것인가: uid 우선, 없으면 이름으로 */
  const isWho = (rec, name) => {
    const p = PROFILES.filter((x) => x.name === name)[0];
    return !!p && ((p.uid && rec.uid === p.uid) || rec.who === name);
  };
  const now = () => new Date().toISOString();
  // 로컬(기기) 기준 yyyy-MM-dd — toISOString(UTC)은 자정 근처에 하루 밀리므로 사용 금지
  const localYmd = (d) => { const z = (n) => (n < 10 ? '0' : '') + n; return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()); };
  const tidy = (v, n) => String(v == null ? '' : v).trim().slice(0, n || 500);
  const num = (v) => { const s = String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''); return s === '' ? '' : Number(s); };
  const fail = (m) => { throw new Error(m); };

  /* ---------- 로그인 ---------- */
  const authReady = new Promise((res) => {
    auth.onAuthStateChanged(async (u) => {
      USER = null;
      if (u && profileOf(u.email)) {
        USER = { uid: u.uid, email: lower(u.email), name: nameOf(u.email) };
        try { await loadProfiles_(); } catch (e) {}
        USER.name = nameOf(u.email);
      }
      res(USER);
      if (window.onAuthChanged) window.onAuthChanged(USER, u);
    });
  });

  /* profiles 불러오기 + 내 프로필이 없으면 만들고 내 기록 이름을 맞춤(1회) */
  async function loadProfiles_() {
    const snap = await db.collection('profiles').get();
    snap.docs.forEach((d) => {
      const p = profileOf(d.id); const v = d.data() || {};
      if (p) { if (v.name) p.name = v.name; if (v.uid) p.uid = v.uid; }
    });
    const me = profileOf(USER.email);
    const exists = snap.docs.some((d) => d.id === USER.email);
    if (!exists || me.uid !== USER.uid) {
      me.uid = USER.uid;
      await db.collection('profiles').doc(USER.email).set({ name: me.name, uid: USER.uid, updatedAt: now() }, { merge: true });
      if (!exists) await syncMyName_(me.name);   // 예전 이름(주나/남편 등)으로 남은 내 기록을 새 이름으로
    }
  }

  /* 내 기록 전체의 이름(who/owner)을 name으로 맞춤 */
  async function syncMyName_(name) {
    const uid = USER.uid;
    const groups = await Promise.all([
      db.collection('sessions').where('uid', '==', uid).get(),
      db.collection('running').where('uid', '==', uid).get(),
      db.collection('weights').where('uid', '==', uid).get(),
      db.collection('equipment').where('uid', '==', uid).get(),
      db.collection('moves').where('uid', '==', uid).get(),
    ]);
    const docs = [];
    groups.forEach((g, gi) => g.docs.forEach((d) => {
      const field = gi >= 3 ? 'owner' : 'who';
      if (d.data()[field] !== name) docs.push({ ref: d.ref, field });
    }));
    for (let i = 0; i < docs.length; i += 400) {
      const b = db.batch();
      docs.slice(i, i + 400).forEach((x) => b.update(x.ref, { [x.field]: name }));
      await b.commit();
    }
  }

  /* [화면] 내 표시 이름 변경 → 내 기록 전체에 반영 */
  async function renameMe(newName) {
    requireUser();
    const name = String(newName || '').trim().replace(/[\\/:*?"<>|]/g, '').slice(0, 10);
    if (!name) fail('이름을 입력해 주세요.');
    if (PROFILES.some((p) => p.email !== USER.email && p.name === name)) fail('상대방과 같은 이름은 쓸 수 없어요.');
    await db.collection('profiles').doc(USER.email).set({ name, uid: USER.uid, updatedAt: now() }, { merge: true });
    await syncMyName_(name);
    profileOf(USER.email).name = name;
    USER.name = name;
    return { ok: true, name, people: peopleNames() };
  }

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

  /* ---------- 파일 중계 (Apps Script → 구글 드라이브) ---------- */
  async function uploadMedia(kind, media, fname) {
    const u = requireUser();
    const url = String((window.APP_CONFIG || {}).APPS_SCRIPT_URL || '').trim();
    if (!url) fail('저장 서버(Apps Script) 주소가 config.js에 없습니다.');
    const idToken = await auth.currentUser.getIdToken();
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ op: 'photo', idToken, kind, who: u.name, fname: fname || '', photo: media }),
    });
    const o = await r.json().catch(() => null);
    if (!o || !o.ok) fail((o && o.error) || '저장 실패');
    return o;   // { url, thumb }
  }
  const uploadPhoto = (kind, photo, fname) => uploadMedia(kind, photo, fname);   // 기존 호출 호환

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
      moves: mvs.filter((m) => m.equipId === e.id).map((m) => ({ id: m.id, name: m.name, desc: m.desc, link: m.link || '', thumb: m.photoThumb || '' })),
    }));
  }
  async function addEquipment(d) {
    const u = requireUser(); d = d || {};
    const name = tidy(d.name, 60); if (!name) fail('기구 이름을 입력해 주세요.');
    const part = BODY_PARTS.indexOf(tidy(d.part)) >= 0 ? d.part : '가슴';
    let photo = { url: '', thumb: '' };
    if (d.photo) photo = await uploadPhoto('기구', d.photo, '기구_' + name);
    const ref = await col('equipment').add({ name, part, photoUrl: photo.url || '', photoThumb: photo.thumb || '', owner: u.name, uid: u.uid, createdAt: now() });
    if (Array.isArray(d.moves)) for (const m of d.moves) await addMove_(ref.id, m);
    return { ok: true, id: ref.id, gear: await listGear() };
  }
  async function addMove(equipId, m) {
    requireUser();
    await addMove_(tidy(equipId, 40), m || {});
    MYW_CACHE = null;
    return { ok: true, gear: await listGear() };
  }
  async function addMove_(equipId, m) {
    const u = USER;
    const name = tidy(m.name, 60); if (!name) fail('동작 이름을 입력해 주세요.');
    let photo = { url: '', thumb: '' };
    if (m.photo) photo = await uploadPhoto('동작', m.photo, '동작_' + name);
    await col('moves').add({ equipId, name, link: tidy(m.link, 300), desc: tidy(m.desc, 300), photoUrl: photo.url || '', photoThumb: photo.thumb || '', owner: u.name, uid: u.uid, createdAt: now() });
  }

  /* ---------- 기구 삭제 (기구 + 그 동작들 + 사진까지) ---------- */
  async function deleteEquipment(equipId) {
    requireUser();
    const eid = tidy(equipId, 40);
    const eqDoc = await col('equipment').doc(eid).get();
    if (!eqDoc.exists) fail('기구를 찾을 수 없습니다.');
    const moves = await col('moves').where('equipId', '==', eid).get().then((s) => s.docs);
    // 드라이브에서 지울 사진 fileId 모으기 (기구 + 동작)
    const fileIds = [];
    const gid = fileIdOf_(eqDoc.data().photoUrl); if (gid) fileIds.push(gid);
    moves.forEach((mv) => { const id = fileIdOf_(mv.data().photoUrl); if (id) fileIds.push(id); });
    // Firestore 삭제 (기구 + 동작들)
    const batch = db.batch();
    batch.delete(eqDoc.ref);
    moves.forEach((mv) => batch.delete(mv.ref));
    await batch.commit();
    // 드라이브 사진 삭제
    if (fileIds.length) {
      try {
        const url = String((window.APP_CONFIG || {}).APPS_SCRIPT_URL || '').trim();
        const idToken = await auth.currentUser.getIdToken();
        await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ op: 'delete', idToken, fileIds }) });
      } catch (e) {}
    }
    MYW_CACHE = null;
    return { ok: true, gear: await listGear() };
  }

  /* ---------- 기구 수정 (이름·부위·사진) + 과거 기록 이름 일괄변경 ---------- */
  async function updateEquipment(equipId, d) {
    requireUser(); d = d || {};
    const eid = tidy(equipId, 40);
    const ref = col('equipment').doc(eid);
    const cur = await ref.get();
    if (!cur.exists) fail('기구를 찾을 수 없습니다.');
    const oldName = cur.data().name;
    const newName = tidy(d.name, 60); if (!newName) fail('기구 이름을 입력해 주세요.');
    const part = BODY_PARTS.indexOf(tidy(d.part)) >= 0 ? d.part : cur.data().part;
    const patch = { name: newName, part };
    if (d.photo) {
      const saved = await uploadPhoto('기구', d.photo, '기구_' + newName);
      patch.photoUrl = saved.url || ''; patch.photoThumb = saved.thumb || '';
      const oldId = fileIdOf_(cur.data().photoUrl); if (oldId) deleteDrive_([oldId]);
    }
    await ref.update(patch);
    if (oldName !== newName) {
      const wts = await col('weights').where('equip', '==', oldName).get().then((s) => s.docs);
      await commitInChunks_(wts, (b, d2) => b.update(d2.ref, { equip: newName }));
    }
    MYW_CACHE = null;
    return { ok: true, gear: await listGear() };
  }

  /* ---------- 동작 수정 (이름·링크·사진) + 과거 기록 이름 일괄변경 ---------- */
  async function updateMove(moveId, d) {
    requireUser(); d = d || {};
    const mid = tidy(moveId, 40);
    const ref = col('moves').doc(mid);
    const cur = await ref.get();
    if (!cur.exists) fail('동작을 찾을 수 없습니다.');
    const oldName = cur.data().name;
    const newName = tidy(d.name, 60); if (!newName) fail('동작 이름을 입력해 주세요.');
    const patch = { name: newName, link: tidy(d.link, 300) };
    if (d.photo) {
      const saved = await uploadPhoto('동작', d.photo, '동작_' + newName);
      patch.photoUrl = saved.url || ''; patch.photoThumb = saved.thumb || '';
      const oldId = fileIdOf_(cur.data().photoUrl); if (oldId) deleteDrive_([oldId]);
    }
    await ref.update(patch);
    if (oldName !== newName) {
      const wts = await col('weights').where('move', '==', oldName).get().then((s) => s.docs);
      await commitInChunks_(wts, (b, d2) => b.update(d2.ref, { move: newName }));
    }
    MYW_CACHE = null;
    return { ok: true, gear: await listGear() };
  }

  /* batch 500개 제한 → 나눠서 커밋 */
  async function commitInChunks_(docs, apply) {
    for (let i = 0; i < docs.length; i += 400) {
      const b = db.batch();
      docs.slice(i, i + 400).forEach((d) => apply(b, d));
      await b.commit();
    }
  }
  /* 드라이브 사진 삭제 요청 (비동기, 실패 무시) */
  function deleteDrive_(fileIds) {
    try {
      const url = String((window.APP_CONFIG || {}).APPS_SCRIPT_URL || '').trim();
      auth.currentUser.getIdToken().then((idToken) => {
        fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ op: 'delete', idToken, fileIds }) });
      });
    } catch (e) {}
  }

  /* ---------- 세션 + 항목별 저장 ---------- */
  async function startSession(d) {
    const u = requireUser(); d = d || {};
    const date = tidy(d.date, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('날짜를 올바르게 선택해 주세요.');
    const workout = WORKOUTS.indexOf(tidy(d.workout)) >= 0 ? d.workout : '';
    // 같은 날·같은 사람 세션이 있으면 재사용 (색인 불필요: date로만 쿼리 후 uid는 JS 필터)
    const sameDay = await col('sessions').where('date', '==', date).get().then((snap) => snap.docs);
    const mine = sameDay.filter((doc) => doc.data().uid === u.uid)[0];
    if (mine) {
      if (workout) await mine.ref.update({ workout });
      return { ok: true, id: mine.id, date, workout: workout || mine.data().workout };
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
    MYW_CACHE = null;
    return { ok: true, count: sets.length };
  }
  /* 오운완 저장 (사진 또는 영상)
   *  media = { kind:'photo'|'video', data(base64), thumbData(작은 base64 썸네일) }
   *  - thumbData: CORS 없는 캔버스 드로잉용 (대결/피드 카드). Firestore에 바로 저장
   */
  async function addFinish(sid, media) {
    const u = requireUser(); const s = await mySession_(tidy(sid, 40));
    media = media || {};
    if (!media.data) fail('사진을 선택해 주세요.');
    const saved = await uploadMedia('오운완', media, '오운완_' + u.name + '_' + s.date);
    await col('sessions').doc(s.id).update({
      finishPhoto: saved.url || '',
      finishThumb: saved.thumb || '',               // 드라이브 썸네일(폴백)
      finishThumbData: tidy(media.thumbData, 300000), // 작은 base64 (CORS 없음)
      finishType: 'photo',
    });
    return { ok: true, thumb: saved.thumb, url: saved.url, type: 'photo' };
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
      id: s.id, date: s.date, who: whoName_(s), workout: s.workout || '',
      finishThumb: s.finishThumbData || s.finishThumb || '',   // base64 우선(CORS 없음)
      finishPhoto: s.finishPhoto || '', finishVideo: s.finishVideo || '', finishType: s.finishType || (s.finishPhoto ? 'photo' : ''),
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
    const people = peopleNames();
    const filter = people.indexOf(who) >= 0 ? who : '';
    const [ss, runs, wts] = await Promise.all([
      col('sessions').orderBy('date', 'desc').get().then(docsOf),
      col('running').get().then(docsOf),
      col('weights').get().then(docsOf),
    ]);
    return ss.filter((s) => !filter || isWho(s, filter)).map((s) => sessionView(s, runs, wts));
  }

  /* ---------- 홈 피드: 어제 오운완 (없으면 공백 일수 계산) ---------- */
  async function latestFinish() {
    requireUser();
    const people = peopleNames();
    const ss = await col('sessions').orderBy('date', 'desc').limit(60).get().then(docsOf);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const yd = new Date(today); yd.setDate(yd.getDate() - 1);
    const ymdOf = localYmd;              // 한국 로컬 날짜 (UTC 밀림 방지)
    const yesterday = ymdOf(yd);
    const todayS = ymdOf(today);

    const thumbOf = (s) => s.finishThumbData || s.finishThumb || '';
    const hasFin = (s) => !!(s.finishThumbData || s.finishThumb);
    return people.map((p) => {
      // 그 사람의 오운완(사진/영상) 있는 세션들 (최신순)
      const mine = ss.filter((s) => isWho(s, p) && hasFin(s));
      // 오늘 올린 게 있으면 오늘 것, 없으면 어제 것
      const t = mine.find((s) => String(s.date).slice(0, 10) === todayS);
      const y = t || mine.find((s) => String(s.date).slice(0, 10) === yesterday);
      if (y) {
        return { who: p, hasPhoto: true, when: t ? '오늘' : '어제', date: y.date, workout: y.workout || '', thumb: thumbOf(y),
          video: y.finishVideo || '', type: y.finishType || 'photo', url: y.finishPhoto || y.finishVideo || '', daysOff: t ? 0 : 1 };
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
    const mine = all.filter((w) => w.uid === u.uid);
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
    const people = peopleNames();
    const d = String(date || '').slice(0, 10);
    const ss = await col('sessions').where('date', '==', d).get().then(docsOf);
    // 각 사람: 오운완 사진 세션 우선, 없으면 운동만 한 세션, 둘 다 없으면 쉼
    return people.map((p) => {
      const mine = ss.filter((s) => isWho(s, p));
      const withFin = mine.find((s) => s.finishThumbData || s.finishThumb);
      if (withFin) return { who: p, state: 'photo', date: d, workout: withFin.workout || '',
        thumb: withFin.finishThumbData || withFin.finishThumb, type: withFin.finishType || 'photo' };
      if (mine.length) return { who: p, state: 'nophoto', date: d, workout: (mine[0].workout || '') };
      return { who: p, state: 'rest', date: d };
    });
  }

  /* ---------- 한 사람의 오운완 전체 목록 (날짜별 보기용) ---------- */
  async function finishHistory(who) {
    requireUser();
    const ss = await col('sessions').orderBy('date', 'desc').get().then(docsOf);
    return ss.filter((s) => isWho(s, who) && (s.finishThumbData || s.finishThumb))
      .map((s) => ({ who: who, date: s.date, workout: s.workout || '',
        thumb: s.finishThumbData || s.finishThumb, video: s.finishVideo || '', type: s.finishType || 'photo', url: s.finishPhoto || s.finishVideo || '' }));
  }

  /* ---------- 웨이트 입력 화면용: 이 기구·동작의 지난번 기록 ---------- */
  async function lastWeightFor(equip, move, beforeDate, part) {
    const u = requireUser();
    if (!MYW_CACHE) MYW_CACHE = await col('weights').where('uid', '==', u.uid).get().then(docsOf);
    const e = tidy(equip, 60), m = tidy(move, 60), p = tidy(part, 20), before = tidy(beforeDate, 10) || '9999-12-31';
    const day = (w) => String(w.date).slice(0, 10);
    // 같은 부위 + 같은 기구 + 같은 동작만 (다른 부위·다른 기구 기록은 섞지 않음)
    const same = MYW_CACHE.filter((w) => w.equip === e && (w.move || '') === m
      && (!p || !w.part || w.part === p) && day(w) < before);
    const other = false;
    if (!same.length) return { found: false };
    // 날짜(+기구)별로 묶어서 최근 5번
    const groups = {};
    same.forEach((w) => {
      const k = day(w) + '|' + (w.equip || '');
      (groups[k] = groups[k] || { date: day(w), equip: w.equip || '', sets: [] }).sets.push(w);
    });
    const list = Object.values(groups)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
      .slice(0, 5)
      .map((g) => {
        const sets = g.sets.sort((a, b) => (a.setNo || 0) - (b.setNo || 0))
          .map((w) => ({ weight: w.weight, reps: w.reps }));
        let top = 0; sets.forEach((s) => { const v = Number(s.weight) || 0; if (v > top) top = v; });
        return { date: g.date, equip: g.equip, sets, top };
      });
    return { found: true, other, list };
  }

  /* ---------- 기록하기: 지난번 같은 부위 날의 루틴 (기구·동작 목록 + 그날 세트) ---------- */
  async function routineFor(part, beforeDate) {
    const u = requireUser();
    if (!MYW_CACHE) MYW_CACHE = await col('weights').where('uid', '==', u.uid).get().then(docsOf);
    const p = tidy(part, 20), before = tidy(beforeDate, 10) || '9999-12-31';
    if (!p) return { found: false };
    const day = (w) => String(w.date).slice(0, 10);
    const mine = MYW_CACHE.filter((w) => w.part === p && day(w) < before);
    if (!mine.length) return { found: false };
    const last = mine.map(day).sort().pop();
    const ms = (t) => (t && t.toMillis ? t.toMillis() : (t && t.seconds ? t.seconds * 1000 : Number(t) || 0));
    const rows = mine.filter((w) => day(w) === last)
      .sort((a, b) => (ms(a.createdAt) - ms(b.createdAt)) || ((a.setNo || 0) - (b.setNo || 0)));
    const items = [], idx = {};
    rows.forEach((w) => {
      const k = (w.equip || '') + '|' + (w.move || '');
      if (!(k in idx)) { idx[k] = items.length; items.push({ equip: w.equip || '', move: w.move || '', sets: [] }); }
      items[idx[k]].sets.push({ weight: w.weight == null ? '' : w.weight, reps: w.reps == null ? '' : w.reps });
    });
    return { found: true, date: last, items };
  }

  /* ---------- 런닝 입력 화면용: 내 최근 런닝 기록 (최근 5번) ---------- */
  async function lastRunFor(beforeDate) {
    const u = requireUser();
    const before = tidy(beforeDate, 10) || '9999-12-31';
    const day = (r) => String(r.date).slice(0, 10);
    const runs = await col('running').where('uid', '==', u.uid).get().then(docsOf);
    const list = runs.filter((r) => day(r) < before)
      .sort((a, b) => (day(a) < day(b) ? 1 : day(a) > day(b) ? -1 : 0))
      .slice(0, 5)
      .map((r) => {
        const v = (x) => (x == null ? '' : x);
        return { date: day(r), min: v(r.min), km: v(r.km), incline: v(r.incline), speed: v(r.speed), kcal: v(r.kcal) };
      });
    return list.length ? { found: true, list } : { found: false };
  }

  /* ---------- 기록하기 시작 화면용: 내 마지막 운동 힌트 ---------- */
  async function workoutHint() {
    const u = requireUser();
    const ss = await col('sessions').where('uid', '==', u.uid).get().then(docsOf);
    const mine = ss.filter((s) => s.workout).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    if (!mine.length) return { type: 'none' };
    const last = mine[0];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const ld = new Date(String(last.date).slice(0, 10) + 'T00:00:00');
    const daysAgo = Math.round((today - ld) / 86400000);
    return { type: 'ok', lastWorkout: last.workout, daysAgo: daysAgo, date: last.date };
  }

  /* ---------- 기록 관리: 본인 세션 목록 ---------- */
  async function listMySessions() {
    const u = requireUser();
    const [ss, runs, wts] = await Promise.all([
      col('sessions').where('uid', '==', u.uid).get().then(docsOf),
      col('running').where('uid', '==', u.uid).get().then(docsOf),
      col('weights').where('uid', '==', u.uid).get().then(docsOf),
    ]);
    return ss.sort((a, b) => String(b.date).localeCompare(String(a.date))).map((s) => {
      const nRun = runs.filter((r) => r.sessionId === s.id).length;
      const eq = {}; wts.filter((w) => w.sessionId === s.id).forEach((w) => { eq[w.equip] = 1; });
      return { id: s.id, date: s.date, workout: s.workout || '',
        hasPhoto: !!(s.finishThumbData || s.finishThumb), nRun: nRun, nEquip: Object.keys(eq).length };
    });
  }

  /* 드라이브 보기 URL → fileId */
  function fileIdOf_(url) { const m = /\/d\/([A-Za-z0-9_-]+)/.exec(String(url || '')); return m ? m[1] : ''; }

  /* ---------- 기록 관리: 본인 세션 삭제 (Firestore + 드라이브 사진) ---------- */
  async function deleteSessions(ids) {
    const u = requireUser();
    ids = (Array.isArray(ids) ? ids : []).map((x) => String(x));
    if (!ids.length) return { ok: true, deleted: 0 };

    const [ss, runs, wts] = await Promise.all([
      col('sessions').where('uid', '==', u.uid).get().then((s) => s.docs),
      col('running').where('uid', '==', u.uid).get().then((s) => s.docs),
      col('weights').where('uid', '==', u.uid).get().then((s) => s.docs),
    ]);
    const mine = ss.filter((d) => ids.indexOf(d.id) >= 0 && d.data().uid === u.uid);  // 내 것만
    if (!mine.length) fail('삭제할 기록을 찾을 수 없습니다.');
    const idSet = {}; mine.forEach((d) => { idSet[d.id] = 1; });

    // 드라이브에서 지울 사진 fileId 모으기 (오운완 + 런닝 사진)
    const fileIds = [];
    mine.forEach((d) => { const id = fileIdOf_(d.data().finishPhoto); if (id) fileIds.push(id); });
    runs.forEach((d) => { if (idSet[d.data().sessionId]) { const id = fileIdOf_(d.data().photo); if (id) fileIds.push(id); } });

    // Firestore 일괄 삭제 (세션 + 하위 running/weights)
    const batch = db.batch();
    mine.forEach((d) => batch.delete(d.ref));
    runs.forEach((d) => { if (idSet[d.data().sessionId]) batch.delete(d.ref); });
    wts.forEach((d) => { if (idSet[d.data().sessionId]) batch.delete(d.ref); });
    await batch.commit();

    // 드라이브 사진 삭제 (Apps Script 중계)
    if (fileIds.length) {
      try {
        const url = String((window.APP_CONFIG || {}).APPS_SCRIPT_URL || '').trim();
        const idToken = await auth.currentUser.getIdToken();
        await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ op: 'delete', idToken, fileIds }) });
      } catch (e) { /* 사진 삭제 실패해도 기록은 지워짐 */ }
    }
    MYW_CACHE = null;
    return { ok: true, deleted: mine.length };
  }

  /* ---------- 메인 비교 피드백 (내 최근 vs 그 전 같은 운동) ---------- */
  async function lastFeedback() {
    const u = requireUser();
    const [ssRaw, runs, wts] = await Promise.all([
      col('sessions').where('uid', '==', u.uid).get().then(docsOf),
      col('running').where('uid', '==', u.uid).get().then(docsOf),
      col('weights').where('uid', '==', u.uid).get().then(docsOf),
    ]);
    if (!ssRaw.length) return { type: 'none' };
    const ss = ssRaw.sort((a, b) => String(b.date).localeCompare(String(a.date)));   // 최신순 (색인 불필요)
    const cur = ss[0];
    // 같은 운동(workout)의 직전 세션
    const prev = ss.slice(1).find((s) => s.workout && s.workout === cur.workout);

    const setsOf = (sid) => wts.filter((w) => w.sessionId === sid);
    const runOf = (sid) => runs.filter((r) => r.sessionId === sid);
    const sumSets = (sid) => setsOf(sid).length;
    const kmOf = (sid) => runOf(sid).reduce((a, r) => a + (Number(r.km) || 0), 0);
    // 기구+동작별 최고무게
    const bestMap = (sid) => {
      const m = {};
      setsOf(sid).forEach((w) => { const k = w.equip + (w.move ? ' ' + w.move : ''); const v = Number(w.weight) || 0; if (!m[k] || v > m[k]) m[k] = v; });
      return m;
    };

    const base = { who: u.name, date: cur.date, workout: cur.workout || '' };
    if (!prev) {
      // 비교 대상 없음 → 요약
      const km = Math.round(kmOf(cur.id) * 10) / 10;
      return Object.assign(base, { type: 'first', sets: sumSets(cur.id), km });
    }
    // 1) 기구 무게 증가 찾기 (가장 큰 증가)
    const cm = bestMap(cur.id), pm = bestMap(prev.id);
    let bestInc = null;
    Object.keys(cm).forEach((k) => { if (pm[k] != null) { const diff = cm[k] - pm[k]; if (diff > 0 && (!bestInc || diff > bestInc.diff)) bestInc = { k, diff, now: cm[k] }; } });
    if (bestInc) return Object.assign(base, { type: 'weight', equip: bestInc.k, inc: bestInc.diff, now: bestInc.now });
    // 2) 런닝 거리 증가
    const curKm = kmOf(cur.id), prevKm = kmOf(prev.id);
    if (curKm > prevKm + 0.05) return Object.assign(base, { type: 'run', inc: Math.round((curKm - prevKm) * 10) / 10, now: Math.round(curKm * 10) / 10 });
    // 3) 세트 수 증가
    const cs = sumSets(cur.id), ps = sumSets(prev.id);
    if (cs > ps) return Object.assign(base, { type: 'sets', inc: cs - ps, now: cs });
    // 4) 유지/감소 → 격려
    return Object.assign(base, { type: 'keep' });
  }

  /* ---------- 발전 추이용 원자료 ---------- */
  async function trendData() {
    requireUser();
    const [runs, wts] = await Promise.all([
      col('running').get().then(docsOf),
      col('weights').get().then(docsOf),
    ]);
    // 이름 바뀌기 전 기록도 지금 이름으로 맞춰서 내려줌 (uid 기준)
    const fixWho = (r) => { const p = PROFILES.filter((x) => x.uid && x.uid === r.uid)[0]; if (p) r.who = p.name; return r; };
    return { running: runs.map(fixWho), weights: wts.map(fixWho), people: peopleNames() };
  }

  /* ---------- 화면용 창구 ---------- */
  const API = { listGear, addEquipment, addMove, deleteEquipment, updateEquipment, updateMove, startSession, addRunning, addWeight, addFinish, sessionSummary, listSessions, trendData, latestFinish, finishHistory, dayFinish, equipLog, lastFeedback, workoutHint, listMySessions, deleteSessions, renameMe, lastWeightFor, lastRunFor, routineFor };
  async function call(fn) {
    const f = API[fn]; if (!f) fail('없는 기능: ' + fn);
    return f.apply(null, Array.prototype.slice.call(arguments, 1));
  }

  window.FB = {
    ok: true, version: VERSION, workouts: WORKOUTS, parts: BODY_PARTS,
    authReady, signIn, signOut, call,
    me: () => USER,
    people: () => peopleNames(),
    partGroup,
  };
})();
