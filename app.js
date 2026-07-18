let datasets = {
    "성취도평가": [],
    "LMS 학습로그": [],
    "형성평가": [],
    "AI도구 활용로그": [],
    "정의적 영역 설문": [],
    "포트폴리오": [],
    "교사 관찰기록": [],
    "협업활동": []
};

let charts = [];
let zoomChart = null;
let currentSchool = '초등';
let SNU_SUBJECTS = JSON.parse(localStorage.getItem('edu_subjects')) || ['국어', '수학', '과학', '사회', '영어', '실과', '음악', '미술'];
let currentSubject = SNU_SUBJECTS.length > 0 ? SNU_SUBJECTS[0] : '국어';
let currentDatasetKey = '성취도평가';
let isEditSubjectMode = false;

const API_KEY_KEY = 'gemini_api_key';
let API_KEY = localStorage.getItem(API_KEY_KEY) || '';

let alertRulesMap = {};
try {
    const savedRules = localStorage.getItem('edu_alert_rules_map_v3');
    if(savedRules) alertRulesMap = JSON.parse(savedRules);
} catch(e) {}
function getAlertRules() {
    const k = currentSchool + '_' + currentSubject;
    // 하드코딩 기본값 없이, 빈 배열과 미등록은 전달리켰다
    if(!alertRulesMap[k]) {
        alertRulesMap[k] = [];
    }
    return alertRulesMap[k];
}
function saveAlertRules() {
    localStorage.setItem('edu_alert_rules_map_v3', JSON.stringify(alertRulesMap));
}

// 차트 색상 팔레트
const SNU_COLORS = {
    navy: '#1e3a8a', blue: '#3b82f6', lightblue: '#93c5fd', 
    gray: '#6b7280', lightgray: '#d1d5db', yellow: '#f59e0b', green: '#10b981', orange: '#ea580c'
};
const STACK_COLORS = [SNU_COLORS.navy, SNU_COLORS.blue, SNU_COLORS.lightblue, SNU_COLORS.gray, SNU_COLORS.lightgray, SNU_COLORS.yellow, SNU_COLORS.orange, SNU_COLORS.green];

document.addEventListener('DOMContentLoaded', () => {
    // API Key init
    const apiInput = document.getElementById('api-key-input');
    if(apiInput && API_KEY) apiInput.value = API_KEY;

    document.getElementById('save-api-key')?.addEventListener('click', async () => {
        const newKey = apiInput.value.trim();
        if (!newKey) {
            alert('API 키를 입력해주세요.');
            return;
        }
        API_KEY = newKey;
        localStorage.setItem(API_KEY_KEY, API_KEY);
        // 실제 API 검증
        await verifyApiKey();
    });

    const toggleApiVis = document.getElementById('toggle-api-vis');
    if (toggleApiVis && apiInput) {
        toggleApiVis.addEventListener('click', () => {
            const type = apiInput.getAttribute('type') === 'password' ? 'text' : 'password';
            apiInput.setAttribute('type', type);
        });
    }

    // View Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.view-section').forEach(v => v.style.display = 'none');
            
            e.target.classList.add('active');
            document.getElementById(e.target.dataset.target).style.display = 'block';
            if(e.target.dataset.target === 'view-dashboard') updateChartsFromData();
        });
    });

    // Dataset Tabs
    document.querySelectorAll('.dataset-tab').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.dataset-tab').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentDatasetKey = e.target.dataset.ds;
            document.getElementById('current-dataset-title').innerText = currentDatasetKey + ' 데이터셋';
            renderTable();
        });
    });

    // Filter Pills
    document.querySelectorAll('#filter-school .pill').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('#filter-school .pill').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentSchool = e.target.dataset.val;
            updateView();
            if (window.refreshAlertDsSelect) window.refreshAlertDsSelect();
        });
    });
    
    renderSubjects(); // 과목 필터 초기 렌더링

    // File Upload display
    document.getElementById('csv-upload')?.addEventListener('change', (e) => {
        const files = e.target.files;
        document.getElementById('file-name').innerText = files.length > 0 ? `${files.length}개 파일 선택됨` : '';
    });

    // Load CSVs - 중복 등록 방지
    const loadBtn = document.getElementById('load-csv-btn');
    if (loadBtn && !loadBtn._listenerAdded) {
        loadBtn.addEventListener('click', loadLocalCSV);
        loadBtn._listenerAdded = true;
    }

    // AI Generate
    document.getElementById('generate-btn')?.addEventListener('click', processDataAI);

    setupZoomModal();
    initAlertSettings();
    loadHistory();
    // API 키 상태 초기화 (localStorage에 키가 있으면 검증, 없으면 회색)
    if (API_KEY) {
        verifyApiKey(); // 페이지 로드 시 적장된 키 검증
    } else {
        setApiStatus('no-key');
    }
    updateView();
});

function getFilteredData(key) {
    const allData = datasets[key] || [];
    return allData.filter(d => d._school === currentSchool && d._subject === currentSubject);
}

let csvMappingQueue = [];
let currentMappingCsv = null;

async function loadLocalCSV() {
    const fileInput = document.getElementById('csv-upload');
    if (!fileInput || fileInput.files.length === 0) {
        alert('적재할 파일을 선택해주세요.');
        return;
    }
    const files = Array.from(fileInput.files);
    const spinner = document.getElementById('loading-spinner');

    if (spinner) {
        spinner.textContent = '데이터 읽는 중...';
        spinner.style.display = 'block';
    }

    const results = [];
    for (const file of files) {
        const ext = file.name.split('.').pop().toLowerCase();
        let parsed = null;
        
        if (ext === 'csv') {
            parsed = await new Promise((resolve) => {
                Papa.parse(file, {
                    header: true,
                    skipEmptyLines: true,
                    encoding: 'EUC-KR',
                    complete: (r) => {
                        // EUC-KR 실패시 UTF-8로 재시도
                        if (!r.data || r.data.length === 0 || (r.errors && r.errors.length > 0 && r.data.length < 2)) {
                            Papa.parse(file, {
                                header: true,
                                skipEmptyLines: true,
                                complete: (r2) => {
                                    resolve({ filename: file.name, data: r2.data || [] });
                                },
                                error: (e2) => resolve({ filename: file.name, data: [] })
                            });
                        } else {
                            resolve({ filename: file.name, data: r.data });
                        }
                    },
                    error: (e) => { 
                        console.error('[PapaParse 오류]', e); 
                        resolve({ filename: file.name, data: [] }); 
                    }
                });
            });
        } else if (ext === 'xlsx' || ext === 'xls') {
            parsed = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    try {
                        const wb = XLSX.read(new Uint8Array(ev.target.result), { type: 'array' });
                        const ws = wb.Sheets[wb.SheetNames[0]];
                        const json = XLSX.utils.sheet_to_json(ws, { defval: '' });
                        resolve({ filename: file.name, data: json });
                    } catch (e) {
                        console.error('[XLSX 오류]', e);
                        resolve({ filename: file.name, data: [] });
                    }
                };
                reader.onerror = () => resolve({ filename: file.name, data: [] });
                reader.readAsArrayBuffer(file);
            });
        } else {
            alert(`지원하지 않는 파일 형식입니다: ${file.name}`);
            continue;
        }
        
        if (parsed && parsed.data && parsed.data.length > 0) {
            results.push(parsed);
        } else {
            console.warn('[비어있는 파일]', file.name, '파싱 결과:', parsed);
            alert(`'${file.name}' 파일에서 데이터를 읽을 수 없었습니다.\n- Excel이 암호 보호되어 있지 않은지 확인\n- CSV는 EUC-KR 또는 UTF-8 인코딩 가능`);
        }
    }

    if (spinner) spinner.style.display = 'none';

    if (results.length === 0) {
        fileInput.value = '';
        return;
    }

    csvMappingQueue = results;
    processNextCsvMapping();
}

function processNextCsvMapping() {
    if (csvMappingQueue.length === 0) {
        saveHistory();
        updateView();
        alert(`데이터셋 업로드가 완료되었습니다.`);
        document.getElementById('csv-upload').value = '';
        return;
    }

    currentMappingCsv = csvMappingQueue.shift();
    renderMappingModal(currentMappingCsv);
}

function renderMappingModal(csvObj) {
    const name = csvObj.filename;
    let guessedKey = "LMS 학습로그";
    if(name.includes('성취도')) guessedKey = '성취도평가';
    else if(name.includes('LMS')) guessedKey = 'LMS 학습로그';
    else if(name.includes('형성평가')) guessedKey = '형성평가';
    else if(name.includes('AI도구')) guessedKey = 'AI도구 활용로그';
    else if(name.includes('정의적')) guessedKey = '정의적 영역 설문';
    else if(name.includes('포트폴리오')) guessedKey = '포트폴리오';
    else if(name.includes('관찰')) guessedKey = '교사 관찰기록';
    else if(name.includes('협업')) guessedKey = '협업활동';

    document.getElementById('mapping-filename').innerText = name;
    document.getElementById('mapping-dataset-type').value = guessedKey;

    const headers = Object.keys(csvObj.data[0] || {});
    const tbody = document.getElementById('mapping-tbody');
    tbody.innerHTML = '';

    headers.forEach(h => {
        const tr = document.createElement('tr');
        
        const tdName = document.createElement('td');
        tdName.style.padding = '8px';
        tdName.style.borderBottom = '1px solid #e5e7eb';
        tdName.innerText = h;
        
        const tdRole = document.createElement('td');
        tdRole.style.padding = '8px';
        tdRole.style.borderBottom = '1px solid #e5e7eb';
        
        let guessedRole = 'none';
        if (h === '학생명' || h === '이름' || h === '성명') guessedRole = '학생명';
        else if (h === '학생ID' || h === '학번') guessedRole = '학생ID';
        else if (h.includes('날짜') || h.includes('관찰일') || h.includes('실시일') || h.includes('일자')) guessedRole = '날짜';
        else if (h.includes('과목')) guessedRole = '과목';
        else if (h.includes('학교급')) guessedRole = '학교급';
        else if (h.endsWith('점수') || h.includes('성취도')) guessedRole = '성취도 점수';
        else if (h.includes('교사코멘트') || h.includes('선생님평가')) guessedRole = '종합 관찰 코멘트';
        else if (h.includes('긍정관찰') || h.includes('강점') || h.includes('장점')) guessedRole = '강점 코멘트';
        else if (h.includes('관찰필요') || h.includes('보완') || h.includes('단점')) guessedRole = '보완점 코멘트';

        tdRole.innerHTML = `
            <select class="form-select mapping-role-select" data-original="${h}" style="padding:4px; font-size:13px; width: 100%;">
                <option value="none" ${guessedRole==='none'?'selected':''}>일반 데이터 (이름 유지)</option>
                <option value="학생명" ${guessedRole==='학생명'?'selected':''}>학생명</option>
                <option value="학생ID" ${guessedRole==='학생ID'?'selected':''}>학생ID</option>
                <option value="날짜" ${guessedRole==='날짜'?'selected':''}>날짜 / 일시</option>
                <option value="과목" ${guessedRole==='과목'?'selected':''}>과목</option>
                <option value="학교급" ${guessedRole==='학교급'?'selected':''}>학교급</option>
                <option value="성취도 점수" ${guessedRole==='성취도 점수'?'selected':''}>성취도 점수 (레이더 차트용)</option>
                <option value="종합 관찰 코멘트" ${guessedRole==='종합 관찰 코멘트'?'selected':''}>종합 관찰 코멘트</option>
                <option value="강점 코멘트" ${guessedRole==='강점 코멘트'?'selected':''}>강점 코멘트</option>
                <option value="보완점 코멘트" ${guessedRole==='보완점 코멘트'?'selected':''}>보완점 코멘트</option>
            </select>
        `;
        
        tr.appendChild(tdName);
        tr.appendChild(tdRole);
        tbody.appendChild(tr);
    });

    document.getElementById('csv-mapping-modal').style.display = 'flex';
}

window.cancelCsvMapping = function() {
    document.getElementById('csv-mapping-modal').style.display = 'none';
    processNextCsvMapping();
}

