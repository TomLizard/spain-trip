# Spain Trip V4.1 — Private PWA

## 핵심 변경
- 일정/숙소 주소는 `itinerary.enc.json` 안에 AES-256-GCM으로 암호화
- PBKDF2-SHA256 310,000 iterations
- 저장소의 `index.html` / `app.js`에는 실제 일정과 숙소 주소가 없음
- iPhone 홈 화면 standalone PWA
- 완료 장소 체크 및 자동 저장
- Threads 스타일 지도 + 하단 번호 레일 + 장소 카드
- 현재 위치 / 숙소로 돌아가기 / 다음 장소 Google Maps 길찾기
- 일정 기준 예약시간: Prado, Royal Palace, Sagrada Família, Iryo
- 예약시간 로컬 수정
- Open-Meteo 기반 여행 날짜별 날씨 + 마지막 결과 캐시
- 주변 식당/카페/약국/마트 Google Maps 검색
- 오프라인 앱 셸, 네트워크 상태, 업데이트 확인
- 진행상황 JSON 백업/복원

## 중요: 현재 공개 저장소의 과거 기록
기존 공개 저장소에는 V3까지 일정과 정확한 숙소 주소가 평문으로 올라갔으므로,
파일만 V4로 교체해도 Git history에는 과거 평문이 남을 수 있습니다.

가장 간단한 정리:
1. 기존 `spain-trip` 저장소를 삭제
2. 같은 이름 `spain-trip`으로 새 Public 저장소 생성
3. 이 폴더의 파일만 새 저장소 root에 업로드
4. GitHub Pages를 main / root 로 다시 활성화

같은 저장소 이름을 재사용하면 Pages URL도 다시
`https://tomlizard.github.io/spain-trip/`
형태로 사용할 수 있습니다.

## 배포 파일
- index.html
- styles.css
- app.js
- itinerary.enc.json
- manifest.webmanifest
- sw.js
- icons/

## 보안 주의
- 여행 암호는 저장소/README/커밋 메시지에 절대 적지 마세요.
- "이 iPhone에서 잠금 해제 기억하기"를 켜면 파생 AES 키가 해당 브라우저의 localStorage에 저장됩니다.
  공개 GitHub에는 저장되지 않지만, 기기 접근 권한이 있는 사람에게는 보안 수준이 낮아질 수 있습니다.
- 더 강한 보안을 원하면 기억하기를 끄고 매번 암호를 입력하세요.

## PWA 업데이트
배포 파일을 교체한 뒤 앱 설정의 "앱 업데이트 확인"을 누르거나 앱을 완전히 종료 후 다시 실행하세요.

## V4.1 변경
- iPhone 15 Pro 폭 기준 날짜 탭/장소 번호 레일의 끝 항목까지 수평 스크롤 가능하도록 수정
- 카드/이동 영역의 가로 overflow 제거
- CARTO 지도 제거
- OpenFreeMap + MapLibre GL로 변경: API Key 불필요
- 지도 라벨은 `name:ko`가 있는 경우 한국어 우선 표시
- iOS 로컬 한글 글꼴 렌더링 적용
- Service Worker 캐시 버전 4.1 및 앱 파일 network-first 업데이트
