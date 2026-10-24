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
var TAB_TITLE = { home:'오늘 운동', log:'기록하기', list:'운동 일지', equip:'기구 목록', trend:'성과 분석' };
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
    + '<p class="desc">부부의 최근 오운완을 확인하고, 오늘 운동을 기록해요.</p>'
    + '</div>'
    + '<div class="card">'
    +   '<h2>📸 우리의 최근 오운완</h2>'
    +   '<div id="feedGrid" class="feedgrid"><p class="muted">불러오는 중…</p></div>'
    + '</div>'
    + '<div class="card">'
    +   '<div class="row" style="gap:10px">'
    +     '<button class="button accent" style="flex:2" onclick="switchTab(\'log\')">＋ 오늘 운동 시작</button>'
    +     '<button class="button ghost" style="flex:1" onclick="openVersus()">⚔️ 대결</button>'
    +   '</div>'
    + '</div>';
  // 피드 로드
  call('latestFinish').then(function(list){
    FEED = list || [];
    renderFeed();
  }).catch(function(e){ var g=$('feedGrid'); if(g) g.innerHTML='<p class="muted">피드 오류: '+esc(e&&e.message||e)+'</p>'; });
}

var FEED = [];
/* 공백 일수별 놀리는 멘트 모음 — 3일부터는 랜덤으로 막 돌림 😈
 * 스토리에 캡처해 올려서 상대 놀리는 용도! */
var OFF_MSGS = {
  none: [            // 기록 아예 없음
    { emo:'💪', line:'첫 오운완을 기다리고 있어요!' },
    { emo:'🌱', line:'아직 시작 전… 오늘이 그날인가?' }
  ],
  d1: [              // 1일 (어제 쉼) — 가볍게
    { emo:'🤫', line:'어제는 휴일이였나봐요? 운동 쉿!' },
    { emo:'😴', line:'하루 쉬는 건 전략이죠… 아마도?' },
    { emo:'🛋️', line:'소파랑 사랑에 빠진 거 아니죠?' }
  ],
  d2: [              // 2일
    { emo:'🐷', line:'슬슬 돼지가 되고 있나봐요?' },
    { emo:'🍔', line:'이틀째… 입만 운동 중이신가요?' },
    { emo:'📉', line:'근손실 그래프 상승 중 📈 (나쁜 쪽으로)' },
    { emo:'🧈', line:'몸이 버터처럼 녹는 중…' }
  ],
  d3_5: [            // 3~5일 — 본격 놀리기 (랜덤)
    { emo:'😢', line:'운동화가 울면서 기다려요…' },
    { emo:'👀', line:'헬스장이 실종 신고 넣기 직전!' },
    { emo:'🐖', line:'돼지런 완료… 삼겹살 예약각?' },
    { emo:'🫃', line:'뱃살이 자기소개 준비 중이래요' },
    { emo:'🏳️', line:'근육이 백기 들었습니다' },
    { emo:'📵', line:'헬스장 번호 차단하셨어요?' }
  ],
  d6_9: [            // 6~9일 — 더 세게
    { emo:'🫠', line:'근육이 완전히 녹아버렸어요…' },
    { emo:'🦥', line:'나무늘보도 이것보단 움직여요' },
    { emo:'🐷', line:'이제 돼지가 아니라 멧돼지급' },
    { emo:'🪦', line:'R.I.P 식스팩 (한때 있었다고 함)' },
    { emo:'📺', line:'넷플릭스 랭킹 1위 달성하셨죠?' },
    { emo:'🍗', line:'운동 대신 치킨을 조지는 중' }
  ],
  d10: [             // 10일+ — 끝판왕 놀림
    { emo:'🛌', line:'겨울잠 중? 봄이 와도 안 일어남' },
    { emo:'🦕', line:'마지막 운동이 쥬라기 시대였나요?' },
    { emo:'🧟', line:'좀비도 이것보단 활동적입니다' },
    { emo:'🏺', line:'유물 발굴: 안 쓰인 운동화 발견' },
    { emo:'🐌', line:'달팽이가 추월했어요 저 멀리…' },
    { emo:'🎭', line:'헬스장 회원권: 기부 천사 등극' }
  ]
};
function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
function offComment(f){
  if(!f.hasAny) return pick(OFF_MSGS.none);
  var d = f.daysOff;
  if(d <= 1) return pick(OFF_MSGS.d1);
  if(d === 2) return pick(OFF_MSGS.d2);
  if(d <= 5) return pick(OFF_MSGS.d3_5);
  if(d <= 9) return pick(OFF_MSGS.d6_9);
  return pick(OFF_MSGS.d10);
}
function renderFeed(){
  var g = $('feedGrid'); if(!g) return;
  g.innerHTML = FEED.map(function(f, i){
    var cal = '<button class="calbtn" title="지난 오운완 보기" onclick="event.stopPropagation();openFinishHistory(\'' + esc(f.who) + '\')">📅</button>';
    if(f.hasPhoto){
      return '<div class="feedcard">'
        + '<div class="feedclick" onclick="openFeedPhoto(' + i + ')"><img src="' + esc(f.thumb) + '" class="feedimg"></div>'
        + '<div class="feedcap"><b>' + esc(f.who) + '</b>' + cal + '<span>어제 · ' + esc(f.date) + (f.workout ? ' · ' + esc(f.workout) : '') + '</span></div>'
        + '</div>';
    }
    var c = offComment(f);
    var since = f.hasAny ? ('마지막 운동 ' + f.daysOff + '일 전') : '아직 기록 없음';
    return '<div class="feedcard feedmsg">'
      + '<div class="feedimg feednoimg"><span class="emo">' + c.emo + '</span><span class="line">' + esc(c.line) + '</span></div>'
      + '<div class="feedcap"><b>' + esc(f.who) + '</b>' + cal + '<span>' + esc(since) + '</span></div>'
      + '</div>';
  }).join('');
}

