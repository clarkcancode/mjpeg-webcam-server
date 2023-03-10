const stream = require('node:stream');
const moment = require('moment');
const cp = require('child_process');

class FFMpegFrameStream extends stream.Writable {
    constructor(config = {}) {
        super({objectMode: true});
        
        this.config = {
            ffmpeg: process.env.FFMPEG_PATH ?? 'ffmpeg',
            framerate: process.env.FRAME_RATE ?? 30,
            resolution: process.env.RESOLUTION ?? '640x480',
            quality: process.env.QUALITY ?? 2,
            device: process.env.DEVICE_ID ?? 0,
            format: process.env.PIXEL_FORMAT ?? null,
            timeout: parseInt(process.env.IDLE_TIMEOUT ?? '60'),
            ...config,
        };

        this._lastFrame = null;
        this.buffer = Buffer.from('');
        this.startTime = moment();

        this._ffmpegInfo = {
            version: null,
            configuration: null,
            capture: 'init',
            command: null,
            status: null,
            lastrequest: 'n/a',
            logs: {},
            lastlogs: [],
        };

        this.requests = {
            lastframe: moment(),
            laststream: moment(),
            streams: 0,
        };

        this.imageStartBytes = Buffer.from([0xff, 0xd8]);
        this.imageEndBytes = Buffer.from([0xff, 0xd9]);
        this.ffmpeg = null;

        this._sleepTimer();
        this.sleepTimer = setInterval(this._sleepTimer.bind(this), 5000);

        this._init();
        this.on('newListener', (event, listener) => {
            if (event == 'frame') {
                console.log('New listener attached to', event);
                this.requests.streams++;
                this.start();
            }
        }).on('removeListener', (event, listener) => {
            if (event == 'frame') {
                console.log('Listener removed from', event);
                this.requests.streams--;
                this.laststream = moment();
            }
        });
    }

