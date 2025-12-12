# -*- coding: utf-8 -*-
"""
Baas Dashboard - 전기차 데이터 대시보드
"""
import configparser
import csv
import os
from datetime import datetime
from pathlib import Path
from flask import Flask, render_template, jsonify
from influxdb_client import InfluxDBClient
from collections import Counter, defaultdict

HERE = Path(__file__).resolve().parent
CFG = HERE / "config2.ini"

app = Flask(__name__, template_folder=str(HERE / "templates"), static_folder=str(HERE / "static"))

def _load_cfg():
    cfg = configparser.ConfigParser()
    if not cfg.read(CFG, encoding="utf-8"):
        raise FileNotFoundError(f"config2.ini not found at: {CFG}")
    if "influxdb" not in cfg:
        raise KeyError(f"[influxdb] section missing in {CFG}")
    for k in ("url", "token", "org", "bucket"):
        if k not in cfg["influxdb"]:
            raise KeyError(f"Missing key in [influxdb]: {k}")
    return (
        cfg["influxdb"]["url"],
        cfg["influxdb"]["token"],
        cfg["influxdb"]["org"],
        cfg["influxdb"]["bucket"],
    )

# 캐시 변수
_influxdb_cache = None
_cache_timestamp = None
_cache_ttl = 300  # 5분 캐시

def get_influxdb_stats():
    """InfluxDB 통계 조회 (캐싱 적용)"""
    global _influxdb_cache, _cache_timestamp
    
    # 캐시 확인
    if _influxdb_cache and _cache_timestamp:
        elapsed = (datetime.now() - _cache_timestamp).total_seconds()
        if elapsed < _cache_ttl:
            return _influxdb_cache
    
    try:
        URL, TOKEN, ORG, BUCKET = _load_cfg()
        with InfluxDBClient(url=URL, token=TOKEN, org=ORG, timeout=30_000) as client:
            # 전체 데이터 라인 수 조회 - 최근 30일만 샘플링하여 추정
            total_lines = 0
            try:
                flux_count = f'''
from(bucket:"{BUCKET}")
  |> range(start: -30d)
  |> count()
  |> sum()
'''
                for table in client.query_api().query(flux_count, org=ORG):
                    for record in table.records:
                        count = record.get_value()
                        if count:
                            # 30일 데이터를 기반으로 전체 추정 (대략적인 값)
                            total_lines = int(count) * 24  # 대략적인 추정값
                            break
            except Exception as e:
                print(f"[warn] 데이터 라인 수 조회 실패: {e}")
            
            # 고유 차량 수 조회 - 최근 7일만 조회
            unique_vehicles = set()
            try:
                flux_vehicles = f'''
from(bucket:"{BUCKET}")
  |> range(start: -7d)
  |> filter(fn:(r)=> r._measurement=="segment_stats_drive")
  |> keep(columns: ["car_id"])
  |> distinct(column: "car_id")
'''
                for table in client.query_api().query(flux_vehicles, org=ORG):
                    for record in table.records:
                        car_id = record.values.get("car_id")
                        if car_id:
                            unique_vehicles.add(str(car_id))
            except Exception as e:
                print(f"[warn] 차량 수 조회 실패: {e}")
            
            # 필드 수는 고정값 사용 (실제 조회는 너무 느림)
            field_count = 254
            
            result = {
                "total_lines": total_lines,
                "unique_vehicles": len(unique_vehicles),
                "field_count": field_count,
                "last_update": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            }
            
            # 캐시 저장
            _influxdb_cache = result
            _cache_timestamp = datetime.now()
            
            return result
    except Exception as e:
        print(f"[error] InfluxDB 통계 조회 실패: {e}")
        return {
            "total_lines": 0,
            "unique_vehicles": 0,
            "field_count": 254,
            "last_update": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }

