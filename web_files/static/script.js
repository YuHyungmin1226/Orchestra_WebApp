// =================================================================
// 1. Global State Management
// =================================================================
const store = {
    students: [],
    sections: [],
    rehearsals: [],
    section_students: [],
    attendance: [],
    currentUser: null
};
let listenersInitialized = false;

// =================================================================
// Message / Toast Notification System
// =================================================================
function show_toast_message(message, type = 'success') {
    let toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
        // Create toast container if it doesn't exist
        const newContainer = document.createElement('div');
        newContainer.id = 'toast-container';
        newContainer.style.position = 'fixed';
        newContainer.style.top = '10px';
        newContainer.style.right = '10px';
        newContainer.style.zIndex = '1000';
        newContainer.style.display = 'flex';
        newContainer.style.flexDirection = 'column';
        newContainer.style.gap = '10px';
        document.body.appendChild(newContainer);
        toastContainer = newContainer;
    }

    const toast = document.createElement('div');
    toast.classList.add('toast-message');
    toast.textContent = message;

    // Apply basic styling based on type
    toast.style.padding = '10px 20px';
    toast.style.borderRadius = '5px';
    toast.style.color = 'white';
    toast.style.fontWeight = 'bold';
    toast.style.boxShadow = '0 2px 10px rgba(0,0,0,0.2)';
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease-in-out';

    if (type === 'success') {
        toast.style.backgroundColor = '#28a745';
    } else if (type === 'error') {
        toast.style.backgroundColor = '#dc3545';
    } else if (type === 'info') {
        toast.style.backgroundColor = '#17a2b8';
    } else {
        toast.style.backgroundColor = '#6c757d';
    }

    toastContainer.appendChild(toast);

    // Fade in
    setTimeout(() => {
        toast.style.opacity = '1';
    }, 100);

    // Fade out and remove
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.addEventListener('transitionend', () => toast.remove());
    }, 5000); // Message visible for 5 seconds
}


// =================================================================
// 2. Application Initialization & Auth
// =================================================================
document.addEventListener('DOMContentLoaded', function() {
    console.log("DOM is ready. Setting up login listeners.");
    document.getElementById('login-btn').addEventListener('click', handleLogin);
    // Allow pressing Enter to log in
    document.getElementById('password').addEventListener('keyup', (event) => {
        if (event.key === 'Enter') {
            handleLogin();
        }
    });
});

async function handleLogin() {
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const errorMessageEl = document.getElementById('login-error');

    if (!username || !password) {
        errorMessageEl.textContent = '아이디와 비밀번호를 모두 입력해주세요.';
        show_toast_message('아이디와 비밀번호를 모두 입력해주세요.', 'error');
        return;
    }

    try {
        console.log("Attempting login...");
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
            cache: 'no-store' // Prevent caching login request
        });

        const result = await response.json();
        console.log("Login API response:", response, result);

        if (!response.ok || !result.success) { // Explicitly check HTTP status and backend success flag
            throw new Error(result.error || result.message || 'Login failed');
        }

        // --- Login Successful ---
        store.currentUser = result.user;
        errorMessageEl.textContent = ''; // Clear any previous errors
        show_toast_message(`${store.currentUser.name} 님, 환영합니다!`, 'success');
        
        // Hide login screen and show the main app
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('app-container').style.display = 'block';

        // Update header with user info
        document.getElementById('current-user').textContent = `${store.currentUser.name} 님`;

        // Initialize the main application
        await startApp();

    } catch (error) {
        console.error("Login error:", error);
        // errorMessageEl.textContent = error.message; // Removed, as show_toast_message handles this
        show_toast_message(`로그인 실패: ${error.message}`, 'error');
    }
}

function handleLogout() {
    // Simple logout by reloading the page
    location.reload();
}

/**
 * Main function to initialize the application AFTER successful login.
 * Fetches all data and sets up the initial UI and event listeners.
 */
