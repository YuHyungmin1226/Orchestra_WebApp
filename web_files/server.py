from flask import Flask, render_template, jsonify, request, send_file
import io
import os
import database
import pandas as pd
import zipfile
import tempfile
import sys
from werkzeug.security import check_password_hash

# Define the base directory and construct the path to the data directory
base_dir = os.path.abspath(os.path.dirname(__file__))
template_dir = os.path.join(base_dir, 'templates')
# The data directory is one level up from the 'web_files' directory
data_dir = os.path.join(base_dir, '..', 'data')

app = Flask(__name__, template_folder=template_dir, static_folder='static')

@app.route('/api/export_csv')
def export_csv():
    """Export all tables to a zip of CSV files."""
    try:
        table_names = database.get_all_table_names()

        # Keep the zip bytes in memory to avoid temp dir lifecycle issues
        with tempfile.TemporaryDirectory() as temp_dir:
            zip_path = os.path.join(temp_dir, 'orchestra_data.zip')
            with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
                for table_name in table_names:
                    data = database.get_all(table_name)
                    if data:
                        df = pd.DataFrame(data)
                        csv_path = os.path.join(temp_dir, f"{table_name}.csv")
                        df.to_csv(csv_path, index=False, encoding='utf-8-sig')
                        zipf.write(csv_path, arcname=f"{table_name}.csv")

            with open(zip_path, 'rb') as f:
                zip_bytes = f.read()

        return send_file(
            io.BytesIO(zip_bytes),
            as_attachment=True,
            download_name='orchestra_data.zip',
            mimetype='application/zip'
        )

    except Exception as e:
        print(f"Error exporting CSVs: {e}")
        return jsonify({"error": "An error occurred during CSV export."}), 500


