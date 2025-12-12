// 대시보드 JavaScript

let currentTab = 'overview';

// 페이지 로드 시 데이터 가져오기
document.addEventListener('DOMContentLoaded', function() {
    loadDashboardData();
    
    // 테이블 클릭 이벤트 초기 설정
    setupVehicleTableClickHandler();
    
    // 5분마다 자동 새로고침
    setInterval(loadDashboardData, 5 * 60 * 1000);
});

// 탭 전환
function switchTab(tab, event) {
    currentTab = tab;
    
    // 탭 버튼 활성화
    document.querySelectorAll('.nav-tab').forEach(btn => {
        btn.classList.remove('active');
    });
    // event가 있으면 해당 버튼에 active 추가, 없으면 탭 이름으로 찾기
    if (event && event.target) {
        event.target.classList.add('active');
    } else {
        const tabButtons = document.querySelectorAll('.nav-tab');
        tabButtons.forEach(btn => {
            if (btn.textContent.includes(tab === 'overview' ? '개요' : '분석')) {
                btn.classList.add('active');
            }
        });
    }
    
    // 탭 콘텐츠 표시
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(tab + '-tab').classList.add('active');
}

// 데이터 새로고침
function refreshData() {
    const btn = document.querySelector('.refresh-btn');
    btn.style.transform = 'rotate(360deg)';
    setTimeout(() => {
        btn.style.transform = '';
    }, 500);
    loadDashboardData();
}

// 대시보드 데이터 로드
async function loadDashboardData() {
    try {
        const response = await fetch('/api/stats');
        const data = await response.json();
        
        updateStats(data);
        updateVehicleTypes(data.vehicle_types);
        updateCompleteness(data.completeness);
        updateBatteryScore(data.battery_score);
        updateFieldList(data.influxdb);
        updateVehiclePerformance(data.vehicle_performance);
        
        // 총 차량수는 데이터 완성도 분석 합계로 업데이트
        updateTotalVehicles(data.completeness);
    } catch (error) {
        console.error('데이터 로드 실패:', error);
    }
}

// 통계 업데이트
function updateStats(data) {
    const influx = data.influxdb;
    
    // 숫자 포맷팅
    function formatNumber(num) {
        if (num >= 1000000) {
            return (num / 1000000).toFixed(1) + 'M';
        } else if (num >= 1000) {
            return (num / 1000).toFixed(1) + 'K';
        }
        return num.toLocaleString();
    }
    
    // 총 차량수는 updateTotalVehicles에서 별도로 업데이트
    document.getElementById('csv-count').textContent = influx.csv_count.toLocaleString() + '개';
    document.getElementById('field-count').textContent = influx.field_count + '개';
    document.getElementById('last-update').textContent = influx.last_update;
}

// 총 차량수 업데이트 (데이터 완성도 분석 합계)
function updateTotalVehicles(completeness) {
    const total = (completeness.plenty || 0) + (completeness.normal || 0) + (completeness.empty || 0);
    document.getElementById('total-vehicles').textContent = total.toLocaleString() + '대';
}

// 차종별 통계 업데이트
function updateVehicleTypes(vehicleTypes) {
    const container = document.getElementById('vehicle-types-list');
    
    if (!vehicleTypes || vehicleTypes.length === 0) {
        container.innerHTML = '<div class="loading">데이터가 없습니다.</div>';
        return;
    }
    
    container.innerHTML = vehicleTypes.map(item => `
        <div class="vehicle-type-item clickable-vehicle-type" data-car-type="${escapeHtml(item.car_type)}" style="cursor: pointer;">
            <span class="vehicle-type-name">${escapeHtml(item.car_type)}</span>
            <div class="vehicle-type-count">
                <span class="vehicle-type-number">${item.count}대</span>
                <span class="vehicle-type-percentage">(${item.percentage}%)</span>
            </div>
        </div>
    `).join('');
    
    // 차종 클릭 이벤트 추가
    container.querySelectorAll('.clickable-vehicle-type').forEach(item => {
        item.addEventListener('click', function() {
            const carType = this.getAttribute('data-car-type');
            showVehiclesByCarType(carType);
        });
    });
}

// 차종별 차량 표시 함수
function showVehiclesByCarType(carType) {
    // 데이터 분석 탭으로 전환
    // 탭 버튼 찾기 및 활성화
    document.querySelectorAll('.nav-tab').forEach(btn => {
        btn.classList.remove('active');
        if (btn.textContent.includes('분석')) {
            btn.classList.add('active');
        }
    });
    
    // 탭 콘텐츠 표시
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    const analysisTab = document.getElementById('analysis-tab');
    if (analysisTab) {
        analysisTab.classList.add('active');
        currentTab = 'analysis';
    }
    
    // 차종 필터 설정
    const carTypeFilter = document.getElementById('car-type-filter');
    if (carTypeFilter) {
        carTypeFilter.value = carType;
    }
    
    // 필터 적용 (약간의 지연을 두어 DOM 업데이트 후 실행)
    setTimeout(() => {
        applyFilters();
    }, 100);
}

// 완성도 차트 업데이트
function updateCompleteness(completeness) {
    const total = completeness.total || 1;
    
    // 바 업데이트
    document.getElementById('plenty-bar').style.width = completeness.plenty_pct + '%';
    document.getElementById('normal-bar').style.width = completeness.normal_pct + '%';
    document.getElementById('empty-bar').style.width = completeness.empty_pct + '%';
    
    // 값 업데이트
    document.getElementById('plenty-value').textContent = 
        `${completeness.plenty}대 (${completeness.plenty_pct}%)`;
    document.getElementById('normal-value').textContent = 
        `${completeness.normal}대 (${completeness.normal_pct}%)`;
    document.getElementById('empty-value').textContent = 
        `${completeness.empty}대 (${completeness.empty_pct}%)`;
}

// 배터리 점수 해설 업데이트
function updateBatteryScore(batteryData) {
    if (!batteryData) {
        return;
    }
    
    // 전체 점수
    document.getElementById('battery-final-score').textContent = batteryData.final_score || '-';
    document.getElementById('battery-reliability').textContent = batteryData.reliability || '-';
    
    // 레이더 차트 그리기
    drawRadarChart(batteryData.scores);
    
    // 감점 해체
    updatePenalties(batteryData.penalties);
    
    // 백분위 순위
    updatePercentiles(batteryData.scores, batteryData.percentiles);
}

// 레이더 차트 그리기
function drawRadarChart(scores) {
    const canvas = document.getElementById('radar-chart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = Math.min(centerX, centerY) - 40;
    
    // 배경 지우기
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // 원형 그리드
    ctx.strokeStyle = '#e9ecef';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 4; i++) {
        ctx.beginPath();
        ctx.arc(centerX, centerY, (radius * i) / 4, 0, Math.PI * 2);
        ctx.stroke();
    }
    
    // 축 그리기 (5개 항목)
    const items = ['효율', '온도', '셀밸런스', '주행', '충전'];
    const scoreValues = [
        scores.efficiency || 0,
        scores.temperature || 0,
        scores.cell_imbalance || 0,
        scores.driving_habit || 0,
        scores.charging_pattern || 0
    ];
    
    ctx.strokeStyle = '#dee2e6';
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
        const angle = (Math.PI * 2 * i) / 5 - Math.PI / 2;
        const x = centerX + Math.cos(angle) * radius;
        const y = centerY + Math.sin(angle) * radius;
        
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.lineTo(x, y);
        ctx.stroke();
        
        // 라벨
        const labelX = centerX + Math.cos(angle) * (radius + 20);
        const labelY = centerY + Math.sin(angle) * (radius + 20);
        ctx.fillStyle = '#2c3e50';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(items[i], labelX, labelY);
    }
    
    // 점수 폴리곤 그리기
    ctx.fillStyle = 'rgba(102, 126, 234, 0.3)';
    ctx.strokeStyle = '#667eea';
    ctx.lineWidth = 2;
    ctx.beginPath();
    
    for (let i = 0; i < 5; i++) {
        const angle = (Math.PI * 2 * i) / 5 - Math.PI / 2;
        const value = scoreValues[i];
        const r = (radius * value) / 100;
        const x = centerX + Math.cos(angle) * r;
        const y = centerY + Math.sin(angle) * r;
        
        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
}

// 감점 해체 업데이트
function updatePenalties(penalties) {
    const container = document.getElementById('penalty-list');
    if (!container || !penalties) return;
    
    const items = [
        { label: '효율', key: 'efficiency' },
        { label: '온도', key: 'temperature' },
        { label: '셀밸런스', key: 'cell_imbalance' },
        { label: '주행', key: 'driving_habit' },
        { label: '충전', key: 'charging_pattern' },
        { label: '연식', key: 'age' }
    ];
    
    container.innerHTML = items.map(item => {
        const value = penalties[item.key] || 0;
        return `
            <div class="penalty-item">
                <span class="penalty-label">${escapeHtml(item.label)}</span>
                <span class="penalty-value">-${value.toFixed(1)}</span>
            </div>
        `;
    }).join('') + `
        <div class="penalty-item" style="border-top: 2px solid #dee2e6; margin-top: 5px; padding-top: 15px;">
            <span class="penalty-label" style="font-weight: 600;">합계</span>
            <span class="penalty-value" style="font-weight: 700;">-${(penalties.total || 0).toFixed(1)}</span>
        </div>
    `;
}

// 백분위 순위 업데이트
function updatePercentiles(scores, percentiles) {
    const container = document.getElementById('percentile-list');
    if (!container || !scores || !percentiles) return;
    
    const items = [
        { label: '효율', scoreKey: 'efficiency', pctKey: 'efficiency' },
        { label: '온도', scoreKey: 'temperature', pctKey: 'temperature' },
        { label: '셀밸런스', scoreKey: 'cell_imbalance', pctKey: 'cell_imbalance' },
        { label: '주행', scoreKey: 'driving_habit', pctKey: 'driving_habit' },
        { label: '충전', scoreKey: 'charging_pattern', pctKey: 'charging_pattern' }
    ];
    
    container.innerHTML = items.map(item => {
        const score = scores[item.scoreKey] || 0;
        const pct = percentiles[item.pctKey] || 0;
        const isLow = pct < 30;
        
        return `
            <div class="percentile-item">
                <span class="percentile-label">${escapeHtml(item.label)}</span>
                <div class="percentile-bar-container">
                    <div class="percentile-bar ${isLow ? 'orange' : ''}" style="width: ${pct}%"></div>
                </div>
                <div class="percentile-value">
                    <span class="percentile-score">${score.toFixed(1)}점</span>
                    <span class="percentile-pct">(${pct}%)</span>
                </div>
            </div>
        `;
    }).join('');
}

