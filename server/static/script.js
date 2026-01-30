// Global User State
let currentUser = null;

document.addEventListener('DOMContentLoaded', () => {
    checkLoginStatus();
    
    // Login Form Handler
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }

    // Add Employee Form Handler (Admin only)
    const addEmployeeForm = document.getElementById('add-employee-form');
    if (addEmployeeForm) {
        addEmployeeForm.addEventListener('submit', handleAddEmployee);
    }

    // Log Work Form Handler (Employee only)
    const logWorkForm = document.getElementById('log-work-form');
    if (logWorkForm) {
        // Set default date to today
        const dateInput = document.getElementById('log-date');
        if (dateInput) dateInput.valueAsDate = new Date();

        logWorkForm.addEventListener('submit', handleLogWork);
    }
});

// --- Authentication & Session Management ---

function checkLoginStatus() {
    const userStr = localStorage.getItem('user');
    if (userStr) {
        currentUser = JSON.parse(userStr);
        showAppView();
    } else {
        showLoginView();
    }
}

async function handleLogin(e) {
    e.preventDefault();
    
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const username = usernameInput.value;
    const password = passwordInput.value;

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();

        if (response.ok) {
            currentUser = {
                id: data.user_id,
                username: data.username,
                role: data.role,
                employee_id: data.employee_id
            };
            localStorage.setItem('user', JSON.stringify(currentUser));
            
            // Clear password field
            passwordInput.value = '';
            
            showAppView();
        } else {
            alert(data.error || 'Login failed');
        }
    } catch (error) {
        console.error('Login error:', error);
        alert('An error occurred during login');
    }
}

function logout() {
    localStorage.removeItem('user');
    currentUser = null;
    showLoginView();
}

function showLoginView() {
    document.getElementById('login-view').classList.remove('hidden');
    document.getElementById('app-view').classList.add('hidden');
    document.getElementById('admin-view').classList.add('hidden');
    document.getElementById('employee-view').classList.add('hidden');
}

function showAppView() {
    document.getElementById('login-view').classList.add('hidden');
    document.getElementById('app-view').classList.remove('hidden');
    
    // Update User Display
    const userDisplay = document.getElementById('user-display');
    if (userDisplay) {
        userDisplay.textContent = `Logged in as: ${currentUser.username} (${currentUser.role})`;
    }

    // Role-based View Rendering
    if (currentUser.role === 'admin') {
        document.getElementById('admin-view').classList.remove('hidden');
        document.getElementById('employee-view').classList.add('hidden');
        loadAdminData();
    } else {
        document.getElementById('admin-view').classList.add('hidden');
        document.getElementById('employee-view').classList.remove('hidden');
        setupEmployeeView();
        loadShiftRequests(); // Load swaps
    }
}

// --- Admin Functions ---