window.applyCsvMapping = function() {
    const datasetKey = document.getElementById('mapping-dataset-type').value;
    const selects = document.querySelectorAll('.mapping-role-select');
    
    let renameMap = {};
    selects.forEach(sel => {
        const orig = sel.getAttribute('data-original');
        const role = sel.value;
        if (role === 'none') return;
        
        if (role === '학생명') renameMap[orig] = '학생명';
        else if (role === '학생ID') renameMap[orig] = '학생ID';
        else if (role === '날짜') renameMap[orig] = '날짜';
        else if (role === '과목') renameMap[orig] = '과목';
        else if (role === '학교급') renameMap[orig] = '학교급';
        else if (role === '성취도 점수') {
            if(!orig.endsWith('점수')) renameMap[orig] = orig + '점수';
        }
        else if (role === '종합 관찰 코멘트') renameMap[orig] = '교사코멘트';
        else if (role === '강점 코멘트') renameMap[orig] = '긍정관찰';
        else if (role === '보완점 코멘트') renameMap[orig] = '관찰필요';
    });

    let finalData = currentMappingCsv.data.map(row => {
        let newRow = {};
        Object.keys(row).forEach(k => {
            let newK = renameMap[k] || k;
            newRow[newK] = row[k];
        });
        
        if(newRow['학교급'] !== undefined && String(newRow['학교급']).trim() !== '') {
            newRow._school = newRow['학교급'];
        } else {
            newRow['학교급'] = currentSchool;
            newRow._school = currentSchool;
        }
        
        if(newRow['과목'] !== undefined && String(newRow['과목']).trim() !== '') {
            newRow._subject = newRow['과목'];
        } else {
            newRow['과목'] = currentSubject;
            newRow._subject = currentSubject;
        }
        
        return newRow;
    });

    if(!datasets[datasetKey]) datasets[datasetKey] = [];
    datasets[datasetKey] = datasets[datasetKey].concat(finalData);

    document.getElementById('csv-mapping-modal').style.display = 'none';
    processNextCsvMapping();
}

function updateView() {
    renderTable(); updateKPIs(); updateChartsFromData(); renderAlertBanner();
}

function renderAlertBanner() {
    const bannerContainer = document.getElementById('alert-banner-container');
    if(!bannerContainer) return;

    let flaggedStudents = {}; // { "학생명": ["사유1", "사유2"] }

    getAlertRules().forEach(rule => {
        const data = getFilteredData(rule.dataset);
        data.forEach(d => {
            const valStr = d[rule.column];
            if(valStr === undefined || valStr === '') return;
            
            const numVal = parseFloat(valStr);
            const isNumeric = !isNaN(numVal);
            const checkVal = isNumeric ? numVal : valStr;
            const targetVal = isNumeric ? parseFloat(rule.value) : rule.value;
            
            let matched = false;
            if(rule.operator === '<') matched = checkVal < targetVal;
            else if(rule.operator === '<=') matched = checkVal <= targetVal;
            else if(rule.operator === '=') matched = checkVal == targetVal;
            else if(rule.operator === '>=') matched = checkVal >= targetVal;
            else if(rule.operator === '>') matched = checkVal > targetVal;

            if(matched) {
                const name = d['학생명'] || d['학생ID'] || '알수없음';
                if(!flaggedStudents[name]) flaggedStudents[name] = [];
                const reasonStr = `${rule.dataset}||${rule.column}||${rule.operator}||${rule.value}`;
                if(!flaggedStudents[name].includes(reasonStr)) {
                    flaggedStudents[name].push(reasonStr);
                }
            }
        });
    });

    const uniqueNames = Object.keys(flaggedStudents);

    // 전역 변수에 저장하여 상세 보기 모달에서 접근할 수 있도록 함
    window.currentFlaggedStudents = flaggedStudents;

    if(uniqueNames.length > 0) {
        // 사유 요약
        let sampleReasons = uniqueNames.slice(0, 3).map(name => `${name}(${flaggedStudents[name][0].split('||')[1]} 감지)`).join(', ');
        
        bannerContainer.innerHTML = `
            <div style="background-color: #fef2f2; border: 1px solid #f87171; color: #991b1b; padding: 12px 16px; border-radius: 8px; margin-bottom: 20px; display: flex; align-items: center; justify-content: space-between; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="font-size: 20px;">🚨</span>
                    <div>
                        <div style="font-weight: 700; font-size: 14px;">맞춤형 위험군 학생 알림</div>
                        <div style="font-size: 13px; margin-top: 2px;">설정된 조건에 부합하는 학생이 <b>${uniqueNames.length}명</b> 발견되었습니다. (예: ${sampleReasons}${uniqueNames.length > 3 ? ' 등' : ''})</div>
                    </div>
                </div>
                <div style="display: flex; gap: 8px;">
                    <button onclick="document.getElementById('alert-settings-modal').style.display='flex'; renderAlertSettings();" style="background-color: transparent; border: 1px solid #f87171; color: #dc2626; padding: 6px 12px; border-radius: 4px; font-size: 12px; cursor: pointer; font-weight: bold;">⚙️ 조건 설정</button>
                    <button onclick="showFlaggedStudentsDetails()" style="background-color: #dc2626; color: white; border: none; padding: 6px 12px; border-radius: 4px; font-size: 12px; cursor: pointer; font-weight: bold;">상세 보기</button>
                </div>
            </div>
        `;
    } else {
        bannerContainer.innerHTML = '';
    }
}

window.showFlaggedStudentsDetails = function() {
    const list = document.getElementById('flagged-students-list');
    if (!list) return;
    
    list.innerHTML = '';
    const uniqueNames = Object.keys(window.currentFlaggedStudents || {});
    
    if(uniqueNames.length === 0) {
        list.innerHTML = '<li style="text-align:center; padding: 20px; color:#6b7280;">해당하는 학생이 없습니다.</li>';
    } else {
        uniqueNames.forEach(name => {
            const reasons = window.currentFlaggedStudents[name];
            // Format reasons beautifully
            const reasonHtml = reasons.map(r => {
                const parts = r.split('||');
                const dataset = parts[0];
                const column = parts[1];
                const operator = parts[2];
                const value = parts[3];
                const opText = operator === '<' ? '미만' : operator === '<=' ? '이하' : operator === '=' ? '같음' : operator === '>=' ? '이상' : '초과';
                return `<div style="font-size: 13px; color: #ef4444; margin-top: 4px; display: flex; align-items: center; gap: 6px;">
                    <span style="display:inline-block; background:#fee2e2; color:#dc2626; padding:2px 6px; border-radius:4px; font-size: 11px; font-weight:bold;">${dataset}</span>
                    <span><b>${column}</b> 값이 <b>${value}</b> ${opText}</span>
                </div>`;
            }).join('');
            
            const li = document.createElement('li');
            li.style.cssText = "padding: 16px; border-bottom: 1px solid #e5e7eb;";
            li.innerHTML = `
                <div style="font-weight: bold; font-size: 16px; color: #111827; display: flex; justify-content: space-between; align-items: center;">
                    ${name}
                    <button type="button" class="btn-primary" style="font-size: 11px; padding: 4px 8px;" onclick="event.preventDefault(); event.stopPropagation(); openStudentProfile('${name}')">개인 프로파일 열기</button>
                </div>
                <div style="margin-top: 8px;">${reasonHtml}</div>
            `;
            list.appendChild(li);
        });
    }
    document.getElementById('flagged-students-modal').style.display = 'flex';
};

function initAlertSettings() {
    const dsSelect = document.getElementById('rule-dataset');
    const colSelect = document.getElementById('rule-column');
    if(!dsSelect || !colSelect) return;

    // 데이터셋 select는 열 때마다 새로 채우도록 함수화
    window.refreshAlertDsSelect = function() {
        const prev = dsSelect.value;
        dsSelect.innerHTML = '';
        Object.keys(datasets).forEach(key => {
            // 현재 학교급+과목에 적재된 데이터가 있는 것만 표시
            const filteredLen = getFilteredData(key).length;
            let opt = document.createElement('option');
            opt.value = key;
            opt.innerText = key + (filteredLen > 0 ? ` (${filteredLen}개)` : ' (비어있음)');
            opt.disabled = filteredLen === 0;
            dsSelect.appendChild(opt);
        });
        // 이전 값으로 복원 시도
        if (prev) dsSelect.value = prev;
        dsSelect.dispatchEvent(new Event('change'));
    };

    dsSelect.addEventListener('change', () => {
        const ds = dsSelect.value;
        // 현재 학교급+과목 필터로 컨럼 목록 생성
        const data = getFilteredData(ds);
        colSelect.innerHTML = '';
        if(data.length > 0) {
            const keys = Object.keys(data[0]).filter(k => !k.startsWith('_') && k !== '학생ID' && k !== '학생명' && k !== '학교급' && k !== '과목' && k !== '날짜' && k !== '실시일' && k !== '차시번호');
            if (keys.length > 0) {
                keys.forEach(k => {
                    let opt = document.createElement('option');
                    opt.value = k; opt.innerText = k;
                    colSelect.appendChild(opt);
                });
            } else {
                let opt = document.createElement('option');
                opt.value = ''; opt.innerText = '사용가능한 컨럼 없음';
                colSelect.appendChild(opt);
            }
        } else {
            let opt = document.createElement('option');
            opt.value = ''; opt.innerText = '데이터 없음 (먼저 적재해주세요)';
            colSelect.appendChild(opt);
        }
    });

    // 초기 캐우기
    window.refreshAlertDsSelect();
}

window.addAlertRule = function() {
    const ds = document.getElementById('rule-dataset').value;
    const col = document.getElementById('rule-column').value;
    const op = document.getElementById('rule-operator').value;
    const val = document.getElementById('rule-value').value;

    if(!ds || !col || val === '') return alert("모든 조건 값을 입력해주세요.");

    getAlertRules().push({ id: Date.now(), dataset: ds, column: col, operator: op, value: val });
    saveAlertRules();
    
    document.getElementById('rule-value').value = '';
    renderAlertSettings();
    updateView(); // Re-render banner
};

window.deleteAlertRule = function(id) {
    alertRulesMap[currentSchool + '_' + currentSubject] = getAlertRules().filter(r => r.id !== id);
    saveAlertRules();
    renderAlertSettings();
    updateView(); // Re-render banner
};

window.renderAlertSettings = function() {
    const list = document.getElementById('active-rules-list');
    if(!list) return;
    list.innerHTML = '';

    if(getAlertRules().length === 0) {
        list.innerHTML = '<li style="color:#9ca3af; font-size:13px; text-align:center; padding:10px;">등록된 알림 조건이 없습니다.</li>';
        return;
    }

    getAlertRules().forEach(r => {
        let li = document.createElement('li');
        li.style.cssText = "display:flex; justify-content:space-between; align-items:center; background:#ffffff; padding:10px 16px; border:1px solid #e5e7eb; border-radius:6px; font-size:13px;";
        li.innerHTML = `
            <div>
                <span style="display:inline-block; background:#e0e7ff; color:#3730a3; padding:2px 6px; border-radius:4px; font-weight:bold; margin-right:8px;">${r.dataset}</span>
                <b>${r.column}</b> 값이 <b>${r.value}</b> ${r.operator === '<' ? '미만' : r.operator === '<=' ? '이하' : r.operator === '=' ? '같음' : r.operator === '>=' ? '이상' : '초과'}
            </div>
            <button onclick="deleteAlertRule(${r.id})" style="background:none; border:none; color:#ef4444; font-size:16px; cursor:pointer;" title="삭제">&times;</button>
        `;
        list.appendChild(li);
    });
}