def save_car_types_to_csv():
    """차종 데이터를 파싱해서 car_types 디렉토리에 CSV로 저장 - 캐시된 CSV 데이터 사용"""
    all_rows = _read_all_csv_data()
    
    if not all_rows:
        return
    
    output_dir = HERE / "car_types"
    output_dir.mkdir(exist_ok=True)
    
    # 파일명은 현재 날짜 사용
    today = datetime.now()
    output_file = output_dir / f"betterwhy_cartype_list_{today.strftime('%Y%m%d')}.csv"
    
    car_data = []
    seen_car_ids = set()
    
    for row in all_rows:
        car_id = row.get("car_id", "").strip() or row.get("client_id", "").strip()
        car_type = row.get("car_type", "").strip()
        model_year = row.get("model_year", "").strip()
        model_month = row.get("model_month", "").strip()
        
        if car_id and car_id not in seen_car_ids:
            seen_car_ids.add(car_id)
            
            # model_year와 model_month 처리 (소수점 제거)
            year = ""
            month = ""
            if model_year:
                try:
                    year = str(int(float(model_year)))
                except:
                    year = model_year
            if model_month:
                try:
                    month = f"{int(float(model_month)):02d}"
                except:
                    month = model_month
            
            car_data.append({
                "client_id": car_id,
                "car_type": car_type,
                "model_year": year,
                "model_month": month
            })
    
    # CSV 파일로 저장
    try:
        with open(output_file, "w", newline="", encoding="utf-8-sig") as f:
            writer = csv.DictWriter(f, fieldnames=["client_id", "car_type", "model_year", "model_month"])
            writer.writeheader()
            writer.writerows(car_data)
        print(f"[info] 차종 데이터 저장 완료: {output_file} ({len(car_data)}개 차량)")
    except Exception as e:
        print(f"[error] CSV 저장 실패: {e}")

def _read_all_csv_data():
    """모든 CSV 파일을 한 번만 읽어서 메모리에 저장 (캐싱)"""
    global _csv_cache, _csv_cache_timestamp
    
    cache_key = 'all_csv_data'
    now = datetime.now()
    
    if cache_key in _csv_cache and cache_key in _csv_cache_timestamp:
        elapsed = (now - _csv_cache_timestamp[cache_key]).total_seconds()
        if elapsed < _csv_cache_ttl:
            return _csv_cache[cache_key]
    
    datasets_dir = HERE / "db datasets"
    if not datasets_dir.exists():
        return []
    
    all_rows = []
    seen_car_ids = set()
    csv_files = list(datasets_dir.glob("*.csv"))
    
    for csv_path in csv_files:
        try:
            with open(csv_path, "r", encoding="utf-8-sig") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    car_id = row.get("car_id", "").strip() or row.get("client_id", "").strip()
                    if car_id and car_id not in seen_car_ids:
                        seen_car_ids.add(car_id)
                        all_rows.append(row)
        except Exception as e:
            print(f"[warn] CSV 파일 읽기 실패 {csv_path}: {e}")
            continue
    
    _csv_cache[cache_key] = all_rows
    _csv_cache_timestamp[cache_key] = now
    return all_rows

def get_vehicle_type_stats():
    """차종별 차량 수 통계 - 캐시된 CSV 데이터 사용"""
    all_rows = _read_all_csv_data()
    
    car_types = []
    for row in all_rows:
        car_type = row.get("car_type", "").strip()
        if car_type:
            car_types.append(car_type)
    
    # 차종별 카운트
    counter = Counter(car_types)
    total = len(car_types)
    
    # 비율 계산하여 정렬
    stats = []
    for car_type, count in counter.most_common():
        percentage = (count / total * 100) if total > 0 else 0
        stats.append({
            "car_type": car_type,
            "count": count,
            "percentage": round(percentage, 1)
        })
    
    return stats

