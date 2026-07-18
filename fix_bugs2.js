const fs = require('fs');
let code = fs.readFileSync('app.js', 'utf8');

// Fix 1: openStudentProfile try catch alert
code = code.replace(/catch\(err\) \{\s+console\.error\(err\);\s+\}/, 'catch(err) { alert("학생 프로필 상세 렌더링 오류: " + err.message); console.error(err); }');

// Fix 2: openStudentProfile dsName undefined issue
const old_reasons_forEach = "const dsName = parts[0];\r\n                    const colName = parts[1];\r\n                    const op = parts[2];\r\n                    const val = parts[3];\r\n\r\n                    let guidanceHtml = '';\r\n                    if (dsName.includes('성취도') || dsName.includes('형성평가')) {";
const new_reasons_forEach = "const dsName = parts[0] || '';\r\n                    const colName = parts[1] || '';\r\n                    const op = parts[2] || '';\r\n                    const val = parts[3] || '';\r\n\r\n                    let guidanceHtml = '';\r\n                    if (dsName.includes('성취도') || dsName.includes('형성평가')) {";
code = code.replace(old_reasons_forEach, new_reasons_forEach);
code = code.replace(old_reasons_forEach.replace(/\r/g, ''), new_reasons_forEach.replace(/\r/g, '')); // handle \n only just in case

// Fix 3: alertRules isolated by subject
code = code.replace(/let alertRules = \[\];\s*try \{\s*const savedRules = localStorage\.getItem\('edu_alert_rules_v26'\);\s*if\(savedRules\) alertRules = JSON\.parse\(savedRules\);\s*else alertRules = \[\{ id: Date\.now\(\), dataset: '성취도평가', column: '.*?', operator: '<', value: 60 \}\];\s*\} catch\(e\) \{\s*alertRules = \[\{ id: Date\.now\(\), dataset: '성취도평가', column: '.*?', operator: '<', value: 60 \}\];\s*\}/, 
`let alertRulesMap = {};
try {
    const savedRules = localStorage.getItem('edu_alert_rules_map_v3');
    if(savedRules) alertRulesMap = JSON.parse(savedRules);
} catch(e) {}
function getAlertRules() {
    const k = currentSchool + "_" + currentSubject;
    if(!alertRulesMap[k] || alertRulesMap[k].length === 0) {
        alertRulesMap[k] = [{ id: Date.now(), dataset: '성취도평가', column: '성취도 점수', operator: '<', value: 60 }];
    }
    return alertRulesMap[k];
}
function saveAlertRules() {
    localStorage.setItem('edu_alert_rules_map_v3', JSON.stringify(alertRulesMap));
}`);

code = code.replace(/alertRules\.forEach\(/g, "getAlertRules().forEach(");
code = code.replace(/alertRules\.push\(/g, "getAlertRules().push(");
code = code.replace(/localStorage\.setItem\('edu_alert_rules_v26', JSON\.stringify\(alertRules\)\);/g, "saveAlertRules();");
code = code.replace(/alertRules = alertRules\.filter\(r => r\.id !== id\);/g, "alertRulesMap[currentSchool + '_' + currentSubject] = getAlertRules().filter(r => r.id !== id);");
code = code.replace(/if\(alertRules\.length === 0\) \{/g, "if(getAlertRules().length === 0) {");

fs.writeFileSync('app.js', code);
