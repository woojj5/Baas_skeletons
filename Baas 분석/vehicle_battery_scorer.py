# -*- coding: utf-8 -*-
"""
차량 배터리 점수 계산 시스템
- segment_bucket 기반 (drive_data, fast_charge_data, parking_data, slow_charge_data)
- 이미지의 배터리 점수 계산 기준 반영
"""
import argparse
import configparser
import csv
import math
import os
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any
from influxdb_client import InfluxDBClient

HERE = Path(__file__).resolve().parent
CFG = HERE / "config2.ini"

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

def _range(start: Optional[str], stop: Optional[str], window: Optional[str]) -> str:
    if start or stop:
        s = start if start else "-1h"
        e = f", stop: {stop}" if stop else ""
        return f'|> range(start: {s}{e})'
    else:
        w = window if window else "-1h"
        return f'|> range(start: {w})'

def _device_pred(device: str, device_key: str) -> str:
    return f'r["{device_key}"] == "{device}"'

def _num(v) -> float:
    try:
        return float(v) if v is not None else 0.0
    except (ValueError, TypeError):
        return 0.0

def _clip_score(score: float, min_score: float = 40.0, max_score: float = 100.0) -> float:
    """점수를 40~100 범위로 클리핑"""
    return max(min_score, min(max_score, score))

# =========================
# 차종 매핑 (car_type -> vehicle_type)
# =========================
def _map_car_type_to_vehicle_type(car_type: Optional[str]) -> str:
    """car_type을 vehicle_type으로 매핑"""
    if not car_type:
        return "중형"  # 기본값
    
    car_type_upper = str(car_type).upper()
    
    # 상용차
    if any(x in car_type_upper for x in ["PORTER", "BONGO"]):
        return "상용차"
    
    # 소형
    if any(x in car_type_upper for x in ["KONA", "NIRO", "SOUL"]):
        return "소형"
    
    # 중형
    if any(x in car_type_upper for x in ["IONIQ", "K5", "SONATA"]):
        return "중형"
    
    # 대형
    if any(x in car_type_upper for x in ["EV9", "GV90", "PALISADE"]):
        return "대형"
    
    # 프리미엄
    if any(x in car_type_upper for x in ["GENESIS", "GV80", "G90"]):
        return "프리미엄"
    
    # EV6, EV3는 중형으로 분류
    if "EV6" in car_type_upper or "EV3" in car_type_upper:
        return "중형"
    
    return "중형"  # 기본값

# =========================
# 차량 정보 조회
# =========================
def get_vehicle_first_last_dates(client: InfluxDBClient, org: str, bucket: str, measurement: str,
                                  device: str, device_key: str, start: Optional[str], stop: Optional[str],
                                  window: Optional[str]) -> Dict[str, Optional[str]]:
    """차량의 첫 등장일과 마지막 등장일 조회
    수집 기간은 soc_avg 필드가 처음 나오는 시점과 가장 마지막에 나오는 시점
    2023-10-01T00:00:00Z부터 조회"""
    # 수집 기간은 실제 데이터 범위를 찾아야 하므로 2023-10-01부터 조회
    # start/stop 파라미터는 무시하고 지정된 시작 시점부터 찾음
    collection_start = "2023-10-01T00:00:00Z"
    rng = _range(collection_start, None, None)
    dev = _device_pred(device, device_key)
    
    # 첫 등장일 조회 (soc_avg 필드가 처음 나오는 시점)
    flux_first = f'''
from(bucket:"{bucket}")
  {rng}
  |> filter(fn:(r)=> r._measurement=="{measurement}")
  |> filter(fn:(r)=> {dev})
  |> filter(fn:(r)=> r._field=="soc_avg")
  |> first()
  |> keep(columns: ["_time"])
'''
    
    # 마지막 등장일 조회 (soc_avg 필드가 가장 마지막에 나오는 시점)
    flux_last = f'''
from(bucket:"{bucket}")
  {rng}
  |> filter(fn:(r)=> r._measurement=="{measurement}")
  |> filter(fn:(r)=> {dev})
  |> filter(fn:(r)=> r._field=="soc_avg")
  |> last()
  |> keep(columns: ["_time"])
'''
    
    first_date = None
    last_date = None
    
    try:
        # 첫 등장일
        for t in client.query_api().query(flux_first, org=org):
            for r in t.records:
                first_date = r.get_time().isoformat()
                break
    except Exception:
        pass
    
    try:
        # 마지막 등장일
        for t in client.query_api().query(flux_last, org=org):
            for r in t.records:
                last_date = r.get_time().isoformat()
                break
    except Exception:
        pass
    
    return {"first_date": first_date, "last_date": last_date}

def get_vehicle_info(client: InfluxDBClient, org: str, bucket: str, measurement: str,
                     device: str, device_key: str, start: Optional[str], stop: Optional[str],
                     window: Optional[str]) -> Dict[str, Any]:
    """차종(car_type), 연식 정보 조회"""
    rng = _range(start, stop, window)
    dev = _device_pred(device, device_key)
    
    info = {}
    
    # car_type 조회 (tag에서)
    flux_tag = f'''
from(bucket:"{bucket}")
  {rng}
  |> filter(fn:(r)=> r._measurement=="{measurement}")
  |> filter(fn:(r)=> {dev})
  |> keep(columns: ["car_type"])
  |> distinct(column: "car_type")
  |> limit(n:1)
'''
    try:
        for t in client.query_api().query(flux_tag, org=org):
            for r in t.records:
                car_type_val = r.values.get("car_type")
                if car_type_val:
                    info["car_type"] = str(car_type_val)
                    break
    except Exception:
        pass
    
    # model_year, model_month 조회 (field에서) - 최근 7일만 샘플링
    flux_field = f'''
from(bucket:"{bucket}")
  |> range(start: -7d)
  |> filter(fn:(r)=> r._measurement=="{measurement}")
  |> filter(fn:(r)=> {dev})
  |> filter(fn:(r)=> r._field=="model_year" or r._field=="model_month")
  |> last()
  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
'''
    try:
        for t in client.query_api().query(flux_field, org=org):
            for r in t.records:
                if "model_year" in r.values:
                    info["model_year"] = _num(r.values.get("model_year"))
                if "model_month" in r.values:
                    info["model_month"] = _num(r.values.get("model_month"))
    except Exception:
        pass
    
    return info

# =========================
# 메트릭 조회 함수들
# =========================
def get_efficiency(client: InfluxDBClient, org: str, bucket: str, measurement: str,
                   device: str, device_key: str, start: Optional[str], stop: Optional[str],
                   window: Optional[str]) -> Optional[float]:
    """효율 (km/kWh): km_per_kWh 필드 사용"""
    rng = _range(start, stop, window)
    dev = _device_pred(device, device_key)
    
    flux = f'''
from(bucket:"{bucket}")
  {rng}
  |> filter(fn:(r)=> r._measurement=="{measurement}")
  |> filter(fn:(r)=> {dev})
  |> filter(fn:(r)=> r._field=="km_per_kWh")
  |> aggregateWindow(every: 10m, fn: mean, createEmpty: false)
  |> group()
  |> mean(column: "_value")
'''
    try:
        for t in client.query_api().query(flux, org=org):
            for r in t.records:
                val = r.get_value()
                if val is not None:
                    eff_val = float(val)
                    if 0 < eff_val < 20:  # 합리적인 범위 체크
                        return eff_val
    except Exception as e:
        print(f"[debug] efficiency query error for {device}: {e}")
        pass
    return None