def get_recent_csv_files():
    """최근 CSV 파일 목록 (MinIO 시뮬레이션)"""
    results_dir = HERE / "db datasets"
    csv_files = []
    
    if results_dir.exists():
        for file_path in results_dir.glob("*.csv"):
            try:
                stat = file_path.stat()
                size_mb = stat.st_size / (1024 * 1024)
                modified_time = datetime.fromtimestamp(stat.st_mtime)
                
                # 파일명에서 차량 정보 추출
                filename = file_path.name
                parts = filename.replace(".csv", "").split("_")
                car_id = parts[0] if parts else "Unknown"
                car_type = parts[1] if len(parts) > 1 else "Unknown"
                year = parts[2] if len(parts) > 2 else ""
                
                csv_files.append({
                    "filename": filename,
                    "car_id": car_id,
                    "car_type": car_type,
                    "year": year,
                    "size_mb": round(size_mb, 1),
                    "modified_time": modified_time.strftime("%Y-%m-%d %H:%M:%S")
                })
            except Exception as e:
                print(f"[warn] 파일 정보 읽기 실패 {file_path}: {e}")
    
    # 수정 시간 기준 정렬 (최신순)
    csv_files.sort(key=lambda x: x["modified_time"], reverse=True)
    return csv_files[:20]  # 최근 20개만

def get_data_completeness():
    """데이터 완성도 분석 - 캐시된 CSV 데이터 사용"""
    all_rows = _read_all_csv_data()
    
    plenty = 0
    normal = 0
    empty = 0
    
    for row in all_rows:
        # 효율 데이터 기준으로 완성도 판단
        efficiency = row.get("efficiency", "").strip()
        charging_count = row.get("charging_count", "").strip()
        
        if not efficiency or efficiency == "" or efficiency == "None":
            empty += 1
        elif charging_count and charging_count != "":
            try:
                if int(float(charging_count)) > 100:
                    plenty += 1
                else:
                    normal += 1
            except (ValueError, TypeError):
                normal += 1
        else:
            normal += 1
    
    total = plenty + normal + empty
    return {
        "plenty": plenty,
        "normal": normal,
        "empty": empty,
        "total": total,
        "plenty_pct": round(plenty / total * 100, 1) if total > 0 else 0,
        "normal_pct": round(normal / total * 100, 1) if total > 0 else 0,
        "empty_pct": round(empty / total * 100, 1) if total > 0 else 0
    }

def get_vehicle_performance_data():
    """차량별 배터리 성능 데이터 - 캐시된 CSV 데이터 사용"""
    all_rows = _read_all_csv_data()
    
    if not all_rows:
        return {
            "vehicles": [],
            "summary": {
                "total": 0,
                "excellent": 0,
                "good": 0,
                "normal": 0,
                "bad": 0
            },
            "stats": {
                "total_mileage": 0,
                "avg_efficiency": 0,
                "avg_battery_health": 0
            }
        }
    
    vehicles = []
    excellent = 0
    good = 0
    normal = 0
    bad = 0
    total_mileage = 0
    total_efficiency = 0
    total_score = 0
    efficiency_count = 0
    
    for row in all_rows:
        try:
            car_id = row.get("car_id", "").strip() or row.get("client_id", "").strip()
            car_type = row.get("car_type", "").strip()
            final_score = row.get("final_score", "").strip()
            efficiency = row.get("efficiency", "").strip()
            avg_charging = row.get("avg_charging_amount", "").strip()
            age_string = row.get("age_string", "").strip()
            collection_period = row.get("collection_period", "").strip()
            last_date = row.get("last_date", "").strip()
            
            if not car_id or not final_score:
                continue
            
            score = float(final_score)
            
            # 등급 분류
            if score >= 85:
                grade = "매우 좋음"
                excellent += 1
            elif score >= 70:
                grade = "좋음"
                good += 1
            elif score >= 55:
                grade = "보통"
                normal += 1
            else:
                grade = "나쁨"
                bad += 1
            
            # 마지막 충전일 계산
            last_charge_days = None
            last_charge_kwh = None
            if last_date:
                try:
                    from datetime import datetime
                    last_dt = datetime.fromisoformat(last_date.replace('Z', '+00:00'))
                    now = datetime.now(last_dt.tzinfo)
                    days_diff = (now - last_dt).days
                    last_charge_days = f"{days_diff}일 전"
                except:
                    pass
            
            if avg_charging:
                try:
                    last_charge_kwh = f"{float(avg_charging):.2f} kWh"
                except:
                    pass
            
            last_charge_str = last_charge_days
            if last_charge_kwh:
                last_charge_str = f"{last_charge_days} / {last_charge_kwh}" if last_charge_days else last_charge_kwh
            
            vehicles.append({
                "car_id": car_id,
                "car_type": car_type,
                "final_score": round(score, 1),
                "grade": grade,
                "efficiency": round(float(efficiency), 2) if efficiency else None,
                "last_charge": last_charge_str,
                "age_string": age_string,
                "collection_period": collection_period
            })
            
            total_score += score
            if efficiency:
                try:
                    total_efficiency += float(efficiency)
                    efficiency_count += 1
                except:
                    pass
        except Exception as e:
            print(f"[warn] 차량 데이터 처리 실패: {e}")
            continue
    
    # 통계 계산
    avg_efficiency = total_efficiency / efficiency_count if efficiency_count > 0 else 0
    avg_battery_health = total_score / len(vehicles) if vehicles else 0
    
    # 총 주행거리는 추정값 (실제 데이터가 없으므로)
    total_mileage = len(vehicles) * 47000  # 대략적인 추정
    
    return {
        "vehicles": vehicles,
        "summary": {
            "total": len(vehicles),
            "excellent": excellent,
            "good": good,
            "normal": normal,
            "bad": bad
        },
        "stats": {
            "total_mileage": total_mileage,
            "avg_efficiency": round(avg_efficiency, 1),
            "avg_battery_health": round(avg_battery_health, 1)
        }
    }

