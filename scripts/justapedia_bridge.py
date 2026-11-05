#!/usr/bin/env python3
"""
Justapedia Cloudflare Bypass Bridge using curl_cffi Chrome impersonation.
Can run as a persistent fast HTTP microservice on 127.0.0.1:5005,
or as a one-shot CLI tool via stdin/stdout.
"""
import sys
import json
from http.server import HTTPServer, BaseHTTPRequestHandler
from curl_cffi import requests

def handle_request(req_data):
    url = req_data.get("url", "https://justapedia.org/api.php")
    method = req_data.get("method", "GET").upper()
    data = req_data.get("data")
    params = req_data.get("params")
    cookies = req_data.get("cookies", {})
    headers = req_data.get("headers", {})

    default_headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Origin": "https://justapedia.org",
        "Referer": "https://justapedia.org/",
    }
    merged_headers = {**default_headers, **headers}

    s = requests.Session(impersonate="chrome124")
    if cookies:
        for k, v in cookies.items():
            if k and v:
                s.cookies.set(k, v)

    try:
        if method == "POST":
            r = s.post(url, data=data, params=params, headers=merged_headers, timeout=30)
        else:
            r = s.get(url, params=params, headers=merged_headers, timeout=30)

        res_cookies = dict(s.cookies)

        try:
            json_body = r.json()
        except Exception:
            json_body = None

        return {
            "status": r.status_code,
            "data": json_body,
            "text": r.text,
            "cookies": res_cookies,
            "headers": dict(r.headers)
        }
    except Exception as e:
        return {
            "status": 500,
            "error": str(e),
            "cookies": {},
            "headers": {}
        }

class BridgeHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            length = int(self.headers.get("content-length", 0))
            body = self.rfile.read(length)
            req_data = json.loads(body)
            res = handle_request(req_data)
            out = json.dumps(res).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(out)))
            self.end_headers()
            self.wfile.write(out)
        except Exception as ex:
            out = json.dumps({"status": 500, "error": str(ex)}).encode("utf-8")
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(out)

    def do_GET(self):
        out = json.dumps({"status": 200, "bridge": "active", "impersonate": "chrome124"}).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def log_message(self, format, *args):
        pass  # Quiet logging

def run_server(port=5005):
    server = HTTPServer(("127.0.0.1", port), BridgeHandler)
    server.serve_forever()

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--server":
        port = int(sys.argv[2]) if len(sys.argv) > 2 else 5005
        run_server(port)
    else:
        raw_input = sys.stdin.read()
        if raw_input.strip():
            req_data = json.loads(raw_input)
            result = handle_request(req_data)
            print(json.dumps(result))