@app.route('/api/import_csv', methods=['POST'])
def import_csv():
    """Import data from a zip of CSV files."""
    if 'file' not in request.files:
        return jsonify({"error": "No file part in the request"}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No file selected for uploading"}), 400

    if file and file.filename.endswith('.zip'):
        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                zip_path = os.path.join(temp_dir, file.filename)
                file.save(zip_path)
                
                with zipfile.ZipFile(zip_path, 'r') as zipf:
                    for csv_filename in zipf.namelist():
                        if csv_filename.endswith('.csv'):
                            table_name = os.path.splitext(csv_filename)[0]
                            with zipf.open(csv_filename) as csv_file:
                                df = pd.read_csv(csv_file)
                                database.seed_table_from_df(table_name, df)

            return jsonify({"success": True, "message": "Data imported successfully."})
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        except Exception as e:
            print(f"Error importing CSVs: {e}")
            return jsonify({"error": "An error occurred during CSV import."}), 500
    else:
        return jsonify({"error": "Invalid file type, please upload a .zip file"}), 400
		
@app.route('/')
def index():
    return render_template('index.html')

# --- API Endpoints ---

from werkzeug.security import check_password_hash

@app.route('/api/login', methods=['POST'])
def login():
    """
    Authenticates a user based on username and a hashed password.
    """
    credentials = request.json
    username = credentials.get('username')
    password = credentials.get('password')

    if not all([username, password]):
        return jsonify({"error": "Username and password are required"}), 400

    user = database.get_user_by_username(username)

    if user and check_password_hash(user['password'], password):
        # Login successful
        user_info = {key: val for key, val in user.items() if key != 'password'}
        return jsonify({"success": True, "user": user_info})
    
    # Login failed
    return jsonify({"error": "Invalid username or password"}), 401


@app.route('/api/students')
def get_students():
    students = database.get_all('students')
    if students is not None:
        return jsonify(students)
    return jsonify({"error": "Could not read students data"}), 500

@app.route('/api/sections')
def get_sections():
    sections = database.get_all('sections')
    if sections is not None:
        return jsonify(sections)
    return jsonify({"error": "Could not read sections data"}), 500

@app.route('/api/rehearsals')
def get_rehearsals():
    rehearsals = database.get_all('rehearsals')
    if rehearsals is not None:
        return jsonify(rehearsals)
    return jsonify({"error": "Could not read rehearsals data"}), 500

@app.route('/api/section_students')
def get_section_students():
    section_students = database.get_all('section_students')
    if section_students is not None:
        return jsonify(section_students)
    return jsonify({"error": "Could not read section-student mapping data"}), 500

@app.route('/api/attendance', methods=['GET', 'POST'])
def handle_attendance():
    if request.method == 'POST':
        return save_attendance()
    else: # GET request
        attendance_records = database.get_all('attendance')
        if attendance_records is not None:
            return jsonify(attendance_records)
        return jsonify({"error": "Could not read attendance data"}), 500


def save_attendance():
    payload = request.json
    new_attendance_records = payload.get('records')
    marked_by = payload.get('marked_by', 'Unknown')

    if not new_attendance_records:
        return jsonify({"error": "No records provided"}), 400

    try:
        num_saved, new_version = database.add_attendance_records(new_attendance_records, marked_by)
        return jsonify({"success": True, "message": f"Successfully saved {num_saved} records (version {new_version})."})
    except Exception as e:
        print(f"Error saving attendance: {e}")
        return jsonify({"error": "An error occurred while saving data."}), 500


@app.route('/api/update_data', methods=['POST'])
def update_data():
    """
    Updates a single row in a specified table using the database.
    """
    payload = request.json
    filename = payload.get('filename')
    pk_col = payload.get('primary_key_col')
    record = payload.get('record')

    if not all([filename, pk_col, record]):
        return jsonify({"error": "Missing required payload data"}), 400
    
    table_name = os.path.splitext(filename)[0]
    pk_val = record.get(pk_col)

    try:
        if database.update_record(table_name, pk_col, pk_val, record):
            return jsonify({"success": True, "message": f"Successfully updated record in {table_name}"})
        else:
            return jsonify({"error": "Record to update not found or data unchanged"}), 404
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        print(f"Error updating data in {table_name}: {e}")
        return jsonify({"error": "An error occurred while updating data."}), 500


@app.route('/api/delete_data', methods=['POST'])
def delete_data():
    """
    Deletes a single row in a specified table using the database.
    """
    payload = request.json
    filename = payload.get('filename')
    pk_col = payload.get('primary_key_col')
    pk_val = payload.get('primary_key_val')

    if not all([filename, pk_col, pk_val]):
        return jsonify({"error": "Missing required payload data"}), 400
    
    table_name = os.path.splitext(filename)[0]

    try:
        if database.delete_by_id(table_name, pk_col, pk_val):
            return jsonify({"success": True, "message": f"Successfully deleted record from {table_name}"})
        else:
            return jsonify({"error": "Record to delete not found"}), 404
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        print(f"Error deleting data from {table_name}: {e}")
        return jsonify({"error": "An error occurred while deleting data."}), 500


@app.route('/api/add_data', methods=['POST'])
def add_data():
    payload = request.json
    filename = payload.get('filename')
    record_from_frontend = payload.get('record')

    if not all([filename, record_from_frontend]):
        return jsonify({"error": "Missing required payload data"}), 400

    table_name = os.path.splitext(filename)[0]
    
    try:
        if table_name == 'students':
            # Use the specific transactional function for adding students
            section_id_to_map = record_from_frontend.get('section_id')
            student_columns = ['name', 'contact', 'join_date', 'status']
            new_student_record = {col: record_from_frontend.get(col) for col in student_columns}
            
            new_id = database.add_student_with_section(new_student_record, section_id_to_map)
            pk_col = 'student_id'

        else:
            # For other tables, use the generic add_record
            expected_columns = {
                'sections': ['section_name'],
                'rehearsals': ['date', 'location', 'description']
            }
            cols_to_keep = expected_columns.get(table_name)
            if not cols_to_keep:
                return jsonify({"error": "Invalid filename for add operation"}), 400
            
            new_record = {col: record_from_frontend.get(col) for col in cols_to_keep}
            new_id = database.add_record(table_name, new_record)
            pk_col = table_name[:-1] + '_id'

        if not new_id:
            raise Exception("Failed to get new ID from database.")

        # Get the full new record from the DB to return to the frontend
        full_new_record = database.get_by_id(table_name, pk_col, new_id)

        return jsonify({"success": True, "message": f"Successfully added record to {table_name}", "new_record": full_new_record})
    
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        print(f"Error adding data to {table_name}: {e}")
        return jsonify({"error": "An error occurred while adding data."}), 500


def main():
    """
    Main function to run the Flask application.
    This is called when no special command-line arguments are provided.
    """
    host = os.getenv('APP_HOST', '127.0.0.1')
    try:
        port = int(os.getenv('APP_PORT', '8000'))
    except ValueError:
        port = 8000
    app.run(host=host, port=port, debug=True)


if __name__ == '__main__':
    # Check for special command-line arguments
    if len(sys.argv) > 1 and sys.argv[1] == 'init-db':
        # This is the command to initialize the database
        print("Database initialization requested.")
        database.db_init()
        print("Exiting after database initialization.")
        sys.exit(0)
    
    # If no special command, run the web server
    main()
