# BaaS (Battery as a Service) 분석 시스템

이 프로젝트는 전기차 배터리 데이터를 분석하고 점수를 계산하여 시각화하는 BaaS 분석 플랫폼입니다. 수집된 차량 주행 및 충전 데이터를 기반으로 배터리의 건강 상태와 효율성을 평가합니다.

## 프로젝트 구조

```text
c:\Users\jeon9\Downloads\Baas 분석\Baas 분석\
  ├── dashboard.py               # Flask 기반 웹 대시보드 서버
  ├── requirements.txt           # Python 라이브러리 의존성 파일
  │
  ├── db datasets/               # 분석을 위한 원천 CSV 데이터셋
  │   ├── battery_results.csv    # 배터리 분석 결과 요약
  │   └── *.result.csv           # 각 차종별(EV6, IONIQ5, Kona 등) 분석 데이터
  │
  ├── car_types/                 # 시스템에서 생성된 차종 및 연식 정보 관리
  │   └── betterwhy_cartype_list_*.csv
  │
  ├── results/                   # 배터리 점수 계산 최종 결과물 저장
  │   ├── vehicle_scores.csv     # 전체 차량 점수 결과
  │   └── betterwhy_cartype_list_*.csv
  │
  ├── templates/                 # 대시보드 HTML 템플릿 (dashboard.html)
  ├── static/                    # 대시보드 정적 리소스
  │   ├── css/                   # 스타일시트 (style.css)
  │   └── js/                    # 대시보드 프론트엔드 로직 (dashboard.js)
  │
  └── DATA_AVAILABILITY_PLAN.md  # 데이터 가용성 및 분석 계획 문서
```

## 주요 기능

### 1. 배터리 점수 계산 (vehicle_battery_scorer.py)
InfluxDB 또는 CSV 데이터를 활용하여 다음과 같은 5가지 핵심 지표를 기준으로 배터리 점수를 산출합니다:
- **효율 (Efficiency)**: 주행 거리 대비 전력 소모량 (km/kWh)
- **온도 (Temperature)**: 평균 운용 온도 관리 상태
- **셀 밸런스 (Cell Imbalance)**: 셀 전압 편차 (V)
- **주행 습관 (Driving Habit)**: 급가속/급감속 빈도 및 주행 패턴
- **충전 패턴 (Charging Pattern)**: SOC(충전 상태) 관리 및 충전 습관

### 2. 웹 대시보드 (dashboard.py)
분석된 결과를 웹 인터페이스를 통해 시각화합니다:
- 전체 차량 통계 및 상태 요약
- 차종별 배터리 성능 비교
- 차량별 상세 분석 정보 (효율, 온도, 셀 편차 등) 제공
- 데이터 완성도 및 수집 현황 모니터링

## 시작하기

### 환경 설정
필요한 패키지를 설치합니다:
```bash
pip install -r requirements.txt
```

### 배터리 점수 계산 실행
InfluxDB 데이터를 분석하여 점수를 생성합니다:
```bash
python vehicle_battery_scorer.py --output results/vehicle_scores.csv
```

### 대시보드 서버 실행
분석 결과를 웹에서 확인합니다:
```bash
python dashboard.py
```
브라우저에서 `http://localhost:5000`에 접속하여 확인할 수 있습니다.

## 데이터 분석 기준
- **매우 좋음 (A)**: 점수 85점 이상
- **좋음 (B)**: 70점 ~ 85점 미만
- **보통 (C)**: 55점 ~ 70점 미만
- **나쁨 (D)**: 55점 미만
- **연식 감점**: 차량 연식에 따른 성능 저하를 점수에 반영