function updateKPIs() {
    const scoreData = getFilteredData('성취도평가');
    let uniqueStudents = new Set();
    
    if (scoreData.length > 0) {
        let total = 0, count = 0;
        scoreData.forEach(d => {
            const val = parseFloat(d['평균'] || d['총점'] || d['성취도점수']);
            if(!isNaN(val)) { total += val; count++; }
            if(d['학생ID']) uniqueStudents.add(d['학생ID']);
        });
        document.getElementById('kpi-score').innerText = count > 0 ? (total/count).toFixed(1) + '점' : '0점';
    } else {
        document.getElementById('kpi-score').innerText = '0점';
    }

    const lmsData = getFilteredData('LMS 학습로그');
    if (lmsData.length > 0) {
        let total = 0, count = 0;
        lmsData.forEach(d => {
            const val = parseFloat(d['총접속분'] || d['학습시간(분)']);
            if(!isNaN(val)) { total += val; count++; }
            if(d['학생ID']) uniqueStudents.add(d['학생ID']);
        });
        document.getElementById('kpi-time').innerText = count > 0 ? Math.round(total/count) + '분' : '0분';
    } else {
        document.getElementById('kpi-time').innerText = '0분';
    }

    document.getElementById('kpi-achievement').innerText = uniqueStudents.size + '명';

    let dsCount = 0;
    Object.keys(datasets).forEach(key => { if(getFilteredData(key).length > 0) dsCount++; });
    document.getElementById('kpi-ai').innerText = dsCount + ' / 8';
}

function saveHistory() { localStorage.setItem('edu_datasets_v17', JSON.stringify(datasets)); }
function loadHistory() { const saved = localStorage.getItem('edu_datasets_v17'); if (saved) { try { datasets = JSON.parse(saved); } catch(e) {} } }

window.clearData = function() {
    if(confirm(`현재 필터링된 [${currentDatasetKey}] 데이터를 지우시겠습니까?`)) {
        const filteredOut = datasets[currentDatasetKey].filter(d => !(d._school === currentSchool && d._subject === currentSubject));
        datasets[currentDatasetKey] = filteredOut;
        saveHistory(); updateView();
    }
}
window.setApiStatus = function(state) {
    const indicator = document.getElementById('api-status-indicator');
    const textEl = document.getElementById('api-status-text');
    if (!indicator || !textEl) return;
    
    indicator.className = 'api-status ' + state;
    
    if (state === 'no-key') {
        textEl.textContent = 'API 키 없음';
    } else if (state === 'idle') {
        textEl.textContent = 'API 연결 완료 ✔';
    } else if (state === 'processing') {
        textEl.textContent = 'AI 처리 중...';
    } else if (state === 'error') {
        textEl.textContent = 'API 오류 / 재확인 필요';
    } else if (state === 'verifying') {
        textEl.textContent = 'API 키 확인 중...';
    } else if (state === 'quota') {
        textEl.textContent = 'API 할당량 초과 (키유효)';
    }
};