def get_battery_score_stats(car_type=None):
    """배터리 점수 통계 - 캐시된 CSV 데이터 사용
    
    Args:
        car_type: 차종 필터 (None이면 전체 차종)
    """
    all_rows = _read_all_csv_data()
    
    if not all_rows:
        return None
    
    # 차종 필터링
    if car_type and car_type != 'all':
        all_rows = [row for row in all_rows if row.get("car_type", "").strip() == car_type]
    
    if not all_rows:
        return None
    
    scores = {
        "efficiency_scores": [],
        "temperature_scores": [],
        "cell_imbalance_scores": [],
        "driving_habit_scores": [],
        "charging_pattern_scores": [],
        "final_scores": [],
        "age_penalties": []
    }
    
    for row in all_rows:
        # 각 점수 수집
        try:
            eff_score = row.get("efficiency_score", "").strip()
            if eff_score:
                scores["efficiency_scores"].append(float(eff_score))
        except:
            pass
        
        try:
            temp_score = row.get("temperature_score", "").strip()
            if temp_score:
                scores["temperature_scores"].append(float(temp_score))
        except:
            pass
        
        try:
            cell_score = row.get("cell_imbalance_score", "").strip()
            if cell_score:
                scores["cell_imbalance_scores"].append(float(cell_score))
        except:
            pass
        
        try:
            driving_score = row.get("driving_habit_score", "").strip()
            if driving_score:
                scores["driving_habit_scores"].append(float(driving_score))
        except:
            pass
        
        try:
            charging_score = row.get("charging_pattern_score", "").strip()
            if charging_score:
                scores["charging_pattern_scores"].append(float(charging_score))
        except:
            pass
        
        try:
            final_score = row.get("final_score", "").strip()
            if final_score:
                scores["final_scores"].append(float(final_score))
        except:
            pass
        
        try:
            age_penalty = row.get("age_penalty", "").strip()
            if age_penalty:
                scores["age_penalties"].append(float(age_penalty))
        except:
            pass
    
    # 평균값 계산
    def avg(lst):
        return sum(lst) / len(lst) if lst else 0.0
    
    def percentile(lst, val):
        """값의 백분위 계산"""
        if not lst or not val:
            return 0
        sorted_lst = sorted(lst)
        count_below = sum(1 for x in sorted_lst if x < val)
        return round((count_below / len(sorted_lst)) * 100, 0) if sorted_lst else 0
    
    avg_final = avg(scores["final_scores"])
    avg_eff = avg(scores["efficiency_scores"])
    avg_temp = avg(scores["temperature_scores"])
    avg_cell = avg(scores["cell_imbalance_scores"])
    avg_driving = avg(scores["driving_habit_scores"])
    avg_charging = avg(scores["charging_pattern_scores"])
    avg_penalty = avg(scores["age_penalties"])
    
    # 가중 평균 계산 (이미지 기준)
    weighted_avg = (avg_eff * 0.30 + avg_temp * 0.15 + avg_cell * 0.15 + 
                    avg_driving * 0.15 + avg_charging * 0.15) / 0.90
    
    # 감점 계산 (100점 기준에서 각 항목 점수 차이)
    penalty_eff = max(0, 100 - avg_eff) * 0.30
    penalty_temp = max(0, 100 - avg_temp) * 0.15
    penalty_cell = max(0, 100 - avg_cell) * 0.15
    penalty_driving = max(0, 100 - avg_driving) * 0.15
    penalty_charging = max(0, 100 - avg_charging) * 0.15
    
    return {
        "final_score": round(avg_final, 1),
        "weighted_avg": round(weighted_avg, 1),
        "reliability": "높음" if len(scores["final_scores"]) > 100 else "보통",
        "scores": {
            "efficiency": round(avg_eff, 1),
            "temperature": round(avg_temp, 1),
            "cell_imbalance": round(avg_cell, 1),
            "driving_habit": round(avg_driving, 1),
            "charging_pattern": round(avg_charging, 1)
        },
        "penalties": {
            "efficiency": round(penalty_eff, 1),
            "temperature": round(penalty_temp, 1),
            "cell_imbalance": round(penalty_cell, 1),
            "driving_habit": round(penalty_driving, 1),
            "charging_pattern": round(penalty_charging, 1),
            "age": round(avg_penalty, 1),
            "total": round(penalty_eff + penalty_temp + penalty_cell + penalty_driving + penalty_charging + avg_penalty, 1)
        },
        "percentiles": {
            "efficiency": percentile(scores["efficiency_scores"], avg_eff),
            "temperature": percentile(scores["temperature_scores"], avg_temp),
            "cell_imbalance": percentile(scores["cell_imbalance_scores"], avg_cell),
            "driving_habit": percentile(scores["driving_habit_scores"], avg_driving),
            "charging_pattern": percentile(scores["charging_pattern_scores"], avg_charging)
        }
    }