// 데이터 필드 목록 업데이트
function updateFieldList(influxData) {
    const container = document.getElementById('field-categories');
    if (!container) return;
    
    // 필드 카테고리 정의
    const categories = [
        {
            title: '배터리',
            titleEn: 'Battery',
            count: 197,
            fields: [
                'cell 1 ~ cell 192',
                'disp_soc',
                'pack_v',
                'soc',
                'soh',
                'sub_battery_volt'
            ]
        },
        {
            title: '충전',
            titleEn: 'Charge',
            count: 5,
            fields: [
                'chg_sac',
                'chg_state',
                'dch_sac',
                'fast_chg_current',
                'slow_chg_current'
            ]
        },
        {
            title: '전류/전압',
            titleEn: 'Current/Voltage',
            count: 2,
            fields: ['current', 'volt']
        },
        {
            title: '온도',
            titleEn: 'Temperature',
            count: 35,
            fields: ['temperature 1 ~ temperature 35']
        },
        {
            title: '주행',
            titleEn: 'Drive',
            count: 6,
            fields: [
                'accel 1 ~ accel 3',
                'brake 1 ~ brake 3',
                'mileage',
                'speed'
            ]
        },
        {
            title: '위치',
            titleEn: 'GPS',
            count: 3,
            fields: ['gps_alt', 'gps_lat', 'gps_lon']
        },
        {
            title: '기타',
            titleEn: 'Others',
            count: 5,
            fields: ['ev_state', 'event', 'model_month', 'model_year', 'savedtime']
        }
    ];
    
    container.innerHTML = categories.map(category => `
        <div class="field-category-panel">
            <div class="field-category-header">
                <div>
                    <div class="field-category-title">${escapeHtml(category.title)}/${escapeHtml(category.titleEn)}</div>
                </div>
                <div class="field-category-count">${category.count}</div>
            </div>
            <div class="field-list">
                ${category.fields.map(field => `
                    <div class="field-item">
                        <div class="field-icon"></div>
                        <span class="field-name">${escapeHtml(field)}</span>
                    </div>
                `).join('')}
            </div>
        </div>
    `).join('');
}

// 필드 목록 접기/펼치기
function toggleFieldList() {
    const btn = document.getElementById('field-toggle-btn');
    const categories = document.getElementById('field-categories');
    if (!btn || !categories) return;
    
    if (categories.style.display === 'none') {
        categories.style.display = 'grid';
        btn.textContent = '접기';
    } else {
        categories.style.display = 'none';
        btn.textContent = '펼치기';
    }
}

// 차량별 배터리 성능 업데이트
let allVehicles = [];
let filteredVehicles = [];
let currentGradeFilter = 'all';

function updateVehiclePerformance(performanceData) {
    if (!performanceData || !performanceData.vehicles) {
        return;
    }
    
    allVehicles = performanceData.vehicles;
    filteredVehicles = [...allVehicles];
    currentGradeFilter = 'all'; // 초기화
    
    // 요약 통계 업데이트
    const summary = performanceData.summary;
    document.getElementById('total-vehicles-count').textContent = summary.total;
    document.getElementById('summary-total').textContent = summary.total;
    document.getElementById('summary-excellent').textContent = summary.excellent;
    document.getElementById('summary-good').textContent = summary.good;
    document.getElementById('summary-normal').textContent = summary.normal;
    document.getElementById('summary-bad').textContent = summary.bad;
    
    // 통계 업데이트
    const stats = performanceData.stats;
    document.getElementById('total-mileage').textContent = formatMileage(stats.total_mileage);
    document.getElementById('avg-efficiency').textContent = `${stats.avg_efficiency} km/kWh`;
    document.getElementById('avg-battery-health').textContent = `${stats.avg_battery_health}%`;
    
    // 등급 필터 초기화 (전체 차량 활성화)
    document.querySelectorAll('.summary-box.clickable').forEach(box => {
        box.classList.remove('active');
    });
    const allBox = document.getElementById('summary-box-all');
    if (allBox) {
        allBox.classList.add('active');
    }
    
    // 차종 필터 업데이트
    updateCarTypeFilter();
    
    // 테이블 업데이트
    updateVehicleTable();
    
    // 테이블 클릭 이벤트 설정
    setupVehicleTableClickHandler();
    
    // 차트 업데이트
    drawBarChart();
    drawDonutChart(performanceData.summary);
}

function formatMileage(km) {
    if (km >= 1000000) {
        return `${(km / 1000000).toFixed(1)}M km`;
    } else if (km >= 1000) {
        return `${(km / 1000).toFixed(1)}K km`;
    }
    return `${km.toLocaleString()} km`;
}

function updateCarTypeFilter() {
    const filter = document.getElementById('car-type-filter');
    if (!filter) return;
    
    const carTypes = [...new Set(allVehicles.map(v => v.car_type).filter(Boolean))].sort();
    
    filter.innerHTML = '<option value="all">전체 차종</option>' +
        carTypes.map(type => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`).join('');
}

function updateVehicleTable() {
    const tbody = document.getElementById('vehicle-table-body');
    if (!tbody) return;
    
    if (filteredVehicles.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="loading">데이터가 없습니다.</td></tr>';
        return;
    }
    
    // 점수 기준 정렬 (내림차순)
    const sorted = [...filteredVehicles].sort((a, b) => b.final_score - a.final_score);
    
    tbody.innerHTML = sorted.map(vehicle => {
        const gradeClass = getGradeClass(vehicle.grade);
        return `
            <tr class="vehicle-row" data-car-id="${escapeHtml(vehicle.car_id)}" style="cursor: pointer;">
                <td><input type="checkbox" onclick="event.stopPropagation()"></td>
                <td>${escapeHtml(vehicle.car_id)}</td>
                <td>${escapeHtml(vehicle.car_type || '-')}</td>
                <td>
                    <span class="score-badge ${gradeClass}">${vehicle.final_score}% ${vehicle.grade}</span>
                </td>
                <td>${vehicle.efficiency ? vehicle.efficiency + ' km/kWh' : '-'}</td>
                <td>${vehicle.last_charge || '-'}</td>
                <td>${vehicle.age_string || '-'}</td>
                <td>${vehicle.collection_period || '-'}</td>
            </tr>
        `;
    }).join('');
}

// 테이블 클릭 이벤트 위임 (한 번만 설정)
function setupVehicleTableClickHandler() {
    const tbody = document.getElementById('vehicle-table-body');
    if (!tbody) return;
    
    // 기존 리스너 제거 후 새로 추가
    tbody.removeEventListener('click', handleVehicleRowClick);
    tbody.addEventListener('click', handleVehicleRowClick);
}

function handleVehicleRowClick(e) {
    // 체크박스 클릭 시에는 모달이 열리지 않도록
    if (e.target.type === 'checkbox' || e.target.tagName === 'INPUT') {
        return;
    }
    
    // 가장 가까운 vehicle-row 찾기
    const row = e.target.closest('.vehicle-row');
    if (!row) return;
    
    const carId = row.getAttribute('data-car-id');
    if (carId) {
        console.log('차량 행 클릭됨, carId:', carId);
        openVehicleDetail(carId);
    } else {
        console.error('carId를 찾을 수 없습니다');
    }
}

function getGradeClass(grade) {
    if (grade === '매우 좋음') return 'excellent';
    if (grade === '좋음') return 'good';
    if (grade === '보통') return 'normal';
    if (grade === '나쁨') return 'bad';
    return 'normal';
}

function drawBarChart() {
    const canvas = document.getElementById('battery-bar-chart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    ctx.clearRect(0, 0, width, height);
    
    if (filteredVehicles.length === 0) return;
    
    // 점수 기준 정렬
    const sorted = [...filteredVehicles].sort((a, b) => b.final_score - a.final_score);
    const barWidth = Math.max(2, (width - 100) / sorted.length);
    const maxScore = 100;
    const chartHeight = height - 80;
    const chartY = 20;
    
    // 그리드 그리기
    ctx.strokeStyle = '#e9ecef';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
        const y = chartY + (chartHeight * i / 5);
        ctx.beginPath();
        ctx.moveTo(50, y);
        ctx.lineTo(width - 50, y);
        ctx.stroke();
        
        // Y축 라벨
        ctx.fillStyle = '#666';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText((100 - i * 20).toString(), 45, y + 4);
    }
    
    // 바 차트 그리기
    sorted.forEach((vehicle, index) => {
        const x = 50 + index * barWidth;
        const barHeight = (vehicle.final_score / maxScore) * chartHeight;
        const y = chartY + chartHeight - barHeight;
        
        const color = getGradeColor(vehicle.grade);
        ctx.fillStyle = color;
        ctx.fillRect(x, y, barWidth - 1, barHeight);
    });
    
    // X축 라벨
    ctx.fillStyle = '#666';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    const labelStep = Math.max(1, Math.floor(sorted.length / 10));
    for (let i = 0; i < sorted.length; i += labelStep) {
        const x = 50 + i * barWidth + barWidth / 2;
        ctx.save();
        ctx.translate(x, height - 30);
        ctx.rotate(-Math.PI / 4);
        ctx.fillText(sorted[i].car_id.substring(0, 8), 0, 0);
        ctx.restore();
    }
}

function getGradeColor(grade) {
    if (grade === '매우 좋음') return '#4CAF50';
    if (grade === '좋음') return '#2196F3';
    if (grade === '보통') return '#FFC107';
    if (grade === '나쁨') return '#FF9800';
    return '#F44336';
}

function drawDonutChart(summary) {
    const canvas = document.getElementById('donut-chart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = Math.min(centerX, centerY) - 20;
    const innerRadius = radius * 0.6;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const total = summary.total || 1;
    const data = [
        { label: '매우 좋음', value: summary.excellent || 0, color: '#4CAF50' },
        { label: '좋음', value: summary.good || 0, color: '#2196F3' },
        { label: '보통', value: summary.normal || 0, color: '#FFC107' },
        { label: '나쁨', value: summary.bad || 0, color: '#FF9800' }
    ];
    
    let currentAngle = -Math.PI / 2;
    
    data.forEach(item => {
        const sliceAngle = (item.value / total) * Math.PI * 2;
        
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, currentAngle, currentAngle + sliceAngle);
        ctx.arc(centerX, centerY, innerRadius, currentAngle + sliceAngle, currentAngle, true);
        ctx.closePath();
        ctx.fillStyle = item.color;
        ctx.fill();
        
        currentAngle += sliceAngle;
    });
    
    // 중앙 텍스트
    ctx.fillStyle = '#2c3e50';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${total}대`, centerX, centerY - 5);
    
    // 비율 표시
    const maxValue = Math.max(...data.map(d => d.value));
    const maxItem = data.find(d => d.value === maxValue);
    if (maxItem && maxItem.value > 0) {
        const percentage = Math.round((maxItem.value / total) * 100);
        ctx.font = '14px sans-serif';
        ctx.fillText(`${percentage}%`, centerX, centerY + 15);
    }
}

// 뷰 전환
function switchView(view) {
    document.getElementById('table-view-btn').classList.toggle('active', view === 'table');
    document.getElementById('chart-view-btn').classList.toggle('active', view === 'chart');
    document.getElementById('table-view').classList.toggle('active', view === 'table');
    document.getElementById('chart-view').classList.toggle('active', view === 'chart');
}

// 점수 기준 모달 열기/닫기
function openScoreCriteria() {
    const modal = document.getElementById('score-criteria-modal');
    if (modal) {
        modal.classList.add('show');
        document.body.style.overflow = 'hidden'; // 배경 스크롤 방지
    }
}

function closeScoreCriteria() {
    const modal = document.getElementById('score-criteria-modal');
    if (modal) {
        modal.classList.remove('show');
        document.body.style.overflow = ''; // 스크롤 복원
    }
}

// 모달 외부 클릭 시 닫기
window.onclick = function(event) {
    const modal = document.getElementById('score-criteria-modal');
    if (event.target === modal) {
        closeScoreCriteria();
    }
}