// API 키 실제 검증 (최소 텍스트 요청)
async function verifyApiKey() {
    if (!API_KEY) { setApiStatus('no-key'); return; }
    setApiStatus('verifying');

    const CANDIDATES = [
        { ver: 'v1beta', model: 'gemini-3.5-flash' },   // 진짜 동작 확인된 모델
        { ver: 'v1beta', model: 'gemini-2.0-flash' },
        { ver: 'v1beta', model: 'gemini-2.0-flash-exp' },
        { ver: 'v1beta', model: 'gemini-1.5-flash' },
        { ver: 'v1',     model: 'gemini-1.5-flash' },
        { ver: 'v1beta', model: 'gemini-1.5-pro' },
    ];
    
    let quotaExceededModel = null;
    let lastErr = '';

    for (const { ver, model } of CANDIDATES) {
        try {
            const resp = await fetch(
                `https://generativelanguage.googleapis.com/${ver}/models/${model}:generateContent?key=${API_KEY}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contents: [{ parts: [{ text: 'hi' }] }] })
                }
            );

            if (resp.ok) {
                // 완전 성공
                window._verifiedGeminiModel = model;
                window._verifiedGeminiVer   = ver;
                setApiStatus('idle');
                const textEl = document.getElementById('api-status-text');
                if (textEl) {
                    textEl.textContent = 'API 연결 완료 ✔';
                    textEl.title = `모델: ${model} (${ver})`;
                }
                return;
            }

            const errData = await resp.json().catch(() => ({}));
            const errMsg  = errData?.error?.message || `HTTP ${resp.status}`;

            if (resp.status === 429) {
                // 키는 유효, 하지만 일일 할당량 초과
                quotaExceededModel = { ver, model };
                console.warn(`[${ver}/${model}] 할당량 초과:`, errMsg);
            } else {
                lastErr = errMsg;
                console.warn(`[${ver}/${model} 실패]`, errMsg);
            }
        } catch (e) {
            lastErr = e.message;
            console.warn(`[${ver} 오류]`, e.message);
        }
    }

    // 모든 모델 실패했지만 429를 만난 경우 → 키는 정상, 할당량 소진
    if (quotaExceededModel) {
        window._verifiedGeminiModel = quotaExceededModel.model;
        window._verifiedGeminiVer   = quotaExceededModel.ver;
        setApiStatus('quota');
        const textEl = document.getElementById('api-status-text');
        if (textEl) {
            textEl.textContent = 'API 할당량 초과';
            textEl.title = `키는 유효하지만 무료 일일 한도 소진. 내일 초기화됩니다.\n모델: ${quotaExceededModel.model}`;
        }
        alert(
            `API 키는 유효하지만 오늘의 무료 사용 한도가 소진되었습니다.\n\n` +
            `• 무료 티어: 매일 자정(UTC) 초기화\n` +
            `• 유료 전환: https://aistudio.google.com/plan\n\n` +
            `데이터 적재/분석 기능은 정상 사용 가능합니다.\nAI 확장 기능만 내일 다시 시도해주세요.`
        );
        return;
    }

    // 진짜 실패 (키 오류)
    setApiStatus('error');
    const textEl = document.getElementById('api-status-text');
    if (textEl) {
        textEl.textContent = 'API 오류 / 재확인 필요';
        textEl.title = lastErr;
    }
    alert(
        `API 키 검증 실패:\n${lastErr}\n\n` +
        `확인 사항:\n` +
        `① aistudio.google.com 에서 발급한 키인지 확인\n` +
        `② 키 앞뒤 공백 없는지 확인`
    );
}

async function processDataAI() {
    if (!API_KEY) return alert("API 키가 설정되지 않았습니다.");
    const contextText = document.getElementById('context-input').value.trim();
    if(!contextText) return alert("AI가 데이터를 유추할 수 있도록 관찰/평가 문맥을 입력해주세요.");

    const currentData = getFilteredData(currentDatasetKey);
    let headers = currentData.length > 0 ? Object.keys(currentData[0]).filter(k => k !== '_school' && k !== '_subject') : ['학생ID','학생명','col1','col2','col3'];

    const SYSTEM_PROMPT = `
당신은 최고 수준의 교육 데이터 과학자입니다.
사용자의 요구사항(문맥)과 현재 제공된 일부 [샘플 데이터]를 바탕으로 데이터의 결측치를 복원하거나 행을 확장(Augmentation)하세요.
반드시 아래 JSON 배열 구조로만 응답하세요. (마크다운 백틱 제외)
[ { "${headers[0]}": "값", "${headers[1]}": "값" ... } ]
`;

    document.getElementById('loading-spinner').style.display = 'block';
    document.getElementById('generate-btn').disabled = true;
    setApiStatus('processing');

    try {
        const sampleJson = JSON.stringify(currentData.slice(0, 10).map(d => { let clean = {...d}; delete clean._school; delete clean._subject; return clean; }));
        const combinedPrompt = SYSTEM_PROMPT + `\n\n[사용자 지시문맥]\n${contextText}\n\n[현재 ${currentDatasetKey} 샘플 데이터 (일부)]\n${sampleJson}`;
        
        // 검증에서 확인된 모델/버전 사용, 없으면 gemini-3.5-flash 기본값
        const GEMINI_MODEL = window._verifiedGeminiModel || 'gemini-3.5-flash';
        const GEMINI_VER   = window._verifiedGeminiVer   || 'v1beta';
        const response = await fetch(`https://generativelanguage.googleapis.com/${GEMINI_VER}/models/${GEMINI_MODEL}:generateContent?key=${API_KEY}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: combinedPrompt }] }] })
        });
        if (!response.ok) throw new Error(`API 요청 실패 (${response.status})`);
        const result = await response.json();
        let jsonString = result.candidates[0].content.parts[0].text.replace(/```json/g, '').replace(/```/g, '').trim();

        const parsed = JSON.parse(jsonString);
        if (Array.isArray(parsed)) {
            parsed.forEach(row => { row._school = currentSchool; row._subject = currentSubject; });
            const nonFiltered = (datasets[currentDatasetKey] || []).filter(d => !(d._school === currentSchool && d._subject === currentSubject));
            datasets[currentDatasetKey] = nonFiltered.concat(parsed);
            saveHistory(); updateView(); alert('AI 확장이 완료되었습니다!');
            setApiStatus('idle');
        } else throw new Error("JSON 배열 형식이 아닙니다.");
    } catch (e) {
        alert('AI 처리 중 오류가 발생했습니다: ' + e.message);
        setApiStatus('error');
    } finally {
        document.getElementById('loading-spinner').style.display = 'none';
        document.getElementById('generate-btn').disabled = false;
    }
}

let tableSort = { column: null, dir: 'asc' };

function renderTable() {
    const thead = document.getElementById('data-table-head');
    const tbody = document.getElementById('data-table-body');
    thead.innerHTML = ''; tbody.innerHTML = '';
    
    const data = getFilteredData(currentDatasetKey);
    if(data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="100%" style="padding: 30px; text-align: center; color: #9ca3af;">
            <div style="margin-bottom:12px;">현재 선택된 과목/학교급에 일치하는 데이터가 없습니다.</div>
            <button class="btn-primary" onclick="loadDefaultTemplate()">기본 양식(템플릿) 불러오기</button>
        </td></tr>`;
        return;
    }

    const headers = Object.keys(data[0]).filter(k => k !== '_school' && k !== '_subject');
    let trHead = document.createElement('tr');
    headers.forEach(h => {
        let th = document.createElement('th');
        th.style.cursor = 'pointer';
        
        let spanText = document.createElement('span');
        let arrow = '';
        if (tableSort.column === h) {
            arrow = tableSort.dir === 'asc' ? ' ▲' : ' ▼';
        }
        spanText.innerText = h + arrow;
        spanText.onclick = () => {
            if (tableSort.column === h) {
                tableSort.dir = tableSort.dir === 'asc' ? 'desc' : 'asc';
            } else {
                tableSort.column = h;
                tableSort.dir = 'asc';
            }
            renderTable();
        };

        let editBtn = document.createElement('button');
        editBtn.innerText = '✏️';
        editBtn.style.background = 'none';
        editBtn.style.border = 'none';
        editBtn.style.cursor = 'pointer';
        editBtn.style.fontSize = '12px';
        editBtn.style.marginLeft = '6px';
        editBtn.title = '열 이름 변경';
        editBtn.onclick = (e) => {
            e.stopPropagation();
            let promptText = `'${h}' 열의 새 이름을 입력하세요:\\n(성취도 점수의 경우 레이더 차트에 자동 연결되려면 끝에 '점수'를 붙여주세요.)`;
            let newName = prompt(promptText, h);
            if(newName && newName.trim() !== '' && newName !== h) {
                let cleanKey = newName.trim();
                if(headers.includes(cleanKey)) return alert("이미 존재하는 열 이름입니다.");
                
                datasets[currentDatasetKey].forEach(row => {
                    row[cleanKey] = row[h];
                    delete row[h];
                });
                
                if (tableSort.column === h) tableSort.column = cleanKey;
                saveHistory(); updateView();
            }
        };

        th.appendChild(spanText);
        th.appendChild(editBtn);
        trHead.appendChild(th);
    });
    let thAction = document.createElement('th');
    thAction.innerText = '작업';
    trHead.appendChild(thAction);
    thead.appendChild(trHead);

    let displayData = data.map((d, i) => ({ row: d, originalIndex: i }));
    if (tableSort.column) {
        displayData.sort((a, b) => {
            const valA = a.row[tableSort.column];
            const valB = b.row[tableSort.column];
            const numA = parseFloat(valA);
            const numB = parseFloat(valB);
            
            let cmp = 0;
            if (!isNaN(numA) && !isNaN(numB)) cmp = numA - numB;
            else cmp = String(valA).localeCompare(String(valB));
            
            return tableSort.dir === 'asc' ? cmp : -cmp;
        });
    }

    displayData.forEach(({ row, originalIndex }) => {
        let tr = document.createElement('tr');
        headers.forEach(h => {
            const td = document.createElement('td');
            const input = document.createElement('input');
            input.className = 'table-input'; input.value = row[h] || '';
            input.onchange = (e) => {
                row[h] = e.target.value;
                if(h === '학교급') row._school = e.target.value;
                if(h === '과목') row._subject = e.target.value;
                saveHistory(); updateChartsFromData(); if(h === '학교급' || h === '과목') updateView();
            };
            td.appendChild(input); tr.appendChild(td);
        });
        const tdAction = document.createElement('td');
        tdAction.innerHTML = `<div style="display:flex; gap:4px; justify-content:center;">
            <button class="btn-secondary" style="padding:2px 6px; font-size:11px;" onclick="moveRowUp('${row._school}', '${row._subject}', ${originalIndex})" title="위로">↑</button>
            <button class="btn-secondary" style="padding:2px 6px; font-size:11px;" onclick="moveRowDown('${row._school}', '${row._subject}', ${originalIndex})" title="아래로">↓</button>
            <button class="btn-primary" style="padding:2px 6px; font-size:11px; background:#0ea5e9; border:none;" onclick="insertRow('${row._school}', '${row._subject}', ${originalIndex})" title="아래에 빈 행 추가">+</button>
            <button class="btn-danger" style="padding:2px 6px; font-size:11px;" onclick="deleteRow('${row._school}', '${row._subject}', ${originalIndex})" title="삭제">×</button>
        </div>`;
        tr.appendChild(tdAction); tbody.appendChild(tr);
    });
}

window.deleteRow = function(school, subject, filteredIndex) {
    const allData = datasets[currentDatasetKey];
    let currentMatch = 0;
    for(let i=0; i<allData.length; i++) {
        if(allData[i]._school === school && allData[i]._subject === subject) {
            if(currentMatch === filteredIndex) { allData.splice(i, 1); break; }
            currentMatch++;
        }
    }
    saveHistory(); updateView();
}

window.insertRow = function(school, subject, filteredIndex) {
    if(tableSort.column) return alert("정렬 중에는 새 행을 중간에 삽입할 수 없습니다. 열 제목을 클릭해 정렬을 해제해주세요.");
    const allData = datasets[currentDatasetKey];
    const data = getFilteredData(currentDatasetKey);
    let newRow = { _school: currentSchool, _subject: currentSubject };
    if(data.length > 0) {
        Object.keys(data[0]).filter(k => k !== '_school' && k !== '_subject').forEach(h => newRow[h] = "");
    }
    
    let currentMatch = 0;
    for(let i=0; i<allData.length; i++) {
        if(allData[i]._school === school && allData[i]._subject === subject) {
            if(currentMatch === filteredIndex) {
                allData.splice(i + 1, 0, newRow);
                break;
            }
            currentMatch++;
        }
    }
    saveHistory(); updateView();
}

window.moveRowUp = function(school, subject, filteredIndex) {
    if(tableSort.column) return alert("정렬 중에는 행 순서를 바꿀 수 없습니다. 열 제목을 클릭해 정렬을 해제해주세요.");
    if (filteredIndex === 0) return;
    const allData = datasets[currentDatasetKey];
    let currentMatch = 0;
    let prevGlobalIndex = -1;
    for(let i=0; i<allData.length; i++) {
        if(allData[i]._school === school && allData[i]._subject === subject) {
            if(currentMatch === filteredIndex - 1) prevGlobalIndex = i;
            if(currentMatch === filteredIndex) {
                let temp = allData[prevGlobalIndex];
                allData[prevGlobalIndex] = allData[i];
                allData[i] = temp;
                break;
            }
            currentMatch++;
        }
    }
    saveHistory(); updateView();
}

window.moveRowDown = function(school, subject, filteredIndex) {
    if(tableSort.column) return alert("정렬 중에는 행 순서를 바꿀 수 없습니다. 열 제목을 클릭해 정렬을 해제해주세요.");
    const allData = datasets[currentDatasetKey];
    const data = getFilteredData(currentDatasetKey);
    if (filteredIndex === data.length - 1) return;
    
    let currentMatch = 0;
    let currGlobalIndex = -1;
    for(let i=0; i<allData.length; i++) {
        if(allData[i]._school === school && allData[i]._subject === subject) {
            if(currentMatch === filteredIndex) currGlobalIndex = i;
            if(currentMatch === filteredIndex + 1) {
                let temp = allData[currGlobalIndex];
                allData[currGlobalIndex] = allData[i];
                allData[i] = temp;
                break;
            }
            currentMatch++;
        }
    }
    saveHistory(); updateView();
}

window.addNewRow = function() {
    const data = getFilteredData(currentDatasetKey);
    let newRow = { _school: currentSchool, _subject: currentSubject };
    if(data.length > 0) {
        Object.keys(data[0]).filter(k => k !== '_school' && k !== '_subject').forEach(h => newRow[h] = "");
    } else return alert("빈 데이터셋에서는 행을 추가할 수 없습니다. 화면 중앙의 [기본 양식 불러오기]를 클릭해주세요.");
    
    datasets[currentDatasetKey].push(newRow);
    saveHistory(); updateView();
    
    setTimeout(() => {
        const tc = document.querySelector('.table-container');
        if(tc) tc.scrollTop = tc.scrollHeight;
    }, 50);
}

window.loadDefaultTemplate = function() {
    let headers = ['학생ID', '학생명'];
    if(currentDatasetKey === '성취도평가') headers = ['날짜', '학생ID', '학생명', '과목', '영역1점수', '영역2점수', '영역3점수', '영역4점수'];
    else if(currentDatasetKey === '교사 관찰기록') headers = ['관찰일', '학생ID', '학생명', '과목', '수업태도(1-5)', '참여수준(1-5)', '이해정도(1-5)', '긍정관찰', '관찰필요', '교사코멘트'];
    else if(currentDatasetKey === 'AI도구 활용로그') headers = ['날짜', '학생ID', '학생명', '과목', 'AI도구', '활용목적', '프롬프트유형', '소요(분)'];
    else if(currentDatasetKey === 'LMS 학습로그') headers = ['날짜', '학생ID', '학생명', '과목', '총접속분', '영상완주율(%)', '퀴즈응시수', '질문수'];
    else if(currentDatasetKey === '형성평가') headers = ['실시일', '학생ID', '학생명', '과목', '차시명', '문항번호', '성취기준', '정답여부(O/X)', 'AI도움사용'];
    
    let newRow = { _school: currentSchool, _subject: currentSubject };
    headers.forEach(h => newRow[h] = "");
    
    if(!datasets[currentDatasetKey]) datasets[currentDatasetKey] = [];
    datasets[currentDatasetKey].push(newRow);
    
    saveHistory(); updateView();
}

function initCharts() {
    charts.forEach(c => c.destroy());
    charts = [];
    
    // 캔버스 초기화
    [1,2,4,5,6,7,8].forEach(i => {
        const c = document.getElementById(`chart${i}`);
        if(c) {
            const p = c.parentNode;
            p.innerHTML = `<canvas id="chart${i}"></canvas>`;
        }
    });

    Chart.register(ChartDataLabels);
    Chart.defaults.plugins.datalabels.display = false; // 기본적으로는 모든 차트에서 숨김

    const commonOpts = { responsive: true, maintainAspectRatio: false };

    // 1. 박스플롯 (성취도평가)
    charts[0] = new Chart(document.getElementById('chart1'), {
        type: 'boxplot', data: { labels:[], datasets:[] }, 
        options: { 
            ...commonOpts, 
            interaction: { mode: 'nearest', intersect: true },
            plugins: { 
                title: { display:true, text:'성취영역별 점수 분포', font:{size:14} }, 
                legend:{display:false},
                tooltip: {
                    padding: 12,
                    displayColors: false,
                    titleFont: { size: 14 },
                    bodyFont: { size: 13 },
                    callbacks: {
                        label: function(context) {
                            let b = context.parsed;
                            if (b && b._custom) b = b._custom;
                            else if (b && b.y !== undefined && typeof b.y === 'object') b = b.y;
                            
                            // 아웃라이어에 마우스를 직접 댔을 때 (기본적으로 b가 없음)
                            if (!b || b.min === undefined) {
                                if (context.raw && typeof context.raw === 'number') {
                                    return `• 이상치 값: ${context.raw}`;
                                }
                                return '';
                            }

                            const hasOutliers = b.outliers && b.outliers.length > 0;
                            let lines = [
                                `• min       ${b.min.toFixed(1)}`,
                                `• Q1        ${b.q1.toFixed(1)}`,
                                `• median    ${b.median.toFixed(1)}`,
                                `• Q3        ${b.q3.toFixed(1)}`,
                                `• max       ${b.max.toFixed(1)}`
                            ];
                            
                            if (hasOutliers) {
                                lines.push('');
                                lines.push(`[이상치 판정: 1.5 * IQR 밖]`);
                                lines.push(`• 이상치 값: ${b.outliers.join(', ')}`);
                            }
                            return lines;
                        }
                    }
                }
            }, 
            scales:{y:{min:0, max:100}} 
        }
    });

    // 2. Line (회차별 평균 점수 추이)
    charts[1] = new Chart(document.getElementById('chart2'), {
        type: 'line', data: { labels:[], datasets:[] },
        options: { 
            ...commonOpts, 
            interaction: { mode: 'index', intersect: false },
            plugins: { title: { display:true, text:'회차별 평균 점수 추이', font:{size:14} }, legend:{position:'bottom'} },
            scales: { y: { min:0, max:100 } }
        }
    });

    // 3. HTML 히트맵용 (LMS) - 차트 오브젝트는 dummy로 생성
    charts[2] = { destroy: () => {}, config: {type:'heatmap'} };

    // 4. 바차트 (LMS 완주율)
    charts[3] = new Chart(document.getElementById('chart4'), {
        type: 'bar', data: { labels:[], datasets:[] },
        options: { ...commonOpts, plugins: { title: { display:true, text:'영상 완주율 분포', font:{size:14} }, legend:{display:false} } }
    });

    // 5. Stacked Bar (AI도구 활용로그)
    charts[4] = new Chart(document.getElementById('chart5'), {
        type: 'bar', data: { labels:[], datasets:[] },
        options: { 
            ...commonOpts, 
            interaction: { mode: 'nearest', intersect: true },
            plugins: { title: { display:true, text:'AI 도구별 활용 횟수', font:{size:14} }, legend:{position:'bottom'} },
            indexAxis: 'y', scales: { x:{stacked:true}, y:{stacked:true} } 
        }
    });

    // 6. 도넛 (형성평가)
    charts[5] = new Chart(document.getElementById('chart6'), {
        type: 'doughnut', data: { labels:[], datasets:[] },
        options: { 
            ...commonOpts, 
            layout: { padding: 10 },
            plugins: { 
                title: { display:true, text:'형성평가 오류유형', font:{size:14} }, 
                legend:{ display: true, position: 'right' },
                datalabels: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.label || '';
                            if (label) { label += ': '; }
                            if (context.parsed !== null) {
                                let total = context.dataset.data.reduce((a,b) => a+b, 0);
                                let percentage = ((context.parsed / total) * 100).toFixed(1);
                                label += context.parsed + ' (' + percentage + '%)';
                            }
                            return label;
                        }
                    }
                }
            } 
        }
    });

    // 7. 레이더 (정의적영역)
    charts[6] = new Chart(document.getElementById('chart7'), {
        type: 'radar', data: { labels:[], datasets:[] },
        options: { 
            ...commonOpts, 
            interaction: { mode: 'dataset', intersect: false },
            plugins: { title: { display:true, text:'정의적 영역 사전·사후', font:{size:14} }, legend:{position:'bottom'} },
            scales: { r: { min:0, max:5 } }
        }
    });

    // 8. 수평바 (포트폴리오)
    charts[7] = new Chart(document.getElementById('chart8'), {
        type: 'bar', data: { labels:[], datasets:[] },
        options: { ...commonOpts, indexAxis: 'y', plugins: { title: { display:true, text:'포트폴리오 루브릭 평균', font:{size:14} }, legend:{display:false} }, scales: { x:{min:0, max:20} } }
    });
}

