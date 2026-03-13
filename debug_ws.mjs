import WebSocket from 'ws';
import http from 'http';

const PROJECT_ID = '1';
const SCRIPT_ID = '1';
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
  console.log('[✓] 登录成功');

  const ws = new WebSocket(
    `ws://${BASE_URL}/storyboard/chatStoryboard?projectId=${PROJECT_ID}&scriptId=${SCRIPT_ID}`,
    { headers: { Authorization: TOKEN } }
  );

  let messageCount = 0;

  ws.on('open', () => {
    console.log('[✓] WebSocket 已连接\n');
  });

  ws.on('message', async (raw) => {
    const msg = JSON.parse(raw.toString());
    messageCount++;
    
    console.log(`\n[消息 ${messageCount}] type: ${msg.type}`);
    console.log(JSON.stringify(msg, null, 2));
    
    // 只在 init 时发送"开始"
    if (msg.type === 'init') {
      console.log('\n[→] 发送: 开始');
      ws.send(JSON.stringify({
        type: 'msg',
        data: { type: 'user', data: '开始' }
      }));
    }
  });

  ws.on('close', () => console.log('\n[✓] 连接关闭'));
  ws.on('error', err => console.error('[✗] 错误:', err.message));
  
  // 5分钟后自动关闭
  setTimeout(() => {
    console.log('\n[!] 超时，关闭连接');
    ws.close();
    process.exit(0);
  }, 5 * 60 * 1000);
}

main().catch(console.error);
