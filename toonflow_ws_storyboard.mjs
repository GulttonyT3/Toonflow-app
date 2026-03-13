import WebSocket from 'ws';
import http from 'http';

const PROJECT_ID = process.argv[2] || '1';
const SCRIPT_ID = process.argv[3] || '1';
const BASE_URL = 'localhost:60000';

async function request(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: 'localhost', port: 60000, path,
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve(d); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  const loginRes = await request('/other/login', { username: 'admin', password: 'admin123' });
  const TOKEN = loginRes.data.token;
  console.log('[WS] 登录成功');

  const ws = new WebSocket(
    `ws://${BASE_URL}/storyboard/chatStoryboard?projectId=${PROJECT_ID}&scriptId=${SCRIPT_ID}`,
    { headers: { Authorization: TOKEN } }
  );

  let step = 0;
  let savedCount = 0;
  const timeout = setTimeout(() => { console.log('[WS] 超时退出'); ws.close(); process.exit(0); }, 20 * 60 * 1000);

  ws.on('open', () => console.log('[WS] 已连接'));

  ws.on('message', async (raw) => {
    const msg = JSON.parse(raw.toString());

    if (msg.type === 'init' && step === 0) {
      step = 1;
      console.log('[WS] 发送生成分镜指令...');
      ws.send(JSON.stringify({
        type: 'msg',
        data: { type: 'user', data: '请根据剧本内容，自动拆分场景和分镜，为每个分镜生成详细的画面描述和图片，使用2D修仙风格，玄幻画风，每集生成完整分镜序列。' }
      }));
    }

    else if (msg.type === 'response_end' && step === 1) {
      step = 2;
      console.log('\n[WS] 发送: 全部片段生成...');
      setTimeout(() => {
        ws.send(JSON.stringify({
          type: 'msg',
          data: { type: 'user', data: '全部7个片段都生成，每个片段4宫格分镜，现在直接开始生成图片。' }
        }));
      }, 2000);
    }

    // 关键：监听 shotsUpdated，把有图片的 shots 保存到数据库
    else if (msg.type === 'shotsUpdated') {
      const shots = msg.data;
      if (!Array.isArray(shots)) return;

      const toSave = [];
      for (const shot of shots) {
        if (!shot.cells || !Array.isArray(shot.cells)) continue;
        for (let idx = 0; idx < shot.cells.length; idx++) {
          const cell = shot.cells[idx];
          if (!cell.src || cell.src === '') continue;
          toSave.push({
            name: cell.name || `第${shot.segmentId}段第${shot.id || idx+1}镜-格${idx+1}`,
            videoPrompt: cell.videoPrompt || '',
            prompt: cell.prompt || '',
            duration: String(cell.duration || '5'),
            projectId: Number(PROJECT_ID),
            filePath: cell.src,
            type: '分镜',
            scriptId: Number(SCRIPT_ID),
            segmentId: shot.segmentId || 1,
            shotIndex: shot.id || (idx + 1),
          });
        }
      }

      if (toSave.length > 0) {
        console.log(`\n[WS] shotsUpdated: 保存 ${toSave.length} 条分镜到数据库...`);
        const res = await request('/storyboard/keepStoryboard', { results: toSave });
        savedCount += toSave.length;
        console.log(`[WS] 已保存 ${savedCount} 条分镜`);
      }
    }

    else if (msg.type === 'shotImageGenerateComplete') {
      console.log(`\n[WS] ✅ 所有分镜图生成完成！共保存 ${savedCount} 条`);
      clearTimeout(timeout);
      ws.close();
      process.exit(0);
    }
    else if (msg.type === 'stream') { process.stdout.write('.'); }
    else if (msg.type === 'shotImageGenerateProgress') {
      const d = msg.data;
      if (d.status === 'saving') console.log(`\n[WS] ${d.message}`);
    }
    else if (msg.type === 'error') { console.error(`\n[WS] 错误: ${msg.data}`); }
    else if (['subAgentEnd','transfer','refresh','response_end'].includes(msg.type)) {
      console.log(`\n[WS] ${msg.type}`);
    }
  });

  ws.on('close', () => { console.log('\n[WS] 连接关闭'); clearTimeout(timeout); });
  ws.on('error', err => console.error('[WS] 错误:', err.message));
}

main().catch(console.error);
