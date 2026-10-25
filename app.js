/* 운동 레포트 · 화면 동작 (클라이언트)
 * 데이터는 FB.call('기능', ...) → Firestore 직접 (빠름). 사진만 Apps Script 중계.
 */
var ME = null;        // { email, name }
var WORKOUTS = [];
var PARTS = [];
var PEOPLE = [];
var CUR_TAB = 'home';
var GEAR = [];
var DRAFT = null;       // 지금 입력 중인 기구 1개
var PHOTOBUF = {};      // 기구/동작 사진 임시버퍼 (eq, mv) — 기록하기 오운완은 LOG.fin 사용
var PICK_STEP = '';
var PICK_EQUIP = null;
var OPEN = '';          // 펼친 폼: 'run' | 'weight' | ''
/* 기록하기 전체를 담는 로컬 임시 상태 (localStorage에 저장 → 새로고침·이탈 복원) */
var LOG = null;         // { date, workout, running:{...}|null, weights:[...], fin:{data,thumbData}|null, finText }
var LOG_KEY = 'workoutDraft';

/* ---------- 공통 도구 ---------- */
function $(id){ return document.getElementById(id); }
function esc(v){ return String(v==null?'':v).replace(/[&<>"']/g, function(c){
  return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function toast(msg){ var t=$('toast'); t.textContent=msg; t.style.display='block';
  clearTimeout(toast._t); toast._t=setTimeout(function(){ t.style.display='none'; }, 2600); }
function cover(on, msg){
  var c=$('cover');
  // 단순 로딩(스피너+메시지)
  var s=$('loadSimple'), cl=$('loadChecklist');
  if(s) s.hidden=false; if(cl) cl.hidden=true;
  if(msg) $('loadMsg').textContent=msg;
  c.classList.toggle('on', !!on);
}

/* ---------- 체크리스트형 로딩 (항목 옆 % → 완료 시 ✓) ---------- */
var LC_STEPS = [], LC_CUR = '', LC_TIMER = null;
function loadSteps(steps, firstKey){
  LC_STEPS = steps.map(function(s){ return { k:s.k, t:s.t, _done:false, _pct:0 }; });
  $('loadSimple').hidden=true; $('loadChecklist').hidden=false;
  $('cover').classList.add('on');
  setCur(firstKey || (LC_STEPS[0]&&LC_STEPS[0].k) || '');
  renderLoadList();
}
function setCur(key){
  if(LC_TIMER){ clearInterval(LC_TIMER); LC_TIMER=null; }
  LC_CUR = key || '';
  // 현재 단계 % 를 천천히 90까지 올림 (진행 중인 느낌)
  if(LC_CUR){
    LC_TIMER = setInterval(function(){
      var st = LC_STEPS.filter(function(s){return s.k===LC_CUR;})[0];
      if(!st){ return; }
      if(st._pct < 90){ st._pct += Math.max(2, Math.round((90-st._pct)/6)); updatePct(st); }
    }, 180);
  }
}
function updatePct(st){
  var el = document.getElementById('lc_'+st.k+'_p');
  if(el) el.textContent = Math.min(99, st._pct) + '%';
}
function renderLoadList(){
  $('lcList').innerHTML = LC_STEPS.map(function(st){
    var isCur = st.k===LC_CUR && !st._done;
    var right = st._done ? ic('check-circle')
      : isCur ? '<span class="lc-p" id="lc_'+st.k+'_p">'+Math.min(99,st._pct)+'%</span>'
      : ic('circle');
    return '<li class="' + (st._done?'done':isCur?'cur':'wait') + '"><span class="lc-t">' + esc(st.t) + '</span>' + right + '</li>';
  }).join('');
  icons();
}
/* 현재 단계 완료(✓) 처리하고 다음(nextKey)로 */
function loadStep(nextKey){
  LC_STEPS.forEach(function(s){ if(s.k===LC_CUR){ s._done=true; s._pct=100; } });
  setCur(nextKey || '');
  renderLoadList();
}
function loadDone(){
  if(LC_TIMER){ clearInterval(LC_TIMER); LC_TIMER=null; }
  LC_STEPS.forEach(function(s){ s._done=true; }); LC_CUR='';
  renderLoadList();
  setTimeout(function(){ $('cover').classList.remove('on'); }, 400);
}
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
    PEOPLE = FB.people() || [];   // 저장된 표시 이름 반영
    $('loginView').hidden = true;
    $('appView').hidden = false;
    $('identity').innerHTML = '<b>' + esc(ME.name) + '</b><br>' + esc(ME.email);
    GEAR = [];   // 캐시 초기화
    switchTab('home');
    icons();   // 메뉴 라인 아이콘 그리기
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
  if(tab === 'home')  renderHome();
  else if(tab === 'log')   renderLog();
  else if(tab === 'equip') renderEquip();
  else if(tab === 'list')  renderList();
  else if(tab === 'trend') renderTrend();
  icons();
}
/* Lucide 라인 아이콘 갱신 (렌더 후 호출) */
function icons(){ if(window.lucide) try{ lucide.createIcons(); }catch(e){} }
function ic(name){ return '<i data-lucide="' + name + '"></i>'; }

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
    +   '<h2>' + ic('camera') + ' 우리의 최근 오운완</h2>'
    +   '<div id="feedGrid" class="feedgrid"><p class="muted">불러오는 중…</p></div>'
    + '</div>'
    + '<div class="card">'
    +   '<div class="row" style="gap:10px">'
    +     '<button class="button accent" style="flex:2" onclick="switchTab(\'log\')">' + ic('plus') + ' 오늘 운동 시작</button>'
    +     '<button class="button ghost" style="flex:1" onclick="openVersus()">' + ic('swords') + ' 대결</button>'
    +   '</div>'
    + '</div>'
    + '<div class="card fbcard" id="fbCard"><div class="muted">지난 운동 분석 중…</div></div>';
  // 피드 로드
  call('latestFinish').then(function(list){
    FEED = list || [];
    renderFeed();
  }).catch(function(e){ var g=$('feedGrid'); if(g) g.innerHTML='<p class="muted">피드 오류: '+esc(e&&e.message||e)+'</p>'; });
  // 비교 피드백 로드
  call('lastFeedback').then(function(f){
    var el=$('fbCard'); if(!el) return;
    el.innerHTML = '<div class="fbhead">' + ic('sparkles') + ' 지난 운동 피드백</div><div class="fbline">' + feedbackText(f) + '</div>';
    icons();
  }).catch(function(){ var el=$('fbCard'); if(el) el.remove(); });
}
/* 핵심 수치만 라임 녹색(.hl)으로 강조한 피드백 문구 */
function hl(v){ return '<span class="hl">' + esc(v) + '</span>'; }
function feedbackText(f){
  if(!f || f.type==='none') return '아직 기록이 없어요. 오늘 첫 운동을 남겨봐요 💪';
  var w = f.workout ? f.workout + '날' : '지난 운동';
  if(f.type==='first') return '첫 ' + esc(w) + ' 기록 완료! 런닝 ' + hl(f.km+'km') + ' · ' + hl(f.sets+'세트') + ' 💪';
  if(f.type==='weight') return '지난 ' + esc(w) + '보다 ' + esc(f.equip) + ' ' + hl(f.inc+'kg') + ' 늘었어요! (지금 ' + hl(f.now+'kg') + ') 🔥';
  if(f.type==='run') return '지난 ' + esc(w) + '보다 런닝 ' + hl(f.inc+'km') + ' 더 달렸어요! (' + hl(f.now+'km') + ') 👍';
  if(f.type==='sets') return '지난 ' + esc(w) + '보다 ' + hl(f.inc+'세트') + ' 더 했어요! (총 ' + hl(f.now+'세트') + ') 💪';
  return '지난 ' + esc(w) + '만큼 꾸준히 했어요! 이 페이스 유지해요 👏';
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
    var cal = '<button class="calbtn" title="지난 오운완 보기" onclick="event.stopPropagation();openFinishHistory(\'' + esc(f.who) + '\')">' + ic('calendar') + '</button>';
    if(f.hasPhoto){
      var badge = f.type==='video' ? '<span class="playbadge">▶</span>' : '';
      return '<div class="feedcard">'
        + '<div class="feedclick" style="position:relative" onclick="openFeedPhoto(' + i + ')"><img src="' + esc(f.thumb) + '" class="feedimg">' + badge + '</div>'
        + '<div class="feedcap"><b>' + esc(f.who) + '</b>' + cal + '<span>' + esc(f.when || '어제') + ' · ' + esc(f.date) + (f.workout ? ' · ' + esc(f.workout) : '') + '</span></div>'
        + '</div>';
    }
    var c = offComment(f);
    var since = f.hasAny ? ('마지막 운동 ' + f.daysOff + '일 전') : '아직 기록 없음';
    return '<div class="feedcard feedmsg">'
      + '<div class="feedimg feednoimg"><span class="emo">' + c.emo + '</span><span class="line">' + esc(c.line) + '</span></div>'
      + '<div class="feedcap"><b>' + esc(f.who) + '</b>' + cal + '<span>' + esc(since) + '</span></div>'
      + '</div>';
  }).join('');
  icons();
}

/* 피드 사진 확대 팝업 */
function openFeedPhoto(i){
  var f = FEED[i]; if(!f || !f.hasPhoto) return;
  openMediaLightbox(f);
}
/* 사진 확대 보기 (앱 안에서만 표시) */
function openMediaLightbox(f){
  var sh = $('feedModal');
  if(!sh){ sh=document.createElement('div'); sh.id='feedModal'; sh.className='lightbox'; document.body.appendChild(sh); }
  // 사진만 이미지로 보여줌 (드라이브 페이지로 이동하는 링크·창 없음)
  var big = String(f.thumb||'').indexOf('data:')===0 ? f.thumb : String(f.thumb||'').replace(/sz=w\d+/, 'sz=w1000');
  var inner = big ? '<img src="' + esc(big) + '" class="lb-img">' : '<p class="muted" style="text-align:center">사진이 없어요.</p>';
  sh.innerHTML =
    '<div class="lb-bg" onclick="closeFeedPhoto()"></div>'
    + '<div class="lb-inner">'
    +   '<button class="lb-x" onclick="closeFeedPhoto()">✕</button>'
    +   inner
    +   '<div class="lb-cap"><b>' + esc(f.who) + '</b> · ' + esc(f.date) + (f.workout ? ' · ' + esc(f.workout) : '') + '</div>'
    + '</div>';
  sh.classList.add('on');
}
function closeFeedPhoto(){ var sh=$('feedModal'); if(sh){ sh.classList.remove('on'); sh.innerHTML=''; } }

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
  openMediaLightbox(h);
}

/* ====================================================================
 * 기록하기 화면 — 로컬 임시저장(localStorage) → 마지막 "운동 완료"에 일괄 제출
 *  · 항목마다 서버 저장 안 함(즉시 반응). 새로고침/이탈해도 복원됨
 *  · 사진·업로드는 "운동 완료" 누를 때만 서버로
 * ==================================================================== */
function saveLog(){ try{ localStorage.setItem(LOG_KEY, JSON.stringify(LOG)); }catch(e){} }
function clearLog(){ LOG=null; try{ localStorage.removeItem(LOG_KEY); }catch(e){} }
function loadSavedLog(){ try{ var s=localStorage.getItem(LOG_KEY); return s?JSON.parse(s):null; }catch(e){ return null; } }