function updateChartsFromData() {
    if (charts.length === 0) initCharts();

    // 1. Boxplot (성취도평가)
    const scoreData = getFilteredData('성취도평가');
    const c1 = charts[0];
    if(scoreData.length > 0) {
        // 동적 도메인(영역) 추출: 헤더 이름이 '점수'로 끝나는 컬럼 (단, 총점/평균 제외)
        const allKeys = Object.keys(scoreData[0]);
        const keys = allKeys.filter(k => (k.endsWith('점수') || k === '점수' || k.includes('(점수)')) && !k.includes('총') && !k.includes('평균'));
        // If domain name becomes empty after replacement, use the original key
        const domains = keys.map(k => k.replace('점수', '').trim() || k);
        
        const boxData = keys.map(k => scoreData.map(d => Number(d[k]||0)));
        c1.data.labels = domains;
        c1.data.datasets = [{
            label: '점수',
            backgroundColor: 'rgba(203, 213, 225, 0.5)',
            borderColor: SNU_COLORS.navy,
            borderWidth: 1,
            itemBackgroundColor: SNU_COLORS.navy,
            outlierBackgroundColor: SNU_COLORS.navy,
            itemRadius: 0,
            mean: false,
            data: boxData
        }];
        c1.update();
    } else { c1.data.labels=[]; c1.data.datasets=[]; c1.update(); }

    // 2. Line (회차별 평균 점수 추이)
    const c2 = charts[1];
    if(scoreData.length > 0) {
        const allKeys = Object.keys(scoreData[0]);
        const keys = allKeys.filter(k => (k.endsWith('점수') || k === '점수' || k.includes('(점수)')) && !k.includes('총') && !k.includes('평균'));
        const domains = keys.map(k => k.replace('점수', '').trim() || k);
        const colors = [SNU_COLORS.navy, SNU_COLORS.blue, SNU_COLORS.lightblue, SNU_COLORS.gray, SNU_COLORS.lightgray, SNU_COLORS.yellow, SNU_COLORS.orange, SNU_COLORS.green];
        
        // 다회차 데이터가 있는지 확인
        let minVal = 100, maxVal = 0;
        
        // 회차가 여러 개면 실제 회차 사용, 1개면 단일 점 표시
        const sessions = [...new Set(scoreData.map(d => d['회차']))].filter(s => s !== undefined && s !== '').sort();
        
        if (sessions.length > 1) {
             c2.data.labels = sessions.map(s => s + '회차');
             c2.data.datasets = domains.map((dom, i) => {
                 const dataArr = sessions.map(sess => {
                     const sessData = scoreData.filter(d => d['회차'] == sess);
                     const avg = sessData.reduce((sum, d) => sum + Number(d[keys[i]]||0), 0) / sessData.length || 0;
                     if(avg < minVal) minVal = avg;
                     if(avg > maxVal) maxVal = avg;
                     return avg;
                 });
                 return {
                     label: dom, data: dataArr,
                     borderColor: colors[i % colors.length], backgroundColor: 'transparent',
                     pointBackgroundColor: 'white', pointBorderColor: colors[i % colors.length],
                     pointBorderWidth: 2, pointRadius: 4, tension: 0.1
                 };
             });
        } else {
             // 1회차이거나 회차 정보가 아예 없는 경우: 단일 점이 Y축에 붙지 않도록 앞뒤에 빈 레이블을 넣어 중앙 정렬
             const labelName = sessions.length === 1 ? sessions[0] + '회차' : '단일 데이터';
             c2.data.labels = ['', labelName, ''];
             c2.data.datasets = domains.map((dom, i) => {
                 const avg1 = scoreData.reduce((sum, d) => sum + Number(d[keys[i]]||0), 0) / scoreData.length || 0;
                 if(avg1 < minVal) minVal=avg1; if(avg1 > maxVal) maxVal=avg1;
                 return {
                     label: dom, data: [null, avg1, null],
                     borderColor: colors[i % colors.length], backgroundColor: 'transparent',
                     pointBackgroundColor: 'white', pointBorderColor: colors[i % colors.length],
                     pointBorderWidth: 2, pointRadius: 6, tension: 0.1
                 };
             });
        }
        // 시인성 개선을 위한 스케일 동적 조정
        c2.options.scales.y.min = Math.max(0, Math.floor(minVal) - 10);
        c2.options.scales.y.max = Math.min(100, Math.ceil(maxVal) + 10);
        c2.update();
    } else { c2.data.datasets=[]; c2.update(); }

    // 3. Heatmap (LMS 학습행동)
    const lmsData = getFilteredData('LMS 학습로그');
    renderHeatmap(lmsData);

    // 4. Bar Histogram (영상 완주율)
    const c4 = charts[3];
    if(lmsData.length > 0) {
        const stdMap = {};
        lmsData.forEach(d => {
            const sid = d['학생ID'];
            if(sid) {
                if(!stdMap[sid]) stdMap[sid] = {sum:0, count:0};
                stdMap[sid].sum += Number(d['영상완주율(%)']||0);
                stdMap[sid].count++;
            }
        });
        const bins = {'48-51':0, '51-54':0, '54-57':0, '57-60':0, '60-63':0, '63-66':0, '66-69':0, '69-72':0, '72-75':0, '75-78':0};
        Object.keys(stdMap).forEach(sid => {
            const v = stdMap[sid].sum / stdMap[sid].count;
            if(v>=75) bins['75-78']++; else if(v>=72) bins['72-75']++; else if(v>=69) bins['69-72']++; else if(v>=66) bins['66-69']++;
            else if(v>=63) bins['63-66']++; else if(v>=60) bins['60-63']++; else if(v>=57) bins['57-60']++; else if(v>=54) bins['54-57']++;
            else if(v>=51) bins['51-54']++; else bins['48-51']++;
        });
        c4.data.labels = Object.keys(bins);
        c4.data.datasets = [{ label:'학생 수', data:Object.values(bins), backgroundColor:SNU_COLORS.navy }];
        c4.update();
    } else { c4.data.labels=[]; c4.data.datasets=[]; c4.update(); }

    // 5. Stacked Bar (AI도구 활용로그) - 완전 동적 추출
    const aiData = getFilteredData('AI도구 활용로그');
    const c5 = charts[4];
    if(aiData.length > 0) {
        const toolsSet = new Set();
        const purposeSet = new Set();
        aiData.forEach(d => {
            if(d['AI도구']) toolsSet.add(d['AI도구']);
            if(d['활용목적']) purposeSet.add(d['활용목적']);
        });
        const tools = Array.from(toolsSet);
        const purposes = Array.from(purposeSet);
        
        const matrix = {};
        tools.forEach(t => { matrix[t] = {}; purposes.forEach(p => matrix[t][p]=0); });
        
        aiData.forEach(d => {
            const t = d['AI도구']; const p = d['활용목적'];
            if(matrix[t] && matrix[t][p] !== undefined) {
                // 횟수 기준 1회 카운트
                matrix[t][p] += 1;
            }
        });

        c5.data.labels = tools;
        c5.data.datasets = purposes.map((p, i) => {
            return {
                label: p,
                data: tools.map(t => matrix[t][p]),
                backgroundColor: STACK_COLORS[i % STACK_COLORS.length]
            };
        });
        c5.update();
    } else { c5.data.labels=[]; c5.data.datasets=[]; c5.update(); }

    // 6. Doughnut (형성평가)
    const formData = getFilteredData('형성평가');
    const c6 = charts[5];
    if(formData.length > 0) {
        const errMap = {};
        formData.forEach(d => {
            if(d['정답여부']==='오답' || d['정답여부']==='X') {
                const e = d['오류유형'] || '기타';
                errMap[e] = (errMap[e]||0) + 1;
            }
        });
        c6.data.labels = Object.keys(errMap);
        c6.data.datasets = [{ data:Object.values(errMap), backgroundColor: [SNU_COLORS.navy, SNU_COLORS.blue, SNU_COLORS.lightblue, SNU_COLORS.gray, SNU_COLORS.lightgray, SNU_COLORS.yellow] }];
        c6.update();
    } else { c6.data.labels=[]; c6.data.datasets=[]; c6.update(); }

    // 7. Radar (정의적 영역) - 동적 축 추출
    const surveyData = getFilteredData('정의적 영역 설문');
    const c7 = charts[6];
    if(surveyData.length > 0) {
        // 메타 데이터 및 숫자 아닌 컬럼 필터링
        const skipCols = ['학생ID', '학생명', '학교급', '학년', '반', '성별', '과목', '시점', '작성일', '설문일', '평가일', '관찰일', '제출일'];
        const allKeys = Object.keys(surveyData[0]);
        const axes = allKeys.filter(k => !skipCols.includes(k) && !k.startsWith('_'));
        
        const preData = new Array(axes.length).fill(0); 
        const postData = new Array(axes.length).fill(0);
        let preCount = 0, postCount = 0;

        surveyData.forEach(d => {
            const isPost = d['시점'] === '사후';
            if(isPost) postCount++; else preCount++;
            axes.forEach((ax, i) => { 
                const val = Number(d[ax]||0);
                if(isPost) postData[i] += val; else preData[i] += val;
            });
        });

        c7.data.labels = axes;
        c7.data.datasets = [];
        if(preCount > 0) c7.data.datasets.push({
            label: '사전', data: preData.map(v=>v/preCount),
            backgroundColor: 'rgba(107, 114, 128, 0.4)', borderColor: SNU_COLORS.gray, pointBackgroundColor: SNU_COLORS.gray
        });
        if(postCount > 0) c7.data.datasets.push({
            label: '사후', data: postData.map(v=>v/postCount),
            backgroundColor: 'rgba(30, 58, 138, 0.4)', borderColor: SNU_COLORS.navy, pointBackgroundColor: SNU_COLORS.navy
        });
        
        // 가상의 긍정적 사후 데이터 생성 코드를 삭제하여 임의의 예측 데이터를 표시하지 않음
        
        c7.update();
    } else { c7.data.labels=[]; c7.data.datasets=[]; c7.update(); }

    // 8. Horizontal Bar (포트폴리오) - 동적 추출
    const pfData = getFilteredData('포트폴리오');
    const c8 = charts[7];
    if(pfData.length > 0) {
        // (20) 혹은 (100) 등 평가 항목 동적 추출. 총점/동료평가 등은 제외.
        const allKeys = Object.keys(pfData[0]);
        const keys = allKeys.filter(k => (k.includes('(20)') || k.includes('점수')) && !k.includes('총점') && !k.includes('평균'));
        const cats = keys.map(k => k.replace('(20)', '').trim());
        
        const sums = new Array(keys.length).fill(0);
        pfData.forEach(d => {
            keys.forEach((k, i) => { sums[i] += Number(d[k]||0); });
        });
        c8.data.labels = cats;
        c8.data.datasets = [{ label:'평균점수', data: sums.map(v => v/pfData.length), backgroundColor: SNU_COLORS.navy }];
        c8.update();
    } else { c8.data.labels=[]; c8.data.datasets=[]; c8.update(); }
}

