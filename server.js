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
    crossOriginResourcePolicy: { policy: "cross-origin" }
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
    max: 1000, // High limit for chunked video requests
    message: 'Too many requests.'
});
app.use('/proxy', limiter);

// Helper to get protocol module
const getProtocol = (link) => link.startsWith('https') ? https : http;

// 2. CORE PROXY ROUTE
app.get('/proxy', async (req, res) => {
    const videoUrl = req.query.url;
    
    if (!videoUrl) return res.status(400).send('Missing URL');

    // -- PATH A: FFmpeg Remuxing (Transcoding) --
    // Triggered explicitly or by file extension
    const needsTranscode = req.query.transcode === 'true' || 
                           videoUrl.match(/\.(mkv|avi|flv|wmv)$/i);

    if (needsTranscode) {
        console.log(`⚙️ [Transcode] Remuxing: ${videoUrl}`);
        
        res.writeHead(200, {
            'Content-Type': 'video/mp4',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*'
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
    // This function recursively follows redirects on the server side
    // to prevent CORS/Protocol issues on the client.
    const proxyStream = (targetUrl, attempt = 0) => {
        if (attempt > 10) {
            console.error('❌ Too many redirects');
            if (!res.headersSent) res.status(502).send('Too many redirects');
            return;
        }

        const parsedUrl = url.parse(targetUrl);
        const protocol = getProtocol(targetUrl);

        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': '*/*',
            'Accept-Encoding': 'identity', // Important: Disable gzip for video
            'Connection': 'keep-alive',
            'Referer': `${parsedUrl.protocol}//${parsedUrl.hostname}/`
        };

        // Forward Range header from client to upstream
        if (req.headers.range) {
            headers['Range'] = req.headers.range;
        }

        const proxyReq = protocol.request({
            hostname: parsedUrl.hostname,
            port: parsedUrl.port,
            path: parsedUrl.path,
            method: 'GET',
            headers: headers,
            rejectUnauthorized: false // Allow self-signed certs
        }, (proxyRes) => {
            // Handle Redirects Internally
            if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
                let redirectUrl = proxyRes.headers.location;
                if (redirectUrl.startsWith('/')) {
                    redirectUrl = `${parsedUrl.protocol}//${parsedUrl.hostname}${redirectUrl}`;
                }
                console.log(`🔄 [Redirect ${attempt + 1}] -> ${redirectUrl}`);
                // Recurse
                proxyStream(redirectUrl, attempt + 1);
                return;
            }

            // Check for valid status
            if (!res.headersSent) {
                // Forward specific headers to client
                const responseHeaders = {
                    'Content-Type': proxyRes.headers['content-type'] || 'video/mp4',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'Range',
                    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
                    'Cache-Control': 'no-cache'
                };

                if (proxyRes.headers['content-length']) responseHeaders['Content-Length'] = proxyRes.headers['content-length'];
                if (proxyRes.headers['content-range']) responseHeaders['Content-Range'] = proxyRes.headers['content-range'];
                if (proxyRes.headers['accept-ranges']) responseHeaders['Accept-Ranges'] = proxyRes.headers['accept-ranges'];

                res.writeHead(proxyRes.statusCode, responseHeaders);
            }

            // Pipe data
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

        // Cleanup on client disconnect
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
║   🛡️  StreamFlow Advanced Gateway Active               ║
║   🚀  http://localhost:${PORT}                           ║
║   ✨  Modes: Internal Redirects, FFmpeg, Range Proxy   ║
╚════════════════════════════════════════════════════════╝
    `);
});