@app.route('/')
def index():
    """대시보드 메인 페이지"""
    return render_template('dashboard.html')

# CSV 데이터 캐시
_csv_cache = {}
_csv_cache_timestamp = {}
_csv_cache_ttl = 60  # 1분 캐시

def _get_csv_data(cache_key, func, *args, **kwargs):
    """CSV 데이터 캐싱 헬퍼 함수"""
    global _csv_cache, _csv_cache_timestamp
    
    now = datetime.now()
    if cache_key in _csv_cache and cache_key in _csv_cache_timestamp:
        elapsed = (now - _csv_cache_timestamp[cache_key]).total_seconds()
        if elapsed < _csv_cache_ttl:
            return _csv_cache[cache_key]
    
    result = func(*args, **kwargs)
    _csv_cache[cache_key] = result
    _csv_cache_timestamp[cache_key] = now
    return result

@app.route('/api/stats')
def api_stats():
    """통계 데이터 API"""
    from flask import request
    # 차종 데이터 저장은 하루에 한 번만 (파일 존재 확인)
    today = datetime.now().strftime('%Y%m%d')
    output_file = HERE / "car_types" / f"betterwhy_cartype_list_{today}.csv"
    if not output_file.exists():
        save_car_types_to_csv()
    
    # 차종 필터 파라미터 받기 (옵션)
    car_type = request.args.get('car_type', None)
    
    # 캐싱된 데이터 사용
    influx_stats = get_influxdb_stats()
    vehicle_stats = _get_csv_data('vehicle_types', get_vehicle_type_stats)
    completeness = _get_csv_data('completeness', get_data_completeness)
    
    # 차종별 배터리 점수는 캐시 키에 차종 포함
    cache_key = f'battery_score_{car_type or "all"}'
    battery_score = _get_csv_data(cache_key, lambda: get_battery_score_stats(car_type))
    
    # DB 개수 고정값
    csv_count = 3
    
    # 총 용량 계산 (GB) - 캐싱
    results_dir = HERE / "db datasets"
    total_size_gb = _get_csv_data('total_size', lambda: (
        round(sum(f.stat().st_size for f in results_dir.glob("*") if f.is_file()) / (1024 ** 3), 1)
        if results_dir.exists() else 0
    ))
    
    # 차량별 배터리 성능 데이터
    vehicle_performance = _get_csv_data('vehicle_performance', get_vehicle_performance_data)
    
    return jsonify({
        "influxdb": {
            "total_lines": influx_stats["total_lines"],
            "unique_vehicles": influx_stats["unique_vehicles"],
            "field_count": influx_stats["field_count"],
            "csv_count": csv_count,
            "total_size_gb": total_size_gb,
            "last_update": influx_stats["last_update"]
        },
        "vehicle_types": vehicle_stats,
        "recent_files": [],  # 사용하지 않으므로 빈 배열
        "completeness": completeness,
        "battery_score": battery_score,
        "vehicle_performance": vehicle_performance
    })