function renderHeatmap(data) {
    const container = document.getElementById('heatmap-card');
    if(!container) return;
    
    let html = `<div style="text-align:center; font-weight:bold; font-size:14px; margin-bottom:10px; color:#666;">LMS 학습 행동 히트맵<br><span style="font-size:11px; font-weight:normal;">요일 x 주차별 평균 접속시간(분)</span></div>`;
    if(data.length === 0) {
        container.innerHTML = html + `<div style="text-align:center; margin-top:50px; color:#999;">데이터 없음</div>`;
        return;
    }

    const days = ['일', '토', '금', '목', '수', '화', '월'];
    let weeks = [];
    
    // 유효한 날짜 파싱 및 주차 계산
    const parsedData = data.map(d => {
        const dateStr = d['날짜'];
        const dateObj = dateStr ? new Date(dateStr) : null;
        return {
            ...d,
            dateObj: dateObj && !isNaN(dateObj) ? dateObj : null,
            time: Number(d['총접속분'] || 0)
        };
    }).filter(d => d.dateObj !== null);

    if (parsedData.length === 0) {
        container.innerHTML = html + `<div style="text-align:center; margin-top:50px; color:#999;">유효한 날짜 데이터가 없어 히트맵을 생성할 수 없습니다.</div>`;
        return;
    }

    // 최솟값(기준일) 찾기
    const minDate = new Date(Math.min(...parsedData.map(d => d.dateObj.getTime())));
    
    // 각 데이터에 주차 부여
    let maxWeekNum = 1;
    parsedData.forEach(d => {
        const diffTime = Math.abs(d.dateObj - minDate);
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24)); 
        const weekNum = Math.floor(diffDays / 7) + 1;
        d.weekNum = weekNum;
        if (weekNum > maxWeekNum) maxWeekNum = weekNum;
    });

    // X축 라벨 생성 (최대 12주)
    const displayMaxWeek = Math.min(maxWeekNum, 12);
    for (let i = 1; i <= displayMaxWeek; i++) {
        weeks.push(`${i}주`);
    }

    // 집계용 매트릭스 초기화
    const matrixStats = {};
    days.forEach(d => {
        matrixStats[d] = {};
        weeks.forEach(w => { matrixStats[d][w] = { sum: 0, count: 0 }; });
    });

    // 실제 데이터 집계
    parsedData.forEach(d => {
        let dayStr = d['요일'];
        if (!dayStr) {
            const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
            dayStr = dayNames[d.dateObj.getDay()];
        } else {
            dayStr = dayStr.charAt(0); // '월요일' -> '월' 추출
        }
        
        const weekStr = `${d.weekNum}주`;
        if (matrixStats[dayStr] && matrixStats[dayStr][weekStr]) {
            matrixStats[dayStr][weekStr].sum += d.time;
            matrixStats[dayStr][weekStr].count += 1;
        }
    });

    // 평균 계산 및 최대값 갱신
    const matrix = {};
    let maxVal = 0;
    days.forEach(d => {
        matrix[d] = {};
        weeks.forEach(w => {
            const stats = matrixStats[d][w];
            const avg = stats.count > 0 ? stats.sum / stats.count : 0;
            matrix[d][w] = avg;
            if (avg > maxVal) maxVal = avg;
        });
    });

    if(maxVal === 0) maxVal = 1;

    html += `<div class="heatmap-container">`;
    days.forEach(d => {
        html += `<div class="heatmap-row"><div class="heatmap-label-y">${d}</div><div class="heatmap-cells">`;
        weeks.forEach(w => {
            const val = matrix[d][w];
            const ratio = Math.min(1, val/maxVal);
            const r = Math.floor(241 - (241 - 30) * ratio);
            const g = Math.floor(245 - (245 - 58) * ratio);
            const b = Math.floor(249 - (249 - 138) * ratio);
            html += `<div class="heatmap-cell" style="background-color: rgb(${r},${g},${b});" onmouseover="showHeatmapIndicator(${val}, ${maxVal})" onmouseout="hideHeatmapIndicator()">
                <span class="tooltip" style="font-weight:bold; color:#1e3a8a;">${d} · ${w}<br><span style="font-size:1.1em; color:#1f2937; margin-top:4px; display:inline-block;">평균 ${val.toFixed(0)}분</span></span>
            </div>`;
        });
        html += `</div></div>`;
    });
    html += `<div class="heatmap-labels-x">`;
    weeks.forEach(w => html += `<div class="heatmap-label-x">${w}</div>`);
    html += `</div><div class="heatmap-legend">0 <div class="heatmap-legend-gradient" id="hm-gradient"><div class="hm-indicator" id="hm-indicator"><div class="hm-indicator-label" id="hm-indicator-label">0</div></div></div> ${Math.ceil(maxVal)}분</div></div>`;
    
    container.innerHTML = html;
}

window.showHeatmapIndicator = function(val, maxVal) {
    const ind = document.getElementById('hm-indicator');
    const lbl = document.getElementById('hm-indicator-label');
    if(ind && lbl) {
        ind.style.display = 'block';
        const ratio = Math.min(1, val/maxVal);
        ind.style.left = (ratio * 100) + '%';
        lbl.textContent = val.toFixed(0);
    }
}
window.hideHeatmapIndicator = function() {
    const ind = document.getElementById('hm-indicator');
    if(ind) ind.style.display = 'none';
}

