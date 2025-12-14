
import sqlite3
import os
import pandas as pd

# --- Database Setup ---
DATABASE_DIR = os.path.join(os.path.dirname(__file__), '..', 'data')
DATABASE_PATH = os.path.join(DATABASE_DIR, 'orchestra.db')

def get_db_connection():
    """Create a database connection."""
    os.makedirs(DATABASE_DIR, exist_ok=True)
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def get_csv_files():
    """Get paths of all CSV files in the data directory."""
    data_dir = os.path.join(os.path.dirname(__file__), '..', 'data')
    return [os.path.join(data_dir, f) for f in os.listdir(data_dir) if f.endswith('.csv')]

# --- Security Whitelists ---
VALID_TABLE_NAMES = set()
VALID_COLUMN_NAMES = set()

def _populate_whitelists():
    """Read CSV headers to populate the table and column name whitelists."""
    global VALID_TABLE_NAMES, VALID_COLUMN_NAMES
    VALID_TABLE_NAMES.clear()
    VALID_COLUMN_NAMES.clear()

    for csv_file in get_csv_files():
        table_name = os.path.splitext(os.path.basename(csv_file))[0]
        VALID_TABLE_NAMES.add(table_name)
        try:
            df = pd.read_csv(csv_file, nrows=0)
            VALID_COLUMN_NAMES.update(df.columns.tolist())
        except Exception as e:
            print(f"Warning: Could not read headers from {csv_file} for whitelist: {e}")

def is_valid_table(table_name):
    """Check if a table name is in the whitelist."""
    return table_name in VALID_TABLE_NAMES

def is_valid_column(column_name):
    """Check if a column name is in the whitelist."""
    return column_name in VALID_COLUMN_NAMES

# Populate on import
_populate_whitelists()

def create_tables():
    """Create database tables based on CSV file headers."""
    csv_files = get_csv_files()
    if not csv_files:
        print("No CSV files found to create tables.")
        return

    with get_db_connection() as conn:
        cursor = conn.cursor()
        for csv_file in csv_files:
            try:
                table_name = os.path.splitext(os.path.basename(csv_file))[0]
                # Drop existing table to ensure schema (PK) is reapplied
                cursor.execute(f'DROP TABLE IF EXISTS "{table_name}"')
                df = pd.read_csv(csv_file, nrows=0)  # Read only the header
                
                # Basic data type inference
                column_types = []
                for col in df.columns:
                    # Sanitize column name for SQL
                    safe_col = f'"{col}"'
                    col_type = "TEXT"  # Default to TEXT
                    if any(id_keyword in col.lower() for id_keyword in ['id', 'number', 'count']):
                         col_type = "INTEGER"
                    elif 'date' in col.lower():
                        col_type = "TEXT" # Store dates as ISO8601 strings
                    
                    column_types.append(f"{safe_col} {col_type}")

                # Set first column as primary key
                pk_column = f'"{df.columns[0]}"'
                column_definitions = ", ".join(column_types)
                
                # Add PRIMARY KEY constraint to the first column
                # Skip mapping tables that shouldn't have a single-column PK
                if table_name not in ['section_students', 'section_instructors']:
                    column_definitions = column_definitions.replace(f'{pk_column} INTEGER', f'{pk_column} INTEGER PRIMARY KEY')

                create_table_sql = f"CREATE TABLE IF NOT EXISTS {table_name} ({column_definitions});"

                print(f"Executing: {create_table_sql}")
                cursor.execute(create_table_sql)
            except Exception as e:
                print(f"Error creating table for {csv_file}: {e}")
        conn.commit()

def db_init():
    """Initialize the database: create tables and seed data."""
    print("Initializing database...")
    create_tables()
    seed_from_csv()
    print("Database initialized.")

from werkzeug.security import generate_password_hash

def seed_from_csv():
    """Seed the database with data from CSV files."""
    csv_files = get_csv_files()
    if not csv_files:
        print("No CSV files found for seeding.")
        return

    with get_db_connection() as conn:
        cursor = conn.cursor()
        for csv_file in csv_files:
            try:
                table_name = os.path.splitext(os.path.basename(csv_file))[0]
                df = pd.read_csv(csv_file)

                # --- Password Hashing ---
                # If we are processing the users table, hash the passwords
                if table_name == 'users' and 'password' in df.columns:
                    print("Hashing passwords for 'users' table...")
                    # Note: Using 'pbkdf2:sha256' is a good default.
                    df['password'] = df['password'].apply(lambda plain_password: generate_password_hash(str(plain_password)))
                # --- End of Hashing ---

                # Preserve schema/PK by truncating then appending
                cursor.execute(f'DELETE FROM "{table_name}"')
                df.to_sql(table_name, conn, if_exists='append', index=False)
                # Reset AUTOINCREMENT sequence to max(rowid) to avoid NULL PKs
                try:
                    cursor.execute(f'SELECT MAX(rowid) FROM "{table_name}"')
                    max_rowid = cursor.fetchone()[0] or 0
                    cursor.execute('DELETE FROM sqlite_sequence WHERE name=?', (table_name,))
                    cursor.execute('INSERT INTO sqlite_sequence(name, seq) VALUES(?, ?)', (table_name, max_rowid))
                except sqlite3.Error:
                    # sqlite_sequence exists only for AUTOINCREMENT tables; ignore otherwise
                    pass
                print(f"Successfully seeded {table_name} from {csv_file}")
            except Exception as e:
                print(f"Error seeding table for {csv_file}: {e}")
    _populate_whitelists()

