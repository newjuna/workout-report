// Firebase 설정값 (공개용 — 보안은 Firestore 규칙이 담당)
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyDY3nxigAwiixrrFsILrkmQv42FfW7QbNU",
  authDomain: "workout-report-cbdfe.firebaseapp.com",
  projectId: "workout-report-cbdfe",
  storageBucket: "workout-report-cbdfe.firebasestorage.app",
  messagingSenderId: "440349311228",
  appId: "1:440349311228:web:643facf6c4cf46e96d9779"
};

// 사진을 구글 드라이브에 저장하는 중계 Apps Script 주소 (/exec)
// → 사진 중계 Apps Script를 배포한 뒤, 거기서 받은 웹앱 URL을 여기에 붙여넣으세요.
window.APP_CONFIG = {
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbzNY4OgF3pq4oGW1RPNa4vlsxEkzcu4nXw_hcMEcVFybLdQIYz_BgZ2gjtotzl9j_rB/exec'
};

// 이 앱을 쓸 수 있는 사람 (구글 이메일 → 표시 이름)
// 아내 이메일이 정해지면 아래에 추가하세요. (Firestore 보안 규칙에도 같이 넣어야 함)
// 이름은 처음 한 번만 쓰이는 기본값이에요. 이후엔 앱의 '시스템 수정 → 이름 변경'에서 바꿔요.
window.ALLOWED_USERS = {
  'zxcv6309@gmail.com': '똠양꿍',
  'uyj1204@naver.com': '엄브렐라',
};
