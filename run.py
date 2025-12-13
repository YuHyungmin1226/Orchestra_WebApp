import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser

# The server address (can be overridden with env vars for flexibility)
HOST = os.getenv('APP_HOST', '127.0.0.1')
try:
    PORT = int(os.getenv('APP_PORT', '8000'))
except ValueError:
    PORT = 8000
URL = f"http://{HOST}:{PORT}"

# The path to the server script
# This makes sure we run the server from the correct directory
script_path = os.path.join(os.path.dirname(__file__), 'web_files', 'server.py')
print(f"Attempting to run server from: {script_path}")

def wait_for_server(url: str, process: subprocess.Popen, timeout: float = 15.0, interval: float = 0.5) -> bool:
    """Poll the server URL until it responds or the process dies."""
    start = time.time()
    last_error = None
    while time.time() - start < timeout:
        if process.poll() is not None:
            return False
        try:
            with urllib.request.urlopen(url, timeout=2):
                return True
        except urllib.error.URLError as exc:
            last_error = exc
        time.sleep(interval)
    if last_error:
        print(f"Server readiness check failed: {last_error}")
    return False


def open_browser_safely(url: str) -> None:
    try:
        webbrowser.open_new_tab(url)
    except Exception as exc:  # noqa: BLE001
        print(f"브라우저를 열지 못했습니다: {exc}")


python_exec = sys.executable or 'python'

try:
    # Start the server as a background process
    # We run it within the 'web_files' directory to ensure correct relative paths for templates
    server_process = subprocess.Popen([python_exec, script_path], cwd=os.path.join(os.path.dirname(__file__), 'web_files'))
except (FileNotFoundError, PermissionError) as exc:
    print(f"서버를 시작하지 못했습니다: {exc}")
    sys.exit(1)

print(f"Server process started with PID: {server_process.pid}")
print("Waiting for server to be ready...")

if wait_for_server(URL, server_process):
    print(f"Opening browser at {URL}")
    open_browser_safely(URL)
else:
    print("서버가 예상 시간 내에 응답하지 않습니다. 로그를 확인하세요.")

# You can add logic here to wait for the process to end, or manage it as needed.
# For now, the script will exit, but the server will keep running.
# To stop the server, you'll need to close the terminal window it's running in.
print("="*50)
print("서버가 실행 중입니다.")
print(f"웹 브라우저에서 {URL} 주소로 접속하세요.")
print("서버를 종료하려면 이 창을 닫으세요.")
print("="*50)

# Wait for the server process to terminate and ensure cleanup on interrupt
try:
    server_process.wait()
except KeyboardInterrupt:
    print("Stopping server...")
    server_process.terminate()
    try:
        server_process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        server_process.kill()
        server_process.wait()
    print("Server stopped.")