window.downloadCSV = function() {
    const data = getFilteredData(currentDatasetKey);
    if(data.length === 0) return alert("다운로드할 데이터가 없습니다.");
    const headers = Object.keys(data[0]).filter(k => k !== '_school' && k !== '_subject');
    const csvContent = data.map(row => headers.map(k => `"${row[k] || ''}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + headers.join(",") + "\n" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `학습데이터_${currentSchool}_${currentSubject}_${currentDatasetKey}.csv`;
    link.click();
}

function setupZoomModal() {
    const modal = document.getElementById('zoom-modal');
    document.getElementById('close-zoom-modal').addEventListener('click', () => modal.style.display = 'none');
    const ctx = document.getElementById('zoom-chart').getContext('2d');
    zoomChart = new Chart(ctx, { type: 'bar', data: { labels: [], datasets: [] }, options: { responsive: true, maintainAspectRatio: false } });
}

window.openStudentProfile = function(studentName) {
    try {
        const modal = document.getElementById('student-modal');
        if(!modal) return;
        
        // 이전 모달을 숨겨서 z-index 겹침/블러 중첩 방지
        const prevModal = document.getElementById('flagged-students-modal');
        if(prevModal) prevModal.style.display = 'none';
        
        // 학생명 세팅
        document.getElementById('modal-student-name').textContent = `${studentName} 학생 심층 프로파일`;
        
        const scoreData = getFilteredData('성취도평가').filter(d => d['학생명'] === studentName || d['학생ID'] === studentName);
        const lmsData = getFilteredData('LMS 학습로그').filter(d => d['학생명'] === studentName || d['학생ID'] === studentName);
        const aiData = getFilteredData('AI도구 활용로그').filter(d => d['학생명'] === studentName || d['학생ID'] === studentName);
        const obsData = getFilteredData('교사 관찰기록').filter(d => d['학생명'] === studentName || d['학생ID'] === studentName);

        // --- 요약 카드 생성 ---
        // 점수 컬럼 자동 감지: '점수'로 끝나는 컬럼만 사용
        const EXCLUDE_KEYS = new Set(['_school','_subject','학생명','학생ID','학교급','과목','날짜','실시일','관찰일','일자','회차','차시번호','차시명']);
        const getScoreKeys = (rows) => {
            if (!rows || rows.length === 0) return [];
            return Object.keys(rows[0]).filter(k => !EXCLUDE_KEYS.has(k) && k.endsWith('점수'));
        };
        const getNumKeys = (rows) => {
            if (!rows || rows.length === 0) return [];
            return Object.keys(rows[0]).filter(k => !EXCLUDE_KEYS.has(k) && !isNaN(Number(rows[0][k])) && rows[0][k] !== '');
        };
        const getTextKeys = (rows) => {
            if (!rows || rows.length === 0) return [];
            return Object.keys(rows[0]).filter(k => !EXCLUDE_KEYS.has(k));
        };

        let summaryHtml = `<div style="display: flex; gap: 16px; margin-bottom: 20px; flex-wrap: wrap;">`;
        
        if (scoreData.length > 0) {
            const scoreKeys = getScoreKeys(scoreData);
            // 점수 컬럼이 없으면 숫자 컬럼 중 '평균' 또는 '총점' 먼저 탐색
            const avgKey = scoreKeys.length > 0 ? null : Object.keys(scoreData[0]).find(k => k.includes('평균') || k.includes('총점') || k.includes('성취도'));
            let avg = 0;
            if (scoreKeys.length > 0) {
                let total = 0, count = 0;
                scoreData.forEach(d => scoreKeys.forEach(k => { const v = Number(d[k]); if(!isNaN(v)) { total += v; count++; } }));
                avg = count > 0 ? (total / count).toFixed(1) : 0;
            } else if (avgKey) {
                let total = 0, count = 0;
                scoreData.forEach(d => { const v = Number(d[avgKey]); if(!isNaN(v)) { total += v; count++; } });
                avg = count > 0 ? (total / count).toFixed(1) : 0;
            }
            summaryHtml += `<div style="flex: 1; min-width:100px; background: #f8fafc; padding: 16px; border-radius: 8px; text-align: center; border: 1px solid #e2e8f0;">
                <div style="font-size: 12px; color: #64748b;">평균 성취도</div>
                <div style="font-size: 20px; font-weight: bold; color: #1e293b; margin-top: 4px;">${avg}점</div>
            </div>`;
        }
        
        if (lmsData.length > 0) {
            // 학습시간 컬럼 자동 탐색 (하드코딩 제거)
            const timeKey = Object.keys(lmsData[0]).find(k => k.includes('분') || k.includes('시간') || k.includes('time') || k.includes('Time'));
            let totalTime = 0;
            if (timeKey) lmsData.forEach(d => { const v = Number(d[timeKey]); if(!isNaN(v)) totalTime += v; });
            const loginKey = Object.keys(lmsData[0]).find(k => k.includes('접속') || k.includes('로그인') || k.includes('횟수'));
            let totalLogin = 0;
            if (loginKey) lmsData.forEach(d => { const v = Number(d[loginKey]); if(!isNaN(v)) totalLogin += v; });
            if (timeKey) {
                summaryHtml += `<div style="flex: 1; min-width:100px; background: #f8fafc; padding: 16px; border-radius: 8px; text-align: center; border: 1px solid #e2e8f0;">
                    <div style="font-size: 12px; color: #64748b;">총 ${timeKey}</div>
                    <div style="font-size: 20px; font-weight: bold; color: #1e293b; margin-top: 4px;">${totalTime}분</div>
                </div>`;
            }
            if (loginKey) {
                summaryHtml += `<div style="flex: 1; min-width:100px; background: #f8fafc; padding: 16px; border-radius: 8px; text-align: center; border: 1px solid #e2e8f0;">
                    <div style="font-size: 12px; color: #64748b;">총 ${loginKey}</div>
                    <div style="font-size: 20px; font-weight: bold; color: #1e293b; margin-top: 4px;">${totalLogin}회</div>
                </div>`;
            }
        }

        if (aiData.length > 0) {
            summaryHtml += `<div style="flex: 1; min-width:100px; background: #eff6ff; padding: 16px; border-radius: 8px; text-align: center; border: 1px solid #bfdbfe;">
                <div style="font-size: 12px; color: #1d4ed8;">AI 도구 활용 횟수</div>
                <div style="font-size: 20px; font-weight: bold; color: #1e40af; margin-top: 4px;">${aiData.length}회</div>
            </div>`;
        }

        summaryHtml += `</div>`;
        document.getElementById('modal-summary').innerHTML = summaryHtml;

        // 위험 요인 심층 분석 (Context-Aware Risk Visualization)
        const flaggedSet = window.currentFlaggedStudents ? window.currentFlaggedStudents[studentName] : null;
        const reasons = flaggedSet ? Array.from(flaggedSet) : [];
        const riskContainer = document.getElementById('modal-risk-factors');
        
        if (riskContainer) {
            if (reasons.length > 0) {
                riskContainer.style.display = 'block';
                riskContainer.innerHTML = `<h3 style="color: #e11d48; margin-top:0; border-bottom: 2px solid #fda4af; display:inline-block; padding-bottom:4px; font-size:16px;">🚨 위험 요인 상세 분석</h3>`;
                
                const chartsContainer = document.createElement('div');
                chartsContainer.style.cssText = "display: flex; gap: 16px; margin-top: 16px; overflow-x: auto; padding-bottom: 12px;";
                
                reasons.forEach((r, idx) => {
                    const parts = r.split('||');
                    const dsName = parts[0] || '';
                    const colName = parts[1] || '';
                    const op = parts[2] || '';
                    const val = parts[3] || '';

                    let guidanceHtml = '';
                    if (dsName.includes('성취도') || dsName.includes('형성평가')) {
                        if (op === '<' || op === '<=') {
                            guidanceHtml = `<div style="margin-top: 12px; padding: 12px; background: #fff; border-radius: 6px; font-size: 13px; color: #334155; line-height: 1.5; border-left: 3px solid #e11d48;">
                                <b>💡 지도 가이드:</b> ${colName} 지표가 기준치에 미달합니다. 이전 단원의 결손 여부를 확인하고, 맞춤형 보충 과제 부여를 권장합니다.
                            </div>`;
                        }
                    } else if (dsName.includes('LMS')) {
                        if (op === '<' || op === '<=') {
                            guidanceHtml = `<div style="margin-top: 12px; padding: 12px; background: #fff; border-radius: 6px; font-size: 13px; color: #334155; line-height: 1.5; border-left: 3px solid #e11d48;">
                                <b>💡 지도 가이드:</b> 온라인 학습 참여도가 저조합니다. 자기주도학습 동기 저하를 점검하고 오프라인 과제 연계 여부를 확인하세요.
                            </div>`;
                        }
                    } else if (dsName.includes('AI도구')) {
                        if (op === '>' || op === '>=') {
                            guidanceHtml = `<div style="margin-top: 12px; padding: 12px; background: #fff; border-radius: 6px; font-size: 13px; color: #334155; line-height: 1.5; border-left: 3px solid #e11d48;">
                                <b>💡 지도 가이드:</b> AI 도구 의존도가 과도할 수 있습니다. 무분별한 과제 대행 여부를 점검하고, 올바른 AI 활용 윤리 교육이 필요합니다.
                            </div>`;
                        }
                    } else if (dsName.includes('정의적')) {
                        if (op === '<' || op === '<=') {
                            guidanceHtml = `<div style="margin-top: 12px; padding: 12px; background: #fff; border-radius: 6px; font-size: 13px; color: #334155; line-height: 1.5; border-left: 3px solid #e11d48;">
                                <b>💡 지도 가이드:</b> 학습 정서 지표가 위험 수준입니다. 정서적 지지 및 멘토링이 시급하며, 작은 성공 경험을 제공하는 것이 좋습니다.
                            </div>`;
                        }
                    }
                    if (!guidanceHtml) {
                        guidanceHtml = `<div style="margin-top: 12px; padding: 12px; background: #fff; border-radius: 6px; font-size: 13px; color: #334155; line-height: 1.5; border-left: 3px solid #e11d48;">
                            <b>💡 종합 분석:</b> 위험 감지 기준을 이탈했습니다. 학생과의 1:1 상담을 통해 원인을 진단해 보세요.
                        </div>`;
                    }

                    const card = document.createElement('div');
                    card.style.cssText = "flex: 0 0 350px; background: #fff1f2; border: 1px solid #fecdd3; border-radius: 8px; padding: 16px; display: flex; flex-direction: column;";
                    card.innerHTML = `
                        <div style="font-size: 12px; color: #be123c; font-weight:bold; margin-bottom: 4px;">${dsName} 데이터</div>
                        <div style="font-size: 14px; color: #881337; margin-bottom: 12px;">${colName} 값이 <b>${val}</b> ${op==='<'?'미만':op==='<='?'이하':op==='>='?'이상':op==='>'?'초과':'같음'}</div>
                        <div style="flex: 1; min-height: 160px; position:relative;"><canvas id="risk-chart-${idx}"></canvas></div>
                        ${guidanceHtml}
                    `;
                    chartsContainer.appendChild(card);
                });
                riskContainer.appendChild(chartsContainer);

                // 차트 렌더링
                setTimeout(() => {
                    reasons.forEach((r, idx) => {
                        const parts = r.split('||');
                        const dsName = parts[0] || '';
                        const colName = parts[1] || '';
                        const targetVal = Number(parts[3]) || 0;

                        const studentData = getFilteredData(dsName).filter(d => d['학생명'] === studentName || d['학생ID'] === studentName);
                        
                        if (studentData.length > 0) {
                            const ctx = document.getElementById(`risk-chart-${idx}`).getContext('2d');
                            
                            if (studentData.length > 1) {
                                // 회차가 여러개인 경우 - 단순히 마지막 5개가 아니라 "위반이 일어난 회차"를 포함하도록 자르기
                                let recentData = studentData;
                                if (recentData.length > 5) {
                                    let lastViolatingIndex = recentData.length - 1;
                                    const opStr = parts[2];
                                    const ruleValStr = parts[3];
                                    for (let i = recentData.length - 1; i >= 0; i--) {
                                        const valStr = recentData[i][colName];
                                        if (valStr === undefined || valStr === '') continue;
                                        
                                        const numVal = parseFloat(valStr);
                                        const isNumeric = !isNaN(numVal);
                                        const checkVal = isNumeric ? numVal : valStr;
                                        const tgtVal = isNumeric ? parseFloat(ruleValStr) : ruleValStr;

                                        let isMatch = false;
                                        if (opStr === '<') isMatch = checkVal < tgtVal;
                                        else if (opStr === '<=') isMatch = checkVal <= tgtVal;
                                        else if (opStr === '=') isMatch = checkVal == tgtVal;
                                        else if (opStr === '>=') isMatch = checkVal >= tgtVal;
                                        else if (opStr === '>') isMatch = checkVal > tgtVal;
                                        
                                        if (isMatch) {
                                            lastViolatingIndex = i;
                                            break;
                                        }
                                    }
                                    let startIdx = Math.max(0, lastViolatingIndex - 4);
                                    // Make sure we don't go out of bounds if violation is at the very end
                                    if (startIdx + 5 > recentData.length) startIdx = recentData.length - 5;
                                    recentData = recentData.slice(startIdx, startIdx + 5);
                                }
                                
                                // X축 라벨은 원본 studentData 기준의 회차 인덱스를 유지하기 위해 수정
                                const startOffset = studentData.length > 5 ? studentData.indexOf(recentData[0]) : 0;
                                const labels = recentData.map((d, i) => {
                                    let label = d['날짜'] || d['실시일'] || d['일자'] || d['회차'] || d['차시명'] || `${startOffset + i + 1}회`;
                                    // 날짜 형태(YYYY-MM-DD)라면 간소화(MM-DD)
                                    if (typeof label === 'string' && label.length === 10 && label.includes('-')) {
                                        label = label.substring(5);
                                    }
                                    return label;
                                });
                                const dataVals = recentData.map(d => {
                                    const raw = d[colName];
                                    if (raw === '예' || raw === 'O' || raw === 'Y' || raw === 'TRUE') return 1;
                                    if (raw === '아니오' || raw === 'X' || raw === 'N' || raw === 'FALSE') return 0;
                                    const v = Number(raw);
                                    return isNaN(v) ? 0 : v;
                                });
                                
                                new Chart(ctx, {
                                    type: 'line',
                                    data: {
                                        labels: labels,
                                        datasets: [
                                            {
                                                label: colName,
                                                data: dataVals,
                                                borderColor: '#e11d48',
                                                backgroundColor: 'rgba(225, 29, 72, 0.1)',
                                                fill: true,
                                                tension: 0.3,
                                                pointBackgroundColor: '#e11d48'
                                            },
                                            {
                                                label: '기준값',
                                                data: Array(labels.length).fill(targetVal),
                                                borderColor: '#94a3b8',
                                                borderDash: [5, 5],
                                                borderWidth: 2,
                                                pointRadius: 0,
                                                fill: false
                                            }
                                        ]
                                    },
                                    options: {
                                        responsive: true, maintainAspectRatio: false,
                                        plugins: { legend: { display: false } },
                                        scales: { y: { suggestedMin: 0 } }
                                    }
                                });
                            } else {
                                // 단일 회차인 경우 - 기준값과 비교하는 막대 그래프
                                let studentValRaw = studentData[0][colName];
                                let studentVal = 0;
                                if (studentValRaw === '예' || studentValRaw === 'O' || studentValRaw === 'Y') studentVal = 1;
                                else if (studentValRaw === '아니오' || studentValRaw === 'X' || studentValRaw === 'N') studentVal = 0;
                                else studentVal = Number(studentValRaw || 0);

                                new Chart(ctx, {
                                    type: 'bar',
                                    data: {
                                        labels: [studentName, '위험 기준'],
                                        datasets: [{
                                            data: [studentVal, targetVal],
                                            backgroundColor: ['#e11d48', '#94a3b8'],
                                            borderRadius: 4
                                        }]
                                    },
                                    options: {
                                        responsive: true, maintainAspectRatio: false,
                                        plugins: { legend: { display: false } },
                                        scales: { y: { beginAtZero: true } }
                                    }
                                });
                            }
                        }
                    });
                }, 100);
            } else {
                riskContainer.style.display = 'none';
                riskContainer.innerHTML = '';
            }
        }

        // --- 관찰 기록 렌더링 (하드코딩 컬럼명 제거 → 자동 감지) ---
        const obsList = document.getElementById('modal-obs-list');
        const obsHeader = obsList ? obsList.previousElementSibling : null;
        if (obsList) obsList.innerHTML = '';
        let hasObs = false;
        if (obsList && obsData.length > 0) {
            hasObs = true;
            if (obsHeader) obsHeader.style.display = 'block';
            obsList.style.display = 'block';
            const OBS_DATE_KEYS = ['관찰일','날짜','일자','실시일','date'];
            const OBS_SKIP_KEYS = new Set([...Array.from(EXCLUDE_KEYS), '학교명', '학년', '반']);
            // 역할별 컬럼 자동 탐색
            const obsKeys = Object.keys(obsData[0]);
            const posKey = obsKeys.find(k => k.includes('긍정') || k.includes('강점') || k === '긍정관찰');
            const negKey = obsKeys.find(k => k.includes('관찰필요') || k.includes('보완') || k.includes('단점'));
            const commKey = obsKeys.find(k => k.includes('코멘트') || k.includes('평가') || k.includes('교사'));
            const otherObsKeys = obsKeys.filter(k => !OBS_SKIP_KEYS.has(k) && k !== posKey && k !== negKey && k !== commKey && !OBS_DATE_KEYS.includes(k));

            obsData.forEach((d, idx) => {
                const dateVal = OBS_DATE_KEYS.map(k => d[k]).find(v => v && v.trim() !== '') || '';
                const li = document.createElement('li');
                li.style.cssText = "padding: 10px 0; border-bottom: 1px solid #f1f5f9; font-size: 13px;";
                let texts = [];
                if (posKey && d[posKey] && String(d[posKey]).trim()) texts.push(`<span style="color:#16a34a;font-weight:bold;background:#dcfce7;padding:1px 6px;border-radius:3px;font-size:11px;">강점</span> ${d[posKey]}`);
                if (negKey && d[negKey] && String(d[negKey]).trim()) texts.push(`<span style="color:#ea580c;font-weight:bold;background:#ffedd5;padding:1px 6px;border-radius:3px;font-size:11px;">보완</span> ${d[negKey]}`);
                if (commKey && d[commKey] && String(d[commKey]).trim()) texts.push(`<span style="color:#2563eb;font-weight:bold;background:#dbeafe;padding:1px 6px;border-radius:3px;font-size:11px;">코멘트</span> ${d[commKey]}`);
                otherObsKeys.forEach(k => { if (d[k] && String(d[k]).trim()) texts.push(`<span style="color:#6b7280;font-weight:bold;">[${k}]</span> ${d[k]}`); });
                const textContent = texts.length > 0 ? texts.join('<br/>') : '내용 없음';
                li.innerHTML = `<div style="margin-bottom:5px; color:#64748b; font-weight:600; font-size:12px;">${dateVal ? '[' + dateVal + ']' : ''}</div><div style="padding-left:4px; line-height:1.7;">${textContent}</div>`;
                obsList.appendChild(li);
            });
        } else if (obsList) {
            if (obsHeader) obsHeader.style.display = 'none';
            obsList.style.display = 'none';
        }

        // --- AI 도구 활용내역 렌더링 (날짜별 그룹핑 카드, 더보기 기능) ---
        const aiList = document.getElementById('modal-ai-list');
        const aiHeader = aiList ? aiList.previousElementSibling : null;
        if (aiList) aiList.innerHTML = '';
        let hasAi = false;
        if (aiList && aiData.length > 0) {
            hasAi = true;
            if (aiHeader) aiHeader.style.display = 'block';
            aiList.style.display = 'block';
            const AI_DATE_KEYS = ['날짜','일자','실시일','date','사용일','활용일'];
            const aiKeys = Object.keys(aiData[0]).filter(k => !EXCLUDE_KEYS.has(k));
            const aiToolKey = aiKeys.find(k => k.includes('도구') || k.includes('tool') || k.includes('Tool')) || aiKeys[0];
            const aiPurposeKey = aiKeys.find(k => k.includes('목적') || k.includes('활용') || k.includes('내용') || k.includes('purpose'));
            const aiResultKey = aiKeys.find(k => k.includes('결과') || k.includes('산출') || k.includes('result'));
            const aiEthicsKey = aiKeys.find(k => k.includes('윤리') || k.includes('검증') || k.includes('점검'));
            const aiTimeKey = aiKeys.find(k => k.includes('시간') || k.includes('분') || k.includes('회수') || k.includes('횟수'));
            const aiOtherKeys = aiKeys.filter(k => k !== aiToolKey && k !== aiPurposeKey && k !== aiResultKey && k !== aiEthicsKey && k !== aiTimeKey && !AI_DATE_KEYS.includes(k));

            const SHOW_COUNT = 5;
            const renderAiItems = (items) => {
                items.forEach(d => {
                    const dateVal = AI_DATE_KEYS.map(k => d[k]).find(v => v && v.trim() !== '') || '';
                    const li = document.createElement('li');
                    li.style.cssText = "padding: 10px 12px; margin-bottom: 8px; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0; font-size: 13px;";
                    let inner = '';
                    // 날짜 헤더
                    if (dateVal) inner += `<div style="font-size:11px; color:#94a3b8; font-weight:600; margin-bottom:6px;">${dateVal}</div>`;
                    // 도구명 강조
                    const toolVal = aiToolKey ? (d[aiToolKey] || '') : '';
                    if (toolVal) inner += `<div style="margin-bottom:4px;"><span style="display:inline-block;background:#dbeafe;color:#1d4ed8;font-weight:700;padding:2px 8px;border-radius:4px;font-size:12px;">${toolVal}</span></div>`;
                    // 목적/내용
                    if (aiPurposeKey && d[aiPurposeKey] && String(d[aiPurposeKey]).trim()) {
                        inner += `<div style="color:#334155; margin-top:4px;"><span style="color:#6b7280;font-size:11px;">활용 목적:</span> ${d[aiPurposeKey]}</div>`;
                    }
                    // 결과물
                    if (aiResultKey && d[aiResultKey] && String(d[aiResultKey]).trim()) {
                        inner += `<div style="color:#334155; margin-top:3px;"><span style="color:#6b7280;font-size:11px;">결과물:</span> ${d[aiResultKey]}</div>`;
                    }
                    // 시간/횟수
                    if (aiTimeKey && d[aiTimeKey] && String(d[aiTimeKey]).trim()) {
                        inner += `<div style="color:#334155; margin-top:3px;"><span style="color:#6b7280;font-size:11px;">${aiTimeKey}:</span> ${d[aiTimeKey]}</div>`;
                    }
                    // 윤리 검증
                    if (aiEthicsKey && d[aiEthicsKey] && String(d[aiEthicsKey]).trim()) {
                        const ethicsOk = String(d[aiEthicsKey]).includes('예') || String(d[aiEthicsKey]).includes('O') || String(d[aiEthicsKey]).includes('Y');
                        inner += `<div style="color:${ethicsOk?'#16a34a':'#dc2626'}; margin-top:3px; font-size:12px;"><span style="color:#6b7280;font-size:11px;">${aiEthicsKey}:</span> ${d[aiEthicsKey]}</div>`;
                    }
                    // 기타 컬럼
                    aiOtherKeys.forEach(k => {
                        if (d[k] && String(d[k]).trim()) {
                            inner += `<div style="color:#64748b; margin-top:2px; font-size:12px;"><span style="font-weight:600;">${k}:</span> ${d[k]}</div>`;
                        }
                    });
                    li.innerHTML = inner || '내용 없음';
                    aiList.appendChild(li);
                });
            };

            renderAiItems(aiData.slice(0, SHOW_COUNT));
            // 더보기 버튼
            if (aiData.length > SHOW_COUNT) {
                const moreBtn = document.createElement('button');
                moreBtn.style.cssText = "width:100%; margin-top:6px; padding:6px; background:none; border:1px dashed #94a3b8; border-radius:6px; color:#64748b; font-size:12px; cursor:pointer;";
                moreBtn.textContent = `▼ 더보기 (${aiData.length - SHOW_COUNT}개 더)`;
                moreBtn.onclick = () => { renderAiItems(aiData.slice(SHOW_COUNT)); moreBtn.remove(); };
                aiList.appendChild(moreBtn);
            }
        } else if (aiList) {
            if (aiHeader) aiHeader.style.display = 'none';
            aiList.style.display = 'none';
        }

        // 둘 다 없으면 카드 전체 숨기기
        const infoCard = document.querySelector('.modal-info-card');
        if (infoCard) {
            infoCard.style.display = (hasObs || hasAi) ? 'block' : 'none';
        }

        // 레이더 차트는 모달 표시 후 아래에서 그립니다 (canvas가 숨겨진 상태에서 그리면 오류 발생)

        // 모달을 먼저 표시한 후 차트 그리기 (canvas가 보여야 올바르게 렌더링됨)
        modal.classList.add('show');
        modal.style.display = 'flex';
        modal.style.opacity = '1';
        
        // --- 레이더 차트 (성취도 점수 컬럼만 사용) ---
        const canvas = document.getElementById('modal-radar-chart');
        if (canvas) {
            try {
                if (window.modalRadarInstance) {
                    window.modalRadarInstance.destroy();
                    window.modalRadarInstance = null;
                }
                const ctxRadar = canvas.getContext('2d');
                const achieveData = getFilteredData('성취도평가').filter(d => d['학생명'] === studentName || d['학생ID'] === studentName);

                if (achieveData.length > 0) {
                    // '점수'로 끝나는 컬럼만 선택 (학년, 반, 총점, 평균 등 비점수 컬럼 제외)
                    // 제외: 총점수, 평균점수, 총합점수 (합산 컬럼)
                    const domainKeys = Object.keys(achieveData[0]).filter(k =>
                        k.endsWith('점수') &&
                        !k.includes('총') && !k.includes('평균') && !k.includes('합') &&
                        !EXCLUDE_KEYS.has(k)
                    );

                    if (domainKeys.length >= 3) {
                        // 3개 이상 → 레이더 차트
                        const labels = domainKeys.map(k => k.replace('점수','').trim() || k);
                        const dataVals = domainKeys.map(k => {
                            let sum = 0, count = 0;
                            achieveData.forEach(d => { const v = Number(d[k]); if(!isNaN(v)) { sum += v; count++; } });
                            return count > 0 ? sum/count : 0;
                        });
                        window.modalRadarInstance = new Chart(ctxRadar, {
                            type: 'radar',
                            data: {
                                labels: labels,
                                datasets: [{ label: `${studentName} 영역별 성취도`, data: dataVals, backgroundColor: 'rgba(59,130,246,0.15)', borderColor: '#3b82f6', pointBackgroundColor: '#3b82f6', borderWidth: 2 }]
                            },
                            options: {
                                responsive: true, maintainAspectRatio: false,
                                scales: { r: { beginAtZero: true, ticks: { stepSize: 20, font: { size: 10 } }, pointLabels: { font: { size: 11 } } } },
                                plugins: { legend: { display: true, position: 'top' } }
                            }
                        });
                    } else if (domainKeys.length > 0) {
                        // 1~2개 → 가로 막대 그래프로 폴백
                        const labels = domainKeys.map(k => k.replace('점수','').trim() || k);
                        const dataVals = domainKeys.map(k => {
                            let sum = 0, count = 0;
                            achieveData.forEach(d => { const v = Number(d[k]); if(!isNaN(v)) { sum += v; count++; } });
                            return count > 0 ? sum/count : 0;
                        });
                        window.modalRadarInstance = new Chart(ctxRadar, {
                            type: 'bar',
                            data: {
                                labels: labels,
                                datasets: [{ label: `${studentName} 점수`, data: dataVals, backgroundColor: '#3b82f6', borderRadius: 4 }]
                            },
                            options: {
                                indexAxis: 'y', responsive: true, maintainAspectRatio: false,
                                scales: { x: { beginAtZero: true, max: 100 } },
                                plugins: { legend: { display: false } }
                            }
                        });
                    } else {
                        // 점수 컬럼이 없음 → 안내 텍스트
                        const ctx2d = canvas.getContext('2d');
                        const w = canvas.parentElement ? canvas.parentElement.offsetWidth : 200;
                        const h = canvas.parentElement ? canvas.parentElement.offsetHeight : 150;
                        canvas.width = w; canvas.height = h;
                        ctx2d.font = '13px sans-serif'; ctx2d.fillStyle = '#94a3b8'; ctx2d.textAlign = 'center';
                        ctx2d.fillText('영역별 점수 데이터가 없습니다.', w/2, h/2);
                        ctx2d.font = '11px sans-serif';
                        ctx2d.fillText('(열 이름이 \'점수\'로 끝나는 컬럼이 필요합니다)', w/2, h/2 + 20);
                    }
                } else {
                    canvas.parentElement.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#94a3b8;font-size:13px;flex-direction:column;gap:8px;"><span>📊</span><span>성취도 데이터 없음</span><span style="font-size:11px;">(${currentSubject} 데이터를 먼저 적재해주세요)</span></div>`;
                }
            } catch(chartErr) {
                console.warn('레이더 차트 오류 (무시):', chartErr.message);
            }
        }
    } catch(e) {
        console.error('Error opening student profile:', e);
        alert('프로파일을 여는 도중 오류가 발생했습니다:\n' + e.message + '\n\n브라우저 콘솔(F12)에서 자세한 오류를 확인해 주세요.');
    }
};