function renderLog(){
  ensureEquip(function(){
    if(!LOG) LOG = loadSavedLog();          // 이전에 쓰던 거 복원
    if(!LOG) return renderLogStart();        // 새로 시작
    renderLogView();
  });
}
var START_WORKOUT = '';
function renderLogStart(){
  $('log').innerHTML =
    '<div class="card">'
    + '<h2>오늘 운동 시작</h2>'
    + '<div class="field"><label>날짜</label><input type="date" id="logDate" value="' + todayStr() + '"></div>'
    + '<div class="field"><label>오늘의 운동</label><div class="wchips" id="wchips">'
    +   WORKOUTS.map(function(w){ return '<button class="wchip' + (START_WORKOUT===w?' on':'') + '" onclick="pickWorkout(\'' + esc(w) + '\')">' + esc(w) + '</button>'; }).join('')
    + '</div></div>'
    + '<button class="button accent" style="width:100%;margin-top:6px" onclick="doStartSession()">시작하기</button>'
    + '</div>'
    + '<div class="card hintcard" id="hintCard"><div class="muted">지난 운동 확인 중…</div></div>';
  call('workoutHint').then(function(h){
    var el=$('hintCard'); if(!el) return;
    el.innerHTML = '<div class="hinticon">' + ic('lightbulb') + '</div><div class="hintline">' + hintText(h) + '</div>';
    icons();
  }).catch(function(){ var el=$('hintCard'); if(el) el.remove(); });
}
/* 마지막 운동 → 추천 멘트 (핵심은 라임 강조) */
function hintText(h){
  if(!h || h.type==='none') return '첫 운동을 기록해봐요! 오늘 어떤 부위를 해볼까요? 💪';
  var last = hl(h.lastWorkout);
  if(h.daysAgo <= 1) return '어제는 ' + last + ' 운동을 했어요. 오늘은 다른 부위를 해볼까요? 🔥';
  return hl(h.daysAgo + '일 전') + '에 ' + last + ' 운동을 했어요. 오늘 다시 가볍게 시작해봐요! 💪';
}
function pickWorkout(w){ START_WORKOUT = (START_WORKOUT===w?'':w);
  Array.prototype.forEach.call(document.querySelectorAll('#wchips .wchip'), function(b){ b.classList.toggle('on', b.textContent===START_WORKOUT); });
}
function doStartSession(){
  var date = $('logDate').value;
  if(!date){ toast('날짜를 선택해 주세요.'); return; }
  if(!START_WORKOUT){ toast('오늘의 운동을 선택해 주세요.'); return; }
  LOG = { date:date, workout:START_WORKOUT, running:null, weights:[], fin:null, finText:'' };
  START_WORKOUT=''; DRAFT=null; OPEN=''; saveLog(); renderLogView();
}

function renderLogView(){ $('log').innerHTML = logBodyHtml(); wirePhotoButtons(); wireFinInputs(); icons(); }

function logBodyHtml(){
  var h = '';
  h += '<div class="card">'
    + '<div class="row" style="justify-content:space-between;align-items:center">'
    +   '<div><b>' + esc(LOG.date) + '</b>' + (LOG.workout ? ' <span class="chip">' + esc(LOG.workout) + '</span>' : '') + '</div>'
    +   '<button class="linkbtn-del" onclick="discardLog()">기록 취소</button>'
    + '</div></div>';

  // 런닝 (저장버튼 없음 · 입력하면 즉시 LOG에)
  h += '<div class="card">'
    + '<h2>' + ic('footprints') + ' 런닝머신</h2>'
    + (LOG.running ? '<div class="savedline">✓ ' + esc(runText(LOG.running)) + '<button class="xmini" onclick="LOG.running=null;saveLog();renderLogView()">✕</button></div>' : '')
    + (OPEN==='run' ? runFormHtml() : (LOG.running ? '' : '<button class="softbtn" onclick="openForm(\'run\')">＋ 런닝 기록 추가</button>'))
    + '</div>';

  // 웨이트 (기구별로 LOG.weights에 쌓임)
  h += '<div class="card">'
    + '<h2>' + ic('dumbbell') + ' 웨이트</h2>'
    + LOG.weights.map(function(w, wi){
        var sets = (w.sets||[]).map(function(x){ return x.weight+'kg×'+x.reps; }).join(', ');
        var mv = w.move ? ' · ' + esc(w.move) : '';
        return '<div class="savedline">✓ <b>' + esc(w.equip) + '</b>' + mv + ' <span class="muted">' + esc(sets) + '</span>'
          + '<button class="xmini" onclick="delWeightItem(' + wi + ')">✕</button></div>';
      }).join('')
    + (OPEN==='weight' ? weightFormHtml() : '<button class="softbtn" onclick="openWeight()">＋ 기구 추가</button>')
    + (GEAR.length ? '' : '<p class="muted" style="margin-top:8px">먼저 <a onclick="switchTab(\'equip\')">기구 목록</a>에서 기구를 등록하세요.</p>')
    + '</div>';

  // 오운완 사진 (선택)
  h += '<div class="card" id="finCard">'
    + '<h2>' + ic('camera') + ' 오운완 사진</h2>'
    + finishInner()
    + '</div>';

  // 최종 완료
  h += '<div class="card">'
    + '<button class="button accent" style="width:100%;font-size:17px;padding:16px" onclick="submitWorkout(event)">' + ic('check-circle') + ' 운동 완료!</button>'
    + '<p class="muted" style="text-align:center;margin-top:8px">완료를 누르면 사진 업로드와 함께 최종 저장돼요.</p>'
    + '</div>';
  return h;
}
function discardLog(){
  if(!confirm('오늘 입력한 기록을 취소할까요? (저장 전이라 사라져요)')) return;
  clearLog(); DRAFT=null; OPEN=''; switchTab('home');
}
function delWeightItem(wi){ LOG.weights.splice(wi,1); saveLog(); renderLogView(); }

/* ---- 오운완 사진 (선택, 미리보기+문구는 로컬) ---- */
function finishInner(){
  if(LOG.fin){
    return '<div class="finstage" id="finStage">'
      +   '<img src="' + esc(LOG.fin.data) + '" class="finimg">'
      +   '<div class="finoverlay">'
      +     '<div class="fintext" id="finPreview">' + esc(LOG.finText || '') + '</div>'
      +     '<div class="finmeta">' + esc(LOG.date) + (LOG.workout ? ' · ' + esc(LOG.workout) : '') + ' · ' + esc(ME.name) + '</div>'
      +   '</div>'
      + '</div>'
      + '<input id="finInput" class="fininput" maxlength="40" placeholder="오늘의 한마디 (예: 가슴 조졌다 💪)" value="' + esc(LOG.finText || '') + '" oninput="LOG.finText=this.value;saveLog();document.getElementById(\'finPreview\').textContent=this.value">'
      + '<button class="softbtn" style="margin-top:10px" onclick="LOG.fin=null;LOG.finText=\'\';saveLog();renderLogView()">사진 다시 고르기</button>';
  }
  return '<div class="picker">'
    + '<div class="picklabel">오운완 사진 (선택 · 안 올려도 완료 가능)</div>'
    + '<button class="photobtn" onclick="openFinSheet()">' + ic('camera') + ' 사진 올리기</button>'
    + '<input type="file" accept="image/*" id="file_finimg" class="hiddenfile">'
    + '<input type="file" accept="image/*" capture="environment" id="cam_finimg" class="hiddenfile">'
    + '</div>';
}
function openFinSheet(){
  var sh=$('photoSheet');
  if(!sh){ sh=document.createElement('div'); sh.id='photoSheet'; sh.className='sheetwrap'; document.body.appendChild(sh); }
  sh.innerHTML='<div class="sheetbg" onclick="closePhotoSheet()"></div>'
    + '<div class="sheetbox"><div class="sheettitle">오운완 사진</div>'
    + '<button class="sheetitem" onclick="finPick(\'cam_finimg\')">' + ic('camera') + ' 사진 촬영</button>'
    + '<button class="sheetitem" onclick="finPick(\'file_finimg\')">' + ic('image') + ' 앨범에서 선택</button>'
    + '<button class="sheetitem cancel" onclick="closePhotoSheet()">취소</button></div>';
  sh.classList.add('on'); icons();
  wireFinInputs();
}
function finPick(id){ closePhotoSheet(); var el=$(id); if(el) el.click(); }
function wireFinInputs(){
  ['file_finimg','cam_finimg'].forEach(function(id){ var el=$(id); if(!el) return;
    el.onchange=function(){ var f=el.files&&el.files[0]; if(!f) return;
      shrinkImage(f, 1080, 0.82, function(data){ LOG.fin={ data:data }; LOG.finText=LOG.finText||''; saveLog(); renderLogView(); }); };
  });
}
function makeThumbFromImage(dataUrl, done){
  var im=new Image();
  im.onload=function(){ var cv=document.createElement('canvas'); var w=im.width,h=im.height,M=500;
    if(Math.max(w,h)>M){ var r=M/Math.max(w,h); w=Math.round(w*r); h=Math.round(h*r); }
    cv.width=w; cv.height=h; cv.getContext('2d').drawImage(im,0,0,w,h);
    try{ done(cv.toDataURL('image/jpeg',0.72)); }catch(e){ done(''); } };
  im.onerror=function(){ done(''); };
  im.src=dataUrl;
}

function runText(r){
  var p = [];
  if(String(r.min)!=='') p.push(r.min+'분'); if(String(r.km)!=='') p.push(r.km+'km');
  if(String(r.incline)!=='') p.push('경사'+r.incline); if(String(r.speed)!=='') p.push(r.speed+'km/h'); if(String(r.kcal)!=='') p.push(r.kcal+'kcal');
  return p.join(' · ') || '기록';
}
function runFormHtml(){
  var r = LOG.running || {};
  return '<div class="subcard">'
    + '<div class="grid2">'
    +   numField('run_min','시간(분)','10',r.min) + numField('run_km','거리(km)','1.2',r.km)
    +   numField('run_incline','경사','3',r.incline) + numField('run_speed','속도(km/h)','7',r.speed)
    +   numField('run_kcal','칼로리','90',r.kcal) + '<div></div>'
    + '</div>'
    + '<div class="row" style="margin-top:10px">'
    +   '<button class="button ghost" style="flex:1" onclick="OPEN=\'\';renderLogView()">취소</button>'
    +   '<button class="button accent" style="flex:2" onclick="saveRun()">추가</button>'
    + '</div></div>';
}
function numField(id, label, ph, val){
  return '<div class="field"><label>' + label + '</label><input id="' + id + '" type="number" inputmode="decimal" placeholder="' + ph + '" value="' + (val==null?'':esc(val)) + '"></div>';
}
function saveRun(){
  var r = { min:val('run_min'), km:val('run_km'), incline:val('run_incline'), speed:val('run_speed'), kcal:val('run_kcal') };
  if(['min','km','incline','speed','kcal'].every(function(k){return String(r[k]).trim()==='';})){ toast('런닝 값을 입력해 주세요.'); return; }
  LOG.running = r; OPEN=''; saveLog(); toast('런닝 추가 ✓'); renderLogView();
}
function val(id){ var el=$(id); return el?el.value:''; }