def get_avg_temperature(client: InfluxDBClient, org: str, bucket: str, measurement: str,
                       device: str, device_key: str, start: Optional[str], stop: Optional[str],
                       window: Optional[str]) -> Optional[float]:
    """평균 온도: temp_mean 필드 사용"""
    rng = _range(start, stop, window)
    dev = _device_pred(device, device_key)
    
    flux = f'''
from(bucket:"{bucket}")
  {rng}
  |> filter(fn:(r)=> r._measurement=="{measurement}")
  |> filter(fn:(r)=> {dev})
  |> filter(fn:(r)=> r._field=="temp_mean")
  |> aggregateWindow(every: 10m, fn: mean, createEmpty: false)
  |> group()
  |> mean(column: "_value")
'''
    try:
        for t in client.query_api().query(flux, org=org):
            for r in t.records:
                val = r.get_value()
                if val is not None:
                    return float(val)
    except Exception:
        pass
    return None

def get_cell_imbalance(client: InfluxDBClient, org: str, bucket: str, measurement: str,
                       device: str, device_key: str, start: Optional[str], stop: Optional[str],
                       window: Optional[str]) -> Optional[float]:
    """셀 편차 (V): cell_volt_diff 필드 사용"""
    rng = _range(start, stop, window)
    dev = _device_pred(device, device_key)
    
    flux = f'''
from(bucket:"{bucket}")
  {rng}
  |> filter(fn:(r)=> r._measurement=="{measurement}")
  |> filter(fn:(r)=> {dev})
  |> filter(fn:(r)=> r._field=="cell_volt_diff")
  |> aggregateWindow(every: 10m, fn: mean, createEmpty: false)
  |> group()
  |> mean(column: "_value")
'''
    try:
        for t in client.query_api().query(flux, org=org):
            for r in t.records:
                val = r.get_value()
                if val is not None:
                    return float(val)
    except Exception:
        pass
    return None

def get_driving_habit(client: InfluxDBClient, org: str, bucket: str, measurement: str,
                      device: str, device_key: str, start: Optional[str], stop: Optional[str],
                      window: Optional[str]) -> Dict[str, Optional[float]]:
    """주행 습관: accel_std, brake_std 필드 사용"""
    rng = _range(start, stop, window)
    dev = _device_pred(device, device_key)
    
    result = {"accel_std": None, "brake_std": None}
    
    # accel_std 조회
    flux_accel = f'''
from(bucket:"{bucket}")
  {rng}
  |> filter(fn:(r)=> r._measurement=="{measurement}")
  |> filter(fn:(r)=> {dev})
  |> filter(fn:(r)=> r._field=="accel_std")
  |> aggregateWindow(every: 10m, fn: mean, createEmpty: false)
  |> group()
  |> mean(column: "_value")
'''
    try:
        for t in client.query_api().query(flux_accel, org=org):
            for r in t.records:
                val = r.get_value()
                if val is not None:
                    result["accel_std"] = float(val)
                    break
    except Exception:
        pass
    
    # brake_std 조회
    flux_brake = f'''
from(bucket:"{bucket}")
  {rng}
  |> filter(fn:(r)=> r._measurement=="{measurement}")
  |> filter(fn:(r)=> {dev})
  |> filter(fn:(r)=> r._field=="brake_std")
  |> aggregateWindow(every: 10m, fn: mean, createEmpty: false)
  |> group()
  |> mean(column: "_value")
'''
    try:
        for t in client.query_api().query(flux_brake, org=org):
            for r in t.records:
                val = r.get_value()
                if val is not None:
                    result["brake_std"] = float(val)
                    break
    except Exception:
        pass
    
    return result

def get_charging_pattern_combined(client: InfluxDBClient, org: str, bucket: str,
                                  device: str, device_key: str, start: Optional[str], stop: Optional[str],
                                  window: Optional[str]) -> Dict[str, Optional[float]]:
    """충전 패턴: segment_stats_slow_charge와 segment_stats_fast_charge에서 충전 횟수, 평균 충전량, 고SOC 충전 비율 계산
    이미지 기준: 급속 충전 794회, 완속 충전 634회, 평균 충전량 9.9 kWh
    """
    rng = _range(start, stop, window)
    dev = _device_pred(device, device_key)
    
    result = {
        "charging_count": None,
        "avg_charging_amount": None,
        "high_soc_ratio": None  # high_soc_frac 필드 값 저장
    }
    
    try:
        # segment_stats_slow_charge와 segment_stats_fast_charge에서 각 세그먼트 데이터 조회
        # 세그먼트 개수 = 충전 횟수
        # soc_start, soc_end, energy_kwh 등의 필드가 있을 수 있음
        
        # 먼저 각 measurement에서 세그먼트 데이터 조회 (세그먼트마다 하나의 레코드)
        flux_slow_segments = f'''
from(bucket:"{bucket}")
  {rng}
  |> filter(fn:(r)=> r._measurement=="segment_stats_slow_charge")
  |> filter(fn:(r)=> {dev})
  |> keep(columns: ["_time", "soc_start", "soc_end", "energy_kwh"])
  |> distinct(column: "_time")
'''
        flux_fast_segments = f'''
from(bucket:"{bucket}")
  {rng}
  |> filter(fn:(r)=> r._measurement=="segment_stats_fast_charge")
  |> filter(fn:(r)=> {dev})
  |> keep(columns: ["_time", "soc_start", "soc_end", "energy_kwh"])
  |> distinct(column: "_time")
'''
        
        # soc_start, soc_end 필드 조회 (시작 SOC와 종료 SOC)
        flux_slow_soc = f'''
from(bucket:"{bucket}")
  {rng}
  |> filter(fn:(r)=> r._measurement=="segment_stats_slow_charge")
  |> filter(fn:(r)=> {dev})
  |> filter(fn:(r)=> r._field=="soc_start" or r._field=="soc_end" or r._field=="energy_kwh")
  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
'''
        flux_fast_soc = f'''
from(bucket:"{bucket}")
  {rng}
  |> filter(fn:(r)=> r._measurement=="segment_stats_fast_charge")
  |> filter(fn:(r)=> {dev})
  |> filter(fn:(r)=> r._field=="soc_start" or r._field=="soc_end" or r._field=="energy_kwh")
  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
'''
        
        charging_sessions = []
        
        # segment_stats_slow_charge 조회
        try:
            for t in client.query_api().query(flux_slow_soc, org=org):
                for r in t.records:
                    soc_start = r.values.get("soc_start")
                    soc_end = r.values.get("soc_end")
                    energy_kwh = r.values.get("energy_kwh")
                    
                    if soc_start is not None:
                        soc_start_val = float(soc_start)
                        soc_end_val = float(soc_end) if soc_end is not None else None
                        energy = float(energy_kwh) if energy_kwh is not None else None
                        
                        charging_sessions.append({
                            "start_soc": soc_start_val,
                            "end_soc": soc_end_val,
                            "energy_kwh": energy
                        })
        except Exception:
            pass
        
        # segment_stats_fast_charge 조회
        try:
            for t in client.query_api().query(flux_fast_soc, org=org):
                for r in t.records:
                    soc_start = r.values.get("soc_start")
                    soc_end = r.values.get("soc_end")
                    energy_kwh = r.values.get("energy_kwh")
                    
                    if soc_start is not None:
                        soc_start_val = float(soc_start)
                        soc_end_val = float(soc_end) if soc_end is not None else None
                        energy = float(energy_kwh) if energy_kwh is not None else None
                        
                        charging_sessions.append({
                            "start_soc": soc_start_val,
                            "end_soc": soc_end_val,
                            "energy_kwh": energy
                        })
        except Exception:
            pass
        
        # pivot이 실패할 경우 대안: 세그먼트 개수만 카운트 (충전 횟수)
        if len(charging_sessions) == 0:
            # 세그먼트 개수 카운트 (충전 횟수)
            flux_count_slow = f'''
from(bucket:"{bucket}")
  {rng}
  |> filter(fn:(r)=> r._measurement=="segment_stats_slow_charge")
  |> filter(fn:(r)=> {dev})
  |> count()
'''
            flux_count_fast = f'''
from(bucket:"{bucket}")
  {rng}
  |> filter(fn:(r)=> r._measurement=="segment_stats_fast_charge")
  |> filter(fn:(r)=> {dev})
  |> count()
'''
            
            slow_count = 0
            fast_count = 0
            try:
                for t in client.query_api().query(flux_count_slow, org=org):
                    for r in t.records:
                        slow_count = int(r.get_value() or 0)
                        break
            except Exception:
                pass
            
            try:
                for t in client.query_api().query(flux_count_fast, org=org):
                    for r in t.records:
                        fast_count = int(r.get_value() or 0)
                        break
            except Exception:
                pass
            
            total_count = slow_count + fast_count
            
            # 충전량과 고SOC 비율 조회
            if total_count > 0:
                # 평균 충전량 조회 (energy_kwh 필드)
                flux_energy = f'''
from(bucket:"{bucket}")
  {rng}
  |> filter(fn:(r)=> r._measurement=="segment_stats_slow_charge" or r._measurement=="segment_stats_fast_charge")
  |> filter(fn:(r)=> {dev})
  |> filter(fn:(r)=> r._field=="energy_kwh")
  |> group()
  |> mean(column: "_value")
'''
                avg_energy = None
                try:
                    for t in client.query_api().query(flux_energy, org=org):
                        for r in t.records:
                            val = r.get_value()
                            if val is not None:
                                avg_energy = float(val)
                                break
                except Exception:
                    pass
                
                # high_soc_frac 필드 직접 조회
                flux_high_soc_frac = f'''
from(bucket:"{bucket}")
  {rng}
  |> filter(fn:(r)=> r._measurement=="segment_stats_slow_charge" or r._measurement=="segment_stats_fast_charge")
  |> filter(fn:(r)=> {dev})
  |> filter(fn:(r)=> r._field=="high_soc_frac")
  |> group()
  |> mean(column: "_value")
'''
                high_soc_frac = None
                try:
                    for t in client.query_api().query(flux_high_soc_frac, org=org):
                        for r in t.records:
                            val = r.get_value()
                            if val is not None:
                                high_soc_frac = float(val)
                                break
                except Exception:
                    pass
                
                result["charging_count"] = float(total_count)
                result["avg_charging_amount"] = avg_energy
                result["high_soc_ratio"] = high_soc_frac
        else:
            # 충전 세션 데이터가 있으면 계산
            total_count = len(charging_sessions)
            
            # high_soc_frac 필드 직접 조회
            flux_high_soc_frac = f'''
from(bucket:"{bucket}")
  {rng}
  |> filter(fn:(r)=> r._measurement=="segment_stats_slow_charge" or r._measurement=="segment_stats_fast_charge")
  |> filter(fn:(r)=> {dev})
  |> filter(fn:(r)=> r._field=="high_soc_frac")
  |> group()
  |> mean(column: "_value")
'''
            high_soc_frac = None
            try:
                for t in client.query_api().query(flux_high_soc_frac, org=org):
                    for r in t.records:
                        val = r.get_value()
                        if val is not None:
                            high_soc_frac = float(val)
                            break
            except Exception:
                pass
            
            # 평균 충전량 (energy_kwh가 있으면 사용, 없으면 soc 차이 사용)
            energy_values = [s.get("energy_kwh") for s in charging_sessions if s.get("energy_kwh") is not None]
            if energy_values:
                avg_energy = sum(energy_values) / len(energy_values)
            else:
                # energy_kwh가 없으면 soc 차이 사용
                soc_diffs = []
                for s in charging_sessions:
                    if s.get("start_soc") is not None and s.get("end_soc") is not None:
                        diff = s["end_soc"] - s["start_soc"]
                        if diff > 0:
                            soc_diffs.append(diff)
                avg_energy = sum(soc_diffs) / len(soc_diffs) if soc_diffs else None
            
            result["charging_count"] = float(total_count)
            result["avg_charging_amount"] = avg_energy
            result["high_soc_ratio"] = high_soc_frac
        
    except Exception as e:
        print(f"[debug] charging_pattern query error for {device}: {e}")
        pass
    
    return result