async function loadEmployees() {
    try {
        const response = await fetch('/api/employees');
        const employees = await response.json();
        
        const tbody = document.querySelector('#employee-table tbody');
        if (!tbody) return;

        tbody.innerHTML = '';
        employees.forEach(emp => {
            const tr = document.createElement('tr');
            // Show hint for credentials
            const credentialHint = emp.role === 'admin' 
                ? 'admin/admin123' 
                : `${emp.name.split(' ')[0].toLowerCase()}/password123`;
                
            tr.innerHTML = `
                <td>${emp.id}</td>
                <td>${emp.name}</td>
                <td>${emp.role}</td>
                <td>${emp.email || '-'}</td>
                <td>${emp.phone || '-'}</td>
                <td style="color: #666; font-size: 0.9em;">${credentialHint}</td>
                <td>
                    <button class="delete-btn" onclick="deleteEmployee(${emp.id})">Delete</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (error) {
        console.error('Error loading employees:', error);
    }
}

async function handleAddEmployee(e) {
    e.preventDefault();
    const name = document.getElementById('name').value;
    const role = document.getElementById('role').value;
    const email = document.getElementById('email').value;
    const phone = document.getElementById('phone').value;

    try {
        const response = await fetch('/api/employees', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, role, email, phone })
        });
        
        if (response.ok) {
            alert('Employee added successfully!');
            document.getElementById('add-employee-form').reset();
            loadEmployees();
        } else {
            alert('Failed to add employee');
        }
    } catch (error) {
        console.error('Error adding employee:', error);
    }
}

async function deleteEmployee(id) {
    if (!confirm('Are you sure? This will delete the employee and their user account.')) return;
    
    try {
        const response = await fetch(`/api/employees/${id}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            loadEmployees();
        } else {
            alert('Failed to delete employee');
        }
    } catch (error) {
        console.error('Error deleting employee:', error);
    }
}

function loadAdminData() {
    loadEmployees();
    // Tab 1 is now static/manual interactions
    loadWorkLogsPayroll();    // Tab 2: Weekly Payroll
    loadDashboardStats();
}

function switchAdminTab(tab) {
    const logsView = document.getElementById('view-logs');
    const payrollView = document.getElementById('view-payroll');
    const btnLogs = document.getElementById('tab-logs');
    const btnPayroll = document.getElementById('tab-payroll');

    if (tab === 'logs') {
        logsView.classList.remove('hidden');
        payrollView.classList.add('hidden');
        btnLogs.classList.add('active');
        btnPayroll.classList.remove('active');
    } else {
        logsView.classList.add('hidden');
        payrollView.classList.remove('hidden');
        btnLogs.classList.remove('active');
        btnPayroll.classList.add('active');
        loadWorkLogsPayroll();
    }
}

// --- Tab 1: Work Logs & Notes (Communication) ---

function sendCustomWhatsApp() {
    const msgInput = document.getElementById('custom-whatsapp-msg');
    const msg = msgInput.value.trim();
    
    if (!msg) {
        alert('Please enter a message first.');
        return;
    }
    
    const text = encodeURIComponent(msg);
    window.open(`https://wa.me/?text=${text}`, '_blank');
}

// --- Tab 2: Payroll (Weekly Grouped) ---
async function loadWorkLogsPayroll() {
    try {
        const response = await fetch('/api/work-logs');
        const logs = await response.json();
        
        const tbody = document.querySelector('#logs-table tbody');
        if (!tbody) return;

        tbody.innerHTML = '';
        
        // Group logs by Employee and Week
        const groupedLogs = {};
        
        logs.forEach(log => {
            const date = new Date(log.date);
            const monday = getMonday(date);
            const weekStr = monday.toISOString().split('T')[0];
            const key = `${log.employee_id}-${weekStr}`;
            
            if (!groupedLogs[key]) {
                groupedLogs[key] = {
                    employee_id: log.employee_id,
                    employee_name: log.employee_name,
                    week_start: weekStr,
                    total_hours: 0,
                    unpaid_cost: 0,
                    total_cost: 0,
                    unpaid_ids: [],
                    is_fully_paid: true
                };
            }
            
            groupedLogs[key].total_hours += log.hours;
            groupedLogs[key].total_cost += (log.hours * 20);
            
            if (!log.is_paid) {
                groupedLogs[key].is_fully_paid = false;
                groupedLogs[key].unpaid_ids.push(log.id);
                groupedLogs[key].unpaid_cost += (log.hours * 20);
            }
        });

        // Render Grouped Logs
        Object.values(groupedLogs).sort((a, b) => b.week_start.localeCompare(a.week_start)).forEach(group => {
            const tr = document.createElement('tr');
            
            const statusClass = group.is_fully_paid ? 'status-paid' : 'status-unpaid';
            const statusText = group.is_fully_paid ? 'Paid' : 'Unpaid / Partial';
            
            let actionBtn = '';
            if (group.is_fully_paid) {
                 actionBtn = `<span style="color: green;">✓ All Paid</span>`;
            } else {
                 actionBtn = `<button class="pay-btn" onclick='payWeek(${JSON.stringify(group.unpaid_ids)})'>Mark Week Paid ($${group.unpaid_cost.toFixed(2)})</button>`;
            }

            // Format week range
            const start = new Date(group.week_start);
            const end = new Date(start);
            end.setDate(end.getDate() + 6);
            const dateRange = `${start.toLocaleDateString()} - ${end.toLocaleDateString()}`;

            tr.innerHTML = `
                <td>${dateRange}</td>
                <td>${group.employee_name}</td>
                <td>${group.total_hours} hrs</td>
                <td>$${group.total_cost.toFixed(2)}</td>
                <td class="${statusClass}">${statusText}</td>
                <td>${actionBtn}</td>
            `;
            tbody.appendChild(tr);
        });
        
    } catch (error) {
        console.error('Error loading logs:', error);
    }
}

function getMonday(d) {
  d = new Date(d);
  const day = d.getDay();
  const diff = d.getDate() - day + (day == 0 ? -6 : 1); // adjust when day is sunday
  return new Date(d.setDate(diff));
}

async function payWeek(logIds) {
    if (!logIds || logIds.length === 0) return;
    if (!confirm(`Mark ${logIds.length} logs as paid?`)) return;
    
    try {
        const response = await fetch('/api/work-logs/batch-pay', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ log_ids: logIds })
        });
        
        const result = await response.json();

        if (response.ok) {
            loadWorkLogsPayroll(); // Refresh current tab
            loadDashboardStats();
            
            // Send WhatsApp Notification (Client-side redirection for Group)
            if (result.whatsapp_group_message) {
                const text = encodeURIComponent(result.whatsapp_group_message);
                // Open WhatsApp Group with pre-filled text
                // Note: The user selects the group in WhatsApp
                window.open(`https://wa.me/?text=${text}`, '_blank');
            }
            
            // Alert user about success
            alert(`Payment recorded for: ${result.employees.join(', ')}`);
        } else {
            alert('Failed to update payment status');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('An error occurred');
    }
}