/* ---- 웨이트: 기구 → 동작 팝업 ---- */
function openWeight(){
  if(!GEAR.length){ toast('먼저 기구 목록에서 기구를 등록하세요.'); return; }
  // 오늘의 운동 부위를 기본으로 (없으면 첫 부위)
  if(PARTS.indexOf(PICK_PART) < 0) PICK_PART = (LOG && PARTS.indexOf(LOG.workout) >= 0) ? LOG.workout : (PARTS[0]||'');
  PICK_STEP='equip'; PICK_EQUIP=null; renderPicker();
}
var PICK_PART = '';
function pickPart(p){ PICK_PART = p; renderPicker(); }
function renderPicker(){
  var sh = $('pickerModal');
  if(!sh){ sh=document.createElement('div'); sh.id='pickerModal'; sh.className='modalwrap'; document.body.appendChild(sh); }
  var body, title;
  if(PICK_STEP==='equip'){
    title = '기구 선택';
    var chips = '<div class="wchips" style="margin-bottom:12px">' + PARTS.map(function(p){
      return '<button class="wchip' + (p===PICK_PART?' on':'') + '" onclick="pickPart(\'' + esc(p) + '\')">' + esc(p) + '</button>';
    }).join('') + '</div>';
    var rows = [];
    GEAR.forEach(function(e,i){ if(e.part===PICK_PART) rows.push(
      '<button class="pickrow" onclick="pickEquipStep(' + i + ')">'
        + (e.thumb ? '<img class="prthumb" src="' + esc(e.thumb) + '">' : '<span class="prthumb prnoimg">🏋</span>')
        + '<span class="prname">' + esc(e.name) + '</span>'
        + '<span class="prsub">동작 ' + (e.moves||[]).length + '</span>'
      + '</button>'); });
    body = chips + (rows.length ? rows.join('') : '<p class="muted">' + esc(PICK_PART) + ' 기구가 없어요. 기구 목록에서 등록해 주세요.</p>');
  } else {
    title = esc(PICK_EQUIP.name) + ' · 동작 선택';
    var moves = PICK_EQUIP.moves || [];
    body = moves.length ? moves.map(function(m,i){
      return '<button class="pickrow" onclick="pickMoveStep(' + i + ')">'
        + (m.thumb ? '<img class="prthumb" src="' + esc(m.thumb) + '">' : '<span class="prthumb prnoimg">💪</span>')
        + '<span class="prname">' + esc(m.name) + '</span>'
        + (m.link ? '<span class="prsub">▶ 영상</span>' : '')
        + '</button>';
    }).join('')
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
            moveName: move ? move.name : '', moveLink: move ? (move.link||'') : '', sets:[{weight:'',reps:''}] };
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
    +   '<button class="howto" onclick="openHowto()">▶ 운동법 보기</button>'
    +   '<button class="linkback" onclick="openWeight()">바꾸기</button>'
    + '</div>'
    + '<div style="margin-top:8px">' + setsHtml + '</div>'
    + '<button class="softbtn" style="margin-top:4px" onclick="addDraftSet()">＋ 세트 추가</button>'
    + '<div class="row" style="margin-top:10px">'
    +   '<button class="button ghost" style="flex:1" onclick="OPEN=\'\';DRAFT=null;renderLogView()">취소</button>'
    +   '<button class="button accent" style="flex:2" onclick="confirmWeight()">추가</button>'
    + '</div></div>';
}
function addDraftSet(){ DRAFT.sets.push({weight:'',reps:''}); renderLogView(); }
function delDraftSet(si){ DRAFT.sets.splice(si,1); if(!DRAFT.sets.length) DRAFT.sets.push({weight:'',reps:''}); renderLogView(); }
/* 웨이트 기구 1개를 LOG.weights에 추가 (서버 아님) */
function confirmWeight(){
  if(!DRAFT || !DRAFT.equipName){ toast('기구를 선택해 주세요.'); return; }
  var sets = DRAFT.sets.filter(function(s){ return String(s.weight).trim()!=='' || String(s.reps).trim()!==''; });
  if(!sets.length){ toast('무게·횟수를 한 세트 이상 입력해 주세요.'); return; }
  LOG.weights.push({ equip:DRAFT.equipName, move:DRAFT.moveName, part:DRAFT.part, sets:sets.slice() });
  saveLog(); toast(DRAFT.equipName + ' 추가 ✓');
  DRAFT=null; OPEN=''; renderLogView();
}
function openForm(kind){ OPEN=kind; renderLogView(); }
/* 운동법 보기 — 유튜브 링크 새 탭 (없으면 안내) */
function openHowto(){
  var link = DRAFT && DRAFT.moveLink ? String(DRAFT.moveLink).trim() : '';
  if(!link){ toast('아직 운동법 링크가 없습니다.'); return; }
  if(!/^https?:\/\//i.test(link)) link = 'https://' + link;
  window.open(link, '_blank');
}

/* ====================================================================
 * 운동 완료 — 전체를 서버로 일괄 제출 (여기서만 업로드)
 * ==================================================================== */
function submitWorkout(ev){
  if(!LOG){ return; }
  if(!LOG.running && !LOG.weights.length && !LOG.fin){ toast('기록한 내용이 없어요.'); return; }
  // 사진 없으면 인증 경고
  if(!LOG.fin){
    if(!confirm('오운완 사진이 없으면 인증이 안 남아요. 그래도 완료할까요?')) return;
  }
  var btn = ev && ev.target ? ev.target : null; if(btn){ btn.disabled=true; }

  // 단계 목록 구성
  var steps=[{k:'start',t:'기록 시작'}];
  if(LOG.running) steps.push({k:'run',t:'런닝 저장'});
  LOG.weights.forEach(function(w,i){ steps.push({k:'wt'+i, t:'웨이트 저장 (' + w.equip + ')'}); });
  if(LOG.fin) steps.push({k:'photo',t:'오운완 사진 올리는 중'});
  steps.push({k:'done',t:'마무리'});
  loadSteps(steps, 'start');

  var sid='';
  // 순차 제출 (단계별 % 표시)
  call('startSession', { date:LOG.date, workout:LOG.workout }).then(function(r){
    sid=r.id; loadStep(LOG.running?'run':(LOG.weights.length?'wt0':(LOG.fin?'photo':'done')));
    return LOG.running ? call('addRunning', sid, LOG.running) : null;
  }).then(function(){
    return chainWeights(sid, 0);
  }).then(function(){
    return LOG.fin ? uploadFinish(sid) : null;
  }).then(function(){
    loadStep('done'); loadDone();
    clearLog(); DRAFT=null; OPEN='';
    toast('오늘 운동 완료! 💪');
    switchTab('home');
  }).catch(function(e){ loadDone(); if(btn) btn.disabled=false; toast('저장 실패: ' + (e&&e.message||e)); });
}
/* 웨이트를 하나씩 순차 저장하며 단계 % 올림 */
function chainWeights(sid, i){
  if(i >= LOG.weights.length){ if(LOG.fin) loadStep('photo'); else if(!LOG.weights.length){} return Promise.resolve(); }
  var w = LOG.weights[i];
  return call('addWeight', sid, { equipName:w.equip, moveName:w.move, part:w.part, sets:w.sets })
    .then(function(){
      var next = (i+1<LOG.weights.length) ? 'wt'+(i+1) : (LOG.fin?'photo':'done');
      loadStep(next);
      return chainWeights(sid, i+1);
    });
}
/* 오운완 사진 합성 후 업로드 */
function uploadFinish(sid){
  return new Promise(function(res, rej){
    var meta = LOG.date + (LOG.workout ? ' · ' + LOG.workout : '') + ' · ' + ME.name;
    composePhoto(LOG.fin.data, LOG.finText, meta, function(dataUrl){
      makeThumbFromImage(dataUrl, function(thumb){
        call('addFinish', sid, { kind:'photo', name:'오운완.jpg', mime:'image/jpeg', data:dataUrl, thumbData:thumb })
          .then(function(){ loadStep('done'); res(); }).catch(rej);
      });
    });
  });
}
/* 업로드 전 리사이즈 + JPEG 압축 (용량 최소화) → dataURL 콜백 */
function shrinkImage(file, maxPx, quality, done){
  var reader = new FileReader();
  reader.onload = function(){
    var img = new Image();
    img.onload = function(){
      var w=img.width, h=img.height;
      if(Math.max(w,h) > maxPx){ var r=maxPx/Math.max(w,h); w=Math.round(w*r); h=Math.round(h*r); }
      var cv=document.createElement('canvas'); cv.width=w; cv.height=h;
      cv.getContext('2d').drawImage(img,0,0,w,h);
      try{ done(cv.toDataURL('image/jpeg', quality||0.82)); }
      catch(e){ done(reader.result); }   // 혹시 실패하면 원본
    };
    img.onerror = function(){ done(reader.result); };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
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

/* ====================================================================
 * 사진 선택 (기구/동작 사진 · 버튼 1개 → 촬영/앨범 시트)
 * ==================================================================== */
var PHOTO_KEYS = ['eq','mv','eqedit','mvedit'];
function photoPicker(key, label){
  return '<div class="picker" id="pick_' + key + '">'
    + '<div class="picklabel">' + esc(label) + '</div>'
    + '<button class="photobtn" onclick="openPhotoSheet(\'' + key + '\')">' + ic('camera') + ' 사진 올리기</button>'
    + '<input type="file" accept="image/*" id="file_' + key + '" class="hiddenfile">'
    + '<input type="file" accept="image/*" capture="environment" id="cam_' + key + '" class="hiddenfile">'
    + '<div id="prev_' + key + '"></div>'
    + '</div>';
}
function wirePhotoButtons(){
  icons();
  PHOTO_KEYS.forEach(function(key){
    ['file_','cam_'].forEach(function(pfx){
      var input = $(pfx+key); if(!input) return;
      input.onchange = function(){
        var f = input.files && input.files[0]; if(!f) return;
        shrinkImage(f, 1080, 0.82, function(data){
          PHOTOBUF[key] = { name:'photo.jpg', mime:'image/jpeg', data:data };
          var prev = $('prev_'+key);
          if(prev) prev.innerHTML = '<img src="' + data + '" class="prevpic">';
        });
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
    +   '<button class="sheetitem" onclick="pickFile(\'' + key + '\',true)">' + ic('camera') + ' 카메라로 촬영</button>'
    +   '<button class="sheetitem" onclick="pickFile(\'' + key + '\',false)">' + ic('image') + ' 앨범에서 선택</button>'
    +   '<button class="sheetitem cancel" onclick="closePhotoSheet()">취소</button>'
    + '</div>';
  sh.classList.add('on'); icons();
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
    if(PARTS.indexOf(EQ_PART) < 0) EQ_PART = PARTS[0] || '';   // 고른 부위 유지 (등록·수정 후에도)

    $('equip').innerHTML =
      '<div class="card"><h2>기구 등록</h2>'
      + '<div class="field"><label>기구 이름</label><input id="eqName" placeholder="예: 벤치프레스"></div>'
      + '<div class="field"><label>부위</label><div class="wchips" id="eqPartChips">' + PARTS.map(function(p){return '<button class="wchip' + (p===EQ_PART?' on':'') + '" onclick="pickEqPart(\'' + esc(p) + '\')">' + esc(p) + '</button>';}).join('') + '</div></div>'
      + photoPicker('eq', '기구 사진(선택)')
      + '<button class="button accent" style="width:100%;margin-top:10px" onclick="submitEquip(event)">기구 추가</button>'
      + '</div>'
      + '<details class="eqfold" id="eqFold"><summary id="eqFoldSum"></summary>'
      +   '<div class="eqlist" id="eqList"></div>'
      + '</details>';
    renderEquipList();
    wirePhotoButtons();
  }).catch(function(e){ $('equip').innerHTML = '<div class="card"><p class="muted">오류: ' + esc(e&&e.message||e) + '</p></div>'; });
}
/* 고른 부위의 기구만 목록에 표시 */
function renderEquipList(){
  var list = GEAR.filter(function(e){ return e.part === EQ_PART; });
  var sum = $('eqFoldSum'), box = $('eqList'); if(!sum || !box) return;
  sum.innerHTML = esc(EQ_PART) + ' 기구 ' + list.length + '개 <span class="foldcaret">▾</span>';
  box.innerHTML = list.length ? list.map(function(e){
    var moves = (e.moves||[]).map(function(m,mi){ return '<button class="movetag edit" onclick="openMoveEdit(\'' + e.id + '\',' + mi + ')">' + esc(m.name) + ' ✏</button>'; }).join('');
    return '<div class="eqrow">'
      + '<div style="display:flex;gap:12px;align-items:center">'
      +   (e.thumb ? '<img src="' + esc(e.thumb) + '" class="eqimg">' : '<div class="eqimg eqnoimg"><i data-lucide="dumbbell"></i></div>')
      +   '<div style="flex:1;min-width:0"><b>' + esc(e.name) + '</b><br><span class="muted">' + esc(e.part) + ' · 동작 ' + (e.moves||[]).length + '개</span></div>'
      +   '<div class="eqacts">'
      +     '<button class="minibtn" onclick="openEquipEdit(\'' + e.id + '\')">수정</button>'
      +     '<button class="minibtn del" onclick="delEquip(\'' + e.id + '\',\'' + esc(e.name) + '\')">삭제</button>'
      +   '</div>'
      + '</div>'
      + '<div class="movetags">' + moves
      +   '<button class="movetag addmv" onclick="openMoveForm(\'' + e.id + '\')">＋ 동작</button>'
      + '</div>'
      + (moves ? '<p class="muted" style="margin:6px 0 0;font-size:12px">동작을 누르면 이름·유튜브 링크·사진을 고칠 수 있어요.</p>' : '')
      + '</div>';
  }).join('') : '<p class="muted" style="padding:12px 0">' + esc(EQ_PART) + ' 기구가 아직 없어요. 위에서 추가해 보세요.</p>';
  icons();
}
var EQ_PART = '';
function pickEqPart(p){ EQ_PART = p;
  Array.prototype.forEach.call(document.querySelectorAll('#eqPartChips .wchip'), function(b){ b.classList.toggle('on', b.textContent===p); });
  renderEquipList();
  var f=$('eqFold'); if(f) f.open = true;   // 부위 누르면 그 부위 목록 펼침
}
function submitEquip(ev){
  var name = $('eqName').value.trim();
  if(!name){ toast('기구 이름을 입력해 주세요.'); return; }
  var btn = ev && ev.target ? ev.target : null; busyBtn(btn,'등록 중…');
  cover(true, '등록 중…');
  call('addEquipment', { name:name, part:EQ_PART||PARTS[0], photo: PHOTOBUF.eq || null })
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
    +     '<div class="field"><label>운동법 유튜브 링크(선택)</label><input id="mvLink" type="url" inputmode="url" placeholder="유튜브 숏츠 링크 붙여넣기"></div>'
    +     photoPicker('mv', '동작 사진(선택)')
    +     '<button class="button accent" style="width:100%;margin-top:10px" onclick="submitMove(event)">동작 추가</button>'
    +   '</div>'
    + '</div>';
  sh.classList.add('on');
  wirePhotoButtons();
}
function closeMoveForm(){ var sh=$('moveModal'); if(sh) sh.classList.remove('on'); PHOTOBUF.mv=null; }
/* 기구 수정 모달 (이름·부위·사진) */
var EDIT_EQ_PART = '';
function openEquipEdit(id){
  var e = GEAR.filter(function(x){return x.id===id;})[0]; if(!e) return;
  EDIT_EQ_PART = e.part; PHOTOBUF.eqedit = null;
  var sh=$('eqEditModal');
  if(!sh){ sh=document.createElement('div'); sh.id='eqEditModal'; sh.className='modalwrap'; document.body.appendChild(sh); }
  sh.innerHTML =
    '<div class="modalbg" onclick="closeEqEdit()"></div>'
    + '<div class="modalbox">'
    +   '<div class="modalhead"><b>✏ 기구 수정</b><button class="xbtn" onclick="closeEqEdit()">✕</button></div>'
    +   '<div class="modalbody">'
    +     '<div class="field"><label>기구 이름</label><input id="eqEditName" value="' + esc(e.name) + '"></div>'
    +     '<div class="field"><label>부위</label><div class="wchips" id="eqEditChips">' + PARTS.map(function(p){return '<button class="wchip' + (p===e.part?' on':'') + '" onclick="pickEqEditPart(\'' + esc(p) + '\')">' + esc(p) + '</button>';}).join('') + '</div></div>'
    +     (e.thumb ? '<img src="' + esc(e.thumb) + '" style="width:80px;height:80px;object-fit:cover;border-radius:12px;border:1px solid var(--line);margin-bottom:4px">' : '')
    +     photoPicker('eqedit', '사진 바꾸기(선택)')
    +     '<button class="button accent" style="width:100%;margin-top:10px" onclick="submitEqEdit(\'' + e.id + '\')">저장</button>'
    +   '</div>'
    + '</div>';
  sh.classList.add('on'); wirePhotoButtons(); icons();
}
function closeEqEdit(){ var sh=$('eqEditModal'); if(sh) sh.classList.remove('on'); PHOTOBUF.eqedit=null; }
function pickEqEditPart(p){ EDIT_EQ_PART=p; Array.prototype.forEach.call(document.querySelectorAll('#eqEditChips .wchip'), function(b){ b.classList.toggle('on', b.textContent===p); }); }
function submitEqEdit(id){
  var name=($('eqEditName').value||'').trim(); if(!name){ toast('기구 이름을 입력해 주세요.'); return; }
  cover(true,'저장 중…');
  call('updateEquipment', id, { name:name, part:EDIT_EQ_PART, photo:PHOTOBUF.eqedit||null })
    .then(function(r){ cover(false); toast('기구를 수정했어요.'); GEAR=r.gear||[]; PHOTOBUF.eqedit=null; closeEqEdit(); renderEquip(); })
    .catch(function(e){ cover(false); toast('수정 실패: ' + (e&&e.message||e)); });
}

/* 동작 수정 모달 (이름·링크·사진) */
function openMoveEdit(equipId, mi){
  var e = GEAR.filter(function(x){return x.id===equipId;})[0]; if(!e) return;
  var m = (e.moves||[])[mi]; if(!m) return;
  PHOTOBUF.mvedit = null;
  var sh=$('mvEditModal');
  if(!sh){ sh=document.createElement('div'); sh.id='mvEditModal'; sh.className='modalwrap'; document.body.appendChild(sh); }
  sh.innerHTML =
    '<div class="modalbg" onclick="closeMvEdit()"></div>'
    + '<div class="modalbox">'
    +   '<div class="modalhead"><b>✏ 동작 수정</b><button class="xbtn" onclick="closeMvEdit()">✕</button></div>'
    +   '<div class="modalbody">'
    +     '<div class="field"><label>동작 이름</label><input id="mvEditName" value="' + esc(m.name) + '"></div>'
    +     '<div class="field"><label>운동법 유튜브 링크</label><input id="mvEditLink" type="url" inputmode="url" value="' + esc(m.link||'') + '" placeholder="유튜브 숏츠 링크"></div>'
    +     (m.thumb ? '<img src="' + esc(m.thumb) + '" style="width:80px;height:80px;object-fit:cover;border-radius:12px;border:1px solid var(--line);margin-bottom:4px">' : '')
    +     photoPicker('mvedit', '사진 바꾸기(선택)')
    +     '<button class="button accent" style="width:100%;margin-top:10px" onclick="submitMvEdit(\'' + m.id + '\')">저장</button>'
    +   '</div>'
    + '</div>';
  sh.classList.add('on'); wirePhotoButtons(); icons();
}
function closeMvEdit(){ var sh=$('mvEditModal'); if(sh) sh.classList.remove('on'); PHOTOBUF.mvedit=null; }
function submitMvEdit(id){
  var name=($('mvEditName').value||'').trim(); if(!name){ toast('동작 이름을 입력해 주세요.'); return; }
  cover(true,'저장 중…');
  call('updateMove', id, { name:name, link:$('mvEditLink').value, photo:PHOTOBUF.mvedit||null })
    .then(function(r){ cover(false); toast('동작을 수정했어요.'); GEAR=r.gear||[]; PHOTOBUF.mvedit=null; closeMvEdit(); renderEquip(); })
    .catch(function(e){ cover(false); toast('수정 실패: ' + (e&&e.message||e)); });
}

/* 기구 삭제 (그 기구의 동작·사진까지) */
function delEquip(id, name){
  if(!confirm('"' + name + '" 기구를 삭제할까요?\n이 기구의 동작과 사진도 함께 지워져요. (이미 기록된 운동 기록은 그대로 남아요)')) return;
  cover(true, '삭제 중…');
  call('deleteEquipment', id).then(function(r){
    cover(false); toast('기구를 삭제했어요.'); GEAR = r.gear || []; renderEquip();
  }).catch(function(e){ cover(false); toast('삭제 실패: ' + (e&&e.message||e)); });
}
function submitMove(ev){
  var name = ($('mvName').value||'').trim();
  if(!name){ toast('동작 이름을 입력해 주세요.'); return; }
  var btn = ev && ev.target ? ev.target : null; busyBtn(btn, '추가 중…');
  cover(true,'동작 추가 중…');
  call('addMove', MOVE_EQUIP_ID, { name:name, link:$('mvLink').value, photo: PHOTOBUF.mv || null })
    .then(function(r){ cover(false); toast('동작을 추가했어요 ✓'); GEAR = r.gear || []; PHOTOBUF.mv=null; closeMoveForm(); renderEquip(); })
    .catch(function(e){ cover(false); unbusyBtn(btn); toast('추가 실패: ' + (e&&e.message||e)); });
}

function busyBtn(btn, label){ if(!btn) return; btn._html=btn.innerHTML; btn.disabled=true; btn.innerHTML=label; }
function unbusyBtn(btn){ if(!btn || btn._html==null) return; btn.disabled=false; btn.innerHTML=btn._html; }

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
  icons();
}

/* 그날 상세 모달 — 간단 요약 (자세히는 별도) */
var DAY_LIST = [];
function openDay(ds){
  DAY_LIST = LIST_SESS.filter(function(s){ return String(s.date).slice(0,10)===ds; });
  var sh = $('dayModal');
  if(!sh){ sh=document.createElement('div'); sh.id='dayModal'; sh.className='modalwrap'; document.body.appendChild(sh); }
  sh.innerHTML =
    '<div class="modalbg" onclick="closeDay()"></div>'
    + '<div class="modalbox">'
    +   '<div class="modalhead"><b>' + ic('clipboard-list') + ' ' + esc(ds) + '</b><button class="xbtn" onclick="closeDay()">✕</button></div>'
    +   '<div class="modalbody">' + (DAY_LIST.length ? DAY_LIST.map(sessionSummaryRow).join('') : '<p class="muted">기록이 없어요.</p>') + '</div>'
    + '</div>';
  sh.classList.add('on'); icons();
}
function closeDay(){ var sh=$('dayModal'); if(sh) sh.classList.remove('on'); }

/* 요약 한 줄: 런닝 했는지 + 웨이트 기구 수 + 오운완 */
function sessionSummaryRow(s, i){
  var bits = [];
  if((s.running||[]).length) bits.push(ic('footprints') + ' 런닝');
  var nEquip = (s.weights||[]).length;
  if(nEquip){
    var first = s.weights[0].equip;
    bits.push(ic('dumbbell') + ' ' + esc(first) + (nEquip>1 ? ' 외 ' + (nEquip-1) + '개' : ''));
  }
  if(s.finishThumb) bits.push(ic('camera') + ' 오운완');
  var summary = bits.length ? bits.join('  ·  ') : '기록';
  return '<div class="daysess">'
    + '<div class="row" style="justify-content:space-between;align-items:center">'
    +   '<b style="color:'+whoColor(s.who)+'">' + esc(s.who) + '</b>'
    +   '<span class="muted">' + (s.workout ? esc(s.workout) : '') + '</span>'
    + '</div>'
    + '<div class="daysum">' + summary + '</div>'
    + '<button class="softbtn" style="margin-top:10px" onclick="openSessionDetail(' + i + ')">자세히 보기</button>'
    + '</div>';
}

/* 자세히 보기 — 세트별 전체 기록 */
var DETAIL_S = null;
function openSessionDetail(i){
  var s = DAY_LIST[i]; if(!s) return;
  DETAIL_S = { who:s.who, date:s.date, workout:s.workout, type:s.finishType, thumb:s.finishThumb, url:s.finishVideo||s.finishPhoto };
  var sh = $('detailModal');
  if(!sh){ sh=document.createElement('div'); sh.id='detailModal'; sh.className='modalwrap'; document.body.appendChild(sh); }
  var run = (s.running||[]).map(function(r){
    var parts = [];
    if(r.min!=='') parts.push(r.min+'분'); if(r.km!=='') parts.push(r.km+'km');
    if(r.incline!=='') parts.push('경사'+r.incline); if(r.speed!=='') parts.push(r.speed+'km/h'); if(r.kcal!=='') parts.push(r.kcal+'kcal');
    return '<div class="muted" style="margin:3px 0">' + ic('footprints') + ' ' + esc(parts.join(' · ')) + '</div>';
  }).join('');
  var wt = (s.weights||[]).map(function(w){
    var rows = (w.sets||[]).map(function(x, si){
      return '<div class="setline"><span>' + (si+1) + '세트</span><b>' + esc(x.weight) + 'kg × ' + esc(x.reps) + '회</b></div>';
    }).join('');
    var mv = w.move ? ' · ' + esc(w.move) : '';
    return '<div class="detwt"><div class="detwt-h">' + ic('dumbbell') + ' <b>' + esc(w.equip) + '</b>' + mv + '</div>' + rows + '</div>';
  }).join('');
  sh.innerHTML =
    '<div class="modalbg" onclick="closeDetail()"></div>'
    + '<div class="modalbox">'
    +   '<div class="modalhead"><b>' + esc(s.who) + ' · ' + esc(s.date) + (s.workout?' · '+esc(s.workout):'') + '</b><button class="xbtn" onclick="closeDetail()">✕</button></div>'
    +   '<div class="modalbody">'
    +     (s.finishThumb ? (s.finishType==='video'
          ? '<div class="detphoto" style="position:relative;cursor:pointer" onclick="openMediaLightbox(DETAIL_S)"><img src="' + esc(s.finishThumb) + '" style="width:100%;border-radius:12px;display:block"><span class="playbadge">▶</span></div>'
          : '<img src="' + esc(s.finishThumb) + '" class="detphoto">') : '')
    +     (run || '')
    +     (wt || '')
    +     '<button class="button accent" style="width:100%;margin-top:14px" onclick="openLogShare(' + i + ')">' + ic('share-2') + ' 이 날 기록 공유하기</button>'
    +   '</div>'
    + '</div>';
  sh.classList.add('on'); icons();
}
function closeDetail(){ var sh=$('detailModal'); if(sh) sh.classList.remove('on'); }

/* ====================================================================
 * 운동일지 공유 카드 — 그날 기록을 9:16 이미지 한 장으로
 * ==================================================================== */
var LOGSHARE_I = -1;
function openLogShare(i){
  LOGSHARE_I = i;
  var sh = $('logShareModal');
  if(!sh){ sh=document.createElement('div'); sh.id='logShareModal'; sh.className='modalwrap'; document.body.appendChild(sh); }
  sh.innerHTML =
    '<div class="modalbg" onclick="closeLogShare()"></div>'
    + '<div class="modalbox">'
    +   '<div class="modalhead"><b>' + ic('share-2') + ' 운동일지 공유</b><button class="xbtn" onclick="closeLogShare()">✕</button></div>'
    +   '<div class="modalbody">'
    +     '<div class="sharepreview"><canvas id="logShareCanvas"></canvas></div>'
    +     '<button class="button accent" style="width:100%" onclick="downloadLogShare()">이미지로 저장</button>'
    +     '<p class="muted" style="text-align:center;margin-top:8px">"나 이날 이렇게 운동했다!" 자랑해 보세요 💪</p>'
    +   '</div>'
    + '</div>';
  sh.classList.add('on'); icons();
  renderLogShare();
}
function closeLogShare(){ var sh=$('logShareModal'); if(sh) sh.classList.remove('on'); }

function renderLogShare(){
  var s = DAY_LIST[LOGSHARE_I]; var cv = $('logShareCanvas'); if(!s || !cv) return;
  var W=1080, H=1920; cv.width=W; cv.height=H;
  var ctx = cv.getContext('2d');
  var pad = 80;

  function paint(img){
    var g=ctx.createLinearGradient(0,0,W,H); g.addColorStop(0,'#13161d'); g.addColorStop(1,'#0c0e12');
    ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
    ctx.textAlign='left';
    ctx.fillStyle='#c6f432'; ctx.font='800 40px "Gothic A1",sans-serif';
    ctx.fillText('● 운동 레포트', pad, 120);
    ctx.fillStyle='#eef1f5'; ctx.font='900 78px "Gothic A1",sans-serif';
    ctx.fillText(mdSlash(s.date) + (s.workout ? '  ' + s.workout + '날' : ''), pad, 220);
    ctx.fillStyle='#9aa3b2'; ctx.font='600 36px "Gothic A1",sans-serif';
    ctx.fillText(s.who + '의 운동 기록', pad, 280);

    var y = 330;
    // 오운완 사진 (잘리지 않게 통째로)
    if(img){
      var boxW=W-pad*2, boxH=640;
      ctx.save(); roundRect(ctx,pad,y,boxW,boxH,28); ctx.clip();
      ctx.fillStyle='#1a1e27'; ctx.fillRect(pad,y,boxW,boxH);
      var sc=Math.min(boxW/img.width, boxH/img.height), dw=img.width*sc, dh=img.height*sc;
      ctx.drawImage(img, pad+(boxW-dw)/2, y+(boxH-dh)/2, dw, dh);
      ctx.restore();
      y += boxH + 60;
    }

    // 런닝
    (s.running||[]).forEach(function(r){
      ctx.fillStyle='#49e39b'; ctx.font='800 44px "Gothic A1",sans-serif';
      ctx.fillText('🏃 런닝', pad, y);
      ctx.fillStyle='#eef1f5'; ctx.font='700 40px "Gothic A1",sans-serif';
      ctx.fillText(runText(r), pad + 190, y);
      y += 76;
    });

    // 웨이트: 기구 · 동작 · 세트수 · 최고 무게
    var list = s.weights||[];
    var maxRows = Math.floor((H - 160 - y) / 68);
    list.slice(0, Math.max(0, maxRows)).forEach(function(w){
      var top=0; (w.sets||[]).forEach(function(x){ var v=Number(x.weight)||0; if(v>top) top=v; });
      var label = w.equip + (w.move ? ' · ' + w.move : '');
      if(label.length > 16) label = label.slice(0,16) + '…';
      ctx.fillStyle='#eef1f5'; ctx.font='700 40px "Gothic A1",sans-serif';
      ctx.fillText('🏋 ' + label, pad, y);
      ctx.fillStyle='#c6f432'; ctx.textAlign='right';
      ctx.fillText((w.sets||[]).length + '세트' + (top ? ' · ' + top + 'kg' : ''), W-pad, y);
      ctx.textAlign='left';
      y += 68;
    });
    if(list.length > maxRows && maxRows >= 0){
      ctx.fillStyle='#9aa3b2'; ctx.font='600 34px "Gothic A1",sans-serif';
      ctx.fillText('외 ' + (list.length - maxRows) + '개 더', pad, y);
    }

    ctx.fillStyle='#5b6472'; ctx.font='500 30px "Gothic A1",sans-serif';
    ctx.fillText(s.date, pad, H-90);
  }

  if(s.finishThumb){
    var im=new Image();
    if(String(s.finishThumb).indexOf('data:')!==0) im.crossOrigin='anonymous';
    im.onload=function(){ paint(im); }; im.onerror=function(){ paint(null); };
    im.src=s.finishThumb;
  } else { paint(null); }
}
function downloadLogShare(){
  var cv=$('logShareCanvas'); var s=DAY_LIST[LOGSHARE_I]; if(!cv) return;
  try{
    var a=document.createElement('a');
    a.href=cv.toDataURL('image/jpeg',0.92);
    a.download='운동일지_' + (s?s.date:'') + '.jpg';
    document.body.appendChild(a); a.click(); a.remove();
    toast('저장 완료! 공유해 보세요 📸');
  }catch(e){ toast('사진 보안 때문에 저장이 막혔어요. 화면 캡처로 저장해 주세요.'); }
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
function weekAgo(n){ var d=new Date(); d.setDate(d.getDate()-n); return localYmdStr(d); }
function ymd(s){ return String(s||'').slice(0,10); }

/* 기간으로 필터한 데이터 (custom이면 TREND_FROM~TREND_TO) */
function trendInRange(){
  var b = rangeBounds(TREND_RANGE, TREND_FROM, TREND_TO);
  var from=b.from, to=b.to;
  var mine = myTrend();
  return {
    running: mine.running.filter(function(r){ var x=ymd(r.date); return x>=from && x<=to; }),
    weights: mine.weights.filter(function(w){ var x=ymd(w.date); return x>=from && x<=to; }),
    people: TREND.people||[],
  };
}
/* 로그인한 본인 기록만 (성과분석 요약·그래프·공유 카드용) */
function myTrend(){
  var me = ME ? ME.name : '';
  return {
    running: (TREND.running||[]).filter(function(r){ return r.who===me; }),
    weights: (TREND.weights||[]).filter(function(w){ return w.who===me; }),
    people: TREND.people||[],
  };
}
var TREND_FROM = '', TREND_TO = '';
function trendRangeBtns(){
  var opts = [['today','오늘'],['week','1주'],['month','1달'],['custom','기간 선택']];
  var seg = '<div class="seg" style="margin:14px 0 0">' + opts.map(function(o){
    return '<button class="chipbtn' + (TREND_RANGE===o[0]?' on':'') + '" onclick="trendSetRange(\'' + o[0] + '\')">' + o[1] + '</button>';
  }).join('') + '</div>';
  if(TREND_RANGE==='custom'){
    if(!TREND_TO) TREND_TO = todayStr(); if(!TREND_FROM) TREND_FROM = weekAgo(6);
    seg += '<div class="daterange">'
      + '<input type="date" value="' + esc(TREND_FROM) + '" max="' + todayStr() + '" onchange="TREND_FROM=this.value;drawTrend()">'
      + '<span>~</span>'
      + '<input type="date" value="' + esc(TREND_TO) + '" max="' + todayStr() + '" onchange="TREND_TO=this.value;drawTrend()">'
      + '</div>';
  }
  return seg;
}
function trendSetRange(v){ TREND_RANGE=v; if(v==='custom'){ if(!TREND_TO) TREND_TO=todayStr(); if(!TREND_FROM) TREND_FROM=weekAgo(6); } drawTrend(); }

/* 날짜 계산 (로컬 기준) */
function addDaysYmd(s, n){ var d=new Date(String(s).slice(0,10)+'T00:00:00'); d.setDate(d.getDate()+n); return localYmdStr(d); }
function daysBetween(a, b){ return Math.round((new Date(b+'T00:00:00') - new Date(a+'T00:00:00'))/86400000); }
var TREND_WPART = '';      // 무게 변화에서 고른 부위
var TREND_KEYS = [];       // 지금 보이는 기구 칩 목록 (index로 선택)
var TREND_RUNMODE = 'km';  // 런닝: km | kcal

function drawTrend(){
  var d = trendInRange();
  var mine = myTrend();
  var stat = computeStat(mine, TREND_RANGE, TREND_FROM, TREND_TO);
  // A. 이전 같은 길이의 기간과 비교
  var len = Math.max(1, daysBetween(stat.from, stat.to) + 1);
  var pTo = addDaysYmd(stat.from, -1), pFrom = addDaysYmd(pTo, -(len-1));
  var prev = computeStat(mine, 'custom', pFrom, pTo);
  var isToday = TREND_RANGE === 'today';
  var cmpLbl = isToday ? '어제 대비' : TREND_RANGE==='week' ? '지난 7일 대비' : TREND_RANGE==='month' ? '지난 30일 대비' : '이전 ' + len + '일 대비';

  var h =
    '<div class="card">'
    +   '<div class="row" style="justify-content:space-between;align-items:center">'
    +     '<h2 style="margin:0">성과 분석</h2>'
    +     '<button class="pillbtn" onclick="openShare()">' + ic('share-2') + ' 공유</button>'
    +   '</div>'
    +   trendRangeBtns()
    +   '<div class="statline">'
    +     statBox('운동', stat.sessions + '회', deltaTag(stat.sessions, prev.sessions, '회'))
    +     statBox('런닝', stat.km + 'km', deltaTag(stat.km, prev.km, 'km', true))
    +     statBox('총 세트', stat.sets + '세트', deltaTag(stat.sets, prev.sets, '세트'))
    +   '</div>'
    +   '<div class="cmplbl">' + esc(cmpLbl) + '</div>'
    +   '<div class="splitstat">'
    +     '<div class="ss"><span class="sslbl">상체</span><b>' + stat.upper.sets + '세트</b></div>'
    +     '<div class="ss"><span class="sslbl">하체</span><b>' + stat.lower.sets + '세트</b></div>'
    +   '</div>'
    + '</div>';

  var wInfo = null, rInfo = null;
  if(isToday){
    // F. 오늘은 그래프 대신 오늘 운동 요약
    TODAY_ROWS = todayDetailRows(d, mine, stat.from); TODAY_PAGE = 0;
    h += '<div class="card"><h2>' + ic('clipboard-list') + ' 오늘 한 운동'
      + (TODAY_ROWS.length ? ' <span class="muted" style="font-size:13px;font-weight:600">' + TODAY_ROWS.length + '개</span>' : '')
      + '</h2><div id="todayBody"></div></div>';
  } else {
    wInfo = weightSection(d);
    rInfo = runSection(d);
    h += '<div class="card"><h2>' + ic('dumbbell') + ' 무게 변화</h2>' + wInfo.html + '</div>'
      +  '<div class="card"><h2>' + ic('footprints') + ' 런닝 변화</h2>' + rInfo.html + '</div>';
  }
  // D. 부위 균형
  h += '<div class="card"><h2>' + ic('activity') + ' 부위별 세트</h2>' + partBalanceHtml(d.weights) + '</div>';
  // E. 주간 운동 횟수
  var wk = weekCounts();
  h += '<div class="card"><h2>' + ic('calendar-days') + ' 주간 운동 횟수</h2>'
    +  '<div class="tsum">이번 주 ' + hl(wk.thisWeek + '회') + ' · 지난주 ' + hl(wk.lastWeek + '회') + '</div>'
    +  '<div class="chartwrap"><canvas id="cWeek"></canvas></div></div>';

  $('trend').innerHTML = h;
  icons();
  hScrollInit();
  if(isToday) renderTodayPage();

  if(!window.Chart){ return; }
  TREND_CHARTS.forEach(function(c){ try{c.destroy();}catch(e){} }); TREND_CHARTS = [];
  if(wInfo && wInfo.dates.length >= 2) drawWeightChart(wInfo);
  if(rInfo && rInfo.dates.length) drawRunChart(rInfo);
  drawWeekChart(wk);
}

/* 증감 표시 ▲▼ */
function deltaTag(cur, prev, unit, dec){
  var f = dec ? 10 : 1;
  var diff = Math.round((Number(cur||0) - Number(prev||0)) * f) / f;
  if(!diff) return '<span class="dt same">변화 없음</span>';
  return '<span class="dt ' + (diff > 0 ? 'up' : 'down') + '">' + (diff > 0 ? '▲' : '▼') + Math.abs(diff) + unit + '</span>';
}
function statBox(label, val, extra){
  return '<div class="statbox"><div class="statval">' + esc(val) + '</div><div class="statlbl">' + esc(label) + '</div>' + (extra||'') + '</div>';
}

/* B. 무게 변화: 부위 칩 → 기구 칩 → 한 줄 결론 + 그래프 */
function weightSection(d){
  var keyPart = {};
  (d.weights||[]).forEach(function(w){ if(w.weight!=='' && w.weight!=null){ keyPart[w.equip + (w.move ? ' · ' + w.move : '')] = w.part; } });
  var allKeys = Object.keys(keyPart);
  if(!allKeys.length) return { html:'<p class="muted">이 기간엔 근력 운동 기록이 없어요.</p>', dates:[] };
  var parts = PARTS.filter(function(p){ return allKeys.some(function(k){ return keyPart[k]===p; }); });
  if(parts.indexOf(TREND_WPART) < 0) TREND_WPART = parts[0];
  TREND_KEYS = allKeys.filter(function(k){ return keyPart[k]===TREND_WPART; });
  if(TREND_KEYS.indexOf(TREND_EQUIP) < 0) TREND_EQUIP = TREND_KEYS[0];

  // 날짜별 최고 무게
  var byDate = {};
  d.weights.forEach(function(w){
    var k = w.equip + (w.move ? ' · ' + w.move : '');
    if(k !== TREND_EQUIP || w.weight==='' || w.weight==null) return;
    var dt = ymd(w.date), v = Number(w.weight)||0;
    if(byDate[dt]==null || v > byDate[dt]) byDate[dt] = v;
  });
  var dates = Object.keys(byDate).sort();
  var first = byDate[dates[0]], last = byDate[dates[dates.length-1]];
  var top = Math.max.apply(null, dates.map(function(x){ return byDate[x]; }));
  var sum;
  if(dates.length < 2){
    sum = '지금 ' + hl(last + 'kg') + ' · 기록이 2번 이상 쌓이면 그래프가 그려져요';
  } else {
    var diff = Math.round((last - first) * 10) / 10;
    sum = '처음 ' + hl(first + 'kg') + ' → 지금 ' + hl(last + 'kg') + ' '
      + (diff > 0 ? '(' + hl('+' + diff + 'kg') + ') 🔥' : diff < 0 ? '(' + diff + 'kg)' : '(유지)')
      + (top > last ? '<br><span class="muted">기간 최고 ' + top + 'kg</span>' : '');
  }
  var html =
    '<div class="wchips" style="margin-bottom:8px">' + parts.map(function(p){
      return '<button class="wchip' + (p===TREND_WPART?' on':'') + '" onclick="trendPickPart(\'' + esc(p) + '\')">' + esc(p) + '</button>';
    }).join('') + '</div>'
    + '<div class="hscroll" id="eqScrollWrap">'
    +   '<button class="hsbtn left" id="eqScrollL" onclick="hScroll(-1)" aria-label="왼쪽으로">‹</button>'
    +   '<div class="hchips" id="eqScroll" onscroll="hScrollArrows()">' + TREND_KEYS.map(function(k, i){
          return '<button class="wchip' + (k===TREND_EQUIP?' on':'') + '" onclick="trendPickEquip(' + i + ')">' + esc(k) + '</button>';
        }).join('') + '</div>'
    +   '<button class="hsbtn right" id="eqScrollR" onclick="hScroll(1)" aria-label="오른쪽으로">›</button>'
    + '</div>'
    + (TREND_KEYS.length > 1 ? '<div class="hshint" id="eqScrollHint">기구 ' + TREND_KEYS.length + '개 · 옆으로 넘겨서 골라요</div>' : '')
    + '<div class="tsum">' + sum + '</div>'
    + (dates.length >= 2 ? '<div class="chartwrap"><canvas id="cWeight"></canvas></div>' : '');
  return { html:html, dates:dates, byDate:byDate };
}
/* 기구 칩 가로 스크롤: 화살표로 넘기기 + 넘칠 때만 화살표 표시 */
function hScroll(dir){
  var el = $('eqScroll'); if(!el) return;
  el.scrollBy({ left: dir * Math.max(120, el.clientWidth * 0.7), behavior:'smooth' });
}
function hScrollArrows(){
  var el = $('eqScroll'), l = $('eqScrollL'), r = $('eqScrollR'), hint = $('eqScrollHint');
  if(!el || !l || !r) return;
  var over = el.scrollWidth > el.clientWidth + 2;
  l.classList.toggle('show', over && el.scrollLeft > 4);
  r.classList.toggle('show', over && el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  if(hint) hint.style.display = over ? '' : 'none';
}
function hScrollInit(){
  var el = $('eqScroll'); if(!el) return;
  var on = el.querySelector('.wchip.on');   // 고른 기구가 보이게
  if(on){ var x = on.offsetLeft - (el.clientWidth - on.offsetWidth) / 2; el.scrollLeft = Math.max(0, x); }
  hScrollArrows();
}
function trendPickPart(p){ TREND_WPART = p; TREND_EQUIP = ''; drawTrend(); }
function trendPickEquip(i){ TREND_EQUIP = TREND_KEYS[i] || ''; drawTrend(); }

/* C. 런닝 변화: 거리/칼로리 하나씩, 막대그래프 */
function runSection(d){
  var byDate = {};
  (d.running||[]).forEach(function(r){ var dt=ymd(r.date); byDate[dt]=byDate[dt]||{km:0,kcal:0}; byDate[dt].km+=Number(r.km)||0; byDate[dt].kcal+=Number(r.kcal)||0; });
  var dates = Object.keys(byDate).sort();
  if(!dates.length) return { html:'<p class="muted">이 기간엔 런닝 기록이 없어요.</p>', dates:[] };
  var isKm = TREND_RUNMODE === 'km';
  var total = 0; dates.forEach(function(x){ total += isKm ? byDate[x].km : byDate[x].kcal; });
  var avg = total / dates.length;
  var fix = function(n){ return isKm ? Math.round(n*10)/10 + 'km' : Math.round(n) + 'kcal'; };
  var html =
    '<div class="wchips" style="margin-bottom:8px">'
    +   '<button class="wchip' + (isKm?' on':'') + '" onclick="TREND_RUNMODE=\'km\';drawTrend()">거리</button>'
    +   '<button class="wchip' + (!isKm?' on':'') + '" onclick="TREND_RUNMODE=\'kcal\';drawTrend()">칼로리</button>'
    + '</div>'
    + '<div class="tsum">총 ' + hl(fix(total)) + ' · 1회 평균 ' + hl(fix(avg)) + ' <span class="muted">(' + dates.length + '회)</span></div>'
    + '<div class="chartwrap"><canvas id="cRun"></canvas></div>';
  return { html:html, dates:dates, byDate:byDate, isKm:isKm };
}

/* D. 부위별 세트 (가로 막대) */
function partBalanceHtml(weights){
  var cnt = {}; PARTS.forEach(function(p){ cnt[p] = 0; });
  (weights||[]).forEach(function(w){ if(cnt[w.part] != null) cnt[w.part]++; });
  var max = Math.max.apply(null, PARTS.map(function(p){ return cnt[p]; }));
  if(!max) return '<p class="muted">이 기간엔 근력 운동 기록이 없어요.</p>';
  var none = PARTS.filter(function(p){ return !cnt[p]; });
  return PARTS.map(function(p){
    return '<div class="pbrow"><span class="pbname">' + esc(p) + '</span>'
      + '<div class="pbbar"><span style="width:' + Math.round(cnt[p]/max*100) + '%"></span></div>'
      + '<span class="pbval">' + cnt[p] + '세트</span></div>';
  }).join('')
  + (none.length ? '<p class="muted" style="margin:10px 0 0">이 기간에 안 한 부위: <b style="color:var(--text)">' + esc(none.join(', ')) + '</b></p>' : '');
}

/* F. 오늘 한 운동 — 5개씩 페이지로 나눠 보기 */
var TODAY_ROWS = [], TODAY_PAGE = 0, TODAY_PER = 5;
function renderTodayPage(){
  var box = $('todayBody'); if(!box) return;
  if(!TODAY_ROWS.length){ box.innerHTML = '<p class="muted">오늘은 아직 기록이 없어요. 운동을 마치고 기록해 보세요 💪</p>'; return; }
  var pages = Math.ceil(TODAY_ROWS.length / TODAY_PER);
  if(TODAY_PAGE >= pages) TODAY_PAGE = pages - 1;
  var start = TODAY_PAGE * TODAY_PER;
  var html = TODAY_ROWS.slice(start, start + TODAY_PER).join('');
  if(pages > 1){
    html += '<div class="pager">'
      + '<button class="pgbtn" ' + (TODAY_PAGE===0?'disabled':'') + ' onclick="todayGo(' + (TODAY_PAGE-1) + ')" aria-label="이전">‹</button>';
    for(var i=0;i<pages;i++){
      html += '<button class="pgbtn' + (i===TODAY_PAGE?' on':'') + '" onclick="todayGo(' + i + ')">' + (i+1) + '</button>';
    }
    html += '<button class="pgbtn" ' + (TODAY_PAGE===pages-1?'disabled':'') + ' onclick="todayGo(' + (TODAY_PAGE+1) + ')" aria-label="다음">›</button>'
      + '</div>';
  }
  box.innerHTML = html;
}
function todayGo(p){ TODAY_PAGE = p; renderTodayPage(); }

/* 오늘 한 운동 행 목록 (지난번 같은 기구와 비교) */
function todayDetailRows(d, mine, today){
  var rows = [];
  (d.running||[]).forEach(function(r){ rows.push('<div class="tdrow"><div class="tdname">🏃 런닝</div><div class="tdval">' + esc(runText(r)) + '</div></div>'); });
  var groups = {}, order = [];
  (d.weights||[]).forEach(function(w){
    var k = w.equip + (w.move ? ' · ' + w.move : '');
    if(!groups[k]){ groups[k] = { sets:0, top:0 }; order.push(k); }
    groups[k].sets++;
    var v = Number(w.weight)||0; if(v > groups[k].top) groups[k].top = v;
  });
  order.forEach(function(k){
    // 오늘 이전 가장 최근 같은 기구의 최고 무게
    var prevDate = '', prevTop = 0;
    (mine.weights||[]).forEach(function(w){
      var kk = w.equip + (w.move ? ' · ' + w.move : ''), dt = ymd(w.date);
      if(kk !== k || dt >= today) return;
      var v = Number(w.weight)||0;
      if(dt > prevDate){ prevDate = dt; prevTop = v; } else if(dt === prevDate && v > prevTop){ prevTop = v; }
    });
    var g = groups[k];
    var tag = !prevDate ? '<span class="dt new">처음</span>' : deltaTag(g.top, prevTop, 'kg', true);
    rows.push('<div class="tdrow"><div class="tdname">🏋 ' + esc(k) + '</div>'
      + '<div class="tdval">' + g.sets + '세트' + (g.top ? ' · 최고 ' + g.top + 'kg' : '') + ' ' + tag + '</div></div>');
  });
  return rows;
}

/* E. 주간 운동 횟수 집계 (최근 8주, 사람별) */
function weekCounts(){
  var people = TREND.people || [];
  var weeks = []; for(var i=7;i>=0;i--){ weeks.push(weekStart(i)); }
  var days = {};
  (TREND.running||[]).concat(TREND.weights||[]).forEach(function(x){ days[ymd(x.date) + '|' + x.who] = 1; });
  var counts = {}; people.forEach(function(p){ counts[p] = weeks.map(function(){ return 0; }); });
  Object.keys(days).forEach(function(key){
    var parts = key.split('|'), wi = weeks.indexOf(weekStartOf(parts[0]));
    if(wi >= 0 && counts[parts[1]]) counts[parts[1]][wi]++;
  });
  var me = ME ? counts[ME.name] : null;
  return { people:people, weeks:weeks, counts:counts,
    thisWeek: me ? me[7] : 0, lastWeek: me ? me[6] : 0 };
}
function fmt(n){ n=Number(n)||0; return n>=1000 ? (Math.round(n/100)/10)+'k' : String(Math.round(n)); }
function addComma(n){ return String(Math.round(Number(n)||0)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function mdSlash(ymdStr){ var p=String(ymdStr||'').split('-'); return p.length>=3 ? (p[1]+'/'+p[2]) : String(ymdStr||''); }

/* 기구/동작 키 목록 (무게 데이터 있는 것만) */
function equipKeyList(weights){
  var keys = {};
  (weights||[]).forEach(function(w){ if(w.weight!=='' && w.weight!=null){ var k=w.equip + (w.move?' · '+w.move:''); keys[k]=1; } });
  return Object.keys(keys);
}

/* 기간 시작일 · range: 'today' | 'week' | 'month' | 'q' | 'all' */
function statFrom(range){
  if(range==='today') return todayStr();
  if(range==='week') return weekAgo(6);     // 오늘 포함 7일
  if(range==='month') return weekAgo(29);   // 오늘 포함 30일
  if(range==='q') return weekAgo(90);
  return '0000';
}
/* 범위 [from,to] 반환 (표시용). custom이면 지정값 사용 */
function rangeBounds(range, customFrom, customTo){
  var to = todayStr();
  if(range==='custom'){ return { from: customFrom||to, to: customTo||to }; }
  return { from: statFrom(range), to: to };
}
/* 통계 집계 — 세트수/총무게를 상체·하체로 분리. range='custom'이면 from2~to2 */
function computeStat(d, range, from2, to2){
  var b = rangeBounds(range, from2, to2);
  var from = b.from, to = b.to;
  var runs = (d.running||[]).filter(function(r){ var x=ymd(r.date); return x>=from && x<=to; });
  var wts = (d.weights||[]).filter(function(w){ var x=ymd(w.date); return x>=from && x<=to; });
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
    best:bestArr, byWho:byWho, from:from, to:to };
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

function drawWeightChart(info){
  // info = weightSection() 결과 { dates, byDate }
  var dates = info.dates, byDate = info.byDate;
  var ctx = $('cWeight'); if(!ctx) return;
  var opt = chartBase();
  opt.plugins.legend = { display:false };
  opt.plugins.tooltip.callbacks = { label:function(c){ return ' ' + c.parsed.y + 'kg'; } };
  opt.scales.y.ticks.callback = function(v){ return v + 'kg'; };
  TREND_CHARTS.push(new Chart(ctx, { type:'line',
    data:{ labels:dates.map(mdSlash), datasets:[{ data:dates.map(function(x){ return byDate[x]; }),
      borderColor:'#c6f432', backgroundColor:gradFill(ctx,'rgba(198,244,50,.3)'), borderWidth:3, tension:.3, fill:true,
      pointRadius:5, pointHoverRadius:7, pointBackgroundColor:'#c6f432', pointBorderColor:'#13161d', pointBorderWidth:2 }] },
    options:opt }));
}
function drawRunChart(info){
  var dates = info.dates, byDate = info.byDate, isKm = info.isKm;
  var ctx = $('cRun'); if(!ctx) return;
  var unit = isKm ? 'km' : 'kcal';
  var opt = chartBase();
  opt.plugins.legend = { display:false };
  opt.plugins.tooltip.callbacks = { label:function(c){ return ' ' + c.parsed.y + unit; } };
  opt.scales.y.beginAtZero = true;
  opt.scales.y.ticks.callback = function(v){ return v + unit; };
  TREND_CHARTS.push(new Chart(ctx, { type:'bar',
    data:{ labels:dates.map(mdSlash), datasets:[{
      data:dates.map(function(x){ return isKm ? Math.round(byDate[x].km*10)/10 : Math.round(byDate[x].kcal); }),
      backgroundColor: isKm ? '#49e39b' : '#ff8a5f', borderRadius:8, maxBarThickness:36 }] },
    options:opt }));
}
function drawWeekChart(wk){
  var colors = ['#c6f432','#49e39b'];
  var ctx = $('cWeek'); if(!ctx) return;
  var opt = chartBase();
  opt.scales.y.beginAtZero = true;
  opt.scales.y.ticks.stepSize = 1;
  opt.scales.y.ticks.precision = 0;
  TREND_CHARTS.push(new Chart(ctx, { type:'bar',
    data:{ labels:wk.weeks.map(function(w, i){ return i===7 ? '이번 주' : i===6 ? '지난주' : mdSlash(w); }),
      datasets:wk.people.map(function(p, i){
        return { label:p, data:wk.counts[p], backgroundColor:colors[i%colors.length], borderRadius:6, maxBarThickness:22 }; }) },
    options:opt }));
}
/* 주 시작(월요일) — 로컬 날짜 기준 (UTC 밀림 버그 수정) */
function weekStart(nAgo){ var d=new Date(); d.setDate(d.getDate()-nAgo*7); d.setDate(d.getDate()-((d.getDay()+6)%7)); return localYmdStr(d); }
function weekStartOf(dateStr){ var d=new Date(String(dateStr).slice(0,10)+'T00:00:00'); d.setDate(d.getDate()-((d.getDay()+6)%7)); return localYmdStr(d); }

/* ====================================================================
 * 공유 카드 (나이키 런닝 스타일 · 9:16 · 사진 위 통계)
 * ==================================================================== */
var SHARE_RANGE = 'week';   // week | month | custom
var SHARE_PHOTO = null;     // 배경 사진 base64 (선택)
var SHARE_FROM = '', SHARE_TO = '';
function openShare(){
  SHARE_RANGE='week'; SHARE_PHOTO=null;
  SHARE_TO = todayStr(); SHARE_FROM = weekAgo(6);
  var sh = $('shareModal');
  if(!sh){ sh=document.createElement('div'); sh.id='shareModal'; sh.className='modalwrap'; document.body.appendChild(sh); }
  sh.innerHTML =
    '<div class="modalbg" onclick="closeShare()"></div>'
    + '<div class="modalbox">'
    +   '<div class="modalhead"><b>📤 운동 카드 공유</b><button class="xbtn" onclick="closeShare()">✕</button></div>'
    +   '<div class="modalbody">'
    +     '<div class="seg" id="shareRange">'
    +       rangeBtn('today','오늘') + rangeBtn('week','이번 주') + rangeBtn('month','이번 달') + rangeBtn('custom','기간 선택')
    +     '</div>'
    +     '<div id="shareCustom">' + shareCustomHtml() + '</div>'
    +     '<div class="picker"><div class="picklabel">배경 사진 (선택 안 하면 기본 배경)</div>'
    +       '<button class="photobtn" onclick="openSharePhoto()">' + ic('camera') + ' 배경 사진 넣기</button>'
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
  icons();
}
function rangeBtn(v,label){ return '<button class="button ' + (SHARE_RANGE===v?'accent':'ghost') + '" style="flex:1;padding:12px 4px;font-size:13px" onclick="shareSetRange(\'' + v + '\')">' + esc(label) + '</button>'; }
function refreshShareSeg(){ $('shareRange').innerHTML = rangeBtn('today','오늘')+rangeBtn('week','이번 주')+rangeBtn('month','이번 달')+rangeBtn('custom','기간 선택'); }
function shareSetRange(v){ SHARE_RANGE=v; refreshShareSeg(); var c=$('shareCustom'); if(c) c.innerHTML=shareCustomHtml(); renderShareCard(); }
function shareCustomHtml(){
  if(SHARE_RANGE!=='custom') return '';
  return '<div class="daterange">'
    + '<input type="date" value="' + esc(SHARE_FROM) + '" max="' + todayStr() + '" onchange="SHARE_FROM=this.value;renderShareCard()">'
    + '<span>~</span>'
    + '<input type="date" value="' + esc(SHARE_TO) + '" max="' + todayStr() + '" onchange="SHARE_TO=this.value;renderShareCard()">'
    + '</div>';
}
function closeShare(){ var sh=$('shareModal'); if(sh) sh.classList.remove('on'); SHARE_PHOTO=null; }
function openSharePhoto(){ openPhotoSheetFor('share'); }
function wireSharePhoto(){
  ['file_share','cam_share'].forEach(function(id){
    var input=$(id); if(!input) return;
    input.onchange=function(){ var f=input.files&&input.files[0]; if(!f) return;
      shrinkImage(f, 1080, 0.82, function(data){ SHARE_PHOTO={data:data}; renderShareCard(); }); };
  });
}
/* 공유 모달용 사진 시트 (앨범/카메라) */
function openPhotoSheetFor(key){
  var sh=$('photoSheet');
  if(!sh){ sh=document.createElement('div'); sh.id='photoSheet'; sh.className='sheetwrap'; document.body.appendChild(sh); }
  sh.innerHTML='<div class="sheetbg" onclick="closePhotoSheet()"></div>'
    + '<div class="sheetbox"><div class="sheettitle">배경 사진</div>'
    + '<button class="sheetitem" onclick="pickFile(\'' + key + '\',true)">' + ic('camera') + ' 카메라로 촬영</button>'
    + '<button class="sheetitem" onclick="pickFile(\'' + key + '\',false)">' + ic('image') + ' 앨범에서 선택</button>'
    + '<button class="sheetitem cancel" onclick="closePhotoSheet()">취소</button></div>';
  sh.classList.add('on'); icons();
}

/* 9:16 카드를 캔버스에 그림 (미리보기 = 저장과 동일) */
function renderShareCard(){
  var cv = $('shareCanvas'); if(!cv) return;
  var W=1080, H=1920; cv.width=W; cv.height=H;
  var ctx = cv.getContext('2d');
  var s = computeStat(myTrend(), SHARE_RANGE, SHARE_FROM, SHARE_TO);
  var title = SHARE_RANGE==='today' ? '오늘' : SHARE_RANGE==='week' ? '이번 주' : SHARE_RANGE==='month' ? '이번 달' : '운동 요약';
  var showSessions = (SHARE_RANGE==='week' || SHARE_RANGE==='month');   // 오늘·기간선택엔 운동 횟수 숨김
  var periodTxt = mdSlash(s.from) + ' ~ ' + mdSlash(s.to);

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

    // 큰 숫자 (운동횟수는 주/달에만)
    var y=560;
    if(showSessions){ bigStat(ctx, pad, y, s.sessions, '회', '운동 횟수'); y+=260; }
    bigStat(ctx, pad, y, s.km, 'km', '런닝 거리'); y+=260;
    bigStat(ctx, pad, y, s.sets, '세트', '근력 운동');

    // 하단 기간 표시
    ctx.fillStyle='#9aa3b2'; ctx.font='600 36px "Gothic A1",sans-serif';
    ctx.fillText('📅 ' + periodTxt, pad, H-120);
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
function yesterdayStr(){ var d=new Date(); d.setDate(d.getDate()-1); return localYmdStr(d); }
function localYmdStr(d){ var z=function(n){return(n<10?'0':'')+n;}; return d.getFullYear()+'-'+z(d.getMonth()+1)+'-'+z(d.getDate()); }

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
  var ns=localYmdStr(d);
  if(ns > todayStr()) { toast('아직 오지 않은 날이에요'); return; }
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

  // 두 칸 영역 (위/아래) — 거의 정사각에 가깝게 해서 사진이 덜 잘리게
  var top=330, cellH=700, gap=36;
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
      var im=new Image();
      // base64면 CORS 없음(저장 가능). 혹시 드라이브 URL이면 crossOrigin 시도
      if(String(d.thumb).indexOf('data:')!==0) im.crossOrigin='anonymous';
      im.onload=function(){
        ctx.save(); roundRect(ctx,x,y,cw,cellH,r); ctx.clip();
        // 1) 배경: 같은 사진을 칸에 꽉 채우고 어둡게 (빈 공간 메우기용)
        var ir=im.width/im.height, cr=cw/cellH, sw,sh2,sx,sy;
        if(ir>cr){ sh2=im.height; sw=sh2*cr; sx=(im.width-sw)/2; sy=0; } else { sw=im.width; sh2=sw/cr; sx=0; sy=(im.height-sh2)/2; }
        ctx.drawImage(im, sx,sy,sw,sh2, x,y,cw,cellH);
        ctx.fillStyle='rgba(10,12,16,.72)'; ctx.fillRect(x,y,cw,cellH);
        // 2) 본 사진: 잘리지 않게 칸 안에 통째로 (확대 없음)
        var sc=Math.min(cw/im.width, cellH/im.height), dw=im.width*sc, dh=im.height*sc;
        ctx.drawImage(im, x+(cw-dw)/2, y+(cellH-dh)/2, dw, dh);
        var gg=ctx.createLinearGradient(0,y+cellH-200,0,y+cellH); gg.addColorStop(0,'rgba(0,0,0,0)'); gg.addColorStop(1,'rgba(0,0,0,.75)');
        ctx.fillStyle=gg; ctx.fillRect(x,y+cellH-200,cw,200);
        ctx.fillStyle='#fff'; ctx.font='800 52px "Gothic A1",sans-serif'; ctx.textAlign='left';
        ctx.fillText(d.who + (d.workout?'  ·  '+d.workout:''), x+34, y+cellH-40);
        if(d.type==='video'){ ctx.font='46px "Gothic A1",sans-serif'; ctx.fillText('▶', x+cw-70, y+60); }
        ctx.restore();
        finish();
      };
      im.onerror=function(){ drawDoneCell(ctx,x,y,cw,cellH,d); finish(); };
      im.src = String(d.thumb).indexOf('data:')===0 ? d.thumb : String(d.thumb).replace(/sz=w\d+/, 'sz=w800');
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


/* ====================================================================
 * 기록 관리 (삭제) — PIN 0000 → 본인 세션 체크 삭제
 * ==================================================================== */
var MANAGE_PIN = '0000';   // 공용 PIN (원하면 바꾸기)
var PIN_BUF = '';
var MANAGE_SESS = [];      // 본인 세션 목록
var MANAGE_SEL = {};       // 선택된 세션 id

function openPinPad(){
  toggleMenu(false);
  PIN_BUF = '';
  var sh = $('pinModal');
  if(!sh){ sh=document.createElement('div'); sh.id='pinModal'; sh.className='modalwrap'; document.body.appendChild(sh); }
  sh.innerHTML =
    '<div class="modalbg" onclick="closePin()"></div>'
    + '<div class="modalbox" style="max-width:340px">'
    +   '<div class="modalhead"><b>' + ic('lock') + ' 시스템 수정</b><button class="xbtn" onclick="closePin()">✕</button></div>'
    +   '<div class="modalbody" style="text-align:center">'
    +     '<p class="muted" style="margin:0 0 16px">비밀번호 4자리를 입력하세요</p>'
    +     '<div class="pindots" id="pinDots"></div>'
    +     '<div class="pinpad" id="pinPad"></div>'
    +   '</div>'
    + '</div>';
  sh.classList.add('on');
  renderPinDots();
  renderPinPad();
  icons();
}
function closePin(){ var sh=$('pinModal'); if(sh) sh.classList.remove('on'); }
function renderPinDots(){
  var el=$('pinDots'); if(!el) return;
  var s=''; for(var i=0;i<4;i++){ s += '<span class="pindot' + (i<PIN_BUF.length?' on':'') + '"></span>'; }
  el.innerHTML = s;
}
function renderPinPad(){
  var el=$('pinPad'); if(!el) return;
  var keys=['1','2','3','4','5','6','7','8','9','','0','del'];
  el.innerHTML = keys.map(function(k){
    if(k==='') return '<span></span>';
    if(k==='del') return '<button class="pinkey" onclick="pinPress(\'del\')">⌫</button>';
    return '<button class="pinkey" onclick="pinPress(\'' + k + '\')">' + k + '</button>';
  }).join('');
}
function pinPress(k){
  if(k==='del'){ PIN_BUF = PIN_BUF.slice(0,-1); renderPinDots(); return; }
  if(PIN_BUF.length>=4) return;
  PIN_BUF += k; renderPinDots();
  if(PIN_BUF.length===4){
    setTimeout(function(){
      if(PIN_BUF===MANAGE_PIN){ closePin(); openSystem(); }
      else { PIN_BUF=''; renderPinDots(); toast('비밀번호가 틀렸어요'); }
    }, 150);
  }
}

/* 기록 관리 화면 (본인 세션만) */
function openManage(){
  MANAGE_SEL = {};
  var sh = $('manageModal');
  if(!sh){ sh=document.createElement('div'); sh.id='manageModal'; sh.className='modalwrap'; document.body.appendChild(sh); }
  sh.innerHTML =
    '<div class="modalbg" onclick="closeManage()"></div>'
    + '<div class="modalbox">'
    +   '<div class="modalhead"><b>' + ic('trash-2') + ' 기록 삭제 (' + esc(ME.name) + ')</b><button class="xbtn" onclick="closeManage()">✕</button></div>'
    +   '<div class="modalbody" id="manageBody"><p class="muted">불러오는 중…</p></div>'
    + '</div>';
  sh.classList.add('on');
  call('listMySessions').then(function(list){
    MANAGE_SESS = list || [];
    renderManageList();
  }).catch(function(e){ var b=$('manageBody'); if(b) b.innerHTML='<p class="muted">오류: '+esc(e&&e.message||e)+'</p>'; });
}
function closeManage(){ var sh=$('manageModal'); if(sh) sh.classList.remove('on'); }
function renderManageList(){
  var b=$('manageBody'); if(!b) return;
  if(!MANAGE_SESS.length){ b.innerHTML='<p class="muted">삭제할 기록이 없어요.</p>'; return; }
  var selCount = Object.keys(MANAGE_SEL).length;
  b.innerHTML =
    '<p class="muted" style="margin:0 0 10px">지울 날짜를 체크한 뒤 삭제하세요. (사진도 함께 지워져요)</p>'
    + MANAGE_SESS.map(function(s){
      var bits=[]; if(s.nRun) bits.push('런닝'); if(s.nEquip) bits.push('웨이트 '+s.nEquip); if(s.hasPhoto) bits.push('오운완');
      return '<label class="mrow">'
        + '<input type="checkbox" ' + (MANAGE_SEL[s.id]?'checked':'') + ' onchange="toggleManage(\'' + s.id + '\')">'
        + '<div class="mrow-t"><b>' + esc(s.date) + '</b>' + (s.workout?' <span class="muted">· '+esc(s.workout)+'</span>':'') + '<br><span class="muted">' + esc(bits.join(' · ')||'기록') + '</span></div>'
        + '</label>';
    }).join('')
    + '<button class="button danger" style="width:100%;margin-top:14px"' + (selCount?'':' disabled') + ' onclick="doDeleteSelected()">' + ic('trash-2') + ' 선택 삭제 (' + selCount + ')</button>';
  icons();
}
function toggleManage(id){ if(MANAGE_SEL[id]) delete MANAGE_SEL[id]; else MANAGE_SEL[id]=1; renderManageList(); }
function doDeleteSelected(){
  var ids = Object.keys(MANAGE_SEL);
  if(!ids.length) return;
  if(!confirm(ids.length + '개 날짜의 기록을 삭제할까요? 사진까지 완전히 지워지고 되돌릴 수 없어요.')) return;
  cover(true, '삭제 중…');
  call('deleteSessions', ids).then(function(r){
    cover(false); toast((r&&r.deleted||0) + '개 삭제 완료');
    MANAGE_SEL={};
    call('listMySessions').then(function(list){ MANAGE_SESS=list||[]; renderManageList(); });
  }).catch(function(e){ cover(false); toast('삭제 실패: ' + (e&&e.message||e)); });
}


/* ====================================================================
 * 시스템 수정 메뉴 (PIN 통과 후) — 기록 관리 / 이름 변경
 * ==================================================================== */
function openSystem(){
  var sh = $('sysModal');
  if(!sh){ sh=document.createElement('div'); sh.id='sysModal'; sh.className='modalwrap'; document.body.appendChild(sh); }
  sh.innerHTML =
    '<div class="modalbg" onclick="closeSystem()"></div>'
    + '<div class="modalbox" style="max-width:380px">'
    +   '<div class="modalhead"><b>⚙ 시스템 수정</b><button class="xbtn" onclick="closeSystem()">✕</button></div>'
    +   '<div class="modalbody">'
    +     '<button class="sysitem" onclick="closeSystem();openManage()">' + ic('trash-2') + '<span><b>기록 관리</b><small>내 운동 기록을 골라서 삭제</small></span></button>'
    +     '<button class="sysitem" onclick="closeSystem();openRename()">' + ic('user-pen') + '<span><b>이름 변경</b><small>지금 이름: ' + esc(ME.name) + '</small></span></button>'
    +   '</div>'
    + '</div>';
  sh.classList.add('on'); icons();
}
function closeSystem(){ var sh=$('sysModal'); if(sh) sh.classList.remove('on'); }

/* 이름 변경 (로그인한 본인 이름만) */
function openRename(){
  var sh = $('renameModal');
  if(!sh){ sh=document.createElement('div'); sh.id='renameModal'; sh.className='modalwrap'; document.body.appendChild(sh); }
  sh.innerHTML =
    '<div class="modalbg" onclick="closeRename()"></div>'
    + '<div class="modalbox" style="max-width:380px">'
    +   '<div class="modalhead"><b>이름 변경</b><button class="xbtn" onclick="closeRename()">✕</button></div>'
    +   '<div class="modalbody">'
    +     '<div class="field"><label>내 이름 (최대 10자)</label><input id="renameInput" maxlength="10" value="' + esc(ME.name) + '"></div>'
    +     '<p class="muted" style="margin:0 0 12px">바꾸면 지난 기록, 오운완 카드, 대결 화면까지 전부 새 이름으로 나와요. 상대방 이름은 상대방이 직접 바꿔요.</p>'
    +     '<button class="button accent" style="width:100%" onclick="submitRename(event)">저장</button>'
    +   '</div>'
    + '</div>';
  sh.classList.add('on');
  var inp=$('renameInput'); if(inp){ inp.focus(); inp.select(); }
}
function closeRename(){ var sh=$('renameModal'); if(sh) sh.classList.remove('on'); }
function submitRename(ev){
  var name = ($('renameInput').value||'').trim();
  if(!name){ toast('이름을 입력해 주세요.'); return; }
  if(name === ME.name){ closeRename(); return; }
  var btn = ev && ev.target ? ev.target : null; busyBtn(btn,'저장 중…');
  cover(true,'이름 바꾸는 중…');
  call('renameMe', name).then(function(r){
    cover(false);
    ME.name = r.name; PEOPLE = r.people || PEOPLE;
    $('identity').innerHTML = '<b>' + esc(ME.name) + '</b><br>' + esc(ME.email);
    TREND = null;   // 성과분석 캐시 비움 (새 이름으로 다시 불러오기)
    closeRename(); toast('이름을 "' + ME.name + '"(으)로 바꿨어요.');
    switchTab(CUR_TAB);
  }).catch(function(e){ cover(false); unbusyBtn(btn); toast('변경 실패: ' + (e&&e.message||e)); });
}