window.closeStudentModal = function() {
    const modal = document.getElementById('student-modal');
    modal.classList.remove('show');
    modal.style.opacity = '0';
    setTimeout(() => {
        modal.style.display = 'none';
        const prevModal = document.getElementById('flagged-students-modal');
        if(prevModal) prevModal.style.display = 'flex';
    }, 300); // fade-out transition 기다림
};

// 과목 동적 렌더링 함수
window.renderSubjects = function() {
    const container = document.getElementById('filter-subject');
    if(!container) return;
    
    container.innerHTML = '';
    SNU_SUBJECTS.forEach((subj, idx) => {
        const btn = document.createElement('button');
        btn.className = 'pill' + (subj === currentSubject && !isEditSubjectMode ? ' active' : '');
        btn.dataset.val = subj;
        
        if (isEditSubjectMode) {
            btn.innerHTML = `${subj} <span style="color:#ef4444; margin-left:4px;">&times;</span>`;
            btn.style.border = '1px solid #fca5a5';
            btn.style.backgroundColor = '#fef2f2';
            btn.onclick = () => {
                SNU_SUBJECTS.splice(idx, 1);
                localStorage.setItem('edu_subjects', JSON.stringify(SNU_SUBJECTS));
                if (currentSubject === subj) currentSubject = SNU_SUBJECTS[0] || '';
                renderSubjects();
                updateView();
            };
        } else {
            btn.textContent = subj;
            btn.onclick = () => {
                document.querySelectorAll('#filter-subject .pill').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentSubject = subj;
                updateView();
                if (window.refreshAlertDsSelect) window.refreshAlertDsSelect();
            };
        }
        container.appendChild(btn);
    });

    if (isEditSubjectMode) {
        const addBtn = document.createElement('button');
        addBtn.className = 'pill';
        addBtn.style.cssText = "background: white; border: 1px dashed #94a3b8; color: #64748b;";
        addBtn.innerHTML = '+ 추가';
        addBtn.onclick = () => {
            const newSubj = prompt('추가할 과목 이름을 입력하세요:');
            if (newSubj && newSubj.trim() !== '') {
                if (!SNU_SUBJECTS.includes(newSubj.trim())) {
                    SNU_SUBJECTS.push(newSubj.trim());
                    localStorage.setItem('edu_subjects', JSON.stringify(SNU_SUBJECTS));
                    renderSubjects();
                } else {
                    alert('이미 존재하는 과목입니다.');
                }
            }
        };
        container.appendChild(addBtn);
    }
};

window.toggleEditSubjects = function() {
    isEditSubjectMode = !isEditSubjectMode;
    renderSubjects();
};