// 필터 이벤트 리스너 (페이지 로드 후 설정)
setTimeout(() => {
    const carTypeFilter = document.getElementById('car-type-filter');
    const searchInput = document.getElementById('vehicle-search');
    const periodFilter = document.getElementById('period-filter');
    const periodFilterSmall = document.getElementById('period-filter-small');
    
    if (carTypeFilter) {
        carTypeFilter.addEventListener('change', applyFilters);
    }
    if (searchInput) {
        searchInput.addEventListener('input', applyFilters);
    }
    if (periodFilter) {
        periodFilter.addEventListener('change', function() {
            if (periodFilterSmall) periodFilterSmall.value = this.value;
            applyFilters();
        });
    }
    if (periodFilterSmall) {
        periodFilterSmall.addEventListener('change', function() {
            if (periodFilter) periodFilter.value = this.value;
            applyFilters();
        });
    }
}, 100);

// 등급별 필터링
function filterByGrade(grade) {
    currentGradeFilter = grade;
    
    // 모든 summary-box에서 active 클래스 제거
    document.querySelectorAll('.summary-box.clickable').forEach(box => {
        box.classList.remove('active');
    });
    
    // 선택된 박스에 active 클래스 추가
    const boxId = grade === 'all' ? 'summary-box-all' : 
                  grade === 'excellent' ? 'summary-box-excellent' :
                  grade === 'good' ? 'summary-box-good' :
                  grade === 'normal' ? 'summary-box-normal' : 'summary-box-bad';
    const selectedBox = document.getElementById(boxId);
    if (selectedBox) {
        selectedBox.classList.add('active');
    }
    
    // 필터 적용
    applyFilters();
}

// 이전 차종 필터 값 저장
let previousCarType = 'all';
// 이전 등급 필터 값 저장
let previousGrade = 'all';

async function applyFilters() {
    const carType = document.getElementById('car-type-filter')?.value || 'all';
    const search = document.getElementById('vehicle-search')?.value.toLowerCase() || '';
    const period = document.getElementById('period-filter')?.value || 'all';
    
    filteredVehicles = allVehicles.filter(vehicle => {
        // 등급 필터
        if (currentGradeFilter === 'excellent' && vehicle.grade !== '매우 좋음') {
            return false;
        }
        if (currentGradeFilter === 'good' && vehicle.grade !== '좋음') {
            return false;
        }
        if (currentGradeFilter === 'normal' && vehicle.grade !== '보통') {
            return false;
        }
        if (currentGradeFilter === 'bad' && vehicle.grade !== '나쁨') {
            return false;
        }
        
        // 차종 필터
        if (carType !== 'all' && vehicle.car_type !== carType) {
            return false;
        }
        
        // 검색 필터
        if (search && !vehicle.car_id.toLowerCase().includes(search) && 
            !vehicle.car_type?.toLowerCase().includes(search)) {
            return false;
        }
        
        // 수집 기간 필터 (간단한 구현)
        // 실제로는 collection_period를 파싱해서 필터링해야 함
        return true;
    });
    
    // 필터링된 요약 통계 계산
    const filteredSummary = {
        total: filteredVehicles.length,
        excellent: filteredVehicles.filter(v => v.grade === '매우 좋음').length,
        good: filteredVehicles.filter(v => v.grade === '좋음').length,
        normal: filteredVehicles.filter(v => v.grade === '보통').length,
        bad: filteredVehicles.filter(v => v.grade === '나쁨').length
    };
    
    // 요약 통계 업데이트
    document.getElementById('summary-total').textContent = filteredSummary.total;
    document.getElementById('summary-excellent').textContent = filteredSummary.excellent;
    document.getElementById('summary-good').textContent = filteredSummary.good;
    document.getElementById('summary-normal').textContent = filteredSummary.normal;
    document.getElementById('summary-bad').textContent = filteredSummary.bad;
    
    // 필터링된 차량들의 통계 계산 및 업데이트
    updateFilteredStats(filteredVehicles);
    
    // 차종 필터 또는 등급 필터가 변경되었으면 배터리 점수 통계 업데이트
    if (previousCarType !== carType || previousGrade !== currentGradeFilter) {
        previousCarType = carType;
        previousGrade = currentGradeFilter;
        await updateBatteryScoreForFilters(carType, currentGradeFilter);
    }
    
    updateVehicleTable();
    drawBarChart();
    drawDonutChart(filteredSummary);
}

// 필터링된 차량들의 통계 업데이트
function updateFilteredStats(vehicles) {
    if (!vehicles || vehicles.length === 0) {
        document.getElementById('total-mileage').textContent = '0 km';
        document.getElementById('avg-efficiency').textContent = '0 km/kWh';
        document.getElementById('avg-battery-health').textContent = '0%';
        return;
    }
    
    // 총 주행거리 계산 (차량 수 * 평균 주행거리 추정)
    // 실제로는 각 차량의 주행거리를 합산해야 하지만, 현재 데이터에는 없으므로 추정값 사용
    const totalMileage = vehicles.length * 47000; // 대략적인 추정
    
    // 평균 에너지 효율 계산
    let totalEfficiency = 0;
    let efficiencyCount = 0;
    vehicles.forEach(vehicle => {
        if (vehicle.efficiency !== null && vehicle.efficiency !== undefined) {
            totalEfficiency += vehicle.efficiency;
            efficiencyCount++;
        }
    });
    const avgEfficiency = efficiencyCount > 0 ? totalEfficiency / efficiencyCount : 0;
    
    // 평균 배터리 건강도 계산 (final_score의 평균)
    let totalScore = 0;
    let scoreCount = 0;
    vehicles.forEach(vehicle => {
        if (vehicle.final_score !== null && vehicle.final_score !== undefined) {
            totalScore += vehicle.final_score;
            scoreCount++;
        }
    });
    const avgBatteryHealth = scoreCount > 0 ? totalScore / scoreCount : 0;
    
    // 지표 업데이트
    document.getElementById('total-mileage').textContent = formatMileage(totalMileage);
    document.getElementById('avg-efficiency').textContent = `${avgEfficiency.toFixed(1)} km/kWh`;
    document.getElementById('avg-battery-health').textContent = `${avgBatteryHealth.toFixed(1)}%`;
}

// 차종별/등급별 배터리 점수 통계 업데이트
async function updateBatteryScoreForFilters(carType, grade) {
    try {
        const params = new URLSearchParams();
        if (carType && carType !== 'all') {
            params.append('car_type', carType);
        }
        if (grade && grade !== 'all') {
            params.append('grade', grade);
        }
        
        const url = params.toString() ? `/api/stats?${params.toString()}` : '/api/stats';
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.battery_score) {
            updateBatteryScore(data.battery_score);
        }
    } catch (error) {
        console.error('배터리 점수 통계 업데이트 실패:', error);
    }
}

// 차종별 배터리 점수 통계 업데이트 (하위 호환성)
async function updateBatteryScoreForCarType(carType) {
    await updateBatteryScoreForFilters(carType, currentGradeFilter);
}

// 차량 상세 분석 모달 열기
async function openVehicleDetail(carId) {
    console.log('openVehicleDetail 호출됨, carId:', carId);
    const modal = document.getElementById('vehicle-detail-modal');
    if (!modal) {
        console.error('vehicle-detail-modal을 찾을 수 없습니다');
        alert('모달을 찾을 수 없습니다.');
        return;
    }
    
    try {
        console.log('API 요청 시작:', `/api/vehicle-detail/${encodeURIComponent(carId)}`);
        const response = await fetch(`/api/vehicle-detail/${encodeURIComponent(carId)}`);
        if (!response.ok) {
            const errorText = await response.text();
            console.error('API 응답 오류:', response.status, errorText);
            alert(`차량 정보를 불러올 수 없습니다. (${response.status})`);
            return;
        }
        
        const data = await response.json();
        console.log('API 응답 받음:', data);
        
        // 기본 정보 업데이트
        document.getElementById('detail-total-rows').textContent = data.basic_info.total_rows.toLocaleString();
        document.getElementById('detail-age-string').textContent = data.basic_info.age_string || '-';
        document.getElementById('detail-collection-period').textContent = data.basic_info.collection_period || '-';
        document.getElementById('detail-car-id').textContent = data.basic_info.car_id;
        document.getElementById('detail-car-type').textContent = data.basic_info.car_type || '-';
        
        // 구간 수 업데이트
        const driveCount = data.section_counts.drive || 0;
        const parkingCount = data.section_counts.parking || 0;
        const fastChargeCount = data.section_counts.fast_charge || 0;
        const slowChargeCount = data.section_counts.slow_charge || 0;
        
        // 모든 값이 0인지 확인
        const allZero = driveCount === 0 && parkingCount === 0 && fastChargeCount === 0 && slowChargeCount === 0;
        
        if (allZero) {
            // 모든 값이 0이면 ?로 표시
            document.getElementById('detail-drive-count').textContent = '?';
            document.getElementById('detail-parking-count').textContent = '?';
            document.getElementById('detail-fast-charge-count').textContent = '?';
            document.getElementById('detail-slow-charge-count').textContent = '?';
            
            // 안내 메시지 표시
            const messageEl = document.getElementById('section-count-message');
            if (messageEl) {
                messageEl.style.display = 'block';
            }
        } else {
            // 값이 있으면 정상 표시
            document.getElementById('detail-drive-count').textContent = driveCount.toLocaleString();
            document.getElementById('detail-parking-count').textContent = parkingCount.toLocaleString();
            document.getElementById('detail-fast-charge-count').textContent = fastChargeCount.toLocaleString();
            document.getElementById('detail-slow-charge-count').textContent = slowChargeCount.toLocaleString();
            
            // 안내 메시지 숨김
            const messageEl = document.getElementById('section-count-message');
            if (messageEl) {
                messageEl.style.display = 'none';
            }
        }
        
        // 배터리 점수 업데이트
        document.getElementById('detail-final-score').textContent = data.battery_score.final_score;
        
        // 레이더 차트 그리기
        drawDetailRadarChart(data.battery_score.scores);
        
        // 감점 해제 업데이트
        updateDetailPenalties(data.battery_score.penalties);
        
        // 백분위 순위 업데이트
        updateDetailPercentiles(data.battery_score.scores, data.battery_score.percentiles);
        
        // 기여도 상세 업데이트
        updateContributionDetails(data.contribution_details);
        
        // 연식 패널티 정보 업데이트
        const ageInfo = data.contribution_details.age_penalty;
        if (ageInfo) {
            const ageStr = ageInfo.model_year && ageInfo.model_month ? 
                `${ageInfo.model_year}년 ${parseInt(ageInfo.model_month)}월 (${ageInfo.age_years}년)` : '-';
            document.getElementById('detail-age-info').textContent = ageStr;
            document.getElementById('detail-collection-start').textContent = data.basic_info.first_date ? 
                new Date(data.basic_info.first_date).toLocaleDateString('ko-KR') : '-';
        }
        
        // 데이터 저장 (효율 상세 모달에서 사용)
        currentVehicleDetailData = data;
        
        // 모달 표시
        modal.classList.add('show');
        document.body.style.overflow = 'hidden';
        
        console.log('차량 상세 모달 열림:', carId);
        console.log('모달 클래스:', modal.className);
    } catch (error) {
        console.error('차량 상세 정보 로드 실패:', error);
        console.error('에러 스택:', error.stack);
        alert('차량 정보를 불러오는 중 오류가 발생했습니다: ' + error.message);
    }
}

// 차량 상세 분석 모달 닫기
function closeVehicleDetail() {
    const modal = document.getElementById('vehicle-detail-modal');
    if (modal) {
        modal.classList.remove('show');
        document.body.style.overflow = '';
    }
}

