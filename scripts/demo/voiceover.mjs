// Renders each voice-over line in scripts/demo/voiceover.json to its own WAV with Kokoro (voice af_heart)
// and writes the durations to assets/raw-launch/vo/durations.json.
// Usage: KOKORO_PY=/path/to/kokoro/python KOKORO_TTS=/path/to/tts.py node scripts/demo/voiceover.mjs
// tts.py is called as: <python> -I <tts.py> "<text>" <out.wav> --voice af_heart
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const py = process.env.KOKORO_PY;
const tts = process.env.KOKORO_TTS;
if (!py || !tts) throw new Error('set KOKORO_PY and KOKORO_TTS');
const lines = JSON.parse(readFileSync(join(root, 'scripts', 'demo', 'voiceover.json'), 'utf8'));
const dir = join(root, 'assets', 'raw-launch', 'vo');
mkdirSync(dir, { recursive: true });
const durations = {};
for (const { id, text } of lines) {
  const out = join(dir, `${id}.wav`);
  execFileSync(py, ['-I', tts, text, out, '--voice', 'af_heart'], { stdio: 'inherit' });
  const d = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString().trim();
  durations[id] = Number(d);
}
writeFileSync(join(dir, 'durations.json'), JSON.stringify(durations, null, 2));
console.log(durations);
