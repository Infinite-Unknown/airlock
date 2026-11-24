// Makes assets/demo-upload.mp4, a copy of assets/demo.mp4 that fits a 9.5 MB upload limit:
// two-pass H.264 at a bitrate computed from the duration (default 1080p, 30 fps; --720 for 1280x720).
// Usage: node scripts/demo/upload.mjs [--720] [--mb 9.2]
import { execFileSync } from 'node:child_process';
import { rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dirname, '..', '..');
const src = join(root, 'assets', 'demo.mp4');
const out = join(root, 'assets', 'demo-upload.mp4');
const args = process.argv.slice(2);
const mb = Number(args.includes('--mb') ? args[args.indexOf('--mb') + 1] : 9.2);
const h = args.includes('--720') ? 720 : 1080;
const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src]).toString());
const audioK = 80;
// 2% for container overhead
const videoK = Math.floor((mb * 8 * 1000 * 1000 * 0.98) / dur / 1000 - audioK);
const log = join(tmpdir(), `airlock-2pass-${process.pid}`);
const common = ['-y', '-loglevel', 'error', '-i', src, '-vf', `fps=30,scale=-2:${h}:flags=lanczos`, '-c:v', 'libx264', '-preset', 'slow',
  '-b:v', `${videoK}k`, '-maxrate', `${Math.round(videoK * 2.5)}k`, '-bufsize', `${videoK * 4}k`, '-pix_fmt', 'yuv420p', '-passlogfile', log];
execFileSync('ffmpeg', [...common, '-pass', '1', '-an', '-f', 'mp4', '/dev/null']);
execFileSync('ffmpeg', [...common, '-pass', '2', '-c:a', 'aac', '-b:a', `${audioK}k`, '-ac', '1', '-movflags', '+faststart', out]);
for (const ext of ['-0.log', '-0.log.mbtree']) rmSync(log + ext, { force: true });
console.log(`wrote ${out}: ${(statSync(out).size / 1e6).toFixed(2)} MB, ${h}p, video ${videoK} kb/s`);