// 상세 레이더 차트 그리기
function drawDetailRadarChart(scores) {
    const canvas = document.getElementById('detail-radar-chart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = Math.min(centerX, centerY) - 40;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // 원형 그리드
    ctx.strokeStyle = '#e9ecef';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 4; i++) {
        ctx.beginPath();
        ctx.arc(centerX, centerY, (radius * i) / 4, 0, Math.PI * 2);
        ctx.stroke();
    }
    
    // 축 그리기
    const items = ['효율', '온도', '셀밸런스', '주행', '충전'];
    const scoreValues = [
        scores.efficiency || 0,
        scores.temperature || 0,
        scores.cell_imbalance || 0,
        scores.driving_habit || 0,
        scores.charging_pattern || 0
    ];
    
    ctx.strokeStyle = '#dee2e6';
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
        const angle = (Math.PI * 2 * i) / 5 - Math.PI / 2;
        const x = centerX + Math.cos(angle) * radius;
        const y = centerY + Math.sin(angle) * radius;
        
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.lineTo(x, y);
        ctx.stroke();
        
        // 라벨
        const labelX = centerX + Math.cos(angle) * (radius + 20);
        const labelY = centerY + Math.sin(angle) * (radius + 20);
        ctx.fillStyle = '#2c3e50';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(items[i], labelX, labelY);
    }
    
    // 점수 폴리곤 그리기
    ctx.fillStyle = 'rgba(102, 126, 234, 0.3)';
    ctx.strokeStyle = '#667eea';
    ctx.lineWidth = 2;
    ctx.beginPath();
    
    for (let i = 0; i < 5; i++) {
        const angle = (Math.PI * 2 * i) / 5 - Math.PI / 2;
        const value = scoreValues[i];
        const r = (radius * value) / 100;
        const x = centerX + Math.cos(angle) * r;
        const y = centerY + Math.sin(angle) * r;
        
        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
}

// 상세 감점 해제 업데이트
function updateDetailPenalties(penalties) {
    const container = document.getElementById('detail-penalty-list');
    if (!container || !penalties) return;
    
    const items = [
        { label: '효율', key: 'efficiency' },
        { label: '온도', key: 'temperature' },
        { label: '셀밸런스', key: 'cell_imbalance' },
        { label: '주행', key: 'driving_habit' },
        { label: '충전', key: 'charging_pattern' },
        { label: '연식', key: 'age' }
    ];
    
    container.innerHTML = items.map(item => {
        const value = penalties[item.key] || 0;
        return `
            <div class="penalty-item-detail">
                <span class="penalty-label-detail">${escapeHtml(item.label)}</span>
                <span class="penalty-value-detail">-${value.toFixed(1)}</span>
            </div>
        `;
    }).join('') + `
        <div class="penalty-item-detail" style="border-top: 2px solid #dee2e6; margin-top: 10px; padding-top: 15px;">
            <span class="penalty-label-detail" style="font-weight: 600;">합계</span>
            <span class="penalty-value-detail" style="font-weight: 700;">-${(penalties.total || 0).toFixed(1)}</span>
        </div>
    `;
}

// 상세 백분위 순위 업데이트
function updateDetailPercentiles(scores, percentiles) {
    const container = document.getElementById('detail-percentile-list');
    if (!container || !scores || !percentiles) return;
    
    const items = [
        { label: '효율', scoreKey: 'efficiency', pctKey: 'efficiency' },
        { label: '온도', scoreKey: 'temperature', pctKey: 'temperature' },
        { label: '셀밸런스', scoreKey: 'cell_imbalance', pctKey: 'cell_imbalance' },
        { label: '주행', scoreKey: 'driving_habit', pctKey: 'driving_habit' },
        { label: '충전', scoreKey: 'charging_pattern', pctKey: 'charging_pattern' }
    ];
    
    container.innerHTML = items.map(item => {
        const score = scores[item.scoreKey] || 0;
        const pct = percentiles[item.pctKey] || 0;
        const isLow = pct < 30;
        
        return `
            <div class="percentile-item-detail">
                <span class="percentile-label-detail">${escapeHtml(item.label)}</span>
                <div class="percentile-bar-container-detail">
                    <div class="percentile-bar-detail ${isLow ? 'orange' : ''}" style="width: ${pct}%"></div>
                </div>
                <div class="percentile-value-detail">
                    <span class="percentile-score-detail">${score.toFixed(1)}점</span>
                    <span class="percentile-pct-detail">(${pct}%)</span>
                </div>
            </div>
        `;
    }).join('');
}

// 기여도 상세 업데이트
function updateContributionDetails(details) {
    // 효율
    updateContributionItem('efficiency', details.efficiency, '#667eea');
    
    // 온도
    updateContributionItem('temperature', details.temperature, '#667eea');
    
    // 셀밸런스
    updateContributionItem('cell', details.cell_imbalance, '#667eea');
    
    // 주행
    updateContributionItem('driving', details.driving_habit, '#9c27b0');
    
    // 충전
    updateContributionItem('charging', details.charging_pattern, '#f44336');
    
    // 연식 패널티
    const ageInfo = details.age_penalty;
    if (ageInfo) {
        const ageScoreEl = document.getElementById('detail-age-penalty-score');
        if (ageScoreEl) {
            ageScoreEl.textContent = `${ageInfo.penalty}점`;
        }
        
        const ageStr = ageInfo.model_year && ageInfo.model_month ? 
            `${ageInfo.model_year}년 ${parseInt(ageInfo.model_month)}월 (${ageInfo.age_years}년)` : '-';
        document.getElementById('detail-age-info').textContent = ageStr;
    }
}

function updateContributionItem(prefix, item, color) {
    if (!item) return;
    
    // 실제 데이터가 있는지 확인 (efficiency, temperature의 경우 value가 있어야 함)
    const hasData = item.value !== null && item.value !== undefined && item.value !== '';
    
    // 점수 변화량 표시
    const scoreChangeEl = document.getElementById(`detail-${prefix}-score-change`);
    if (scoreChangeEl && item.score !== undefined) {
        const change = item.change || 0;
        const changeText = change > 0 ? `(+${change.toFixed(1)})` : change < 0 ? `(${change.toFixed(1)})` : `(${change.toFixed(1)})`;
        scoreChangeEl.textContent = `${item.score.toFixed(1)} ${changeText}`;
        scoreChangeEl.className = 'contribution-score-change';
        if (change > 0) {
            scoreChangeEl.style.color = '#4CAF50';
        } else if (change < 0) {
            scoreChangeEl.style.color = '#f44336';
        } else {
            scoreChangeEl.style.color = '#666';
        }
    }
    
    // 요약 정보 표시
    const summaryEl = document.getElementById(`detail-${prefix}-summary`);
    if (summaryEl && item.summary) {
        summaryEl.textContent = item.summary;
    }
    
    // 모든 시계열 차트 컨테이너 숨김 (기여도 상세에서는 사용하지 않음)
    const chartContainer = document.querySelector(`#detail-${prefix}-chart`)?.parentElement;
    if (chartContainer) {
        chartContainer.style.display = 'none';
    }
    
    // 효율 항목의 "자세히" 버튼에 이벤트 리스너 추가
    if (prefix === 'efficiency') {
        const detailBtn = summaryEl?.parentElement?.querySelector('.detail-btn');
        if (detailBtn) {
            detailBtn.onclick = function() {
                // 데이터가 없으면 경고창만 띄우기
                if (!hasData) {
                    alert('효율 데이터가 없어 효율 상세 분석을 제공할 수 없습니다.');
                    return;
                }
                openEfficiencyDetail();
            };
        }
    }
    
    // 온도 항목의 "자세히" 버튼에 이벤트 리스너 추가
    if (prefix === 'temperature') {
        const detailBtn = summaryEl?.parentElement?.querySelector('.detail-btn');
        if (detailBtn) {
            detailBtn.onclick = function() {
                // 데이터가 없으면 경고창만 띄우기
                if (!hasData) {
                    alert('온도 데이터가 없어 온도 상세 분석을 제공할 수 없습니다.');
                    return;
                }
                openTemperatureDetail();
            };
        }
    }
    
    // 셀 밸런스 항목의 "자세히" 버튼에 이벤트 리스너 추가
    if (prefix === 'cell') {
        const detailBtn = summaryEl?.parentElement?.querySelector('.detail-btn');
        if (detailBtn) {
            detailBtn.onclick = function() {
                // 데이터가 없으면 경고창만 띄우기
                if (!hasData) {
                    alert('셀 밸런스 데이터가 없어 셀 밸런스 상세 분석을 제공할 수 없습니다.');
                    return;
                }
                openCellBalanceDetail();
            };
        }
    }
}

// 시계열 차트 그리기
function drawTimeSeriesChart(canvasId, baseScore, color) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    ctx.clearRect(0, 0, width, height);
    
    // 배경 그리드
    ctx.strokeStyle = '#f0f0f0';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const y = (height / 4) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
    }
    
    // 실제 데이터가 없으면 차트를 그리지 않음
    // TODO: 실제 시계열 데이터를 API에서 가져와서 사용해야 함
    // 현재는 데이터가 없으므로 차트를 그리지 않음
    ctx.fillStyle = '#999';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('시계열 데이터를 사용할 수 없습니다', width / 2, height / 2);
    return;
    
    // 선 그래프 그리기
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    
    const minValue = Math.min(...data);
    const maxValue = Math.max(...data);
    const range = maxValue - minValue || 1;
    
    for (let i = 0; i < points; i++) {
        const x = (i / points) * width;
        const normalizedValue = (data[i] - minValue) / range;
        const y = height - (normalizedValue * height * 0.8) - height * 0.1;
        
        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    }
    ctx.stroke();
}

// 온도 상세 분석 모달 열기
function openTemperatureDetail() {
    if (!currentVehicleDetailData) {
        alert('차량 정보를 먼저 로드해주세요.');
        return;
    }
    
    const modal = document.getElementById('temperature-detail-modal');
    if (!modal) return;
    
    const details = currentVehicleDetailData.contribution_details;
    const batteryScore = currentVehicleDetailData.battery_score;
    const basicInfo = currentVehicleDetailData.basic_info;
    const sectionCounts = currentVehicleDetailData.section_counts;
    
    // 주행 관련 데이터 가용성 확인
    const hasDrivingData = (sectionCounts.drive > 0 || sectionCounts.parking > 0);
    
    // 온도 상세 분석 업데이트
    if (hasDrivingData) {
        updateTemperatureDetailAnalysis(details.temperature, batteryScore, basicInfo);
        // 데이터 없음 메시지 숨김
        const noDataMsg = document.getElementById('temperature-no-data-message');
        if (noDataMsg) noDataMsg.style.display = 'none';
    } else {
        // 데이터 없음 메시지 표시
        showNoDataMessage('temperature-detail-modal', 'temperature-no-data-message', '주행');
        // 차트는 그리지 않음
    }
    
    // 모달 표시
    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
}

// 온도 상세 분석 모달 닫기
function closeTemperatureDetail() {
    const modal = document.getElementById('temperature-detail-modal');
    if (modal) {
        modal.classList.remove('show');
        document.body.style.overflow = '';
    }
}