def get_charging_pattern(client: InfluxDBClient, org: str, bucket: str, measurement: str,
                         device: str, device_key: str, start: Optional[str], stop: Optional[str],
                         window: Optional[str]) -> Optional[float]:
    """충전 패턴: SOC 충전 빈도 (단일 measurement용, 하위 호환성)"""
    rng = _range(start, stop, window)
    dev = _device_pred(device, device_key)
    
    flux = f'''
from(bucket:"{bucket}")
  {rng}
  |> filter(fn:(r)=> r._measurement=="{measurement}")
  |> filter(fn:(r)=> {dev})
  |> filter(fn:(r)=> r._field=="soc")
  |> aggregateWindow(every: 1h, fn: mean, createEmpty: false)
  |> difference()
  |> filter(fn:(r)=> r._value > 0.0)
  |> count()
'''
    try:
        for t in client.query_api().query(flux, org=org):
            for r in t.records:
                val = r.get_value()
                if val is not None:
                    return float(val)
    except Exception:
        pass
    return None

# =========================
# 점수 계산 함수들
# =========================
def calculate_efficiency_score(efficiency: Optional[float], vehicle_type: str, age_years: float) -> float:
    """효율 점수 계산 (차종/연식별 기준값 적용)"""
    if efficiency is None:
        return 0.0
    
    # 차종별 기준값 (기본값)
    base_ranges = {
        "상용차": (2.5, 6.5),
        "소형": (4.0, 8.5),
        "중형": (3.5, 7.5),
        "대형": (3.0, 7.0),
        "프리미엄": (3.8, 8.0),
    }
    
    min_val, max_val = base_ranges.get(vehicle_type, (3.5, 7.5))
    
    # 연식이 오래될수록 기준값 완화 (최대 -0.8)
    # 예시: 중형차 2.8년 → 기준값 3.1~7.1 (기본값 3.5~7.5에서 min -0.4, max -0.4)
    # 연식에 비례: min -0.143/년, max -0.143/년 (2.8년: -0.4)
    # 최대 감소량: -0.8
    age_adjustment = min(age_years * 0.143, 0.8)  # 2.8년: -0.4, 최대 -0.8
    min_val = min_val - age_adjustment  # min 감소 (완화)
    max_val = max(0.0, max_val - age_adjustment)  # max 감소 (완화)
    
    # max_val이 min_val보다 작거나 같으면 안 됨
    if max_val <= min_val:
        max_val = min_val + 0.1  # 최소 범위 보장
    
    # 선형 보간으로 40~100점 매김
    # 예시: 중형차 2.8년, 기준값 3.1~7.1, 효율 7.83 km/kWh → 100점 (7.83 >= 7.1)
    if efficiency <= min_val:
        return 40.0
    elif efficiency >= max_val:
        return 100.0  # 최고값 100점 (이미지 기준: low→40점, high→100점)
    else:
        ratio = (efficiency - min_val) / (max_val - min_val)
        return 40.0 + (ratio * 60.0)  # 40~100점 범위 (선형 보간)

def calculate_temperature_score(temp: Optional[float]) -> float:
    """평균 온도 점수 계산: 100 - 2 × (온도 - 30)"""
    if temp is None:
        return 0.0
    score = 100.0 - 2.0 * (temp - 30.0)
    return _clip_score(score)