async function startApp() {
    console.log("startApp initiated.");
    // Fetch all necessary data in parallel for faster loading
    await Promise.all([
        fetchData('/api/students', 'students'),
        fetchData('/api/sections', 'sections'),
        fetchData('/api/rehearsals', 'rehearsals'),
        fetchData('/api/section_students', 'section_students'),
        fetchData('/api/attendance', 'attendance')
    ]);
    console.log("All data fetched.");

    normalizeStoreIds();

    // Augment student data with their sections for display
    const augmentedStudents = store.students.map(student => {
        const studentSections = store.section_students
            .filter(mapping => mapping.student_id === student.student_id)
            .map(mapping => store.sections.find(s => s.section_id === mapping.section_id)?.section_name)
            .filter(name => name)
            .join(', ');
        return { ...student, part: studentSections || 'N/A' };
    });

    // Populate the static display tables at the bottom of the page
    displayTable(augmentedStudents, 'students-table', ['student_id', 'name', 'part', 'contact', 'join_date', 'status'], 'student_id');
    displayTable(store.sections, 'sections-table', ['section_id', 'section_name'], 'section_id');
    displayTable(store.rehearsals, 'rehearsals-table', ['rehearsal_id', 'date', 'location', 'description'], 'rehearsal_id');
    
    // Populate the dropdowns for the attendance checker
    populateDropdown('rehearsal-select', store.rehearsals, 'rehearsal_id', 'date');
    populateDropdown('section-select', store.sections, 'section_id', 'section_name', true);
    setupReportTarget(); // Ensure report targets reflect latest data

    if (listenersInitialized) {
        return;
    }

    // Add event listeners for the main action buttons
    document.getElementById('load-students-btn').addEventListener('click', renderAttendanceList);
    document.getElementById('save-attendance-btn').addEventListener('click', saveAttendance);

    // Initialize the statistics and reporting section
    document.getElementById('report-type-select').addEventListener('change', setupReportTarget);
    document.getElementById('generate-report-btn').addEventListener('click', generateReport);

    // Initialize Main Navigation
    const navButtons = document.querySelectorAll('.nav-btn');
    navButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetScreenId = button.dataset.target;
            showScreen(targetScreenId);
            navButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
        });
    });

    // Initialize Data Screen Tabs
    const dataTabButtons = document.querySelectorAll('.data-tab-btn');
    dataTabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetDataScreenId = button.dataset.target;
            showDataScreen(targetDataScreenId);
            dataTabButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
        });
    });

    // Initialize Add Buttons
    document.querySelectorAll('.add-btn').forEach(button => {
        button.addEventListener('click', handleAddClick);
    });

    // Initialize Logout Button
    document.getElementById('logout-btn').addEventListener('click', handleLogout);

    // Initialize CSV Import/Export Buttons
    document.getElementById('export-csv-btn').addEventListener('click', handleExportCSV);
    document.getElementById('import-csv-btn').addEventListener('click', handleImportCSV);
    document.getElementById('import-csv-input').addEventListener('change', handleImportFileSelect);

    listenersInitialized = true;
}

// =================================================================
// 6. CSV Import/Export
// =================================================================

/**
 * Handles the click event for the 'Export to CSV' button.
 * Fetches the zip file from the server and triggers a download.
 */
async function handleExportCSV() {
    show_toast_message('CSV 데이터 내보내기를 시작합니다...', 'info');
    try {
        const response = await fetch('/api/export_csv');
        if (!response.ok) {
            throw new Error('서버에서 내보내기 파일을 생성하지 못했습니다.');
        }
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = 'orchestra_data.zip';
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();
        show_toast_message('데이터가 성공적으로 내보내졌습니다.', 'success');
    } catch (error) {
        console.error('Error exporting CSV:', error);
        show_toast_message(`내보내기 실패: ${error.message}`, 'error');
    }
}

/**
 * Handles the click event for the 'Import from CSV' button.
 * Triggers the hidden file input.
 */
function handleImportCSV() {
    document.getElementById('import-csv-input').click();
}

