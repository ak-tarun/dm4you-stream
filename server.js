/**
 * StreamFlow Secure Streaming Gateway
 * Architecture: Node.js Stream Pipe + FFmpeg Remux + Header Normalization
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const ffmpeg = require('fluent-ffmpeg');
const http = require('http');
const https = require('https');
const url = require('url');

const app = express();
const PORT = 4000;

// 1. CRITICAL SECURITY HEADERS FOR MEDIA
// Cross-Origin-Resource-Policy: cross-origin is REQUIRED for Android Chrome
// to allow the <video> tag to load resources from a different origin/port.
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    dnsPrefetchControl: false,
    frameguard: false,
    hsts: false,
    ieNoOpen: false,
    noSniff: false, // Allow browser to sniff if we mess up, though we try not to
    xssFilter: false
}));

app.use(cors({
    origin: '*',
    methods: ['GET', 'HEAD', 'OPTIONS'],
    allowedHeaders: ['Range', 'Authorization', 'Content-Type', 'UA-CPU'],
    exposedHeaders: ['Content-Length', 'Content-Range', 'Content-Type', 'Accept-Ranges'],
    credentials: false // Video tags usually don't send cookies cross-origin
}));

// Rate Limiting (Permissive for video chunks)
const limiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 2000, 
    message: 'Too many requests.'
});
app.use('/proxy', limiter);

const getProtocol = (link) => link.startsWith('https') ? https : http;

// 2. SMART PROXY ENGINE
app.get('/proxy', async (req, res) => {
    const videoUrl = req.query.url;
    if (!videoUrl) return res.status(400).send('Missing URL');

    // Detect if we need to fix the container (MKV/AVI -> MP4)
    // or if we need to fix "Moov atom at end" issues via remuxing
    // "faststart" logic solves Android timeouts on large files
    const needsTranscode = req.query.transcode === 'true' || 
                           req.query.faststart === 'true' ||
                           videoUrl.match(/\.(mkv|avi|flv|wmv)$/i);

    // --- STRATEGY A: FFmpeg Remux (fMP4 / FastStart) ---
    // Used for incompatible containers or when forced by retry logic.
    if (needsTranscode) {
        console.log(`⚙️ [Transcode] Remuxing: ${videoUrl}`);
        
        // When transcoding, we cannot support Range requests easily without complex caching.
        // We stream the output as a 200 OK continuous stream.
        res.writeHead(200, {
            'Content-Type': 'video/mp4',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
            'Cross-Origin-Resource-Policy': 'cross-origin'
        });

        const ffmpegCommand = ffmpeg(videoUrl)
            .inputOptions([
                '-re', // Read input at native frame rate
                '-headers', `User-Agent: ${req.headers['user-agent'] || 'Mozilla/5.0'}`,
                '-rw_timeout', '15000000' // 15s timeout
            ])
            .outputOptions([
                // FRAGMENTED MP4 OPTIONS: Critical for streaming without seek-back
                '-movflags frag_keyframe+empty_moov+default_base_moof', 
                '-c:v copy', // Copy video stream (no re-encode = low CPU)
                '-c:a aac',  // Ensure audio is AAC (safe for browser)
                '-f mp4'
            ])
            .on('error', (err) => {
                if (err.message && !err.message.includes('Output stream closed')) {
                    console.error('❌ [Transcode] Error:', err.message);
                }
            })
            .pipe(res, { end: true });
        
        req.on('close', () => {
            ffmpegCommand.kill('SIGKILL');
        });
        return;
    }

    // --- STRATEGY B: Smart Direct Proxy (Recursive Redirects + Cookie Jar) ---
    // Handles 206 Range requests, Google signatures, and MIME fixing.
    
    // Cookie jar for following redirects (Google often sets auth cookies on 302)
    let sessionCookies = [];

    const proxyStream = (targetUrl, attempt = 0) => {
        if (attempt > 10) {
            if (!res.headersSent) res.status(502).send('Too many redirects');
            return;
        }

        const parsedUrl = url.parse(targetUrl);
        const protocol = getProtocol(targetUrl);

        // Header Forging: Look like a standard browser request
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
            'Accept': 'video/webm,video/ogg,video/*;q=0.9,application/ogg;q=0.7,audio/*;q=0.6,*/*;q=0.5',
            'Accept-Encoding': 'identity', // No GZIP for video
            'Connection': 'keep-alive',
            'Referer': `${parsedUrl.protocol}//${parsedUrl.hostname}/`
        };

        // CRITICAL: Forward the Range header to enable seeking
        if (req.headers.range) {
            headers['Range'] = req.headers.range;
        }

        // Apply session cookies from previous redirects
        if (sessionCookies.length > 0) {
            headers['Cookie'] = sessionCookies.join('; ');
        }

        const proxyReq = protocol.request({
            hostname: parsedUrl.hostname,
            port: parsedUrl.port,
            path: parsedUrl.path,
            method: 'GET',
            headers: headers,
            rejectUnauthorized: false // Allow self-signed certs
        }, (proxyRes) => {
            
            // 0. Capture Cookies
            if (proxyRes.headers['set-cookie']) {
                proxyRes.headers['set-cookie'].forEach(c => {
                    const cookie = c.split(';')[0];
                    sessionCookies.push(cookie);
                });
            }

            // 1. Handle Redirects Internally
            if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
                let redirectUrl = proxyRes.headers.location;
                if (redirectUrl.startsWith('/')) {
                    redirectUrl = `${parsedUrl.protocol}//${parsedUrl.hostname}${redirectUrl}`;
                }
                // console.log(`🔄 [Redirect] -> ${redirectUrl}`);
                proxyStream(redirectUrl, attempt + 1);
                return;
            }

            // 2. Sanitize Response for Browser
            if (!res.headersSent) {
                // MIME Type Fixer: Google often sends 'application/octet-stream' or 'application/x-guploader...'
                // Android requires 'video/mp4' to engage the hardware decoder.
                let contentType = proxyRes.headers['content-type'] || 'video/mp4';
                if (contentType.includes('octet-stream') || contentType.includes('guploader')) {
                    contentType = 'video/mp4';
                }

                const responseHeaders = {
                    'Content-Type': contentType,
                    'Access-Control-Allow-Origin': '*',
                    'Cross-Origin-Resource-Policy': 'cross-origin', // THE ANDROID FIX
                    'Accept-Ranges': 'bytes', // FORCE this
                    'Cache-Control': 'no-cache',
                    'X-Content-Type-Options': 'nosniff' // Security best practice, usually safe if type is correct
                };

                // Forward structural headers
                if (proxyRes.headers['content-length']) responseHeaders['Content-Length'] = proxyRes.headers['content-length'];
                if (proxyRes.headers['content-range']) responseHeaders['Content-Range'] = proxyRes.headers['content-range'];
                if (proxyRes.headers['etag']) responseHeaders['ETag'] = proxyRes.headers['etag'];

                // Handle 200 vs 206 Mismatch
                // If we requested Range but got 200, we technically can't pipe it as a Partial Content response 
                // unless it matches the full file.
                // However, usually we just pass the status code. 
                // If upstream is 200, we send 200. Android will treat it as a full download.
                // Ideally, upstream SHOULD return 206 if Range was sent.
                
                res.writeHead(proxyRes.statusCode, responseHeaders);
            }

            // 3. Pipe Data
            proxyRes.pipe(res);
            
            proxyRes.on('error', (err) => {
                console.error('Stream Error:', err.message);
                res.end();
            });
        });

        proxyReq.on('error', (err) => {
            console.error('Request Error:', err.message);
            if (!res.headersSent) res.status(502).send('Bad Gateway');
        });

        proxyReq.on('timeout', () => {
            proxyReq.destroy();
            if (!res.headersSent) res.status(504).send('Gateway Timeout');
        });

        req.on('close', () => {
            proxyReq.destroy();
        });

        proxyReq.end();
    };

    console.log(`🎬 [Proxy Request] ${videoUrl}`);
    proxyStream(videoUrl);
});

app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════╗
║   🛡️  StreamFlow Production Gateway Active             ║
║   🚀  http://localhost:${PORT}                           ║
║   📱  Android/Mobile Support: ENABLED (CORP Headers)   ║
╚════════════════════════════════════════════════════════╝
    `);
});