/* 피드 사진 확대 팝업 */
function openFeedPhoto(i){
  var f = FEED[i]; if(!f || !f.hasPhoto) return;
  // 드라이브 썸네일 URL의 크기(sz=w400)를 키워 큰 화면용으로
  var big = String(f.thumb).replace(/sz=w\d+/, 'sz=w1000');
  var sh = $('feedModal');
  if(!sh){ sh=document.createElement('div'); sh.id='feedModal'; sh.className='lightbox'; document.body.appendChild(sh); }
  sh.innerHTML =
    '<div class="lb-bg" onclick="closeFeedPhoto()"></div>'
    + '<div class="lb-inner">'
    +   '<button class="lb-x" onclick="closeFeedPhoto()">✕</button>'
    +   '<img src="' + esc(big) + '" class="lb-img">'
    +   '<div class="lb-cap"><b>' + esc(f.who) + '</b> · ' + esc(f.date) + (f.workout ? ' · ' + esc(f.workout) : '') + '</div>'
    + '</div>';
  sh.classList.add('on');
}
function closeFeedPhoto(){ var sh=$('feedModal'); if(sh) sh.classList.remove('on'); }

/* 지난 오운완 날짜별로 보기 (달력 버튼) */
var HIST = [];
function openFinishHistory(who){
  var sh = $('histModal');
  if(!sh){ sh=document.createElement('div'); sh.id='histModal'; sh.className='modalwrap'; document.body.appendChild(sh); }
  sh.innerHTML =
    '<div class="modalbg" onclick="closeHist()"></div>'
    + '<div class="modalbox">'
    +   '<div class="modalhead"><b>📅 ' + esc(who) + '님의 오운완 기록</b><button class="xbtn" onclick="closeHist()">✕</button></div>'
    +   '<div class="modalbody" id="histBody"><p class="muted">불러오는 중…</p></div>'
    + '</div>';
  sh.classList.add('on');
  call('finishHistory', who).then(function(list){
    HIST = list || [];
    var body = $('histBody'); if(!body) return;
    if(!HIST.length){ body.innerHTML = '<p class="muted">아직 오운완 사진이 없어요.</p>'; return; }
    body.innerHTML = '<div class="grid-cards">' + HIST.map(function(h, i){
      return '<button class="pickcard" onclick="openHistPhoto(' + i + ')">'
        + '<img class="pcimg" src="' + esc(h.thumb) + '">'
        + '<div class="pcname">' + esc(h.date) + '</div>'
        + (h.workout ? '<div class="pcsub">' + esc(h.workout) + '</div>' : '')
        + '</button>';
    }).join('') + '</div>';
  }).catch(function(e){ var b=$('histBody'); if(b) b.innerHTML='<p class="muted">오류: '+esc(e&&e.message||e)+'</p>'; });
}
function closeHist(){ var sh=$('histModal'); if(sh) sh.classList.remove('on'); }
function openHistPhoto(i){
  var h = HIST[i]; if(!h) return;
  var big = String(h.thumb).replace(/sz=w\d+/, 'sz=w1000');
  var sh = $('feedModal');
  if(!sh){ sh=document.createElement('div'); sh.id='feedModal'; sh.className='lightbox'; document.body.appendChild(sh); }
  sh.innerHTML =
    '<div class="lb-bg" onclick="closeFeedPhoto()"></div>'
    + '<div class="lb-inner">'
    +   '<button class="lb-x" onclick="closeFeedPhoto()">✕</button>'
    +   '<img src="' + esc(big) + '" class="lb-img">'
    +   '<div class="lb-cap"><b>' + esc(h.who) + '</b> · ' + esc(h.date) + (h.workout ? ' · ' + esc(h.workout) : '') + '</div>'
    + '</div>';
  sh.classList.add('on');
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
        + '<div style="display:flex;gap:12px;align-items:center;cursor:pointer" onclick="openEquipLog(\'' + esc(e.name) + '\')">'
        +   (e.thumb ? '<img src="' + esc(e.thumb) + '" class="eqimg">' : '<div class="eqimg eqnoimg">🏋</div>')
        +   '<div style="flex:1"><b>' + esc(e.name) + '</b><br><span class="muted">' + esc(e.part) + ' · 동작 ' + (e.moves||[]).length + '개</span></div>'
        +   '<span style="color:var(--sub);font-size:20px">›</span>'
        + '</div>'
        + (moves ? '<div class="movetags">' + moves + '</div>' : '<p class="muted" style="margin:8px 0 0">동작이 없어요.</p>')
        + '<div class="row" style="gap:8px;margin-top:8px">'
        +   '<button class="softbtn" style="margin:0;flex:1" onclick="openEquipLog(\'' + esc(e.name) + '\')">📈 내 기록</button>'
        +   '<button class="softbtn" style="margin:0;flex:1" onclick="openMoveForm(\'' + e.id + '\')">＋ 동작 추가</button>'
        + '</div>'
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

/* 기구 1개로 한 내 기록 (날짜별) */
function openEquipLog(name){
  var sh = $('eqLogModal');
  if(!sh){ sh=document.createElement('div'); sh.id='eqLogModal'; sh.className='modalwrap'; document.body.appendChild(sh); }
  sh.innerHTML =
    '<div class="modalbg" onclick="closeEquipLog()"></div>'
    + '<div class="modalbox">'
    +   '<div class="modalhead"><b>📈 ' + esc(name) + ' · 내 기록</b><button class="xbtn" onclick="closeEquipLog()">✕</button></div>'
    +   '<div class="modalbody" id="eqLogBody"><p class="muted">불러오는 중…</p></div>'
    + '</div>';
  sh.classList.add('on');
  call('equipLog', name).then(function(logs){
    var body = $('eqLogBody'); if(!body) return;
    if(!logs || !logs.length){ body.innerHTML = '<p class="muted">아직 이 기구로 기록한 게 없어요.</p>'; return; }
    // 최고무게 한 줄 요약
    var top = 0; logs.forEach(function(l){ l.sets.forEach(function(s){ if((Number(s.weight)||0)>top) top=Number(s.weight)||0; }); });
    body.innerHTML = '<div class="savedline" style="margin-bottom:12px">🔥 최고 무게 ' + top + 'kg</div>'
      + logs.map(function(l){
        var sets = l.sets.map(function(s){ return (s.weight||0)+'kg×'+(s.reps||0); }).join(', ');
        return '<div class="eqlogrow"><div class="eqlogdate">' + esc(l.date) + (l.move?' · '+esc(l.move):'') + '</div>'
          + '<div class="eqlogsets">' + esc(sets) + '</div></div>';
      }).join('');
  }).catch(function(e){ var b=$('eqLogBody'); if(b) b.innerHTML='<p class="muted">오류: '+esc(e&&e.message||e)+'</p>'; });
}
function closeEquipLog(){ var sh=$('eqLogModal'); if(sh) sh.classList.remove('on'); }

/* ====================================================================
 * 운동 일지 — 달력 (부부 둘 다 색으로 표시) + 날짜 클릭 상세
 * ==================================================================== */
var LIST_SESS = [];               // 전체 세션 캐시
var CAL_YM = null;                // 보고 있는 달 {y, m(0-based)}
function renderList(){
  $('list').innerHTML = '<div class="card"><p class="muted">불러오는 중…</p></div>';
  call('listSessions', '').then(function(sessions){
    LIST_SESS = sessions || [];
    if(!CAL_YM){ var n=new Date(); CAL_YM={ y:n.getFullYear(), m:n.getMonth() }; }
    drawCalendar();
  }).catch(function(e){ $('list').innerHTML = '<div class="card"><p class="muted">오류: ' + esc(e&&e.message||e) + '</p></div>'; });
}
function calShift(delta){
  var d = new Date(CAL_YM.y, CAL_YM.m + delta, 1);
  CAL_YM = { y:d.getFullYear(), m:d.getMonth() };
  drawCalendar();
}
/* 그 사람 색 (첫번째=라임, 두번째=민트) */
function whoColor(who){ var i=PEOPLE.indexOf(who); return i===1 ? 'var(--ok)' : 'var(--main)'; }
function drawCalendar(){
  var y=CAL_YM.y, m=CAL_YM.m;
  var first=new Date(y,m,1), startDay=(first.getDay()+6)%7;  // 월요일 시작
  var daysInMonth=new Date(y,m+1,0).getDate();
  var z=function(n){return(n<10?'0':'')+n;};
  // 날짜별 작성자 모음
  var byDate={};
  LIST_SESS.forEach(function(s){
    var dt=String(s.date).slice(0,10);
    (byDate[dt]=byDate[dt]||{}); byDate[dt][s.who]=1;
  });
  var dows=['월','화','수','목','금','토','일'];
  var head='<div class="calgrid calhead">'+dows.map(function(d){return '<div>'+d+'</div>';}).join('')+'</div>';
  var cells='';
  for(var i=0;i<startDay;i++) cells+='<div class="calcell empty"></div>';
  var todayS=todayStr();
  for(var day=1;day<=daysInMonth;day++){
    var ds=y+'-'+z(m+1)+'-'+z(day);
    var whos=byDate[ds]?Object.keys(byDate[ds]):[];
    var dots=whos.map(function(w){return '<span class="caldot" style="background:'+whoColor(w)+'"></span>';}).join('');
    var cls='calcell'+(whos.length?' has':'')+(ds===todayS?' today':'');
    cells+='<div class="'+cls+'" '+(whos.length?'onclick="openDay(\''+ds+'\')"':'')+'>'
      +'<span class="caldaynum">'+day+'</span><div class="caldots">'+dots+'</div></div>';
  }
  var legend=PEOPLE.map(function(p){return '<span class="leg"><span class="caldot" style="background:'+whoColor(p)+'"></span>'+esc(p)+'</span>';}).join('');
  $('list').innerHTML =
    '<div class="card">'
    + '<div class="row" style="justify-content:space-between;align-items:center">'
    +   '<button class="chipbtn" style="flex:none;padding:10px 14px" onclick="calShift(-1)">‹</button>'
    +   '<b style="font-size:17px">'+y+'년 '+(m+1)+'월</b>'
    +   '<button class="chipbtn" style="flex:none;padding:10px 14px" onclick="calShift(1)">›</button>'
    + '</div>'
    + '<div class="row" style="gap:14px;margin:10px 2px 0">'+legend+'</div>'
    + head
    + '<div class="calgrid">'+cells+'</div>'
    + '<p class="muted" style="margin-top:10px">운동한 날을 누르면 그날 기록이 보여요.</p>'
    + '</div>';
}

/* 그날 상세 모달 */
function openDay(ds){
  var list = LIST_SESS.filter(function(s){ return String(s.date).slice(0,10)===ds; });
  var sh = $('dayModal');
  if(!sh){ sh=document.createElement('div'); sh.id='dayModal'; sh.className='modalwrap'; document.body.appendChild(sh); }
  sh.innerHTML =
    '<div class="modalbg" onclick="closeDay()"></div>'
    + '<div class="modalbox">'
    +   '<div class="modalhead"><b>📋 ' + esc(ds) + '</b><button class="xbtn" onclick="closeDay()">✕</button></div>'
    +   '<div class="modalbody">' + (list.length ? list.map(sessionDetail).join('') : '<p class="muted">기록이 없어요.</p>') + '</div>'
    + '</div>';
  sh.classList.add('on');
}
function closeDay(){ var sh=$('dayModal'); if(sh) sh.classList.remove('on'); }

function sessionDetail(s){
  var run = (s.running||[]).map(function(r){
    var parts = [];
    if(r.min!=='') parts.push(r.min+'분'); if(r.km!=='') parts.push(r.km+'km');
    if(r.incline!=='') parts.push('경사'+r.incline); if(r.speed!=='') parts.push(r.speed+'km/h'); if(r.kcal!=='') parts.push(r.kcal+'kcal');
    return '<div class="muted" style="margin:2px 0">🏃 ' + esc(parts.join(' · ')) + '</div>';
  }).join('');
  var wt = (s.weights||[]).map(function(w){
    var sets = (w.sets||[]).map(function(x){ return x.weight+'kg×'+x.reps; }).join(', ');
    var mv = w.move ? ' · ' + esc(w.move) : '';
    return '<div style="margin:3px 0">🏋 <b>' + esc(w.equip) + '</b>' + mv + ' <span class="muted">' + esc(sets) + '</span></div>';
  }).join('');
  return '<div class="daysess">'
    + '<div class="row" style="justify-content:space-between">'
    +   '<b style="color:'+whoColor(s.who)+'">' + esc(s.who) + '</b>'
    +   '<span class="muted">' + (s.workout ? esc(s.workout) : '') + '</span>'
    + '</div>'
    + (run || '')
    + (wt ? '<div style="margin-top:6px">' + wt + '</div>' : '')
    + (s.finishThumb ? '<img src="' + esc(s.finishThumb) + '" style="width:100%;max-width:240px;border-radius:12px;margin-top:8px">' : '')
    + '</div>';
}

/* ====================================================================
 * 발전 추이 — 그래프 + 공유 카드
 * ==================================================================== */
var TREND = null;         // { running:[], weights:[], people:[] }
var TREND_CHARTS = [];    // Chart 인스턴스 (다시 그릴 때 정리)
var TREND_EQUIP = '';     // 무게 추이에서 고른 기구/동작 키
var TREND_RANGE = 'month';// 기간: week | month | q(3달) | all

function renderTrend(){
  $('trend').innerHTML = '<div class="card"><p class="muted">불러오는 중…</p></div>';
  call('trendData').then(function(d){
    TREND = d || { running:[], weights:[], people:[] };
    drawTrend();
  }).catch(function(e){ $('trend').innerHTML = '<div class="card"><p class="muted">오류: ' + esc(e&&e.message||e) + '</p></div>'; });
}

/* 날짜 도우미 */
function weekAgo(n){ var d=new Date(); d.setDate(d.getDate()-n); return d.toISOString().slice(0,10); }
function ymd(s){ return String(s||'').slice(0,10); }

function rangeFrom(range){ return statFrom(range); }
/* 기간으로 필터한 데이터 */
function trendInRange(){
  var from = rangeFrom(TREND_RANGE);
  return {
    running: (TREND.running||[]).filter(function(r){ return ymd(r.date) >= from; }),
    weights: (TREND.weights||[]).filter(function(w){ return ymd(w.date) >= from; }),
    people: TREND.people||[],
  };
}
function trendRangeBtns(){
  var opts = [['today','오늘'],['week','1주'],['month','1달'],['all','전체']];
  return '<div class="seg" style="margin:14px 0 0">' + opts.map(function(o){
    return '<button class="chipbtn' + (TREND_RANGE===o[0]?' on':'') + '" onclick="TREND_RANGE=\'' + o[0] + '\';drawTrend()">' + o[1] + '</button>';
  }).join('') + '</div>';
}

function drawTrend(){
  var d = trendInRange();
  var stat = computeStat(TREND, TREND_RANGE);
  var equipKeys = equipKeyList(d.weights);
  if(equipKeys.indexOf(TREND_EQUIP) < 0) TREND_EQUIP = equipKeys[0] || '';

  $('trend').innerHTML =
    '<div class="card">'
    +   '<div class="row" style="justify-content:space-between;align-items:center">'
    +     '<h2 style="margin:0">성과 분석</h2>'
    +     '<button class="pillbtn" onclick="openShare()">📤 공유</button>'
    +   '</div>'
    +   trendRangeBtns()
    +   '<div class="statline">'
    +     statBox('운동', stat.sessions + '회') + statBox('런닝', stat.km + 'km') + statBox('총 세트', stat.sets + '세트')
    +   '</div>'
    +   '<div class="splitstat">'
    +     '<div class="ss"><span class="sslbl">상체</span><b>' + stat.upper.sets + '세트</b><span class="sskg">(' + addComma(stat.upper.kg) + 'kg)</span></div>'
    +     '<div class="ss"><span class="sslbl">하체</span><b>' + stat.lower.sets + '세트</b><span class="sskg">(' + addComma(stat.lower.kg) + 'kg)</span></div>'
    +   '</div>'
    + '</div>'

    + '<div class="card">'
    +   '<h2>🏋 무게 변화</h2>'
    +   (equipKeys.length
        ? '<select class="bigsel" onchange="TREND_EQUIP=this.value;drawTrend()">'
            + equipKeys.map(function(k){ return '<option value="' + esc(k) + '"' + (k===TREND_EQUIP?' selected':'') + '>' + esc(k) + '</option>'; }).join('')
          + '</select><div class="chartwrap tall"><canvas id="cWeight"></canvas></div>'
        : '<p class="muted">이 기간엔 웨이트 기록이 없어요.</p>')
    + '</div>'

    + '<div class="card">'
    +   '<h2>🏃 런닝 변화</h2>'
    +   (d.running.length ? '<div class="chartwrap tall"><canvas id="cRun"></canvas></div>'
                         : '<p class="muted">이 기간엔 런닝 기록이 없어요.</p>')
    + '</div>'

    + '<div class="card">'
    +   '<h2>📅 주간 운동 횟수</h2>'
    +   '<div class="chartwrap"><canvas id="cWeek"></canvas></div>'
    + '</div>';

  if(!window.Chart){ return; }
  TREND_CHARTS.forEach(function(c){ try{c.destroy();}catch(e){} }); TREND_CHARTS = [];
  if(equipKeys.length) drawWeightChart(d);
  if(d.running.length) drawRunChart(d);
  drawWeekChart();
}

function statBox(label, val){
  return '<div class="statbox"><div class="statval">' + esc(val) + '</div><div class="statlbl">' + esc(label) + '</div></div>';
}
function fmt(n){ n=Number(n)||0; return n>=1000 ? (Math.round(n/100)/10)+'k' : String(Math.round(n)); }
function addComma(n){ return String(Math.round(Number(n)||0)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

/* 기구/동작 키 목록 (무게 데이터 있는 것만) */
function equipKeyList(weights){
  var keys = {};
  (weights||[]).forEach(function(w){ if(w.weight!=='' && w.weight!=null){ var k=w.equip + (w.move?' · '+w.move:''); keys[k]=1; } });
  return Object.keys(keys);
}

/* 기간 시작일 · range: 'today' | 'week' | 'month' | 'q' | 'all' */
function statFrom(range){
  if(range==='today') return todayStr();
  if(range==='week') return weekAgo(7);
  if(range==='month') return weekAgo(30);
  if(range==='q') return weekAgo(90);
  return '0000';
}
/* 통계 집계 — 세트수/총무게를 상체·하체로 분리 */
function computeStat(d, range){
  var from = statFrom(range);
  var runs = (d.running||[]).filter(function(r){ return ymd(r.date) >= from; });
  var wts = (d.weights||[]).filter(function(w){ return ymd(w.date) >= from; });
  var sess = {}; runs.concat(wts).forEach(function(x){ sess[x.date+'|'+x.who]=1; });
  var km = 0; runs.forEach(function(r){ km += Number(r.km)||0; });
  var kcal = 0; runs.forEach(function(r){ kcal += Number(r.kcal)||0; });
  // 상체/하체 세트수 + 총무게(무게×횟수 합)
  var g = { '상체':{sets:0,kg:0}, '하체':{sets:0,kg:0} };
  var best = {};
  wts.forEach(function(w){
    var grp = FB.partGroup(w.part); if(!g[grp]) g[grp]={sets:0,kg:0};
    g[grp].sets += 1;
    g[grp].kg += (Number(w.weight)||0)*(Number(w.reps)||0);
    var k = w.equip + (w.move?' · '+w.move:'');
    if(!best[k] || (Number(w.weight)||0) > best[k]) best[k] = Number(w.weight)||0;
  });
  var bestArr = Object.keys(best).map(function(k){ return {k:k, v:best[k]}; }).sort(function(a,b){ return b.v-a.v; }).slice(0,2);
  var byWho = {}; Object.keys(sess).forEach(function(key){ var who=key.split('|')[1]; byWho[who]=(byWho[who]||0)+1; });
  var totalSets = g['상체'].sets + g['하체'].sets;
  return { sessions:Object.keys(sess).length, km:Math.round(km*10)/10, kcal:Math.round(kcal),
    sets:totalSets, upper:{ sets:g['상체'].sets, kg:Math.round(g['상체'].kg) }, lower:{ sets:g['하체'].sets, kg:Math.round(g['하체'].kg) },
    best:bestArr, byWho:byWho };
}

var CHART_FONT = { family:'Gothic A1', size:12, weight:'600' };
function mmdd(s){ return String(s||'').slice(5); }   // 2026-10-24 → 10-24
/* 캔버스 세로 그라데이션 채움 (위 진함 → 아래 투명) */
function gradFill(canvas, color){
  try{
    var c = canvas.getContext('2d');
    var g = c.createLinearGradient(0,0,0,300);
    g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
    return g;
  }catch(e){ return color; }
}
function chartBase(){
  return { responsive:true, maintainAspectRatio:false,
    interaction:{ mode:'index', intersect:false },
    plugins:{ legend:{ labels:{ color:'#cfd6e2', font:CHART_FONT, usePointStyle:true, pointStyle:'circle', padding:16 } },
      tooltip:{ backgroundColor:'#20252f', borderColor:'#353b47', borderWidth:1, titleColor:'#eef1f5', bodyColor:'#cfd6e2', padding:12, cornerRadius:10 } },
    scales:{ x:{ ticks:{ color:'#8a93a4', font:CHART_FONT, maxRotation:0, autoSkip:true, maxTicksLimit:7 }, grid:{ display:false } },
             y:{ ticks:{ color:'#8a93a4', font:CHART_FONT }, grid:{ color:'rgba(255,255,255,.05)' }, border:{ display:false } } } };
}

function drawWeightChart(d){
  // 고른 기구/동작의 날짜별 최고무게
  var byDate = {};
  d.weights.forEach(function(w){
    var k = w.equip + (w.move?' · '+w.move:'');
    if(k!==TREND_EQUIP || w.weight===''||w.weight==null) return;
    var dt = ymd(w.date), v = Number(w.weight)||0;
    if(!byDate[dt] || v>byDate[dt]) byDate[dt]=v;
  });
  var dates = Object.keys(byDate).sort();
  var ctx = $('cWeight'); if(!ctx) return;
  TREND_CHARTS.push(new Chart(ctx, { type:'line',
    data:{ labels:dates.map(mmdd), datasets:[{ label:TREND_EQUIP+' 최고무게(kg)', data:dates.map(function(d){return byDate[d];}),
      borderColor:'#c6f432', backgroundColor:gradFill(ctx,'rgba(198,244,50,.35)'), borderWidth:3, tension:.35, fill:true,
      pointRadius:5, pointHoverRadius:7, pointBackgroundColor:'#c6f432', pointBorderColor:'#13161d', pointBorderWidth:2 }] },
    options:chartBase() }));
}
function drawRunChart(d){
  var byDate = {};
  d.running.forEach(function(r){ var dt=ymd(r.date); byDate[dt]=byDate[dt]||{km:0,kcal:0}; byDate[dt].km+=Number(r.km)||0; byDate[dt].kcal+=Number(r.kcal)||0; });
  var dates = Object.keys(byDate).sort();
  var ctx = $('cRun'); if(!ctx) return;
  TREND_CHARTS.push(new Chart(ctx, { type:'line',
    data:{ labels:dates.map(mmdd), datasets:[
      { label:'거리(km)', data:dates.map(function(d){return Math.round(byDate[d].km*10)/10;}), borderColor:'#49e39b', backgroundColor:gradFill(ctx,'rgba(73,227,155,.3)'), borderWidth:3, tension:.35, fill:true, pointRadius:4, pointHoverRadius:6, pointBackgroundColor:'#49e39b', yAxisID:'y' },
      { label:'칼로리(kcal)', data:dates.map(function(d){return Math.round(byDate[d].kcal);}), borderColor:'#ff5a5f', borderWidth:3, tension:.35, pointRadius:4, pointBackgroundColor:'#ff5a5f', yAxisID:'y1' }
    ]},
    options:Object.assign(chartBase(), { scales:{
      x:{ ticks:{color:'#8a93a4',font:CHART_FONT,maxRotation:0,autoSkip:true,maxTicksLimit:7}, grid:{display:false} },
      y:{ position:'left', ticks:{color:'#49e39b',font:CHART_FONT}, grid:{color:'rgba(255,255,255,.05)'}, border:{display:false} },
      y1:{ position:'right', ticks:{color:'#ff5a5f',font:CHART_FONT}, grid:{drawOnChartArea:false}, border:{display:false} } } }) }));
}
function drawWeekChart(){
  // 최근 8주, 사람별 운동 횟수(세션=날짜+사람)
  var people = TREND.people||[];
  var weeks = []; for(var i=7;i>=0;i--){ weeks.push(weekStart(i)); }
  var sess = {}; (TREND.running||[]).concat(TREND.weights||[]).forEach(function(x){ sess[x.date+'|'+x.who]=x; });
  var counts = {}; people.forEach(function(p){ counts[p]=weeks.map(function(){return 0;}); });
  Object.keys(sess).forEach(function(key){
    var parts=key.split('|'), dt=parts[0], who=parts[1];
    var wi = weeks.indexOf(weekStartOf(dt)); if(wi>=0 && counts[who]) counts[who][wi]++;
  });
  var colors = ['#c6f432','#49e39b'];
  var ctx = $('cWeek'); if(!ctx) return;
  TREND_CHARTS.push(new Chart(ctx, { type:'bar',
    data:{ labels:weeks.map(function(w){return w.slice(5);}), datasets:people.map(function(p,i){
      return { label:p, data:counts[p], backgroundColor:colors[i%colors.length] }; }) },
    options:chartBase() }));
}
function weekStart(nAgo){ var d=new Date(); d.setDate(d.getDate()-nAgo*7); d.setDate(d.getDate()-((d.getDay()+6)%7)); return d.toISOString().slice(0,10); }
function weekStartOf(dateStr){ var d=new Date(dateStr+'T00:00:00'); d.setDate(d.getDate()-((d.getDay()+6)%7)); return d.toISOString().slice(0,10); }

/* ====================================================================
 * 공유 카드 (나이키 런닝 스타일 · 9:16 · 사진 위 통계)
 * ==================================================================== */
var SHARE_RANGE = 'week';   // week | month | all
var SHARE_PHOTO = null;     // 배경 사진 base64 (선택)
function openShare(){
  SHARE_RANGE='week'; SHARE_PHOTO=null;
  var sh = $('shareModal');
  if(!sh){ sh=document.createElement('div'); sh.id='shareModal'; sh.className='modalwrap'; document.body.appendChild(sh); }
  sh.innerHTML =
    '<div class="modalbg" onclick="closeShare()"></div>'
    + '<div class="modalbox">'
    +   '<div class="modalhead"><b>📤 운동 카드 공유</b><button class="xbtn" onclick="closeShare()">✕</button></div>'
    +   '<div class="modalbody">'
    +     '<div class="seg" id="shareRange">'
    +       rangeBtn('today','오늘') + rangeBtn('week','이번 주') + rangeBtn('month','이번 달') + rangeBtn('all','전체')
    +     '</div>'
    +     '<div class="picker"><div class="picklabel">배경 사진 (선택 안 하면 기본 배경)</div>'
    +       '<button class="photobtn" onclick="openSharePhoto()">📷 배경 사진 넣기</button>'
    +       '<input type="file" accept="image/*" id="file_share" class="hiddenfile">'
    +       '<input type="file" accept="image/*" capture="environment" id="cam_share" class="hiddenfile">'
    +     '</div>'
    +     '<div class="sharepreview"><canvas id="shareCanvas"></canvas></div>'
    +     '<button class="button accent" style="width:100%" onclick="downloadShare()">이미지로 저장</button>'
    +     '<p class="muted" style="text-align:center;margin-top:8px">저장한 이미지를 인스타 스토리에 올려보세요 💪</p>'
    +   '</div>'
    + '</div>';
  sh.classList.add('on');
  wireSharePhoto();
  renderShareCard();
}
function rangeBtn(v,label){ return '<button class="button ' + (SHARE_RANGE===v?'accent':'ghost') + '" style="flex:1;padding:12px 4px;font-size:13px" onclick="SHARE_RANGE=\'' + v + '\';refreshShareSeg();renderShareCard()">' + esc(label) + '</button>'; }
function refreshShareSeg(){ $('shareRange').innerHTML = rangeBtn('today','오늘')+rangeBtn('week','이번 주')+rangeBtn('month','이번 달')+rangeBtn('all','전체'); }
function closeShare(){ var sh=$('shareModal'); if(sh) sh.classList.remove('on'); SHARE_PHOTO=null; }
function openSharePhoto(){ openPhotoSheetFor('share'); }
function wireSharePhoto(){
  ['file_share','cam_share'].forEach(function(id){
    var input=$(id); if(!input) return;
    input.onchange=function(){ var f=input.files&&input.files[0]; if(!f) return;
      var rd=new FileReader(); rd.onload=function(){ SHARE_PHOTO={data:rd.result}; renderShareCard(); }; rd.readAsDataURL(f); };
  });
}
/* 공유 모달용 사진 시트 (앨범/카메라) */
function openPhotoSheetFor(key){
  var sh=$('photoSheet');
  if(!sh){ sh=document.createElement('div'); sh.id='photoSheet'; sh.className='sheetwrap'; document.body.appendChild(sh); }
  sh.innerHTML='<div class="sheetbg" onclick="closePhotoSheet()"></div>'
    + '<div class="sheetbox"><div class="sheettitle">배경 사진</div>'
    + '<button class="sheetitem" onclick="pickFile(\'' + key + '\',true)">📸 카메라로 촬영</button>'
    + '<button class="sheetitem" onclick="pickFile(\'' + key + '\',false)">🏞️ 앨범에서 선택</button>'
    + '<button class="sheetitem cancel" onclick="closePhotoSheet()">취소</button></div>';
  sh.classList.add('on');
}

/* 9:16 카드를 캔버스에 그림 (미리보기 = 저장과 동일) */
function renderShareCard(){
  var cv = $('shareCanvas'); if(!cv) return;
  var W=1080, H=1920; cv.width=W; cv.height=H;
  var ctx = cv.getContext('2d');
  var s = computeStat(TREND, SHARE_RANGE);
  var title = SHARE_RANGE==='today' ? '오늘' : SHARE_RANGE==='week' ? '이번 주' : SHARE_RANGE==='month' ? '이번 달' : '전체 기록';

  function paint(bgImg){
    // 배경
    if(bgImg){
      // cover 맞춤
      var ir=bgImg.width/bgImg.height, cr=W/H, sw,sh2,sx,sy;
      if(ir>cr){ sh2=bgImg.height; sw=sh2*cr; sx=(bgImg.width-sw)/2; sy=0; }
      else{ sw=bgImg.width; sh2=sw/cr; sx=0; sy=(bgImg.height-sh2)/2; }
      ctx.drawImage(bgImg, sx,sy,sw,sh2, 0,0,W,H);
      ctx.fillStyle='rgba(15,17,21,.55)'; ctx.fillRect(0,0,W,H);           // 어둡게 덮어 글씨 잘 보이게
    } else {
      var g=ctx.createLinearGradient(0,0,W,H); g.addColorStop(0,'#13161d'); g.addColorStop(1,'#0c0e12');
      ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
      // 라임 글로우
      var rg=ctx.createRadialGradient(W*0.8,H*0.12,0,W*0.8,H*0.12,W*0.7);
      rg.addColorStop(0,'rgba(198,244,50,.18)'); rg.addColorStop(1,'rgba(198,244,50,0)');
      ctx.fillStyle=rg; ctx.fillRect(0,0,W,H);
    }
    ctx.textAlign='left';
    var pad=90;
    // 상단 브랜드
    ctx.fillStyle='#c6f432'; ctx.font='800 40px "Gothic A1",sans-serif';
    ctx.fillText('● 운동 레포트', pad, 150);
    ctx.fillStyle='#eef1f5'; ctx.font='900 92px "Gothic A1",sans-serif';
    ctx.fillText(title + ' 💪', pad, 280);
    ctx.fillStyle='#9aa3b2'; ctx.font='500 38px "Gothic A1",sans-serif';
    ctx.fillText(ME ? ME.name + '님의 운동 요약' : '운동 요약', pad, 345);

    // 큰 숫자 3개
    var y=560;
    bigStat(ctx, pad, y, s.sessions, '회', '운동 횟수');
    bigStat(ctx, pad, y+260, s.km, 'km', '런닝 거리');
    bigStat(ctx, pad, y+520, s.sets, '세트', '총 세트 (상체 ' + s.upper.sets + ' · 하체 ' + s.lower.sets + ')');

    // 최고기록
    var by=560+780;
    if(s.best && s.best.length){
      ctx.fillStyle='#c6f432'; ctx.font='800 44px "Gothic A1",sans-serif';
      ctx.fillText('🔥 최고 기록', pad, by);
      ctx.fillStyle='#eef1f5'; ctx.font='700 46px "Gothic A1",sans-serif';
      s.best.forEach(function(b,i){ ctx.fillText(b.k + '  ' + b.v + 'kg', pad, by+70+i*68); });
    }

    // 하단 부부 비교
    var wy=H-230;
    var people=Object.keys(s.byWho);
    if(people.length){
      ctx.fillStyle='#9aa3b2'; ctx.font='600 34px "Gothic A1",sans-serif';
      var txt=people.map(function(p){ return p+' '+s.byWho[p]+'회'; }).join('   ·   ');
      ctx.fillText('👫 ' + txt, pad, wy);
    }
    // 날짜
    ctx.fillStyle='#5b6472'; ctx.font='500 30px "Gothic A1",sans-serif';
    ctx.fillText(new Date().toISOString().slice(0,10), pad, H-110);
  }

  if(SHARE_PHOTO && SHARE_PHOTO.data){
    var im=new Image(); im.onload=function(){ paint(im); }; im.onerror=function(){ paint(null); }; im.src=SHARE_PHOTO.data;
  } else { paint(null); }
}
function bigStat(ctx, x, y, val, unit, label){
  ctx.fillStyle='#eef1f5'; ctx.font='900 150px "Gothic A1",sans-serif';
  ctx.fillText(String(val), x, y);
  var w = ctx.measureText(String(val)).width;
  ctx.fillStyle='#c6f432'; ctx.font='800 60px "Gothic A1",sans-serif';
  ctx.fillText(unit, x+w+16, y);
  ctx.fillStyle='#9aa3b2'; ctx.font='600 40px "Gothic A1",sans-serif';
  ctx.fillText(label, x+4, y+58);
}
function downloadShare(){
  var cv=$('shareCanvas'); if(!cv) return;
  var a=document.createElement('a');
  a.href=cv.toDataURL('image/jpeg',0.92);
  a.download='운동카드_' + new Date().toISOString().slice(0,10) + '.jpg';
  document.body.appendChild(a); a.click(); a.remove();
  toast('이미지를 저장했어요. 스토리에 올려보세요 💪');
}

/* ====================================================================
 * 부부 오운완 콜라주 카드 (홈 ⚔️) — 어제 둘의 오운완을 한 장에
 *  둘 다 했으면 사진 2장 / 한 명이 쉬면 그 칸은 놀리는 멘트
 * ==================================================================== */
var VS_DATE = '';     // 보고 있는 날짜 (기본: 어제)
var VS_DATA = null;   // [{who,state,thumb,workout}, ...]
function yesterdayStr(){ var d=new Date(); d.setDate(d.getDate()-1); return d.toISOString().slice(0,10); }

function openVersus(){
  VS_DATE = yesterdayStr();
  loadVs();
}
function loadVs(){
  var sh = $('vsModal');
  if(!sh){ sh=document.createElement('div'); sh.id='vsModal'; sh.className='modalwrap'; document.body.appendChild(sh); }
  sh.innerHTML =
    '<div class="modalbg" onclick="closeVs()"></div>'
    + '<div class="modalbox">'
    +   '<div class="modalhead"><b>👫 우리의 오운완</b><button class="xbtn" onclick="closeVs()">✕</button></div>'
    +   '<div class="modalbody">'
    +     '<div class="row" style="justify-content:space-between;align-items:center;margin-bottom:10px">'
    +       '<button class="chipbtn" style="flex:none;padding:10px 14px" onclick="vsShift(-1)">‹ 전날</button>'
    +       '<b id="vsDateLbl">' + esc(VS_DATE) + '</b>'
    +       '<button class="chipbtn" style="flex:none;padding:10px 14px" onclick="vsShift(1)">다음날 ›</button>'
    +     '</div>'
    +     '<div class="sharepreview"><canvas id="vsCanvas"></canvas></div>'
    +     '<button class="button accent" style="width:100%" onclick="downloadVs()">이미지로 저장</button>'
    +     '<p class="muted" style="text-align:center;margin-top:8px">어제 둘의 오운완을 한 장으로! 스토리 각 📸</p>'
    +   '</div>'
    + '</div>';
  sh.classList.add('on');
  var lbl=$('vsDateLbl'); if(lbl) lbl.textContent=VS_DATE;
  cover(true,'불러오는 중…');
  call('dayFinish', VS_DATE).then(function(list){ cover(false); VS_DATA=list||[]; renderVsCard(); })
    .catch(function(e){ cover(false); toast('오류: '+(e&&e.message||e)); });
}
function vsShift(delta){
  var d=new Date(VS_DATE+'T00:00:00'); d.setDate(d.getDate()+delta);
  var ns=d.toISOString().slice(0,10);
  if(ns > new Date().toISOString().slice(0,10)) { toast('아직 오지 않은 날이에요'); return; }
  VS_DATE=ns; var lbl=$('vsDateLbl'); if(lbl) lbl.textContent=VS_DATE;
  cover(true,'불러오는 중…');
  call('dayFinish', VS_DATE).then(function(list){ cover(false); VS_DATA=list||[]; renderVsCard(); })
    .catch(function(e){ cover(false); toast('오류: '+(e&&e.message||e)); });
}
function closeVs(){ var sh=$('vsModal'); if(sh) sh.classList.remove('on'); }

/* 쉰 사람 놀리는 멘트 (콜라주용) */
var REST_MSGS = [
  { emo:'😴', line:'어제 쉬었나봐요?' },
  { emo:'🐷', line:'돼지런 하는 날' },
  { emo:'🛋️', line:'소파와 한 몸' },
  { emo:'🍗', line:'운동 대신 치킨?' },
  { emo:'🦥', line:'게으름 챔피언' }
];

function renderVsCard(){
  var cv=$('vsCanvas'); if(!cv || !VS_DATA) return;
  var W=1080,H=1920; cv.width=W; cv.height=H;
  var ctx=cv.getContext('2d');
  var A = VS_DATA[0] || {who:'남편',state:'rest'};
  var B = VS_DATA[1] || {who:'아내',state:'rest'};

  // 배경
  var g=ctx.createLinearGradient(0,0,W,H); g.addColorStop(0,'#13161d'); g.addColorStop(1,'#0c0e12');
  ctx.fillStyle=g; ctx.fillRect(0,0,W,H);

  // 헤더
  ctx.textAlign='center';
  ctx.fillStyle='#c6f432'; ctx.font='800 40px "Gothic A1",sans-serif';
  ctx.fillText('● 운동 레포트', W/2, 120);
  ctx.fillStyle='#eef1f5'; ctx.font='900 82px "Gothic A1",sans-serif';
  ctx.fillText('우리의 오운완 👫', W/2, 220);
  ctx.fillStyle='#8a93a4'; ctx.font='600 36px "Gothic A1",sans-serif';
  ctx.fillText(VS_DATE, W/2, 280);

  // 두 칸 영역 (위/아래)
  var top=340, cellH=640, gap=40;
  var cells=[{d:A, y:top}, {d:B, y:top+cellH+gap}];
  var pending=0, finish=function(){ pending--; if(pending<=0) drawVerdict(); };
  var margin=70, cw=W-margin*2;

  function drawVerdict(){
    var aOk=A.state!=='rest', bOk=B.state!=='rest';
    var wy=H-130, msg;
    if(aOk&&bOk) msg='오늘도 함께 💪❤️';
    else if(aOk&&!bOk) msg='승자: ' + A.who + ' 👑  ·  ' + B.who + '은 쉼 😏';
    else if(!aOk&&bOk) msg='승자: ' + B.who + ' 👑  ·  ' + A.who + '은 쉼 😏';
    else msg='둘 다 쉰 날… 🛋️';
    ctx.textAlign='center'; ctx.fillStyle='#eef1f5'; ctx.font='800 48px "Gothic A1",sans-serif';
    ctx.fillText(msg, W/2, wy);
    ctx.textAlign='left';
  }

  cells.forEach(function(c){
    var x=margin, y=c.y, d=c.d, r=32;
    // 칸 테두리/배경
    roundRect(ctx, x, y, cw, cellH, r);
    ctx.fillStyle='#1a1e27'; ctx.fill();
    if(d.state==='photo' && d.thumb){
      pending++;
      var im=new Image(); im.crossOrigin='anonymous';
      im.onload=function(){
        ctx.save(); roundRect(ctx,x,y,cw,cellH,r); ctx.clip();
        // cover
        var ir=im.width/im.height, cr=cw/cellH, sw,sh2,sx,sy;
        if(ir>cr){ sh2=im.height; sw=sh2*cr; sx=(im.width-sw)/2; sy=0; } else { sw=im.width; sh2=sw/cr; sx=0; sy=(im.height-sh2)/2; }
        ctx.drawImage(im, sx,sy,sw,sh2, x,y,cw,cellH);
        // 하단 그라데이션 + 이름
        var gg=ctx.createLinearGradient(0,y+cellH-200,0,y+cellH); gg.addColorStop(0,'rgba(0,0,0,0)'); gg.addColorStop(1,'rgba(0,0,0,.75)');
        ctx.fillStyle=gg; ctx.fillRect(x,y+cellH-200,cw,200);
        ctx.fillStyle='#fff'; ctx.font='800 52px "Gothic A1",sans-serif'; ctx.textAlign='left';
        ctx.fillText(d.who + (d.workout?'  ·  '+d.workout:''), x+34, y+cellH-40);
        ctx.restore();
        finish();
      };
      im.onerror=function(){ // 사진 못 불러오면 "완료" 칸으로
        drawDoneCell(ctx,x,y,cw,cellH,d); finish();
      };
      im.src = String(d.thumb).replace(/sz=w\d+/, 'sz=w800');
    } else if(d.state==='nophoto'){
      drawDoneCell(ctx,x,y,cw,cellH,d);
    } else {
      // 쉼 → 놀리는 멘트
      var m = REST_MSGS[Math.floor(Math.random()*REST_MSGS.length)];
      ctx.textAlign='center';
      ctx.font='140px "Gothic A1",sans-serif'; ctx.fillText(m.emo, x+cw/2, y+cellH/2-20);
      ctx.fillStyle='#eef1f5'; ctx.font='800 54px "Gothic A1",sans-serif'; ctx.fillText(m.line, x+cw/2, y+cellH/2+90);
      ctx.fillStyle='#8a93a4'; ctx.font='700 44px "Gothic A1",sans-serif'; ctx.fillText(d.who, x+cw/2, y+cellH-50);
      ctx.textAlign='left';
    }
  });
  if(pending===0) drawVerdict();
}
/* 운동은 했지만 사진 없는 칸 */
function drawDoneCell(ctx,x,y,cw,cellH,d){
  ctx.textAlign='center';
  ctx.font='130px "Gothic A1",sans-serif'; ctx.fillText('💪', x+cw/2, y+cellH/2-10);
  ctx.fillStyle='#c6f432'; ctx.font='800 54px "Gothic A1",sans-serif'; ctx.fillText('운동 완료!', x+cw/2, y+cellH/2+80);
  ctx.fillStyle='#8a93a4'; ctx.font='700 44px "Gothic A1",sans-serif'; ctx.fillText(d.who + (d.workout?'  ·  '+d.workout:''), x+cw/2, y+cellH-50);
  ctx.textAlign='left';
}
function roundRect(ctx,x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
}
function downloadVs(){
  var cv=$('vsCanvas'); if(!cv) return;
  try{
    var a=document.createElement('a');
    a.href=cv.toDataURL('image/jpeg',0.92);
    a.download='우리의오운완_' + VS_DATE + '.jpg';
    document.body.appendChild(a); a.click(); a.remove();
    toast('저장 완료! 스토리에 올려보세요 📸');
  }catch(e){ toast('사진 보안 때문에 저장이 막혔어요. 캡처로 저장해 주세요.'); }
}