/**
 * Handles the file selection for CSV import.
 * Uploads the zip file to the server.
 */
async function handleImportFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!confirm(`정말로 데이터를 가져오시겠습니까? 현재 데이터베이스의 모든 내용이 업로드한 파일의 데이터로 대체됩니다. 이 작업은 되돌릴 수 없습니다.`)) {
        show_toast_message('가져오기가 취소되었습니다.', 'info');
        event.target.value = ''; // Reset file input
        return;
    }

    const formData = new FormData();
    formData.append('file', file);

    show_toast_message('데이터 가져오기를 시작합니다...', 'info');

    try {
        const response = await fetch('/api/import_csv', {
            method: 'POST',
            body: formData,
        });

        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || '서버에서 파일 처리 실패');
        }
        
        show_toast_message('데이터를 성공적으로 가져왔습니다. 앱을 다시 로드합니다.', 'success');
        await startApp(); // Refresh all data and UI

    } catch (error) {
        console.error('Error importing CSV:', error);
        show_toast_message(`가져오기 실패: ${error.message}`, 'error');
    } finally {
        event.target.value = ''; // Reset file input
    }
}



// =================================================================
// 3. Data Fetching
// =================================================================
/**
 * Fetches data from a given API endpoint and stores it in the global store.
 * @param {string} apiUrl - The URL of the API to fetch from.
 * @param {string} storeKey - The key in the global `store` object to save the data to.
 */
async function fetchData(apiUrl, storeKey) {
    console.log(`Fetching data for ${storeKey} from ${apiUrl}...`);
    try {
        const response = await fetch(apiUrl, { cache: 'no-store' }); // Prevent caching
        if (!response.ok) {
            throw new Error(`Network response was not ok for ${apiUrl}: ${response.statusText}`);
        }
        store[storeKey] = await response.json();
        console.log(`Successfully fetched and stored data for ${storeKey}.`);
    } catch (error) {
        console.error(`There was a problem fetching data for ${storeKey}:`, error);
        show_toast_message(`데이터 로드 실패 (${storeKey}): ${error.message}`, 'error');
    }
}

/**
 * Normalize ID fields to strings to avoid type mismatch (DB returns numbers).
 */
function normalizeStoreIds() {
    const normalizeIds = (arr, keys) => (arr || []).map(item => {
        const normalized = { ...item };
        keys.forEach(k => {
            if (normalized[k] !== undefined && normalized[k] !== null) {
                normalized[k] = String(normalized[k]);
            }
        });
        return normalized;
    });

    store.students = normalizeIds(store.students, ['student_id']);
    store.sections = normalizeIds(store.sections, ['section_id']);
    store.rehearsals = normalizeIds(store.rehearsals, ['rehearsal_id']);
    store.section_students = normalizeIds(store.section_students, ['section_id', 'student_id']);
    store.attendance = normalizeIds(store.attendance, ['attendance_id', 'rehearsal_id', 'student_id', 'save_version']);
}


// =================================================================
// 4. UI Rendering Functions
// =================================================================

/**
 * Hides all screens and shows the one with the specified ID by toggling a CSS class.
 * @param {string} screenId The ID of the screen to show.
 */
function showScreen(screenId) {
    const screens = document.querySelectorAll('.screen');
    screens.forEach(screen => {
        screen.classList.remove('active');
    });

    const activeScreen = document.getElementById(screenId);
    if (activeScreen) {
        activeScreen.classList.add('active');
    }
}

/**
 * Hides all data screens and shows the one with the specified ID.
 * @param {string} screenId The ID of the data screen to show.
 */
function showDataScreen(screenId) {
    const screens = document.querySelectorAll('.data-screen');
    screens.forEach(screen => {
        screen.classList.remove('active');
    });

    const activeScreen = document.getElementById(screenId);
    if (activeScreen) {
        activeScreen.classList.add('active');
    }
}

