const express = require('express');
const path = require('node:path');
const FFMpegFrameStream = require('./ffmpeg_frame_stream');
const dotenv = require('dotenv').config();

const app = express();
const frameStream = new FFMpegFrameStream();

const stats = {
    requests: {
        snapshots: 0,
        streams: 0,
        currentStreams: 0,
    },
    frames: {
        snapshot: 0,
        streamed: 0,
    },
};

const boundary = 'XXFRAMEBOUNDARYXX';

app.use('/status', (req, res) => {
    res.json({...frameStream.getInfo(), stats: stats});
})
.use('/snapshot', (req, res) => {
    const frame = frameStream.lastFrame();
    if (frame && frame.data) {
        stats.requests.snapshots++;
        stats.frames.snapshot++;
        res.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'image/jpeg',
            'Content-Length': frame.data.length,
        });
        res.write(frame.data);
        res.end();
    }
    else {
        res.sendStatus(500);
    }
}).use('/stream', (req, res) => {
    stats.requests.streams++;
    stats.requests.currentStreams++;
    res.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Connection': 'close',
        'X-Content-Type': 'video/mjpeg',
        'Content-Type': `multipart/x-mixed-replace;boundary=${boundary}`,
    });

    res.write(`\r\n`);

    const frameListener = (frame) => {
        stats.frames.streamed++;
        res.write(`--${boundary}\r\n`);
        res.write(`Content-Type: image/jpeg\r\n`);
        res.write(`Content-Length: ${frame.data.length}\r\n`);
        res.write(`X-Timestamp: ${frame.timestamp}\r\n`);
        res.write(`\r\n`);
        res.write(frame.data);
        res.write(`\r\n`);
        res.write(`\r\n`);
    };

    frameStream.on('frame', frameListener);

    res.on('close', function() {
        stats.requests.currentStreams--;
        frameStream.removeListener('frame', frameListener);
    });
}).use('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.htm'));
});

frameStream.start().then((cmd) => {
    app.listen(process.env.PORT || 3000);
});