// Deprecated single toggle (kept for compatibility if needed, but UI uses batch now)
async function togglePaid(id) {
    try {
        const response = await fetch(`/api/work-logs/${id}/toggle-paid`, {
            method: 'POST'
        });

        if (response.ok) {
            loadWorkLogs();
            loadDashboardStats();
        } else {
            alert('Failed to update payment status');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('An error occurred');
    }
}

let paymentChart = null;

async function loadDashboardStats() {
    try {
        const response = await fetch('/api/dashboard/stats');
        const stats = await response.json();
        
        document.getElementById('stat-payroll').textContent = `$${stats.payroll_cost_unpaid.toFixed(2)}`;
        document.getElementById('stat-hours').textContent = stats.hours_this_week;
        document.getElementById('stat-top').textContent = stats.top_employee ? `${stats.top_employee.name} (${stats.top_employee.hours}h)` : '-';

        renderChart(stats.paid_count, stats.unpaid_count);
    } catch (error) {
        console.error('Error loading stats:', error);
    }
}

function renderChart(paid, unpaid) {
    const ctx = document.getElementById('paymentChart').getContext('2d');
    
    if (paymentChart) {
        paymentChart.destroy();
    }

    paymentChart = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: ['Paid', 'Unpaid'],
            datasets: [{
                data: [paid, unpaid],
                backgroundColor: ['#28a745', '#dc3545'],
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false
        }
    });
}

// --- Employee Functions ---

function switchEmployeeTab(tab) {
    const logView = document.getElementById('view-emp-log');
    const swapView = document.getElementById('view-emp-swap');
    const btnLog = document.getElementById('tab-emp-log');
    const btnSwap = document.getElementById('tab-emp-swap');

    if (tab === 'log') {
        logView.classList.remove('hidden');
        swapView.classList.add('hidden');
        btnLog.classList.add('active');
        btnSwap.classList.remove('active');
    } else {
        logView.classList.add('hidden');
        swapView.classList.remove('hidden');
        btnLog.classList.remove('active');
        btnSwap.classList.add('active');
        loadShiftRequests();
    }
}