def calculate_cell_imbalance_score(imbalance: Optional[float]) -> float:
    """셀 편차 점수 계산: norm = (편차 - 0.02) / 0.004, 점수 = 100 / (1 + e^(norm))
    이미지 기준: 8.7mV = 94.4점
    imbalance는 V 단위이므로, mV로 변환해서 계산하거나 V 단위로 직접 계산
    """
    if imbalance is None:
        return 0.0
    
    # imbalance를 V 단위로 가정 (0.009V = 9mV)
    # 이미지 예시: 0.009V (9mV) → 94.4점
    # 이미지의 셀 편차는 mV 단위로 표시되지만, 내부 계산은 V 단위일 수 있음
    # 공식: norm = (편차 - 0.02) / 0.004, 점수 = 100 / (1 + e^(norm))
    norm = (imbalance - 0.02) / 0.004
    score = 100.0 / (1.0 + math.exp(norm))
    return _clip_score(score)

def calculate_driving_habit_score(driving_habit: Dict[str, Optional[float]]) -> float:
    """주행 습관 점수: 가속/감속 표준편차 우선, 일일 주행 거리, 누적 거리 고려"""
    accel_std = driving_habit.get("accel_std")
    brake_std = driving_habit.get("brake_std")
    daily_dist = driving_habit.get("daily_distance")
    cumulative_dist = driving_habit.get("cumulative_distance")
    
    # 가속/감속 데이터가 있으면 우선적으로 사용 (이미지 기준)
    # 이미지: 100 - 20 × (Accel_STD + Brake_STD)
    # 둘 중 하나라도 있으면 사용 (없는 것은 0으로 간주)
    if accel_std is not None or brake_std is not None:
        accel_val = accel_std if accel_std is not None else 0.0
        brake_val = brake_std if brake_std is not None else 0.0
        score = 100.0 - 20.0 * (accel_val + brake_val)
        return _clip_score(score)
    
    # 가속/감속 데이터가 없으면 일일 주행 거리, 누적 거리 고려
    # 일일 주행 거리: 20~100km 최적
    # 누적 거리: 7300km 이상 우수
    if daily_dist is not None or cumulative_dist is not None:
        score = 80.0  # 기본값
        
        # 일일 주행 거리 보정 (20~100km 최적)
        if daily_dist is not None:
            if 20.0 <= daily_dist <= 100.0:
                score += 10.0  # 최적 범위
            elif daily_dist < 20.0:
                score -= (20.0 - daily_dist) * 0.5  # 너무 적으면 감점
            elif daily_dist > 100.0:
                score -= (daily_dist - 100.0) * 0.1  # 너무 많으면 약간 감점
        
        # 누적 거리 보정 (7300km 이상 우수)
        if cumulative_dist is not None:
            if cumulative_dist >= 7300.0:
                score += 10.0  # 우수
            elif cumulative_dist < 7300.0:
                score -= (7300.0 - cumulative_dist) / 730.0  # 부족하면 감점
        
        return _clip_score(score)
    
    # 데이터 없으면 기본값 80점
    return 80.0

def calculate_charging_pattern_score(charging_data: Dict[str, Optional[float]]) -> float:
    """충전 패턴 점수 계산 (이미지 기준)
    이미지 기준: 점수 = 100 - 50 × 충전빈도, 값 없을 시 80
    충전빈도 = 고SOC에서 시작한 충전 비율 (high_soc_ratio)
    """
    # 이미지 기준: 데이터 없으면 기본값 80점
    if charging_data is None or not isinstance(charging_data, dict):
        return 80.0
    
    # 충전빈도 = 고SOC에서 시작한 충전 비율
    charging_freq = charging_data.get("high_soc_ratio", 0.0)
    
    # charging_freq가 None이면 기본값 80점 반환
    if charging_freq is None:
        return 80.0
    
    # 이미지 기준: 점수 = 100 - 50 × 충전빈도
    score = 100.0 - (50.0 * charging_freq)
    
    return _clip_score(score)

def calculate_age_penalty(age_years: float) -> float:
    """연식 패널티 계산 (비선형)
    이미지 기준:
    - 1년 이하: 연식 × 1.5
    - 1~3년: 1.5 + (연식 - 1) × 1.2
    - 3~5년: 3.9 + (연식 - 3) × 0.8
    - 5년 이후: 5.5 + (연식 - 5) × 0.4
    - 최대 감점: 7.5점
    
    예시: 2.8년 → 1.5 + (2.8 - 1) × 1.2 = 1.5 + 2.16 = 3.66 → 3.7점
    """
    if age_years <= 1.0:
        penalty = age_years * 1.5
    elif age_years <= 3.0:
        penalty = 1.5 + (age_years - 1.0) * 1.2
    elif age_years <= 5.0:
        penalty = 3.9 + (age_years - 3.0) * 0.8
    else:
        penalty = 5.5 + (age_years - 5.0) * 0.4
    
    # 최대 감점 7.5점으로 제한 및 반올림 (소수점 첫째 자리)
    # 예시: 2.8년 → 3.66 → 3.7점
    return round(min(7.5, penalty), 1)

def calculate_final_score(metrics: Dict[str, Any], vehicle_type: str, age_years: float) -> Dict[str, Any]:
    """최종 점수 계산"""
    # 가중치
    weights = {
        "efficiency": 0.30,
        "temperature": 0.15,
        "cell_imbalance": 0.15,
        "driving_habit": 0.15,
        "charging_pattern": 0.15,
    }
    
    # 각 항목 점수 계산
    efficiency_score = calculate_efficiency_score(
        metrics.get("efficiency"), vehicle_type, age_years
    )
    temp_score = calculate_temperature_score(metrics.get("avg_temperature"))
    cell_score = calculate_cell_imbalance_score(metrics.get("cell_imbalance"))
    driving_score = calculate_driving_habit_score(metrics.get("driving_habit", {}))
    charging_score = calculate_charging_pattern_score(metrics.get("charging_pattern"))
    
    # 가중 평균 계산 (데이터가 있는 항목만)
    total_weight = 0.0
    weighted_sum = 0.0
    
    if metrics.get("efficiency") is not None:
        weighted_sum += efficiency_score * weights["efficiency"]
        total_weight += weights["efficiency"]
    
    if metrics.get("avg_temperature") is not None:
        weighted_sum += temp_score * weights["temperature"]
        total_weight += weights["temperature"]
    
    if metrics.get("cell_imbalance") is not None:
        weighted_sum += cell_score * weights["cell_imbalance"]
        total_weight += weights["cell_imbalance"]
    
    # 주행 습관: 항상 포함 (데이터 없으면 기본값 80점 사용)
    # 이미지 기준: "데이터 없으면 기본값 80점"
    weighted_sum += driving_score * weights["driving_habit"]
    total_weight += weights["driving_habit"]
    
    # 충전 패턴: 항상 포함 (데이터 없으면 기본값 80점 사용)
    # 이미지 기준: "값 없음 시 80"
    # charging_pattern이 dict인 경우와 None인 경우 모두 처리
    charging_pattern_data = metrics.get("charging_pattern")
    if charging_pattern_data is not None:
        weighted_sum += charging_score * weights["charging_pattern"]
        total_weight += weights["charging_pattern"]
    else:
        # 데이터 없으면 기본값 80점
        weighted_sum += 80.0 * weights["charging_pattern"]
        total_weight += weights["charging_pattern"]
    
    # 가중치 합계로 정규화
    # 이미지 기준: "가용 항목만 가중합 후, 가중치 합(0.90)으로 나누어 정규화합니다"
    # 이미지 예시 검증: 96.5*0.30 + 100*0.15 + 94.4*0.15 + 80*0.15 + 40*0.15 = 76.11
    # 76.11 / 0.90 = 84.57 ✓ (이미지 예시와 일치)
    # 이미지에 명시된 대로 항상 가중치 합(0.90)으로 나누어 정규화
    if total_weight > 0:
        weighted_avg = weighted_sum / 0.90
    else:
        weighted_avg = 0.0
    
    # 연식 패널티 적용
    age_penalty = calculate_age_penalty(age_years)
    final_score = weighted_avg - age_penalty
    
    # 0~98점 범위로 클리핑
    final_score = max(0.0, min(98.0, final_score))
    
    # 연식 문자열 생성 (YYYY.MM 형식)
    model_year = metrics.get("model_year")
    model_month = metrics.get("model_month")
    if model_year and model_month:
        age_str = f"{int(model_year)}.{int(model_month):02d}"
    else:
        age_str = None
    
    # 수집기간 문자열 생성 (YYYY.MM.DD ~ YYYY.MM.DD 형식)
    first_date = metrics.get("first_date")
    last_date = metrics.get("last_date")
    if first_date and last_date:
        from datetime import datetime
        try:
            first_dt = datetime.fromisoformat(first_date.replace('Z', '+00:00'))
            last_dt = datetime.fromisoformat(last_date.replace('Z', '+00:00'))
            collection_period = f"{first_dt.strftime('%Y.%m.%d')} ~ {last_dt.strftime('%Y.%m.%d')}"
        except:
            collection_period = None
    else:
        collection_period = None
    
    return {
        "car_id": metrics.get("device"),
        "car_type": metrics.get("car_type"),
        "vehicle_type": vehicle_type,
        "age_years": round(age_years, 2),
        "model_year": model_year,
        "model_month": model_month,
        "age_string": age_str,  # YYYY.MM 형식
        "first_date": first_date,
        "last_date": last_date,
        "collection_period": collection_period,  # YYYY.MM.DD ~ YYYY.MM.DD 형식
        "efficiency": round(metrics.get("efficiency"), 2) if metrics.get("efficiency") else None,
        "efficiency_score": round(efficiency_score, 2),
        "avg_temperature": round(metrics.get("avg_temperature"), 2) if metrics.get("avg_temperature") else None,
        "temperature_score": round(temp_score, 2),
        "cell_imbalance": round(metrics.get("cell_imbalance"), 4) if metrics.get("cell_imbalance") else None,
        "cell_imbalance_score": round(cell_score, 2),
        "driving_habit_score": round(driving_score, 2),
        "charging_count": round(charging_pattern_data.get("charging_count"), 0) if charging_pattern_data and isinstance(charging_pattern_data, dict) and charging_pattern_data.get("charging_count") else None,
        "avg_charging_amount": round(charging_pattern_data.get("avg_charging_amount"), 1) if charging_pattern_data and isinstance(charging_pattern_data, dict) and charging_pattern_data.get("avg_charging_amount") else None,
        "charging_pattern_score": round(charging_score, 2),
        "weighted_avg": round(weighted_avg, 2),
        "age_penalty": round(age_penalty, 2),
        "final_score": round(final_score, 2),
    }

