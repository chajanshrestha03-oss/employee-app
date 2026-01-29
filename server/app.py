from flask import Flask, render_template, request, jsonify
import sqlite3
import datetime
import threading
import time
import os

# Try importing pywhatkit, but don't crash if it fails (common in server environments)
try:
    import pywhatkit
    HAS_PYWHATKIT = True
except (ImportError, Exception):
    HAS_PYWHATKIT = False
    print("Warning: pywhatkit could not be imported. WhatsApp automation disabled.")

app = Flask(__name__)
DB_NAME = "database.db"
# NOTE: pywhatkit usually requires the Group Invite Link ID (e.g., 'AbC123...'), not the name.
# 'Namaste Momo Lunch Menu Group' is likely the name. If automation fails, replace this with the Invite Link ID.
GROUP_ID = "Namaste Momo Lunch Menu Group" 

def init_db():
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS employees (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            role TEXT NOT NULL,
            email TEXT,
            phone TEXT
        )
    ''')
    
    # Migration: Add phone column if it doesn't exist
    try:
        cursor.execute("ALTER TABLE employees ADD COLUMN phone TEXT")
    except sqlite3.OperationalError:
        pass # Column likely exists
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS work_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            employee_id INTEGER NOT NULL,
            date TEXT NOT NULL,
            hours REAL NOT NULL,
            is_paid BOOLEAN DEFAULT 0,
            notes TEXT,
            FOREIGN KEY (employee_id) REFERENCES employees (id)
        )
    ''')
    
    # Migration: Add notes column if it doesn't exist
    try:
        cursor.execute("ALTER TABLE work_logs ADD COLUMN notes TEXT")
    except sqlite3.OperationalError:
        pass # Column likely exists

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password TEXT NOT NULL,
            role TEXT NOT NULL,
            employee_id INTEGER,
            FOREIGN KEY (employee_id) REFERENCES employees (id)
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS shift_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            requester_id INTEGER NOT NULL,
            date TEXT NOT NULL,
            taker_id INTEGER,
            status TEXT DEFAULT 'open', -- 'open', 'taken'
            FOREIGN KEY (requester_id) REFERENCES employees (id),
            FOREIGN KEY (taker_id) REFERENCES employees (id)
        )
    ''')
    
    # Check if admin exists
    cursor.execute("SELECT * FROM users WHERE username = 'admin'")
    if not cursor.fetchone():
        cursor.execute("INSERT INTO users (username, password, role) VALUES (?, ?, ?)", 
                       ('admin', 'admin123', 'admin'))
        print("Default admin user created: admin/admin123")
        
    conn.commit()
    conn.close()

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/login', methods=['POST'])
def login():
    data = request.json
    username = data.get('username')
    password = data.get('password')
    
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE username = ? AND password = ?", (username, password))
    user = cursor.fetchone()
    conn.close()
    
    if user:
        return jsonify({
            "success": True, 
            "role": user['role'], 
            "username": user['username'],
            "employee_id": user['employee_id']
        })
    else:
        return jsonify({"success": False, "message": "Invalid credentials"}), 401

@app.route('/api/employees', methods=['GET'])
def get_employees():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM employees")
    rows = cursor.fetchall()
    employees = [dict(row) for row in rows]
    conn.close()
    return jsonify(employees)

@app.route('/api/employees', methods=['POST'])
def add_employee():
    data = request.json
    name = data.get('name')
    role = data.get('role')
    email = data.get('email')
    phone = data.get('phone')
    
    if not name or not role:
        return jsonify({"error": "Name and Role are required"}), 400
    
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute("INSERT INTO employees (name, role, email, phone) VALUES (?, ?, ?, ?)", (name, role, email, phone))
    new_id = cursor.lastrowid
    
    # Create User Account for Employee
    # Username: First name lowercase, Password: 'password123'
    username = name.split()[0].lower()
    # Handle duplicate usernames by appending id (simple approach)
    try:
        cursor.execute("INSERT INTO users (username, password, role, employee_id) VALUES (?, ?, ?, ?)", 
                       (username, 'password123', 'employee', new_id))
    except sqlite3.IntegrityError:
        # Fallback if username exists
        username = f"{username}{new_id}"
        cursor.execute("INSERT INTO users (username, password, role, employee_id) VALUES (?, ?, ?, ?)", 
                       (username, 'password123', 'employee', new_id))
    
    conn.commit()
    conn.close()
    
    return jsonify({
        "id": new_id, 
        "name": name, 
        "role": role, 
        "email": email,
        "phone": phone,
        "user_created": {
            "username": username,
            "password": "password123"
        }
    }), 201

# --- WhatsApp Automation ---

def send_whatsapp_thread(phone_number, message):
    if not HAS_PYWHATKIT:
        print(f"Skipping WhatsApp to {phone_number}: pywhatkit not available")
        return

    try:
        pywhatkit.sendwhatmsg_instantly(
            phone_no=phone_number, 
            message=message, 
            wait_time=15, 
            tab_close=True, 
            close_time=3
        )
        print(f"WhatsApp sent to {phone_number}")
    except Exception as e:
        print(f"Error sending WhatsApp: {e}")

def send_whatsapp_group_thread(group_id, message):
    if not HAS_PYWHATKIT:
        print(f"Skipping Group WhatsApp to {group_id}: pywhatkit not available")
        return

    try:
        pywhatkit.sendwhatmsg_to_group_instantly(
            group_id=group_id,
            message=message,
            wait_time=15,
            tab_close=True,
            close_time=3
        )
        print(f"WhatsApp group message sent to {group_id}")
    except Exception as e:
        print(f"Error sending WhatsApp group message: {e}")

@app.route('/api/send-whatsapp', methods=['POST'])
def send_whatsapp():
    data = request.json
    phone = data.get('phone')
    message = data.get('message')
    
    if not phone or not message:
        return jsonify({"error": "Phone and Message required"}), 400
        
    # Run in separate thread to not block response
    threading.Thread(target=send_whatsapp_thread, args=(phone, message)).start()
    
    return jsonify({"message": "WhatsApp sending initiated (browser will open)"}), 200

@app.route('/api/employees/<int:id>', methods=['DELETE'])
def delete_employee(id):
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM employees WHERE id = ?", (id,))
    cursor.execute("DELETE FROM users WHERE employee_id = ?", (id,))
    # Also delete work logs? For now, keep them or cascade manually if needed.
    conn.commit()
    conn.close()
    return jsonify({"message": "Employee deleted"}), 200

# --- Shift Swapping API ---

@app.route('/api/shift-requests', methods=['GET'])
def get_shift_requests():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    # Get all open requests, join with employee names
    cursor.execute('''
        SELECT s.*, e.name as requester_name 
        FROM shift_requests s 
        JOIN employees e ON s.requester_id = e.id 
        WHERE s.status = 'open' 
        ORDER BY s.date ASC
    ''')
    rows = cursor.fetchall()
    requests = [dict(row) for row in rows]
    conn.close()
    return jsonify(requests)

@app.route('/api/shift-requests', methods=['POST'])
def create_shift_request():
    data = request.json
    requester_id = data.get('requester_id')
    date = data.get('date')
    
    if not requester_id or not date:
        return jsonify({"error": "Requester and Date required"}), 400
        
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute("INSERT INTO shift_requests (requester_id, date) VALUES (?, ?)", (requester_id, date))
    conn.commit()
    new_id = cursor.lastrowid
    conn.close()
    
    return jsonify({"id": new_id, "message": "Shift request posted"}), 201

@app.route('/api/shift-requests/<int:id>/take', methods=['POST'])
def take_shift_request(id):
    data = request.json
    taker_id = data.get('taker_id')
    
    if not taker_id:
        return jsonify({"error": "Taker ID required"}), 400
        
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    
    # 1. Check if still open
    cursor.execute("SELECT * FROM shift_requests WHERE id = ? AND status = 'open'", (id,))
    shift = cursor.fetchone()
    if not shift:
        conn.close()
        return jsonify({"error": "Shift already taken or not found"}), 400
        
    date = shift[2] # Index 2 is date
    
    # 2. Update Request
    cursor.execute("UPDATE shift_requests SET status = 'taken', taker_id = ? WHERE id = ?", (taker_id, id))
    
    # 3. Auto-create Work Log for Taker
    # Assuming standard 7 hours
    cursor.execute("INSERT INTO work_logs (employee_id, date, hours) VALUES (?, ?, ?)", (taker_id, date, 7))
    
    # Get Taker Name
    cursor.execute("SELECT name, phone FROM employees WHERE id = ?", (taker_id,))
    taker_data = cursor.fetchone()
    taker_name = taker_data[0]
    taker_phone = taker_data[1]
    
    conn.commit()
    conn.close()
    
    # Send WhatsApp Notification
    # Message: "chajan has taken the shift include date as well" -> "Chajan has taken the shift for 2025-02-05"
    msg = f"{taker_name} has taken the shift for {date}"
    
    if GROUP_ID:
        # Use the safe wrapper function
        threading.Thread(target=send_whatsapp_group_thread, args=(GROUP_ID, msg)).start()
    elif taker_phone:
         threading.Thread(target=send_whatsapp_thread, args=(taker_phone, msg)).start()
    
    return jsonify({
        "message": "Shift taken successfully! Work log created.",
        "whatsapp_message": msg
    }), 200

# --- Work Logs & Dashboard API ---

@app.route('/api/work-logs', methods=['GET'])
def get_work_logs():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    # Join with employees to get names
    cursor.execute('''
        SELECT w.*, e.name as employee_name 
        FROM work_logs w 
        JOIN employees e ON w.employee_id = e.id 
        ORDER BY w.date DESC
    ''')
    rows = cursor.fetchall()
    logs = [dict(row) for row in rows]
    conn.close()
    return jsonify(logs)

@app.route('/api/work-logs', methods=['POST'])
def add_work_log():
    data = request.json
    employee_id = data.get('employee_id')
    date = data.get('date')
    hours = data.get('hours', 7) # Default to 7 hours
    
    if not employee_id or not date:
        return jsonify({"error": "Employee and Date are required"}), 400
        
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute("INSERT INTO work_logs (employee_id, date, hours) VALUES (?, ?, ?)", (employee_id, date, hours))
    conn.commit()
    new_id = cursor.lastrowid
    conn.close()
    return jsonify({"id": new_id, "message": "Work log added"}), 201

@app.route('/api/work-logs/<int:id>/toggle-paid', methods=['POST'])
def toggle_paid(id):
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    # Get current status
    cursor.execute("SELECT is_paid FROM work_logs WHERE id = ?", (id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "Log not found"}), 404
    
    new_status = not row[0]
    cursor.execute("UPDATE work_logs SET is_paid = ? WHERE id = ?", (new_status, id))
    conn.commit()
    conn.close()
    
    # Mock Email Notification
    if new_status:
        print(f"Mock Email: Notification sent to employee about payment for Log ID {id}")
        
    return jsonify({"id": id, "is_paid": new_status, "message": "Payment status updated"}), 200

@app.route('/api/work-logs/<int:id>/notes', methods=['POST'])
def update_log_note(id):
    data = request.json
    note = data.get('note')
    
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute("UPDATE work_logs SET notes = ? WHERE id = ?", (note, id))
    conn.commit()
    conn.close()
    
    return jsonify({"message": "Note updated"}), 200

@app.route('/api/work-logs/batch-pay', methods=['POST'])
def batch_pay_logs():
    data = request.json
    log_ids = data.get('log_ids', [])
    
    if not log_ids:
        return jsonify({"error": "No log IDs provided"}), 400
        
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    
    # Get employee names and phones before updating
    placeholders = ','.join('?' * len(log_ids))
    cursor.execute(f'''
        SELECT DISTINCT e.name, e.phone
        FROM work_logs w
        JOIN employees e ON w.employee_id = e.id
        WHERE w.id IN ({placeholders})
    ''', log_ids)
    
    rows = cursor.fetchall()
    employees = [row[0] for row in rows]
    
    # Automate WhatsApp for each employee with a phone number
    for row in rows:
        name = row[0]
        phone = row[1]
        if phone:
            msg = f"{name} your pay is ready to collect"
            # Launch in thread to avoid blocking
            threading.Thread(target=send_whatsapp_thread, args=(phone, msg)).start()
            print(f"Queued WhatsApp for {name} ({phone})")

    # Mark all provided IDs as paid
    sql = f"UPDATE work_logs SET is_paid = 1 WHERE id IN ({placeholders})"
    cursor.execute(sql, log_ids)
    
    rows_affected = cursor.rowcount
    conn.commit()
    conn.close()
    
    return jsonify({
        "message": f"Successfully marked {rows_affected} logs as paid", 
        "count": rows_affected,
        "employees": employees
    }), 200

@app.route('/api/dashboard/stats', methods=['GET'])
def get_dashboard_stats():
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    
    # Total Payroll Cost (Unpaid)
    cursor.execute("SELECT SUM(hours) FROM work_logs WHERE is_paid = 0")
    total_unpaid_hours = cursor.fetchone()[0] or 0
    payroll_cost_unpaid = total_unpaid_hours * 20 # $20/hr
    
    # Total Hours This Week (Simple approach: last 7 days)
    today = datetime.date.today()
    week_ago = today - datetime.timedelta(days=7)
    cursor.execute("SELECT SUM(hours) FROM work_logs WHERE date >= ?", (week_ago.isoformat(),))
    hours_this_week = cursor.fetchone()[0] or 0
    
    # Top Employee (Most hours all time)
    cursor.execute('''
        SELECT e.name, SUM(w.hours) as total_hours 
        FROM work_logs w 
        JOIN employees e ON w.employee_id = e.id 
        GROUP BY w.employee_id 
        ORDER BY total_hours DESC 
        LIMIT 1
    ''')
    top_employee = cursor.fetchone()
    top_employee_data = {"name": top_employee[0], "hours": top_employee[1]} if top_employee else None

    # Paid vs Unpaid Counts
    cursor.execute("SELECT is_paid, COUNT(*) FROM work_logs GROUP BY is_paid")
    rows = cursor.fetchall()
    paid_status = {0: 0, 1: 0} # 0: Unpaid, 1: Paid
    for r in rows:
        paid_status[r[0]] = r[1]

    conn.close()
    
    return jsonify({
        "payroll_cost_unpaid": payroll_cost_unpaid,
        "hours_this_week": hours_this_week,
        "top_employee": top_employee_data,
        "paid_count": paid_status[1],
        "unpaid_count": paid_status[0]
    })

# Initialize DB on module import (ensures tables exist when running with Gunicorn)
init_db()

if __name__ == '__main__':
    # Host 0.0.0.0 allows access from other devices on the network
    app.run(debug=True, host='0.0.0.0', port=5000)