/**
 * Displays data from a data array in a specified HTML table.
 * @param {Object[]} data - The array of data objects to display.
 * @param {string} tableId - The ID of the div element to inject the table into.
 * @param {string[]} columns - An array of column names to display.
 * @param {string} primaryKey - The name of the primary key column for the data.
 */
function displayTable(data, tableId, columns, primaryKey) {
    const tableContainer = document.getElementById(tableId);
    if (data) {
        tableContainer.innerHTML = createHtmlTable(data, columns, primaryKey);
        
        const storeKey = tableId.split('-')[0];
        tableContainer.querySelectorAll('.edit-btn').forEach(btn => {
            btn.addEventListener('click', handleEditClick);
        });
        tableContainer.querySelectorAll('.save-btn').forEach(btn => {
            btn.addEventListener('click', (event) => handleSaveClick(event, storeKey, primaryKey));
        });
        tableContainer.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', (event) => handleDeleteClick(event, storeKey, primaryKey));
        });

    } else {
        tableContainer.innerHTML = `<p>No data to display.</p>`;
    }
}

/**
 * Creates an HTML table string from an array of objects.
 * @param {Object[]} data - The array of data objects.
 * @param {string[]} columns - The columns to include in the table.
 * @param {string} primaryKey - The name of the primary key column for the data.
 * @returns {string} The HTML string for the table.
 */
function createHtmlTable(data, columns, primaryKey) {
    if (!data || data.length === 0) return '<p>No data available.</p>';
    
    let tableHtml = '<table class="data-table"><thead><tr>';
    columns.forEach(col => { tableHtml += `<th>${col.replace('_', ' ')}</th>`; });
    tableHtml += '<th>작업</th>'; // Actions column
    tableHtml += '</tr></thead><tbody>';

    data.forEach(row => {
        tableHtml += `<tr data-pk-val="${row[primaryKey]}">`;
        columns.forEach(col => {
            tableHtml += `<td data-col="${col}">${row[col] || ''}</td>`;
        });
        tableHtml += `
            <td class="actions">
                <button class="edit-btn">수정</button>
                <button class="save-btn" style="display:none;">저장</button>
                <button class="delete-btn">삭제</button>
            </td>
        `;
        tableHtml += '</tr>';
    });

    tableHtml += '</tbody></table>';
    return tableHtml;
}

/**
 * Populates a <select> dropdown menu with data.
 * @param {string} selectId - The ID of the select element.
 * @param {Object[]} data - The data to populate with.
 * @param {string} valueKey - The key from the data object to use as the option value.
 * @param {string} textKey - The key from the data object to use as the option text.
 * @param {boolean} [includeAllOption=false] - Whether to include an "All" option at the beginning.
 */
function populateDropdown(selectId, data, valueKey, textKey, includeAllOption = false) {
    const select = document.getElementById(selectId);
    select.innerHTML = '';
    if (!data) return;

    if (includeAllOption) {
        const allOption = document.createElement('option');
        allOption.value = 'all';
        allOption.textContent = '전체';
        select.appendChild(allOption);
    }

    data.forEach(item => {
        const option = document.createElement('option');
        option.value = String(item[valueKey]);
        option.textContent = item[textKey];
        select.appendChild(option);
    });
}

/**
 * Renders the list of students for a selected section or all students for attendance checking.
 */