// 온도 기여도 상세 요약 리스트 업데이트
function updateTemperatureDetailContributionList(details) {
    const container = document.getElementById('temperature-detail-contribution-list');
    if (!container) return;
    
    const items = [
        { key: 'efficiency', label: '효율(점수 추이)', data: details.efficiency, color: '#667eea' },
        { key: 'temperature', label: '온도(점수 추이)', data: details.temperature, color: '#667eea' },
        { key: 'cell_imbalance', label: '셀밸런스(점수 추이)', data: details.cell_imbalance, color: '#667eea' },
        { key: 'driving_habit', label: '주행(활동 추이)', data: details.driving_habit, color: '#9c27b0' },
        { key: 'charging_pattern', label: '충전(활동 추이)', data: details.charging_pattern, color: '#f44336' },
        { key: 'age_penalty', label: '연식 패널티', data: details.age_penalty, isAge: true }
    ];
    
    container.innerHTML = items.map(item => {
        if (item.isAge) {
            const ageStr = item.data.model_year && item.data.model_month ? 
                `${item.data.model_year}년 ${parseInt(item.data.model_month)}월 (${item.data.age_years}년)` : '-';
            return `
                <div class="contribution-item-detailed age-penalty-item">
                    <div class="contribution-item-header">
                        <h4>${item.label}</h4>
                        <div class="contribution-score-change age-penalty-score">${item.data.penalty}점</div>
                    </div>
                    <div class="age-penalty-content">
                        <div class="age-penalty-text">가중 평균에서 차감</div>
                        <div class="age-penalty-info">
                            <div>차량 연식: ${ageStr}</div>
                            <div>수집 시작: ${currentVehicleDetailData.basic_info.first_date ? 
                                new Date(currentVehicleDetailData.basic_info.first_date).toLocaleDateString('ko-KR') : '-'}</div>
                            <div>연식에 따른 감점 적용</div>
                        </div>
                    </div>
                </div>
            `;
        } else {
            const change = item.data.change || 0;
            const changeText = change > 0 ? `(+${change.toFixed(1)})` : change < 0 ? `(${change.toFixed(1)})` : `(${change.toFixed(1)})`;
            const changeColor = change > 0 ? '#4CAF50' : change < 0 ? '#f44336' : '#666';
            
            return `
                <div class="contribution-item-detailed">
                    <div class="contribution-item-header">
                        <h4>${item.label}</h4>
                        <div class="contribution-score-change" style="color: ${changeColor}">${item.data.score.toFixed(1)} ${changeText}</div>
                    </div>
                    <div class="contribution-chart-container">
                        <canvas id="temp-detail-${item.key}-chart" width="400" height="120"></canvas>
                    </div>
                    <div class="contribution-summary">
                        <span>${item.data.summary || '-'}</span>
                    </div>
                </div>
            `;
        }
    }).join('');
    
    // 차트 그리기
    items.forEach(item => {
        if (!item.isAge && item.data) {
            drawTimeSeriesChart(`temp-detail-${item.key}-chart`, item.data.score || 0, item.color);
        }
    });
}

// 온도 상세 분석 업데이트
function updateTemperatureDetailAnalysis(temperatureData, batteryScore, basicInfo) {
    if (!temperatureData) return;
    
    // 현재 온도 표시
    document.getElementById('temperature-optimal-criterion').textContent = `최적 30℃ → 100점, 온도가 30℃에서 멀어질수록 점수 감소 (최소 40점)`;
    document.getElementById('temperature-current-value').textContent = `현재 온도: ${temperatureData.value || 0}℃ → ${batteryScore.scores.temperature.toFixed(1)}점`;
    
    // 변환 차트 그리기
    drawTemperatureConversionChart(temperatureData.value || 0, batteryScore.scores.temperature);
    
    // 결과 테이블 업데이트
    document.getElementById('result-avg-temperature').textContent = `${temperatureData.value || 0}℃`;
    document.getElementById('result-temperature-score').textContent = `${batteryScore.scores.temperature.toFixed(1)}점`;
    document.getElementById('result-temperature-contribution').textContent = `${temperatureData.contribution.toFixed(1)}점`;
    
    // 설명 텍스트
    const explanation = `설명: 평균 온도 ${temperatureData.value || 0}℃에서 계산된 온도 점수는 ${batteryScore.scores.temperature.toFixed(1)}점으로, 전체 배터리 점수에 ${temperatureData.contribution.toFixed(1)}점을 기여합니다. 동종 차량 대비 온도 수준은 백분위 ${temperatureData.percentile}% 부근입니다.`;
    document.getElementById('result-temperature-explanation-text').textContent = explanation;
}

// 온도 시계열 차트 그리기
function drawTemperatureTimeSeriesChart(avgTemperature) {
    const canvas = document.getElementById('temperature-timeseries-chart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    ctx.clearRect(0, 0, width, height);
    
    // 실제 데이터가 없으면 차트를 그리지 않음
    // TODO: 실제 온도 시계열 데이터를 API에서 가져와서 사용해야 함
    ctx.fillStyle = '#999';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('온도 시계열 데이터를 사용할 수 없습니다', width / 2, height / 2);
    return;
    
    // Y축 범위
    const minY = 15;
    const maxY = 45;
    const range = maxY - minY;
    
    // 그리드
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
        const y = (height / 5) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
    }
    
    // 기준선 (20℃, 30℃, 40℃)
    const badLowY = height - ((20 - minY) / range) * height;
    const optimalY = height - ((30 - minY) / range) * height;
    const badHighY = height - ((40 - minY) / range) * height;
    
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = '#f44336';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, badLowY);
    ctx.lineTo(width, badLowY);
    ctx.stroke();
    
    ctx.strokeStyle = '#4CAF50';
    ctx.beginPath();
    ctx.moveTo(0, optimalY);
    ctx.lineTo(width, optimalY);
    ctx.stroke();
    
    ctx.strokeStyle = '#f44336';
    ctx.beginPath();
    ctx.moveTo(0, badHighY);
    ctx.lineTo(width, badHighY);
    ctx.stroke();
    
    ctx.setLineDash([]);
    
    // 평균선
    const avgY = height - ((avgTemperature - minY) / range) * height;
    ctx.strokeStyle = '#667eea';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, avgY);
    ctx.lineTo(width, avgY);
    ctx.stroke();
    
    // 데이터 라인
    ctx.strokeStyle = '#667eea';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < days; i++) {
        const x = (i / days) * width;
        const y = height - ((data[i] - minY) / range) * height;
        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    }
    ctx.stroke();
    
    // Y축 라벨
    ctx.fillStyle = '#666';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 5; i++) {
        const value = minY + (range * (5 - i) / 5);
        ctx.fillText(value.toFixed(0), width - 5, (height / 5) * i + 4);
    }
}

// 온도 점수 변환 차트
function drawTemperatureConversionChart(avgTemperature, score) {
    const canvas = document.getElementById('temperature-conversion-chart');
    if (!canvas) return;
    
    // canvas 크기를 충분히 크게 설정
    const container = canvas.parentElement;
    let displayWidth, displayHeight;
    
    if (container) {
        // 음수 방지: 최소 100px 보장
        displayWidth = Math.max(100, container.clientWidth - 30);
        displayHeight = 300;
    } else {
        displayWidth = 1200;
        displayHeight = 450;
    }
    
    // 실제 canvas 해상도를 충분히 크게 설정
    canvas.width = Math.max(displayWidth, 1200);
    canvas.height = Math.max(displayHeight, 450);
    
    // CSS로 표시 크기 설정 (음수 방지)
    canvas.style.width = Math.max(100, displayWidth) + 'px';
    canvas.style.height = displayHeight + 'px';
    
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    ctx.clearRect(0, 0, width, height);
    
    // X축 범위를 더 넓게 설정
    const xMin = 0;
    const xMax = 50;
    const xRange = xMax - xMin;
    
    // 변환 곡선 계산: Score = 100 - 2 × (T - 30), [40, 100] 범위로 클리핑
    const points = [];
    for (let x = xMin; x <= xMax; x += 0.1) {
        let y = 100 - 2 * (x - 30);
        y = Math.max(40, Math.min(100, y));
        points.push({ x, y });
    }
    
    // 그리드
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;
    const gridSteps = 10;
    for (let i = 0; i <= gridSteps; i++) {
        const x = 50 + ((i / gridSteps) * (width - 100));
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height - 30);
        ctx.stroke();
    }
    
    for (let i = 0; i <= 10; i++) {
        const y = (height - 30) - (i / 10) * (height - 30);
        ctx.beginPath();
        ctx.moveTo(50, y);
        ctx.lineTo(width - 50, y);
        ctx.stroke();
    }
    
    // 선 두께를 canvas 크기에 비례해서 조정
    const lineWidth = Math.max(2, Math.floor(width / 400));
    
    // 변환 곡선
    ctx.fillStyle = 'rgba(76, 175, 80, 0.2)';
    ctx.strokeStyle = '#667eea';
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    for (let i = 0; i < points.length; i++) {
        const x = 50 + ((points[i].x - xMin) / xRange) * (width - 100);
        const y = (height - 30) - (points[i].y / 100) * (height - 30);
        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    }
    ctx.lineTo(50 + ((xMax - xMin) / xRange) * (width - 100), height - 30);
    ctx.lineTo(50, height - 30);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    
    // 기준선 (20℃, 30℃)
    const temp20X = 50 + ((20 - xMin) / xRange) * (width - 100);
    const temp30X = 50 + ((30 - xMin) / xRange) * (width - 100);
    
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = '#f44336';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(temp20X, 0);
    ctx.lineTo(temp20X, height - 30);
    ctx.stroke();
    
    ctx.strokeStyle = '#4CAF50';
    ctx.beginPath();
    ctx.moveTo(temp30X, 0);
    ctx.lineTo(temp30X, height - 30);
    ctx.stroke();
    
    // 현재 온도 표시선
    const currentX = 50 + ((avgTemperature - xMin) / xRange) * (width - 100);
    ctx.strokeStyle = '#ff9800';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(currentX, 0);
    ctx.lineTo(currentX, height - 30);
    ctx.stroke();
    ctx.setLineDash([]);
    
    // 폰트 크기를 canvas 크기에 비례해서 조정
    const fontSize = Math.max(16, Math.floor(width / 75));
    
    // X축 라벨
    ctx.fillStyle = '#333';
    ctx.font = fontSize + 'px sans-serif';
    ctx.textAlign = 'center';
    for (let i = 0; i <= 10; i++) {
        const value = i * 5;
        ctx.fillText(value.toString(), 50 + ((value - xMin) / xRange) * (width - 100), height - 10);
    }
    
    // Y축 라벨
    ctx.textAlign = 'right';
    ctx.font = fontSize + 'px sans-serif';
    for (let i = 0; i <= 10; i++) {
        ctx.fillText((i * 10).toString(), 45, (height - 30) - (i / 10) * (height - 30) + 4);
    }
}

// 모달 외부 클릭 시 닫기 (차량 상세 모달)
window.onclick = function(event) {
    const scoreModal = document.getElementById('score-criteria-modal');
    const detailModal = document.getElementById('vehicle-detail-modal');
    const efficiencyModal = document.getElementById('efficiency-detail-modal');
    const temperatureModal = document.getElementById('temperature-detail-modal');
    const cellBalanceModal = document.getElementById('cell-balance-detail-modal');
    
    if (event.target === scoreModal) {
        closeScoreCriteria();
    }
    if (event.target === detailModal) {
        closeVehicleDetail();
    }
    if (event.target === efficiencyModal) {
        closeEfficiencyDetail();
    }
    if (event.target === temperatureModal) {
        closeTemperatureDetail();
    }
    if (event.target === cellBalanceModal) {
        closeCellBalanceDetail();
    }
}