# =========================
# 전체 차량 목록 조회
# =========================
def _query_with_fallback(client: InfluxDBClient, org: str, bucket: str, measurement: str,
                         device_key: str, period_start: datetime, period_end: datetime,
                         period_name: str, devices: List[str], seen: set,
                         csv_path: Optional[Path] = None, unit: str = "week") -> None:
    """점진적으로 더 작은 단위로 나눠서 조회 (주 → 일 → 시간 → 분 → 초)"""
    from datetime import timedelta
    
    if unit == "week":
        delta = timedelta(days=7)
        unit_name = "주"
    elif unit == "day":
        delta = timedelta(days=1)
        unit_name = "일"
    elif unit == "hour":
        delta = timedelta(hours=1)
        unit_name = "시간"
    elif unit == "minute":
        delta = timedelta(minutes=1)
        unit_name = "분"
    elif unit == "second":
        delta = timedelta(seconds=1)
        unit_name = "초"
    else:
        print(f"[warn] {period_name} 조회 실패: 더 이상 작은 단위로 나눌 수 없음")
        return
    
    current_start = period_start
    unit_num = 1
    
    while current_start <= period_end:
        # 다음 구간의 시작 계산
        current_end = current_start + delta
        if current_end > period_end:
            current_end = period_end + timedelta(seconds=1)  # period_end를 포함하기 위해
        
        # 실제 조회할 끝 시간 (current_end는 다음 구간의 시작이므로 1초 빼야 함)
        query_end = current_end - timedelta(seconds=1)
        if query_end > period_end:
            query_end = period_end
        
        # 주/일 단위는 날짜만, 시간/분/초 단위는 시간까지 표시
        if unit in ["week", "day"]:
            start_str = current_start.strftime("%Y-%m-%dT00:00:00Z")
            end_str = query_end.strftime("%Y-%m-%dT23:59:59Z")
        else:
            start_str = current_start.strftime("%Y-%m-%dT%H:%M:%SZ")
            end_str = query_end.strftime("%Y-%m-%dT%H:%M:%SZ")
        
        try:
            if unit in ["hour", "minute", "second"]:
                print(f"[info]   {period_name} {unit_name}{unit_num} ({start_str} ~ {end_str})...")
            else:
                print(f"[info]   {period_name} {unit_name}{unit_num} ({start_str} ~ {end_str})...")
            
            flux = f'''
from(bucket:"{bucket}")
  |> range(start: {start_str}, stop: {end_str})
  |> filter(fn:(r)=> r._measurement=="{measurement}")
  |> keep(columns: ["{device_key}"])
  |> distinct(column: "{device_key}")
'''
            unit_devices = []
            for t in client.query_api().query(flux, org=org):
                for r in t.records:
                    device_val = r.values.get(device_key)
                    if device_val:
                        dev_str = str(device_val)
                        if dev_str not in seen:
                            devices.append(dev_str)
                            seen.add(dev_str)
                            unit_devices.append(dev_str)
            
            if unit_devices:
                print(f"[info]   {period_name} {unit_name}{unit_num}: {len(unit_devices)}개 차량 발견 (누적: {len(devices)}개)")
                # CSV에 추가 저장
                if csv_path:
                    try:
                        with open(csv_path, "a", newline="", encoding="utf-8-sig") as f:
                            writer = csv.writer(f)
                            for device in unit_devices:
                                writer.writerow([device])
                    except (PermissionError, IOError) as e:
                        print(f"[warn] CSV 파일 쓰기 실패 (파일이 다른 프로그램에서 열려있을 수 있음): {e}")
                    except Exception as e:
                        print(f"[warn] CSV 파일 쓰기 실패: {e}")
            
            # 다음 구간으로 이동 (current_end는 이미 다음 구간의 시작)
            current_start = current_end
            unit_num += 1
            
            # 무한 루프 방지: period_end를 넘으면 종료
            if current_start > period_end:
                break
            
        except Exception as e:
            error_msg = str(e)
            if "timeout" in error_msg.lower() or "timed out" in error_msg.lower():
                # 더 작은 단위로 재시도
                next_unit = {
                    "week": "day",
                    "day": "hour",
                    "hour": "minute",
                    "minute": "second",
                    "second": None
                }.get(unit)
                
                if next_unit:
                    print(f"[warn]   {period_name} {unit_name}{unit_num} 타임아웃. {next_unit} 단위로 재시도...")
                    _query_with_fallback(client, org, bucket, measurement, device_key,
                                       current_start, current_end, period_name, devices, seen,
                                       csv_path, next_unit)
                else:
                    print(f"[warn]   {period_name} {unit_name}{unit_num} 조회 실패: {e}")
            else:
                print(f"[warn]   {period_name} {unit_name}{unit_num} 조회 실패: {e}")
            
            # 다음 구간으로 이동 (current_end는 이미 다음 구간의 시작)
            current_start = current_end
            unit_num += 1
            
            # 무한 루프 방지: period_end를 넘으면 종료
            if current_start > period_end:
                break
            continue