function renderAttendanceList() {
    const rehearsalSelect = document.getElementById('rehearsal-select');
    const selectedRehearsalText = rehearsalSelect.options[rehearsalSelect.selectedIndex].text;
    const sectionId = document.getElementById('section-select').value;
    const container = document.getElementById('attendance-list-container');
    let studentsToShow = [];
    let title = '';

    if (sectionId === 'all') {
        studentsToShow = store.students;
        title = `[${selectedRehearsalText}] 전체 파트 출석 체크`;
    } else {
        const selectedSection = store.sections.find(s => s.section_id === sectionId);
        title = `[${selectedRehearsalText}] ${selectedSection ? selectedSection.section_name : '선택 파트'} 출석 체크`;
        const studentIdsInSection = store.section_students
            .filter(mapping => mapping.section_id === sectionId)
            .map(mapping => mapping.student_id);
        studentsToShow = store.students.filter(student => studentIdsInSection.includes(student.student_id));
    }

    if (studentsToShow.length === 0) {
        container.innerHTML = '<p>불러올 단원이 없습니다.</p>';
        document.getElementById('save-attendance-btn').style.display = 'none';
        return;
    }

    let listHtml = `<h4>${title}</h4><table class="data-table">`;
    listHtml += '<thead><tr><th>이름</th><th>파트</th><th>상태</th></tr></thead><tbody>';

    studentsToShow.forEach(student => {
        const studentSections = store.section_students
            .filter(mapping => mapping.student_id === student.student_id)
            .map(mapping => store.sections.find(s => s.section_id === mapping.section_id)?.section_name)
            .filter(name => name)
            .join(', ');

        listHtml += `
            <tr data-student-id="${student.student_id}">
                <td>${student.name}</td>
                <td>${studentSections || 'N/A'}</td>
                <td>
                    <input type="radio" id="status_present_${student.student_id}" name="status_${student.student_id}" value="present" checked> <label for="status_present_${student.student_id}">출석</label>
                    <input type="radio" id="status_late_${student.student_id}" name="status_${student.student_id}" value="late"> <label for="status_late_${student.student_id}">지각</label>
                    <input type="radio" id="status_absent_${student.student_id}" name="status_${student.student_id}" value="absent"> <label for="status_absent_${student.student_id}">결석</label>
                </td>
            </tr>
        `;
    });

    listHtml += '</tbody></table>';
    container.innerHTML = listHtml;
    document.getElementById('save-attendance-btn').style.display = 'block';
}


// =================================================================
// 5. Data Submission & Editing
// =================================================================

/**
 * Handles the click event for the 'Edit' button on a data table row.
 * Converts the row's cells into input fields.
 */
function handleEditClick(event) {
    const row = event.target.closest('tr');
    const cells = row.querySelectorAll('td[data-col]');
    
    cells.forEach(cell => {
        const colName = cell.dataset.col;
        if (colName !== 'student_id' && colName !== 'section_id' && colName !== 'rehearsal_id' && colName !== 'part') {
            const currentValue = cell.textContent;
            cell.innerHTML = `<input type="text" value="${currentValue}">`;
        }
    });

    row.querySelector('.edit-btn').style.display = 'none';
    row.querySelector('.save-btn').style.display = 'inline-block';
}

/**
 * Handles the click event for the 'Save' button on a data table row.
 * Collects data, sends it to the backend, and updates the UI.
 */
async function handleSaveClick(event, storeKey, primaryKey) {
    console.log(`handleSaveClick for ${storeKey} (PK: ${primaryKey}) started.`);
    const row = event.target.closest('tr');
    const cells = row.querySelectorAll('td[data-col]');
    const updatedRecord = {};

    cells.forEach(cell => {
        const colName = cell.dataset.col;
        const input = cell.querySelector('input');
        if (input) {
            updatedRecord[colName] = input.value;
        } else {
            updatedRecord[colName] = cell.textContent;
        }
    });
    
    const filenameMap = {
        'students': 'students.csv',
        'sections': 'sections.csv',
        'rehearsals': 'rehearsals.csv'
    };

    const payload = {
        filename: filenameMap[storeKey],
        primary_key_col: primaryKey,
        record: updatedRecord
    };

    console.log("Save Click payload:", payload);

    try {
        const response = await fetch('/api/update_data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            cache: 'no-store'
        });

        const result = await response.json();
        console.log("Save Click API response:", response, result);

        if (!response.ok || !result.success) { // Explicitly check HTTP status and backend success flag
            throw new Error(result.error || result.message || 'Failed to save data on server.');
        }

        // Update successful, revert UI to non-editable state
        cells.forEach(cell => {
            const colName = cell.dataset.col;
            cell.innerHTML = updatedRecord[colName] || '';
        });
        row.querySelector('.edit-btn').style.display = 'inline-block';
        row.querySelector('.save-btn').style.display = 'none';
        
        show_toast_message(result.message || '성공적으로 수정되었습니다!', 'success');
        await startApp(); // Refresh data and UI with latest values
        
    } catch (error) {
        console.error('Error saving data:', error);
        show_toast_message(`수정 실패: ${error.message}`, 'error');
    }
}