// 셀 밸런스 상세 분석 모달 열기
function openCellBalanceDetail() {
    if (!currentVehicleDetailData) {
        alert('차량 정보를 먼저 로드해주세요.');
        return;
    }
    
    const modal = document.getElementById('cell-balance-detail-modal');
    if (!modal) return;
    
    const details = currentVehicleDetailData.contribution_details;
    const batteryScore = currentVehicleDetailData.battery_score;
    const basicInfo = currentVehicleDetailData.basic_info;
    const sectionCounts = currentVehicleDetailData.section_counts;
    
    // 주행 관련 데이터 가용성 확인
    const hasDrivingData = (sectionCounts.drive > 0 || sectionCounts.parking > 0);
    
    // 셀 밸런스 상세 분석 업데이트
    if (hasDrivingData) {
        updateCellBalanceDetailAnalysis(details.cell_imbalance, batteryScore, basicInfo);
        // 데이터 없음 메시지 숨김
        const noDataMsg = document.getElementById('cell-balance-no-data-message');
        if (noDataMsg) noDataMsg.style.display = 'none';
    } else {
        // 데이터 없음 메시지 표시
        showNoDataMessage('cell-balance-detail-modal', 'cell-balance-no-data-message', '주행');
    }
    
    // 모달 표시
    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
}

// 주행 상세 분석 모달 열기
function openDrivingDetail() {
    if (!currentVehicleDetailData) {
        alert('차량 정보를 먼저 로드해주세요.');
        return;
    }
    
    const sectionCounts = currentVehicleDetailData.section_counts;
    
    // 주행 관련 데이터 가용성 확인
    const hasDrivingData = (sectionCounts.drive > 0 || sectionCounts.parking > 0);
    
    if (!hasDrivingData) {
        alert('주행 구간 및 주차 구간 데이터가 없어 주행 관련 상세 분석을 제공할 수 없습니다.');
        return;
    }
    
    // TODO: 주행 상세 분석 모달 구현 필요
    alert('주행 상세 분석 기능은 아직 구현 중입니다.');
}

// 충전 상세 분석 모달 열기
function openChargingDetail() {
    if (!currentVehicleDetailData) {
        alert('차량 정보를 먼저 로드해주세요.');
        return;
    }
    
    const sectionCounts = currentVehicleDetailData.section_counts;
    
    // 충전 관련 데이터 가용성 확인
    const hasChargingData = (sectionCounts.fast_charge > 0 || sectionCounts.slow_charge > 0);
    
    if (!hasChargingData) {
        alert('급속 충전 및 완속 충전 데이터가 없어 충전 관련 상세 분석을 제공할 수 없습니다.');
        return;
    }
    
    // TODO: 충전 상세 분석 모달 구현 필요
    alert('충전 상세 분석 기능은 아직 구현 중입니다.');
}

// 데이터 없음 메시지 표시 함수
function showNoDataMessage(modalId, messageId, dataType) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    
    let messageEl = document.getElementById(messageId);
    if (!messageEl) {
        // 메시지 요소가 없으면 생성
        const rightPanel = modal.querySelector('.efficiency-detail-right');
        if (rightPanel) {
            messageEl = document.createElement('div');
            messageEl.id = messageId;
            messageEl.className = 'no-data-message';
            messageEl.style.display = 'block';
            rightPanel.insertBefore(messageEl, rightPanel.firstChild);
        }
    }
    
    if (messageEl) {
        const messageText = dataType === '주행' 
            ? '주행 구간 및 주차 구간 데이터가 없어 주행 관련 상세 분석을 제공할 수 없습니다.'
            : '급속 충전 및 완속 충전 데이터가 없어 충전 관련 상세 분석을 제공할 수 없습니다.';
        messageEl.textContent = messageText;
        messageEl.style.display = 'block';
    }
}

// 셀 밸런스 상세 분석 모달 닫기
function closeCellBalanceDetail() {
    const modal = document.getElementById('cell-balance-detail-modal');
    if (modal) {
        modal.classList.remove('show');
        document.body.style.overflow = '';
    }
}

// 셀 밸런스 기여도 상세 요약 리스트 업데이트
function updateCellBalanceDetailContributionList(details) {
    const container = document.getElementById('cell-balance-detail-contribution-list');
    if (!container) return;
    
    const items = [
        { key: 'efficiency', label: '효율(점수 추이)', data: details.efficiency, color: '#667eea' },
        { key: 'temperature', label: '온도(점수 추이)', data: details.temperature, color: '#667eea' },
        { key: 'cell_imbalance', label: '셀밸런스(점수 추이)', data: details.cell_imbalance, color: '#667eea' },
        { key: 'driving_habit', label: '주행(활동 추이)', data: details.driving_habit, color: '#9c27b0' },
        { key: 'charging_pattern', label: '충전(활동 추이)', data: details.charging_pattern, color: '#f44336' },
        { key: 'age_penalty', label: '연식 패널티', data: details.age_penalty, isAge: true }
    ];
    
    container.innerHTML = items.map(item => {
        if (item.isAge) {
            const ageStr = item.data.model_year && item.data.model_month ? 
                `${item.data.model_year}년 ${parseInt(item.data.model_month)}월 (${item.data.age_years}년)` : '-';
            return `
                <div class="contribution-item-detailed age-penalty-item">
                    <div class="contribution-item-header">
                        <h4>${item.label}</h4>
                        <div class="contribution-score-change age-penalty-score">${item.data.penalty}점</div>
                    </div>
                    <div class="age-penalty-content">
                        <div class="age-penalty-text">가중 평균에서 차감</div>
                        <div class="age-penalty-info">
                            <div>차량 연식: ${ageStr}</div>
                            <div>수집 시작: ${currentVehicleDetailData.basic_info.first_date ? 
                                new Date(currentVehicleDetailData.basic_info.first_date).toLocaleDateString('ko-KR') : '-'}</div>
                            <div>연식에 따른 감점 적용</div>
                        </div>
                    </div>
                </div>
            `;
        } else {
            const change = item.data.change || 0;
            const changeText = change > 0 ? `(+${change.toFixed(1)})` : change < 0 ? `(${change.toFixed(1)})` : `(${change.toFixed(1)})`;
            const changeColor = change > 0 ? '#4CAF50' : change < 0 ? '#f44336' : '#666';
            
            return `
                <div class="contribution-item-detailed">
                    <div class="contribution-item-header">
                        <h4>${item.label}</h4>
                        <div class="contribution-score-change" style="color: ${changeColor}">${item.data.score.toFixed(1)} ${changeText}</div>
                    </div>
                    <div class="contribution-chart-container">
                        <canvas id="cell-detail-${item.key}-chart" width="400" height="120"></canvas>
                    </div>
                    <div class="contribution-summary">
                        <span>${item.data.summary || '-'}</span>
                    </div>
                </div>
            `;
        }
    }).join('');
    
    // 차트 그리기
    items.forEach(item => {
        if (!item.isAge && item.data) {
            drawTimeSeriesChart(`cell-detail-${item.key}-chart`, item.data.score || 0, item.color);
        }
    });
}

// 셀 밸런스 상세 분석 업데이트
function updateCellBalanceDetailAnalysis(cellData, batteryScore, basicInfo) {
    if (!cellData) return;
    
    // 결과 테이블 업데이트
    const avgDeviation = cellData.value ? (cellData.value * 1000).toFixed(1) : '0.0'; // V를 mV로 변환
    document.getElementById('result-avg-cell-deviation').textContent = `${avgDeviation} mV`;
    document.getElementById('result-cell-score').textContent = `${batteryScore.scores.cell_imbalance.toFixed(1)}점`;
    document.getElementById('result-cell-contribution').textContent = `${cellData.contribution.toFixed(1)}점`;
    
    // 설명 텍스트
    const explanation = `설명: 평균 셀 편차 ${avgDeviation}mV로, 편차가 작을수록 점수가 높아지는 구조에서 ${batteryScore.scores.cell_imbalance.toFixed(1)}점을 받았습니다. 이 점수는 전체 배터리 점수에 ${cellData.contribution.toFixed(1)}점을 기여하며, 동종 차량 대비 셀 밸런스 수준은 백분위 ${cellData.percentile}% 부근입니다.`;
    document.getElementById('result-cell-explanation-text').textContent = explanation;
}