@app.route('/api/vehicle-detail/<car_id>')
def api_vehicle_detail(car_id):
    """차량 상세 정보 API"""
    all_rows = _read_all_csv_data()
    
    # 해당 차량 찾기
    vehicle_row = None
    for row in all_rows:
        row_car_id = row.get("car_id", "").strip() or row.get("client_id", "").strip()
        if row_car_id == car_id:
            vehicle_row = row
            break
    
    if not vehicle_row:
        return jsonify({"error": "차량을 찾을 수 없습니다"}), 404
    
    # 차량 기본 정보
    car_type = vehicle_row.get("car_type", "").strip()
    age_string = vehicle_row.get("age_string", "").strip()
    collection_period = vehicle_row.get("collection_period", "").strip()
    first_date = vehicle_row.get("first_date", "").strip()
    last_date = vehicle_row.get("last_date", "").strip()
    model_year = vehicle_row.get("model_year", "").strip()
    model_month = vehicle_row.get("model_month", "").strip()
    
    # 데이터 Row 수 (추정값 - 실제로는 InfluxDB에서 조회해야 함)
    # 일단 CSV에서 charging_count를 기반으로 추정
    charging_count = vehicle_row.get("charging_count", "").strip()
    try:
        charge_cnt = int(float(charging_count)) if charging_count else 0
        # 주행 구간은 충전 구간의 약 50배로 추정
        drive_count = charge_cnt * 50 if charge_cnt > 0 else 0
        # 주차 구간은 주행 구간의 약 0.6배로 추정
        parking_count = int(drive_count * 0.6) if drive_count > 0 else 0
        # 급속/완속 충전은 charging_count를 분할 (추정)
        fast_charge = int(charge_cnt * 0.55) if charge_cnt > 0 else 0
        slow_charge = charge_cnt - fast_charge if charge_cnt > 0 else 0
    except:
        drive_count = 0
        parking_count = 0
        fast_charge = 0
        slow_charge = 0
    
    # 총 Row 수 (추정)
    total_rows = drive_count + parking_count + fast_charge + slow_charge
    
    # 배터리 점수 정보
    final_score = float(vehicle_row.get("final_score", "0").strip() or "0")
    efficiency_score = float(vehicle_row.get("efficiency_score", "0").strip() or "0")
    temperature_score = float(vehicle_row.get("temperature_score", "0").strip() or "0")
    cell_imbalance_score = float(vehicle_row.get("cell_imbalance_score", "0").strip() or "0")
    driving_habit_score = float(vehicle_row.get("driving_habit_score", "0").strip() or "0")
    charging_pattern_score = float(vehicle_row.get("charging_pattern_score", "0").strip() or "0")
    age_penalty = float(vehicle_row.get("age_penalty", "0").strip() or "0")
    
    # 감점 계산
    penalty_eff = max(0, 100 - efficiency_score) * 0.30
    penalty_temp = max(0, 100 - temperature_score) * 0.15
    penalty_cell = max(0, 100 - cell_imbalance_score) * 0.15
    penalty_driving = max(0, 100 - driving_habit_score) * 0.15
    penalty_charging = max(0, 100 - charging_pattern_score) * 0.15
    
    # 백분위 계산 (전체 차량 대비)
    all_scores = {
        "efficiency": [],
        "temperature": [],
        "cell_imbalance": [],
        "driving_habit": [],
        "charging_pattern": []
    }
    
    for row in all_rows:
        try:
            if row.get("efficiency_score", "").strip():
                all_scores["efficiency"].append(float(row.get("efficiency_score", "0").strip()))
            if row.get("temperature_score", "").strip():
                all_scores["temperature"].append(float(row.get("temperature_score", "0").strip()))
            if row.get("cell_imbalance_score", "").strip():
                all_scores["cell_imbalance"].append(float(row.get("cell_imbalance_score", "0").strip()))
            if row.get("driving_habit_score", "").strip():
                all_scores["driving_habit"].append(float(row.get("driving_habit_score", "0").strip()))
            if row.get("charging_pattern_score", "").strip():
                all_scores["charging_pattern"].append(float(row.get("charging_pattern_score", "0").strip()))
        except:
            pass
    
    def percentile(lst, val):
        if not lst or not val:
            return 0
        sorted_lst = sorted(lst)
        count_below = sum(1 for x in sorted_lst if x < val)
        return round((count_below / len(sorted_lst)) * 100, 0) if sorted_lst else 0
    
    percentiles = {
        "efficiency": percentile(all_scores["efficiency"], efficiency_score),
        "temperature": percentile(all_scores["temperature"], temperature_score),
        "cell_imbalance": percentile(all_scores["cell_imbalance"], cell_imbalance_score),
        "driving_habit": percentile(all_scores["driving_habit"], driving_habit_score),
        "charging_pattern": percentile(all_scores["charging_pattern"], charging_pattern_score)
    }
    
    # 기여도 상세 (평균값 및 기여도 계산)
    efficiency = vehicle_row.get("efficiency", "").strip()
    avg_temperature = vehicle_row.get("avg_temperature", "").strip()
    cell_imbalance = vehicle_row.get("cell_imbalance", "").strip()
    
    # 연식 정보
    age_years = float(vehicle_row.get("age_years", "0").strip() or "0")
    
    # 기여도 계산 (가중치 적용)
    contribution_eff = efficiency_score * 0.30
    contribution_temp = temperature_score * 0.15
    contribution_cell = cell_imbalance_score * 0.15
    contribution_driving = driving_habit_score * 0.15
    contribution_charging = charging_pattern_score * 0.15
    
    # 점수 변화량 (임시로 0으로 설정, 실제로는 이전 값과 비교 필요)
    change_eff = 0.0  # 실제로는 이전 점수와 비교
    change_temp = 0.0
    change_cell = 0.0
    change_driving = 0.0
    change_charging = 0.0
    
    return jsonify({
        "basic_info": {
            "car_id": car_id,
            "car_type": car_type,
            "age_string": age_string,
            "model_year": model_year,
            "model_month": model_month,
            "collection_period": collection_period,
            "first_date": first_date,
            "last_date": last_date,
            "total_rows": total_rows
        },
        "section_counts": {
            "drive": drive_count,
            "parking": parking_count,
            "fast_charge": fast_charge,
            "slow_charge": slow_charge
        },
        "battery_score": {
            "final_score": round(final_score, 1),
            "scores": {
                "efficiency": round(efficiency_score, 1),
                "temperature": round(temperature_score, 1),
                "cell_imbalance": round(cell_imbalance_score, 1),
                "driving_habit": round(driving_habit_score, 1),
                "charging_pattern": round(charging_pattern_score, 1)
            },
            "penalties": {
                "efficiency": round(penalty_eff, 1),
                "temperature": round(penalty_temp, 1),
                "cell_imbalance": round(penalty_cell, 1),
                "driving_habit": round(penalty_driving, 1),
                "charging_pattern": round(penalty_charging, 1),
                "age": round(age_penalty, 1),
                "total": round(penalty_eff + penalty_temp + penalty_cell + penalty_driving + penalty_charging + age_penalty, 1)
            },
            "percentiles": percentiles
        },
        "contribution_details": {
            "efficiency": {
                "score": round(efficiency_score, 1),
                "change": round(change_eff, 1),
                "value": round(float(efficiency), 2) if efficiency else None,
                "unit": "km/kWh",
                "percentile": percentiles["efficiency"],
                "contribution": round(contribution_eff, 1),
                "summary": f"효율 {round(float(efficiency), 2) if efficiency else 'N/A'} km/kWh → 점수 {round(efficiency_score, 1)} (백분위 {percentiles['efficiency']}%) · 기여 {round(contribution_eff, 1)}점" if efficiency else "효율 데이터 없음"
            },
            "temperature": {
                "score": round(temperature_score, 1),
                "change": round(change_temp, 1),
                "value": round(float(avg_temperature), 1) if avg_temperature else None,
                "unit": "℃",
                "percentile": percentiles["temperature"],
                "contribution": round(contribution_temp, 1),
                "summary": f"평균 온도 {round(float(avg_temperature), 1) if avg_temperature else 'N/A'}℃ → 점수 {round(temperature_score, 1)} (백분위 {percentiles['temperature']}%) · 기여 {round(contribution_temp, 1)}점" if avg_temperature else "온도 데이터 없음"
            },
            "cell_imbalance": {
                "score": round(cell_imbalance_score, 1),
                "change": round(change_cell, 1),
                "value": round(float(cell_imbalance), 4) if cell_imbalance else None,
                "unit": "V",
                "percentile": percentiles["cell_imbalance"],
                "contribution": round(contribution_cell, 1),
                "summary": f"평균 셀 편차 {round(float(cell_imbalance), 4) if cell_imbalance else 'N/A'} V → 점수 {round(cell_imbalance_score, 1)} (백분위 {percentiles['cell_imbalance']}%) · 기여 {round(contribution_cell, 1)}점" if cell_imbalance else "셀 밸런스 데이터 없음"
            },
            "driving_habit": {
                "score": round(driving_habit_score, 1),
                "change": round(change_driving, 1),
                "value": round(driving_habit_score, 1),
                "unit": "점",
                "percentile": percentiles["driving_habit"],
                "contribution": round(contribution_driving, 1),
                "summary": f"가속/감속 변동 기반 → 점수 {round(driving_habit_score, 1)} (백분위 {percentiles['driving_habit']}%) · 기여 {round(contribution_driving, 1)}점"
            },
            "charging_pattern": {
                "score": round(charging_pattern_score, 1),
                "change": round(change_charging, 1),
                "value": round(charging_pattern_score, 1),
                "unit": "점",
                "percentile": percentiles["charging_pattern"],
                "contribution": round(contribution_charging, 1),
                "summary": f"충전 패턴(고SOC-빈도) → 점수 {round(charging_pattern_score, 1)} (백분위 {percentiles['charging_pattern']}%) · 기여 {round(contribution_charging, 1)}점"
            },
            "age_penalty": {
                "age_years": round(age_years, 2),
                "penalty": round(age_penalty, 1),
                "model_year": model_year,
                "model_month": model_month
            }
        }
    })

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)

