import WebSocket from 'ws';
import http from 'http';

const PROJECT_ID = process.argv[2] || '1';
const SCRIPT_ID = process.argv[3] || '1';
const SHOT_COUNT = process.argv[4] || '24'; // 2分钟视频，每个镜头5秒
const GRID_TYPE = process.argv[5] || '4'; // 四宫格
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
  console.log(`[配置] 项目ID: ${PROJECT_ID}, 剧本ID: ${SCRIPT_ID}`);
  console.log(`[配置] 目标分镜数: ${SHOT_COUNT}, 宫格类型: ${GRID_TYPE}宫格`);
  
  const loginRes = await request('/other/login', { username: 'admin', password: 'admin123' });
  const TOKEN = loginRes.data.token;
  console.log('[✓] 登录成功');

  const ws = new WebSocket(
    `ws://${BASE_URL}/storyboard/chatStoryboard?projectId=${PROJECT_ID}&scriptId=${SCRIPT_ID}`,
    { headers: { Authorization: TOKEN } }
  );

  let step = 0;
  let savedCount = 0;
  const timeout = setTimeout(() => { 
    console.log('[!] 超时退出'); 
    ws.close(); 
    process.exit(0); 
  }, 30 * 60 * 1000); // 30分钟超时

  ws.on('open', () => {
    console.log('[✓] WebSocket 已连接');
  });

  ws.on('message', async (raw) => {
    const msg = JSON.parse(raw.toString());

    // 步骤1: 初始化后，发送"开始"
    if (msg.type === 'init' && step === 0) {
      step = 1;
      console.log('[→] 发送: 开始');
      ws.send(JSON.stringify({
        type: 'msg',
        data: { type: 'user', data: '开始' }
      }));
    }

    // 步骤2: AI 询问分镜数量和宫格类型后，回答
    else if (msg.type === 'response_end' && step === 1) {
      step = 2;
      console.log(`[→] 回答: ${SHOT_COUNT}个分镜，${GRID_TYPE}宫格`);
      setTimeout(() => {
        ws.send(JSON.stringify({
          type: 'msg',
          data: { type: 'user', data: `生成${SHOT_COUNT}个分镜，使用${GRID_TYPE}宫格` }
        }));
      }, 1000);
    }

    // 步骤3: AI 生成分镜文案后，确认生成图片
    else if (msg.type === 'response_end' && step === 2) {
      step = 3;
      console.log('[→] 确认: 开始生成图片');
      setTimeout(() => {
        ws.send(JSON.stringify({
          type: 'msg',
          data: { type: 'user', data: '好的，现在开始生成所有分镜图片' }
        }));
      }, 1000);
    }

    // 监听分镜更新，保存到数据库
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
            name: cell.name || `第${shot.segmentId}段第${shot.id || idx+1}镜`,
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
        console.log(`[↓] 保存 ${toSave.length} 条分镜到数据库...`);
        const res = await request('/storyboard/keepStoryboard', { results: toSave });
        savedCount += toSave.length;
        console.log(`[✓] 已保存 ${savedCount} 条分镜`);
      }
    }

    // 图片生成完成
    else if (msg.type === 'shotImageGenerateComplete') {
      console.log(`\n[✓✓✓] 所有分镜图生成完成！共保存 ${savedCount} 条`);
      clearTimeout(timeout);
      ws.close();
      process.exit(0);
    }

    // 进度提示
    else if (msg.type === 'shotImageGenerateProgress') {
      const d = msg.data;
      console.log(`[...] ${d.message || d.status}`);
    }

    // 流式输出
    else if (msg.type === 'stream') {
      process.stdout.write('.');
    }

    // 其他消息
    else if (msg.type === 'response_end') {
      console.log(`\n[✓] AI 回复完成`);
    }
    else if (msg.type === 'error') {
      console.error(`\n[✗] 错误: ${msg.data}`);
    }
  });

  ws.on('close', () => { 
    console.log('\n[✓] WebSocket 连接关闭'); 
    clearTimeout(timeout); 
  });
  
  ws.on('error', err => {
    console.error('[✗] WebSocket 错误:', err.message);
  });
}

main().catch(err => {
  console.error('[✗] 脚本错误:', err);
  process.exit(1);
});