// 전압 요약 차트 그리기 (4개)
function drawVoltageSummaryCharts() {
    const charts = [
        { id: 'cell-min-voltage-chart', color: '#f44336', label: '최소' },
        { id: 'cell-max-voltage-chart', color: '#2196F3', label: '최대' },
        { id: 'cell-mid-voltage-chart', color: '#2196F3', label: '중간' },
        { id: 'cell-avg-voltage-chart', color: '#FF9800', label: '평균' }
    ];
    
    charts.forEach(chart => {
        const canvas = document.getElementById(chart.id);
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        
        ctx.clearRect(0, 0, width, height);
        
        // 실제 데이터가 없으면 차트를 그리지 않음
        // TODO: 실제 전압 시계열 데이터를 API에서 가져와서 사용해야 함
        ctx.fillStyle = '#999';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('전압 데이터를 사용할 수 없습니다', width / 2, height / 2);
        return;
        
        // 평균값 계산
        const avgValue = data.reduce((a, b) => a + b, 0) / data.length;
        
        // Y축 범위
        const minY = 3.6;
        const maxY = 4.27;
        const range = maxY - minY;
        
        // 그리드
        ctx.strokeStyle = '#f0f0f0';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 3; i++) {
            const y = (height / 3) * i;
            ctx.beginPath();
            ctx.moveTo(25, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }
        
        // 라인 그리기
        ctx.strokeStyle = chart.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < points; i++) {
            const x = 25 + (i / points) * (width - 25);
            const y = height - ((data[i] - minY) / range) * height;
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.stroke();
        
        // Y축 라벨
        ctx.fillStyle = '#666';
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'right';
        for (let i = 0; i <= 3; i++) {
            const value = minY + (range * (3 - i) / 3);
            const y = (height / 3) * i;
            ctx.fillText(value.toFixed(2), 22, y + 3);
        }
        
        // 평균값 표시
        ctx.fillStyle = chart.color;
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${avgValue.toFixed(2)}V`, width / 2, 12);
    });
}

// 셀 전압 라인 차트 그리기
function drawCellVoltageLineChart() {
    const canvas = document.getElementById('cell-voltage-line-chart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    ctx.clearRect(0, 0, width, height);
    
    // 실제 데이터가 없으면 차트를 그리지 않음
    // TODO: 실제 셀 전압 라인 데이터를 API에서 가져와서 사용해야 함
    ctx.fillStyle = '#999';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('셀 전압 데이터를 사용할 수 없습니다', width / 2, height / 2);
    return;
    
    // 평균값 계산
    const avgValue = data.reduce((a, b) => a + b, 0) / data.length;
    const minValue = Math.min(...data);
    const maxValue = Math.max(...data);
    
    // Y축 범위
    const minY = 3.6;
    const maxY = 4.27;
    const range = maxY - minY;
    
    // 그리드
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
        const y = (height / 5) * i;
        ctx.beginPath();
        ctx.moveTo(50, y);
        ctx.lineTo(width - 50, y);
        ctx.stroke();
    }
    
    // 평균선
    const avgY = height - ((avgValue - minY) / range) * height;
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = '#999';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(50, avgY);
    ctx.lineTo(width - 50, avgY);
    ctx.stroke();
    ctx.setLineDash([]);
    
    // 라인 그리기
    ctx.strokeStyle = '#4CAF50';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < points; i++) {
        const x = 50 + (i / points) * (width - 100);
        const y = height - ((data[i] - minY) / range) * height;
        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    }
    ctx.stroke();
    
    // Y축 라벨
    ctx.fillStyle = '#666';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 5; i++) {
        const value = minY + (range * (5 - i) / 5);
        ctx.fillText(value.toFixed(2), 45, (height / 5) * i + 4);
    }
    
    // Y축 제목
    ctx.save();
    ctx.translate(15, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = '#333';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('전압(V)', 0, 0);
    ctx.restore();
    
    // 통계 정보 표시
    ctx.fillStyle = '#333';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`평균: ${avgValue.toFixed(2)}V`, width - 150, 15);
    ctx.fillText(`최소: ${minValue.toFixed(2)}V`, width - 150, 30);
    ctx.fillText(`최대: ${maxValue.toFixed(2)}V`, width - 150, 45);
}

// 셀 평균 전압 편차 차트 그리기
function drawCellAvgDeviationChart() {
    const canvas = document.getElementById('cell-avg-deviation-chart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    ctx.clearRect(0, 0, width, height);
    
    // 실제 데이터가 없으면 차트를 그리지 않음
    // TODO: 실제 셀 편차 데이터를 API에서 가져와서 사용해야 함
    ctx.fillStyle = '#999';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('셀 편차 데이터를 사용할 수 없습니다', width / 2, height / 2);
    return;
    
    // 평균 편차 계산
    const avgDeviation = deviations.reduce((a, b) => a + Math.abs(b), 0) / cells;
    
    // Y축 범위
    const minY = -6;
    const maxY = 2;
    const range = maxY - minY;
    const zeroY = height - 30 - ((0 - minY) / range) * (height - 60);
    
    // 그리드
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const y = 20 + ((height - 60) / 4) * i;
        ctx.beginPath();
        ctx.moveTo(50, y);
        ctx.lineTo(width - 50, y);
        ctx.stroke();
    }
    
    // 제로 라인
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(50, zeroY);
    ctx.lineTo(width - 50, zeroY);
    ctx.stroke();
    
    // 바 차트 그리기
    const barWidth = (width - 100) / cells;
    for (let i = 0; i < cells; i++) {
        const x = 50 + i * barWidth;
        const barHeight = Math.abs((deviations[i] / range) * (height - 60));
        const y = deviations[i] < 0 ? zeroY : zeroY - barHeight;
        
        ctx.fillStyle = deviations[i] < 0 ? '#f44336' : '#4CAF50';
        ctx.fillRect(x, y, barWidth - 1, barHeight);
    }
    
    // Y축 라벨
    ctx.fillStyle = '#666';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
        const value = minY + (range * i / 4);
        const y = 20 + ((height - 60) / 4) * (4 - i);
        ctx.fillText(value.toFixed(0), 45, y + 4);
    }
    
    // Y축 제목
    ctx.save();
    ctx.translate(15, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = '#333';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('편차(mV)', 0, 0);
    ctx.restore();
    
    // X축 라벨 (셀 번호 - 일부만 표시)
    ctx.fillStyle = '#666';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    const labelStep = Math.floor(cells / 10);
    for (let i = 0; i < cells; i += labelStep) {
        const x = 50 + (i / cells) * (width - 100) + barWidth / 2;
        ctx.fillText((i + 1).toString(), x, height - 10);
    }
    
    // X축 제목
    ctx.fillStyle = '#333';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('셀 번호', width / 2, height - 5);
    
    // 통계 정보
    ctx.fillStyle = '#333';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`평균 편차: ${avgDeviation.toFixed(2)}mV`, width - 150, 15);
}

// 셀 전압 표준편차 차트 그리기
function drawCellStdDeviationChart() {
    const canvas = document.getElementById('cell-std-deviation-chart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    ctx.clearRect(0, 0, width, height);
    
    // 실제 데이터가 없으면 차트를 그리지 않음
    // TODO: 실제 셀 표준편차 데이터를 API에서 가져와서 사용해야 함
    ctx.fillStyle = '#999';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('셀 표준편차 데이터를 사용할 수 없습니다', width / 2, height / 2);
    return;
    
    // 그리드
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
        const y = 20 + ((height - 50) / 5) * i;
        ctx.beginPath();
        ctx.moveTo(40, y);
        ctx.lineTo(width - 40, y);
        ctx.stroke();
    }
    
    // 바 차트 그리기
    for (let i = 0; i < cells; i++) {
        const x = 40 + i * barWidth;
        const barHeight = (stdDeviations[i] / maxY) * (height - 50);
        const y = height - 30 - barHeight;
        
        ctx.fillStyle = '#667eea';
        ctx.fillRect(x, y, barWidth - 1, barHeight);
    }
    
    // Y축 라벨
    ctx.fillStyle = '#666';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 5; i++) {
        const value = (maxY * i / 5).toFixed(0);
        const y = height - 30 - ((height - 50) * i / 5);
        ctx.fillText(value, 35, y + 4);
    }
    
    // Y축 제목
    ctx.save();
    ctx.translate(12, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = '#333';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('표준편차(mV)', 0, 0);
    ctx.restore();
    
    // X축 라벨 (셀 번호 - 일부만)
    ctx.fillStyle = '#666';
    ctx.font = '8px sans-serif';
    ctx.textAlign = 'center';
    const labelStep = Math.floor(cells / 8);
    for (let i = 0; i < cells; i += labelStep) {
        const x = 40 + (i / cells) * (width - 80) + barWidth / 2;
        ctx.fillText((i + 1).toString(), x, height - 15);
    }
    
    // 통계 정보
    ctx.fillStyle = '#333';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`평균: ${avgStdDev.toFixed(2)}mV`, width - 100, 15);
}

// 셀 전압 범위 차트 그리기
function drawCellRangeChart() {
    const canvas = document.getElementById('cell-range-chart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    ctx.clearRect(0, 0, width, height);
    
    // 실제 데이터가 없으면 차트를 그리지 않음
    // TODO: 실제 셀 범위 데이터를 API에서 가져와서 사용해야 함
    ctx.fillStyle = '#999';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('셀 범위 데이터를 사용할 수 없습니다', width / 2, height / 2);
    return;
    
    // 그리드
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const y = 20 + ((height - 50) / 4) * i;
        ctx.beginPath();
        ctx.moveTo(40, y);
        ctx.lineTo(width - 40, y);
        ctx.stroke();
    }
    
    // 평균선
    const avgY = height - 30 - ((avgRange / maxY) * (height - 50));
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(40, avgY);
    ctx.lineTo(width - 40, avgY);
    ctx.stroke();
    ctx.setLineDash([]);
    
    // 평균 라벨
    ctx.fillStyle = '#333';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`평균 ${avgRange.toFixed(1)} mV`, width - 100, avgY - 5);
    
    // 바 차트 그리기
    for (let i = 0; i < cells; i++) {
        const x = 40 + i * barWidth;
        const barHeight = (ranges[i] / maxY) * (height - 50);
        const y = height - 30 - barHeight;
        
        ctx.fillStyle = '#667eea';
        ctx.fillRect(x, y, barWidth - 1, barHeight);
    }
    
    // Y축 라벨
    ctx.fillStyle = '#666';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
        const value = (maxY * i / 4).toFixed(0);
        const y = height - 30 - ((height - 50) * i / 4);
        ctx.fillText(value, 35, y + 4);
    }
    
    // Y축 제목
    ctx.save();
    ctx.translate(12, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = '#333';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('범위(mV)', 0, 0);
    ctx.restore();
    
    // X축 라벨 (셀 번호 - 일부만)
    ctx.fillStyle = '#666';
    ctx.font = '8px sans-serif';
    ctx.textAlign = 'center';
    const labelStep = Math.floor(cells / 8);
    for (let i = 0; i < cells; i += labelStep) {
        const x = 40 + (i / cells) * (width - 80) + barWidth / 2;
        ctx.fillText((i + 1).toString(), x, height - 15);
    }
}

// 효율 상세 분석 모달 열기
let currentVehicleDetailData = null;

function openEfficiencyDetail() {
    // 현재 차량 상세 모달에서 데이터 가져오기
    if (!currentVehicleDetailData) {
        alert('차량 정보를 먼저 로드해주세요.');
        return;
    }
    
    const modal = document.getElementById('efficiency-detail-modal');
    if (!modal) return;
    
    const details = currentVehicleDetailData.contribution_details;
    const batteryScore = currentVehicleDetailData.battery_score;
    const basicInfo = currentVehicleDetailData.basic_info;
    const sectionCounts = currentVehicleDetailData.section_counts;
    
    // 주행 관련 데이터 가용성 확인
    const hasDrivingData = (sectionCounts.drive > 0 || sectionCounts.parking > 0);
    
    // 효율 상세 분석 업데이트
    if (hasDrivingData) {
        updateEfficiencyDetailAnalysis(details.efficiency, batteryScore, basicInfo);
        // 데이터 없음 메시지 숨김
        const noDataMsg = document.getElementById('efficiency-no-data-message');
        if (noDataMsg) noDataMsg.style.display = 'none';
    } else {
        // 데이터 없음 메시지 표시
        showNoDataMessage('efficiency-detail-modal', 'efficiency-no-data-message', '주행');
        // 차트는 그리지 않음
    }
    
    // 모달 표시
    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
}

// 효율 상세 분석 모달 닫기
function closeEfficiencyDetail() {
    const modal = document.getElementById('efficiency-detail-modal');
    if (modal) {
        modal.classList.remove('show');
        document.body.style.overflow = '';
    }
}

// 기여도 상세 요약 리스트 업데이트
function updateEfficiencyDetailContributionList(details) {
    const container = document.getElementById('efficiency-detail-contribution-list');
    if (!container) return;
    
    const items = [
        { key: 'efficiency', label: '효율(점수 추이)', data: details.efficiency, color: '#667eea' },
        { key: 'temperature', label: '온도(점수 추이)', data: details.temperature, color: '#667eea' },
        { key: 'cell_imbalance', label: '셀밸런스(점수 추이)', data: details.cell_imbalance, color: '#667eea' },
        { key: 'driving_habit', label: '주행(활동 추이)', data: details.driving_habit, color: '#9c27b0' },
        { key: 'charging_pattern', label: '충전(활동 추이)', data: details.charging_pattern, color: '#f44336' },
        { key: 'age_penalty', label: '연식 패널티', data: details.age_penalty, isAge: true }
    ];
    
    container.innerHTML = items.map(item => {
        if (item.isAge) {
            const ageStr = item.data.model_year && item.data.model_month ? 
                `${item.data.model_year}년 ${parseInt(item.data.model_month)}월 (${item.data.age_years}년)` : '-';
            return `
                <div class="contribution-item-detailed age-penalty-item">
                    <div class="contribution-item-header">
                        <h4>${item.label}</h4>
                        <div class="contribution-score-change age-penalty-score">${item.data.penalty}점</div>
                    </div>
                    <div class="age-penalty-content">
                        <div class="age-penalty-text">가중 평균에서 차감</div>
                        <div class="age-penalty-info">
                            <div>차량 연식: ${ageStr}</div>
                            <div>수집 시작: ${currentVehicleDetailData.basic_info.first_date ? 
                                new Date(currentVehicleDetailData.basic_info.first_date).toLocaleDateString('ko-KR') : '-'}</div>
                            <div>연식에 따른 감점 적용</div>
                        </div>
                    </div>
                </div>
            `;
        } else {
            const change = item.data.change || 0;
            const changeText = change > 0 ? `(+${change.toFixed(1)})` : change < 0 ? `(${change.toFixed(1)})` : `(${change.toFixed(1)})`;
            const changeColor = change > 0 ? '#4CAF50' : change < 0 ? '#f44336' : '#666';
            
            return `
                <div class="contribution-item-detailed">
                    <div class="contribution-item-header">
                        <h4>${item.label}</h4>
                        <div class="contribution-score-change" style="color: ${changeColor}">${item.data.score.toFixed(1)} ${changeText}</div>
                    </div>
                    <div class="contribution-chart-container">
                        <canvas id="eff-detail-${item.key}-chart" width="400" height="120"></canvas>
                    </div>
                    <div class="contribution-summary">
                        <span>${item.data.summary || '-'}</span>
                    </div>
                </div>
            `;
        }
    }).join('');
    
    // 차트 그리기
    items.forEach(item => {
        if (!item.isAge && item.data) {
            drawTimeSeriesChart(`eff-detail-${item.key}-chart`, item.data.score || 0, item.color);
        }
    });
}

// 효율 상세 분석 업데이트
function updateEfficiencyDetailAnalysis(efficiencyData, batteryScore, basicInfo) {
    if (!efficiencyData) return;
    
    // 기준값 계산 (차종/연식별)
    const carType = basicInfo.car_type || '중형';
    const ageYears = parseFloat(basicInfo.age_string?.match(/(\d+\.\d+)년/)?.[1]) || 0;
    
    // 차종별 기준값
    const baseRanges = {
        "상용차": { min: 2.5, max: 6.5 },
        "소형": { min: 4.0, max: 8.5 },
        "중형": { min: 3.5, max: 7.5 },
        "대형": { min: 3.0, max: 7.0 },
        "프리미엄": { min: 3.8, max: 8.0 }
    };
    
    let minVal = baseRanges[carType]?.min || 3.5;
    let maxVal = baseRanges[carType]?.max || 7.5;
    
    // 연식 조정
    const ageAdjustment = Math.min(ageYears * 0.143, 0.8);
    minVal = minVal - ageAdjustment;
    maxVal = Math.max(0.0, maxVal - ageAdjustment);
    
    // 변환 기준 표시
    document.getElementById('efficiency-bad-criterion').textContent = `${minVal.toFixed(1)} km/kWh 이하 → 40점 (나쁨)`;
    document.getElementById('efficiency-good-criterion').textContent = `${maxVal.toFixed(1)} km/kWh 이상 → 100점 (좋음)`;
    
    // 변환 차트 그리기
    drawEfficiencyConversionChart(efficiencyData.value || 0, minVal, maxVal, batteryScore.scores.efficiency);
    
    // 결과 테이블 업데이트
    document.getElementById('result-avg-efficiency').textContent = `${efficiencyData.value || 0} km/kWh`;
    document.getElementById('result-efficiency-score').textContent = `${batteryScore.scores.efficiency.toFixed(1)}점`;
    document.getElementById('result-contribution').textContent = `${efficiencyData.contribution.toFixed(1)}점`;
    
    // 설명 텍스트
    const explanation = `설명: 평균 전비 ${efficiencyData.value || 0} km/kWh는 기준값 ${minVal.toFixed(1)}~${maxVal.toFixed(1)} km/kWh 사이에 위치하여 ${batteryScore.scores.efficiency.toFixed(1)}점을 받았습니다. 이 점수는 전체 배터리 점수에 ${efficiencyData.contribution.toFixed(1)}점을 기여하며, 동종 차량 대비 효율 수준은 백분위 ${efficiencyData.percentile}% 부근입니다.`;
    document.getElementById('result-explanation-text').textContent = explanation;
}

// 효율 시계열 차트 그리기
function drawEfficiencyTimeSeriesChart(avgEfficiency, minVal, maxVal) {
    const canvas = document.getElementById('efficiency-timeseries-chart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    ctx.clearRect(0, 0, width, height);
    
    // 실제 데이터가 없으면 차트를 그리지 않음
    // TODO: 실제 효율 시계열 데이터를 API에서 가져와서 사용해야 함
    ctx.fillStyle = '#999';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('효율 시계열 데이터를 사용할 수 없습니다', width / 2, height / 2);
    return;
    
    // Y축 범위
    const minY = Math.min(...data) - 1;
    const maxY = Math.max(...data) + 1;
    const range = maxY - minY;
    
    // 그리드
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
        const y = (height / 5) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
    }
    
    // 기준선 (나쁨, 좋음)
    const badY = height - ((minVal - minY) / range) * height;
    const goodY = height - ((maxVal - minY) / range) * height;
    
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = '#f44336';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, badY);
    ctx.lineTo(width, badY);
    ctx.stroke();
    
    ctx.strokeStyle = '#4CAF50';
    ctx.beginPath();
    ctx.moveTo(0, goodY);
    ctx.lineTo(width, goodY);
    ctx.stroke();
    
    ctx.setLineDash([]);
    
    // 평균선
    const avgY = height - ((avgEfficiency - minY) / range) * height;
    ctx.strokeStyle = '#667eea';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, avgY);
    ctx.lineTo(width, avgY);
    ctx.stroke();
    
    // 데이터 라인
    ctx.strokeStyle = '#667eea';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < days; i++) {
        const x = (i / days) * width;
        const y = height - ((data[i] - minY) / range) * height;
        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    }
    ctx.stroke();
    
    // Y축 라벨
    ctx.fillStyle = '#666';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 5; i++) {
        const value = minY + (range * (5 - i) / 5);
        ctx.fillText(value.toFixed(1), width - 5, (height / 5) * i + 4);
    }
}

// 주행거리 & 전력량 바 차트
function drawEfficiencyBarChart() {
    const canvas = document.getElementById('efficiency-bar-chart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    ctx.clearRect(0, 0, width, height);
    
    // 실제 데이터가 없으면 차트를 그리지 않음
    // TODO: 실제 주행거리 및 전력량 데이터를 API에서 가져와서 사용해야 함
    ctx.fillStyle = '#999';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('주행거리 및 전력량 데이터를 사용할 수 없습니다', width / 2, height / 2);
    return;
    
    const maxDistance = Math.max(...distances);
    const maxPower = Math.max(...powers);
    
    const barWidth = (width - 100) / days;
    
    // 바 그리기
    for (let i = 0; i < days; i++) {
        const x = 50 + i * barWidth;
        const distHeight = (distances[i] / maxDistance) * (height - 60);
        const powerHeight = (powers[i] / maxPower) * (height - 60);
        
        // 주행거리 (녹색)
        ctx.fillStyle = '#4CAF50';
        ctx.fillRect(x, height - 30 - distHeight, barWidth - 2, distHeight);
        
        // 전력량 (노란색)
        ctx.fillStyle = '#FFC107';
        ctx.fillRect(x, height - 30 - powerHeight, barWidth - 2, powerHeight);
    }
    
    // Y축 라벨 (왼쪽: 주행거리)
    ctx.fillStyle = '#666';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 5; i++) {
        const value = (maxDistance * i / 5).toFixed(0);
        ctx.fillText(value, 45, height - 30 - (height - 60) * i / 5);
    }
}

// 효율 점수 변환 차트
function drawEfficiencyConversionChart(avgEfficiency, minVal, maxVal, score) {
    const canvas = document.getElementById('efficiency-conversion-chart');
    if (!canvas) return;
    
    // canvas 크기를 충분히 크게 설정
    const container = canvas.parentElement;
    let displayWidth, displayHeight;
    
    if (container) {
        // 음수 방지: 최소 100px 보장
        displayWidth = Math.max(100, container.clientWidth - 30);
        displayHeight = 300;
    } else {
        displayWidth = 1200;
        displayHeight = 450;
    }
    
    // 실제 canvas 해상도를 충분히 크게 설정
    canvas.width = Math.max(displayWidth, 1200);
    canvas.height = Math.max(displayHeight, 450);
    
    // CSS로 표시 크기 설정 (음수 방지)
    canvas.style.width = Math.max(100, displayWidth) + 'px';
    canvas.style.height = displayHeight + 'px';
    
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    ctx.clearRect(0, 0, width, height);
    
    // X축 범위를 동적으로 설정 (최소값과 최대값, 현재값을 고려)
    const xMin = Math.max(0, Math.floor(minVal) - 1);
    const xMax = Math.max(12, Math.ceil(Math.max(maxVal, avgEfficiency)) + 1);
    const xRange = xMax - xMin;
    
    // 변환 곡선 그리기
    const points = [];
    for (let x = xMin; x <= xMax; x += 0.1) {
        let y;
        if (x <= minVal) {
            y = 40;
        } else if (x >= maxVal) {
            y = 100;
        } else {
            const ratio = (x - minVal) / (maxVal - minVal);
            y = 40 + (ratio * 60);
        }
        points.push({ x, y });
    }
    
    // 그리드
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;
    const gridSteps = Math.ceil(xRange);
    for (let i = 0; i <= gridSteps; i++) {
        const x = 50 + ((i / gridSteps) * (width - 100));
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height - 30);
        ctx.stroke();
    }
    
    for (let i = 0; i <= 10; i++) {
        const y = (height - 30) - (i / 10) * (height - 30);
        ctx.beginPath();
        ctx.moveTo(50, y);
        ctx.lineTo(width - 50, y);
        ctx.stroke();
    }
    
    // 선 두께를 canvas 크기에 비례해서 조정
    const lineWidth = Math.max(2, Math.floor(width / 400));
    
    // 변환 곡선
    ctx.strokeStyle = '#667eea';
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    for (let i = 0; i < points.length; i++) {
        const x = 50 + ((points[i].x - xMin) / xRange) * (width - 100);
        const y = (height - 30) - (points[i].y / 100) * (height - 30);
        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    }
    ctx.stroke();
    
    // 기준선 표시 (minVal, maxVal)
    const minX = 50 + ((minVal - xMin) / xRange) * (width - 100);
    const maxX = 50 + ((maxVal - xMin) / xRange) * (width - 100);
    
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = '#f44336';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(minX, 0);
    ctx.lineTo(minX, height - 30);
    ctx.stroke();
    
    ctx.strokeStyle = '#4CAF50';
    ctx.beginPath();
    ctx.moveTo(maxX, 0);
    ctx.lineTo(maxX, height - 30);
    ctx.stroke();
    
    // 현재 값 표시선
    const currentX = 50 + ((avgEfficiency - xMin) / xRange) * (width - 100);
    ctx.strokeStyle = '#ff9800';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(currentX, 0);
    ctx.lineTo(currentX, height - 30);
    ctx.stroke();
    ctx.setLineDash([]);
    
    // 폰트 크기를 canvas 크기에 비례해서 조정
    const fontSize = Math.max(16, Math.floor(width / 75));
    
    // X축 라벨
    ctx.fillStyle = '#333';
    ctx.font = fontSize + 'px sans-serif';
    ctx.textAlign = 'center';
    const labelStep = Math.max(1, Math.ceil(xRange / 12));
    for (let i = 0; i <= xMax; i += labelStep) {
        if (i >= xMin) {
            const x = 50 + ((i - xMin) / xRange) * (width - 100);
            ctx.fillText(i.toFixed(1), x, height - 10);
        }
    }
    
    // Y축 라벨
    ctx.textAlign = 'right';
    ctx.font = fontSize + 'px sans-serif';
    for (let i = 0; i <= 10; i++) {
        ctx.fillText((i * 10).toString(), 45, (height - 30) - (i / 10) * (height - 30) + 4);
    }
}


// HTML 이스케이프
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