def get_all(table_name):
    """Fetch all records from a given table."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(f"SELECT * FROM {table_name}")
        return [dict(row) for row in cursor.fetchall()]

def get_by_id(table_name, pk_col, pk_val):
    """Fetch a single record by its primary key."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(f'SELECT * FROM {table_name} WHERE "{pk_col}" = ?', (pk_val,))
        row = cursor.fetchone()
        return dict(row) if row else None

def delete_by_id(table_name, pk_col, pk_val):
    """Delete a record from a table by its primary key."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(f'DELETE FROM {table_name} WHERE "{pk_col}" = ?', (pk_val,))
        conn.commit()
        return cursor.rowcount > 0 # Return True if a row was deleted

def update_record(table_name, pk_col, pk_val, record):
    """Update a record in a table."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        
        # Prepare the SET part of the SQL query
        set_clause = ", ".join([f'"{k}" = ?' for k in record.keys() if k != pk_col])
        values = [v for k, v in record.items() if k != pk_col]
        
        # It's possible the pk_val is not in the record dict, so handle that
        if pk_col in record and record[pk_col] != pk_val:
             print(f"Warning: pk_val in record dict ('{record[pk_col]}') differs from pk_val argument ('{pk_val}'). Using argument.")

        values.append(pk_val)

        sql = f'UPDATE {table_name} SET {set_clause} WHERE "{pk_col}" = ?'
        
        cursor.execute(sql, tuple(values))
        conn.commit()
        return cursor.rowcount > 0

def add_record(table_name, record):
    """Add a new record to a table and return the new primary key."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        
        columns = ', '.join([f'"{k}"' for k in record.keys()])
        placeholders = ', '.join(['?' for _ in record.values()])
        values = tuple(record.values())

        sql = f"INSERT INTO {table_name} ({columns}) VALUES ({placeholders})"
        
        cursor.execute(sql, values)
        conn.commit()
        return cursor.lastrowid

def add_attendance_records(records, marked_by):
    """Save a batch of attendance records in a single transaction."""
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Start a transaction
        cursor.execute("BEGIN TRANSACTION")

        try:
            # Create lookup maps for efficiency
            students = {s['student_id']: s['name'] for s in get_all('students')}
            rehearsals = {r['rehearsal_id']: r['date'] for r in get_all('rehearsals')}

            # Determine the save_version for this batch of records
            current_rehearsal_id = records[0].get('rehearsal_id')
            cursor.execute("SELECT MAX(save_version) FROM attendance WHERE rehearsal_id = ?", (current_rehearsal_id,))
            max_version_row = cursor.fetchone()
            max_version = int(max_version_row[0]) if max_version_row and max_version_row[0] is not None else 0
            new_version = max_version + 1

            for record in records:
                full_record = {
                    'rehearsal_id': record.get('rehearsal_id'),
                    'rehearsal_date': rehearsals.get(int(record.get('rehearsal_id')), ''),
                    'student_id': record.get('student_id'),
                    'student_name': students.get(int(record.get('student_id')), ''),
                    'status': record.get('status'),
                    'memo': record.get('memo', ''),
                    'marked_by': marked_by,
                    'save_version': new_version
                }
                
                columns = ', '.join([f'"{k}"' for k in full_record.keys()])
                placeholders = ', '.join(['?' for _ in full_record.values()])
                values = tuple(full_record.values())
                sql = f"INSERT INTO attendance ({columns}) VALUES ({placeholders})"
                cursor.execute(sql, values)
            
            # Commit the transaction
            conn.commit()
            return len(records), new_version

        except Exception as e:
            # Rollback in case of error
            conn.rollback()
            raise e

def get_all_table_names():
    """Fetch all table names from the database."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
        tables = [row['name'] for row in cursor.fetchall()]
        # Exclude SQLite internal tables
        return [t for t in tables if not t.startswith('sqlite_')]

def seed_table_from_df(table_name, df):
    """Overwrite a table with data from a pandas DataFrame."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(f'DELETE FROM "{table_name}"')
        df.to_sql(table_name, conn, if_exists='append', index=False)
        try:
            cursor.execute(f'SELECT MAX(rowid) FROM "{table_name}"')
            max_rowid = cursor.fetchone()[0] or 0
            cursor.execute('DELETE FROM sqlite_sequence WHERE name=?', (table_name,))
            cursor.execute('INSERT INTO sqlite_sequence(name, seq) VALUES(?, ?)', (table_name, max_rowid))
        except sqlite3.Error:
            pass
    _populate_whitelists()

def get_user_by_username(username):
    """Fetch a single user by their username."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM users WHERE username = ?", (username,))
        row = cursor.fetchone()
        return dict(row) if row else None

def add_student_with_section(student_record, section_id):
    """
    Adds a student and assigns them to a section in a single transaction.
    Returns the ID of the new student.
    """
    if not all(is_valid_column(c) for c in student_record.keys()):
        raise ValueError("Invalid column in student record.")
    if section_id and not is_valid_column('section_id'): # Just a safety check
        raise ValueError("Invalid column for section_id.")

    with get_db_connection() as conn:
        cursor = conn.cursor()
        
        # Insert student
        st_columns = ', '.join([f'"{k}"' for k in student_record.keys()])
        st_placeholders = ', '.join(['?' for _ in student_record.values()])
        st_values = tuple(student_record.values())
        cursor.execute(f"INSERT INTO students ({st_columns}) VALUES ({st_placeholders})", st_values)
        new_student_id = cursor.lastrowid

        # Assign to section
        if section_id:
            cursor.execute("INSERT INTO section_students (student_id, section_id) VALUES (?, ?)", (new_student_id, section_id))
        
        conn.commit()
        return new_student_id





    