def list_all_devices(client: InfluxDBClient, org: str, bucket: str, measurement: str,
                      device_key: str, start: Optional[str], stop: Optional[str],
                      window: Optional[str], csv_path: Optional[Path] = None) -> List[str]:
    """모든 device 목록 조회 (매달마다 조회하여 중복 제거, 조회할 때마다 CSV 저장)"""
    from datetime import datetime, timedelta
    import calendar
    
    devices = []
    seen = set()
    
    # CSV 파일이 있으면 기존 내용 읽기
    if csv_path and csv_path.exists():
        try:
            with open(csv_path, "r", encoding="utf-8-sig") as f:
                reader = csv.reader(f)
                next(reader, None)  # 헤더 스킵
                for row in reader:
                    if row and row[0]:
                        car_id = row[0].strip()
                        if car_id and car_id not in seen:
                            devices.append(car_id)
                            seen.add(car_id)
            print(f"[info] 기존 CSV에서 {len(devices)}개 차량 로드됨")
        except (PermissionError, IOError) as e:
            print(f"[warn] 기존 CSV 읽기 실패 (파일이 다른 프로그램에서 열려있을 수 있음): {e}")
        except Exception as e:
            print(f"[warn] 기존 CSV 읽기 실패: {e}")
    
    # CSV 파일 초기화 (헤더만 작성)
    if csv_path:
        csv_path.parent.mkdir(parents=True, exist_ok=True)
        if not csv_path.exists():
            try:
                with open(csv_path, "w", newline="", encoding="utf-8-sig") as f:
                    writer = csv.writer(f)
                    writer.writerow(["car_id"])
            except (PermissionError, IOError) as e:
                print(f"[warn] CSV 파일 생성 실패 (파일이 다른 프로그램에서 열려있을 수 있음): {e}")
            except Exception as e:
                print(f"[warn] CSV 파일 생성 실패: {e}")
    
    # 시작일과 종료일 파싱
    if start and stop:
        try:
            start_dt = datetime.fromisoformat(start.replace('Z', '+00:00'))
            stop_dt = datetime.fromisoformat(stop.replace('Z', '+00:00'))
        except:
            # 기본값: 2023-10-01 ~ 2025-12-31
            start_dt = datetime(2023, 10, 1)
            stop_dt = datetime(2025, 12, 31)
    else:
        # 기본값: 2023-10-01 ~ 2025-12-31
        start_dt = datetime(2023, 10, 1)
        stop_dt = datetime(2025, 12, 31)
    
    # 매달마다 조회
    current = start_dt.replace(day=1)  # 각 달의 1일부터 시작
    
    while current <= stop_dt:
        # 해당 달의 마지막 날 계산
        last_day = calendar.monthrange(current.year, current.month)[1]
        month_end = current.replace(day=last_day)
        
        # stop_dt를 넘지 않도록 조정
        if month_end > stop_dt:
            month_end = stop_dt
        
        month_start_str = current.strftime("%Y-%m-%dT00:00:00Z")
        month_end_str = month_end.strftime("%Y-%m-%dT23:59:59Z")
        month_name = current.strftime("%Y-%m")
        
        try:
            print(f"[info] 차량 목록 조회: {month_name} ({month_start_str} ~ {month_end_str})...")
            flux = f'''
from(bucket:"{bucket}")
  |> range(start: {month_start_str}, stop: {month_end_str})
  |> filter(fn:(r)=> r._measurement=="{measurement}")
  |> keep(columns: ["{device_key}"])
  |> distinct(column: "{device_key}")
'''
            month_devices = []
            for t in client.query_api().query(flux, org=org):
                for r in t.records:
                    device_val = r.values.get(device_key)
                    if device_val:
                        dev_str = str(device_val)
                        if dev_str not in seen:
                            devices.append(dev_str)
                            seen.add(dev_str)
                            month_devices.append(dev_str)
            
            if month_devices:
                print(f"[info] {month_name}: {len(month_devices)}개 차량 발견 (누적: {len(devices)}개)")
                # CSV에 추가 저장
                if csv_path:
                    try:
                        with open(csv_path, "a", newline="", encoding="utf-8-sig") as f:
                            writer = csv.writer(f)
                            for device in month_devices:
                                writer.writerow([device])
                    except (PermissionError, IOError) as e:
                        print(f"[warn] CSV 파일 쓰기 실패 (파일이 다른 프로그램에서 열려있을 수 있음): {e}")
                    except Exception as e:
                        print(f"[warn] CSV 파일 쓰기 실패: {e}")
            else:
                print(f"[info] {month_name}: 0개 차량 발견")
                
        except Exception as e:
            error_msg = str(e)
            if "timeout" in error_msg.lower() or "timed out" in error_msg.lower():
                print(f"[warn] {month_name} 조회 타임아웃. 더 작은 단위로 재시도...")
                # 타임아웃 발생 시 점진적으로 더 작은 단위로 나눠서 조회
                _query_with_fallback(client, org, bucket, measurement, device_key,
                                     current, month_end, month_name, devices, seen, csv_path)
            else:
                print(f"[warn] {month_name} 조회 실패: {e}")
        
        # 다음 달로 이동
        if current.month == 12:
            current = current.replace(year=current.year + 1, month=1)
        else:
            current = current.replace(month=current.month + 1)
    
    print(f"[info] 전체 조회 완료: 총 {len(devices)}개 차량 발견 (중복 제거됨)")
    return sorted(devices)