    _parseStdErr(lines) {
        const _appendLog = (_log, _line, _entireline = null) => {
            if (!Object.prototype.hasOwnProperty.call(this._ffmpegInfo.logs, _log)) {
                this._ffmpegInfo.logs[_log] = [];
            }
            this._ffmpegInfo.logs[_log].push(_line);
            if (this._ffmpegInfo.logs[_log].length > 20) {
                this._ffmpegInfo.logs[_log].shift();
            }
            this._ffmpegInfo.lastlogs.push(_entireline || _line);
            if (this._ffmpegInfo.lastlogs.length > 50) {
                this._ffmpegInfo.lastlogs.shift();
            }
        }

        for (let line of lines.split('\n')) {
            if (!line) {
                continue;
            }
            const matchers = [
                {
                    regex: /^ffmpeg\s+version\s+(?<version>\S+)/i,
                },
                {
                    regex: /^\s*configuration: (?<configuration>.+)$/i,
                },
                {
                    regex: /^\[(?<module>\w+)\s+[^\]]+\]\s+(?<log>.+)$/i,
                    func: (_line, groups) => {
                        _appendLog(groups.module.toLowerCase(), groups.log, line);
                    },
                },
                {
                    regex: /^\w+=\s*\w+/i,
                    func: (_line) => {
                        const status = _line.split(/\s+/).reduce((s, part) => {
                            const matches = part.match(/^(.+)=(.+)/);
                            if (matches) {
                                s[matches[1]] = matches[2];
                            }
                            return s;
                        }, {});
                        this._ffmpegInfo.status = status;
                    },
                },
            ];

            let matched = false;
            for (let matcher of matchers) {
                if (matcher.regex) {
                    const matches = line.match(matcher.regex);
                    if (matches) {
                        if (matcher.func) {
                            matcher.func(line, matches.groups);
                        }
                        else if (matches.groups) {
                            for (let [name, val] of Object.entries(matches.groups)) {
                                this._ffmpegInfo[name] = val;
                            }
                        }
                        matched = true;
                        break;
                    }
                }
            }
            if (!matched) {
                _appendLog('_', line);
            }
        }
    }

    _init() {
        const args = [];
        this._ffmpegInfo.capture = 'info';
        args.push("-r", this.config.framerate);
        args.push("-f", "avfoundation");
        args.push("-list_devices", "true");
        args.push("-i", "");
        args.push("pipe:1");

        const out = cp.spawnSync(this.config.ffmpeg, args)
        this._parseStdErr(out.stderr.toString());
        this._ffmpegInfo.capture = 'paused';
    }

    _sleepTimer() {
        if (this.config.timeout > 0) {
            const timeout = moment().subtract(this.config.timeout, 'minutes');
            const recentFrame = this.requests.lastframe > timeout;
            const recentStream = this.requests.laststream > timeout;
            const isStreaming = this.requests.streams > 0;
            if (isStreaming > 0) {
                this._ffmpegInfo.capture = 'busy';
            }
            else {
                this._ffmpegInfo.capture = 'idle';
            }

            const lastrequest = Math.max(this.requests.lastframe, this.requests.laststream);
            this._ffmpegInfo.lastrequest = lastrequest ? `${moment.duration(moment().diff(lastrequest)).humanize()} ago` : 'n/a';
            if (!recentFrame && !isStreaming && !recentStream) {
                this._stop();
            }
        }
    }

    start() {
        if (this.ffmpeg) {
            // Already running
            return Promise.resolve();
        }

        return new Promise((resolve, reject) => {
            const args = [];

            this._ffmpegInfo.capture = 'running';

            args.push("-r", this.config.framerate);
            args.push("-f", "avfoundation");
            args.push("-video_size", this.config.resolution);
            args.push("-framerate", this.config.framerate);
            if (this.config.format) {
                args.push('-pix_fmt', this.config.format);
            }
            args.push("-i", this.config.device);
            args.push("-c:v", "mjpeg");
            args.push("-q:v", this.config.quality);
            args.push("-f", "mjpeg");
            args.push("pipe:1");

            this.ffmpeg = cp.spawn(this.config.ffmpeg, args)
                .on('spawn', () => {
                    this._ffmpegInfo.command = this.ffmpeg.spawnargs.join(' ');
                    resolve();
                })
                .on('close', () => {
                    this.ffmpeg = null;
                    this._ffmpegInfo.capture = 'paused';
                    this._ffmpegInfo.status = null;
                    this._ffmpegInfo.command = null;
                });

            // Capture errors/etc
            this.ffmpeg.stderr.on('data', this._parseStdErr.bind(this))
                .setEncoding('utf8');

            // Start the pipe
            this.ffmpeg.stdout.pipe(this);
        })
    }

    _stop() {
        if (this.ffmpeg) {
            this.ffmpeg.kill();
        }
    }

    stop() {
        this._stop();
        clearInterval(this.sleepTimer);
    }

    lastFrame() {
        console.log('lastFrame');
        this.requests.lastframe = moment();
        this.start();
        return this._lastFrame;
    }

    getInfo() {
        return this._ffmpegInfo;
    }

    write(chunk, encoding, cb) {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        let done = false;

        do {
            const start = this.buffer.indexOf(this.imageStartBytes);
            if (start < 0) {
                done = true;
                break;
            }

            const end = this.buffer.indexOf(this.imageEndBytes, start);
            if (end < 0) {
                done = true;
                break;
            }

            const frameBuffer = this.buffer.slice(start, end + 2);

            const timestamp = moment().diff(this.startTime);
            const frame = {
                data: frameBuffer,
                timestamp: timestamp / 1000,
            };

            this._lastFrame = frame;
            this.emit('frame', frame);
            
            if (end + 2 < this.buffer.length) {
                this.buffer = this.buffer.slice(end + 2);
            }
            else {
                this.buffer = Buffer.from('');
                done = true;
            }
        } while (!done)

        if (cb) {
            cb();
        }
    }
}

module.exports = FFMpegFrameStream;
