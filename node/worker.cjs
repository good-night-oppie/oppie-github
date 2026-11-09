const readline = require('node:readline');

function reply(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

readline.createInterface({ input: process.stdin }).on('line', function (line) {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    reply({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }
  if (request.method === 'echo') {
    reply({ jsonrpc: '2.0', id: request.id, result: { text: String(request.params?.text || '') } });
    return;
  }
  reply({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found' } });
});