# =========================
# 단일 차량 점수 계산
# =========================
def calculate_vehicle_score(client: InfluxDBClient, org: str, bucket: str, measurement: str,
                           device: str, device_key: str, start: Optional[str], stop: Optional[str],
                           window: Optional[str], vehicle_type_override: Optional[str] = None,
                           csv_info: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """단일 차량의 점수 계산 (여러 measurement 조합 사용)"""
    # 차량 정보 조회 (segment_stats_drive에서)
    drive_measurement = "segment_stats_drive"
    vehicle_info = get_vehicle_info(client, org, bucket, drive_measurement,
                                    device, device_key, start, stop, window)
    
    car_type_raw = vehicle_info.get("car_type")
    vehicle_type = vehicle_type_override or _map_car_type_to_vehicle_type(car_type_raw)
    
    # 첫 등장일과 마지막 등장일 조회 (segment_stats_drive에서 조회)
    drive_measurement = "segment_stats_drive"
    date_info = get_vehicle_first_last_dates(client, org, bucket, drive_measurement,
                                             device, device_key, start, stop, window)
    first_date_str = date_info.get("first_date")
    last_date_str = date_info.get("last_date")
    
    # 연식: CSV의 model_year, model_month 사용 (차량 제조 연도 및 월)
    # 연식 표시는 YYYY.MM 형식 (예: 2023.02)
    # CSV 정보가 있으면 우선 사용, 없으면 vehicle_info에서 조회
    if csv_info and csv_info.get("model_year") and csv_info.get("model_month"):
        model_year = float(csv_info.get("model_year"))
        model_month = float(csv_info.get("model_month"))
    else:
        model_year = vehicle_info.get("model_year")
        model_month = vehicle_info.get("model_month")
        if model_year is None:
            model_year = 2025.0
        if model_month is None:
            model_month = 1.0
        model_year = float(model_year) if model_year else 2025.0
        model_month = float(model_month) if model_month else 1.0
    
    # 연식 계산(age_years): 실행 시점 - 제조년도 및 월
    # 실행 시점의 현재 날짜 기준으로 계산
    from datetime import datetime
    now = datetime.now()
    current_year = float(now.year)
    current_month = float(now.month)
    
    age_years = (current_year - model_year) + (current_month - model_month) / 12.0
    age_years = max(0.0, age_years)
    
    # 메트릭 조회 (segment_stats_drive에서 효율, 온도, 셀 편차, 주행 습관)
    drive_measurement = "segment_stats_drive"
    efficiency = get_efficiency(client, org, bucket, drive_measurement, device,
                                device_key, start, stop, window)
    
    avg_temp = get_avg_temperature(client, org, bucket, drive_measurement, device,
                                   device_key, start, stop, window)
    
    cell_imb = get_cell_imbalance(client, org, bucket, drive_measurement, device,
                                  device_key, start, stop, window)
    
    driving_habit = get_driving_habit(client, org, bucket, drive_measurement, device,
                                     device_key, start, stop, window)
    
    # 충전 패턴: segment_stats_slow_charge 또는 segment_stats_fast_charge에서 조회
    charging_pattern = get_charging_pattern_combined(client, org, bucket, device,
                                                    device_key, start, stop, window)
    
    # 메트릭 통합
    metrics = {
        "device": device,
        "car_type": car_type_raw,
        "vehicle_type": vehicle_type,
        "model_year": model_year,
        "model_month": model_month,
        "first_date": first_date_str,
        "last_date": last_date_str,
        "efficiency": efficiency,
        "avg_temperature": avg_temp,
        "cell_imbalance": cell_imb,
        "driving_habit": driving_habit,
        "charging_pattern": charging_pattern,
    }
    
    # 최종 점수 계산
    result = calculate_final_score(metrics, vehicle_type, age_years)
    return result

# =========================
# 메인 실행
# =========================
def main():
    URL, TOKEN, ORG, DEFAULT_BUCKET = _load_cfg()
    
    parser = argparse.ArgumentParser(description="차량 배터리 점수 계산 시스템 - raw_bucket 기반 (betterwhy_data measurement)")
    parser.add_argument("--bucket", default=None, help="InfluxDB bucket (default: raw_bucket)")
    parser.add_argument("--measurement", default="betterwhy_data", help="Measurement name (default: betterwhy_data)")
    parser.add_argument("--device-key", default="car_id", help="Device key field name (default: car_id)")
    parser.add_argument("--device", default=None, help="Device ID (car_id). If not provided, processes all devices.")
    parser.add_argument("--start", default="2023-10-01T00:00:00Z", help="Start time (default: 2023-10-01)")
    parser.add_argument("--stop", default="2025-12-31T23:59:59Z", help="Stop time (default: 2025-12-31)")
    parser.add_argument("--window", default=None, help="Range window")
    parser.add_argument("--output", default="vehicle_battery_scores.csv", help="Output CSV file")
    parser.add_argument("--vehicle-type", default=None, choices=["상용차", "소형", "중형", "대형", "프리미엄"],
                       help="Vehicle type. If not provided, will be fetched from car_type.")
    args = parser.parse_args()
    
    # bucket 설정: raw_bucket을 기본값으로 사용
    bucket = args.bucket or DEFAULT_BUCKET or "raw_bucket"
    
    # 차량 목록 조회는 빠르게 하기 위해 짧은 타임아웃 사용
    # 실제 점수 계산은 더 긴 타임아웃 필요하지만, 차량 목록 조회만 먼저 함
    with InfluxDBClient(url=URL, token=TOKEN, org=ORG, timeout=60_000) as client:
        print(f"[info] Bucket: {bucket}")
        print(f"[info] Measurement: {args.measurement}")
        print(f"[info] Time range: {args.start} to {args.stop}")
        print()
        
        # 출력 파일 준비 (현재 작업 디렉토리 기준)
        output_path = Path(args.output)
        if not output_path.is_absolute():
            # 상대 경로인 경우 현재 작업 디렉토리 기준
            output_path = Path.cwd() / args.output
        
        # 디렉토리가 없으면 생성
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
        # 차량 목록 조회: CSV 파일에서 client_id를 car_id로 사용
        device_info = {}  # device_id -> {car_type, model_year, model_month}
        if args.device:
            devices = [args.device]
            print(f"[info] 단일 차량 처리: {args.device}")
            # 단일 차량 모드에서도 CSV에서 정보 가져오기
            csv_file_path = Path("C:/Users/jeon9/Downloads/influxdb_parser/results/betterwhy_cartype_list_20251201.csv")
            if csv_file_path.exists():
                try:
                    with open(csv_file_path, "r", encoding="utf-8-sig") as f:
                        reader = csv.DictReader(f)
                        for row in reader:
                            client_id = row.get("client_id") or row.get("cliend_id")
                            if client_id and client_id.strip() == args.device:
                                model_year_str = row.get("model_year", "").strip() if row.get("model_year") else None
                                model_month_str = row.get("model_month", "").strip() if row.get("model_month") else None
                                # 문자열을 숫자로 변환
                                model_year = None
                                model_month = None
                                if model_year_str:
                                    try:
                                        model_year = int(model_year_str)
                                    except:
                                        pass
                                if model_month_str:
                                    try:
                                        model_month = int(model_month_str)
                                    except:
                                        pass
                                device_info[args.device] = {
                                    "car_type": row.get("car_type", "").strip() if row.get("car_type") else None,
                                    "model_year": model_year,
                                    "model_month": model_month,
                                }
                                break
                except Exception:
                    pass
        else:
            # CSV 파일 경로
            csv_file_path = Path("C:/Users/jeon9/Downloads/influxdb_parser/results/betterwhy_cartype_list_20251201.csv")
            
            if not csv_file_path.exists():
                print(f"[error] CSV 파일을 찾을 수 없습니다: {csv_file_path}")
                return
            
            print(f"[info] CSV 파일에서 차량 목록 로드: {csv_file_path}")
            devices = []
            try:
                with open(csv_file_path, "r", encoding="utf-8-sig") as f:
                    reader = csv.DictReader(f)
                    for row in reader:
                        client_id = row.get("client_id") or row.get("cliend_id")  # 오타 대응
                        if client_id and client_id.strip():
                            device_id = client_id.strip()
                            devices.append(device_id)
                            # CSV에서 car_type, model_year, model_month 정보 저장
                            model_year_str = row.get("model_year", "").strip() if row.get("model_year") else None
                            model_month_str = row.get("model_month", "").strip() if row.get("model_month") else None
                            # 문자열을 숫자로 변환
                            model_year = None
                            model_month = None
                            if model_year_str:
                                try:
                                    model_year = int(model_year_str)
                                except:
                                    pass
                            if model_month_str:
                                try:
                                    model_month = int(model_month_str)
                                except:
                                    pass
                            device_info[device_id] = {
                                "car_type": row.get("car_type", "").strip() if row.get("car_type") else None,
                                "model_year": model_year,
                                "model_month": model_month,
                            }
                
                print(f"[info] CSV 파일에서 {len(devices)}개 차량 로드됨")
            except Exception as e:
                print(f"[error] CSV 파일 읽기 실패: {e}")
                return
        
        if not devices:
            print("[error] 처리할 차량이 없습니다.")
            return
        
        print()
        
        file_exists = output_path.exists()
        results = []
        
        # 단일 차량 모드인지 확인
        single_device_mode = len(devices) == 1
        
        # 다중 차량 모드일 때 헤더 출력
        if not single_device_mode:
            print("차량 ID          | 차종                  | 총점   | 등급 | 효율   | 온도 | 셀     | 주행   | 충전   | 마지막 충전 | 연식     | 수집기간")
            print("-" * 120)
        
        # 각 차량에 대해 점수 계산
        for i, device in enumerate(devices, 1):
            if not single_device_mode:
                print(f"[{i}/{len(devices)}] 처리 중: {device}")
            else:
                print(f"=" * 80)
                print(f"차량 분석: {device}")
                print(f"=" * 80)
            
            try:
                # CSV 정보 전달 (model_year, model_month)
                csv_info_for_device = device_info.get(device, {}) if 'device_info' in locals() else None
                result = calculate_vehicle_score(
                    client, ORG, bucket, args.measurement,
                    device, args.device_key, args.start, args.stop, args.window,
                    args.vehicle_type, csv_info=csv_info_for_device
                )
                results.append(result)
                
                # 결과 출력 (이미지 기준 형식)
                eff_val = result.get('efficiency')
                eff_val_str = f"{eff_val:.2f}" if eff_val is not None else "N/A"
                temp_val = result.get('avg_temperature')
                temp_val_str = f"{temp_val:.1f}" if temp_val is not None else "0.0"
                cell_score = result.get('cell_imbalance_score', 0.0)
                driving_score = result.get('driving_habit_score', 0.0)
                charging_score = result.get('charging_pattern_score', 0.0)
                final_score = result.get('final_score', 0.0)
                
                # 차종 정보: CSV에 car_type이 없으면 InfluxDB에서 가져온 값 사용
                car_type_from_csv = None
                if 'device_info' in locals() and device in device_info:
                    csv_car_type = device_info[device].get('car_type')
                    # CSV에 car_type이 있고 빈 문자열이 아니면 사용
                    if csv_car_type and csv_car_type.strip():
                        car_type_from_csv = csv_car_type.strip()
                
                # CSV에 car_type이 없으면 InfluxDB에서 가져온 값 사용
                car_type_display = car_type_from_csv or result.get('car_type', 'N/A')
                
                # CSV 저장을 위해 result의 car_type을 업데이트 (InfluxDB에서 가져온 값 우선 사용)
                result['car_type'] = car_type_display
                
                # 등급 계산 (이미지 기준, A/B/C/D로 표시)
                # A (매우 좋음): 점수 ≥ 85
                # B (좋음): 70 ≤ 점수 < 85
                # C (보통): 55 ≤ 점수 < 70
                # D (나쁨): 점수 < 55
                if final_score >= 85.0:
                    grade = "A"
                elif final_score >= 70.0:
                    grade = "B"
                elif final_score >= 55.0:
                    grade = "C"
                else:
                    grade = "D"
                
                # 연식 정보 (YYYY.MM 형식)
                age_str = result.get('age_string', 'N/A')
                
                # 수집 기간 (YYYY.MM.DD ~ YYYY.MM.DD 형식)
                collection_period = result.get('collection_period', 'N/A')
                
                # 마지막 충전일 계산 (수집기간의 마지막 날짜 기준)
                last_charge_days = None
                if result.get('last_date'):
                    from datetime import datetime
                    try:
                        last_date = datetime.fromisoformat(result.get('last_date').replace('Z', '+00:00'))
                        now = datetime.now(last_date.tzinfo)
                        days_diff = (now - last_date).days
                        last_charge_days = f"{days_diff}일 전"
                    except:
                        pass
                
                # 이미지 기준 출력 형식: 차량ID | 차종 | 총점 | 등급 | 효율 | 온도 | 셀 | 주행 | 충전 | 마지막 충전 | 연식 | 수집기간
                if single_device_mode:
                    print(f"\n[결과]")
                    print(f"  차량 ID: {result.get('car_id', 'N/A')}")
                    print(f"  차종: {car_type_display} (분류: {result.get('vehicle_type', 'N/A')})")
                    print(f"  총점: {final_score:.1f} (등급: {grade})")
                    
                    # 효율 점수 상세 정보 출력
                    if eff_val is not None:
                        eff_score = result.get('efficiency_score', 0.0)
                        vehicle_type_for_eff = result.get('vehicle_type', '중형')
                        age_years_for_eff = result.get('age_years', 0.0)
                        
                        # 기준값 계산 (효율 점수 계산과 동일)
                        base_ranges = {
                            "상용차": (2.5, 6.5),
                            "소형": (4.0, 8.5),
                            "중형": (3.5, 7.5),
                            "대형": (3.0, 7.0),
                            "프리미엄": (3.8, 8.0),
                        }
                        min_val, max_val = base_ranges.get(vehicle_type_for_eff, (3.5, 7.5))
                        age_adjustment = min(age_years_for_eff * 0.143, 0.8)  # 2.8년: -0.4, 최대 -0.8
                        min_val_adj = min_val - age_adjustment  # min 감소 (완화)
                        max_val_adj = max(0.0, max_val - age_adjustment)  # max 감소 (완화)
                        
                        print(f"  효율: {eff_val_str} km/kWh (점수: {eff_score:.1f})")
                        print(f"    → 기준값: {min_val_adj:.2f}~{max_val_adj:.2f} (차종: {vehicle_type_for_eff}, 연식: {age_years_for_eff:.1f}년, 기본: {min_val}~{max_val})")
                    else:
                        print(f"  효율: {eff_val_str}")
                    
                    print(f"  온도: {temp_val_str}°C (점수: {result.get('temperature_score', 0.0):.1f})")
                    print(f"  셀: {cell_score:.1f}")
                    print(f"  주행: {driving_score:.1f}")
                    print(f"  충전: {charging_score:.1f}")
                    print(f"  마지막 충전: {last_charge_days or 'N/A'}")
                    print(f"  연식: {age_str} (연식 계산: {result.get('age_years', 0.0):.1f}년)")
                    print(f"  수집기간: {collection_period}")
                    print("\n" + "=" * 80)
                else:
                    # 다중 차량 모드: 이미지 기준 테이블 형식 출력
                    # 컬럼: 차량 ID | 차종 | 총점 | 등급 | 효율 | 온도 | 셀 | 주행 | 충전 | 마지막 충전 | 연식 | 수집기간
                    print(f"{result.get('car_id', device):<15} | {car_type_display:<20} | "
                          f"{final_score:>5.1f} | {grade:>2} | "
                          f"{eff_val_str:>5} | {temp_val_str:>4} | "
                          f"{cell_score:>5.1f} | {driving_score:>5.1f} | {charging_score:>5.1f} | "
                          f"{last_charge_days or 'N/A':>10} | {age_str:>8} | {collection_period}")
            except KeyboardInterrupt:
                print(f"\n[info] 사용자에 의해 중단되었습니다.")
                print(f"[info] 현재까지 {len(results)}개 차량 처리 완료")
                break
            except Exception as e:
                error_msg = str(e)
                if "timeout" in error_msg.lower() or "timed out" in error_msg.lower():
                    print(f"  ✗ 타임아웃: {device} (다음 차량으로 계속)")
                elif "KeyboardInterrupt" in error_msg:
                    print(f"\n[info] 사용자에 의해 중단되었습니다.")
                    break
                else:
                    print(f"  ✗ 실패: {error_msg[:100]}...")
                # 실패한 경우에도 기본 정보는 저장
                results.append({
                    "car_id": device,
                    "car_type": None,
                    "vehicle_type": args.vehicle_type or "중형",
                    "age_years": 0.0,
                    "efficiency": None,
                    "efficiency_score": 0.0,
                    "avg_temperature": None,
                    "temperature_score": 0.0,
                    "cell_imbalance": None,
                    "cell_imbalance_score": 0.0,
                    "driving_habit_score": 0.0,
                    "charging_pattern": None,
                    "charging_pattern_score": 0.0,
                    "weighted_avg": 0.0,
                    "age_penalty": 0.0,
                    "final_score": 0.0,
                })
            print()
        
        # CSV 저장
        if results:
            fieldnames = results[0].keys()
            with open(output_path, "w", newline="", encoding="utf-8-sig") as f:
                writer = csv.DictWriter(f, fieldnames=fieldnames)
                writer.writeheader()
                writer.writerows(results)
            
            print("=" * 60)
            print(f"처리 완료: {len(results)}개 차량")
            print(f"결과 파일: {output_path}")
            print("=" * 60)

if __name__ == "__main__":
    main()