/**
 * Handles the click event for the 'Delete' button on a data table row.
 * Asks for confirmation, sends a delete request to the backend, and updates the UI.
 */
async function handleDeleteClick(event, storeKey, primaryKey) {
    console.log(`handleDeleteClick for ${storeKey} (PK: ${primaryKey}) started.`);
    const row = event.target.closest('tr');
    const pkValue = row.dataset.pkVal;

    if (!confirm(`정말로 이 항목을 삭제하시겠습니까? (ID: ${pkValue})\n이 작업은 되돌릴 수 없습니다.`)) {
        show_toast_message('삭제가 취소되었습니다.', 'info');
        return;
    }

    const filenameMap = {
        'students': 'students.csv',
        'sections': 'sections.csv',
        'rehearsals': 'rehearsals.csv'
    };

    const payload = {
        filename: filenameMap[storeKey],
        primary_key_col: primaryKey,
        primary_key_val: pkValue
    };

    console.log("Delete Click payload:", payload);

    try {
        const response = await fetch('/api/delete_data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            cache: 'no-store'
        });

        const result = await response.json();
        console.log("Delete Click API response:", response, result);

        if (!response.ok || !result.success) { // Explicitly check HTTP status and backend success flag
            throw new Error(result.error || result.message || 'Failed to delete data on server.');
        }

        // Deletion successful, remove the row from the UI
        row.remove();
        
        show_toast_message(result.message || '성공적으로 삭제되었습니다!', 'success');
        // Refresh the global store and re-render all tables that might be affected
        await startApp(); // Refresh data and UI

    } catch (error) {
        console.error('Error deleting data:', error);
        show_toast_message(`삭제 실패: ${error.message}`, 'error');
    }
}

/**
 * Handles the click event for the 'Add' button.
 * Inserts a new, empty, editable row at the top of the table.
 */
function handleAddClick(event) {
    const tableType = event.target.dataset.table;
    const tableId = `${tableType}-table`;
    const tableContainer = document.getElementById(tableId);
    let table = tableContainer.querySelector('table');

    // If table doesn't exist (no data yet), create a basic skeleton table
    if (!table) {
        const columnConfig = {
            'students': ['student_id', 'name', 'part', 'contact', 'join_date', 'status'],
            'sections': ['section_id', 'section_name'],
            'rehearsals': ['rehearsal_id', 'date', 'location', 'description']
        };
        const cols = columnConfig[tableType];
        if (!cols) return;
        const headerCells = cols.map(c => `<th>${c}</th>`).join('') + '<th>작업</th>';
        tableContainer.innerHTML = `<table class="data-table"><thead><tr>${headerCells}</tr></thead><tbody></tbody></table>`;
        table = tableContainer.querySelector('table');
    }

    if (table.querySelector('.new-row')) {
        alert('이미 추가 중인 항목이 있습니다. 먼저 저장하거나 취소해주세요.');
        return;
    }

    const columnConfig = {
        'students': {
            cols: ['student_id', 'name', 'part', 'contact', 'join_date', 'status'],
            pk: 'student_id'
        },
        'sections': {
            cols: ['section_id', 'section_name'],
            pk: 'section_id'
        },
        'rehearsals': {
            cols: ['rehearsal_id', 'date', 'location', 'description'],
            pk: 'rehearsal_id'
        }
    };

    const config = columnConfig[tableType];
    if (!config) return;

    const newRow = table.querySelector('tbody').insertRow(0);
    newRow.classList.add('new-row');

    let rowHtml = '';
    config.cols.forEach(col => {
        if (col === config.pk) {
            rowHtml += `<td data-col="${col}"><input type="text" value="자동 생성" disabled></td>`;
        } else if (tableType === 'students' && col === 'part') {
            let selectHtml = '<select class="new-student-section-select">';
            selectHtml += '<option value="">-- 파트 선택 --</option>';
            store.sections.forEach(sec => {
                selectHtml += `<option value="${sec.section_id}">${sec.section_name}</option>`;
            });
            selectHtml += '</select>';
            rowHtml += `<td data-col="${col}">${selectHtml}</td>`;
        } else {
            rowHtml += `<td data-col="${col}"><input type="text" value=""></td>`;
        }
    });

    rowHtml += `
        <td class="actions">
            <button class="save-new-btn">저장</button>
            <button class="cancel-add-btn">취소</button>
        </td>
    `;
    newRow.innerHTML = rowHtml;

    newRow.querySelector('.save-new-btn').addEventListener('click', (e) => handleSaveNewClick(e, tableType, config.pk));
    newRow.querySelector('.cancel-add-btn').addEventListener('click', () => newRow.remove());
}

