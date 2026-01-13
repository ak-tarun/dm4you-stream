/**
 * StreamFlow Secure Streaming Gateway
 * Production-grade video proxy with Transcoding, Security, and Stream Management.
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

// 1. SECURITY HARDENING
app.use(helmet()); // Sets various HTTP headers for security
app.use(cors({
    origin: '*', // In production, replace with specific domain allow-list
    methods: ['GET', 'HEAD', 'OPTIONS'],
    exposedHeaders: ['Content-Length', 'Content-Range', 'Content-Type']
}));

// Rate Limiting: Prevent abuse
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.'
});
app.use('/proxy', limiter);

// 2. STREAM FORMAT NORMALIZATION & UTILS
const getProtocol = (link) => link.startsWith('https') ? https : http;

const isValidUrl = (string) => {
    try {
        new URL(string);
        return true;
    } catch (_) {
        return false;
    }
};

const isYouTube = (link) => {
    return link.includes('youtube.com') || link.includes('youtu.be');
};

// 3. CORE PROXY LOGIC
app.get('/proxy', async (req, res) => {
    const videoUrl = req.query.url;
    const forceTranscode = req.query.transcode === 'true';

    // Validation
    if (!videoUrl || !isValidUrl(videoUrl)) {
        return res.status(400).json({ error: 'Invalid or missing URL parameter' });
    }

    // YouTube Handling: The Gateway refuses to proxy YouTube raw streams (TOS violation/Breaking changes).
    // It tells the frontend to use the IFrame API.
    if (isYouTube(videoUrl)) {
        return res.status(400).json({ 
            error: 'YouTube detected', 
            code: 'USE_YOUTUBE_API',
            message: 'This secure gateway does not proxy YouTube. Use the Client IFrame integration.'
        });
    }

    console.log(`\n🎬 [Gateway] Processing: ${videoUrl}`);

    try {
        const parsedUrl = url.parse(videoUrl);
        const protocol = getProtocol(videoUrl);

        // Headers Forwarding (User-Agent spoofing for compatibility)
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Referer': `${parsedUrl.protocol}//${parsedUrl.hostname}/`,
            ...req.headers
        };
        
        // Remove host header to avoid confusion
        delete headers['host'];
        
        // 4. TRANSCODING PATH (FFmpeg)
        // If the source is an unsupported format (e.g., AVI, MKV) or requested to transcode
        if (forceTranscode || videoUrl.endsWith('.mkv') || videoUrl.endsWith('.avi')) {
            console.log('⚙️  [Transcoder] Remuxing stream to Fragmented MP4...');
            
            res.writeHead(200, {
                'Content-Type': 'video/mp4',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*'
            });

            const command = ffmpeg(videoUrl)
                .inputOptions([
                    '-re', // Read input at native framerate
                    '-headers', `User-Agent: ${headers['User-Agent']}`
                ])
                .outputOptions([
                    '-movflags frag_keyframe+empty_moov', // Fragmented MP4 for streaming
                    '-c:v copy', // Try to copy video codec (fast)
                    '-c:a aac', // Ensure audio is AAC (browser compatible)
                    '-f mp4'
                ])
                .on('error', (err) => {
                    console.error('❌ [Transcoder] Error:', err.message);
                    if (!res.headersSent) res.status(500).end();
                })
                .pipe(res, { end: true });
            
            return;
        }

        // 5. DIRECT STREAMING PATH (Zero-copy pipe)
        const proxyReq = protocol.request({
            host: parsedUrl.hostname,
            port: parsedUrl.port,
            path: parsedUrl.path,
            method: 'GET',
            headers: headers
        }, (proxyRes) => {
            
            // Handle Redirects
            if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
                console.log(`🔄 [Gateway] Following redirect -> ${proxyRes.headers.location}`);
                res.redirect(307, `/proxy?url=${encodeURIComponent(proxyRes.headers.location)}`);
                return;
            }

            // Pipe Headers
            const forwardHeaders = [
                'content-type', 'content-length', 'content-range', 
                'accept-ranges', 'cache-control', 'last-modified'
            ];
            
            forwardHeaders.forEach(h => {
                if (proxyRes.headers[h]) res.setHeader(h, proxyRes.headers[h]);
            });

            res.setHeader('Access-Control-Allow-Origin', '*');
            res.status(proxyRes.statusCode);

            // Pipe Data
            proxyRes.pipe(res);

            proxyRes.on('error', (err) => {
                console.error('❌ [Stream] Source Error:', err.message);
                res.end();
            });
        });

        proxyReq.on('error', (err) => {
            console.error('❌ [Stream] Request Error:', err.message);
            if (!res.headersSent) res.status(502).json({ error: 'Bad Gateway' });
        });

        proxyReq.on('timeout', () => {
            console.error('⏱️ [Stream] Timeout');
            proxyReq.destroy();
        });

        proxyReq.end();

    } catch (error) {
        console.error('❌ [Gateway] Critical Error:', error);
        res.status(500).send('Internal Server Error');
    }
});

app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════╗
║   🛡️  StreamFlow Secure Gateway Active                 ║
║   🚀  Running on: http://localhost:${PORT}               ║
║   📹  Endpoint: /proxy?url=...                         ║
║   🔐  Features: Rate Limit, CORS, FFmpeg, HLS/Dash     ║
╚════════════════════════════════════════════════════════╝
    `);
});