async function loadShiftRequests() {
    try {
        const response = await fetch('/api/shift-requests');
        const requests = await response.json();
        
        const tbody = document.querySelector('#swap-table tbody');
        if (!tbody) return;

        tbody.innerHTML = '';
        if (requests.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;">No shifts available</td></tr>';
            return;
        }

        requests.forEach(req => {
            const tr = document.createElement('tr');
            
            // Don't let user pick up their own shift
            const isOwn = req.requester_id === currentUser.employee_id;
            const actionBtn = isOwn 
                ? '<span style="color: #666;">(Your Request)</span>' 
                : `<button onclick="takeShift(${req.id}, '${req.date}', '${req.requester_name}')" style="background-color: #28a745;">Take Shift</button>`;
            
            tr.innerHTML = `
                <td>${req.date}</td>
                <td>${req.requester_name}</td>
                <td>${actionBtn}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (error) {
        console.error('Error loading shifts:', error);
    }
}

async function postShiftRequest() {
    const dateInput = document.getElementById('swap-date');
    const date = dateInput.value;
    
    if (!date) {
        alert('Please select a date');
        return;
    }
    
    try {
        const response = await fetch('/api/shift-requests', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                requester_id: currentUser.employee_id,
                date: date
            })
        });
        
        if (response.ok) {
            alert('Shift request posted!');
            dateInput.value = '';
            loadShiftRequests();
            
            // Optional: Prompt to notify group
            const text = encodeURIComponent(`Team, I need cover for my shift on ${date}. Please pick it up in the app.`);
            if (confirm("Request posted! Notify the team on WhatsApp?")) {
                window.open(`https://wa.me/?text=${text}`, '_blank');
            }
        } else {
            alert('Failed to post request');
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

async function takeShift(id, date, requesterName) {
    if (!confirm(`Confirm you want to take ${requesterName}'s shift on ${date}? This will automatically log work for you.`)) return;
    
    try {
        const response = await fetch(`/api/shift-requests/${id}/take`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taker_id: currentUser.employee_id })
        });
        
        if (response.ok) {
            const data = await response.json();
            alert('Shift taken! A work log has been created for you.');
            
            // Client-side WhatsApp Redirection
            if (data.whatsapp_message) {
                const text = encodeURIComponent(data.whatsapp_message);
                // Open WhatsApp with pre-filled text (User selects the group)
                window.open(`https://wa.me/?text=${text}`, '_blank');
            }
            
            loadShiftRequests();
        } else {
            const data = await response.json();
            alert(data.error || 'Failed to take shift');
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

function setupEmployeeView() {
    // Pre-fill employee info in the log form
    const idInput = document.getElementById('log-employee-id');
    const nameInput = document.getElementById('log-employee-name');
    
    if (idInput && currentUser.employee_id) {
        idInput.value = currentUser.employee_id;
    }
    
    if (nameInput) {
        nameInput.value = currentUser.username; // Or name if available in user object
    }
}

async function handleLogWork(e) {
    e.preventDefault();
    
    const employeeId = document.getElementById('log-employee-id').value;
    const date = document.getElementById('log-date').value;
    const hours = document.getElementById('log-hours').value;
    
    if (!employeeId) {
        alert('Error: Employee ID not found. Please relogin.');
        return;
    }

    const log = { employee_id: employeeId, date, hours };

    try {
        const response = await fetch('/api/work-logs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(log)
        });

        if (response.ok) {
            alert('Work logged successfully!');
            document.getElementById('log-work-form').reset();
            
            // Reset defaults
            document.getElementById('log-date').valueAsDate = new Date();
            document.getElementById('log-hours').value = 7;
            
            // Re-fill employee info after reset
            setupEmployeeView();
        } else {
            alert('Failed to log work');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('An error occurred');
    }
}
