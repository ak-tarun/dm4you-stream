/**
 * StreamFlow Secure Streaming Gateway
 * Advanced Proxy with Internal Redirect Following, Range Support, and FFmpeg Transcoding.
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

// 1. SECURITY & PERFORMANCE HEADERS
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" } // CRITICAL: Allows mobile chrome to play
}));

app.use(cors({
    origin: '*',
    methods: ['GET', 'HEAD', 'OPTIONS'],
    allowedHeaders: ['Range', 'Authorization', 'Content-Type'],
    exposedHeaders: ['Content-Length', 'Content-Range', 'Content-Type', 'Accept-Ranges']
}));

// Rate Limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000, 
    message: 'Too many requests.'
});
app.use('/proxy', limiter);

const getProtocol = (link) => link.startsWith('https') ? https : http;

// 2. CORE PROXY ROUTE
app.get('/proxy', async (req, res) => {
    const videoUrl = req.query.url;
    
    if (!videoUrl) return res.status(400).send('Missing URL');

    // -- PATH A: FFmpeg Remuxing (Transcoding) --
    const needsTranscode = req.query.transcode === 'true' || 
                           videoUrl.match(/\.(mkv|avi|flv|wmv)$/i);

    if (needsTranscode) {
        console.log(`⚙️ [Transcode] Remuxing: ${videoUrl}`);
        
        res.writeHead(200, {
            'Content-Type': 'video/mp4',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
            'Cross-Origin-Resource-Policy': 'cross-origin'
        });

        const ffmpegCommand = ffmpeg(videoUrl)
            .inputOptions([
                '-re',
                '-headers', `User-Agent: ${req.headers['user-agent'] || 'Mozilla/5.0'}`
            ])
            .outputOptions([
                '-movflags frag_keyframe+empty_moov+default_base_moof',
                '-c:v copy', 
                '-c:a aac',
                '-f mp4'
            ])
            .on('error', (err) => {
                if (err.message !== 'Output stream closed') {
                    console.error('❌ [Transcode] Error:', err.message);
                }
            })
            .pipe(res, { end: true });
        
        req.on('close', () => {
            ffmpegCommand.kill('SIGKILL');
        });
        return;
    }

    // -- PATH B: Advanced Native Proxy (Internal Redirects) --
    const proxyStream = (targetUrl, attempt = 0) => {
        if (attempt > 10) {
            console.error('❌ Too many redirects');
            if (!res.headersSent) res.status(502).send('Too many redirects');
            return;
        }

        const parsedUrl = url.parse(targetUrl);
        const protocol = getProtocol(targetUrl);

        // Spoof headers to look like a browser visiting the source directly
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
            'Accept': 'video/webm,video/ogg,video/*;q=0.9,application/ogg;q=0.7,audio/*;q=0.6,*/*;q=0.5',
            'Accept-Encoding': 'identity', 
            'Connection': 'keep-alive',
            'Referer': `${parsedUrl.protocol}//${parsedUrl.hostname}/` // Spoof referer to self
        };

        if (req.headers.range) {
            headers['Range'] = req.headers.range;
        }

        const proxyReq = protocol.request({
            hostname: parsedUrl.hostname,
            port: parsedUrl.port,
            path: parsedUrl.path,
            method: 'GET',
            headers: headers,
            rejectUnauthorized: false
        }, (proxyRes) => {
            // Handle Redirects Internally
            if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
                let redirectUrl = proxyRes.headers.location;
                if (redirectUrl.startsWith('/')) {
                    redirectUrl = `${parsedUrl.protocol}//${parsedUrl.hostname}${redirectUrl}`;
                }
                console.log(`🔄 [Redirect ${attempt + 1}] -> ${redirectUrl}`);
                proxyStream(redirectUrl, attempt + 1);
                return;
            }

            if (!res.headersSent) {
                // Determine Content-Type: Fix Google's "octet-stream" to "video/mp4"
                let contentType = proxyRes.headers['content-type'] || 'video/mp4';
                if (contentType === 'application/octet-stream' || contentType === 'application/x-guploader-customer-content') {
                    contentType = 'video/mp4';
                }

                // Construct Headers
                const responseHeaders = {
                    'Content-Type': contentType,
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
                    'Access-Control-Allow-Headers': 'Range',
                    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
                    'Cross-Origin-Resource-Policy': 'cross-origin', // THE FIX FOR MOBILE
                    'Cache-Control': 'no-cache',
                    'Accept-Ranges': 'bytes'
                };

                if (proxyRes.headers['content-length']) responseHeaders['Content-Length'] = proxyRes.headers['content-length'];
                if (proxyRes.headers['content-range']) responseHeaders['Content-Range'] = proxyRes.headers['content-range'];

                res.writeHead(proxyRes.statusCode, responseHeaders);
            }

            proxyRes.pipe(res);
            
            proxyRes.on('error', (err) => {
                console.error('Stream Error:', err.message);
                res.end();
            });
        });

        proxyReq.on('error', (err) => {
            console.error('Request Error:', err.message);
            if (!res.headersSent) res.status(500).send('Stream Error');
        });

        proxyReq.on('timeout', () => {
            proxyReq.destroy();
            if (!res.headersSent) res.status(504).send('Timeout');
        });

        req.on('close', () => {
            proxyReq.destroy();
        });

        proxyReq.end();
    };

    console.log(`🎬 [Proxy] ${videoUrl}`);
    proxyStream(videoUrl);
});

app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════╗
║   🛡️  StreamFlow Ultimate Gateway Active               ║
║   🚀  http://localhost:${PORT}                           ║
║   ✨  Features: CORP Header, MIME Fixer, Redirects     ║
╚════════════════════════════════════════════════════════╝
    `);
});