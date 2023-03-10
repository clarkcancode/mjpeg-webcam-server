# mjpeg-webcam-server

A webserver for streaming a webcam using FFmpeg written in node.js designed for MacOS (Linux support may come later).

The endpoints are designed to work well with OctoPrint - `/snapshot` for a single JPG image, and `/stream` for an MJPEG video stream.

FFmpeg runs independent of the webserver requests, so multiple clients are supported at once without extra transcode tasks.

Snapshots are served from the last frame already seen, so the `/snapshot` endpoint is quick as possible for maximum timelapse accuracy.

### Requirements

* node.js 16.x or later
* AVFoundation support (MacOS 10.7 or later)

### Installing

* Clone this repository and then `cd` into that folder
* Run `npm install` to install the required modules
* Copy `.env.dist` to `.env` and adjust as necessary for your system
* Run `npm run server`
* Open `http://localhost:3000/snapshot` to check if it worked

### Status Page

This server also includes a status page to monitor it in realtime. Simply open `http://localhost:3000/` to preview your camera, monitor transcode performance, see capture devices detected, and check logs.

