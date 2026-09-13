from http.server import HTTPServer, BaseHTTPRequestHandler
import urllib.request
import urllib.error
import json

class DebugProxyHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.end_headers()

    def do_POST(self):
        print("\n" + "="*50)
        print("📥 NOVA REQUISIÇÃO RECEBIDA DO JAVASCRIPT")
        print("="*50)

        auth_header = self.headers.get('Authorization')
        content_length = int(self.headers['Content-Length'])
        post_data = self.rfile.read(content_length)

        print("🚀 Encaminhando requisição para o OpenRouter (com User-Agent)...")
        openrouter_url = "https://openrouter.ai/api/v1/chat/completions"
        
        headers = {
            "Authorization": auth_header if auth_header else "",
            "Content-Type": "application/json",
        }

        req = urllib.request.Request(
            openrouter_url,
            data=post_data,
            headers=headers,
            method="POST"
        )

        try:
            with urllib.request.urlopen(req) as response:
                response_data = response.read()
                print("✅ Resposta 200 recebida com sucesso do OpenRouter!")
                
                self.send_response(200)
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(response_data)
                
        except urllib.error.HTTPError as e:
            error_body = e.read().decode('utf-8')
            print(f"\n❌ ERRO HTTP DO OPENROUTER ({e.code}):")
            print(error_body)
            
            self.send_response(e.code)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(error_body.encode('utf-8'))
            
        except Exception as e:
            print(f"\n❌ EXCEÇÃO INESPERADA NO PYTHON: {str(e)}")
            self.send_response(500)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))
        
        print("="*50 + "\n")

if __name__ == '__main__':
    server_address = ('127.0.0.1', 8000)
    httpd = HTTPServer(server_address, DebugProxyHandler)
    print("🚀 Servidor de Debug ativo em http://127.0.0.1:8000")
    httpd.serve_forever()
