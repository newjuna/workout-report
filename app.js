/* 운동 레포트 · 화면 동작 (클라이언트)
 * 데이터는 FB.call('기능', ...) → Firestore 직접 (빠름). 사진만 Apps Script 중계.
 */
var ME = null;        // { email, name }
var WORKOUTS = [];
var PARTS = [];
var PEOPLE = [];
var CUR_TAB = 'home';
var GEAR = [];
var SID = '';
var DRAFT = null;
var PHOTOBUF = {};
var PICK_STEP = '';
var PICK_EQUIP = null;
var FIN_TEXT = '';
var SESS = { date:'', workout:'' };
var SAVED = { running:[], weights:[], finishThumb:'' };
var OPEN = '';

/* ---------- 공통 도구 ---------- */
function $(id){ return document.getElementById(id); }
function esc(v){ return String(v==null?'':v).replace(/[&<>"']/g, function(c){
  return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function toast(msg){ var t=$('toast'); t.textContent=msg; t.style.display='block';
  clearTimeout(toast._t); toast._t=setTimeout(function(){ t.style.display='none'; }, 2600); }
function cover(on, msg){ var c=$('cover'); if(msg) $('loadMsg').textContent=msg; c.classList.toggle('on', !!on); }
function call(fn){ return FB.call.apply(FB, [fn].concat(Array.prototype.slice.call(arguments,1))); }

/* ---------- 로그인 (Firebase Auth) ---------- */
window.addEventListener('DOMContentLoaded', function(){
  if(!window.FB || !FB.ok){ document.body.innerHTML = '<div style="padding:40px;color:#eee;font:16px sans-serif">설정 오류: config.js 또는 Firebase SDK를 확인하세요.</div>'; return; }
  $('loginVer').textContent = FB.version || '';
  $('footVer').textContent = FB.version || '';
  $('appVer').textContent = '운동 레포트 ' + (FB.version || '');
  WORKOUTS = FB.workouts || [];
  PARTS = FB.parts || [];
  PEOPLE = FB.people() || [];
});

/* FB가 로그인 상태 변화를 알려줌 */
window.onAuthChanged = function(user, rawUser){
  if(user){
    ME = { email:user.email, name:user.name };
    $('loginView').hidden = true;
    $('appView').hidden = false;
    $('identity').innerHTML = '<b>' + esc(ME.name) + '</b><br>' + esc(ME.email);
    GEAR = [];   // 캐시 초기화
    switchTab('home');
  } else {
    // 로그인 안 됨 또는 허용 안 된 계정
    $('appView').hidden = true;
    $('loginView').hidden = false;
    if(rawUser){
      // 구글 로그인은 됐지만 허용 목록에 없음
      $('loginTitle').textContent = '접근 권한이 없어요';
      $('loginSub').textContent = '이 앱은 등록된 계정만 쓸 수 있어요.';
      $('loginStatus').textContent = '현재 로그인: ' + (rawUser.email||'');
      var help = $('loginHelp'); help.hidden=false;
      help.innerHTML = '다른 계정으로 로그인하려면 아래 버튼을 다시 눌러 계정을 바꿔 주세요.';
    } else {
      $('loginTitle').textContent = '로그인';
      $('loginSub').textContent = '구글 계정으로 로그인하세요.';
      $('loginStatus').textContent = '';
      $('loginHelp').hidden = true;
    }
  }
};

function doLogin(){
  $('loginStatus').textContent = '로그인 창을 여는 중…';
  FB.signIn().catch(function(e){
    $('loginStatus').textContent = '로그인 실패: ' + (e&&e.message||e);
  });
}
function logout(){ FB.signOut(); toast('로그아웃했어요.'); }

/* ---------- 메뉴 드로어 ---------- */
function toggleMenu(force){
  var open = (typeof force === 'boolean') ? force : !$('drawer').classList.contains('open');
  $('drawer').classList.toggle('open', open);
  $('scrim').classList.toggle('open', open);
  $('drawer').setAttribute('aria-hidden', String(!open));
  $('menuBtn').setAttribute('aria-expanded', String(open));
}

/* ---------- 탭 전환 ---------- */
var TAB_TITLE = { home:'오늘 운동', log:'기록하기', list:'운동 일지', equip:'기구 목록', trend:'발전 추이' };
function switchTab(tab){
  CUR_TAB = tab;
  ['home','log','list','equip','trend'].forEach(function(t){ $(t).classList.toggle('hidden', t !== tab); });
  Array.prototype.forEach.call(document.querySelectorAll('#navTabs button'), function(b){
    b.classList.toggle('active', b.getAttribute('data-tab') === tab);
  });
  $('pageTitle').textContent = TAB_TITLE[tab] || '';
  toggleMenu(false);
  render(tab);
}

function render(tab){
  if(tab === 'home')  return renderHome();
  if(tab === 'log')   return renderLog();
  if(tab === 'equip') return renderEquip();
  if(tab === 'list')  return renderList();
  if(tab === 'trend') return renderTrend();
}

function todayStr(){
  var d = new Date(), z = function(n){ return (n<10?'0':'')+n; };
  return d.getFullYear() + '-' + z(d.getMonth()+1) + '-' + z(d.getDate());
}
function workoutOptions(sel){
  return '<option value="">운동 선택…</option>' + WORKOUTS.map(function(w){
    return '<option value="' + esc(w) + '"' + (sel===w?' selected':'') + '>' + esc(w) + '</option>';
  }).join('');
}

function renderHome(){
  $('home').innerHTML =
    '<div class="card">'
    + '<h2>안녕하세요, ' + esc(ME.name) + '님 👋</h2>'
    + '<p class="desc">오늘 운동을 기록하고, 지난 기록과 비교해 발전을 확인해요.</p>'
    + '</div>'
    + '<div class="card">'
    + '<h2>오늘 운동 기록하기</h2>'
    + '<p class="desc">런닝머신 → 웨이트(기구별) → 오운완 사진 순서로, 끝날 때마다 바로 저장돼요.</p>'
    + '<button class="button accent" style="width:100%;margin-top:12px" onclick="switchTab(\'log\')">＋ 오늘 운동 시작</button>'
    + '</div>';
}

/* ====================================================================
 * 기록하기 화면
 * ==================================================================== */
function renderLog(){
  ensureEquip(function(){
    if(!SID) return renderLogStart();
    renderLogBody();
  });
}
function renderLogStart(){
  $('log').innerHTML =
    '<div class="card">'
    + '<h2>오늘 운동 시작</h2>'
    + '<div class="field"><label>날짜</label><input type="date" id="logDate" value="' + todayStr() + '"></div>'
    + '<div class="field"><label>오늘의 운동</label><select id="logWorkout" class="bigsel">' + workoutOptions('') + '</select></div>'
    + '<button class="button accent" style="width:100%;margin-top:6px" onclick="doStartSession()">시작하기</button>'
    + '<p class="muted" style="margin-top:10px">시작하면 각 항목을 끝낼 때마다 바로 저장돼요. 중간에 꺼져도 저장된 건 남아요.</p>'
    + '</div>';
}
function doStartSession(){
  var date = $('logDate').value, workout = $('logWorkout').value;
  if(!date){ toast('날짜를 선택해 주세요.'); return; }
  cover(true, '시작하는 중…');
  call('startSession', { date:date, workout:workout }).then(function(r){
    cover(false); SID = r.id; SESS = { date:r.date, workout:r.workout };
    SAVED = { running:[], weights:[], finishThumb:'' };
    DRAFT = null; OPEN=''; renderLogBody();
  }).catch(function(e){ cover(false); toast('시작 실패: ' + (e&&e.message||e)); });
}

function renderLogBody(){
  cover(true, '불러오는 중…');
  call('sessionSummary', SID).then(function(v){
    cover(false);
    SAVED = { running: v.running||[], weights: v.weights||[], finishThumb: v.finishThumb||'' };
    SESS = { date: v.date, workout: v.workout };
    $('log').innerHTML = logBodyHtml();
    wirePhotoButtons();
  }).catch(function(e){ cover(false); toast('오류: ' + (e&&e.message||e)); });
}

function logBodyHtml(){
  var h = '';
  h += '<div class="card">'
    + '<div class="row" style="justify-content:space-between;align-items:center">'
    +   '<div><b>' + esc(SESS.date) + '</b>' + (SESS.workout ? ' <span class="chip">' + esc(SESS.workout) + '</span>' : '') + '</div>'
    +   '<button class="pillbtn" onclick="endSession()">끝내기 ✓</button>'
    + '</div></div>';

  h += '<div class="card">'
    + '<h2>🏃 런닝머신</h2>'
    + SAVED.running.map(function(r){ return '<div class="savedline">✓ ' + esc(runText(r)) + '</div>'; }).join('')
    + (OPEN==='run' ? runFormHtml() : '<button class="softbtn" onclick="openForm(\'run\')">＋ 런닝 기록 추가</button>')
    + '</div>';

  h += '<div class="card">'
    + '<h2>🏋 웨이트</h2>'
    + (SAVED.weights.length ? SAVED.weights.map(function(w){
        var sets = (w.sets||[]).map(function(x){ return x.weight+'kg×'+x.reps; }).join(', ');
        var mv = w.move ? ' · ' + esc(w.move) : '';
        return '<div class="savedline">✓ <b>' + esc(w.equip) + '</b>' + mv + ' <span class="muted">' + esc(sets) + '</span></div>';
      }).join('') : '')
    + (OPEN==='weight' ? weightFormHtml() : '<button class="softbtn" onclick="openWeight()">＋ 기구 추가</button>')
    + (GEAR.length ? '' : '<p class="muted" style="margin-top:8px">먼저 <a onclick="switchTab(\'equip\')">기구 목록</a>에서 기구를 등록하세요.</p>')
    + '</div>';

  h += '<div class="card" id="finCard">'
    + '<h2>📸 오운완</h2>'
    + finishInner()
    + '</div>';
  return h;
}

function finishInner(){
  if(SAVED.finishThumb && !PHOTOBUF.fin){
    return '<img src="' + esc(SAVED.finishThumb) + '" style="width:100%;max-width:300px;border-radius:16px">'
      + '<button class="softbtn" style="margin-top:10px" onclick="PHOTOBUF.fin=null;FIN_TEXT=\'\';renderLogView()">다시 올리기</button>';
  }
  if(PHOTOBUF.fin){
    return '<div class="finstage" id="finStage">'
      +   '<img src="' + esc(PHOTOBUF.fin.data) + '" class="finimg">'
      +   '<div class="finoverlay">'
      +     '<div class="fintext" id="finPreview">' + esc(FIN_TEXT || '') + '</div>'
      +     '<div class="finmeta">' + esc(SESS.date) + (SESS.workout ? ' · ' + esc(SESS.workout) : '') + ' · ' + esc(ME.name) + '</div>'
      +   '</div>'
      + '</div>'
      + '<input id="finInput" class="fininput" maxlength="40" placeholder="오늘의 한마디 (예: 가슴 조졌다 💪)" value="' + esc(FIN_TEXT || '') + '" oninput="FIN_TEXT=this.value;document.getElementById(\'finPreview\').textContent=this.value">'
      + '<div class="row" style="margin-top:10px">'
      +   '<button class="button ghost" style="flex:1" onclick="PHOTOBUF.fin=null;FIN_TEXT=\'\';renderLogView()">취소</button>'
      +   '<button class="button accent" style="flex:2" onclick="confirmFinish(event)">이 사진으로 저장</button>'
      + '</div>';
  }
  return photoPicker('fin', '오운완 사진 올리기');
}

function runText(r){
  var p = [];
  if(r.min!=='') p.push(r.min+'분'); if(r.km!=='') p.push(r.km+'km');
  if(r.incline!=='') p.push('경사'+r.incline); if(r.speed!=='') p.push(r.speed+'km/h'); if(r.kcal!=='') p.push(r.kcal+'kcal');
  return p.join(' · ') || '기록';
}
function runFormHtml(){
  return '<div class="subcard">'
    + '<div class="grid2">'
    +   numField('run_min','시간(분)','10') + numField('run_km','거리(km)','1.2')
    +   numField('run_incline','경사','3') + numField('run_speed','속도(km/h)','7')
    +   numField('run_kcal','칼로리','90') + '<div></div>'
    + '</div>'
    + photoPicker('run', '결과 사진(선택)')
    + '<div class="row" style="margin-top:10px">'
    +   '<button class="button ghost" style="flex:1" onclick="OPEN=\'\';renderLogView()">취소</button>'
    +   '<button class="button accent" style="flex:2" onclick="confirmRun(event)">확인 (저장)</button>'
    + '</div></div>';
}
function numField(id, label, ph){
  return '<div class="field"><label>' + label + '</label><input id="' + id + '" type="number" inputmode="decimal" placeholder="' + ph + '"></div>';
}
function confirmRun(ev){
  var r = { min:val('run_min'), km:val('run_km'), incline:val('run_incline'), speed:val('run_speed'), kcal:val('run_kcal'), photo: PHOTOBUF.run || null };
  if(['min','km','incline','speed','kcal'].every(function(k){return String(r[k]).trim()==='';}) && !r.photo){ toast('런닝 값을 입력해 주세요.'); return; }
  var btn = ev && ev.target ? ev.target : null; busyBtn(btn,'저장 중…');
  cover(true,'저장 중…');
  call('addRunning', SID, r).then(function(){
    cover(false); toast('런닝 기록 저장 ✓');
    SAVED.running.push({ min:r.min, km:r.km, incline:r.incline, speed:r.speed, kcal:r.kcal, photo:'' });
    PHOTOBUF.run=null; OPEN=''; renderLogView();
  }).catch(function(e){ cover(false); unbusyBtn(btn); toast('저장 실패: ' + (e&&e.message||e)); });
}
function val(id){ var el=$(id); return el?el.value:''; }

/* ---- 웨이트: 기구 → 동작 팝업 ---- */
function openWeight(){
  if(!GEAR.length){ toast('먼저 기구 목록에서 기구를 등록하세요.'); return; }
  PICK_STEP='equip'; PICK_EQUIP=null; renderPicker();
}
function renderPicker(){
  var sh = $('pickerModal');
  if(!sh){ sh=document.createElement('div'); sh.id='pickerModal'; sh.className='modalwrap'; document.body.appendChild(sh); }
  var body, title;
  if(PICK_STEP==='equip'){
    title = '기구 선택';
    body = '<div class="grid-cards">' + GEAR.map(function(e,i){
      return '<button class="pickcard" onclick="pickEquipStep(' + i + ')">'
        + photoThumb(e.thumb, '🏋')
        + '<div class="pcname">' + esc(e.name) + '</div>'
        + '<div class="pcsub">' + esc(e.part) + '</div>'
        + '</button>';
    }).join('') + '</div>';
  } else {
    title = esc(PICK_EQUIP.name) + ' · 동작 선택';
    var moves = PICK_EQUIP.moves || [];
    body = moves.length ? '<div class="grid-cards">' + moves.map(function(m,i){
      return '<button class="pickcard" onclick="pickMoveStep(' + i + ')">'
        + photoThumb(m.thumb, '💪')
        + '<div class="pcname">' + esc(m.name) + '</div>'
        + (m.desc ? '<div class="pcsub">' + esc(m.desc) + '</div>' : '')
        + '</button>';
    }).join('') + '</div>'
      : '<p class="muted">등록된 동작이 없어요. 기구 목록에서 동작을 추가하거나, 아래 버튼으로 동작 없이 기록해요.</p>'
        + '<button class="button accent" style="width:100%;margin-top:10px" onclick="pickMoveNone()">동작 없이 기록</button>';
  }
  sh.innerHTML =
    '<div class="modalbg" onclick="closePicker()"></div>'
    + '<div class="modalbox">'
    +   '<div class="modalhead"><b>' + title + '</b><button class="xbtn" onclick="closePicker()">✕</button></div>'
    +   (PICK_STEP==='move' ? '<button class="linkback" onclick="PICK_STEP=\'equip\';renderPicker()">‹ 기구 다시 고르기</button>' : '')
    +   '<div class="modalbody">' + body + '</div>'
    + '</div>';
  sh.classList.add('on');
}
function photoThumb(thumb, fallback){
  return thumb ? '<img class="pcimg" src="' + esc(thumb) + '">' : '<div class="pcimg pcnoimg">' + fallback + '</div>';
}
function closePicker(){ var sh=$('pickerModal'); if(sh) sh.classList.remove('on'); }
function pickEquipStep(i){
  PICK_EQUIP = GEAR[i];
  var moves = PICK_EQUIP.moves || [];
  if(moves.length === 1){ setDraft(PICK_EQUIP, moves[0]); return; }
  PICK_STEP='move'; renderPicker();
}
function pickMoveStep(i){ setDraft(PICK_EQUIP, PICK_EQUIP.moves[i]); }
function pickMoveNone(){ setDraft(PICK_EQUIP, null); }
function setDraft(equip, move){
  DRAFT = { equipId:equip.id, equipName:equip.name, part:equip.part,
            moveName: move ? move.name : '', moveDesc: move ? move.desc : '', sets:[{weight:'',reps:''}] };
  closePicker(); OPEN='weight'; renderLogView();
}
function weightFormHtml(){
  if(!DRAFT) return '';
  var setsHtml = DRAFT.sets.map(function(s, si){
    return '<div class="setrow">'
      + '<span class="setno">' + (si+1) + '세트</span>'
      + '<input type="number" inputmode="decimal" placeholder="무게kg" value="' + esc(s.weight) + '" oninput="DRAFT.sets[' + si + '].weight=this.value">'
      + '<input type="number" inputmode="numeric" placeholder="횟수" value="' + esc(s.reps) + '" oninput="DRAFT.sets[' + si + '].reps=this.value">'
      + (DRAFT.sets.length>1 ? '<button class="xbtn2" onclick="delDraftSet(' + si + ')">✕</button>' : '<span style="width:40px"></span>')
      + '</div>';
  }).join('');
  return '<div class="subcard">'
    + '<div class="drafthead">'
    +   '<b>' + esc(DRAFT.equipName) + '</b>'
    +   (DRAFT.moveName ? ' <span class="chip">' + esc(DRAFT.moveName) + '</span>' : '')
    +   '<button class="linkback" onclick="openWeight()">바꾸기</button>'
    + '</div>'
    + (DRAFT.moveDesc ? '<p class="muted" style="margin:6px 0 2px">💡 ' + esc(DRAFT.moveDesc) + '</p>' : '')
    + '<div style="margin-top:8px">' + setsHtml + '</div>'
    + '<button class="softbtn" style="margin-top:4px" onclick="addDraftSet()">＋ 세트 추가</button>'
    + '<div class="row" style="margin-top:10px">'
    +   '<button class="button ghost" style="flex:1" onclick="OPEN=\'\';DRAFT=null;renderLogView()">취소</button>'
    +   '<button class="button accent" style="flex:2" onclick="confirmWeight(event)">확인 (저장)</button>'
    + '</div></div>';
}
function addDraftSet(){ DRAFT.sets.push({weight:'',reps:''}); renderLogView(); }
function delDraftSet(si){ DRAFT.sets.splice(si,1); if(!DRAFT.sets.length) DRAFT.sets.push({weight:'',reps:''}); renderLogView(); }
function confirmWeight(ev){
  if(!DRAFT || !DRAFT.equipName){ toast('기구를 선택해 주세요.'); return; }
  var sets = DRAFT.sets.filter(function(s){ return String(s.weight).trim()!=='' || String(s.reps).trim()!==''; });
  if(!sets.length){ toast('무게·횟수를 한 세트 이상 입력해 주세요.'); return; }
  var btn = ev && ev.target ? ev.target : null; busyBtn(btn,'저장 중…');
  var snap = { equip:DRAFT.equipName, move:DRAFT.moveName, part:DRAFT.part, sets:sets.slice() };
  cover(true,'저장 중…');
  call('addWeight', SID, { equipName:DRAFT.equipName, moveName:DRAFT.moveName, part:DRAFT.part, sets:sets })
    .then(function(){
      cover(false); toast(snap.equip + ' 저장 ✓');
      SAVED.weights.push(snap);
      DRAFT=null; OPEN=''; renderLogView();
    }).catch(function(e){ cover(false); unbusyBtn(btn); toast('저장 실패: ' + (e&&e.message||e)); });
}

function renderLogView(){ $('log').innerHTML = logBodyHtml(); wirePhotoButtons(); }
function openForm(kind){ OPEN=kind; renderLogView(); }

function confirmFinish(ev){
  if(!PHOTOBUF.fin){ toast('사진을 먼저 선택해 주세요.'); return; }
  var btn = ev && ev.target ? ev.target : null; busyBtn(btn,'저장 중…');
  cover(true,'사진 만드는 중…');
  var meta = SESS.date + (SESS.workout ? ' · ' + SESS.workout : '') + ' · ' + ME.name;
  composePhoto(PHOTOBUF.fin.data, FIN_TEXT, meta, function(dataUrl){
    var photo = { name:'오운완.jpg', mime:'image/jpeg', data:dataUrl };
    call('addFinishPhoto', SID, photo).then(function(r){
      cover(false); toast('오운완 저장 ✓');
      SAVED.finishThumb = (r && r.thumb) || dataUrl;
      PHOTOBUF.fin=null; FIN_TEXT=''; renderLogView();
    }).catch(function(e){ cover(false); unbusyBtn(btn); toast('저장 실패: ' + (e&&e.message||e)); });
  });
}
function composePhoto(src, text, meta, done){
  var img = new Image();
  img.onload = function(){
    var MAX = 1280, w = img.width, h = img.height;
    if(Math.max(w,h) > MAX){ var r = MAX/Math.max(w,h); w=Math.round(w*r); h=Math.round(h*r); }
    var cv = document.createElement('canvas'); cv.width=w; cv.height=h;
    var ctx = cv.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    var gh = Math.round(h*0.42);
    var g = ctx.createLinearGradient(0, h-gh, 0, h);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.72)');
    ctx.fillStyle = g; ctx.fillRect(0, h-gh, w, gh);
    ctx.textAlign = 'left';
    var pad = Math.round(w*0.06);
    if(text){
      var fs = Math.round(w*0.075);
      ctx.font = '800 ' + fs + 'px "Gothic A1", sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = Math.round(w*0.01);
      wrapText(ctx, text, pad, h - pad - Math.round(w*0.06), w-pad*2, fs*1.2, 2);
      ctx.shadowBlur = 0;
    }
    var ms = Math.round(w*0.038);
    ctx.font = '700 ' + ms + 'px "Gothic A1", sans-serif';
    ctx.fillStyle = '#c6f432';
    ctx.fillText(meta, pad, h - pad);
    done(cv.toDataURL('image/jpeg', 0.88));
  };
  img.onerror = function(){ toast('사진을 읽지 못했어요.'); cover(false); };
  img.src = src;
}
function wrapText(ctx, text, x, bottomY, maxW, lineH, maxLines){
  var words = String(text).split(''), lines = [], cur = '';
  for(var i=0;i<words.length;i++){
    var t = cur + words[i];
    if(ctx.measureText(t).width > maxW && cur){ lines.push(cur); cur = words[i]; } else cur = t;
  }
  if(cur) lines.push(cur);
  if(lines.length > maxLines) lines = lines.slice(0, maxLines);
  for(var j=0;j<lines.length;j++){ var y = bottomY - (lines.length-1-j)*lineH; ctx.fillText(lines[j], x, y); }
}

function endSession(){
  SID=''; DRAFT=null; OPEN=''; PHOTOBUF={}; FIN_TEXT='';
  toast('오늘 기록을 마쳤어요 💪');
  switchTab('list');
}

/* ====================================================================
 * 사진 선택 (버튼 1개 → 촬영/앨범 시트)
 * ==================================================================== */
var PHOTO_KEYS = ['run','fin','eq','mv'];
function photoPicker(key, label){
  return '<div class="picker" id="pick_' + key + '">'
    + '<div class="picklabel">' + esc(label) + '</div>'
    + '<button class="photobtn" onclick="openPhotoSheet(\'' + key + '\')">📷 사진 올리기</button>'
    + '<input type="file" accept="image/*" id="file_' + key + '" class="hiddenfile">'
    + '<input type="file" accept="image/*" capture="environment" id="cam_' + key + '" class="hiddenfile">'
    + '<div id="prev_' + key + '"></div>'
    + '</div>';
}
function wirePhotoButtons(){
  PHOTO_KEYS.forEach(function(key){
    ['file_','cam_'].forEach(function(pfx){
      var input = $(pfx+key); if(!input) return;
      input.onchange = function(){
        var f = input.files && input.files[0]; if(!f) return;
        var reader = new FileReader();
        reader.onload = function(){
          PHOTOBUF[key] = { name:f.name, mime:f.type, data:reader.result };
          if(key==='fin'){ FIN_TEXT=''; renderLogView(); return; }
          var prev = $('prev_'+key);
          if(prev) prev.innerHTML = '<img src="' + reader.result + '" class="prevpic">';
        };
        reader.readAsDataURL(f);
      };
    });
  });
}
function openPhotoSheet(key){
  var sh = $('photoSheet');
  if(!sh){ sh = document.createElement('div'); sh.id='photoSheet'; sh.className='sheetwrap'; document.body.appendChild(sh); }
  sh.innerHTML =
    '<div class="sheetbg" onclick="closePhotoSheet()"></div>'
    + '<div class="sheetbox">'
    +   '<div class="sheettitle">사진 올리기</div>'
    +   '<button class="sheetitem" onclick="pickFile(\'' + key + '\',true)">📸 카메라로 촬영</button>'
    +   '<button class="sheetitem" onclick="pickFile(\'' + key + '\',false)">🏞️ 앨범에서 선택</button>'
    +   '<button class="sheetitem cancel" onclick="closePhotoSheet()">취소</button>'
    + '</div>';
  sh.classList.add('on');
}
function closePhotoSheet(){ var sh=$('photoSheet'); if(sh) sh.classList.remove('on'); }
function pickFile(key, camera){ closePhotoSheet(); var el = $((camera?'cam_':'file_')+key); if(el) el.click(); }

/* ====================================================================
 * 기구 목록 화면
 * ==================================================================== */
function ensureEquip(cb){
  if(GEAR.length){ cb && cb(); return; }
  call('listGear').then(function(list){ GEAR = list || []; cb && cb(); })
    .catch(function(e){ toast('기구 목록 오류: ' + (e&&e.message||e)); cb && cb(); });
}
function renderEquip(){
  $('equip').innerHTML = '<div class="card"><p class="muted">불러오는 중…</p></div>';
  call('listGear').then(function(list){
    GEAR = list || [];
    var cards = GEAR.length ? GEAR.map(function(e){
      var moves = (e.moves||[]).map(function(m){ return '<span class="movetag">' + esc(m.name) + '</span>'; }).join('');
      return '<div class="card">'
        + '<div style="display:flex;gap:12px;align-items:center">'
        +   (e.thumb ? '<img src="' + esc(e.thumb) + '" class="eqimg">' : '<div class="eqimg eqnoimg">🏋</div>')
        +   '<div style="flex:1"><b>' + esc(e.name) + '</b><br><span class="muted">' + esc(e.part) + ' · 동작 ' + (e.moves||[]).length + '개</span></div>'
        + '</div>'
        + (moves ? '<div class="movetags">' + moves + '</div>' : '<p class="muted" style="margin:8px 0 0">동작이 없어요.</p>')
        + '<button class="softbtn" style="margin-top:8px" onclick="openMoveForm(\'' + e.id + '\')">＋ 이 기구에 동작 추가</button>'
        + '</div>';
    }).join('') : '<div class="card"><p class="muted">아직 등록된 기구가 없어요. 아래에서 추가해 보세요.</p></div>';

    $('equip').innerHTML =
      '<div class="card"><h2>기구 등록</h2>'
      + '<div class="field"><label>기구 이름</label><input id="eqName" placeholder="예: 벤치프레스"></div>'
      + '<div class="field"><label>부위</label><select id="eqPart" class="bigsel">' + PARTS.map(function(p){return '<option>'+esc(p)+'</option>';}).join('') + '</select></div>'
      + photoPicker('eq', '기구 사진(선택)')
      + '<button class="button accent" style="width:100%;margin-top:10px" onclick="submitEquip(event)">기구 추가</button>'
      + '</div>'
      + '<h2 style="margin:18px 4px 8px;font-size:16px">등록된 기구 ' + GEAR.length + '개</h2>'
      + cards;
    wirePhotoButtons();
  }).catch(function(e){ $('equip').innerHTML = '<div class="card"><p class="muted">오류: ' + esc(e&&e.message||e) + '</p></div>'; });
}
function submitEquip(ev){
  var name = $('eqName').value.trim();
  if(!name){ toast('기구 이름을 입력해 주세요.'); return; }
  var btn = ev && ev.target ? ev.target : null; busyBtn(btn,'등록 중…');
  cover(true, '등록 중…');
  call('addEquipment', { name:name, part:$('eqPart').value, photo: PHOTOBUF.eq || null })
    .then(function(r){ cover(false); toast('기구를 등록했어요 ✓'); GEAR = r.gear || []; PHOTOBUF.eq=null; renderEquip(); })
    .catch(function(e){ cover(false); unbusyBtn(btn); toast('등록 실패: ' + (e&&e.message||e)); });
}

var MOVE_EQUIP_ID = '';
function openMoveForm(equipId){
  MOVE_EQUIP_ID = equipId;
  var e = GEAR.filter(function(x){return x.id===equipId;})[0] || {};
  var sh = $('moveModal');
  if(!sh){ sh=document.createElement('div'); sh.id='moveModal'; sh.className='modalwrap'; document.body.appendChild(sh); }
  sh.innerHTML =
    '<div class="modalbg" onclick="closeMoveForm()"></div>'
    + '<div class="modalbox">'
    +   '<div class="modalhead"><b>' + esc(e.name) + ' · 동작 추가</b><button class="xbtn" onclick="closeMoveForm()">✕</button></div>'
    +   '<div class="modalbody">'
    +     '<div class="field"><label>동작 이름</label><input id="mvName" placeholder="예: 바벨 벤치프레스"></div>'
    +     '<div class="field"><label>운동법 설명(선택)</label><textarea id="mvDesc" placeholder="어떻게 하는 동작인지 간단히"></textarea></div>'
    +     photoPicker('mv', '동작 사진(선택)')
    +     '<button class="button accent" style="width:100%;margin-top:10px" onclick="submitMove(event)">동작 추가</button>'
    +   '</div>'
    + '</div>';
  sh.classList.add('on');
  wirePhotoButtons();
}
function closeMoveForm(){ var sh=$('moveModal'); if(sh) sh.classList.remove('on'); PHOTOBUF.mv=null; }
function submitMove(ev){
  var name = ($('mvName').value||'').trim();
  if(!name){ toast('동작 이름을 입력해 주세요.'); return; }
  var btn = ev && ev.target ? ev.target : null; busyBtn(btn, '추가 중…');
  cover(true,'동작 추가 중…');
  call('addMove', MOVE_EQUIP_ID, { name:name, desc:$('mvDesc').value, photo: PHOTOBUF.mv || null })
    .then(function(r){ cover(false); toast('동작을 추가했어요 ✓'); GEAR = r.gear || []; PHOTOBUF.mv=null; closeMoveForm(); renderEquip(); })
    .catch(function(e){ cover(false); unbusyBtn(btn); toast('추가 실패: ' + (e&&e.message||e)); });
}

function busyBtn(btn, label){ if(!btn) return; btn._html=btn.innerHTML; btn.disabled=true; btn.innerHTML=label; }
function unbusyBtn(btn){ if(!btn || btn._html==null) return; btn.disabled=false; btn.innerHTML=btn._html; }

/* ====================================================================
 * 운동 일지 화면
 * ==================================================================== */
var LIST_WHO = '';
function renderList(){
  $('list').innerHTML = '<div class="card"><p class="muted">불러오는 중…</p></div>';
  call('listSessions', LIST_WHO).then(function(sessions){
    var filterBtns = '<div class="seg">' + whoBtn('', '전체') + PEOPLE.map(function(p){ return whoBtn(p, p); }).join('') + '</div>';
    var body = sessions.length ? sessions.map(sessionCard).join('')
      : '<div class="card"><p class="muted">아직 기록이 없어요.</p></div>';
    $('list').innerHTML = filterBtns + body;
  }).catch(function(e){ $('list').innerHTML = '<div class="card"><p class="muted">오류: ' + esc(e&&e.message||e) + '</p></div>'; });
}
function whoBtn(v, label){
  return '<button class="button ' + (LIST_WHO===v?'accent':'ghost') + '" style="flex:1" onclick="LIST_WHO=\'' + v + '\';renderList()">' + esc(label) + '</button>';
}
function sessionCard(s){
  var run = (s.running||[]).map(function(r){
    var parts = [];
    if(r.min!=='') parts.push(r.min+'분'); if(r.km!=='') parts.push(r.km+'km');
    if(r.incline!=='') parts.push('경사'+r.incline); if(r.speed!=='') parts.push(r.speed+'km/h'); if(r.kcal!=='') parts.push(r.kcal+'kcal');
    var ph = r.photo ? ' <a href="' + esc(r.photo) + '" target="_blank">사진</a>' : '';
    return '<div class="muted" style="margin:2px 0">🏃 ' + esc(parts.join(' · ')) + ph + '</div>';
  }).join('');
  var wt = (s.weights||[]).map(function(w){
    var sets = (w.sets||[]).map(function(x){ return x.weight+'kg×'+x.reps; }).join(', ');
    var mv = w.move ? ' · ' + esc(w.move) : '';
    return '<div style="margin:3px 0">🏋 <b>' + esc(w.equip) + '</b>' + mv + ' <span class="muted">' + esc(sets) + '</span></div>';
  }).join('');
  return '<div class="card">'
    + '<div class="row" style="justify-content:space-between">'
    +   '<b>' + esc(s.date) + '</b>'
    +   '<span class="muted">' + esc(s.who) + (s.workout ? ' · ' + esc(s.workout) : '') + '</span>'
    + '</div>'
    + (run || '')
    + (wt ? '<div style="margin-top:6px">' + wt + '</div>' : '')
    + (s.finishThumb ? '<img src="' + esc(s.finishThumb) + '" style="width:100%;max-width:240px;border-radius:12px;margin-top:8px">' : '')
    + '</div>';
}

/* ====================================================================
 * 발전 추이 (다음 단계)
 * ==================================================================== */
function renderTrend(){
  $('trend').innerHTML = '<div class="card"><h2>발전 추이</h2>'
    + '<p class="desc">기구별 무게 추이, 런닝 거리·칼로리 그래프를 다음 단계에서 만들 거예요.</p></div>';
}
