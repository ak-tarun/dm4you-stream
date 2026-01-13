/**
 * StreamFlow Secure Streaming Gateway
 * Production-grade video proxy with Range Support, FFmpeg Remuxing, and Token Handling.
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
    contentSecurityPolicy: false, // Allow blob: and data: sources for video
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" } // CRITICAL for video playback
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
    max: 500, // Higher limit for video segments
    message: 'Too many requests.'
});
app.use('/proxy', limiter);

const getProtocol = (link) => link.startsWith('https') ? https : http;

// 2. SMART PROXY ENGINE
app.get('/proxy', async (req, res) => {
    const videoUrl = req.query.url;
    // Auto-transcode if container is not browser friendly
    const needsTranscode = req.query.transcode === 'true' || 
                           videoUrl.match(/\.(mkv|avi|flv|wmv)$/i);

    if (!videoUrl) return res.status(400).send('Missing URL');

    // -- PATH A: FFmpeg Remuxing (Transcoding) --
    // Used for MKV, AVI, or when atom placement is bad.
    // Converts to Fragmented MP4 (fMP4) which is streamable.
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
                '-movflags frag_keyframe+empty_moov+default_base_moof', // KEY: Makes it streamable immediately
                '-c:v copy', // Zero-copy video if codec supported
                '-c:a aac',  // Ensure audio is AAC
                '-f mp4'
            ])
            .on('error', (err) => {
                // FFmpeg errors are expected when client disconnects
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

    // -- PATH B: Native Range Proxy --
    // Used for MP4, WebM. Critical for Mobile/Safari seeking.
    try {
        const parsedUrl = url.parse(videoUrl);
        const protocol = getProtocol(videoUrl);
        
        // 1. Forward Client Headers (Range is vital)
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': '*/*',
            'Connection': 'keep-alive',
            'Referer': `${parsedUrl.protocol}//${parsedUrl.hostname}/`
        };

        if (req.headers.range) {
            headers['Range'] = req.headers.range;
        }

        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port,
            path: parsedUrl.path,
            method: 'GET',
            headers: headers,
            rejectUnauthorized: false // Handle self-signed certs on private CDNs
        };

        const proxyReq = protocol.request(options, (proxyRes) => {
            // Handle Redirects Manually (to keep Range headers)
            if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
                console.log(`🔄 [Redirect] ${proxyRes.headers.location}`);
                res.redirect(307, `/proxy?url=${encodeURIComponent(proxyRes.headers.location)}`);
                return;
            }

            // Forward Status Code (200 vs 206)
            res.status(proxyRes.statusCode);

            // Forward Critical Headers
            const safeHeaders = [
                'content-type', 
                'content-length', 
                'content-range', 
                'accept-ranges', 
                'last-modified', 
                'etag'
            ];
            
            safeHeaders.forEach(headerName => {
                if (proxyRes.headers[headerName]) {
                    res.setHeader(headerName, proxyRes.headers[headerName]);
                }
            });

            // Force browser to treat this as streamable video
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

            // Pipe data
            proxyRes.pipe(res);

            proxyRes.on('error', (e) => {
                console.error('Stream source error', e);
                res.end();
            });
        });

        proxyReq.on('error', (e) => {
            console.error('Request error', e);
            if (!res.headersSent) res.status(502).send('Bad Gateway');
        });

        // Abort upstream request if client disconnects (Save Bandwidth)
        req.on('close', () => {
            proxyReq.destroy();
        });

        proxyReq.end();

    } catch (err) {
        console.error('Proxy Exception', err);
        res.status(500).send('Proxy Error');
    }
});

app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════╗
║   🛡️  StreamFlow Smart Gateway Active                  ║
║   🚀  http://localhost:${PORT}                           ║
║   ✨  Features: HTTP 206 Range, fMP4 Remuxing          ║
╚════════════════════════════════════════════════════════╝
    `);
});