/**
 * Handles saving a newly added row.
 */
async function handleSaveNewClick(event, storeKey, primaryKey) {
    const row = event.target.closest('tr');
    const cells = row.querySelectorAll('td[data-col]');
    const newRecord = {};

    cells.forEach(cell => {
        const colName = cell.dataset.col;
        const input = cell.querySelector('input');
        
        if (storeKey === 'students' && colName === 'part') {
            const select = cell.querySelector('select');
            newRecord['section_id'] = select.value;
        }
        else if (input && !input.disabled) {
            newRecord[colName] = input.value;
        }
    });

    const filenameMap = {
        'students': 'students.csv',
        'sections': 'sections.csv',
        'rehearsals': 'rehearsals.csv'
    };

    const payload = {
        filename: filenameMap[storeKey],
        primary_key_col: primaryKey,
        record: newRecord
    };

    try {
        const response = await fetch('/api/add_data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Failed to add data.');

        show_toast_message('성공적으로 추가되었습니다.', 'success');
        await startApp(); // Refresh data and UI

    } catch (error) {
        console.error('Error adding data:', error);
        show_toast_message(`추가 실패: ${error.message}`, 'error');
    }
}


/**
 * Collects attendance data from the UI and POSTs it to the server.
 */
async function saveAttendance() {
    const rehearsalId = document.getElementById('rehearsal-select').value;
    const studentRows = document.querySelectorAll('#attendance-list-container tr[data-student-id]');
    const statusEl = document.getElementById('save-status');
    const recordsToSave = [];

    // --- Pre-save check for duplicates ---
    const hasPreviousSave = store.attendance.some(rec => 
        rec.rehearsal_id === rehearsalId && rec.marked_by === store.currentUser.name
    );

    if (hasPreviousSave) {
        if (!confirm('이미 이 연습일에 대한 출석 기록을 저장했습니다. 추가로 저장하시겠습니까?\n(이전 기록에 덮어쓰지 않고, 새로운 버전으로 추가 저장됩니다.)')) {
            statusEl.textContent = '저장이 취소되었습니다.';
            statusEl.style.color = 'orange';
            return; // Abort save
        }
    }
    // --- End of pre-save check ---

    studentRows.forEach(row => {
        const studentId = row.dataset.studentId;
        const selectedStatus = row.querySelector(`input[name="status_${studentId}"]:checked`);
        if (studentId && selectedStatus) {
            recordsToSave.push({
                rehearsal_id: rehearsalId,
                student_id: studentId,
                status: selectedStatus.value,
                memo: ''
            });
        }
    });

    if (recordsToSave.length === 0) {
        statusEl.textContent = "저장할 데이터가 없습니다.";
        statusEl.style.color = 'orange';
        return;
    }

    statusEl.textContent = "저장 중...";
    statusEl.style.color = 'blue';

    const payload = {
        marked_by: store.currentUser.name,
        records: recordsToSave
    };

    try {
        const response = await fetch('/api/attendance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || '서버 저장 실패');
        
        statusEl.textContent = result.message || '성공적으로 저장되었습니다!';
        statusEl.style.color = 'green';
        
        await startApp(); // Refresh data and IDs after save
        document.getElementById('attendance-list-container').innerHTML = '';
        document.getElementById('save-attendance-btn').style.display = 'none';

    } catch (error) {
        console.error('Error saving attendance:', error);
        statusEl.textContent = `저장 중 오류 발생: ${error.message}`;
        statusEl.style.color = 'red';
    }
}



// =================================================================
// 6. Statistics and Reporting
// =================================================================

/**
 * Sets up the "target" dropdown based on the selected report type (student or section).
 */
function setupReportTarget() {
    const reportType = document.getElementById('report-type-select').value;
    const targetSelect = document.getElementById('report-target-select');
    
    if (reportType === 'student') {
        populateDropdown(targetSelect.id, store.students, 'student_id', 'name');
    } else { // section
        populateDropdown(targetSelect.id, store.sections, 'section_id', 'section_name', true);
    }
}

/**
 * Generates and displays an attendance report based on UI selections.
 */
function generateReport() {
    const reportType = document.getElementById('report-type-select').value;
    const targetId = document.getElementById('report-target-select').value;
    const resultsContainer = document.getElementById('report-results-container');
    
    let attendanceRecords = [];
    let reportTitle = '';

    if (reportType === 'student') {
        const student = store.students.find(s => s.student_id === targetId);
        if (!student) {
            resultsContainer.innerHTML = '<p>학생을 찾을 수 없습니다.</p>';
            return;
        }
        reportTitle = `${student.name} 학생 개인 리포트`;
        attendanceRecords = store.attendance.filter(rec => rec.student_id === targetId);
    } else { // section
        if (targetId === 'all') {
            reportTitle = '전체 파트 리포트';
            attendanceRecords = store.attendance;
        } else {
            const section = store.sections.find(s => s.section_id === targetId);
            if (!section) {
                resultsContainer.innerHTML = '<p>파트를 찾을 수 없습니다.</p>';
                return;
            }
            reportTitle = `${section.section_name} 파트 리포트`;
            const studentIdsInSection = store.section_students
                .filter(mapping => mapping.section_id === targetId)
                .map(mapping => mapping.student_id);
            attendanceRecords = store.attendance.filter(rec => studentIdsInSection.includes(rec.student_id));
        }
    }

    const stats = {
        present: 0,
        late: 0,
        absent: 0,
        excused_absent: 0,
        unknown: 0,
        total: attendanceRecords.length
    };

    attendanceRecords.forEach(rec => {
        const status = rec.status || 'unknown';
        if (stats.hasOwnProperty(status)) {
            stats[status]++;
        } else {
            stats.unknown++;
        }
    });

    const countedTotal = Math.max(stats.total, 0);
    const attendanceRate = countedTotal > 0
        ? ((stats.present + stats.late) / countedTotal * 100).toFixed(1)
        : 'N/A';

    let resultsHtml = `<h3>${reportTitle}</h3>`;
    if (stats.total === 0) {
        resultsHtml += '<p>해당 대상의 출석 기록이 없습니다.</p>';
    } else {
        resultsHtml += `
            <p><strong>총 연습 횟수 (기록된):</strong> ${stats.total}회</p>
            <p><strong>출석률 (결석 제외):</strong> ${attendanceRate}%</p>
            <ul>
                <li><strong>출석:</strong> ${stats.present}회</li>
                <li><strong>지각:</strong> ${stats.late}회</li>
                <li><strong>결석:</strong> ${stats.absent}회</li>
                <li><strong>공결:</strong> ${stats.excused_absent}회</li>
                ${stats.unknown ? `<li><strong>기타:</strong> ${stats.unknown}회</li>` : ''}
            </ul>
        `;
    }
    resultsContainer.innerHTML = resultsHtml;
}
